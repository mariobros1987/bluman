/**
 * Coda di Dispatch Asincrono con Retry (Email & WhatsApp).
 *
 * Scopo architetturale (FASE 2.3):
 * - Isola il ciclo di vita della richiesta HTTP da latenze o rallentamenti di terze parti
 *   (server SMTP Register.it / relay Vercel o Meta Cloud API per WhatsApp).
 * - Esegue fino a 3 tentativi con backoff esponenziale (default: 1s, 5s, 25s).
 * - Se tutti i tentativi falliscono, lo stato del job passa a 'fallito' e viene
 *   registrato un evento immutabile di audit log (ERRORE_DISPATCH_NOTIFICA).
 * - Gestione in-memory isolata per processo Fastify con supporto per test deterministici.
 */

import { inviaEmail, type MessaggioEmail, type CredenzialiSmtp } from './emailRelay.js';
import { inviaTestoWhatsapp, type CredenzialiWhatsapp } from './whatsappService.js';
import { recordAudit } from '../util/serverHelpers.js';

export type TipoNotificaQueue = 'email' | 'whatsapp';
export type StatoJobNotifica = 'in_attesa' | 'in_corso' | 'completato' | 'fallito';

export interface EmailJobPayload {
  messaggio: MessaggioEmail;
  smtp?: CredenzialiSmtp;
}

export interface WhatsAppJobPayload {
  credenziali: CredenzialiWhatsapp;
  numero: string;
  testo: string;
}

export interface JobNotifica<T = EmailJobPayload | WhatsAppJobPayload> {
  id: string;
  tenantId: string;
  tipo: TipoNotificaQueue;
  payload: T;
  stato: StatoJobNotifica;
  tentativi: number;
  maxTentativi: number;
  backoffMs: number[];
  ultimoErrore: string | null;
  createdAt: Date;
  completatoAt: Date | null;
}

export interface OpzioniCoda {
  maxTentativi?: number;
  backoffMs?: number[];
  /** Funzione custom opzionale per inviare email (per test e dependency injection). */
  inviaEmailFn?: (messaggio: MessaggioEmail, smtp?: CredenzialiSmtp) => Promise<{ ok: boolean; errore?: string }>;
  /** Funzione custom opzionale per inviare WhatsApp (per test e dependency injection). */
  inviaWhatsAppFn?: (cred: CredenzialiWhatsapp, numero: string, testo: string) => Promise<{ ok: boolean; errore?: string }>;
}

const DEFAULT_MAX_TENTATIVI = 3;
const DEFAULT_BACKOFF_MS = [1000, 5000, 25000];

// Storage in-memory dei job per tenant
const codaJob = new Map<string, JobNotifica<any>>();
const activeTimers = new Set<NodeJS.Timeout>();

function generaJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Accoda una notifica email per l'invio asincrono in background.
 */
export function accodaNotificaEmail(
  tenantId: string,
  messaggio: MessaggioEmail,
  smtp?: CredenzialiSmtp,
  opzioni?: OpzioniCoda,
): JobNotifica<EmailJobPayload> {
  const job: JobNotifica<EmailJobPayload> = {
    id: generaJobId(),
    tenantId,
    tipo: 'email',
    payload: { messaggio, smtp },
    stato: 'in_attesa',
    tentativi: 0,
    maxTentativi: opzioni?.maxTentativi ?? DEFAULT_MAX_TENTATIVI,
    backoffMs: opzioni?.backoffMs ?? DEFAULT_BACKOFF_MS,
    ultimoErrore: null,
    createdAt: new Date(),
    completatoAt: null,
  };

  codaJob.set(job.id, job);
  schedulaEsecuzione(job, 0, opzioni);
  return job;
}

/**
 * Accoda una notifica WhatsApp per l'invio asincrono in background.
 */
export function accodaNotificaWhatsApp(
  tenantId: string,
  credenziali: CredenzialiWhatsapp,
  numero: string,
  testo: string,
  opzioni?: OpzioniCoda,
): JobNotifica<WhatsAppJobPayload> {
  const job: JobNotifica<WhatsAppJobPayload> = {
    id: generaJobId(),
    tenantId,
    tipo: 'whatsapp',
    payload: { credenziali, numero, testo },
    stato: 'in_attesa',
    tentativi: 0,
    maxTentativi: opzioni?.maxTentativi ?? DEFAULT_MAX_TENTATIVI,
    backoffMs: opzioni?.backoffMs ?? DEFAULT_BACKOFF_MS,
    ultimoErrore: null,
    createdAt: new Date(),
    completatoAt: null,
  };

  codaJob.set(job.id, job);
  schedulaEsecuzione(job, 0, opzioni);
  return job;
}

function schedulaEsecuzione(job: JobNotifica<any>, delayMs: number, opzioni?: OpzioniCoda) {
  const timer = setTimeout(async () => {
    activeTimers.delete(timer);
    await eseguiJob(job, opzioni);
  }, delayMs);
  activeTimers.add(timer);
}

async function eseguiJob(job: JobNotifica<any>, opzioni?: OpzioniCoda): Promise<void> {
  job.stato = 'in_corso';
  job.tentativi += 1;

  let successo = false;
  let erroreMsg: string | null = null;

  try {
    if (job.tipo === 'email') {
      const { messaggio, smtp } = job.payload as EmailJobPayload;
      const fn = opzioni?.inviaEmailFn || inviaEmail;
      const esito = await fn(messaggio, smtp);
      if (esito.ok) {
        successo = true;
      } else {
        erroreMsg = esito.errore || 'Errore durante invio email';
      }
    } else if (job.tipo === 'whatsapp') {
      const { credenziali, numero, testo } = job.payload as WhatsAppJobPayload;
      const fn = opzioni?.inviaWhatsAppFn || inviaTestoWhatsapp;
      const esito = await fn(credenziali, numero, testo);
      if (esito.ok) {
        successo = true;
      } else {
        erroreMsg = esito.errore || 'Errore durante invio WhatsApp';
      }
    }
  } catch (err: any) {
    erroreMsg = err?.message || String(err);
  }

  if (successo) {
    job.stato = 'completato';
    job.completatoAt = new Date();
    job.ultimoErrore = null;
    return;
  }

  // Se fallito
  job.ultimoErrore = erroreMsg;

  if (job.tentativi < job.maxTentativi) {
    // Calcola il delay di backoff per il prossimo tentativo
    const backoffIndex = Math.min(job.tentativi - 1, job.backoffMs.length - 1);
    const delayMs = job.backoffMs[backoffIndex] ?? 1000;
    job.stato = 'in_attesa';
    schedulaEsecuzione(job, delayMs, opzioni);
  } else {
    // Esauriti i tentativi
    job.stato = 'fallito';
    job.completatoAt = new Date();

    // Registra audit log persistente
    try {
      await recordAudit({
        tenantId: job.tenantId,
        azione: 'ERRORE_DISPATCH_NOTIFICA',
        entita: job.id,
        dettagli: `Fallito dispatch notifica ${job.tipo.toUpperCase()} dopo ${job.tentativi} tentativi: ${job.ultimoErrore}`,
      });
    } catch {
      // Non sollevare se l'audit log fallisce
    }
  }
}

/**
 * Restituisce lo stato attuale di un job dato il suo ID.
 */
export function getJobStato(id: string): JobNotifica<any> | null {
  return codaJob.get(id) || null;
}

/**
 * Restituisce i job registrati per un tenant.
 */
export function getJobsPerTenant(tenantId: string): JobNotifica<any>[] {
  return Array.from(codaJob.values()).filter((j) => j.tenantId === tenantId);
}

/**
 * Utilità per i test: svuota tutti i job e cancella i timer pendenti.
 */
export function svuotaCodaPerTest(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  codaJob.clear();
}

/**
 * Utilità per i test: attende che non vi siano job in stato 'in_attesa' o 'in_corso'.
 */
export async function attendiCodaVuota(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pendenti = Array.from(codaJob.values()).filter(
      (j) => j.stato === 'in_attesa' || j.stato === 'in_corso',
    );
    if (pendenti.length === 0) return;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('Timeout durante attesa completamento coda notifiche');
}
