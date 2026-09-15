import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Enforcement lato server della Matrice Permessi (PermessoModulo).
 *
 * Il buco che questo blocco presidia: fino a settembre 2026 la matrice era
 * client-side only — il frontend nascondeva le pagine, ma con un JWT valido
 * qualsiasi collaboratore poteva chiamare le API dei moduli «denied» con curl.
 * L'hook onRequest di buildServer ora consulta la riga (tenantId, userId,
 * moduloChiave) prima di lasciare passare la richiesta.
 *
 * Il mock intercetta SOLO user.findFirst (il guard di autenticazione) e
 * permessoModulo.findUnique (la matrice): tutto il resto delega al client
 * reale, come in server.test.ts. I test usano la via InMemoryApp
 * (`GET /fatture/tutte` → app.listaFattureTutte), che non tocca il database.
 */

// Matrice simulata, leggibile dal mock nonostante l'hoisting di vi.mock.
const permessiTest = vi.hoisted(() => ({
  perModulo: {} as Record<string, 'denied' | 'read' | 'write'>,
  errore: null as Error | null,
  viste: [] as Array<Record<string, unknown>>,
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

  const user = delega((reale.prisma as any).user, {
    findFirst: async (args: any) => {
      const selezioneGuard = args?.select?.ruolo === true && args?.select?.stato === true && args?.select?.sessionVersion === true;
      if (selezioneGuard && ['usr-test', 'usr-collab', 'usr-super'].includes(args?.where?.id)) {
        const ruolo =
          args.where.id === 'usr-collab' ? 'collaboratore_interno'
          : args.where.id === 'usr-super' ? 'super_admin'
          : 'advisor';
        return { ruolo, stato: 'attivo', sessionVersion: 0 };
      }
      return (reale.prisma as any).user.findFirst(args);
    },
  });
  const permessoModulo = delega((reale.prisma as any).permessoModulo, {
    findUnique: async (args: any) => {
      permessiTest.viste.push(args?.where?.tenantId_userId_moduloChiave);
      if (permessiTest.errore) throw permessiTest.errore;
      const livello = permessiTest.perModulo[args?.where?.tenantId_userId_moduloChiave?.moduloChiave];
      return livello ? { livello } : null;
    },
  });
  const prisma = new Proxy(reale.prisma as any, {
    get(target, proprieta) {
      if (proprieta === 'user') return user;
      if (proprieta === 'permessoModulo') return permessoModulo;
      const valore = Reflect.get(target, proprieta, target);
      return typeof valore === 'function' ? valore.bind(target) : valore;
    },
  });
  return { ...reale, prisma };
});

import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';

function token(ruolo: 'advisor' | 'collaboratore_interno' | 'super_admin'): string {
  const userId = ruolo === 'advisor' ? 'usr-test' : ruolo === 'super_admin' ? 'usr-super' : 'usr-collab';
  return signJwt({ userId, tenantId: TENANT_TEST, email: `${userId}@studio.example`, ruolo, sessionVersion: 0 });
}

async function serverDiTest() {
  const server = buildServer(new InMemoryApp());
  return server;
}

beforeEach(() => {
  permessiTest.perModulo = {};
  permessiTest.errore = null;
  permessiTest.viste = [];
});

describe('server — enforcement della Matrice Permessi (RBAC)', () => {
  it('senza riga sulla matrice l\'accesso resta quello di prima (default permissivo)', async () => {
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(200);
    // La matrice è stata consultata con l'identità del token.
    expect(permessiTest.viste).toEqual([{ tenantId: TENANT_TEST, userId: 'usr-collab', moduloChiave: 'invoices' }]);
    await server.close();
  });

  it('«denied» blocca il modulo anche in lettura', async () => {
    permessiTest.perModulo = { invoices: 'denied' };
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toContain('invoices');
    await server.close();
  });

  it('«read» lascia le letture e blocca le scritture', async () => {
    permessiTest.perModulo = { invoices: 'read' };
    const server = await serverDiTest();
    const lettura = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(lettura.statusCode).toBe(200);
    // La richiesta non deve arrivare al handler: 403 prima di toccare la fattura.
    const scrittura = await server.inject({ method: 'POST', url: '/invoices/abc/emetti', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(scrittura.statusCode).toBe(403);
    await server.close();
  });

  it('la matrice vale anche per l\'advisor (come nel frontend), il super_admin bypassa', async () => {
    permessiTest.perModulo = { invoices: 'denied' };
    const server = await serverDiTest();
    const advisor = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('advisor')}` } });
    expect(advisor.statusCode).toBe(403);
    const superAdmin = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('super_admin')}` } });
    expect(superAdmin.statusCode).not.toBe(403);
    await server.close();
  });

  it('le rotte fuori dalla mappa non consultano la matrice', async () => {
    permessiTest.perModulo = { projects: 'denied' };
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/notifiche', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).not.toBe(403);
    expect(permessiTest.viste).toEqual([]);
    await server.close();
  });

  it('un database irraggiungibile non trasforma la matrice in un blocco totale (fail-open)', async () => {
    permessiTest.errore = new Error('DB irraggiungibile');
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    // La sessione era stata verificata sullo stesso DB un attimo prima: qui si
    // logga e si lascia passare, non si 403-a raffica.
    expect(res.statusCode).toBe(200);
    await server.close();
  });
});
