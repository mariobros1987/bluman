import { describe, it, expect } from 'vitest';
import { etichettaFaseModulo, faseModulo } from './faseModulo';

describe('fase di un modulo nel portale', () => {
  it('un modulo mai iniziato non è «in lavorazione»', () => {
    expect(etichettaFaseModulo(faseModulo('pending'), 0)).toBe('Da iniziare');
  });
  it('un modulo che aspetta un altro modulo lo dice', () => {
    expect(etichettaFaseModulo(faseModulo('attesa_dipendenza'), 0)).toBe("Inizia dopo un'altra fase");
  });
  it('in corso con la percentuale del server; ritardo e blocco restano «in corso» come prima', () => {
    expect(etichettaFaseModulo(faseModulo('in_progress'), 40)).toBe('In corso (40%)');
    expect(etichettaFaseModulo(faseModulo('delayed'), 40)).toBe('In corso (40%)');
    expect(etichettaFaseModulo(faseModulo('blocked'), 10)).toBe('In corso (10%)');
  });
  it('concluso', () => {
    expect(faseModulo('done')).toBe('completato');
    expect(etichettaFaseModulo('completato', 100)).toBe('Completato');
  });
});
