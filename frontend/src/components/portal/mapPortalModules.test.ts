import { describe, it, expect } from 'vitest';
import { mapProjectToPortalModules, totaleModuli } from './mapPortalModules';
import { tabellaModuliLetteraHtml } from './tabellaModuliLettera';

/**
 * `ModuloProgetto.prezzo` è sempre in centesimi (schema Prisma, Int). Il mapper indovinava
 * l'unità con `prezzo > 1000 ? prezzo / 100 : prezzo`: un modulo da 9,99 € (999 centesimi)
 * diventava 999 € e finiva così nella lettera d'incarico che il cliente firma.
 */
function progetto(...prezzi: unknown[]) {
  return { id: 'p1', moduli: prezzi.map((prezzo, i) => ({ id: `m${i}`, nome: `Modulo ${i}`, categoria: 'Societario', prezzo })) };
}

describe('mapProjectToPortalModules — prezzo', () => {
  it('converte sempre da centesimi a euro', () => {
    const [a, b] = mapProjectToPortalModules(progetto(999, 150000));
    expect(a.prezzo).toBe(9.99);
    expect(b.prezzo).toBe(1500);
  });

  it('uno zero resta zero, un prezzo assente o non numerico è null', () => {
    const moduli = mapProjectToPortalModules(progetto(0, undefined, null, '999', Number.NaN));
    expect(moduli.map((m) => m.prezzo)).toEqual([0, null, null, null, null]);
  });
});

describe('totaleModuli', () => {
  it('somma solo i prezzi noti e dichiara il totale parziale', () => {
    expect(totaleModuli(mapProjectToPortalModules(progetto(999, 150000)))).toEqual({ totale: 1509.99, mancanti: 0 });
    expect(totaleModuli(mapProjectToPortalModules(progetto(999, undefined)))).toEqual({ totale: 9.99, mancanti: 1 });
  });
});

describe('tabellaModuliLetteraHtml', () => {
  it('stampa gli importi in euro con due decimali', () => {
    const moduli = mapProjectToPortalModules(progetto(999, 150000));
    const html = tabellaModuliLetteraHtml(moduli, totaleModuli(moduli));
    expect(html).toContain('€ 9,99');
    expect(html).toContain('€ 1.500,00');
    expect(html).toContain('€ 1.509,99');
    expect(html).not.toContain('999');
  });

  it('il modulo senza prezzo mostra il segnaposto e il totale è marcato parziale', () => {
    const moduli = mapProjectToPortalModules(progetto(999, undefined));
    const html = tabellaModuliLetteraHtml(moduli, totaleModuli(moduli));
    expect(html).toContain('[DATO MANCANTE: corrispettivo del modulo]');
    expect(html).toContain('€ 9,99 (parziale: 1 modulo senza corrispettivo)');
  });
});
