/**
 * Presidio della ricostruzione della catena di controllo (K2). Difende: quota effettiva = prodotto
 * lungo il percorso, somma su più percorsi, soglia, gestione dei cicli, quota sconosciuta che non
 * si inventa, e la scadenza a 14 giorni sulle variazioni.
 */
import { describe, it, expect } from 'vitest';
import { calcolaTitolariEffettivi, scadenzaVariazioneTe, type Legame } from './catenaControllo.js';

describe('calcolaTitolariEffettivi', () => {
  it('proprietà diretta oltre soglia', () => {
    const legami: Legame[] = [{ daId: 'PF1', aId: 'CLIENTE', percentuale: 60 }];
    expect(calcolaTitolariEffettivi(legami, 'CLIENTE', 25)).toEqual([{ soggettoId: 'PF1', percentualeEffettiva: 60 }]);
  });
  it('catena via holding: moltiplica le quote (100% * 30% = 30%)', () => {
    const legami: Legame[] = [
      { daId: 'HOLDING', aId: 'CLIENTE', percentuale: 30 },
      { daId: 'PF1', aId: 'HOLDING', percentuale: 100 },
    ];
    expect(calcolaTitolariEffettivi(legami, 'CLIENTE', 25)).toEqual([{ soggettoId: 'PF1', percentualeEffettiva: 30 }]);
  });
  it('esclude chi resta sotto soglia (100% * 20% = 20% < 25%)', () => {
    const legami: Legame[] = [
      { daId: 'HOLDING', aId: 'CLIENTE', percentuale: 20 },
      { daId: 'PF1', aId: 'HOLDING', percentuale: 100 },
    ];
    expect(calcolaTitolariEffettivi(legami, 'CLIENTE', 25)).toEqual([]);
  });
  it('somma la stessa persona su più percorsi (diretto 15% + via holding 15% = 30%)', () => {
    const legami: Legame[] = [
      { daId: 'PF1', aId: 'CLIENTE', percentuale: 15 },
      { daId: 'HOLDING', aId: 'CLIENTE', percentuale: 30 },
      { daId: 'PF1', aId: 'HOLDING', percentuale: 50 },
    ];
    expect(calcolaTitolariEffettivi(legami, 'CLIENTE', 25)).toEqual([{ soggettoId: 'PF1', percentualeEffettiva: 30 }]);
  });
  it('quota sconosciuta (null) non propaga e non si inventa', () => {
    const legami: Legame[] = [{ daId: 'PF1', aId: 'CLIENTE', percentuale: null }];
    expect(calcolaTitolariEffettivi(legami, 'CLIENTE', 25)).toEqual([]);
  });
  it('gestisce un ciclo (partecipazione incrociata) senza loop infinito', () => {
    const legami: Legame[] = [
      { daId: 'A', aId: 'CLIENTE', percentuale: 50 },
      { daId: 'B', aId: 'A', percentuale: 50 },
      { daId: 'A', aId: 'B', percentuale: 50 }, // ciclo A↔B
    ];
    const out = calcolaTitolariEffettivi(legami, 'CLIENTE', 10);
    expect(Array.isArray(out)).toBe(true); // non va in stack overflow
  });
});

describe('scadenzaVariazioneTe (§5.2)', () => {
  it('somma 14 giorni di default', () => {
    expect(scadenzaVariazioneTe(new Date('2026-09-01T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-15');
  });
});
