// Hashing password — §23. Uso scrypt di node:crypto invece di bcrypt/argon2 per evitare
// una dipendenza con binding nativi da compilare (rischio aggiuntivo in ambienti dove,
// come si è visto con Prisma, i download di rete possono essere bloccati). scrypt è
// considerato sicuro per questo uso ed è parte della libreria standard di Node — nessuna
// installazione, nessun binario da scaricare.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

/** Restituisce una stringa "salt:hash" da salvare nel campo password dell'utente. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

/** Confronto a tempo costante — non usare mai `===` su hash di password. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidato = scryptSync(password, salt, KEYLEN);
  if (candidato.length !== hashBuffer.length) return false;
  return timingSafeEqual(candidato, hashBuffer);
}

/** Password temporanea leggibile ma non banale, per il bootstrap (§27) — mai per un utente normale. */
export function generaPasswordTemporanea(): string {
  return randomBytes(12).toString('base64url'); // 16 caratteri circa, url-safe
}
