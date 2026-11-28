// Titolare, 28/11/2026 — un cliente nuovo parte «non valutato», non «medio» né «basso».
import { describe, expect, it } from 'vitest';
import { ETICHETTE_RISCHIO_AML, RISCHIO_AML_NON_VALUTATO, rischioAmlDichiarato } from './rischioAml.js';

describe('rischio AML dell’anagrafica', () => {
  it('senza una classe scritta è «non valutato», non una classe inventata', () => {
    expect(rischioAmlDichiarato()).toBe(RISCHIO_AML_NON_VALUTATO);
    expect(rischioAmlDichiarato(null, undefined, '', '   ')).toBe('non_valutato');
  });

  it('una classe già scritta resta quella: prima la colonna, poi la copia storica', () => {
    expect(rischioAmlDichiarato('alto', 'basso')).toBe('alto');
    expect(rischioAmlDichiarato(null, 'medio')).toBe('medio');
    expect(rischioAmlDichiarato('non_valutato', 'basso')).toBe('non_valutato');
  });

  it('ogni classe ha la sua etichetta', () => {
    expect(ETICHETTE_RISCHIO_AML.non_valutato).toBe('Non valutato');
    expect(Object.keys(ETICHETTE_RISCHIO_AML)).toEqual(['non_valutato', 'basso', 'medio', 'alto']);
  });
});
