import { createHmac, timingSafeEqual } from 'node:crypto';

const FIRMA_WA = /^sha256=([a-f0-9]{64})$/i;
const SEGRETO_TG = /^([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/;

function ugualiCostanti(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verificaFirmaWhatsapp(
  rawBody: Buffer,
  firma: string | string[] | undefined,
  appSecret: string | undefined,
): 'ok' | 'secret_missing' | 'invalid' {
  if (!appSecret) return 'secret_missing';
  const valore = Array.isArray(firma) ? firma[0] : firma;
  const match = valore?.match(FIRMA_WA);
  const digestHex = match?.[1];
  if (!digestHex) return 'invalid';
  const attesa = createHmac('sha256', appSecret).update(rawBody).digest();
  const fornita = Buffer.from(digestHex, 'hex');
  return ugualiCostanti(fornita, attesa) ? 'ok' : 'invalid';
}

function uuidCompatto(tenantId: string): string {
  return tenantId.replaceAll('-', '').toLowerCase();
}

export function tenantIdDaSegretoTelegram(secret: string | string[] | undefined): string | null {
  const valore = Array.isArray(secret) ? secret[0] : secret;
  const match = valore?.match(SEGRETO_TG);
  const compatto = match?.[1];
  if (!compatto) return null;
  return `${compatto.slice(0, 8)}-${compatto.slice(8, 12)}-${compatto.slice(12, 16)}-${compatto.slice(16, 20)}-${compatto.slice(20)}`;
}

export function creaSegretoTelegram(tenantId: string, botToken: string, masterSecret: string): string {
  const tenant = uuidCompatto(tenantId);
  if (!/^[a-f0-9]{32}$/.test(tenant)) throw new Error('tenantId non valido per il secret Telegram');
  const mac = createHmac('sha256', masterSecret)
    .update(`telegram-webhook\0${tenantId}\0${botToken}`)
    .digest('base64url');
  return `${tenant}_${mac}`;
}

export function verificaSegretoTelegram(
  fornito: string | string[] | undefined,
  tenantId: string,
  botToken: string,
  masterSecret: string | undefined,
): 'ok' | 'secret_missing' | 'invalid' {
  if (!masterSecret) return 'secret_missing';
  const valore = Array.isArray(fornito) ? fornito[0] : fornito;
  if (!valore) return 'invalid';
  const atteso = creaSegretoTelegram(tenantId, botToken, masterSecret);
  return ugualiCostanti(Buffer.from(valore), Buffer.from(atteso)) ? 'ok' : 'invalid';
}

/** Normalizza solo forme equivalenti certe: +/00 e prefisso mobile italiano omesso. */
export function normalizzaTelefono(valore: unknown): string | null {
  if (typeof valore !== 'string') return null;
  let cifre = valore.trim().replace(/\D/g, '');
  if (cifre.startsWith('00')) cifre = cifre.slice(2);
  if (/^3\d{8,10}$/.test(cifre)) cifre = `39${cifre}`;
  return /^\d{8,15}$/.test(cifre) ? cifre : null;
}
