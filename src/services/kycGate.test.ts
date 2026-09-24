/**
 * Presidio del gate operativo KYC (K4, §8.1): blocca senza pratica approvata, ma uno sblocco
 * motivato recente lascia passare (e uno vecchio no). Store finto, nessun DB.
 */
import { describe, it, expect } from 'vitest';
import { operativitaBloccataDaKyc, GIORNI_VALIDITA_OVERRIDE, type KycGateStore } from './kycGate.js';

function store(fascicolo: { id: string; stato: string } | null, override: { createdAt: Date } | null = null): KycGateStore {
  return {
    fascicoloKyc: { findFirst: async () => fascicolo },
    overrideKyc: { findFirst: async () => override },
  };
}

describe('operativitaBloccataDaKyc', () => {
  it('nessun fascicolo → non blocca', async () => {
    expect(await operativitaBloccataDaKyc(store(null), 't', 'c')).toMatchObject({ bloccato: false });
  });
  it('pratica approvata → non blocca', async () => {
    expect(await operativitaBloccataDaKyc(store({ id: 'f', stato: 'approvato' }), 't', 'c')).toMatchObject({ bloccato: false });
  });
  it('pratica non approvata senza override → blocca', async () => {
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'in_verifica' }), 't', 'c');
    expect(r).toMatchObject({ bloccato: true, stato: 'in_verifica', sbloccatoDaOverride: false });
  });
  it('override recente sblocca la pratica non approvata', async () => {
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'sospeso' }, { createdAt: new Date() }), 't', 'c');
    expect(r).toMatchObject({ bloccato: false, sbloccatoDaOverride: true });
  });
  it('override scaduto (oltre la finestra) torna a bloccare', async () => {
    const vecchio = new Date(Date.now() - (GIORNI_VALIDITA_OVERRIDE + 1) * 86_400_000);
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'sospeso' }, { createdAt: vecchio }), 't', 'c');
    expect(r).toMatchObject({ bloccato: true });
  });
});
