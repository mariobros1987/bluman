// Rotte contabilità: fatture, incassi/scadenzario, registro fatture, banche,
// reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti,
// cron scadenze, SDI manuale, Prima Nota e importatori sorgente (OpenSTAManager Engine).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { registraRotteContabilitaContiReport } from './contabilitaContiReport.js';
import { registraRotteContabilitaContratti } from './contabilitaContratti.js';
import { registraRotteContabilitaCron } from './contabilitaCron.js';
import { registraRotteContabilitaFatture } from './contabilitaFatture.js';
import { registraRotteContabilitaPdfEmail } from './contabilitaPdfEmail.js';
import { registraRotteContabilitaPrimaNota } from './contabilitaPrimaNota.js';
import { registraRotteContabilitaScadenzario } from './contabilitaScadenzario.js';
import { registraRotteContabilitaSdi } from './contabilitaSdi.js';
import { registraRotteContabilitaWebhookSdi } from './contabilitaWebhookSdi.js';

export async function registraRotteContabilita(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── COMPATIBILITÀ ROTTE PRECEDENTI ────────────────────────────────
  server.get('/fatture/tutte', async () => {
    return (app as any).listaFattureTutte();
  });

  server.post<{
    Params: { id: string };
    Body: {
      tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
      partitaIva?: string;
      codiceFiscale?: string;
      canale: 'sdi' | 'standard';
      righe: Array<{
        tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
        moduloProgettoId?: string;
        percentuale?: number;
        importo: number;
        descrizione: string;
      }>;
    };
  }>('/progetti/:id/fatture', async (req, reply) => {
    try {
      const fattura: any = await app.emettiFattura({
        progettoId: req.params.id,
        ...req.body,
      });

      await recordAudit({
        tenantId: req.tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_EMESSA',
        entita: fattura.numero || `Fattura Progetto`,
        dettagli: `Fattura ${fattura.numero || ''} emessa per importo €${((fattura.totaleDocumentoCentesimi || 0) / 100).toFixed(2)} da scheda progetto`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore emissione fattura progetto' });
    }
  });

  // ─── REGISTRO FATTURE (OPENSTAMANAGER ENGINE) ──────────────────────
  server.get('/invoices', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get('/fatture', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
          fatturaOrigine: true,
          noteCredito: true,
          auditLogFatture: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });
      return reply.send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura dettaglio fattura' });
    }
  });

  // ─── CREAZIONE NUOVA FATTURA O BOZZA ───────────────────────────────
  // ─── MODIFICA FATTURA IN BOZZA (CHECK IMMUTABILITÀ FISCALE) ────────
  // ─── ELIMINA FATTURA BOZZA ─────────────────────────────────────────
  // ─── EMISSIONE DEFINITIVA & GENERAZIONE SCADENZARIO RATE ───────────
  // ─── GENERAZIONE NOTA DI CREDITO (TD04) ────────────────────────────
  // ─── IMPORTATORI SORGENTE (PROGETTO, PREVENTIVO, RETAINER, TIMESHEET) ─
  await registraRotteContabilitaFatture(server, app);

  // ─── SCADENZARIO & REGISTRAZIONE INCASSI CON PRIMA NOTA AUTOMATICA ──
  await registraRotteContabilitaScadenzario(server, app);

  // ─── PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE) ───────────
  await registraRotteContabilitaPrimaNota(server, app);

  // ─── GENERATORE SDI XML CONFORME FATTURAPA 1.2 ────────────────────
  await registraRotteContabilitaSdi(server, app);

  // ─── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  await registraRotteContabilitaContiReport(server, app);

  // ─── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  await registraRotteContabilitaPdfEmail(server, app);

  // ─── WEBHOOK ESITI SDI ─────────────────────────────────────────────
  await registraRotteContabilitaWebhookSdi(server, app);

  // ─── CONTRATTI RICORRENTI & RETAINER ───────────────────────────────
  await registraRotteContabilitaContratti(server, app);

  // ─── CRON & PREPARAZIONE SDI MANUALE ───────────────────────────────
  await registraRotteContabilitaCron(server, app);
}
