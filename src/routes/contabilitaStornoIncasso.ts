// Storno di un incasso (titolare, 28/11/2026): l'incasso registrato per errore non si cancella,
// si annulla con una riga contraria. In un atto solo: registrazione di storno (importo negativo),
// rata riaperta, stato della fattura, uscita in Prima Nota dallo stesso conto e saldo del conto.
// Chi e perché restano nel registro (`INCASSO_STORNATO`). Le regole stanno in `domain/stornoIncasso.ts`.

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma, conContestoInTransazione, riprovaSuConflitto } from '../util/prismaClient.js';
import { creaMovimentoConSaldo } from '../services/primaNotaMovimento.js';
import { recordAudit } from '../util/serverHelpers.js';
import { StornaIncassoSchema } from '../schemas/contabilita.schema.js';
import {
  fatturaSaldata,
  motivoIncassoNonStornabile,
  movimentoDellIncasso,
  statoRataDaIncassato,
  totaleIncassatoCentesimi,
} from '../domain/stornoIncasso.js';

export async function registraRotteContabilitaStornoIncasso(server: FastifyInstance): Promise<void> {
  // Sta sotto `/invoices/scadenze`: nella matrice dei permessi è Scadenzario, come l'incasso
  // (`util/rbacModuli.ts`). Storna chi può registrare un incasso.
  server.post<{ Params: { id: string; incassoId: string }; Body: { motivo?: string } }>(
    '/invoices/scadenze/:id/incassi/:incassoId/storno',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { id, incassoId } = req.params;
      const parse = StornaIncassoSchema.safeParse(req.body || {});
      if (!parse.success) {
        return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati dello storno non validi' });
      }
      const motivo = parse.data.motivo;

      try {
        const esito = await riprovaSuConflitto(() =>
          prisma.$transaction(
            async (tx) =>
              conContestoInTransazione(tx, async () => {
                const scadenza = await tx.scadenzaIncasso.findFirst({
                  where: { id, tenantId },
                  include: { registrazioniRegistrate: true, fattura: true },
                });
                const incasso = scadenza?.registrazioniRegistrate.find((r) => r.id === incassoId);
                if (!scadenza || !incasso) return { nonTrovato: true as const };

                const rifiuto = motivoIncassoNonStornabile(incasso, scadenza.registrazioniRegistrate, {
                  statoFattura: scadenza.fattura.stato,
                  statoRata: scadenza.stato,
                });
                if (rifiuto) return { rifiuto };

                // Il denaro esce dal conto in cui era entrato: lo dice il movimento dell'incasso.
                const movimentiFattura = await tx.movimentoPrimaNota.findMany({
                  where: { tenantId, fatturaId: scadenza.fatturaId, tipo: 'entrata', categoria: 'incasso_fattura' },
                  orderBy: { createdAt: 'asc' },
                });
                const originale = movimentoDellIncasso(incasso, movimentiFattura);
                if (!originale) return { movimentoNonTrovato: true as const };

                const dataStorno = new Date();
                // 1. La riga contraria: stesso importo col segno meno, e nomina l'incasso che annulla.
                const storno = await tx.registrazioneIncasso.create({
                  data: {
                    tenantId,
                    scadenzaIncassoId: scadenza.id,
                    fatturaId: scadenza.fatturaId,
                    importoIncassatoCentesimi: -incasso.importoIncassatoCentesimi,
                    dataIncasso: dataStorno,
                    metodoPagamento: incasso.metodoPagamento,
                    riferimentoTransazione: incasso.riferimentoTransazione,
                    noteOperatore: `Storno: ${motivo}`,
                    stornoDiId: incasso.id,
                  },
                });

                // 2. La rata si riapre per quanto non risulta più incassato.
                const incassatoDopo =
                  totaleIncassatoCentesimi(scadenza.registrazioniRegistrate) - incasso.importoIncassatoCentesimi;
                const nuovoStatoRata = statoRataDaIncassato(scadenza.importoCentesimi, incassatoDopo);
                await tx.scadenzaIncasso.update({ where: { id: scadenza.id }, data: { stato: nuovoStatoRata } });

                // 3. La fattura torna «emessa» se non è più tutta saldata (stessa regola dell'incasso).
                const rate = await tx.scadenzaIncasso.findMany({ where: { fatturaId: scadenza.fatturaId } });
                const saldata = fatturaSaldata(rate.map((s) => (s.id === scadenza.id ? nuovoStatoRata : s.stato)));
                await tx.fattura.update({
                  where: { id: scadenza.fatturaId },
                  data: { stato: saldata ? 'incassata' : 'emessa' },
                });

                // 4. Un incasso di prima del 28/11 non nominava la sua registrazione: lo si lega
                // adesso, così non può essere scelto una seconda volta per un altro storno.
                if (!originale.registrazioneIncassoId) {
                  await tx.movimentoPrimaNota.update({
                    where: { id: originale.id },
                    data: { registrazioneIncassoId: incasso.id },
                  });
                }

                // 5. L'uscita contraria in Prima Nota e il saldo del conto: un atto solo.
                const numeroFattura = scadenza.fattura.numero || scadenza.fatturaId;
                await creaMovimentoConSaldo(tx, {
                  data: {
                    tenantId,
                    contoBancarioId: originale.contoBancarioId,
                    fatturaId: scadenza.fatturaId,
                    clienteId: scadenza.fattura.clienteId,
                    registrazioneIncassoId: storno.id,
                    data: dataStorno,
                    tipo: 'uscita',
                    categoria: 'incasso_fattura',
                    descrizione: `Storno incasso rata #${scadenza.numeroRata} fattura ${numeroFattura}`,
                    importoCentesimi: incasso.importoIncassatoCentesimi,
                    metodoPagamento: incasso.metodoPagamento,
                    riferimentoTransazione: incasso.riferimentoTransazione,
                    note: motivo,
                  },
                });

                return { storno, nuovoStatoRata, importo: incasso.importoIncassatoCentesimi, numeroFattura, numeroRata: scadenza.numeroRata };
              }),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        );

        if ('nonTrovato' in esito) return reply.code(404).send({ errore: 'Incasso non trovato su questa rata' });
        if ('rifiuto' in esito) return reply.code(409).send({ errore: esito.rifiuto });
        if ('movimentoNonTrovato' in esito) {
          return reply.code(409).send({
            errore:
              'Non riesco a riconoscere in Prima Nota il movimento di questo incasso, quindi non so da quale conto ' +
              'far uscire lo storno. Non è stato scritto niente.',
            codice: 'MOVIMENTO_NON_RICONOSCIUTO',
          });
        }

        await recordAudit({
          tenantId,
          userId: req.userId,
          ruolo: req.ruolo,
          azione: 'INCASSO_STORNATO',
          entita: `Scadenza #${id}`,
          dettagli:
            `Stornato incasso di €${(esito.importo / 100).toFixed(2)} sulla rata #${esito.numeroRata} della fattura ${esito.numeroFattura}: ` +
            `rata tornata «${esito.nuovoStatoRata}», uscita contraria in Prima Nota. Motivo: ${motivo}`,
          ipAddress: req.ip,
        });

        return reply.code(201).send({ ok: true, storno: esito.storno, statoRata: esito.nuovoStatoRata });
      } catch (err) {
        req.log.error(err, 'Errore storno incasso');
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore storno incasso' });
      }
    },
  );
}
