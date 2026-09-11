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

export async function registraRotteContabilitaScadenzario(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── SCADENZARIO & REGISTRAZIONE INCASSI CON PRIMA NOTA AUTOMATICA ──
  server.get('/invoices/scadenzario', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const scadenze = await prisma.scadenzaIncasso.findMany({
        where: { tenantId },
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
              const totaleIncassatoRata = scadenza.registrazioniRegistrate.reduce((acc, r) => acc + r.importoIncassatoCentesimi, 0) + importoIncassatoCentesimi;
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
