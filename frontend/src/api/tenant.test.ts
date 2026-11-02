// §7 — il confine fra «il server ha risposto» e «il server non ha risposto».
//
// Scambiare un ripiego per la risposta è il difetto che ha fatto apparire cinque collaboratori
// inesistenti e, nella pagina di amministrazione, studi cancellati dal database. F5: nemmeno
// senza risposta il seed dimostrativo torna — la squadra resta vuota.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./http', () => ({
  API_BASE: '/api',
  apiFetch: vi.fn(),
  getAuthHeaders: () => ({}),
  // Nel test l'errore del server è il messaggio di ripiego: così il testo verificato è nostro.
  leggiErroreApi: vi.fn(async (_res: unknown, ripiego: string) => ripiego),
}));

import { apiFetch } from './http';
import { fetchUtentiTenant, fetchAdminTenantsApi, fetchTenantInfoApi } from './tenant';
import { invalidateCache } from './cache';
import { BLUECODE_TENANT_ID } from '../utils/tenant';

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function risposta(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as any;
}

describe('fetchUtentiTenant — un elenco vuoto è una risposta, non un guasto', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    invalidateCache();
    localStorage.clear();
    // Lo studio attivo è Bluecode: è il tenant per cui esiste il seed dimostrativo.
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: BLUECODE_TENANT_ID }));
  });

  it('col database che risponde «nessun collaboratore» la lista resta vuota', async () => {
    mockApiFetch.mockResolvedValue(risposta([]));
    await expect(fetchUtentiTenant()).resolves.toEqual([]);
  });

  it('resta vuota anche se il database risponde zero e non ci sono utenti locali', async () => {
    mockApiFetch.mockResolvedValue(risposta([]));
    localStorage.setItem(`bluman_custom_team_users_tenant_${BLUECODE_TENANT_ID}`, JSON.stringify([]));
    const utenti = await fetchUtentiTenant({ forceRefresh: true });
    expect(utenti).toEqual([]);
  });

  it('gli utenti veri del database vincono sul seed', async () => {
    mockApiFetch.mockResolvedValue(risposta([{ id: 'u-1', email: 'collaboratore@studio.test' }]));
    await expect(fetchUtentiTenant({ forceRefresh: true })).resolves.toEqual([
      { id: 'u-1', email: 'collaboratore@studio.test' },
    ]);
  });

  it('col server irraggiungibile niente seed dimostrativo: la squadra resta vuota (F5)', async () => {
    mockApiFetch.mockRejectedValue(new Error('rete giù'));
    await expect(fetchUtentiTenant({ forceRefresh: true })).resolves.toEqual([]);
  });

  it('nemmeno un errore del server (500) fa comparire il seed (F5)', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as any);
    await expect(fetchUtentiTenant({ forceRefresh: true })).resolves.toEqual([]);
  });
});

describe('fetchTenantInfoApi — senza risposta niente anagrafica di seed (F5)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    localStorage.clear();
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: BLUECODE_TENANT_ID }));
  });

  it('server irraggiungibile e nessuna copia locale → null, non lo studio dimostrativo', async () => {
    mockApiFetch.mockRejectedValue(new Error('rete giù'));
    await expect(fetchTenantInfoApi()).resolves.toBeNull();
  });
});

describe('fetchAdminTenantsApi — niente ripiego silenzioso sulla copia locale', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    localStorage.clear();
    localStorage.setItem('bluman_all_tenants_admin', JSON.stringify([
      { id: 'studio-cancellato', ragioneSociale: 'Studio Cancellato dal Database' },
    ]));
  });

  it('col server che risponde restituisce gli studi del server', async () => {
    mockApiFetch.mockResolvedValue(risposta([{ id: 's-1', ragioneSociale: 'Bluecode LTD' }]));
    await expect(fetchAdminTenantsApi()).resolves.toEqual([{ id: 's-1', ragioneSociale: 'Bluecode LTD' }]);
  });

  it('col server irraggiungibile lancia, invece di restituire la copia locale', async () => {
    mockApiFetch.mockRejectedValue(new Error('rete giù'));
    await expect(fetchAdminTenantsApi()).rejects.toThrow();
  });

  it('nemmeno un 500 diventa un elenco di studi', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as any);
    await expect(fetchAdminTenantsApi()).rejects.toThrow(/Elenco studi non disponibile/);
  });
});
