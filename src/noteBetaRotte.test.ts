// Note della beta — le rotte. Si guarda ciò che conta: chi scrive lo decide la sessione (non il
// corpo della richiesta), la pagina la calcola il server, e ogni ruolo fa solo ciò che gli spetta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  utente: { id: 'u-1', ruolo: 'advisor' } as { id: string; ruolo: string },
  create: [] as any[],
  where: null as any,
  nota: null as any,
  update: [] as any[],
  cancellate: [] as string[],
  guastoLettura: false,
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) => (args?.where?.id === stato.utente.id ? { ruolo: stato.utente.ruolo, stato: 'attivo', sessionVersion: 0 } : null),
      findUnique: async () => ({ nome: 'Lorenzo Marino', email: 'lorenzo@studio.example' }),
    },
    cliente: { findFirst: async () => ({ sessionVersion: 0 }) },
    tenant: { findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }), findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }) },
    permessoModulo: { findUnique: async () => null },
    auditLog: { create: async () => ({}) },
    notaBeta: {
      findMany: async (args: any) => {
        if (stato.guastoLettura) throw new Error('db giù');
        stato.where = args.where;
        return [];
      },
      findFirst: async () => stato.nota,
      create: async (args: any) => { stato.create.push(args.data); return { id: 'n-1', ...args.data }; },
      update: async (args: any) => { stato.update.push(args.data); return { ...stato.nota, ...args.data }; },
      delete: async (args: any) => { stato.cancellate.push(args.where.id); return {}; },
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

async function chiama(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: stato.utente.id, tenantId: TENANT, email: 'lorenzo@studio.example', ruolo: stato.utente.ruolo as any, sessionVersion: 0 });
  const res = await server.inject({ method, url, payload, headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  return res;
}

beforeEach(() => {
  stato.utente = { id: 'u-1', ruolo: 'advisor' };
  stato.create.length = 0;
  stato.update.length = 0;
  stato.cancellate.length = 0;
  stato.where = null;
  stato.nota = null;
  stato.guastoLettura = false;
});

describe('POST /note-beta', () => {
  it('salva con studio, autore e ruolo della sessione, e la pagina la calcola il server', async () => {
    const res = await chiama('POST', '/note-beta', {
      percorso: '/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785?tab=fatturazione',
      tipo: 'miglioramento',
      testo: '  Il pulsante è poco visibile  ',
      // Campi che un client non deve poter decidere:
      tenantId: 'altro-studio', autoreNome: 'Qualcun altro', ruolo: 'super_admin', stato: 'risolta',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(stato.create[0]).toEqual({
      tenantId: TENANT,
      userId: 'u-1',
      autoreNome: 'Lorenzo Marino',
      ruolo: 'advisor',
      pagina: '/projects/:id',
      percorso: '/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785',
      tipo: 'miglioramento',
      testo: 'Il pulsante è poco visibile',
    });
  });

  it('nota vuota o tipo sconosciuto → 400, niente scritto', async () => {
    expect((await chiama('POST', '/note-beta', { percorso: '/primanota', testo: '  ' })).statusCode).toBe(400);
    expect((await chiama('POST', '/note-beta', { percorso: '/primanota', tipo: 'altro', testo: 'Una nota vera' })).statusCode).toBe(400);
    expect(stato.create).toEqual([]);
  });

  it('il cliente del portale non scrive e non legge', async () => {
    stato.utente = { id: 'client-cli-1', ruolo: 'cliente' };
    expect((await chiama('POST', '/note-beta', { percorso: '/primanota', testo: 'Dal portale' })).statusCode).toBe(403);
    expect((await chiama('GET', '/note-beta?pagina=/primanota')).statusCode).toBe(403);
    expect(stato.create).toEqual([]);
  });

  it('un collaboratore può scrivere', async () => {
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    expect((await chiama('POST', '/note-beta', { percorso: '/primanota', testo: 'Manca il totale' })).statusCode).toBe(201);
  });
});

describe('GET /note-beta', () => {
  it('le note di una pagina: filtrate per studio e per pagina in forma generale', async () => {
    const res = await chiama('GET', '/note-beta?pagina=/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785');
    expect(res.statusCode).toBe(200);
    expect(stato.where).toEqual({ tenantId: TENANT, pagina: '/projects/:id' });
  });

  it('l’elenco completo: sì al responsabile dello studio, no al collaboratore', async () => {
    expect((await chiama('GET', '/note-beta')).statusCode).toBe(200);
    expect(stato.where).toEqual({ tenantId: TENANT });
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    expect((await chiama('GET', '/note-beta')).statusCode).toBe(403);
  });

  it('lettura fallita → 500 dichiarato, non un elenco vuoto', async () => {
    stato.guastoLettura = true;
    const res = await chiama('GET', '/note-beta?pagina=/primanota');
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).toMatch(/non sono state lette/);
  });
});

describe('PATCH e DELETE /note-beta/:id', () => {
  const NOTA = { id: 'n-1', tenantId: TENANT, userId: 'u-2', autoreNome: 'Sara', pagina: '/primanota', stato: 'aperta' };

  it('«risolta» la segna il responsabile, con data e autore; riaprirla li toglie', async () => {
    stato.nota = { ...NOTA };
    expect((await chiama('PATCH', '/note-beta/n-1', { stato: 'risolta' })).statusCode).toBe(200);
    expect(stato.update[0]).toMatchObject({ stato: 'risolta', risoltaDa: 'u-1' });
    expect(stato.update[0].risoltaAt).toBeInstanceOf(Date);
    expect((await chiama('PATCH', '/note-beta/n-1', { stato: 'aperta' })).statusCode).toBe(200);
    expect(stato.update[1]).toEqual({ stato: 'aperta', risoltaAt: null, risoltaDa: null });
  });

  it('un collaboratore non segna «risolta»', async () => {
    stato.nota = { ...NOTA };
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    expect((await chiama('PATCH', '/note-beta/n-1', { stato: 'risolta' })).statusCode).toBe(403);
    expect(stato.update).toEqual([]);
  });

  it('un collaboratore elimina la propria nota aperta, non quella di un altro né una risolta', async () => {
    stato.utente = { id: 'u-2', ruolo: 'collaboratore_interno' };
    stato.nota = { ...NOTA };
    expect((await chiama('DELETE', '/note-beta/n-1')).statusCode).toBe(200);
    stato.nota = { ...NOTA, userId: 'u-9' };
    expect((await chiama('DELETE', '/note-beta/n-1')).statusCode).toBe(403);
    stato.nota = { ...NOTA, stato: 'risolta' };
    expect((await chiama('DELETE', '/note-beta/n-1')).statusCode).toBe(403);
    expect(stato.cancellate).toEqual(['n-1']);
  });

  it('nota di un altro studio (non trovata nel proprio) → 404', async () => {
    stato.nota = null;
    expect((await chiama('PATCH', '/note-beta/n-x', { stato: 'risolta' })).statusCode).toBe(404);
  });
});
