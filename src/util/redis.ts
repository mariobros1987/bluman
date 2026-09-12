// src/util/redis.ts
// §4.2 — Client Redis distribuito per rate limiting e caching.
//
// Supporta Railway Redis e qualsiasi istanza Redis compatibile tramite REDIS_URL.
// Se REDIS_URL non è valorizzata (sviluppo locale standard o ambiente di test),
// restituisce null per consentire il fallback aggraziato in-memory (zero configurazione).

import { Redis } from 'ioredis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  // In ambiente di test standard evitiamo connessioni verso server esterni
  if (process.env.NODE_ENV === 'test' && !process.env.FORCE_TEST_REDIS) {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  if (!redisClient) {
    try {
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        retryStrategy(times) {
          if (times > 5) {
            console.warn('⚠️ [Redis] Raggiunto limite massimo tentativi riconnessione (5). Fallback in-memory attivo.');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });

      redisClient.on('error', (err) => {
        console.warn('⚠️ [Redis] Errore connessione Redis:', err?.message || err);
      });

      redisClient.on('connect', () => {
        console.log('🔌 [Redis] Connesso con successo al server Redis distribuito.');
      });
    } catch (err) {
      console.warn('⚠️ [Redis] Inizializzazione client Redis non riuscita:', err);
      return null;
    }
  }

  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
  }
}
