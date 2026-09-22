/**
 * Motore di rischio KYC (§4). Puro: si testa senza database. I test difendono l'albero della spec
 * — un solo trigger «rafforzato» basta — e i mesi di validità per livello (24/12/6).
 */
import { describe, it, expect } from 'vitest';
import { calcolaRischioKyc, mesiValiditaKyc, calcolaScadenzaKyc } from './domain/kycEngine.js';

describe('calcolaRischioKyc', () => {
  it('cliente PA → verifica semplificata, rischio basso, punteggio 0', () => {
    const r = calcolaRischioKyc({ tipoCliente: 'PA' });
    expect(r.livelloVerifica).toBe('semplificata');
    expect(r.rischioCalcolato).toBe('basso');
    expect(r.punteggioRischio).toBe(0);
  });

  it('nessun fattore → ordinaria, basso', () => {
    const r = calcolaRischioKyc({ tipoCliente: 'company' });
    expect(r.livelloVerifica).toBe('ordinaria');
    expect(r.rischioCalcolato).toBe('basso');
    expect(r.punteggioRischio).toBe(0);
  });

  it('PEP → rafforzata e rischio alto', () => {
    const r = calcolaRischioKyc({ tipoCliente: 'individual', pep: true });
    expect(r.livelloVerifica).toBe('rafforzata');
    expect(r.rischioCalcolato).toBe('alto');
    expect(r.motivazioni.join(' ')).toContain('PEP');
  });

  it('paese ad alto rischio (match case-insensitive) → rafforzata', () => {
    const r = calcolaRischioKyc({ paeseResidenza: 'Panama', paesiAltoRischio: ['panama', 'iran'] });
    expect(r.livelloVerifica).toBe('rafforzata');
    expect(r.punteggioRischio).toBe(40);
  });

  it('operazione oltre soglia → rafforzata; sotto soglia → ordinaria', () => {
    expect(calcolaRischioKyc({ valoreOperazioneCent: 2_000_000, sogliaOperazioneCent: 1_500_000 }).livelloVerifica).toBe('rafforzata');
    expect(calcolaRischioKyc({ valoreOperazioneCent: 1_000_000, sogliaOperazioneCent: 1_500_000 }).livelloVerifica).toBe('ordinaria');
  });

  it('senza presenza fisica senza SPID → rafforzata; con SPID → ordinaria', () => {
    expect(calcolaRischioKyc({ senzaPresenzaFisica: true }).livelloVerifica).toBe('rafforzata');
    expect(calcolaRischioKyc({ senzaPresenzaFisica: true, identificatoConSpidOCie: true }).livelloVerifica).toBe('ordinaria');
  });

  it('più fattori sommano il punteggio (PEP + paese = 90, alto)', () => {
    const r = calcolaRischioKyc({ pep: true, paeseResidenza: 'iran', paesiAltoRischio: ['iran'] });
    expect(r.punteggioRischio).toBe(90);
    expect(r.rischioCalcolato).toBe('alto');
  });
});

describe('validità e scadenza del fascicolo (§4.2)', () => {
  it('mesi per livello: semplificata 24, ordinaria 12, rafforzata 6', () => {
    expect(mesiValiditaKyc('semplificata')).toBe(24);
    expect(mesiValiditaKyc('ordinaria')).toBe(12);
    expect(mesiValiditaKyc('rafforzata')).toBe(6);
  });
  it('calcolaScadenzaKyc somma i mesi giusti alla data di verifica', () => {
    const scad = calcolaScadenzaKyc('rafforzata', new Date('2026-01-15T00:00:00.000Z'));
    expect(scad.getUTCMonth()).toBe(6); // gennaio (0) + 6 = luglio (6)
  });
});
