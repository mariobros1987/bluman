import { describe, it, expect } from 'vitest';
import { parseDataIso, inizioGiornoUtc, fineGiornoUtc, leggiIntervalloData, filtroData } from './util/intervalloData.js';

describe('intervalloData — parseDataIso', () => {
  it('accetta una data valida come mezzanotte UTC', () => {
    const d = parseDataIso('2026-09-27');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('respinge il formato sbagliato', () => {
    expect(parseDataIso('27/09/2026')).toBeNull();
    expect(parseDataIso('2026-9-7')).toBeNull();
    expect(parseDataIso('2026-09-27T10:00:00Z')).toBeNull();
    expect(parseDataIso('')).toBeNull();
    expect(parseDataIso(undefined)).toBeNull();
    expect(parseDataIso(null)).toBeNull();
  });

  it('respinge le date impossibili (niente overflow silenzioso del costruttore)', () => {
    expect(parseDataIso('2026-02-30')).toBeNull(); // febbraio non ha 30 giorni
    expect(parseDataIso('2026-13-01')).toBeNull(); // mese 13
    expect(parseDataIso('2026-00-10')).toBeNull(); // mese 0
    expect(parseDataIso('2026-04-31')).toBeNull(); // aprile ha 30 giorni
  });
});

describe('intervalloData — bordi giorno UTC', () => {
  it('inizioGiornoUtc porta a 00:00:00.000 e fineGiornoUtc a 23:59:59.999', () => {
    const istante = new Date('2026-09-27T14:33:12.500Z');
    expect(inizioGiornoUtc(istante).toISOString()).toBe('2026-09-27T00:00:00.000Z');
    expect(fineGiornoUtc(istante).toISOString()).toBe('2026-09-27T23:59:59.999Z');
  });
});

describe('intervalloData — leggiIntervalloData', () => {
  it('normalizza i due estremi a inizio/fine giorno', () => {
    const r = leggiIntervalloData('2026-01-01', '2026-12-31');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.presente).toBe(true);
    expect(r.intervallo.da!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.intervallo.a!.toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('lascia aperto il lato mancante o vuoto', () => {
    const soloDa = leggiIntervalloData('2026-01-01', undefined);
    expect(soloDa.ok && soloDa.intervallo.a).toBeNull();
    const soloA = leggiIntervalloData('', '2026-12-31');
    expect(soloA.ok && soloA.intervallo.da).toBeNull();
  });

  it('senza estremi non filtra (presente=false)', () => {
    const r = leggiIntervalloData(undefined, undefined);
    expect(r.ok && r.presente).toBe(false);
  });

  it('un estremo presente ma malformato è un errore', () => {
    expect(leggiIntervalloData('2026-02-30', undefined).ok).toBe(false);
    expect(leggiIntervalloData(undefined, 'ieri').ok).toBe(false);
  });
});

describe('intervalloData — filtroData (campo singolo)', () => {
  it('intervallo vuoto → undefined', () => {
    expect(filtroData({ da: null, a: null })).toBeUndefined();
  });

  it('solo da → { gte }, solo a → { lte }, entrambi → { gte, lte }', () => {
    const da = new Date('2026-01-01T00:00:00.000Z');
    const a = new Date('2026-12-31T23:59:59.999Z');
    expect(filtroData({ da, a: null })).toEqual({ gte: da });
    expect(filtroData({ da: null, a })).toEqual({ lte: a });
    expect(filtroData({ da, a })).toEqual({ gte: da, lte: a });
  });
});
