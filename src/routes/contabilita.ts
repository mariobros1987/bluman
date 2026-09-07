// Rotte contabilità: fatture, incassi/scadenzario, registro fatture, banche,
// reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti,
// cron scadenze, SDI manuale, Prima Nota e importatori sorgente (OpenSTAManager Engine).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { registraRotteContabilitaContiReport } from './contabilitaContiReport.js';
import { registraRotteContabilitaContratti } from './contabilitaContratti.js';
import { registraRotteContabilitaCron } from './contabilitaCron.js';
import { registraRotteContabilitaFatture } from './contabilitaFatture.js';
import { registraRotteContabilitaPdfEmail } from './contabilitaPdfEmail.js';
import { registraRotteContabilitaPrimaNota } from './contabilitaPrimaNota.js';
import { registraRotteContabilitaRegistro } from './contabilitaRegistro.js';
import { registraRotteContabilitaScadenzario } from './contabilitaScadenzario.js';
import { registraRotteContabilitaSdi } from './contabilitaSdi.js';
import { registraRotteContabilitaWebhookSdi } from './contabilitaWebhookSdi.js';

export async function registraRotteContabilita(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── COMPATIBILITÀ ROTTE PRECEDENTI ────────────────────────────────
  // ─── REGISTRO FATTURE (OPENSTAMANAGER ENGINE) ──────────────────────
  await registraRotteContabilitaRegistro(server, app);

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
