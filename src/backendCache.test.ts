// src/backendCache.test.ts
// §Cache Backend & Redis — Test per la cache multi-layer e il client Redis distribuito.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  leggiDaCacheOCalcola,
  invalidaCachePrefisso,
  resetCacheLocale,
} from './services/backendCache.js';
import { getRedisClient } from './util/redis.js';

describe('§Cache Backend & Redis distribuito', () => {
  beforeEach(() => {
    resetCacheLocale();
  });

  it('getRedisClient restituisce null in modalità test senza lanciare eccezioni', () => {
    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('leggiDaCacheOCalcola memorizza il risultato e non richiama la funzione calcola al secondo accesso', async () => {
    let contatoreChiamate = 0;
    const calcola = async () => {
      contatoreChiamate++;
      return [{ id: '1', nome: 'Italia' }];
    };

    const primo = await leggiDaCacheOCalcola('test:giurisdizioni:tenant1', calcola, 60);
    expect(primo).toEqual([{ id: '1', nome: 'Italia' }]);
    expect(contatoreChiamate).toBe(1);

    // Secondo accesso: deve venire da cache
    const secondo = await leggiDaCacheOCalcola('test:giurisdizioni:tenant1', calcola, 60);
    expect(secondo).toEqual([{ id: '1', nome: 'Italia' }]);
    expect(contatoreChiamate).toBe(1); // Non incrementato!
  });

  it('invalidaCachePrefisso invalida selettivamente le chiavi con il prefisso dato', async () => {
    let contatoreA = 0;
    let contatoreB = 0;

    await leggiDaCacheOCalcola('prefissoA:key1', async () => {
      contatoreA++;
      return 'valoreA';
    });
    await leggiDaCacheOCalcola('prefissoB:key2', async () => {
      contatoreB++;
      return 'valoreB';
    });

    expect(contatoreA).toBe(1);
    expect(contatoreB).toBe(1);

    // Invalida solo prefissoA
    await invalidaCachePrefisso('prefissoA');

    // Chiamata A deve ricalcolare
    await leggiDaCacheOCalcola('prefissoA:key1', async () => {
      contatoreA++;
      return 'valoreA_nuovo';
    });
    expect(contatoreA).toBe(2);

    // Chiamata B deve essere ancora in cache
    await leggiDaCacheOCalcola('prefissoB:key2', async () => {
      contatoreB++;
      return 'valoreB_nuovo';
    });
    expect(contatoreB).toBe(1);
  });

  it('leggiDaCacheOCalcola ricalcola se la voce è scaduta (TTL)', async () => {
    let contatore = 0;
    const calcola = async () => {
      contatore++;
      return 'dato_fresco';
    };

    // TTL di 0 secondi (scade subito)
    await leggiDaCacheOCalcola('test:chiave_scaduta', calcola, -1);
    expect(contatore).toBe(1);

    // Prossima lettura deve ricalcolare
    await leggiDaCacheOCalcola('test:chiave_scaduta', calcola, 60);
    expect(contatore).toBe(2);
  });
});
