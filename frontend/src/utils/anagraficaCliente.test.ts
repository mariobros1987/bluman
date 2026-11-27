import { describe, it, expect } from 'vitest';
import { capitaleDaTesto, componiSedeLegale } from './anagraficaCliente';

describe('componiSedeLegale', () => {
  it('tutti i pezzi → una riga leggibile', () => {
    expect(componiSedeLegale({ indirizzo: 'Triq il-Kbira 12', citta: 'Sliema', cap: 'SLM 1600', nazione: 'Malta' })).toBe('Triq il-Kbira 12, Sliema (SLM 1600) - Malta');
  });

  it('campi vuoti → niente virgole, parentesi o trattini orfani', () => {
    expect(componiSedeLegale({})).toBe('');
    expect(componiSedeLegale({ indirizzo: ' ', citta: '', cap: '', nazione: '' })).toBe('');
    expect(componiSedeLegale({ citta: 'Milano' })).toBe('Milano');
    expect(componiSedeLegale({ indirizzo: 'Via Roma 1', nazione: 'Italia' })).toBe('Via Roma 1 - Italia');
  });
});

describe('capitaleDaTesto', () => {
  it('campo vuoto → null, non 10.000 e non 0', () => {
    expect(capitaleDaTesto('')).toBeNull();
    expect(capitaleDaTesto('   ')).toBeNull();
  });

  it('numero scritto → quel numero, zero compreso', () => {
    expect(capitaleDaTesto('1200')).toBe(1200);
    expect(capitaleDaTesto('0')).toBe(0);
  });

  it('testo che non è un numero, o negativo → null', () => {
    expect(capitaleDaTesto('abc')).toBeNull();
    expect(capitaleDaTesto('-5')).toBeNull();
  });
});
