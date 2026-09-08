// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «CRON & PREPARAZIONE SDI MANUALE». Il parametro `app` resta in
// firma per uniformità con gli altri moduli rotte, anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { runDailyNotificationCron } from '../services/cronService.js';
import { preparaFatturaPerInvioManuale } from '../services/sdiService.js';
import { recordAudit } from '../util/serverHelpers.js';

export async function registraRotteContabilitaCron(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── CRON & PREPARAZIONE SDI MANUALE ───────────────────────────────
  server.post('/cron/esegui-notifiche-scadenze', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const report = await runDailyNotificationCron(tenantId);
      return reply.send({
        ok: true,
        message: `Scansione completata con successo. Elaborate ${report.notificheInviate} notifiche proattive.`,
        report,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore esecuzione cron' });
    }
  });

  server.post<{ Params: { id: string } }>('/invoices/:id/prepara-invio-manuale', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      // Nessun catch vuoto: se la query fallisce l'errore va al catch esterno (500),
      // e se la fattura non esiste ci si ferma qui. Procedere con una fattura
      // inesistente significherebbe scrivere nell'audit un riferimento a una
      // fattura che non c'è.
      const fattura = await prisma.fattura.findUnique({
        where: { id },
        include: { progetto: { include: { cliente: true } } },
      });
      if (!fattura) {
        return reply.code(404).send({ errore: 'Fattura non trovata' });
      }
      // Solo il numero vero, mai uno inventato: per SdI si prepara una fattura
      // emessa, e una fattura senza numero non lo è. `numero` è il campo
      // formattato ("FT-2026/001"); il progressivo Int darebbe solo "12".
      if (!fattura.numero) {
        return reply.code(400).send({
          errore: 'La fattura non ha ancora un numero di emissione: emettila prima di prepararla per l\'invio SdI',
        });
      }
      const numFattura = fattura.numero;

      const result = await preparaFatturaPerInvioManuale({
        fatturaId: id,
        numeroProgressivo: numFattura,
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_PREPARATA_INVIO_MANUALE',
        entita: `Fattura ${numFattura}`,
        dettagli: `Fattura elettronica ${numFattura} preparata per invio manuale a SdI (riferimento locale: ${result.riferimentoPreparazione}). Trasmissione a cura dell'operatore.`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        riferimentoPreparazione: result.riferimentoPreparazione,
        dataPreparazione: result.dataPreparazione,
        message: result.message,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore preparazione invio manuale' });
    }
  });
}
