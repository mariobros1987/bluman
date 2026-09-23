/**
 * KYC K0 — la logica pura: la modalità bozza e la catena hash degli eventi di compliance.
 * Difende due proprietà: senza profilo O senza MLRO si resta in bozza; e l'hash di un evento
 * cambia se cambia il contenuto o l'anello precedente (una manomissione retroattiva rompe la catena).
 */
import { describe, it, expect } from 'vitest';
import { modalitaBozza, calcolaHashEvento, verificaCatena } from './services/complianceService.js';

describe('modalitaBozza', () => {
  it('è bozza senza settings, senza profilo o senza MLRO', () => {
    expect(modalitaBozza(null)).toBe(true);
    expect(modalitaBozza({ regulatoryProfile: null, mlroUserId: 'u1' })).toBe(true);
    expect(modalitaBozza({ regulatoryProfile: 'CSP_MFSA', mlroUserId: null })).toBe(true);
  });
  it('non è bozza con profilo E MLRO', () => {
    expect(modalitaBozza({ regulatoryProfile: 'CSP_MFSA', mlroUserId: 'u1' })).toBe(false);
  });
});

describe('calcolaHashEvento', () => {
  const base = { tipo: 'X', payload: { a: 1 }, createdAt: '2026-09-23T10:00:00.000Z', hashPrecedente: null };
  it('è deterministico', () => {
    expect(calcolaHashEvento(base)).toBe(calcolaHashEvento({ ...base }));
  });
  it('cambia se cambia il payload (tamper-evident)', () => {
    expect(calcolaHashEvento(base)).not.toBe(calcolaHashEvento({ ...base, payload: { a: 2 } }));
  });
  it('cambia se cambia l’anello precedente (catena)', () => {
    expect(calcolaHashEvento(base)).not.toBe(calcolaHashEvento({ ...base, hashPrecedente: 'abc' }));
  });
});

describe('verificaCatena', () => {
  // Costruisce una catena valida di `n` eventi, ognuno agganciato all'hash del precedente.
  const catenaValida = (n: number) => {
    const eventi: Array<{ tipo: string; payload: unknown; createdAt: string; hashPrecedente: string | null; hash: string }> = [];
    let precedente: string | null = null;
    for (let i = 0; i < n; i++) {
      const tipo = 'COMPLIANCE_SETTINGS_AGGIORNATE';
      const payload = { versione: i + 1 };
      const createdAt = `2026-09-23T10:0${i}:00.000Z`;
      const hash = calcolaHashEvento({ tipo, payload, createdAt, hashPrecedente: precedente });
      eventi.push({ tipo, payload, createdAt, hashPrecedente: precedente, hash });
      precedente = hash;
    }
    return eventi;
  };

  it('una catena vuota è integra', () => {
    expect(verificaCatena([])).toEqual({ integra: true, rotturaIndice: null });
  });
  it('una catena ben formata è integra', () => {
    expect(verificaCatena(catenaValida(3))).toEqual({ integra: true, rotturaIndice: null });
  });
  it('rileva la manomissione del payload di un evento (hash non ricalcola)', () => {
    const eventi = catenaValida(3);
    eventi[1] = { ...eventi[1]!, payload: { versione: 999 } };
    expect(verificaCatena(eventi)).toEqual({ integra: false, rotturaIndice: 1 });
  });
  it('rileva un anello che non punta al predecessore (evento rimosso/inserito)', () => {
    const eventi = catenaValida(3);
    eventi[2] = { ...eventi[2]!, hashPrecedente: 'anello-spezzato' };
    expect(verificaCatena(eventi)).toEqual({ integra: false, rotturaIndice: 2 });
  });
  it('il primo evento deve avere hashPrecedente null', () => {
    const eventi = catenaValida(1);
    eventi[0] = { ...eventi[0]!, hashPrecedente: 'non-null' };
    expect(verificaCatena(eventi)).toEqual({ integra: false, rotturaIndice: 0 });
  });
});
