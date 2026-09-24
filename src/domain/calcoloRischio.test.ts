/**
 * Presidio del rischio a 4 pilastri (K3). Difende: worst-case (il più alto vince), completezza
 * (serve motivazione su ogni pilastro), verifica rafforzata sul rischio alto, cadenza di revisione.
 */
import { describe, it, expect } from 'vitest';
import { livelloComplessivo, assessmentCompleto, livelloVerificaDaRischio, mesiRevisioneRischio, type Pilastri } from './calcoloRischio.js';

const bassi: Pilastri = { cliente: 'basso', geografia: 'basso', prodotto: 'basso', canale: 'basso' };

describe('livelloComplessivo (worst-case)', () => {
  it('tutti bassi → basso', () => expect(livelloComplessivo(bassi)).toBe('basso'));
  it('un solo pilastro alto → alto', () => {
    expect(livelloComplessivo({ ...bassi, geografia: 'alto' })).toBe('alto');
  });
  it('il più alto vince (medio + basso → medio)', () => {
    expect(livelloComplessivo({ ...bassi, cliente: 'medio' })).toBe('medio');
  });
  it('alto batte medio', () => {
    expect(livelloComplessivo({ cliente: 'medio', geografia: 'medio', prodotto: 'alto', canale: 'basso' })).toBe('alto');
  });
});

describe('assessmentCompleto', () => {
  it('completo con tutte e 4 le motivazioni', () => {
    expect(assessmentCompleto({ cliente: 'a', geografia: 'b', prodotto: 'c', canale: 'd' })).toBe(true);
  });
  it('incompleto se manca (o è vuota) una motivazione', () => {
    expect(assessmentCompleto({ cliente: 'a', geografia: '', prodotto: 'c', canale: 'd' })).toBe(false);
    expect(assessmentCompleto({ cliente: 'a', prodotto: 'c', canale: 'd' })).toBe(false);
  });
});

describe('verifica e revisione', () => {
  it('alto → rafforzata, altrimenti ordinaria', () => {
    expect(livelloVerificaDaRischio('alto')).toBe('rafforzata');
    expect(livelloVerificaDaRischio('medio')).toBe('ordinaria');
    expect(livelloVerificaDaRischio('basso')).toBe('ordinaria');
  });
  it('mesi revisione: alto 6 / medio 12 / basso 24', () => {
    expect(mesiRevisioneRischio('alto')).toBe(6);
    expect(mesiRevisioneRischio('medio')).toBe(12);
    expect(mesiRevisioneRischio('basso')).toBe(24);
  });
});
