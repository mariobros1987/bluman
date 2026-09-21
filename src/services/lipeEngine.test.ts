import { describe, it, expect } from 'vitest';
import { calcolaLiquidazioneIvaPeriodo, determinaPeriodoFiscale } from './lipeEngine.js';

// Test aggiunti con l'audit 21/09/2026: prima il motore LIPE non esisteva in test ed
// escludeva le note di credito, sovrastimando l'IVA a debito su operazioni stornate.

const F = (imponibile: number, iva: number, extra: Partial<any> = {}) => ({
  totaleImponibileCentesimi: imponibile,
  totaleIvaCentesimi: iva,
  tipoDocumento: 'fattura',
  ...extra,
});
const NC = (imponibile: number, iva: number, extra: Partial<any> = {}) => ({
  totaleImponibileCentesimi: imponibile,
  totaleIvaCentesimi: iva,
  tipoDocumento: 'nota_credito',
  ...extra,
});

describe('calcolaLiquidazioneIvaPeriodo — note di credito e stati', () => {
  it('la Nota di Credito SOTTRAE dall\'IVA a debito (storno stesso periodo → 0)', () => {
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000), NC(100000, 22000)],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(0);
    expect(r.totaleImponibileVenditeCent).toBe(0);
    expect(r.saldoIvaCent).toBe(0);
    expect(r.stato).toBe('a_pareggio');
  });

  it('senza la NC il debito è pieno (regressione: prova che la NC conta davvero)', () => {
    const r = calcolaLiquidazioneIvaPeriodo('2026-09', [F(100000, 22000)], [], 0);
    expect(r.ivaDebitoCent).toBe(22000);
    expect(r.importoDaVersareCent).toBe(22000);
  });

  it('la fattura annullata concorre nel suo periodo (lo storno lo fa la NC nel suo)', () => {
    // Fattura di settembre annullata; la NC cade in ottobre → settembre resta a debito pieno.
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [F(100000, 22000, { stato: 'annullata' })],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
  });

  it('esclude bozze e split payment dal debito', () => {
    const r = calcolaLiquidazioneIvaPeriodo(
      '2026-09',
      [
        F(100000, 22000),
        F(50000, 11000, { stato: 'bozza' }),
        F(30000, 6600, { esigibilitaIva: 'split' }),
      ],
      [],
      0,
    );
    expect(r.ivaDebitoCent).toBe(22000);
  });

  it('sottrae l\'IVA a credito degli acquisti e riporta il credito', () => {
    const r = calcolaLiquidazioneIvaPeriodo('2026-09', [F(100000, 22000)], [{ imponibileCentesimi: 200000, ivaCentesimi: 44000 }], 0);
    expect(r.saldoIvaCent).toBe(22000 - 44000);
    expect(r.stato).toBe('credito');
    expect(r.creditoRiportabileCent).toBe(22000);
  });

  it('determinaPeriodoFiscale gestisce mensile e trimestrale', () => {
    expect(determinaPeriodoFiscale('2026-09').codicePeriodo).toBe('2026-09');
    expect(determinaPeriodoFiscale('2026-Q3').codicePeriodo).toBe('2026-Q3');
  });
});
