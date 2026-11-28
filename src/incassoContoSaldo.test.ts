// Su quale conto entra il denaro di un incasso, e se il saldo si muove **su quel conto**.
//
// Il difetto che questi test tenevano chiuso: il movimento in Prima Nota prendeva il conto indicato
// dall'operatore o quello di accredito della fattura, mentre il saldo veniva caricato — quando
// nessuno dei due c'era — sul **conto predefinito**. Il denaro entrava in un conto che nessuna riga
// nominava.
//
// Dal 28/11/2026 (decisione del titolare) il conto è **obbligatorio**: lo indica l'operatore, il
// server controlla che sia dello studio, e movimento e saldo nominano quello. Il server non sceglie
// più al suo posto (conto della fattura, predefinito), e senza conti l'incasso non si registra. I
// tre test che confermavano la scelta automatica sono stati riscritti qui, nello stesso commit.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  /** I conti dello studio: `findFirst` per id risponde solo per questi. */
  contiStudio: ['c-scelto', 'c-predefinito'] as string[],
  contoAccreditoFattura: null as string | null,
  statoScadenza: 'in_attesa',
  /** Rate sorelle della stessa fattura, oltre a sc-1. */
  altreRate: [] as Array<{ id: string; stato: string }>,
}));

const { creaMovimento, aggiornaSaldo, trovaConto, creaRegistrazione } = vi.hoisted(() => ({
  creaMovimento: vi.fn(async (args: any) => ({ id: 'mv-1', ...args.data })),
  creaRegistrazione: vi.fn(async (args: any) => ({ id: 'reg-1', ...args.data })),
  aggiornaSaldo: vi.fn(async () => ({})),
  trovaConto: vi.fn(async (args: any) => {
    const id = args?.where?.id;
    if (id) return db.contiStudio.includes(id) ? { id } : null;
    return db.contiStudio[0] ? { id: db.contiStudio[0] } : null;
  }),
}));

const { aggiornaFattura } = vi.hoisted(() => ({ aggiornaFattura: vi.fn(async () => ({})) }));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' }),
    },
    cliente: {
      findFirst: async (args: any) => (args?.where?.id === 'cli-1' ? { sessionVersion: 0 } : null),
      findMany: async () => [],
    },
    tenant: {
      findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }),
      findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }),
    },
    permessoModulo: { findUnique: async () => null },
    scadenzaIncasso: {
      findUnique: async () => ({
        id: 'sc-1',
        tenantId: 't-1',
        fatturaId: 'f-1',
        numeroRata: 1,
        importoCentesimi: 100000,
        stato: db.statoScadenza,
        registrazioniRegistrate: [],
        fattura: {
          id: 'f-1',
          numero: 'FT-2026/001',
          numeroProgressivoSerie: 1,
          stato: 'emessa',
          clienteId: 'cli-1',
          contoAccreditoId: db.contoAccreditoFattura,
          cliente: { id: 'cli-1', nome: 'Alpha Corp' },
          progetto: null,
        },
      }),
      findMany: async (args: any) =>
        args?.where?.fatturaId === 'f-1'
          ? [{ id: 'sc-1', stato: db.statoScadenza }, ...db.altreRate]
          : [],
      update: async () => ({}),
    },
    registrazioneIncasso: { create: creaRegistrazione },
    fattura: { update: aggiornaFattura },
    movimentoPrimaNota: { create: creaMovimento },
    contoBancario: { findFirst: trovaConto, update: aggiornaSaldo },
    auditLog: { create: async () => ({}) },
  };
  // `attivaContestoTenant` riceve un **contesto**, non una callback, e l'hook la chiama senza
  // `await`: una firma sbagliata qui non fa fallire la richiesta, lascia una promessa rifiutata.
  prisma.$transaction = async (fn: any) => fn(prisma);
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    riprovaSuConflitto: async (fn: any) => fn(),
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./util/serverHelpers.js')>()),
  recordAudit: vi.fn(async () => undefined),
}));

async function incassa(body: any) {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({
    userId: 'admin-1',
    tenantId: 't-1',
    ruolo: 'advisor',
    email: 'ada@studio.it',
    sessionVersion: 0,
  });
  return server.inject({
    method: 'POST',
    url: '/invoices/scadenze/sc-1/incassi',
    headers: { authorization: `Bearer ${token}` },
    // Importo parziale di proposito: la rata resta aperta, quindi non partono notifiche e il test
    // guarda solo ciò che gli interessa — dove entra il denaro. Il conto c'è sempre, salvo nei
    // test che provano proprio la sua assenza (`contoBancarioId: undefined`).
    payload: { importoIncassatoCentesimi: 40000, contoBancarioId: 'c-scelto', ...body },
  });
}

describe('POST /invoices/scadenze/:id/incassi — il conto è obbligatorio e lo sceglie l\'operatore', () => {
  beforeEach(() => {
    creaMovimento.mockClear();
    creaRegistrazione.mockClear();
    aggiornaSaldo.mockClear();
    trovaConto.mockClear();
    db.contiStudio = ['c-scelto', 'c-predefinito'];
    db.contoAccreditoFattura = null;
    db.statoScadenza = 'in_attesa';
  });

  it('il conto scelto dall\'operatore: movimento e saldo nominano quello', async () => {
    const res = await incassa({ contoBancarioId: 'c-scelto' });

    expect(res.statusCode).toBe(201);
    expect(creaMovimento).toHaveBeenCalledTimes(1);
    expect(creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-scelto');
    expect(aggiornaSaldo).toHaveBeenCalledWith({
      where: { id: 'c-scelto' },
      data: { saldoAttuale: { increment: 40000 } },
    });
  });

  it('senza conto indicato → 400: il server non sceglie più il predefinito', async () => {
    // Prima questo incasso finiva sul conto predefinito senza che nessuno lo avesse detto.
    const res = await incassa({ contoBancarioId: undefined });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ codice: 'CONTO_OBBLIGATORIO' });
    expect(creaRegistrazione).not.toHaveBeenCalled();
    expect(creaMovimento).not.toHaveBeenCalled();
    expect(aggiornaSaldo).not.toHaveBeenCalled();
  });

  it('senza conto indicato non vale nemmeno il conto di accredito della fattura', async () => {
    db.contoAccreditoFattura = 'c-predefinito';

    const res = await incassa({ contoBancarioId: undefined });

    expect(res.statusCode).toBe(400);
    expect(creaMovimento).not.toHaveBeenCalled();
  });

  it('studio senza conti → 409 che manda a Banche e conti, e niente viene scritto', async () => {
    // Prima il movimento restava «senza conto» e non entrava in nessun saldo.
    db.contiStudio = [];

    const res = await incassa({ contoBancarioId: undefined });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ codice: 'NESSUN_CONTO' });
    expect(res.json().errore).toMatch(/Banche e conti/);
    expect(creaRegistrazione).not.toHaveBeenCalled();
    expect(creaMovimento).not.toHaveBeenCalled();
  });

  it('un conto che non è dello studio → 400, e nessun saldo si muove', async () => {
    const res = await incassa({ contoBancarioId: 'c-di-un-altro-studio' });

    expect(res.statusCode).toBe(400);
    expect(creaRegistrazione).not.toHaveBeenCalled();
    expect(aggiornaSaldo).not.toHaveBeenCalled();
  });

  it('il movimento nomina la registrazione da cui nasce (serve allo storno)', async () => {
    const res = await incassa({});

    expect(res.statusCode).toBe(201);
    expect(creaMovimento.mock.calls[0]![0].data.registrazioneIncassoId).toBe('reg-1');
  });
});

describe('POST /invoices/scadenze/:id/incassi — la data dell’incasso è quella indicata (A4)', () => {
  beforeEach(() => {
    creaMovimento.mockClear();
    creaRegistrazione.mockClear();
    db.contoAccreditoFattura = null;
    db.statoScadenza = 'in_attesa';
  });

  it('un incasso del mese scorso porta quella data su registrazione e movimento', async () => {
    const oggi = new Date();
    const meseScorso = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - 1, 10, 10));

    const res = await incassa({ dataIncasso: meseScorso.toISOString() });

    expect(res.statusCode).toBe(201);
    expect(creaRegistrazione.mock.calls[0]![0].data.dataIncasso).toEqual(meseScorso);
    expect(creaMovimento.mock.calls[0]![0].data.data).toEqual(meseScorso);
  });

  it('senza data, registrazione e movimento portano la stessa data di oggi', async () => {
    const res = await incassa({});

    expect(res.statusCode).toBe(201);
    const dataRegistrazione: Date = creaRegistrazione.mock.calls[0]![0].data.dataIncasso;
    expect(dataRegistrazione).toBeInstanceOf(Date);
    expect(creaMovimento.mock.calls[0]![0].data.data).toEqual(dataRegistrazione);
  });

  it('una data futura → 400, niente registrazione né movimento', async () => {
    const dopodomani = new Date(Date.now() + 2 * 86_400_000);

    const res = await incassa({ dataIncasso: dopodomani.toISOString() });

    expect(res.statusCode).toBe(400);
    expect(creaRegistrazione).not.toHaveBeenCalled();
    expect(creaMovimento).not.toHaveBeenCalled();
  });
});

describe('POST /invoices/scadenze/:id/incassi — rate stornate e fattura incassata (A8)', () => {
  beforeEach(() => {
    aggiornaFattura.mockClear();
    db.contoAccreditoFattura = null;
    db.statoScadenza = 'in_attesa';
    db.altreRate = [];
  });

  it('una rata stornata e una incassata → fattura incassata', async () => {
    db.altreRate = [{ id: 'sc-2', stato: 'stornata' }];

    const res = await incassa({ importoIncassatoCentesimi: 100000 });

    expect(res.statusCode).toBe(201);
    expect(aggiornaFattura).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { stato: 'incassata' } });
  });

  it('una rata stornata e una incassata solo in parte → fattura ancora emessa', async () => {
    db.altreRate = [{ id: 'sc-2', stato: 'stornata' }];

    const res = await incassa({ importoIncassatoCentesimi: 40000 });

    expect(res.statusCode).toBe(201);
    expect(aggiornaFattura).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { stato: 'emessa' } });
  });
});
