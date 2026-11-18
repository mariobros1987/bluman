import { describe, expect, it } from 'vitest';
import { oggettoEmailCliente } from './oggettoEmailCliente';

describe('oggetto delle email al cliente', () => {
  it('porta il nome dello studio che scrive, non uno fisso', () => {
    expect(oggettoEmailCliente('Studio Verdi Srl', 'Rossi Spa')).toBe('Comunicazione Studio Verdi Srl — Fascicolo Rossi Spa');
    expect(oggettoEmailCliente('Studio Verdi Srl', 'Rossi Spa')).not.toMatch(/BlueCode/i);
  });

  it('senza cliente non inventa un fascicolo', () => {
    expect(oggettoEmailCliente(' Studio Verdi Srl ', '')).toBe('Comunicazione Studio Verdi Srl');
  });

  it('senza ragione sociale non c\'è oggetto: chi chiama non invia', () => {
    expect(oggettoEmailCliente('', 'Rossi Spa')).toBeNull();
    expect(oggettoEmailCliente(undefined, 'Rossi Spa')).toBeNull();
  });
});
