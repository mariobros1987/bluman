import { describe, expect, it } from 'vitest';
import { spiegaCriterio } from './importiProposti';

describe('spiegaCriterio — la frase dice da dove viene l’importo proposto', () => {
  it('senza sconto: il prezzo del modulo è diverso dalla somma dei listini', () => {
    const { etichetta, spiegazione } = spiegaCriterio('proporzionale_listino', 'Contabilità');
    expect(etichetta).toBe('in proporzione al listino');
    expect(spiegazione).toContain('Il prezzo del modulo «Contabilità» è diverso dalla somma dei listini');
  });

  it('con uno sconto sul progetto: la differenza viene (anche) dallo sconto, e si dice', () => {
    const { spiegazione } = spiegaCriterio('proporzionale_listino', 'Contabilità', 150);
    expect(spiegazione).toContain('Il prezzo del modulo «Contabilità», tolto lo sconto del progetto, è diverso dalla somma dei listini');
  });

  it('il listino e le parti uguali non cambiano con lo sconto', () => {
    expect(spiegaCriterio('listino', 'Contabilità', 150)).toEqual(spiegaCriterio('listino', 'Contabilità'));
    expect(spiegaCriterio('parti_uguali', 'Contabilità', 150)).toEqual(spiegaCriterio('parti_uguali', 'Contabilità'));
  });
});
