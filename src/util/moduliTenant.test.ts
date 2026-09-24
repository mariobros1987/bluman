/**
 * Presidio dell'attivazione moduli per-studio (due livelli). Difende la regola: attivo = concesso E
 * non disattivato; e la tolleranza ai valori JSON malformati che possono arrivare dal DB.
 */
import { describe, it, expect } from 'vitest';
import { moduloAttivoPerTenant, moduloConcessoAlTenant, MODULO_KYC } from './moduliTenant.js';

describe('moduloAttivoPerTenant', () => {
  it('attivo se concesso e non disattivato', () => {
    expect(moduloAttivoPerTenant(['kyc'], [], 'kyc')).toBe(true);
    expect(moduloAttivoPerTenant(['kyc'], null, MODULO_KYC)).toBe(true);
  });
  it('spento se disattivato dallo studio, anche se concesso', () => {
    expect(moduloAttivoPerTenant(['kyc'], ['kyc'], 'kyc')).toBe(false);
  });
  it('spento se non concesso dalla piattaforma', () => {
    expect(moduloAttivoPerTenant([], [], 'kyc')).toBe(false);
    expect(moduloAttivoPerTenant(null, null, 'kyc')).toBe(false);
  });
  it('tollera JSON malformato dal DB (non-array) trattandolo come vuoto', () => {
    expect(moduloAttivoPerTenant('kyc' as unknown, null, 'kyc')).toBe(false);
    expect(moduloAttivoPerTenant({ kyc: true } as unknown, null, 'kyc')).toBe(false);
  });
});

describe('moduloConcessoAlTenant', () => {
  it('distingue «concesso ma spento» da «non concesso»', () => {
    expect(moduloConcessoAlTenant(['kyc'], 'kyc')).toBe(true); // lo studio può riaccenderlo
    expect(moduloConcessoAlTenant([], 'kyc')).toBe(false); // niente da accendere finché non concesso
  });
});
