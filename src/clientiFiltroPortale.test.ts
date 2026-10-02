// Il filtro «accesso al portale» di GET /clienti.
//
// L'asserzione è sugli ARGOMENTI passati a Prisma, non sul corpo della risposta: il filtro vive
// nel `where`, e guardando il `where` si verifica il comportamento vero senza bisogno di un
// database. Asserire invece su una risposta costruita da un mock verificherebbe soltanto il mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findMany: any[] = [];
const count: any[] = [];

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  return {
    ...reale,
    prisma: {
      ...(reale.prisma as any),
      user: {
        ...(reale.prisma as any).user,
        findFirst: async (args: any) => args?.where?.id === 'admin-1'
          ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : (reale.prisma as any).user.findFirst(args),
      },
      cliente: {
        findMany: async (args: any) => { findMany.push(args); return []; },
        count: async (args: any) => { count.push(args); return 0; },
      },
    } as any,
  };
});

import { buildServer } from './server.js';
import { signJwt } from './util/jwt.js';

const token = signJwt({
  userId: 'admin-1',
  tenantId: 'tenant-test',
  ruolo: 'advisor',
  email: 'advisor@test.it',
  sessionVersion: 0,
});

async function leggi(url: string) {
  const server = await buildServer({} as any);
  return server.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

describe('GET /clienti — filtro accesso al portale', () => {
  beforeEach(() => {
    findMany.length = 0;
    count.length = 0;
  });

  it('?portale=senza chiede a Prisma i clienti con passwordHash null', async () => {
    const res = await leggi('/clienti?page=1&portale=senza');
    expect(res.statusCode).toBe(200);
    expect(findMany[0]?.where).toMatchObject({ passwordHash: null });
  });

  it('?portale=con chiede a Prisma i clienti con passwordHash valorizzato', async () => {
    const res = await leggi('/clienti?page=1&portale=con');
    expect(res.statusCode).toBe(200);
    expect(findMany[0]?.where).toMatchObject({ passwordHash: { not: null } });
  });

  it('senza il parametro non tocca passwordHash: nessun filtro di troppo', async () => {
    const res = await leggi('/clienti?page=1');
    expect(res.statusCode).toBe(200);
    expect(findMany[0]?.where).not.toHaveProperty('passwordHash');
  });

  it('un valore inventato è un 400, non un filtro ignorato in silenzio', async () => {
    const res = await leggi('/clienti?page=1&portale=forse');
    expect(res.statusCode).toBe(400);
    // La prova che è stato *rifiutato* e non semplicemente scartato: Prisma non è stato chiamato.
    expect(findMany).toHaveLength(0);
  });

  it('il riepilogo porta anche senzaPortale, contato dentro i filtri attivi', async () => {
    const res = await leggi('/clienti?page=1&tipo=company');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).riepilogo).toHaveProperty('senzaPortale');
    // Come per societa/persone: il conteggio riparte dall'insieme filtrato, non da tutti i clienti.
    expect(count.some(a => a.where?.passwordHash === null && a.where?.tipo === 'company')).toBe(true);
  });
});
