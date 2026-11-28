// La password di una casella deve tornare leggibile al server e a nessun altro.
import { describe, it, expect, afterEach } from 'vitest';
import { cifraSegreto, decifraSegreto } from './util/cifraturaSegreti.js';

const prima = { segreto: process.env.JWT_SECRET, precedenti: process.env.JWT_PREVIOUS_SECRETS };
afterEach(() => {
  if (prima.segreto === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prima.segreto;
  if (prima.precedenti === undefined) delete process.env.JWT_PREVIOUS_SECRETS; else process.env.JWT_PREVIOUS_SECRETS = prima.precedenti;
});

describe('cifraSegreto / decifraSegreto', () => {
  it('ciò che si cifra si riapre, e il valore cifrato non contiene il segreto', () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    const cifrato = cifraSegreto('pässword-della-casella', 'casella-posta');
    expect(cifrato.startsWith('v1:')).toBe(true);
    expect(cifrato).not.toContain('pässword');
    expect(decifraSegreto(cifrato, 'casella-posta')).toEqual({ chiaro: 'pässword-della-casella', daRicifrare: false });
  });

  it('due cifrature dello stesso valore sono diverse (IV casuale)', () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    expect(cifraSegreto('uguale', 'casella-posta')).not.toBe(cifraSegreto('uguale', 'casella-posta'));
  });

  it('un ambito diverso non lo apre', () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    const cifrato = cifraSegreto('segreto', 'casella-posta');
    expect(() => decifraSegreto(cifrato, 'altro-ambito')).toThrow(/va reinserito/);
  });

  it('dopo la rotazione di JWT_SECRET si apre con la chiave precedente e chiede di ricifrare', () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    const cifrato = cifraSegreto('segreto', 'casella-posta');
    process.env.JWT_SECRET = 'b'.repeat(40);
    process.env.JWT_PREVIOUS_SECRETS = 'a'.repeat(40);
    expect(decifraSegreto(cifrato, 'casella-posta')).toEqual({ chiaro: 'segreto', daRicifrare: true });
  });

  it('senza la chiave giusta solleva, non restituisce un segreto vuoto', () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    const cifrato = cifraSegreto('segreto', 'casella-posta');
    process.env.JWT_SECRET = 'c'.repeat(40);
    delete process.env.JWT_PREVIOUS_SECRETS;
    expect(() => decifraSegreto(cifrato, 'casella-posta')).toThrow(/va reinserito/);
    expect(() => decifraSegreto('testo-qualunque', 'casella-posta')).toThrow(/formato/);
  });
});
