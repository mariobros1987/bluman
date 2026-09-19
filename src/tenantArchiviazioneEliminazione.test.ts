import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Archiviazione ed eliminazione di un tenant (§21, 19/09/2026).
 *
 * Due invarianti presidiati qui:
 * 1. Il login blocca gli utenti di uno studio SOSPESO o ARCHIVIATO (prima la sospensione
 *    cambiava solo l'aspetto nella console super_admin, senza impedire l'accesso). Il
 *    super_admin (tenantId null) resta fuori dal blocco: non ha uno studio proprio.
 * 2. L'eliminazione definitiva è ammessa solo su uno studio già ARCHIVIATO: su uno studio
 *    attivo il server risponde 409, senza toccare nessun dato.
 *
 * Il mock intercetta le sole letture su cui poggiano i due guard — `user.findFirst` (guard
 * di autenticazione dell'hook + login) e `tenant.findUnique` (stato dello studio) — sia sul
 * client RLS (`prisma`) sia su quello amministrativo (`prismaAmministrativo`). Il resto
 * delega al client reale, come negli altri test di rotta.
 */

const stato = vi.hoisted(() => ({
  tenant: { id: '', ragioneSociale: '', stato: 'attivo' } as { id: string; ragioneSociale: string; stato: string },
  utente: null as any,
  eliminazioneChiamata: false,
}));

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const delega = (target: any, sostituzioni: Record<string, (...args: any[]) => any>) => new Proxy(target, {
    get(oggetto, proprieta) {
      if (typeof proprieta === 'string' && sostituzioni[proprieta]) return sostituzioni[proprieta];
      const valore = Reflect.get(oggetto, proprieta, oggetto);
      return typeof valore === 'function' ? valore.bind(oggetto) : valore;
    },
  });

  const sostituzioniUser = {
    // Guard di autenticazione dell'hook onRequest: seleziona ruolo/stato/sessionVersion.
    findFirst: async (args: any) => {
      const guard = args?.select?.ruolo === true && args?.select?.stato === true && args?.select?.sessionVersion === true;
      if (guard && args?.where?.id === 'usr-super') return { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0 };
      // Login: cerca per email, restituisce l'utente completo.
      if (stato.utente && args?.where?.email === stato.utente.email) return stato.utente;
      return (reale.prisma as any).user.findFirst(args);
    },
  };
  const sostituzioniTenant = {
    findUnique: async (args: any) => {
      if (args?.where?.id === stato.tenant.id) {
        return args?.select ? { stato: stato.tenant.stato } : { ...stato.tenant };
      }
      return null;
    },
  };

  const fabbricaProxy = (base: any) => new Proxy(base, {
    get(target, proprieta) {
      if (proprieta === 'user') return delega(base.user, sostituzioniUser);
      if (proprieta === 'tenant') return delega(base.tenant, sostituzioniTenant);
      const valore = Reflect.get(target, proprieta, target);
      return typeof valore === 'function' ? valore.bind(target) : valore;
    },
  });

  return {
    ...reale,
    prisma: fabbricaProxy(reale.prisma as any),
    prismaAmministrativo: () => fabbricaProxy((reale.prismaAmministrativo as any)()),
  };
});

// L'eliminazione vera non deve mai partire nei test del guard 409: la stubbiamo e verifichiamo
// che NON venga chiamata quando lo studio non è archiviato.
vi.mock('./services/eliminazioneTenant.js', () => ({
  eliminaTenantCompleto: vi.fn(async () => { stato.eliminazioneChiamata = true; return { tenant: 1 }; }),
}));

import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { signJwt } from './util/jwt.js';
import { hashPassword } from './util/password.js';

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000002';

function tokenSuperAdmin(): string {
  return signJwt({ userId: 'usr-super', tenantId: '', email: 'super@piattaforma.example', ruolo: 'super_admin', sessionVersion: 0 });
}

beforeEach(() => {
  stato.tenant = { id: TENANT_STUDIO, ragioneSociale: 'Studio Prova', stato: 'attivo' };
  stato.utente = null;
  stato.eliminazioneChiamata = false;
});

describe('login — blocco per stato del tenant', () => {
  it('403 se lo studio dell\'utente è sospeso', async () => {
    const server = buildServer(new InMemoryApp());
    stato.tenant = { id: TENANT_STUDIO, ragioneSociale: 'Studio Prova', stato: 'sospeso' };
    stato.utente = {
      id: 'usr-adv', email: 'adv@studio.example', ruolo: 'advisor', tenantId: TENANT_STUDIO,
      stato: 'attivo', sessionVersion: 0, passwordHash: hashPassword('Password123!'), totpAbilitato: false,
    };
    const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: 'adv@studio.example', password: 'Password123!' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toMatch(/sospeso/i);
  });

  it('403 se lo studio dell\'utente è archiviato', async () => {
    const server = buildServer(new InMemoryApp());
    stato.tenant = { id: TENANT_STUDIO, ragioneSociale: 'Studio Prova', stato: 'archiviato' };
    stato.utente = {
      id: 'usr-adv', email: 'adv@studio.example', ruolo: 'advisor', tenantId: TENANT_STUDIO,
      stato: 'attivo', sessionVersion: 0, passwordHash: hashPassword('Password123!'), totpAbilitato: false,
    };
    const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email: 'adv@studio.example', password: 'Password123!' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toMatch(/archiviat/i);
  });
});

describe('DELETE /admin/tenants/:id — eliminazione solo se archiviato', () => {
  it('409 e nessuna cancellazione se lo studio è attivo', async () => {
    const server = buildServer(new InMemoryApp());
    stato.tenant = { id: TENANT_STUDIO, ragioneSociale: 'Studio Prova', stato: 'attivo' };
    const res = await server.inject({
      method: 'DELETE', url: `/admin/tenants/${TENANT_STUDIO}`,
      headers: { authorization: `Bearer ${tokenSuperAdmin()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(stato.eliminazioneChiamata).toBe(false);
  });

  it('404 se lo studio non esiste', async () => {
    const server = buildServer(new InMemoryApp());
    stato.tenant = { id: 'altro-id', ragioneSociale: '', stato: 'attivo' };
    const res = await server.inject({
      method: 'DELETE', url: `/admin/tenants/${TENANT_STUDIO}`,
      headers: { authorization: `Bearer ${tokenSuperAdmin()}` },
    });
    expect(res.statusCode).toBe(404);
    expect(stato.eliminazioneChiamata).toBe(false);
  });
});
