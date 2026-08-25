// Hashing password — §23. Uso scrypt di node:crypto invece di bcrypt/argon2 per evitare
// una dipendenza con binding nativi da compilare (rischio aggiuntivo in ambienti dove,
// come si è visto con Prisma, i download di rete possono essere bloccati). scrypt è
// considerato sicuro per questo uso ed è parte della libreria standard di Node — nessuna
// installazione, nessun binario da scaricare.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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

/**
 * Confronto a tempo costante per token/secret di configurazione (es. verify token
 * dei webhook). A differenza di `===`, il tempo di esecuzione non dipende da quanti
 * caratteri iniziali coincidono, quindi un attaccante non può ricostruire il valore
 * un carattere alla volta misurando i tempi di risposta.
 *
 * Entrambi i valori vengono prima ridotti con SHA-256: questo normalizza la
 * lunghezza (timingSafeEqual richiede buffer di dimensione uguale) ed evita di
 * rivelare la lunghezza del secret atteso tramite differenze di timing.
 */
export function confrontoTokenCostante(tokenFornito: string | null | undefined, tokenAtteso: string): boolean {
  if (!tokenFornito || !tokenAtteso) return false;
  const a = createHash('sha256').update(tokenFornito).digest();
  const b = createHash('sha256').update(tokenAtteso).digest();
  return timingSafeEqual(a, b);
}
