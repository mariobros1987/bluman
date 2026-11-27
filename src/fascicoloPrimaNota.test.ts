// Analisi del 26/11, E9 ed E11 — nel CSV di Prima Nota per il commercialista un movimento senza
// conto risultava in «Cassa Studio» e la fattura «FT-2026/001» diventava «FT FT/1».
import { describe, it, expect } from 'vitest';
import { CONTO_NON_INDICATO, nomeContoMovimento, riferimentoDocumentoMovimento } from './services/fascicoloPrimaNota.js';

describe('nomeContoMovimento', () => {
  it('movimento con conto → il nome del conto', () => {
    expect(nomeContoMovimento({ contoBancario: { nomeConto: 'Conto operativo' } })).toBe('Conto operativo');
  });

  it('movimento senza conto → lo dichiara, non inventa una cassa', () => {
    expect(nomeContoMovimento({ contoBancario: null })).toBe(CONTO_NON_INDICATO);
    expect(nomeContoMovimento({})).toBe(CONTO_NON_INDICATO);
    expect(nomeContoMovimento({ contoBancario: { nomeConto: '  ' } })).toBe(CONTO_NON_INDICATO);
    expect(CONTO_NON_INDICATO).not.toMatch(/cassa/i);
  });
});

describe('riferimentoDocumentoMovimento', () => {
  it('fattura emessa → il numero ufficiale, così com’è sul documento', () => {
    expect(riferimentoDocumentoMovimento({ fattura: { numero: 'FT-2026/001', serie: 'FT', numeroProgressivoSerie: 1 } })).toBe('FT-2026/001');
  });

  it('fattura senza numero ufficiale → serie e progressivo, senza «FT » davanti', () => {
    expect(riferimentoDocumentoMovimento({ fattura: { numero: null, serie: 'FT', numeroProgressivoSerie: 1 } })).toBe('FT/1');
  });

  it('fattura d’acquisto → il suo numero', () => {
    expect(riferimentoDocumentoMovimento({ fatturaRicevuta: { numero: 'A-77' } })).toBe('Fatt. Acquisto A-77');
  });

  it('movimento libero → nessun riferimento', () => {
    expect(riferimentoDocumentoMovimento({})).toBe('');
    expect(riferimentoDocumentoMovimento({ fattura: null, fatturaRicevuta: null })).toBe('');
  });
});
