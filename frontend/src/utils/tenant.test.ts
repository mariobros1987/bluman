// Test dell'isolamento multi-tenant lato client: le chiavi localStorage dei dati di
// studio portano il suffisso `_tenant_<id>`, così due studi sulla stessa macchina non
// si vedono i dati reciproci. È il presidio del §14 lato frontend (quello vero sta
// nelle policy RLS del database; questo evita il bleeding visivo e i salvataggi incrociati).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCurrentTenantId,
  getTenantStorageKey,
  isAdminStudio,
  BLUECODE_TENANT_ID,
} from './tenant';

const TENANT_UNO = '00000000-0000-0000-0000-000000000001';
const TENANT_DUE = '00000000-0000-0000-0000-000000000002';

describe('getTenantStorageKey — chiavi isolate per tenant', () => {
  beforeEach(() => localStorage.clear());

  it('la stessa base produce chiavi diverse per tenant diversi', () => {
    expect(getTenantStorageKey('bluman_rbac_permissions', TENANT_UNO))
      .toBe(`bluman_rbac_permissions_tenant_${TENANT_UNO}`);
    expect(getTenantStorageKey('bluman_rbac_permissions', TENANT_DUE))
      .toBe(`bluman_rbac_permissions_tenant_${TENANT_DUE}`);
  });

  it('senza tenant esplicito usa quello corrente', () => {
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: TENANT_DUE }));
    expect(getTenantStorageKey('chiave')).toBe(`chiave_tenant_${TENANT_DUE}`);
  });
});

describe('getCurrentTenantId — il tenant dell\'utente vince', () => {
  beforeEach(() => localStorage.clear());

  it('un utente con tenantId è vincolato al proprio studio', () => {
    const id = getCurrentTenantId({ ruolo: 'advisor', tenantId: TENANT_DUE });
    expect(id).toBe(TENANT_DUE);
    // E lo scrive in localStorage perché le letture senza utente lo ritrovino
    expect(localStorage.getItem('bluman_tenant_id')).toBe(TENANT_DUE);
  });

  it('senza utente e senza selezione, il tenant di default è Bluecode', () => {
    expect(getCurrentTenantId()).toBe(BLUECODE_TENANT_ID);
  });

  it('il tenant selezionato in storage vale per chi non porta utente (super_admin)', () => {
    localStorage.setItem('bluman_tenant_id', TENANT_DUE);
    expect(getCurrentTenantId()).toBe(TENANT_DUE);
  });
});

describe('isAdminStudio — chi può sbloccare i documenti firmati (§WF-DOC)', () => {
  beforeEach(() => localStorage.clear());

  it('advisor e super_admin sono admin dello studio', () => {
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor' }));
    expect(isAdminStudio()).toBe(true);

    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'super_admin' }));
    expect(isAdminStudio()).toBe(true);
  });

  it('il collaboratore non lo è: non può sbloccare un atto firmato', () => {
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'collaboratore_interno' }));
    expect(isAdminStudio()).toBe(false);
  });
});
