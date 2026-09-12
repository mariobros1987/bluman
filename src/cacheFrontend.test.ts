import { describe, it, expect, vi } from 'vitest';

/**
 * Test suite per il modulo di caching e deduplicazione richieste in-memory del frontend.
 * Replica e valida la logica cruda implementata in `frontend/src/api/cache.ts`.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();

  async cachedQuery<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { ttlMs?: number; forceRefresh?: boolean } = {}
  ): Promise<T> {
    const ttl = options.ttlMs ?? 30_000;
    const now = Date.now();

    if (!options.forceRefresh && this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      if (now - entry.timestamp < ttl) {
        return entry.data;
      }
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const promise = fetcher()
      .then((data) => {
        if (data !== null && data !== undefined) {
          this.cache.set(key, { data, timestamp: Date.now() });
        }
        return data;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  invalidateCache(pattern?: string | RegExp): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (typeof pattern === 'string') {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      } else if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  size(): number {
    return this.cache.size;
  }
}

describe('CacheManager & Request De-duplication', () => {
  it('restituisce i dati memorizzati in cache senza rieseguire il fetcher (0ms)', async () => {
    const manager = new CacheManager();
    const fetcher = vi.fn().mockResolvedValue([{ id: 1, nome: 'Progetto Test' }]);

    const res1 = await manager.cachedQuery('progetti_t1', fetcher, { ttlMs: 1000 });
    const res2 = await manager.cachedQuery('progetti_t1', fetcher, { ttlMs: 1000 });

    expect(res1).toEqual([{ id: 1, nome: 'Progetto Test' }]);
    expect(res2).toEqual([{ id: 1, nome: 'Progetto Test' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deduplica richieste simultanee in volo per la stessa chiave', async () => {
    const manager = new CacheManager();
    let risolvi: (val: any) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          risolvi = resolve;
        })
    );

    const promise1 = manager.cachedQuery('team_users', fetcher, { ttlMs: 5000 });
    const promise2 = manager.cachedQuery('team_users', fetcher, { ttlMs: 5000 });

    risolvi!(['utente1', 'utente2']);
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).toEqual(['utente1', 'utente2']);
    expect(res2).toEqual(['utente1', 'utente2']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('riesegue il fetcher con forceRefresh: true', async () => {
    const manager = new CacheManager();
    const fetcher = vi.fn().mockResolvedValue('dati');

    await manager.cachedQuery('chiave', fetcher);
    await manager.cachedQuery('chiave', fetcher, { forceRefresh: true });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalida selettivamente le chiavi corrispondenti al pattern', async () => {
    const manager = new CacheManager();
    const f1 = vi.fn().mockResolvedValue('p');
    const f2 = vi.fn().mockResolvedValue('c');

    await manager.cachedQuery('progetti_t1', f1);
    await manager.cachedQuery('clienti_t1', f2);

    expect(manager.size()).toBe(2);

    manager.invalidateCache('progett');

    expect(manager.has('progetti_t1')).toBe(false);
    expect(manager.has('clienti_t1')).toBe(true);

    manager.invalidateCache();
    expect(manager.size()).toBe(0);
  });
});
