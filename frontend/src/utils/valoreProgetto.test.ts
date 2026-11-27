// Analisi del 26/11, E10 — il dettaglio mostra il valore tenuto dal server, non una somma sua.
import { describe, it, expect } from 'vitest';
import { valoreProgettoEuroDaServer, valoreProgettoModificabile } from './valoreProgetto';

describe('valoreProgettoEuroDaServer', () => {
  it('valore a database in centesimi → euro', () => {
    expect(valoreProgettoEuroDaServer(330000, [{ p: 1800 }, { p: 1500 }])).toBe(3300);
  });

  it('il valore del server vince anche se la somma locale dei moduli è diversa', () => {
    expect(valoreProgettoEuroDaServer(250000, [{ p: 1800 }, { p: 1500 }])).toBe(2500);
  });

  it('progetto avviato prima (valore 0 a database, moduli col prezzo) → somma dei moduli', () => {
    expect(valoreProgettoEuroDaServer(0, [{ p: 1800 }, { p: 1500 }])).toBe(3300);
  });

  it('niente a database e niente moduli → 0, non un importo inventato', () => {
    expect(valoreProgettoEuroDaServer(undefined, [])).toBe(0);
    expect(valoreProgettoEuroDaServer(null, [{ p: null }])).toBe(0);
  });
});

describe('valoreProgettoModificabile', () => {
  it('con moduli il valore non si scrive a mano; senza, sì', () => {
    expect(valoreProgettoModificabile([{ id: 1 }])).toBe(false);
    expect(valoreProgettoModificabile([])).toBe(true);
    expect(valoreProgettoModificabile(undefined)).toBe(true);
  });
});
