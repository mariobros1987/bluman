// Analisi del 26/11, F3 — i filtri della Libreria erano un elenco fisso: «IP & Tax» c'era anche
// senza nessun articolo di quella categoria, e premendolo la pagina restava bianca.
import { describe, it, expect } from 'vitest';
import { categorieDegliArticoli } from './categorieArticoli';

describe('categorieDegliArticoli', () => {
  it('solo le categorie presenti, nell’ordine consueto, con «TUTTI» per primo', () => {
    expect(categorieDegliArticoli([{ cat: 'Banking' }, { cat: 'Analisi' }, { cat: 'Banking' }])).toEqual(['TUTTI', 'Analisi', 'Banking']);
  });

  it('una categoria senza articoli non ha un filtro', () => {
    expect(categorieDegliArticoli([{ cat: 'Societario' }])).not.toContain('IP & Tax');
  });

  it('una categoria nuova, fuori dall’elenco consueto, ha il suo filtro in coda', () => {
    expect(categorieDegliArticoli([{ cat: 'Zeta' }, { cat: 'Immobiliare' }, { cat: 'Trust' }])).toEqual(['TUTTI', 'Trust', 'Immobiliare', 'Zeta']);
  });

  it('libreria vuota o categorie mancanti → resta solo «TUTTI»', () => {
    expect(categorieDegliArticoli([])).toEqual(['TUTTI']);
    expect(categorieDegliArticoli([{ cat: '' }, { cat: null }, {}])).toEqual(['TUTTI']);
  });
});
