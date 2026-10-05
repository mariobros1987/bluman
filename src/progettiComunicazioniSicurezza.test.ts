import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chiamate = {
  create: [] as any[],
  update: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    cliente: {
      findFirst: async () => ({ nome: 'Cliente Verificato' }),
    },
    comunicazioneProgetto: {
      create: async (args: any) => {
        chiamate.create.push(args);
        return { id: 'msg-1', createdAt: new Date(), ...args.data };
      },
      findMany: async () => [{
        id: 'msg-studio',
        direzione: 'uscita',
        externalId: null,
        createdAt: new Date('2026-09-11T12:00:00Z'),
      }],
      update: async (args: any) => {
        chiamate.update.push(args);
        return args.data;
      },
    },
    progetto: {
      findUnique: async () => ({
        id: 'proj-1',
        nome: 'Progetto Cliente',
        cliente: { nome: 'Cliente Verificato' },
      }),
    },
    // La scrittura di un messaggio lega la riga e l'eventuale abbinamento alla micro-voce in una
    // transazione sola. Qui non c'è nessun contesto armato — e `findUnique` che risponde `null` è
    // il modo di dirlo: nessun abbinamento, senza dover fingere un `upsert` che non verrebbe
    // chiamato. I due metodi devono **esistere**, perché il 500 che manca è
    // «prisma.$transaction is not a function», che parla del finto e non di questa rotta.
    contestoMicrovoceChat: { findUnique: async () => null, update: async () => ({}) },
    $transaction: async (fn: any) => fn(prisma),
    notifica: { create: async () => ({}) },
  };
  return { ...reale, prisma };
});

vi.mock('./services/notificheService.js', () => ({
  notificaStudio: async () => undefined,
}));

const { registraRotteProgetti } = await import('./routes/progetti.js');
const TENANT = '00000000-0000-0000-0000-000000000001';

async function serverCliente() {
  const server = Fastify();
  server.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = 'cliente';
    req.userId = 'client-cli-1';
    req.user = {
      userId: 'client-cli-1',
      tenantId: TENANT,
      email: 'cliente@example.test',
      ruolo: 'cliente',
    };
  });
  await registraRotteProgetti(server, {
    getProgetto: async () => ({ id: 'proj-1', clienteId: 'cli-1' }),
  } as any);
  return server;
}

beforeEach(() => {
  chiamate.create.length = 0;
  chiamate.update.length = 0;
});

describe('comunicazioni progetto — confine cliente', () => {
  it('impone identità e direzione dal JWT invece di fidarsi del body', async () => {
    const server = await serverCliente();
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: {
        canale: 'portal',
        mittente: 'Advisor falsificato',
        destinatario: 'Altro cliente',
        direzione: 'uscita',
        testo: 'Messaggio legittimo',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(chiamate.create[0].data).toMatchObject({
      tenantId: TENANT,
      progettoId: 'proj-1',
      mittente: 'Cliente Verificato (Cliente)',
      destinatario: 'Studio',
      direzione: 'entrata',
      testo: 'Messaggio legittimo',
    });
    await server.close();
  });

  it('ignora la direzione richiesta e marca soltanto i messaggi dello studio', async () => {
    const server = await serverCliente();
    const res = await server.inject({
      method: 'PATCH',
      url: '/progetti/proj-1/comunicazioni/segna-lette',
      payload: { direzioneDaSegnare: 'entrata' },
    });

    expect(res.statusCode).toBe(200);
    expect(chiamate.update).toHaveLength(1);
    expect(res.json()).toEqual({ ok: true, aggiornati: 1 });
    await server.close();
  });

  it('rifiuta comunicazioni senza testo o canale', async () => {
    const server = await serverCliente();
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', testo: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(chiamate.create).toHaveLength(0);
    await server.close();
  });
});
