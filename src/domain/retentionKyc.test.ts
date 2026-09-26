/**
 * K9 — presidio delle regole pure della conservazione/retention (spec §5.4/§8.9). Nessun DB.
 */
import { describe, it, expect } from 'vitest';
import {
  dataScadenzaRetention,
  giorniAllaScadenzaRetention,
  retentionConclusa,
  retentionDovuta,
  puoRegistrareEsitoRetention,
  motivoRetention,
} from './retentionKyc.js';

describe('K9 — retentionKyc (regole pure §5.4/§8.9)', () => {
  it('dataScadenzaRetention: chiusoAt + retentionYears', () => {
    const s = dataScadenzaRetention('2020-06-15T00:00:00Z', 5);
    expect(s?.toISOString().slice(0, 10)).toBe('2025-06-15');
  });

  it('senza chiusura non c’è scadenza (il termine parte dalla fine del rapporto)', () => {
    expect(dataScadenzaRetention(null, 5)).toBeNull();
  });

  it('la proroga sposta in avanti la scadenza ma non la accorcia mai', () => {
    const base = dataScadenzaRetention('2020-01-01T00:00:00Z', 5); // 2025-01-01
    expect(base?.toISOString().slice(0, 10)).toBe('2025-01-01');
    // proroga più avanti → vince
    const prorogata = dataScadenzaRetention('2020-01-01T00:00:00Z', 5, '2026-01-01T00:00:00Z');
    expect(prorogata?.toISOString().slice(0, 10)).toBe('2026-01-01');
    // proroga più indietro → ignorata (non si accorcia)
    const nonAccorciata = dataScadenzaRetention('2020-01-01T00:00:00Z', 5, '2024-01-01T00:00:00Z');
    expect(nonAccorciata?.toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('retentionConclusa solo con un esito valorizzato', () => {
    expect(retentionConclusa(null)).toBe(false);
    expect(retentionConclusa('')).toBe(false);
    expect(retentionConclusa('cancellato')).toBe(true);
    expect(retentionConclusa('anonimizzato')).toBe(true);
  });

  it('retentionDovuta entro il preavviso o già scaduta, mai se conclusa', () => {
    const oggi = new Date('2025-06-01T00:00:00Z');
    // scaduta 10 giorni fa
    expect(retentionDovuta('2025-05-22T00:00:00Z', null, oggi)).toBe(true);
    // entro 60 giorni
    expect(retentionDovuta('2025-07-15T00:00:00Z', null, oggi)).toBe(true);
    // oltre il preavviso
    expect(retentionDovuta('2026-01-01T00:00:00Z', null, oggi)).toBe(false);
    // conclusa → mai dovuta
    expect(retentionDovuta('2025-05-22T00:00:00Z', 'cancellato', oggi)).toBe(false);
    // fascicolo non chiuso → nessuna scadenza → non dovuta
    expect(retentionDovuta(null, null, oggi)).toBe(false);
  });

  it('puoRegistrareEsitoRetention SOLO a scadenza raggiunta e non già conclusa (§8.9)', () => {
    const oggi = new Date('2025-06-01T00:00:00Z');
    // scaduta → si può registrare
    expect(puoRegistrareEsitoRetention('2025-05-01T00:00:00Z', null, oggi)).toBe(true);
    // scade oggi → si può
    expect(puoRegistrareEsitoRetention('2025-06-01T00:00:00Z', null, oggi)).toBe(true);
    // non ancora scaduta → NO (nessuna cancellazione fisica prima)
    expect(puoRegistrareEsitoRetention('2025-07-01T00:00:00Z', null, oggi)).toBe(false);
    // già conclusa → NO
    expect(puoRegistrareEsitoRetention('2025-05-01T00:00:00Z', 'anonimizzato', oggi)).toBe(false);
  });

  it('motivoRetention: frasi esplicative (regola 12)', () => {
    const oggi = new Date('2025-06-01T00:00:00Z');
    expect(motivoRetention('2025-05-01T00:00:00Z', null, oggi)).toContain('scaduta');
    expect(motivoRetention('2025-07-15T00:00:00Z', null, oggi)).toContain('scadenza tra');
    expect(motivoRetention('2030-01-01T00:00:00Z', null, oggi)).toContain('In conservazione fino');
    expect(motivoRetention('2025-05-01T00:00:00Z', 'cancellato', oggi)).toContain('cancellazione');
    expect(motivoRetention('2025-05-01T00:00:00Z', 'anonimizzato', oggi)).toContain('anonimizzazione');
    expect(motivoRetention(null, null, oggi)).toBe('');
  });
});
