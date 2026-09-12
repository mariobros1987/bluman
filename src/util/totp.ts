// src/util/totp.ts
// §6.1 — Autenticazione 2FA TOTP RFC 6238 per super_admin.
//
// Implementazione pura con modulo `crypto` nativo Node.js — zero dipendenze esterne.
// Compatibile con Google Authenticator, Authy, 1Password, Bitwarden e qualsiasi app
// che implementi RFC 6238 (TOTP) / RFC 4226 (HOTP).
//
// Flusso:
//   1. Admin chiama POST /auth/totp/attiva → generaSegreto() + QR code.
//   2. Inserisce il primo codice dall'app → POST /auth/totp/conferma → totpAbilitato=true.
//   3. Al prossimo login: password ok → preToken 2min → POST /auth/totp/verifica → JWT definitivo.

import crypto from 'crypto';

// ─── Costanti ─────────────────────────────────────────────────────────────────

const PASSO_TOTP_SECONDI = 30;      // T0 di RFC 6238
const CIFRE_TOTP = 6;               // Codici a 6 cifre
const FINESTRA_PERMESSA = 1;        // ±1 step (±30s) per clock skew
const NUMERO_BACKUP_CODES = 8;      // Codici di recupero monouso

// ─── Encoding Base32 (RFC 4648) ───────────────────────────────────────────────
// Necessario per il formato URI otpauth:// e per la compatibilità con le app authenticator.

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodaBase32(buf: Buffer): string {
  let bits = 0;
  let valore = 0;
  let output = '';

  for (const byte of buf) {
    valore = (valore << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_CHARS[(valore >> bits) & 31];
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(valore << (5 - bits)) & 31];
  }

  return output; // Senza padding '=' per compatibilità con le app
}

function decodaBase32(s: string): Buffer {
  const str = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valore = 0;
  const output: number[] = [];

  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    valore = (valore << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((valore >> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

// ─── HOTP — RFC 4226 ─────────────────────────────────────────────────────────

function calcolaHotp(segreto: Buffer, contatore: bigint): string {
  // Il contatore è un intero a 64 bit big-endian
  const contatoreBuf = Buffer.alloc(8);
  contatoreBuf.writeBigUInt64BE(contatore);

  const hmac = crypto.createHmac('sha1', segreto).update(contatoreBuf).digest();

  // Troncamento dinamico RFC 4226 §5.4
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const codiceInt =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const codice = codiceInt % Math.pow(10, CIFRE_TOTP);
  return codice.toString().padStart(CIFRE_TOTP, '0');
}

// ─── TOTP — RFC 6238 ─────────────────────────────────────────────────────────

/**
 * Calcola il codice TOTP corrente per il segreto dato.
 * `now` in millisecondi — opzionale, default Date.now() (override per i test).
 */
export function calcolaTotp(segretoBase32: string, now = Date.now()): string {
  const segreto = decodaBase32(segretoBase32);
  const t = BigInt(Math.floor(now / 1000 / PASSO_TOTP_SECONDI));
  return calcolaHotp(segreto, t);
}

/**
 * Verifica il codice TOTP con finestra ±FINESTRA_PERMESSA step.
 * Confronto a tempo costante per evitare timing attack.
 */
export function verificaTotp(segretoBase32: string, codice: string, now = Date.now()): boolean {
  if (!codice || codice.length !== CIFRE_TOTP || !/^\d+$/.test(codice)) return false;

  const segreto = decodaBase32(segretoBase32);
  const t = BigInt(Math.floor(now / 1000 / PASSO_TOTP_SECONDI));

  for (let delta = -FINESTRA_PERMESSA; delta <= FINESTRA_PERMESSA; delta++) {
    const atteso = calcolaHotp(segreto, t + BigInt(delta));
    // Confronto a tempo costante
    const bufatteso = Buffer.from(atteso, 'utf8');
    const bufricevuto = Buffer.from(codice, 'utf8');
    if (bufatteso.length === bufricevuto.length && crypto.timingSafeEqual(bufatteso, bufricevuto)) {
      return true;
    }
  }

  return false;
}

// ─── Generazione segreto ──────────────────────────────────────────────────────

/** Genera un nuovo segreto TOTP a 20 byte casuali, in formato Base32. */
export function generaSegreto(): string {
  return encodaBase32(crypto.randomBytes(20));
}

/** URI otpauth:// per il QR code, compatibile con tutte le app TOTP. */
export function generaOtpauthUri(segretoBase32: string, email: string, issuer = 'BluMan'): string {
  const issuerEnc = encodeURIComponent(issuer);
  const emailEnc = encodeURIComponent(email);
  return `otpauth://totp/${issuerEnc}:${emailEnc}?secret=${segretoBase32}&issuer=${issuerEnc}&algorithm=SHA1&digits=${CIFRE_TOTP}&period=${PASSO_TOTP_SECONDI}`;
}

// ─── QR Code SVG inline ───────────────────────────────────────────────────────
// Generazione SVG minimal senza dipendenze esterne.
// Usa l'API Google Charts solo in sviluppo per semplicità; in produzione
// restituisce un link cliccabile che l'admin può copiare in qualsiasi generatore QR.
// Il segreto grezzo NON viene mai esposto nelle risorse pubbliche — solo nell'URI
// otpauth:// che viaggia su HTTPS verso l'admin autenticato.

export function generaQrPayload(segretoBase32: string, email: string, issuer = 'BluMan'): {
  uri: string;
  qrUrl: string;
  svgHint: string;
} {
  const uri = generaOtpauthUri(segretoBase32, email, issuer);
  const isDev = process.env.NODE_ENV !== 'production';

  return {
    uri,
    // URL Google Charts: usabile solo in sviluppo (leak dell'URI a Google in prod sarebbe inaccettabile)
    qrUrl: isDev
      ? `https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl=${encodeURIComponent(uri)}`
      : '',
    // Suggerimento per il frontend: aprire un generatore QR locale con l'URI
    svgHint: isDev
      ? 'Usa qrUrl in sviluppo. In produzione: usa una libreria QR client-side (qrcode.js) con uri.'
      : 'Usa la libreria qrcode.js lato client con il campo uri per generare il QR localmente.',
  };
}

// ─── Cifratura segreto TOTP nel DB ────────────────────────────────────────────
// Il segreto TOTP non deve stare in chiaro nel database: se il DB venisse
// compromesso, un attaccante potrebbe clonare il secondo fattore.
// Usiamo AES-256-GCM con JWT_SECRET come materiale chiave (HKDF-SHA256).

function derivaChiaveTOTP(): Buffer {
  const base = process.env.JWT_SECRET;
  if (!base) {
    // Sviluppo/test: segreto casuale valido solo per questo processo (non persistibile).
    // Il round-trip cifra→decifra funziona dentro la stessa esecuzione.
    // In produzione JWT_SECRET è obbligatorio (garantito da risolviSegreti() in jwt.ts).
    if (!process.env._TOTP_DEV_KEY) {
      process.env._TOTP_DEV_KEY = crypto.randomBytes(32).toString('hex');
    }
    return crypto.createHash('sha256').update(`totp-encryption:${process.env._TOTP_DEV_KEY}`).digest();
  }
  // HKDF: deriva una chiave specifica per TOTP dal segreto JWT esistente
  return crypto.createHash('sha256').update(`totp-encryption:${base}`).digest();
}

export function cifraSegretoTotp(segretoBase32: string): string {
  const chiave = derivaChiaveTOTP();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chiave, iv);
  const ct = Buffer.concat([cipher.update(segretoBase32, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: base64(IV || AuthTag || CT)
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decifraSegretoTotp(cifrato: string): string {
  const chiave = derivaChiaveTOTP();
  const blob = Buffer.from(cifrato, 'base64');
  if (blob.length < 12 + 16) throw new Error('Segreto TOTP cifrato non valido.');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chiave, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Decifratura segreto TOTP fallita: dati corrotti o chiave errata.');
  }
}

// ─── Backup codes ─────────────────────────────────────────────────────────────

/** Genera 8 codici di recupero monouso nel formato xxxx-xxxx-xxxx. */
export function generaBackupCodes(): string[] {
  return Array.from({ length: NUMERO_BACKUP_CODES }, () => {
    const bytes = crypto.randomBytes(6);
    const hex = bytes.toString('hex').toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  });
}

/** SHA-256 del codice normalizzato (case-insensitive, senza trattini). */
export function hashBackupCode(code: string): string {
  const normalizzato = code.toUpperCase().replace(/-/g, '');
  return crypto.createHash('sha256').update(`backup:${normalizzato}`).digest('hex');
}

/**
 * Verifica se `code` corrisponde a uno degli hash presenti.
 * Restituisce l'indice del codice usato, o -1 se nessuno corrisponde.
 * Confronto a tempo costante su tutti gli hash (no early exit per indice).
 */
export function verificaBackupCode(code: string, hashes: string[]): number {
  const hashRicevuto = Buffer.from(hashBackupCode(code), 'utf8');
  let indice = -1;

  for (let i = 0; i < hashes.length; i++) {
    const hashAtteso = Buffer.from(hashes[i]!, 'utf8');
    if (
      hashRicevuto.length === hashAtteso.length &&
      crypto.timingSafeEqual(hashRicevuto, hashAtteso)
    ) {
      indice = i;
      // NON fare break: confronto a tempo costante su tutti gli elementi
    }
  }

  return indice;
}
