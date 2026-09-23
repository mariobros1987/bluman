/**
 * KYC K0 — la logica pura: la modalità bozza e la catena hash degli eventi di compliance.
 * Difende due proprietà: senza profilo O senza MLRO si resta in bozza; e l'hash di un evento
 * cambia se cambia il contenuto o l'anello precedente (una manomissione retroattiva rompe la catena).
 */
import { describe, it, expect } from 'vitest';
import { modalitaBozza, calcolaHashEvento } from './services/complianceService.js';

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
