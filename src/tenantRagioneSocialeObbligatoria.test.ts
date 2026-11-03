// 3.19 — Uno studio non nasce con un nome inventato.
//
// POST /admin/tenants scriveva `ragioneSociale || 'Nuovo Studio'`: senza ragione sociale lo studio
// veniva intestato a un nome mai scelto da nessuno, che poi finiva su documenti e solleciti.
// Ora la ragione sociale è obbligatoria e un campo vuoto (o di soli spazi) è un 400.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { creaTenant } = vi.hoisted(() => ({
  creaTenant: vi.fn(async (args: any) => ({ id: 't-nuovo', ...args?.data })),
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'super-1' ? { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => null,
    },
    tenant: { create: creaTenant },
    auditLog: { create: async () => ({}) },
  };
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function creaStudio(body: Record<string, unknown>) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: 'super-1', tenantId: TENANT, email: 'root@piattaforma.example', ruolo: 'super_admin', sessionVersion: 0 });
  const res = await server.inject({ method: 'POST', url: '/admin/tenants', headers: { authorization: `Bearer ${tok}` }, payload: body });
  await server.close();
  return res;
}

beforeEach(() => creaTenant.mockClear());

describe('POST /admin/tenants — la ragione sociale è obbligatoria', () => {
  it('senza ragione sociale: 400 e nessuno studio creato', async () => {
    const res = await creaStudio({ piano: 'pro' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('ragione sociale');
    expect(creaTenant).not.toHaveBeenCalled();
  });

  it('ragione sociale vuota o di soli spazi: 400, non «Nuovo Studio»', async () => {
    for (const ragioneSociale of ['', '   ']) {
      const res = await creaStudio({ ragioneSociale });
      expect(res.statusCode).toBe(400);
    }
    expect(creaTenant).not.toHaveBeenCalled();
  });

  it('con la ragione sociale lo studio nasce con quel nome, ripulito dagli spazi', async () => {
    const res = await creaStudio({ ragioneSociale: '  Studio Verdi  ' });
    expect(res.statusCode).toBe(201);
    expect(creaTenant.mock.calls[0]![0].data.ragioneSociale).toBe('Studio Verdi');
  });
});
