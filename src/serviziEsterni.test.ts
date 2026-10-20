/**
 * Credenziali dei servizi esterni (visura, screening PEP, TSA).
 *
 * I test presidiano le due promesse che rendono la scheda utilizzabile in produzione:
 *   1. il segreto non torna mai al browser e non finisce nella catena di compliance;
 *   2. il campo vuoto non cancella una credenziale — per cancellarla serve una richiesta esplicita.
 * Il resto (URL, ruoli, servizio sconosciuto) è validazione di confine.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

const stato = {
  righe: [] as any[],
  eventi: [] as any[],
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const utente = (args: any) => {
    const id = args?.where?.id;
    if (id === 'usr-advisor') return { id, tenantId: TENANT, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 };
    if (id === 'usr-collab') return { id, tenantId: TENANT, ruolo: 'collaboratore_interno', stato: 'attivo', sessionVersion: 0 };
    return null;
  };

  const finto: any = {
    user: {
      findUnique: async (args: any) => utente(args),
      findFirst: async (args: any) => utente(args),
      findMany: async () => [],
    },
    auditLog: { create: async () => ({}) },
    credenzialeServizioEsterno: {
      findMany: async (args: any) => stato.righe.filter((r) => r.tenantId === args?.where?.tenantId),
      upsert: async (args: any) => {
        const { tenantId, servizio } = args.where.tenantId_servizio;
        const i = stato.righe.findIndex((r) => r.tenantId === tenantId && r.servizio === servizio);
        if (i >= 0) {
          stato.righe[i] = { ...stato.righe[i], ...args.update, updatedAt: new Date() };
          return stato.righe[i];
        }
        const riga = {
          id: `id-${servizio}`, tenantId, servizio,
          etichetta: null, endpoint: null, username: null, segreto: null, extra: null, aggiornatoDa: null,
          createdAt: new Date(), updatedAt: new Date(),
          ...args.create,
        };
        stato.righe.push(riga);
        return riga;
      },
    },
    complianceEvent: {
      findFirst: async () => null,
      create: async (args: any) => { stato.eventi.push(args.data); return args.data; },
    },
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TOKEN_ADVISOR = signJwt({
  userId: 'usr-advisor', tenantId: TENANT, email: 'advisor@studio.example', ruolo: 'advisor', sessionVersion: 0,
});
const TOKEN_COLLAB = signJwt({
  userId: 'usr-collab', tenantId: TENANT, email: 'collab@studio.example', ruolo: 'collaboratore_interno', sessionVersion: 0,
});

const server = () => buildServer(new InMemoryApp()) as any;
const auth = (token = TOKEN_ADVISOR) => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  stato.righe = [];
  stato.eventi = [];
});

describe('GET /tenant/servizi-esterni', () => {
  it('non è leggibile da un collaboratore', async () => {
    const r = await server().inject({ method: 'GET', url: '/tenant/servizi-esterni', headers: auth(TOKEN_COLLAB) });
    expect(r.statusCode).toBe(403);
  });

  it('restituisce i tre servizi anche quando nessuno è configurato', async () => {
    const r = await server().inject({ method: 'GET', url: '/tenant/servizi-esterni', headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.servizi.map((s: any) => s.servizio).sort()).toEqual(['kyc_screening', 'kyc_visura', 'tsa']);
    expect(body.servizi.every((s: any) => s.segretoConfigurato === false)).toBe(true);
  });

  it('non restituisce mai il segreto: solo la coda mascherata', async () => {
    stato.righe.push({
      id: 'x', tenantId: TENANT, servizio: 'tsa', etichetta: null,
      endpoint: 'https://tsa.example', username: 'utente', segreto: 'super-segreto-1234',
      extra: null, aggiornatoDa: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const r = await server().inject({ method: 'GET', url: '/tenant/servizi-esterni', headers: auth() });
    expect(r.statusCode).toBe(200);
    const tsa = r.json().servizi.find((s: any) => s.servizio === 'tsa');
    expect(tsa.segretoConfigurato).toBe(true);
    expect(tsa.segretoMascherato).toBe('••••••••1234');
    expect(r.body).not.toContain('super-segreto-1234');
  });
});

describe('PUT /tenant/servizi-esterni/:servizio', () => {
  it('salva senza restituire il segreto e senza scriverlo nel registro di compliance', async () => {
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { endpoint: 'https://tsa.example/v1', username: 'api', segreto: 'chiave-12345678' },
    });
    expect(r.statusCode).toBe(200);
    expect(stato.righe[0].segreto).toBe('chiave-12345678');
    expect(r.body).not.toContain('chiave-12345678');
    expect(r.json().servizio.segretoConfigurato).toBe(true);

    expect(stato.eventi).toHaveLength(1);
    expect(stato.eventi[0].tipo).toBe('SERVIZIO_ESTERNO_CONFIGURATO');
    expect(JSON.stringify(stato.eventi[0].payload)).not.toContain('chiave-12345678');
    expect(stato.eventi[0].payload.campi).toContain('segreto');
  });

  it('con il segreto assente non tocca quello salvato', async () => {
    await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { segreto: 'chiave-originale' },
    });
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { endpoint: 'https://tsa.example/v2' },
    });
    expect(r.statusCode).toBe(200);
    expect(stato.righe[0].segreto).toBe('chiave-originale');
  });

  it('se l’interfaccia rimanda indietro la maschera, il segreto resta invariato', async () => {
    await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { segreto: 'chiave-abcdefgh' },
    });
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { segreto: '••••••••efgh' },
    });
    expect(r.statusCode).toBe(200);
    expect(stato.righe[0].segreto).toBe('chiave-abcdefgh');
  });

  it('con il segreto vuoto lo cancella esplicitamente', async () => {
    await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { segreto: 'da-cancellare' },
    });
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { segreto: '' },
    });
    expect(r.statusCode).toBe(200);
    expect(stato.righe[0].segreto).toBeNull();
    expect(r.json().servizio.segretoConfigurato).toBe(false);
  });

  it('rifiuta un indirizzo che non è http/https', async () => {
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(),
      payload: { endpoint: 'ftp://tsa.example' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rifiuta un servizio sconosciuto', async () => {
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/altro', headers: auth(),
      payload: { endpoint: 'https://example.test' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('non è scrivibile da un collaboratore', async () => {
    const r = await server().inject({
      method: 'PUT', url: '/tenant/servizi-esterni/tsa', headers: auth(TOKEN_COLLAB),
      payload: { endpoint: 'https://tsa.example' },
    });
    expect(r.statusCode).toBe(403);
    expect(stato.righe).toHaveLength(0);
  });
});
