// Analisi del 26/11, F1 — le dipendenze fra moduli non si vedevano: «Attesa dipendenza» non diceva
// da cosa, i moduli non erano in ordine e le frecce del grafo seguivano l'ordine dell'elenco.
import { describe, it, expect } from 'vitest';
import { fraseAttesa, livelliPerDipendenza, ordinaPerLivello } from './dipendenzeModuli';

const dip = (...ids: string[]) => ids.map((id) => ({ dipendeDaModuloProgettoId: id }));

describe('livelliPerDipendenza', () => {
  it('chi non dipende da nessuno è al livello 0, chi dipende viene dopo', () => {
    const livelli = livelliPerDipendenza([
      { id: 'corporate', dipendenze: dip('analisi') },
      { id: 'analisi', dipendenze: [] },
      { id: 'banca', dipendenze: dip('corporate') },
    ]);
    expect(Object.fromEntries(livelli)).toEqual({ analisi: 0, corporate: 1, banca: 2 });
  });

  it('con più dipendenze conta la più lontana', () => {
    const livelli = livelliPerDipendenza([
      { id: 'a' }, { id: 'b', dipendenze: dip('a') }, { id: 'c', dipendenze: dip('a', 'b') },
    ]);
    expect(livelli.get('c')).toBe(2);
  });

  it('una dipendenza verso un modulo che non è nel progetto si ignora', () => {
    expect(livelliPerDipendenza([{ id: 'a', dipendenze: dip('altrove') }]).get('a')).toBe(0);
  });

  it('un ciclo non blocca la pagina', () => {
    const livelli = livelliPerDipendenza([{ id: 'a', dipendenze: dip('b') }, { id: 'b', dipendenze: dip('a') }]);
    expect(livelli.size).toBe(2);
  });
});

describe('ordinaPerLivello', () => {
  it('prima i moduli da cui gli altri dipendono; a parità resta l’ordine di partenza', () => {
    const moduli = [{ n: 'Corporate', l: 1 }, { n: 'Analisi', l: 0 }, { n: 'Trust', l: 0 }, { n: 'Banca', l: 2 }];
    expect(ordinaPerLivello(moduli, (m) => m.l).map((m) => m.n)).toEqual(['Analisi', 'Trust', 'Corporate', 'Banca']);
  });
});

describe('fraseAttesa', () => {
  it('nomina solo i moduli non ancora chiusi', () => {
    expect(fraseAttesa([{ nome: 'Analisi', fatto: false }, { nome: 'KYC', fatto: true }])).toBe('In attesa di: «Analisi»');
  });

  it('niente da attendere → stringa vuota', () => {
    expect(fraseAttesa([])).toBe('');
    expect(fraseAttesa(undefined)).toBe('');
    expect(fraseAttesa([{ nome: 'Analisi', fatto: true }])).toBe('');
  });
});
