// Test del motore RBAC client-side. È un presidio lato UX (la sicurezza vera sta nei
// JWT del backend): questi test blinda che i ruoli nuovi non aprano per sbaglio moduli
// che non gli spettano, e che la matrice salvata (quella che lo studio configura in
// Impostazioni) vinca sui default di ruolo.
import { describe, it, expect, beforeEach } from 'vitest';
import { getUserPermission } from '../utils/rbac';
import { getTenantStorageKey } from '../utils/tenant';

const ADVISOR = { id: 'usr-1', email: 'advisor@studio.it', ruolo: 'advisor' };
const COLLABORATORE = { id: 'usr-2', email: 'collab@studio.it', ruolo: 'collaboratore_interno' };
const ESTERNO = { id: 'usr-3', email: 'esterno@studio.it', ruolo: 'collaboratore_esterno' };
const SUPER_ADMIN = { id: 'usr-4', email: 'super@bluman.it', ruolo: 'super_admin' };

describe('getUserPermission — default per ruolo', () => {
  beforeEach(() => localStorage.clear());

  it('super_admin ha write ovunque', () => {
    expect(getUserPermission(SUPER_ADMIN, 'invoices')).toBe('write');
    expect(getUserPermission(SUPER_ADMIN, 'admin')).toBe('write');
  });

  it('advisor accede ai moduli operativi ma non a admin', () => {
    expect(getUserPermission(ADVISOR, 'projects')).toBe('write');
    expect(getUserPermission(ADVISOR, 'invoices')).toBe('write');
    expect(getUserPermission(ADVISOR, 'admin')).toBe('denied');
  });

  it('collaboratore interno: progetti scrivibili, clienti solo leggibili, fatture negate', () => {
    expect(getUserPermission(COLLABORATORE, 'projects')).toBe('write');
    expect(getUserPermission(COLLABORATORE, 'clients')).toBe('read');
    expect(getUserPermission(COLLABORATORE, 'invoices')).toBe('denied');
    expect(getUserPermission(COLLABORATORE, 'settings')).toBe('denied');
  });

  it('collaboratore esterno: più stretto, nemmeno i clienti in lettura', () => {
    expect(getUserPermission(ESTERNO, 'projects')).toBe('write');
    expect(getUserPermission(ESTERNO, 'documents')).toBe('read');
    expect(getUserPermission(ESTERNO, 'clients')).toBe('denied');
  });

  it('senza utente è denied, qualunque modulo', () => {
    expect(getUserPermission(null, 'projects')).toBe('denied');
    expect(getUserPermission(undefined, 'dashboard')).toBe('denied');
  });
});

describe('getUserPermission — la matrice dello studio vince sui default', () => {
  beforeEach(() => localStorage.clear());

  it('un override read per il collaboratore limita un modulo di cui avrebbe write', () => {
    const chiave = getTenantStorageKey(`bluman_rbac_permissions_${COLLABORATORE.email}`);
    localStorage.setItem(chiave, JSON.stringify([
      { moduloChiave: 'projects', livello: 'read' },
    ]));

    expect(getUserPermission(COLLABORATORE, 'projects')).toBe('read');
  });

  it('un override write apre al collaboratore un modulo che il default gli nega', () => {
    const chiave = getTenantStorageKey(`bluman_rbac_permissions_${COLLABORATORE.email}`);
    localStorage.setItem(chiave, JSON.stringify([
      { moduloChiave: 'invoices', livello: 'write' },
    ]));

    expect(getUserPermission(COLLABORATORE, 'invoices')).toBe('write');
  });

  it('la matrice di un ALTRO utente non conta niente per questo', () => {
    const chiave = getTenantStorageKey('bluman_rbac_permissions_altro@studio.it');
    localStorage.setItem(chiave, JSON.stringify([
      { moduloChiave: 'invoices', livello: 'write' },
    ]));

    expect(getUserPermission(COLLABORATORE, 'invoices')).toBe('denied');
  });
});
