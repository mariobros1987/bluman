import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generaPasswordTemporanea } from './password.js';

describe('hashPassword / verifyPassword', () => {
  it('verifica correttamente la password giusta', () => {
    const stored = hashPassword('correcthorsebatterystaple');
    expect(verifyPassword('correcthorsebatterystaple', stored)).toBe(true);
  });

  it('rifiuta una password sbagliata', () => {
    const stored = hashPassword('correcthorsebatterystaple');
    expect(verifyPassword('password-sbagliata', stored)).toBe(false);
  });

  it('due hash della stessa password sono diversi (salt casuale)', () => {
    const a = hashPassword('stessa-password');
    const b = hashPassword('stessa-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('stessa-password', a)).toBe(true);
    expect(verifyPassword('stessa-password', b)).toBe(true);
  });

  it('rifiuta un valore stored malformato invece di lanciare un errore', () => {
    expect(verifyPassword('qualsiasi', 'valore-senza-due-punti')).toBe(false);
    expect(verifyPassword('qualsiasi', '')).toBe(false);
  });
});

describe('generaPasswordTemporanea', () => {
  it('genera valori diversi ad ogni chiamata', () => {
    const a = generaPasswordTemporanea();
    const b = generaPasswordTemporanea();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
  });
});
