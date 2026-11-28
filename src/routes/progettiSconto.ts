// Lo sconto concordato su un progetto (titolare, 28/11/2026): un campo solo, in centesimi. Con
// moduli presenti il valore del progetto è la somma dei moduli meno lo sconto, e gli importi
// proposti in fattura lo scontano in proporzione (`domain/importiFatturabili.ts`).
//
// Sta in un file suo perché `progetti.ts` è già oltre soglia (regola 8); lo registra
// `registraRotteProgetti`.

import type { FastifyInstance } from 'fastify';
import { prisma, conContestoInTransazione } from '../util/prismaClient.js';
import { riallineaValoreProgetto } from '../services/valoreProgetto.js';
import { recordAudit } from '../util/serverHelpers.js';

/** Lo sconto è una decisione commerciale: la prende chi risponde dello studio, come archiviare ed eliminare. */
const RUOLI_SCONTO = ['super_admin', 'advisor'];

const euro = (centesimi: number): string => `€${(centesimi / 100).toFixed(2)}`;

export async function registraRottaScontoProgetto(server: FastifyInstance): Promise<void> {
  server.put<{ Params: { id: string }; Body: { scontoCentesimi?: unknown } }>(
    '/progetti/:id/sconto',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!RUOLI_SCONTO.includes(req.ruolo ?? '')) {
        return reply.code(403).send({ errore: 'Solo il responsabile dello studio può scrivere lo sconto di un progetto.' });
      }
      const sconto = req.body?.scontoCentesimi;
      if (typeof sconto !== 'number' || !Number.isInteger(sconto) || sconto < 0) {
        return reply.code(400).send({ errore: 'Lo sconto è un importo in centesimi, intero e non negativo.' });
      }

      try {
        const esito = await prisma.$transaction(async (tx) =>
          conContestoInTransazione(tx, async () => {
            const progetto = await tx.progetto.findFirst({
              where: { id, tenantId },
              select: { id: true, nome: true, scontoCentesimi: true, moduli: { select: { prezzo: true } } },
            });
            if (!progetto) return { nonTrovato: true as const };
            const sommaModuli = progetto.moduli.reduce((tot, m) => tot + m.prezzo, 0);
            // Senza moduli non c'è una somma da scontare: lì il valore si scrive a mano.
            if (progetto.moduli.length === 0) return { senzaModuli: true as const };
            // Uno sconto pari a tutto il valore non è uno sconto: è un progetto gratuito, che non si
            // decide da un campo «sconto».
            if (sconto > 0 && sconto >= sommaModuli) return { troppoAlto: true as const, sommaModuli };

            await tx.progetto.update({ where: { id }, data: { scontoCentesimi: sconto } });
            const valoreTotale = await riallineaValoreProgetto(tx, id);
            return { progetto, sommaModuli, valoreTotale: valoreTotale ?? 0 };
          }),
        );

        if ('nonTrovato' in esito) return reply.code(404).send({ errore: 'Progetto non trovato' });
        if ('senzaModuli' in esito) {
          return reply.code(409).send({ errore: 'Il progetto non ha moduli: il suo valore si scrive direttamente, non c’è una somma da scontare.' });
        }
        if ('troppoAlto' in esito) {
          return reply.code(400).send({ errore: `Lo sconto deve essere più basso della somma dei moduli (${euro(esito.sommaModuli)}).` });
        }

        await recordAudit({
          tenantId,
          userId: req.userId,
          userEmail: req.user?.email,
          ruolo: req.ruolo,
          azione: 'PROGETTO_SCONTO',
          entita: id,
          dettagli:
            `Progetto «${esito.progetto.nome}»: sconto da ${euro(esito.progetto.scontoCentesimi)} a ${euro(sconto)} ` +
            `(somma dei moduli ${euro(esito.sommaModuli)}, valore ${euro(esito.valoreTotale)})`,
          ipAddress: req.ip,
        });

        return reply.send({
          ok: true,
          id,
          scontoCentesimi: sconto,
          sommaModuliCentesimi: esito.sommaModuli,
          valoreTotale: esito.valoreTotale,
        });
      } catch (err) {
        req.log.error(err, `Sconto del progetto ${id} non salvato`);
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore nel salvataggio dello sconto' });
      }
    },
  );
}
