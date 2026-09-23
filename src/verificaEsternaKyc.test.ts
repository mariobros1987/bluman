/**
 * KYC §5.5.2 — lo stub dei provider esterni non deve MAI inventare dati (regola 7): finché nessun
 * fornitore è collegato, dichiara «non disponibile / non eseguito», così a valle «UBO assente» non
 * si confonde con «UBO verificato e vuoto».
 */
import { describe, it, expect } from 'vitest';
import { ProviderVerificaStub, providerVerificaCorrente } from './services/verificaEsternaKyc.js';

describe('ProviderVerificaEsterna (stub)', () => {
  it('recuperaUboDaPiva dichiara non disponibile, non un UBO finto', async () => {
    const r = await new ProviderVerificaStub().recuperaUboDaPiva('IT12345678901');
    expect(r.disponibile).toBe(false);
    expect(r.ubo).toBeNull();
    expect(r.fonte).toBe('autodichiarazione');
  });

  it('screeningPepListe dichiara non eseguito, non un "tutto pulito" fasullo', async () => {
    const r = await new ProviderVerificaStub().screeningPepListe('Mario Rossi', 'IT');
    expect(r.eseguito).toBe(false);
    expect(r.pep).toBe(false);
    expect(r.corrispondenzeListe).toEqual([]);
  });

  it('providerVerificaCorrente restituisce un provider utilizzabile', () => {
    const p = providerVerificaCorrente();
    expect(typeof p.recuperaUboDaPiva).toBe('function');
    expect(typeof p.screeningPepListe).toBe('function');
  });
});
