/**
 * A1 — `PUT /tenant/utenti/:userId/permessi` scriveva la matrice RBAC di chiunque, per chiunque:
 * nessun controllo di ruolo, chiavi e livelli non validati, e l'upsert usava il tenant della
 * richiesta invece di quello del collaboratore. Un collaboratore poteva darsi `write` su tutto.
 *
 * Come `gerarchiaRuoli.test.ts`, il client Prisma è un finto: conta osservare che dopo un
 * rifiuto la scrittura non avviene, non solo il codice di risposta.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

const stato: { bersaglio: any; upsert: any[]; audit: any[] } = { bersaglio: null, upsert: [], audit: [] };

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const ruoliPerId: Record<string, string> = {
    'usr-super_admin': 'super_admin',
    'usr-advisor': 'advisor',
    'usr-collaboratore_interno': 'collaboratore_interno',
    'usr-collaboratore_esterno': 'collaboratore_esterno',
  };
  const finto: any = {
    user: {
      findUnique: async () => stato.bersaglio,
      // Verifica di sessione in server.ts.
      findFirst: async (args: any) => {
        const id = args?.where?.id;
        const ruolo = ruoliPerId[id];
        return ruolo
          ? { id, tenantId: ruolo === 'super_admin' ? null : TENANT, ruolo, stato: 'attivo', sessionVersion: 0 }
          : null;
      },
    },
    permessoModulo: {
      upsert: async (args: any) => {
        stato.upsert.push(args);
        return args.create;
      },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (fn: any) => fn(finto),
    $executeRaw: async () => ({}),
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return {
    ...reale,
    recordAudit: async (params: any) => {
      stato.audit.push(params);
    },
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

type Ruolo = 'super_admin' | 'advisor' | 'collaboratore_interno' | 'collaboratore_esterno';

function token(ruolo: Ruolo) {
  return signJwt({ userId: `usr-${ruolo}`, tenantId: TENANT, email: `${ruolo}@studio.example`, ruolo, sessionVersion: 0 });
}

function aggiorna(ruolo: Ruolo, permessi: unknown, userId = 'usr-collab') {
  return (buildServer(new InMemoryApp()) as any).inject({
    method: 'PUT',
    url: `/tenant/utenti/${userId}/permessi`,
    headers: { authorization: `Bearer ${token(ruolo)}` },
    payload: { permessi },
  });
}

const COLLABORATORE = { id: 'usr-collab', ruolo: 'collaboratore_interno', tenantId: TENANT, stato: 'attivo' };
const TUTTO_WRITE = [{ moduloChiave: 'invoices', livello: 'write' }];

beforeEach(() => {
  stato.bersaglio = COLLABORATORE;
  stato.upsert = [];
  stato.audit = [];
});

describe('A1 — chi può scrivere la matrice permessi', () => {
  it.each(['collaboratore_interno', 'collaboratore_esterno'] as const)('%s → 403, nessun upsert', async (ruolo) => {
    const res = await aggiorna(ruolo, TUTTO_WRITE);
    expect(res.statusCode).toBe(403);
    expect(stato.upsert).toEqual([]);
  });

  it("advisor su un collaboratore di un altro studio → 403, nessun upsert", async () => {
    stato.bersaglio = { ...COLLABORATORE, tenantId: ALTRO_TENANT };
    const res = await aggiorna('advisor', TUTTO_WRITE);
    expect(res.statusCode).toBe(403);
    expect(stato.upsert).toEqual([]);
  });

  it('advisor sul super_admin → 403, nessun upsert', async () => {
    stato.bersaglio = { id: 'usr-super', ruolo: 'super_admin', tenantId: TENANT, stato: 'attivo' };
    const res = await aggiorna('advisor', TUTTO_WRITE, 'usr-super');
    expect(res.statusCode).toBe(403);
    expect(stato.upsert).toEqual([]);
  });

  it('super_admin su un utente senza studio → 400, nessun upsert', async () => {
    stato.bersaglio = { id: 'usr-super', ruolo: 'super_admin', tenantId: null, stato: 'attivo' };
    const res = await aggiorna('super_admin', TUTTO_WRITE, 'usr-super');
    expect(res.statusCode).toBe(400);
    expect(stato.upsert).toEqual([]);
  });
});

describe('A1 — validazione del corpo', () => {
  it('chiave modulo inventata → 400, nessun upsert', async () => {
    const res = await aggiorna('advisor', [{ moduloChiave: 'tutto', livello: 'write' }]);
    expect(res.statusCode).toBe(400);
    expect(stato.upsert).toEqual([]);
  });

  it('livello sconosciuto → 400', async () => {
    const res = await aggiorna('advisor', [{ moduloChiave: 'invoices', livello: 'admin' }]);
    expect(res.statusCode).toBe(400);
  });

  it('array vuoto → 400', async () => {
    const res = await aggiorna('advisor', []);
    expect(res.statusCode).toBe(400);
  });
});

describe('A1 — scrittura riuscita', () => {
  it("advisor sul proprio collaboratore → 200, tenant del collaboratore, audit con l'autore", async () => {
    const res = await aggiorna('advisor', [
      { moduloChiave: 'invoices', livello: 'read' },
      { moduloChiave: 'banks', livello: 'denied' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(stato.upsert).toHaveLength(2);
    expect(stato.upsert[0].create).toMatchObject({ tenantId: TENANT, userId: 'usr-collab', moduloChiave: 'invoices', livello: 'read' });
    expect(stato.audit).toHaveLength(1);
    expect(stato.audit[0]).toMatchObject({ tenantId: TENANT, userId: 'usr-advisor', ruolo: 'advisor' });
    expect(stato.audit[0].ipAddress).toBeTruthy();
    expect(stato.audit[0].dettagli).toContain('invoices→read');
  });

  it('super_admin su un collaboratore di un altro studio → upsert col tenant del collaboratore', async () => {
    stato.bersaglio = { ...COLLABORATORE, tenantId: ALTRO_TENANT };
    const res = await aggiorna('super_admin', TUTTO_WRITE);
    expect(res.statusCode).toBe(200);
    expect(stato.upsert[0].create.tenantId).toBe(ALTRO_TENANT);
  });
});
