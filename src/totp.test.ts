// src/totp.test.ts
// §6.1 — Test suite per l'implementazione TOTP RFC 6238 pura.

import { describe, it, expect } from 'vitest';
import {
  generaSegreto,
  calcolaTotp,
  verificaTotp,
  generaOtpauthUri,
  cifraSegretoTotp,
  decifraSegretoTotp,
  generaBackupCodes,
  hashBackupCode,
  verificaBackupCode,
} from './util/totp.js';

describe('§6.1 — TOTP RFC 6238 (implementazione nativa crypto)', () => {
  it('generaSegreto produce una stringa Base32 non vuota di lunghezza coerente', () => {
    const segreto = generaSegreto();
    // 20 byte → ceil(20*8/5) = 32 caratteri Base32 senza padding
    expect(segreto).toMatch(/^[A-Z2-7]+$/);
    expect(segreto.length).toBe(32);
    // Ogni chiamata produce un segreto diverso
    expect(generaSegreto()).not.toBe(segreto);
  });

  it('calcolaTotp produce un codice a 6 cifre numeriche', () => {
    const segreto = generaSegreto();
    const codice = calcolaTotp(segreto);
    expect(codice).toMatch(/^\d{6}$/);
  });

  it('verificaTotp accetta il codice corrente', () => {
    const segreto = generaSegreto();
    const now = Date.now();
    const codice = calcolaTotp(segreto, now);
    expect(verificaTotp(segreto, codice, now)).toBe(true);
  });

  it('verificaTotp accetta codici entro la finestra ±1 step (clock skew)', () => {
    const segreto = generaSegreto();
    const now = Date.now();
    // Codice calcolato 30 secondi fa (step precedente)
    const codicePassato = calcolaTotp(segreto, now - 30_000);
    expect(verificaTotp(segreto, codicePassato, now)).toBe(true);
    // Codice del prossimo step
    const codiceFuturo = calcolaTotp(segreto, now + 30_000);
    expect(verificaTotp(segreto, codiceFuturo, now)).toBe(true);
  });

  it('verificaTotp rifiuta codici fuori dalla finestra (>±1 step)', () => {
    const segreto = generaSegreto();
    const now = Date.now();
    // 2 step nel passato = 60 secondi fa
    const codiceTroppoVecchio = calcolaTotp(segreto, now - 60_000);
    expect(verificaTotp(segreto, codiceTroppoVecchio, now)).toBe(false);
  });

  it('verificaTotp rifiuta codici malformati', () => {
    const segreto = generaSegreto();
    expect(verificaTotp(segreto, '')).toBe(false);
    expect(verificaTotp(segreto, '12345')).toBe(false);   // 5 cifre
    expect(verificaTotp(segreto, '1234567')).toBe(false); // 7 cifre
    expect(verificaTotp(segreto, 'ABCDEF')).toBe(false);  // lettere
  });

  it('generaOtpauthUri produce un URI otpauth:// valido', () => {
    const segreto = generaSegreto();
    const uri = generaOtpauthUri(segreto, 'admin@studio.it', 'TestApp');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${segreto}`);
    expect(uri).toContain('issuer=TestApp');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('cifraSegretoTotp / decifraSegretoTotp: round-trip corretto', () => {
    const segreto = generaSegreto();
    const cifrato = cifraSegretoTotp(segreto);
    expect(cifrato).not.toBe(segreto); // È cifrato
    const recuperato = decifraSegretoTotp(cifrato);
    expect(recuperato).toBe(segreto);
  });

  it('decifraSegretoTotp lancia su dati corrotti', () => {
    const segreto = generaSegreto();
    const cifrato = cifraSegretoTotp(segreto);
    // Corrompe il base64
    const corrotto = cifrato.slice(0, -4) + 'XXXX';
    expect(() => decifraSegretoTotp(corrotto)).toThrow();
  });

  it('generaBackupCodes produce 8 codici nel formato xxxx-xxxx-xxxx', () => {
    const codes = generaBackupCodes();
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
    // Tutti diversi
    expect(new Set(codes).size).toBe(8);
  });

  it('verificaBackupCode trova il codice corretto e restituisce il suo indice', () => {
    const codes = generaBackupCodes();
    const hashes = codes.map(hashBackupCode);

    // Verifica il terzo codice (indice 2)
    expect(verificaBackupCode(codes[2]!, hashes)).toBe(2);
    // Un codice non presente restituisce -1
    expect(verificaBackupCode('FAKE-FAKE-FAKE', hashes)).toBe(-1);
  });

  it('verificaBackupCode è case-insensitive e ignora i trattini', () => {
    const codes = generaBackupCodes();
    const hashes = codes.map(hashBackupCode);

    // Minuscolo senza trattini
    const codeAlt = codes[0]!.toLowerCase().replace(/-/g, '');
    expect(verificaBackupCode(codeAlt, hashes)).toBe(0);
  });
});
