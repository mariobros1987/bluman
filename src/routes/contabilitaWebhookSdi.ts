// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotta del blocco «WEBHOOK ESITI SDI». Il parametro `app` resta in firma per
// uniformità con gli altri moduli rotte, anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma, prismaAmministrativo, attivaContestoTenant } from '../util/prismaClient.js';
import { timingSafeEqual } from 'node:crypto';
import { recordAudit } from '../util/serverHelpers.js';

export async function registraRotteContabilitaWebhookSdi(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── WEBHOOK ESITI SDI ─────────────────────────────────────────────
  // La rotta è pubblica nel guard JWT (server.ts) perché SdI non può portare
  // un nostro token, ma "pubblica" non significa "aperta": l'esito arriva con
  // un secret condiviso (`WEBHOOK_SECRET_SDI`) che solo il chiamante legittimo
  // conosce. Il confronto usa timingSafeEqual sulla stessa lunghezza, così il
  // tempo di risposta non rivela quanto del secret sia giusto. Senza secret
  // configurato la rotta rifiuta tutto: in produzione un webhook non
  // autenticabile non deve essere in ascolto.
  server.post<{
    Body: { fatturaId: string; statoSdi: 'consegnata' | 'scartata' | 'mancata_consegna'; note?: string; secret?: string };
  }>(
    '/webhooks/sdi',
    async (req, reply) => {
      const { fatturaId, statoSdi, note } = req.body;
      if (!fatturaId || !statoSdi) return reply.code(400).send({ errore: 'fatturaId e statoSdi sono obbligatori' });

      const secretAtteso = process.env.WEBHOOK_SECRET_SDI;
      const secretRicevuto = req.body.secret || req.headers['x-webhook-secret'];
      const secretRicevutoStr = Array.isArray(secretRicevuto) ? secretRicevuto[0] : secretRicevuto;
      if (!secretAtteso) {
        return reply.code(503).send({ errore: 'Webhook SDI non configurato: impostare WEBHOOK_SECRET_SDI' });
      }
      if (
        typeof secretRicevutoStr !== 'string' ||
        secretRicevutoStr.length !== secretAtteso.length ||
        !timingSafeEqual(Buffer.from(secretRicevutoStr), Buffer.from(secretAtteso))
      ) {
        return reply.code(401).send({ errore: 'Secret webhook SDI non valido' });
      }

      // Il tenant non è ancora noto: la rotta è anonima e il tenant si scopre
      // dalla riga fattura stessa. Come per il magic token (§23), è il secret
      // verificato sopra a delimitare cosa questa query può trovare, quindi il
      // client amministrativo è legittimo SOLO per questa lettura.
      const prismaAdmin = prismaAmministrativo();
      const fatturaTrovata = await prismaAdmin.fattura.findUnique({
        where: { id: fatturaId },
        select: { id: true, tenantId: true },
      });
      if (!fatturaTrovata) {
        return reply.code(404).send({ errore: 'Fattura non trovata' });
      }

      // Da qui il contesto tenant è quello della fattura: l'update e l'audit
      // viaggiano col client normale, quindi con le policy RLS attive.
      attivaContestoTenant({ tenantId: fatturaTrovata.tenantId });

      try {
        const fattura = await prisma.fattura.update({
          where: { id: fatturaId },
          data: { statoSdi, esitoSdiDettagli: note ?? null },
        });

        await recordAudit({
          tenantId: fattura.tenantId,
          azione: 'SDI_ESITO_RICEVUTO',
          entita: `Fattura ${fattura.numero}`,
          dettagli: `Ricevuto esito SDI via Webhook: ${statoSdi.toUpperCase()}. ${note || ''}`,
        });

        return reply.send({ ok: true, statoSdi: fattura.statoSdi });
      } catch {
        return reply.code(500).send({ errore: 'Errore aggiornamento esito SDI' });
      }
    },
  );
}
