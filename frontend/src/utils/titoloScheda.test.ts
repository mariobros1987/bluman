// Analisi del 26/11, G2 — nell'indice dell'Aiuto il numero compariva due volte («08 08 · LIPE»).
import { describe, it, expect } from 'vitest';
import { titoloSenzaNumero } from './titoloScheda';

describe('titoloSenzaNumero', () => {
  it('toglie il numero già mostrato nel riquadro', () => {
    expect(titoloSenzaNumero('08', '08 · LIPE / Liquidazione IVA & F24')).toBe('LIPE / Liquidazione IVA & F24');
    expect(titoloSenzaNumero('22', '22 - Coda KYC')).toBe('Coda KYC');
  });

  it('un titolo senza numero davanti resta com’è', () => {
    expect(titoloSenzaNumero('08', 'Liquidazione IVA')).toBe('Liquidazione IVA');
  });

  it('un titolo fatto solo del numero non diventa vuoto', () => {
    expect(titoloSenzaNumero('08', '08')).toBe('08');
    expect(titoloSenzaNumero('08', '08 · ')).toBe('08 · ');
  });
});
