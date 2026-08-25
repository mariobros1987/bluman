/**
 * Blocco 4 (fix) — rotte inesistenti: 404, non 401.
 *
 * L'hook onRequest di autenticazione gira anche sul gestore not-found di
 * Fastify: se rispondesse 401 su qualunque URL sconosciuto, il 404
 * scomparirebbe del tutto e una rotta inesistente sarebbe indistinguibile
 * da una rotta esistente ma protetta. Questo è il difetto che questi test
 * bloccano: senza token, `/rotta-che-non-esiste` deve dare 404, mentre una
 * rotta esistente e protetta (es. /search) dà 401. La discriminazione tra
 * "la rotta c'è" e "la rotta non c'è" torna a funzionare anche per i
 * controlli di deploy che si basano proprio su questa differenza.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./util/prismaClient.js', async importOriginal => {
  // La ricerca non tocca il database in questi test: le richieste senza token
  // si fermano all'hook, quelle su rotte inesistenti al not-found handler.
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = { user: { findUnique: async () => null }, auditLog: { create: async () => ({}) } };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

function server() {
  return buildServer(new InMemoryApp()) as any;
}

describe('rotte inesistenti rispondono 404 anche senza token', () => {
  it('URL sconosciuto senza token → 404, non 401', async () => {
    const res = await server().inject({ method: 'GET', url: '/rotta-che-non-esiste-xyz' });
    expect(res.statusCode).toBe(404);
  });

  it('rotta esistente e protetta senza token → 401', async () => {
    const res = await server().inject({ method: 'GET', url: '/search?q=abc' });
    expect(res.statusCode).toBe(401);
    expect(res.json().errore).toBe('Non autenticato');
  });

  it('URL sconosciuto CON token → resta 404', async () => {
    const tok = signJwt({ userId: 'u', tenantId: TENANT, email: 'a@b.c', ruolo: 'advisor' });
    const res = await server().inject({
      method: 'GET',
      url: '/altra-rotta-mancante',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rotta pubblica senza token → resta accessibile (non 401)', async () => {
    const res = await server().inject({ method: 'GET', url: '/health' });
    // /health non richiede token: può rispondere 200 o 503 (DB di test
    // irraggiungibile), ma non deve mai chiedere autenticazione.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(404);
  });
});
