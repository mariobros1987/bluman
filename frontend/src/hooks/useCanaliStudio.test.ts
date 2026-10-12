// §7 — le linee dello studio accanto a ogni canale. WhatsApp, email e Signal mostravano due
// recapiti scritti in duro (`+39 378 092 6461`, `comunicazioni@bluecode.advisory`): un numero che
// non è dello studio e un indirizzo su un dominio che non esiste, presentati come i contatti da
// dare al cliente. Senza dato la riga è vuota — come già si era deciso per il bot Telegram.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../api/client', () => ({
  // `null` = il server non ha risposto: il hook scende alla lettura locale, che nei test è vuota.
  fetchTenantInfoApi: vi.fn().mockResolvedValue(null),
}));

import { useCanaliStudio } from './useCanaliStudio';

describe('useCanaliStudio — nessun recapito inventato', () => {
  beforeEach(() => localStorage.clear());

  it('senza anagrafica e senza risposta del server le righe restano vuote', async () => {
    const { result } = renderHook(() => useCanaliStudio());

    await waitFor(() => expect(result.current).toBeTruthy());

    expect(result.current.whatsapp).toBe('');
    expect(result.current.signal).toBe('');
    expect(result.current.email).toBe('');
    // I due valori che c'erano scritti in duro, per nome.
    expect(result.current.whatsapp).not.toBe('+39 378 092 6461');
    expect(result.current.email).not.toBe('comunicazioni@bluecode.advisory');
  });
});
