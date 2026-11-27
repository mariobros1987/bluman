// Analisi del 26/11, E5 — il PDF della fattura scriveva «SDI: 0000000 | Sede: Italia» e
// «Pagamento: Bonifico 30 gg» anche quando il cliente e la fattura non dicevano niente del genere.
import { describe, it, expect } from 'vitest';
import { rigaPagamento, rigaSdiSedeCliente } from './services/pdfFatturaTesti.js';

describe('rigaSdiSedeCliente', () => {
  it('cliente senza codice SDI e senza sede → riga vuota, non «0000000» e «Italia»', () => {
    expect(rigaSdiSedeCliente({})).toBe('');
    expect(rigaSdiSedeCliente({ clienteSdiCode: ' ', clienteSede: null })).toBe('');
  });

  it('si scrive solo il dato che c’è', () => {
    expect(rigaSdiSedeCliente({ clienteSede: 'Sliema - Malta' })).toBe('Sede: Sliema - Malta');
    expect(rigaSdiSedeCliente({ clienteSdiCode: 'ABC1234' })).toBe('SDI: ABC1234');
    expect(rigaSdiSedeCliente({ clienteSdiCode: 'ABC1234', clienteSede: 'Via Roma 1 - Italia' })).toBe('SDI: ABC1234 | Sede: Via Roma 1 - Italia');
  });
});

describe('rigaPagamento', () => {
  it('condizioni non indicate → niente riga, non «Bonifico 30 gg»', () => {
    expect(rigaPagamento(undefined)).toBe('');
    expect(rigaPagamento('  ')).toBe('');
  });

  it('condizioni indicate → così come sono', () => {
    expect(rigaPagamento('Bonifico a vista')).toBe('Pagamento: Bonifico a vista');
  });
});
