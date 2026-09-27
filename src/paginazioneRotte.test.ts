import Fastify from 'fastify';
import type { Ruolo } from './util/authorization.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chiamate = { progetto: [] as any[], fattura: [] as any[], movimento: [] as any[], cliente: [] as any[], audit: [] as any[] };
const righe = { progetto: [] as any[], fattura: [] as any[], movimento: [] as any[], cliente: [] as any[], audit: [] as any[] };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const modello = (nome: keyof typeof chiamate) => ({
    findMany: async (args: any) => { chiamate[nome].push(['findMany', args]); return righe[nome]; },
    count: async (args: any) => { chiamate[nome].push(['count', args]); return 7; },
  });
  const movimento = {
    ...modello('movimento'),
    aggregate: async (args: any) => ({ _sum: { importoCentesimi: args.where.tipo === 'entrata' ? 12000 : 4500 } }),
  };
  const cliente = {
    ...modello('cliente'),
    findUnique: async (args: any) => {
      chiamate.cliente.push(['findUnique', args]);
      return righe.cliente[0] ?? null;
    },
    create: async (args: any) => {
      chiamate.cliente.push(['create', args]);
      return { id: 'c-creato', ...args.data };
    },
    update: async (args: any) => {
      chiamate.cliente.push(['update', args]);
      return { id: args.where.id, nome: 'Cliente aggiornato', tipo: 'company', ...args.data };
    },
    count: async (args: any) => {
      chiamate.cliente.push(['count', args]);
      return args.where.tipo === 'company' ? 4 : args.where.tipo === 'individual' ? 3 : 7;
    },
  };
  const fattura = {
    ...modello('fattura'),
    aggregate: async (args: any) => {
      chiamate.fattura.push(['aggregate', args]);
      const tipo = args.where.tipoDocumento;
      const stato = args.where.stato;
      const valore = tipo === 'nota_credito' ? 1500 : stato === 'incassata' ? 8000 : stato === 'emessa' ? 3500 : 11500;
      return { _sum: { totaleDocumentoCentesimi: valore } };
    },
  };
  const finto: any = {
    progetto: modello('progetto'), fattura, movimentoPrimaNota: movimento,
    cliente,
    auditLog: { ...modello('audit'), create: async (args: any) => ({ id: 'audit-1', ...args.data }) },
    tenant: { findUnique: async () => null },
    magicLink: { updateMany: async () => ({ count: 0 }) },
    $executeRaw: async () => 1,
  };
  finto.$transaction = async (fn: any) => fn(finto);
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { registraRotteProgetti } = await import('./routes/progetti.js');
const { registraRotteClienti } = await import('./routes/clienti.js');
const { registraRotteContabilitaRegistro } = await import('./routes/contabilitaRegistro.js');
const { registraRotteContabilitaPrimaNota } = await import('./routes/contabilitaPrimaNota.js');
const { registraRotteTenant } = await import('./routes/tenant.js');
const TENANT = '00000000-0000-0000-0000-000000000001';

async function serverCon(registra: (server: any, app?: any) => Promise<void>, identita?: { ruolo: Ruolo; userId: string }) {
  const server = Fastify();
  server.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = identita?.ruolo ?? 'advisor';
    req.user = identita ? { userId: identita.userId, tenantId: TENANT, email: 'x@example.test', ruolo: identita.ruolo } as any : null;
  });
  await registra(server, {} as any);
  return server;
}

beforeEach(() => {
  for (const valore of Object.values(chiamate)) valore.length = 0;
  for (const valore of Object.values(righe)) valore.length = 0;
});

describe('rotte paginate', () => {
  it('GET /clienti applica skip/take, ricerca e sort e non espone passwordHash', async () => {
    righe.cliente.push({
      id: 'c1',
      nome: 'Alfa',
      tipo: 'company',
      passwordHash: 'segreto',
      referentiJson: { passwordHash: 'segreto-json', password: 'segreto-chiaro', telefono: '123' },
    });
    const server = await serverCon(registraRotteClienti);
    const res = await server.inject({ method: 'GET', url: '/clienti?page=2&limit=25&search=Alfa&sortBy=nome&sortOrder=asc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [{ id: 'c1', hasPassword: true }], meta: { page: 2, limit: 25, totale: 7, pagine: 1 }, riepilogo: { societa: 4, persone: 3 } });
    expect(res.json().data[0].passwordHash).toBeUndefined();
    expect(res.json().data[0].password).toBeUndefined();
    expect(res.json().data[0].referentiJson.passwordHash).toBeUndefined();
    expect(res.json().data[0].referentiJson.password).toBeUndefined();
    const args = chiamate.cliente[0][1];
    expect(args).toMatchObject({ skip: 25, take: 25, orderBy: { nome: 'asc' }, where: { tenantId: TENANT } });
    expect(args.where.OR[0]).toEqual({ nome: { contains: 'Alfa', mode: 'insensitive' } });
    await server.close();
  });

  it('GET /clienti applica il filtro tipo e rifiuta valori non validi', async () => {
    const server = await serverCon(registraRotteClienti);
    const res = await server.inject({ method: 'GET', url: '/clienti?page=1&tipo=company' });
    expect(res.statusCode).toBe(200);
    expect(chiamate.cliente[0][1].where).toMatchObject({ tenantId: TENANT, tipo: 'company' });
    const no = await server.inject({ method: 'GET', url: '/clienti?page=1&tipo=altro' });
    expect(no.statusCode).toBe(400);
    await server.close();
  });

  it('POST e PUT /clienti non restituiscono né persistono segreti nei referenti', async () => {
    const server = await serverCon(registraRotteClienti);
    const payload = {
      nome: 'Alfa',
      tipo: 'company',
      password: 'password-temporanea',
      referentiJson: { email: 'INFO@EXAMPLE.TEST', passwordHash: 'hash-iniettato', password: 'chiaro' },
    };
    const creato = await server.inject({ method: 'POST', url: '/clienti', payload });
    expect(creato.statusCode).toBe(201);
    expect(creato.json().passwordHash).toBeUndefined();
    expect(creato.json().password).toBeUndefined();
    expect(creato.json().referentiJson).toEqual({ email: 'INFO@EXAMPLE.TEST' });
    const createArgs = chiamate.cliente.find(([metodo]) => metodo === 'create')?.[1];
    expect(createArgs.data.sdiCode).toBeNull();
    expect(createArgs.data.referentiJson).toEqual({ email: 'INFO@EXAMPLE.TEST' });

    const { password: _password, ...datiAnagrafici } = payload;
    const aggiornato = await server.inject({ method: 'PUT', url: '/clienti/c1', payload: datiAnagrafici });
    expect(aggiornato.statusCode).toBe(200);
    expect(aggiornato.json().passwordHash).toBeUndefined();
    expect(aggiornato.json().password).toBeUndefined();
    expect(aggiornato.json().referentiJson).toEqual({ email: 'INFO@EXAMPLE.TEST' });
    const updateArgs = chiamate.cliente.find(([metodo]) => metodo === 'update')?.[1];
    expect(updateArgs.data).not.toHaveProperty('passwordHash');
    expect(updateArgs.data.referentiJson).toEqual({ email: 'INFO@EXAMPLE.TEST' });
    await server.close();
  });

  it.each(['collaboratore_interno', 'collaboratore_esterno'] as const)(
    'PUT /clienti rifiuta il cambio password richiesto da %s senza tentare scritture',
    async ruolo => {
      const server = await serverCon(registraRotteClienti, { ruolo, userId: `usr-${ruolo}` });
      const res = await server.inject({
        method: 'PUT',
        url: '/clienti/c1',
        payload: { nome: 'Alfa aggiornata', password: 'PasswordControllata!2026' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().errore).toMatch(/procedura dedicata/i);
      expect(chiamate.cliente.some(([metodo]) => metodo === 'update')).toBe(false);
      await server.close();
    },
  );

  it('GET /clienti senza parametri mantiene l array legacy e non esegue count', async () => {
    righe.cliente.push({ id: 'c1', nome: 'Alfa', tipo: 'company', referentiJson: {} });
    const server = await serverCon(registraRotteClienti);
    const res = await server.inject({ method: 'GET', url: '/clienti' });
    expect(Array.isArray(res.json())).toBe(true);
    expect(chiamate.cliente.map(c => c[0])).toEqual(['findMany']);
    await server.close();
  });

  it('GET /invoices restituisce meta e inoltra solo un ordinamento consentito', async () => {
    const server = await serverCon(registraRotteContabilitaRegistro);
    const res = await server.inject({ method: 'GET', url: '/invoices?page=3&limit=2&search=FT-1&sortBy=data&sortOrder=asc' });
    expect(res.json()).toEqual({
      data: [],
      meta: { page: 3, limit: 2, totale: 7, pagine: 4 },
      riepilogo: {
        totaleEmessoCentesimi: 11500,
        totaleIncassatoCentesimi: 8000,
        totaleSospesoCentesimi: 3500,
        totaleNoteCreditoCentesimi: 1500,
      },
    });
    expect(chiamate.fattura[0][1]).toMatchObject({ skip: 4, take: 2, orderBy: { data: 'asc' } });
    expect(chiamate.fattura[0][1].where.OR[0].numero.contains).toBe('FT-1');
    const no = await server.inject({ method: 'GET', url: '/invoices?sortBy=passwordHash' });
    expect(no.statusCode).toBe(400);
    await server.close();
  });

  it('GET /progetti col filtro periodo costruisce la sovrapposizione (nullable) in where.AND', async () => {
    const server = await serverCon(registraRotteProgetti);
    const res = await server.inject({ method: 'GET', url: '/progetti?page=1&dataDa=2026-01-01&dataA=2026-12-31' });
    expect(res.statusCode).toBe(200);
    const where = chiamate.progetto.find(c => c[0] === 'findMany')![1].where;
    expect(where.AND).toEqual([
      { OR: [{ dataInizio: null }, { dataInizio: { lte: new Date('2026-12-31T23:59:59.999Z') } }] },
      { OR: [{ dataScadenza: null }, { dataScadenza: { gte: new Date('2026-01-01T00:00:00.000Z') } }] },
    ]);
    // findMany e count condividono lo stesso where (paginazione e conteggio allineati)
    expect(chiamate.progetto.find(c => c[0] === 'count')![1].where.AND).toHaveLength(2);
    await server.close();
  });

  it('GET /progetti con solo dataDa resta aperto a destra e rifiuta le date impossibili', async () => {
    const server = await serverCon(registraRotteProgetti);
    const res = await server.inject({ method: 'GET', url: '/progetti?page=1&dataDa=2026-06-01' });
    expect(res.statusCode).toBe(200);
    expect(chiamate.progetto.find(c => c[0] === 'findMany')![1].where.AND).toEqual([
      { OR: [{ dataScadenza: null }, { dataScadenza: { gte: new Date('2026-06-01T00:00:00.000Z') } }] },
    ]);
    const no = await server.inject({ method: 'GET', url: '/progetti?page=1&dataDa=2026-02-30' });
    expect(no.statusCode).toBe(400);
    await server.close();
  });

  it('GET /invoices col filtro periodo aggiunge where.data e circoscrive anche gli aggregate', async () => {
    const server = await serverCon(registraRotteContabilitaRegistro);
    const res = await server.inject({ method: 'GET', url: '/invoices?page=1&dataDa=2026-01-01&dataA=2026-03-31' });
    expect(res.statusCode).toBe(200);
    const atteso = { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-03-31T23:59:59.999Z') };
    expect(chiamate.fattura.find(c => c[0] === 'findMany')![1].where.data).toEqual(atteso);
    // ogni aggregate del riepilogo eredita lo stesso where → totali sul solo periodo
    expect(chiamate.fattura.filter(c => c[0] === 'aggregate').every(c => {
      return JSON.stringify(c[1].where.data) === JSON.stringify(atteso);
    })).toBe(true);
    const no = await server.inject({ method: 'GET', url: '/invoices?page=1&dataA=non-valida' });
    expect(no.statusCode).toBe(400);
    await server.close();
  });

  it('GET /invoices applica il filtro stato e rifiuta valori non validi', async () => {
    const server = await serverCon(registraRotteContabilitaRegistro);
    const res = await server.inject({ method: 'GET', url: '/invoices?page=1&stato=emessa' });
    expect(res.statusCode).toBe(200);
    expect(chiamate.fattura[0][1].where).toMatchObject({ tenantId: TENANT, stato: 'emessa' });
    const no = await server.inject({ method: 'GET', url: '/invoices?page=1&stato=sconosciuta' });
    expect(no.statusCode).toBe(400);
    await server.close();
  });

  it('GET /invoices calcola i KPI aggregati sull intero filtro', async () => {
    const server = await serverCon(registraRotteContabilitaRegistro);
    const res = await server.inject({ method: 'GET', url: '/invoices?page=1&limit=25&search=Alfa' });
    expect(res.json().riepilogo).toEqual({
      totaleEmessoCentesimi: 11500,
      totaleIncassatoCentesimi: 8000,
      totaleSospesoCentesimi: 3500,
      totaleNoteCreditoCentesimi: 1500,
    });
    const aggregati = chiamate.fattura.filter(([metodo]) => metodo === 'aggregate');
    expect(aggregati).toHaveLength(4);
    for (const [, args] of aggregati) {
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.where.OR[0].numero.contains).toBe('Alfa');
    }
    await server.close();
  });

  it('GET /prima-nota restituisce il riepilogo aggregato sull intero filtro', async () => {
    const server = await serverCon(registraRotteContabilitaPrimaNota);
    const res = await server.inject({ method: 'GET', url: '/prima-nota?page=1&limit=50&search=bonifico' });
    expect(res.json()).toMatchObject({ meta: { totale: 7 }, riepilogo: { totaleEntrateCentesimi: 12000, totaleUsciteCentesimi: 4500, saldoCentesimi: 7500 } });
    expect(chiamate.movimento[0][1]).toMatchObject({ skip: 0, take: 50 });
    await server.close();
  });

  it('GET /prima-nota applica tipo e metodo e rifiuta valori non validi', async () => {
    const server = await serverCon(registraRotteContabilitaPrimaNota);
    const res = await server.inject({ method: 'GET', url: '/prima-nota?page=1&tipo=uscita&metodo=carta' });
    expect(res.statusCode).toBe(200);
    expect(chiamate.movimento[0][1].where).toMatchObject({ tenantId: TENANT, tipo: 'uscita', metodoPagamento: 'carta' });
    const tipoNo = await server.inject({ method: 'GET', url: '/prima-nota?page=1&tipo=altro' });
    expect(tipoNo.statusCode).toBe(400);
    const metodoNo = await server.inject({ method: 'GET', url: '/prima-nota?page=1&metodo=crypto' });
    expect(metodoNo.statusCode).toBe(400);
    await server.close();
  });

  it('GET /audit-logs pagina e ricerca nel tenant corrente', async () => {
    const server = await serverCon(registraRotteTenant);
    const res = await server.inject({ method: 'GET', url: '/audit-logs?page=2&limit=3&search=LOGIN&sortBy=azione' });
    expect(res.json()).toEqual({ data: [], meta: { page: 2, limit: 3, totale: 7, pagine: 3 } });
    expect(chiamate.audit[0][1]).toMatchObject({ skip: 3, take: 3, where: { tenantId: TENANT }, orderBy: { azione: 'desc' } });
    expect(chiamate.audit[0][1].where.OR).toHaveLength(5);
    await server.close();
  });

  it('GET /progetti paginato preserva clienteId in findMany e count anche con ricerca', async () => {
    const server = await serverCon(registraRotteProgetti, { ruolo: 'cliente', userId: 'client-cli-42' });
    const res = await server.inject({ method: 'GET', url: '/progetti?page=2&limit=10&search=Holding&sortBy=nome&sortOrder=asc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toEqual({ page: 2, limit: 10, totale: 7, pagine: 1 });
    for (const [, args] of chiamate.progetto) {
      expect(args.where).toMatchObject({ tenantId: TENANT, clienteId: 'cli-42' });
      expect(args.where.OR[0]).toEqual({ nome: { contains: 'Holding', mode: 'insensitive' } });
    }
    expect(chiamate.progetto[0][1]).toMatchObject({ skip: 10, take: 10, orderBy: { nome: 'asc' } });
    await server.close();
  });
});
