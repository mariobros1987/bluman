// Analisi del 26/11, F7 — GET /audit-logs: ruolo e categoria si filtrano a database, su tutto il
// registro. Qui si guarda il `where` che la rotta passa a Prisma, e che i valori fuori elenco
// vengano rifiutati invece di essere ignorati.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({ where: null as any, whereConteggio: null as any }));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) => (args?.where?.id === 'super-1' ? { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0 } : null),
      findUnique: async () => null,
    },
    tenant: { findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }), findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }) },
    permessoModulo: { findUnique: async () => null },
    auditLog: {
      findMany: async (args: any) => { stato.where = args.where; return []; },
      count: async (args: any) => { stato.whereConteggio = args.where; return 0; },
      create: async () => ({}),
    },
  };
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    contestoTenant: { run: (_c: unknown, fn: () => unknown) => fn() },
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function leggi(query: string) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: 'super-1', tenantId: TENANT, email: 'root@piattaforma.example', ruolo: 'super_admin', sessionVersion: 0 });
  const res = await server.inject({ method: 'GET', url: `/audit-logs?page=1&limit=25${query}`, headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  return res;
}

beforeEach(() => { stato.where = null; stato.whereConteggio = null; });

describe('GET /audit-logs — filtri su tutto il registro', () => {
  it('senza filtri: solo lo studio della sessione', async () => {
    const res = await leggi('');
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.where).toEqual({ tenantId: TENANT });
  });

  it('ruolo: va nel where, e il conteggio usa lo stesso filtro delle righe', async () => {
    await leggi('&ruolo=advisor');
    expect(stato.where).toMatchObject({ tenantId: TENANT, ruolo: 'advisor' });
    expect(stato.whereConteggio).toEqual(stato.where);
  });

  it('categoria con parole proprie: le contiene, e non contiene quelle delle categorie che vengono prima', async () => {
    await leggi('&categoria=PROGETTO');
    const [contiene, esclude] = stato.where.AND;
    expect(contiene.OR).toContainEqual({ azione: { contains: 'MODULO', mode: 'insensitive' } });
    expect(esclude.NOT.OR).toContainEqual({ azione: { contains: 'FATTURA', mode: 'insensitive' } });
  });

  it('«DOCUMENTI» è il resto: nessuna parola delle altre categorie', async () => {
    await leggi('&categoria=DOCUMENTI');
    expect(stato.where.AND).toHaveLength(1);
    expect(stato.where.AND[0].NOT.OR).toContainEqual({ azione: { contains: 'KYC', mode: 'insensitive' } });
  });

  it('valori fuori elenco → 400, non «tutto il registro»', async () => {
    expect((await leggi('&categoria=XYZ')).statusCode).toBe(400);
    expect((await leggi('&ruolo=chiunque')).statusCode).toBe(400);
    expect(stato.where).toBeNull();
  });
});
