// 3.23 — Gli atti del super_admin su `/admin/tenants` si attribuiscono a chi li ha fatti.
//
// Creazione, rigenerazione della password del responsabile ed eliminazione di uno studio
// scrivevano l'audit senza `userId` (e con `ruolo: 'super_admin'` scritto a mano): il registro
// diceva cosa era successo ma non chi. La modifica dello studio non lasciava nessuna traccia.
// Regola 10 di CLAUDE.md: `recordAudit` riceve sempre userId, ruolo e ipAddress della richiesta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit, tenantRiga } = vi.hoisted(() => ({
  recordAudit: vi.fn(async () => {}),
  tenantRiga: { id: 't-studio', ragioneSociale: 'Studio Verdi', stato: 'archiviato', leadAdvisorEmail: 'resp@studio.example' } as any,
}));

vi.mock('./util/serverHelpers.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./util/serverHelpers.js')>()),
  recordAudit,
}));

vi.mock('./services/eliminazioneTenant.js', () => ({
  eliminaTenantCompleto: vi.fn(async () => ({ tenant: 1 })),
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'super-1' ? { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => null,
      create: async (args: any) => ({ id: 'u-nuovo', ...args?.data }),
    },
    tenant: {
      create: async (args: any) => ({ ...args?.data, id: 't-studio' }),
      update: async (args: any) => ({ ...tenantRiga, ...args?.data }),
      findUnique: async () => ({ ...tenantRiga }),
    },
    auditLog: { create: async () => ({}) },
  };
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    contestoTenant: { run: (_contesto: unknown, fn: () => unknown) => fn() },
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function chiama(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: 'super-1', tenantId: TENANT, email: 'root@piattaforma.example', ruolo: 'super_admin', sessionVersion: 0 });
  const res = await server.inject({
    method, url, payload, remoteAddress: '203.0.113.7',
    headers: { authorization: `Bearer ${tok}` },
  });
  await server.close();
  return res;
}

beforeEach(() => recordAudit.mockClear());

describe('/admin/tenants — l\'audit dice chi ha agito', () => {
  it.each([
    ['POST /admin/tenants', 'POST', '/admin/tenants', { ragioneSociale: 'Studio Verdi' }, 201, 'TENANT_CREATO'],
    ['PATCH /admin/tenants/:id', 'PATCH', '/admin/tenants/t-studio', { stato: 'sospeso' }, 200, 'TENANT_AGGIORNATO'],
    ['POST /admin/tenants/:id/reset-password', 'POST', '/admin/tenants/t-studio/reset-password', {}, 200, 'PASSWORD_RESPONSABILE_RIGENERATA'],
    ['DELETE /admin/tenants/:id', 'DELETE', '/admin/tenants/t-studio', undefined, 200, 'TENANT_ELIMINATO'],
  ] as const)('%s', async (_nome, method, url, payload, codice, azione) => {
    const res = await chiama(method, url, payload as Record<string, unknown> | undefined);

    expect(res.statusCode, res.body).toBe(codice);
    const audit = recordAudit.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.azione === azione);
    expect(audit).toMatchObject({ userId: 'super-1', ruolo: 'super_admin', ipAddress: '203.0.113.7' });
  });
});
