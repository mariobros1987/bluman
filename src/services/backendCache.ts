// src/services/backendCache.ts
// §Cache Backend — Cache multi-layer (memoria di processo + Redis) per dati ad alta frequenza
// di lettura e bassa frequenza di mutazione (giurisdizioni, moduli catalogo, articoli).
//
// Obiettivo: eliminare i 4 roundtrip PostgreSQL RLS (BEGIN + SET LOCAL + SELECT + COMMIT)
// per ogni richiesta di navigazione frontend, portando i tempi di risposta sotto 1ms.

import { getRedisClient } from '../util/redis.js';

interface CacheEntry<T> {
  valore: T;
  scadenzaMs: number;
}

const cacheLocale = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_SECONDI = 60; // 60 secondi

/**
 * Legge dalla cache in memoria locale; se assente prova Redis; se assente calcola dal DB
 * e popola sia la memoria locale che Redis con scadenza TTL.
 */
export async function leggiDaCacheOCalcola<T>(
  chiave: string,
  calcola: () => Promise<T>,
  ttlSecondi = DEFAULT_TTL_SECONDI,
): Promise<T> {
  const now = Date.now();
  const entry = cacheLocale.get(chiave);

  if (entry && entry.scadenzaMs > now) {
    return entry.valore as T;
  }

  // Tenta lettura da Redis se disponibile
  const redis = getRedisClient();
  if (redis) {
    try {
      const datiGrezzi = await redis.get(`cache:${chiave}`);
      if (datiGrezzi) {
        const parsed = JSON.parse(datiGrezzi) as T;
        cacheLocale.set(chiave, { valore: parsed, scadenzaMs: now + ttlSecondi * 1000 });
        return parsed;
      }
    } catch {
      // Fallback silenzioso se Redis ha un problema momentaneo
    }
  }

  // Calcolo dal database
  const risultato = await calcola();

  // Popola cache locale
  cacheLocale.set(chiave, { valore: risultato, scadenzaMs: now + ttlSecondi * 1000 });

  // Popola Redis se disponibile
  if (redis) {
    try {
      await redis.set(`cache:${chiave}`, JSON.stringify(risultato), 'EX', ttlSecondi);
    } catch {
      // Fallback silenzioso
    }
  }

  return risultato;
}

/**
 * Invalida tutte le chiavi che iniziano con un prefisso dato (es. 'giurisdizioni:tenant_123').
 */
export async function invalidaCachePrefisso(prefisso: string): Promise<void> {
  for (const k of cacheLocale.keys()) {
    if (k.startsWith(prefisso)) {
      cacheLocale.delete(k);
    }
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const keys = await redis.keys(`cache:${prefisso}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Fallback silenzioso
    }
  }
}

/**
 * Svuota interamente la cache in memoria (utilizzato principalmente nei test).
 */
export function resetCacheLocale(): void {
  cacheLocale.clear();
}
