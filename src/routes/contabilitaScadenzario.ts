// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «SCADENZARIO & REGISTRAZIONE INCASSI CON PRIMA NOTA AUTOMATICA».
// Il parametro `app` resta in firma per uniformità con gli altri moduli rotte,
// anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppPort } from '../services/appPort.js';
import { prisma, conContestoInTransazione, riprovaSuConflitto } from '../util/prismaClient.js';
import { notificaStudio, notificaCliente } from '../services/notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';
import { RegistraIncassoSchema } from '../schemas/contabilita.schema.js';
import { leggiIntervalloData, filtroData } from '../util/intervalloData.js';

export async function registraRotteContabilitaScadenzario(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── SCADENZARIO & REGISTRAZIONE INCASSI CON PRIMA NOTA AUTOMATICA ──
  server.get<{ Querystring: { dataDa?: string; dataA?: string } }>('/invoices/scadenzario', async (req, reply) => {
    const tenantId = req.tenantId;
    // Filtro periodo sulla data di scadenza (campo non-nullable). Estremo malformato → 400,
    // così un typo nel filtro non passa inosservato dietro il catch che ritorna [].
    const periodo = leggiIntervalloData(req.query.dataDa, req.query.dataA);
    if (!periodo.ok) return reply.code(400).send({ errore: periodo.errore });
    const filtroScadenza = filtroData(periodo.intervallo);
    try {
      const where: Prisma.ScadenzaIncassoWhereInput = { tenantId };
      if (filtroScadenza) where.dataScadenza = filtroScadenza;
      const scadenze = await prisma.scadenzaIncasso.findMany({
        where,
        include: {
          fattura: {
            include: {
              progetto: { include: { cliente: true } },
              cliente: true,
            },
          },
          registrazioniRegistrate: true,
        },
        orderBy: { dataScadenza: 'asc' },
      });
      return reply.send(scadenze);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Params: { id: string };
    Body: {
      importoIncassatoCentesimi: number;
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      riferimentoTransazione?: string;
      contoBancarioId?: string;
      noteOperatore?: string;
    };
  }>('/invoices/scadenze/:id/incassi', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const parseResult = RegistraIncassoSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati incasso non validi' });
    }
    const { importoIncassatoCentesimi, metodoPagamento, riferimentoTransazione, contoBancarioId, noteOperatore } = parseResult.data;

    try {
      // L'incasso è UNA sola operazione contabile: registrazione, stato della
      // rata, stato della fattura, movimento in Prima Nota e saldo del conto
      // devono muoversi insieme. Da separate, un processo morto a metà lasciava
      // l'incasso registrato senza scritta in Prima Nota e senza saldo, con la
      // contabilità del tenant squilibrata. Con Serializable due incassi
      // simultanei sulla stessa rata vengono serializzati: quello che perde il
      // conflitto (P2034) viene rilanciato da `riprovaSuConflitto`, che rilegge
      // qui dentro i totali già aggiornati dall'altro.
      const esito = await riprovaSuConflitto(() =>
        prisma.$transaction(
          async (tx) =>
            conContestoInTransazione(tx, async () => {
              const scadenza = await tx.scadenzaIncasso.findUnique({
                where: { id },
                include: {
                  registrazioniRegistrate: true,
                  fattura: { include: { cliente: true, progetto: { include: { cliente: true } } } },
                },
              });
              if (!scadenza) return { nonTrovata: true as const };

              // Guardia (audit 21/09/2026): non si incassa su una fattura ANNULLATA (stornata
              // con Nota di Credito). Senza questo controllo il passo 3 riportava la fattura da
              // 'annullata' a 'emessa'/'incassata', "resuscitandola".
              if (scadenza.fattura.stato === 'annullata') {
                return { fatturaAnnullata: true as const };
              }

              // Una rata già stornata da una Nota di Credito è terminale: non la si incassa.
              // La guardia sulla fattura sopra copre l'annullo totale; questa copre la NC parziale,
              // dove la fattura resta viva ma la singola rata è stata stornata.
              if (scadenza.stato === 'stornata') {
                return { scadenzaStornata: true as const };
              }

              // Tetto all'over-incasso: l'importo non può superare il residuo della rata,
              // altrimenti si gonfia il saldo conto oltre il dovuto senza alcuna segnalazione.
              const giaIncassatoRata = scadenza.registrazioniRegistrate.reduce(
                (acc, r) => acc + r.importoIncassatoCentesimi,
                0,
              );
              const residuoRataCent = scadenza.importoCentesimi - giaIncassatoRata;
              if (importoIncassatoCentesimi > residuoRataCent) {
                return { eccedeResiduo: true as const, residuoRataCent };
              }

              // 1. Registra l'incasso della rata
              const registrazione = await tx.registrazioneIncasso.create({
                data: {
                  tenantId,
                  scadenzaIncassoId: id,
                  fatturaId: scadenza.fatturaId,
                  importoIncassatoCentesimi,
                  metodoPagamento: metodoPagamento || 'bonifico',
                  riferimentoTransazione,
                  noteOperatore,
                },
              });

              // 2. Aggiorna stato della rata
              const totaleIncassatoRata = giaIncassatoRata + importoIncassatoCentesimi;
              const nuovoStatoScadenza = totaleIncassatoRata >= scadenza.importoCentesimi ? 'incassato' : 'parziale';

              await tx.scadenzaIncasso.update({
                where: { id },
                data: { stato: nuovoStatoScadenza },
              });

              // 3. Verifica se tutte le rate della fattura sono saldate
              const tutteScadenzeFattura = await tx.scadenzaIncasso.findMany({
                where: { fatturaId: scadenza.fatturaId },
              });
              const tutteSaldate = tutteScadenzeFattura.every((s) => s.id === id ? nuovoStatoScadenza === 'incassato' : s.stato === 'incassato');

              await tx.fattura.update({
                where: { id: scadenza.fatturaId },
                data: { stato: tutteSaldate ? 'incassata' : 'emessa' },
              });

              // 4. Generazione Movimento Automatico in Prima Nota (OpenSTAManager Engine)
              const targetContoId = contoBancarioId || scadenza.fattura.contoAccreditoId;
              await tx.movimentoPrimaNota.create({
                data: {
                  tenantId,
                  contoBancarioId: targetContoId || null,
                  fatturaId: scadenza.fatturaId,
                  clienteId: scadenza.fattura.clienteId,
                  tipo: 'entrata',
                  categoria: 'incasso_fattura',
                  descrizione: `Incasso rata #${scadenza.numeroRata} fattura ${scadenza.fattura.numero || scadenza.fatturaId}`,
                  importoCentesimi: importoIncassatoCentesimi,
                  metodoPagamento: metodoPagamento || 'bonifico',
                  riferimentoTransazione: riferimentoTransazione || null,
                  note: noteOperatore || null,
                },
              });

              // 5. Accredito Saldo Conto Bancario
              if (targetContoId) {
                await tx.contoBancario.update({
                  where: { id: targetContoId },
                  data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
                });
              } else {
                const contoPredefinito = await tx.contoBancario.findFirst({
                  where: { tenantId, isDefault: true },
                });
                if (contoPredefinito) {
                  await tx.contoBancario.update({
                    where: { id: contoPredefinito.id },
                    data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
                  });
                }
              }

              return { registrazione, tutteSaldate, scadenza };
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      if ('nonTrovata' in esito) {
        return reply.code(404).send({ errore: 'Scadenza incasso non trovata' });
      }
      if ('fatturaAnnullata' in esito) {
        return reply.code(409).send({
          errore:
            'La fattura è annullata (stornata con Nota di Credito): non è possibile registrare un incasso su una sua rata.',
        });
      }
      if ('scadenzaStornata' in esito) {
        return reply.code(409).send({
          errore:
            'La rata è stata stornata con una Nota di Credito: non è possibile registrare un incasso.',
        });
      }
      if ('eccedeResiduo' in esito) {
        const residuoCent = esito.residuoRataCent ?? 0;
        return reply.code(400).send({
          errore: `Importo superiore al residuo della rata (${(residuoCent / 100).toFixed(2)} €). Registra al massimo il residuo.`,
        });
      }

      const { registrazione, tutteSaldate, scadenza } = esito;

      // 6. Notifiche Studio e Cliente se saldata. Fuori dalla transazione e con
      // il proprio catch: un guasto di notifica non deve riportare indietro
      // una contabilità già scritta.
      if (tutteSaldate) {
        const etichetta = scadenza.fattura.numero || `FT-${scadenza.fattura.numeroProgressivoSerie}`;
        const importo = `€ ${(scadenza.importoCentesimi / 100).toLocaleString('it-IT')}`;
        const nomeCliente = scadenza.fattura.cliente?.nome || scadenza.fattura.progetto?.cliente?.nome || 'Cliente';

        await notificaStudio(tenantId, {
          tipoEvento: 'fattura_incassata',
          oggetto: 'Fattura incassata',
          corpo: `La fattura ${etichetta} di ${nomeCliente} è stata saldata (${importo}).`,
          link: '/invoices',
        }).catch(() => {});

        if (scadenza.fattura.clienteId) {
          await notificaCliente(tenantId, scadenza.fattura.clienteId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Pagamento registrato',
            corpo: `Abbiamo registrato il pagamento della fattura ${etichetta} (${importo}). Grazie!`,
            link: '/portal/invoices',
          }).catch(() => {});
        }
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'INCASSO_REGISTRATO',
        entita: `Scadenza #${id}`,
        dettagli: `Registrato incasso di €${(importoIncassatoCentesimi / 100).toFixed(2)} via ${metodoPagamento || 'bonifico'} con scrittura automatica in Prima Nota`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(registrazione);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore registrazione incasso' });
    }
  });
}
