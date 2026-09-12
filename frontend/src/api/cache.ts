/**
 * BluMan API Cache & Request De-duplication Layer
 *
 * Risolve la latenza percepita nel frontend:
 * 1. Cache in-memory con TTL configurabile (default 30s per liste, 2 min per metadati/team).
 * 2. Deduplicazione delle richieste concorrenti: se due o più componenti chiedono la stessa
 *    risorsa contemporaneamente (es. useTeamMembers o fetchProgetti), parte una sola chiamata HTTP
 *    e tutti i componenti condividono la stessa Promise.
 * 3. Invalidazione selettiva su mutazioni (creazione, aggiornamento, cancellazione di risorse).
 * 4. Azzeramento immediato al cambio di tenant o logout per garantire il rigoroso isolamento multi-tenant.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const inFlightRequests = new Map<string, Promise<any>>();

export interface CacheOptions {
  /** Tempo di validità della cache in millisecondi. Default: 30.000 ms (30 secondi) */
  ttlMs?: number;
  /** Se true, ignora la cache ed esegue una chiamata di rete forzata */
  forceRefresh?: boolean;
}

/**
 * Esegue una query con deduplicazione automatica e caching in memoria.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const ttl = options.ttlMs ?? 30_000;
  const now = Date.now();

  // 1. Se presente in cache e ancora fresca, restituisci immediatamente (0ms)
  if (!options.forceRefresh && cache.has(key)) {
    const entry = cache.get(key)!;
    if (now - entry.timestamp < ttl) {
      return entry.data;
    }
  }

  // 2. Se una richiesta identica è già in volo, riutilizza la stessa Promise (deduplicazione)
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)!;
  }

  // 3. Esegui la fetch di rete e memorizza il risultato
  const promise = fetcher()
    .then((data) => {
      if (data !== null && data !== undefined) {
        cache.set(key, { data, timestamp: Date.now() });
      }
      return data;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Invalida le voci della cache che contengono il pattern specificato (stringa o RegExp).
 * Se omesso, svuota completamente l'intera cache.
 */
export function invalidateCache(pattern?: string | RegExp): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (typeof pattern === 'string') {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    } else if (pattern.test(key)) {
      cache.delete(key);
    }
  }
}

/**
 * Registra listener per azzerare la cache al cambio tenant o logout
 */
if (typeof window !== 'undefined') {
  window.addEventListener('tenant_changed', () => invalidateCache());
  window.addEventListener('bluman_unauthorized', () => invalidateCache());
}
