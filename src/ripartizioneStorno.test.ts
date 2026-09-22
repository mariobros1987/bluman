/**
 * `ripartisciStornoScadenze` — la matematica di una Nota di Credito PARZIALE sulle rate aperte.
 *
 * La proprietà che conta e che questi test difendono: la somma delle riduzioni è ESATTAMENTE lo
 * storno effettivo (il minore fra importo richiesto e residuo totale). Un centesimo perso o
 * inventato qui è un credito verso il cliente sbagliato — è la ragione del recupero del resto
 * d'arrotondamento sulla rata più capiente.
 */
import { describe, expect, it } from 'vitest';
import { ripartisciStornoScadenze } from './services/fatturaEngine.js';

const somma = (arr: { riduzioneCentesimi: number }[]) => arr.reduce((a, b) => a + b.riduzioneCentesimi, 0);

describe('ripartisciStornoScadenze', () => {
  it('storno che copre tutto il residuo aperto azzera ogni rata', () => {
    const r = ripartisciStornoScadenze([{ id: 'a', residuoCentesimi: 5000 }, { id: 'b', residuoCentesimi: 5000 }], 10000);
    expect(r.every((x) => x.azzerata && x.nuovoResiduoCentesimi === 0)).toBe(true);
    expect(somma(r)).toBe(10000);
  });

  it('storno oltre il residuo è limitato al residuo totale (nessun over-storno)', () => {
    const r = ripartisciStornoScadenze([{ id: 'a', residuoCentesimi: 3000 }], 99999);
    expect(somma(r)).toBe(3000);
    expect(r[0]?.azzerata).toBe(true);
  });

  it('ripartizione proporzionale su rate uguali', () => {
    const r = ripartisciStornoScadenze([{ id: 'a', residuoCentesimi: 5000 }, { id: 'b', residuoCentesimi: 5000 }], 4000);
    expect(r.find((x) => x.id === 'a')?.riduzioneCentesimi).toBe(2000);
    expect(r.find((x) => x.id === 'b')?.riduzioneCentesimi).toBe(2000);
    expect(somma(r)).toBe(4000);
  });

  it('il resto d’arrotondamento non perde né inventa centesimi (somma esatta)', () => {
    const residui: Record<string, number> = { a: 3333, b: 3333, c: 3334 };
    const r = ripartisciStornoScadenze(
      [{ id: 'a', residuoCentesimi: 3333 }, { id: 'b', residuoCentesimi: 3333 }, { id: 'c', residuoCentesimi: 3334 }],
      5000,
    );
    expect(somma(r)).toBe(5000);
    expect(r.every((x) => x.riduzioneCentesimi <= (residui[x.id] ?? 0))).toBe(true);
  });

  it('una rata già saldata (residuo 0) non assorbe storno ed è esclusa', () => {
    const r = ripartisciStornoScadenze([{ id: 'pagata', residuoCentesimi: 0 }, { id: 'aperta', residuoCentesimi: 1000 }], 500);
    expect(r.find((x) => x.id === 'pagata')).toBeUndefined();
    expect(r.find((x) => x.id === 'aperta')?.riduzioneCentesimi).toBe(500);
    expect(somma(r)).toBe(500);
  });

  it('storno zero non riduce nulla', () => {
    const r = ripartisciStornoScadenze([{ id: 'a', residuoCentesimi: 1000 }], 0);
    expect(somma(r)).toBe(0);
    expect(r[0]?.azzerata).toBe(false);
  });
});
