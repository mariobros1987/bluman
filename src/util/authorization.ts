import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from './jwt.js';

export const RUOLI = [
  'super_admin',
  'advisor',
  'collaboratore_interno',
  'collaboratore_esterno',
  'cliente',
] as const;

export type Ruolo = (typeof RUOLI)[number];
export type RuoloStaff = Exclude<Ruolo, 'cliente'>;

export function ruoloValido(valore: unknown): valore is Ruolo {
  return typeof valore === 'string' && (RUOLI as readonly string[]).includes(valore);
}

export function haRuolo(
  richiesta: Pick<FastifyRequest, 'ruolo'>,
  ruoliConsentiti: readonly Ruolo[],
): boolean {
  return ruoloValido(richiesta.ruolo) && ruoliConsentiti.includes(richiesta.ruolo);
}

export function richiediRuolo(
  richiesta: Pick<FastifyRequest, 'ruolo'>,
  risposta: FastifyReply,
  ruoliConsentiti: readonly Ruolo[],
): boolean {
  if (haRuolo(richiesta, ruoliConsentiti)) return true;
  risposta.code(403).send({ errore: 'Non autorizzato.' });
  return false;
}

/** Identità cliente derivata esclusivamente dal JWT emesso dal server. */
export function clienteIdDalJwt(payload: JwtPayload | null | undefined): string | null {
  if (payload?.ruolo !== 'cliente') return null;
  const prefisso = 'client-';
  if (!payload.userId.startsWith(prefisso) || payload.userId.length === prefisso.length) return null;
  return payload.userId.slice(prefisso.length);
}

/**
 * Route che un JWT cliente può raggiungere. Tutto ciò che non compare qui è negato,
 * anche se è una route autenticata valida per lo staff.
 */
export const ROTTE_CLIENTE_CONSENTITE = new Set<string>([
  'GET /auth/me',
  'POST /portal/change-password',
  'GET /clienti/:id',
  'GET /portal/contatti',
  'GET /portal/fatture',
  'GET /portal/proposte-dati',
  'POST /portal/proposte-dati',
  'GET /portal/addendum',
  'POST /portal/addendum',
  'GET /portal/documenti',
  'GET /portal/documenti/:id/download',
  'POST /portal/documenti/:id/richiesta-modifica',
  'GET /portal/canali-firma',
  'POST /portal/request-otp',
  'POST /portal/verify-otp-and-sign',
  'POST /portal/firma-con-file',
  'GET /firme',
  'GET /firme/:id/grafometrica',
  'GET /firme/:id/marca-temporale',
  'GET /progetti',
  'GET /progetti/:id',
  'GET /progetti/:id/comunicazioni',
  'POST /progetti/:id/comunicazioni',
  'PATCH /progetti/:id/comunicazioni/segna-lette',
  'GET /notifiche',
  'PATCH /notifiche/read-all',
  'GET /stream',
]);

export function rottaConsentitaAlCliente(metodo: string, pattern: string): boolean {
  return ROTTE_CLIENTE_CONSENTITE.has(`${metodo.toUpperCase()} ${pattern}`);
}
