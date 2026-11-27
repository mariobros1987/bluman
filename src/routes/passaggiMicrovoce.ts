// Eliminare un passaggio interno di un'attività («Elimina passaggio» nella Checklist Passaggi).
//
// Prima il passaggio spariva solo dalla pagina: il salvataggio dell'elenco aggiorna e crea, non
// toglie, quindi alla riapertura il passaggio eliminato era di nuovo lì.
//
// Permessi (regola 9): `/microvoci` è nella mappa `rbacModuli.ts` (modulo «projects»); il cliente
// del portale è fermato dal controllo globale.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { idPassaggio } from '../services/passaggiMicrovoce.js';

export async function registraRottePassaggiMicrovoce(server: FastifyInstance) {
  server.delete<{ Params: { id: string; passaggioId: string } }>('/microvoci/:id/passaggi/:passaggioId', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const microvoce = await prisma.microvoceProgetto.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true, nome: true },
      });
      if (!microvoce) return reply.code(404).send({ errore: 'Attività non trovata: il passaggio non è stato eliminato.' });

      // La pagina può nominare il passaggio col suo nome locale («s3»): è lo stesso nome con cui
      // è stato salvato, e porta alla stessa riga.
      const id = idPassaggio(microvoce.id, req.params.passaggioId);
      const riga = id
        ? await prisma.passaggioProgetto.findFirst({ where: { id, microvoceProgettoId: microvoce.id }, select: { id: true, titolo: true } })
        : null;
      // Un passaggio mai salvato non ha niente da togliere: non è un errore.
      if (!riga) return reply.send({ ok: true, eliminato: false });

      await prisma.passaggioProgetto.delete({ where: { id: riga.id } });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'PASSAGGIO_ELIMINATO',
        entita: `Passaggio ${riga.id}`,
        dettagli: `«${riga.titolo}» tolto dall'attività «${microvoce.nome}»`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, eliminato: true });
    } catch (err) {
      req.log.error({ tenantId, err: err instanceof Error ? err.message : err }, 'DELETE /microvoci/:id/passaggi/:passaggioId — eliminazione fallita');
      return reply.code(500).send({ errore: 'Il passaggio non è stato eliminato. Riprova.' });
    }
  });
}
