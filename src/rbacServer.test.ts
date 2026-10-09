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
  it('senza riga sulla matrice si applica il default per ruolo, non l\'accesso pieno', async () => {
    // collaboratore_interno NON ha invoices nel suo default (né write né read): senza riga
    // sulla matrice l'API ora nega, come fa il frontend. Prima qui passava (buco: un
    // collaboratore leggeva via API dati che l'UI gli nascondeva).
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toContain('invoices');
    // La matrice è stata consultata con l'identità del token.
    expect(permessiTest.viste).toEqual([{ tenantId: TENANT_TEST, userId: 'usr-collab', moduloChiave: 'invoices' }]);
    await server.close();
  });

  it('il default per ruolo consente dove il ruolo ha accesso (advisor pieno su invoices senza riga)', async () => {
    // advisor: default write ovunque tranne audit → invoices senza riga sulla matrice passa.
    // (stessa via InMemoryApp `/fatture/tutte`, nessun tocco al database).
    const server = await serverDiTest();
    const advisor = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('advisor')}` } });
    expect(advisor.statusCode).toBe(200);
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

  it('un database irraggiungibile NON apre: si ricade sul default per ruolo (fail-closed)', async () => {
    // Fino al 09/10/2026 questo test asseriva l'opposto (200): la scelta argomentata era che la
    // sessione è verificata sullo stesso database un attimo prima, quindi un errore di lettura
    // della matrice non è un attacco. Il difetto era un altro, e stava nell'asimmetria:
    // **l'error-path era più permissivo del percorso normale**. Con la matrice raggiungibile
    // questo collaboratore prende 403 (default `denied` su invoices); con la matrice
    // irraggiungibile prendeva l'accesso pieno. Cioè il rilievo di sicurezza chiuso il 27/09
    // tornava vivo ogni volta che una query falliva — e per accorgersene sarebbe servito
    // guardare i log, non l'API.
    // Voce 5, decisa col titolare: si sbaglia dal lato che si vede (una porta chiusa per errore
    // si nota e si riapre; una porta aperta per errore non si nota).
    permessiTest.errore = new Error('DB irraggiungibile');
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/fatture/tutte', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toContain('invoices');
    await server.close();
  });

  it('col database irraggiungibile il ripiego è il default del RUOLO, non un blocco totale', async () => {
    // La stessa caduta, su un modulo dove il ruolo ha davvero accesso: `clients` è `read` nel
    // default di collaboratore_interno, quindi la lettura passa lo stesso. Serve a fissare che
    // il fail-closed sia «ricadi sul default», non «nega tutto quando qualcosa va storto».
    permessiTest.errore = new Error('DB irraggiungibile');
    const server = await serverDiTest();
    const res = await server.inject({ method: 'GET', url: '/clienti', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(res.statusCode).toBe(200);
    await server.close();
  });

  it('voce 4 — la lettura della casella comunicazioni è governata come l\'invio', async () => {
    // Prima del 09/10/2026 queste rotte non erano in mappa: un collaboratore con
    // `communications: denied` non poteva scrivere ai clienti ma leggeva tutta la loro
    // corrispondenza. Ora il 403 arriva prima del handler, quindi il test non tocca IMAP.
    permessiTest.perModulo = { communications: 'denied' };
    const server = await serverDiTest();
    const posta = await server.inject({ method: 'POST', url: '/comunicazioni/email-in-arrivo', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(posta.statusCode).toBe(403);
    expect(posta.json().errore).toContain('communications');
    const fascicolo = await server.inject({ method: 'GET', url: '/progetti/abc/comunicazioni', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(fascicolo.statusCode).toBe(403);
    // E la matrice è stata interrogata davvero, non aggirata.
    expect(permessiTest.viste.map(v => v.moduloChiave)).toEqual(['communications', 'communications']);
    await server.close();
  });

  it('«read» su communications lascia leggere la casella e blocca l\'invio', async () => {
    // La semantica di voce 4: `read` è «consulta la conversazione ma non scrivere», e vale
    // identica per la posta in ingresso e per l'invio.
    permessiTest.perModulo = { communications: 'read' };
    const server = await serverDiTest();
    const invio = await server.inject({ method: 'POST', url: '/comunicazioni/invia-email', headers: { authorization: `Bearer ${token('collaboratore_interno')}` } });
    expect(invio.statusCode).toBe(403);
    await server.close();
  });
});
