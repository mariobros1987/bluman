// Scarico degli allegati del canale protetto studio ↔ cliente.
//
// È l'unica porta da cui un allegato protetto esce dall'archivio: chiede il token, controlla che la
// pratica sia dello studio (e, per il cliente, sua), decifra e consegna. Non esiste un indirizzo
// che, inoltrato a un terzo, apra il file: è la differenza con gli allegati degli altri canali.
//
// Permessi: per lo studio la rotta sta sotto `/progetti/:id/comunicazioni`, quindi modulo
// Comunicazioni in `rbacModuli.ts`; per il cliente è nell'elenco `ROTTE_CLIENTE_CONSENTITE` e qui
// sotto si verifica che la pratica sia la sua.
import type { FastifyInstance } from 'fastify';
import { ErroreCifratura } from '../services/cifraturaCanale.js';
import { leggiAllegatoProtetto } from '../services/canaleProtetto.js';
import { prisma } from '../util/prismaClient.js';
import { clienteDellaRichiesta } from '../util/serverHelpers.js';

export async function registraRotteCanaleProtetto(server: FastifyInstance): Promise<void> {
  server.get<{ Params: { id: string; msgId: string; indice: string } }>(
    '/progetti/:id/comunicazioni/:msgId/allegati/:indice',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const indice = Number(req.params.indice);
      if (!Number.isInteger(indice) || indice < 0 || indice > 50) {
        return reply.code(400).send({ errore: 'Allegato non valido.' });
      }
      if (req.ruolo === 'cliente') {
        const clienteId = clienteDellaRichiesta(req);
        const sua = clienteId
          ? await prisma.progetto.findFirst({ where: { id: req.params.id, tenantId, clienteId }, select: { id: true } })
          : null;
        // 404 e non 403: a chi non è il cliente della pratica non si conferma nemmeno che esiste.
        if (!sua) return reply.code(404).send({ errore: 'Allegato non trovato.' });
      }
      const riga = await prisma.comunicazioneProgetto.findFirst({
        where: { id: req.params.msgId, progettoId: req.params.id, tenantId },
        select: { id: true, tenantId: true, progettoId: true, canale: true, testo: true, allegatiJson: true },
      });
      if (!riga) return reply.code(404).send({ errore: 'Allegato non trovato.' });

      let allegato: Awaited<ReturnType<typeof leggiAllegatoProtetto>>;
      try {
        allegato = await leggiAllegatoProtetto(riga, indice);
      } catch (err) {
        if (!(err instanceof ErroreCifratura)) throw err;
        req.log.error({ err, comunicazioneId: riga.id, indice }, 'canale protetto: allegato non apribile');
        return reply.code(409).send({ errore: `L'allegato c'è ma non si può aprire. ${err.message}` });
      }
      if (!allegato) return reply.code(404).send({ errore: 'Allegato non trovato o non più in archivio.' });

      // Sempre come file da scaricare e senza che il browser ne indovini il tipo: un HTML caricato
      // da una delle due parti non deve aprirsi come pagina dentro il gestionale dell'altra.
      const nomeAscii = allegato.nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      return reply
        .header('Content-Type', allegato.mime || 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(allegato.nome)}`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(allegato.contenuto);
    },
  );
}
