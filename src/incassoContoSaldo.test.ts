// Quale conto riceve il denaro di un incasso, e se il saldo si muove **su quel conto**.
//
// Il difetto che questi test tengono chiuso: il movimento in Prima Nota prendeva il conto indicato
// dall'operatore o quello di accredito della fattura, mentre il saldo veniva caricato — quando
// nessuno dei due c'era — sul **conto predefinito**. Il denaro entrava in un conto che nessuna riga
// nominava: chi guardava la Prima Nota vedeva un incasso senza conto, chi guardava i saldi vedeva
// un conto cresciuto, e le due cose non si potevano riconciliare perché nessuna delle due diceva
// dove fosse il denaro.
//
// La regola ora è una: il conto si decide **una volta**, e il movimento e il saldo lo nominano
// entrambi. Questi test la seguono nei quattro casi che si presentano davvero.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { creaMovimento, aggiornaSaldo, trovaPredefinito } = vi.hoisted(() => ({
  creaMovimento: vi.fn(async (args: any) => ({ id: 'mv-1', ...args.data })),
  aggiornaSaldo: vi.fn(async () => ({})),
  trovaPredefinito: vi.fn(async () => ({ id: 'c-predefinito' })),
}));

const db = vi.hoisted(() => ({
  contoAccreditoFattura: null as string | null,
  statoScadenza: 'in_attesa',
}));

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
          ? [{ id: 'sc-1', stato: db.statoScadenza }]
          : [],
      update: async () => ({}),
    },
    registrazioneIncasso: { create: async (args: any) => ({ id: 'reg-1', ...args.data }) },
    fattura: { update: async () => ({}) },
    movimentoPrimaNota: { create: creaMovimento },
    contoBancario: { findFirst: trovaPredefinito, update: aggiornaSaldo },
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
    // guarda solo ciò che gli interessa — dove entra il denaro.
    payload: { importoIncassatoCentesimi: 40000, ...body },
  });
}

describe('POST /invoices/scadenze/:id/incassi — il movimento e il saldo nominano lo stesso conto', () => {
  beforeEach(() => {
    creaMovimento.mockClear();
    aggiornaSaldo.mockClear();
    trovaPredefinito.mockClear();
    db.contoAccreditoFattura = null;
    db.statoScadenza = 'in_attesa';
  });

  it('senza conto indicato, il denaro va sul predefinito — e il movimento lo dice', async () => {
    // Il caso del difetto: prima il movimento usciva **senza conto** e il saldo cresceva sul
    // predefinito. Il denaro era in un conto che la Prima Nota non nominava.
    const res = await incassa({});

    expect(res.statusCode).toBe(201);
    expect(creaMovimento).toHaveBeenCalledTimes(1);
    expect(creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-predefinito');
    expect(aggiornaSaldo).toHaveBeenCalledWith({
      where: { id: 'c-predefinito' },
      data: { saldoAttuale: { increment: 40000 } },
    });
  });

  it('il conto scelto dall\'operatore vince su tutto, e non si cerca il predefinito', async () => {
    const res = await incassa({ contoBancarioId: 'c-scelto' });

    expect(res.statusCode).toBe(201);
    expect(creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-scelto');
    expect(aggiornaSaldo).toHaveBeenCalledWith({
      where: { id: 'c-scelto' },
      data: { saldoAttuale: { increment: 40000 } },
    });
    // Se il predefinito venisse comunque letto, il conto sarebbe deciso due volte.
    expect(trovaPredefinito).not.toHaveBeenCalled();
  });

  it('il conto di accredito della fattura vince sul predefinito', async () => {
    db.contoAccreditoFattura = 'c-fattura';

    await incassa({});

    expect(creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-fattura');
    expect(aggiornaSaldo).toHaveBeenCalledWith({
      where: { id: 'c-fattura' },
      data: { saldoAttuale: { increment: 40000 } },
    });
    expect(trovaPredefinito).not.toHaveBeenCalled();
  });

  it('senza nessun conto disponibile il movimento resta non attribuito e nessun saldo si muove', async () => {
    // Non c'è un conto predefinito: non se ne inventa uno. Il movimento resta in elenco senza
    // conto — visibile come non attribuito — invece di caricare il denaro su una banca a caso.
    trovaPredefinito.mockResolvedValueOnce(null as any);

    const res = await incassa({});

    expect(res.statusCode).toBe(201);
    expect(creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBeNull();
    expect(aggiornaSaldo).not.toHaveBeenCalled();
  });
});
