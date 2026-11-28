// Storno di un incasso (domanda 5 al titolare, risposta del 28/11/2026: «solo storno»).
//
// Prima non c'era modo di annullare un incasso sbagliato: il movimento in Prima Nota non si
// elimina (lucchetto, E7 del 26/11) e la rata restava «incassata». Lo storno scrive la riga
// contraria, riapre la rata, fa uscire il denaro dallo stesso conto e lascia chi e perché.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fatturaSaldata,
  incassiStornabili,
  motivoIncassoNonStornabile,
  movimentoDellIncasso,
  statoRataDaIncassato,
  totaleIncassatoCentesimi,
} from './domain/stornoIncasso.js';

describe('domain/stornoIncasso — regole pure', () => {
  const incasso = { id: 'reg-1', importoIncassatoCentesimi: 40000, stornoDiId: null };
  const storno = { id: 'reg-2', importoIncassatoCentesimi: -40000, stornoDiId: 'reg-1' };

  it('l’incassato di una rata è incassi meno storni', () => {
    expect(totaleIncassatoCentesimi([incasso])).toBe(40000);
    expect(totaleIncassatoCentesimi([incasso, storno])).toBe(0);
  });

  it('si possono stornare solo gli incassi veri non ancora stornati', () => {
    const altro = { id: 'reg-3', importoIncassatoCentesimi: 10000, stornoDiId: null };
    expect(incassiStornabili([incasso, altro]).map((r) => r.id)).toEqual(['reg-1', 'reg-3']);
    expect(incassiStornabili([incasso, storno, altro]).map((r) => r.id)).toEqual(['reg-3']);
  });

  it('uno storno non si storna, e un incasso si storna una volta sola', () => {
    const ok = { statoFattura: 'emessa', statoRata: 'incassato' };
    expect(motivoIncassoNonStornabile(incasso, [incasso], ok)).toBeNull();
    expect(motivoIncassoNonStornabile(storno, [incasso, storno], ok)).toMatch(/già uno storno/);
    expect(motivoIncassoNonStornabile(incasso, [incasso, storno], ok)).toMatch(/già stato stornato/);
  });

  it('fattura annullata o rata chiusa da Nota di Credito → non si storna', () => {
    expect(motivoIncassoNonStornabile(incasso, [incasso], { statoFattura: 'annullata', statoRata: 'incassato' })).toMatch(/Nota di Credito/);
    expect(motivoIncassoNonStornabile(incasso, [incasso], { statoFattura: 'emessa', statoRata: 'stornata' })).toMatch(/Nota di Credito/);
  });

  it('lo stato della rata segue l’incassato', () => {
    expect(statoRataDaIncassato(100000, 0)).toBe('in_attesa');
    expect(statoRataDaIncassato(100000, 40000)).toBe('parziale');
    expect(statoRataDaIncassato(100000, 100000)).toBe('incassato');
  });

  it('fattura saldata: ogni rata incassata o stornata, e almeno una incassata (A8)', () => {
    expect(fatturaSaldata(['incassato', 'stornata'])).toBe(true);
    expect(fatturaSaldata(['incassato', 'in_attesa'])).toBe(false);
    expect(fatturaSaldata(['stornata', 'stornata'])).toBe(false);
  });

  describe('movimentoDellIncasso — da quale conto esce lo storno', () => {
    const quando = new Date('2026-11-20T10:00:00.000Z');
    const inc = { id: 'reg-1', importoIncassatoCentesimi: 40000, dataIncasso: quando };
    const mov = (id: string, extra: Record<string, unknown> = {}) => ({
      id, contoBancarioId: 'c-1', importoCentesimi: 40000, data: quando, registrazioneIncassoId: null as string | null, ...extra,
    });

    it('il movimento che nomina l’incasso vince su tutto', () => {
      const legato = mov('mv-2', { registrazioneIncassoId: 'reg-1', contoBancarioId: 'c-2', importoCentesimi: 1 });
      expect(movimentoDellIncasso(inc, [mov('mv-1'), legato])?.id).toBe('mv-2');
    });

    it('incasso di prima del legame: stesso importo e stessa data', () => {
      const altraData = mov('mv-1', { data: new Date('2026-11-01T10:00:00.000Z'), contoBancarioId: 'c-9' });
      expect(movimentoDellIncasso(inc, [altraData, mov('mv-2')])?.id).toBe('mv-2');
    });

    it('un movimento già legato a un altro incasso non si riusa', () => {
      expect(movimentoDellIncasso(inc, [mov('mv-1', { registrazioneIncassoId: 'reg-altro' })])).toBeNull();
    });

    it('più candidati su conti diversi → non si sceglie a caso', () => {
      expect(movimentoDellIncasso(inc, [mov('mv-1'), mov('mv-2', { contoBancarioId: 'c-2' })])).toBeNull();
    });

    it('nessun movimento con quell’importo → null', () => {
      expect(movimentoDellIncasso(inc, [mov('mv-1', { importoCentesimi: 39999 })])).toBeNull();
    });
  });
});

// ─── La rotta ────────────────────────────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  statoFattura: 'incassata',
  statoRata: 'incassato',
  registrazioni: [] as any[],
  movimenti: [] as any[],
  altreRate: [] as Array<{ id: string; stato: string }>,
}));

const spie = vi.hoisted(() => ({
  creaRegistrazione: vi.fn(async (args: any) => ({ id: 'reg-storno', ...args.data })),
  creaMovimento: vi.fn(async (args: any) => ({ id: 'mv-storno', ...args.data })),
  aggiornaMovimento: vi.fn(async () => ({})),
  aggiornaSaldo: vi.fn(async () => ({})),
  aggiornaRata: vi.fn(async () => ({})),
  aggiornaFattura: vi.fn(async () => ({})),
  audit: vi.fn(async () => undefined),
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' }),
    },
    cliente: { findFirst: async () => null, findMany: async () => [] },
    tenant: {
      findUnique: async () => ({ id: 't-1', moduliDisattivati: [] }),
      findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }),
    },
    permessoModulo: { findUnique: async () => null },
    scadenzaIncasso: {
      findFirst: async (args: any) =>
        args?.where?.id === 'sc-1' && args?.where?.tenantId === 't-1'
          ? {
              id: 'sc-1', tenantId: 't-1', fatturaId: 'f-1', numeroRata: 1, importoCentesimi: 100000,
              stato: db.statoRata,
              registrazioniRegistrate: db.registrazioni,
              fattura: { id: 'f-1', numero: 'FT-2026/001', stato: db.statoFattura, clienteId: 'cli-1' },
            }
          : null,
      findMany: async () => [{ id: 'sc-1', stato: db.statoRata }, ...db.altreRate],
      update: spie.aggiornaRata,
    },
    registrazioneIncasso: { create: spie.creaRegistrazione },
    fattura: { update: spie.aggiornaFattura },
    movimentoPrimaNota: { findMany: async () => db.movimenti, create: spie.creaMovimento, update: spie.aggiornaMovimento },
    contoBancario: { update: spie.aggiornaSaldo },
    auditLog: { create: async () => ({}) },
  };
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
  recordAudit: spie.audit,
}));

async function storna(incassoId: string, body: unknown = { motivo: 'Incasso registrato sulla rata sbagliata' }) {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({ userId: 'admin-1', tenantId: 't-1', ruolo: 'advisor', email: 'ada@studio.it', sessionVersion: 0 });
  return server.inject({
    method: 'POST',
    url: `/invoices/scadenze/sc-1/incassi/${incassoId}/storno`,
    headers: { authorization: `Bearer ${token}` },
    payload: body as any,
  });
}

describe('POST /invoices/scadenze/:id/incassi/:incassoId/storno', () => {
  const quando = new Date('2026-11-20T10:00:00.000Z');

  beforeEach(() => {
    Object.values(spie).forEach((s) => s.mockClear());
    db.statoFattura = 'incassata';
    db.statoRata = 'incassato';
    db.altreRate = [];
    db.registrazioni = [
      { id: 'reg-1', importoIncassatoCentesimi: 100000, dataIncasso: quando, metodoPagamento: 'bonifico', riferimentoTransazione: 'CRO-1', stornoDiId: null },
    ];
    db.movimenti = [
      { id: 'mv-1', contoBancarioId: 'c-banca', importoCentesimi: 100000, data: quando, registrazioneIncassoId: 'reg-1' },
    ];
  });

  it('scrive la riga contraria, riapre la rata e la fattura, e fa uscire il denaro dallo stesso conto', async () => {
    const res = await storna('reg-1');

    expect(res.statusCode).toBe(201);
    // La registrazione di storno: importo col segno meno, nomina l'incasso, porta il motivo.
    expect(spie.creaRegistrazione.mock.calls[0]![0].data).toMatchObject({
      tenantId: 't-1', scadenzaIncassoId: 'sc-1', fatturaId: 'f-1',
      importoIncassatoCentesimi: -100000, stornoDiId: 'reg-1',
      noteOperatore: 'Storno: Incasso registrato sulla rata sbagliata',
    });
    expect(spie.aggiornaRata).toHaveBeenCalledWith({ where: { id: 'sc-1' }, data: { stato: 'in_attesa' } });
    expect(spie.aggiornaFattura).toHaveBeenCalledWith({ where: { id: 'f-1' }, data: { stato: 'emessa' } });
    // L'uscita contraria: stesso conto dell'incasso, stesso importo, legata alla fattura (lucchetto).
    expect(spie.creaMovimento.mock.calls[0]![0].data).toMatchObject({
      tipo: 'uscita', categoria: 'incasso_fattura', contoBancarioId: 'c-banca', fatturaId: 'f-1',
      importoCentesimi: 100000, registrazioneIncassoId: 'reg-storno',
      descrizione: 'Storno incasso rata #1 fattura FT-2026/001',
      note: 'Incasso registrato sulla rata sbagliata',
    });
    expect(spie.aggiornaSaldo).toHaveBeenCalledWith({ where: { id: 'c-banca' }, data: { saldoAttuale: { increment: -100000 } } });
  });

  it('il registro dice chi, da dove e perché (regola 10)', async () => {
    await storna('reg-1');

    expect(spie.audit).toHaveBeenCalledTimes(1);
    const voce = (spie.audit.mock.calls as any[][])[0]![0];
    expect(voce).toMatchObject({ tenantId: 't-1', userId: 'admin-1', ruolo: 'advisor', azione: 'INCASSO_STORNATO' });
    expect(voce.ipAddress).toBeTruthy();
    expect(voce.dettagli).toContain('Incasso registrato sulla rata sbagliata');
  });

  it('storno di un acconto: la rata resta parziale per l’altro incasso', async () => {
    db.statoRata = 'incassato';
    db.registrazioni = [
      { id: 'reg-1', importoIncassatoCentesimi: 60000, dataIncasso: quando, metodoPagamento: 'bonifico', riferimentoTransazione: null, stornoDiId: null },
      { id: 'reg-2', importoIncassatoCentesimi: 40000, dataIncasso: quando, metodoPagamento: 'bonifico', riferimentoTransazione: null, stornoDiId: null },
    ];
    db.movimenti = [
      { id: 'mv-1', contoBancarioId: 'c-banca', importoCentesimi: 60000, data: quando, registrazioneIncassoId: 'reg-1' },
      { id: 'mv-2', contoBancarioId: 'c-cassa', importoCentesimi: 40000, data: quando, registrazioneIncassoId: 'reg-2' },
    ];

    const res = await storna('reg-2');

    expect(res.statusCode).toBe(201);
    expect(spie.aggiornaRata).toHaveBeenCalledWith({ where: { id: 'sc-1' }, data: { stato: 'parziale' } });
    expect(spie.creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-cassa');
  });

  it('senza motivo → 400 e niente scritto', async () => {
    const res = await storna('reg-1', { motivo: '  ' });

    expect(res.statusCode).toBe(400);
    expect(spie.creaRegistrazione).not.toHaveBeenCalled();
    expect(spie.creaMovimento).not.toHaveBeenCalled();
  });

  it('un incasso già stornato → 409, non si storna due volte', async () => {
    db.registrazioni.push({ id: 'reg-9', importoIncassatoCentesimi: -100000, dataIncasso: quando, metodoPagamento: 'bonifico', riferimentoTransazione: null, stornoDiId: 'reg-1' });

    const res = await storna('reg-1');

    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toMatch(/già stato stornato/);
    expect(spie.creaRegistrazione).not.toHaveBeenCalled();
  });

  it('fattura annullata da Nota di Credito → 409', async () => {
    db.statoFattura = 'annullata';

    const res = await storna('reg-1');

    expect(res.statusCode).toBe(409);
    expect(spie.creaMovimento).not.toHaveBeenCalled();
  });

  it('incasso di un’altra rata o inesistente → 404', async () => {
    const res = await storna('reg-inesistente');

    expect(res.statusCode).toBe(404);
  });

  it('incasso di prima del 28/11 (movimento non legato): lo riconosce, lo lega e storna', async () => {
    db.movimenti = [{ id: 'mv-1', contoBancarioId: 'c-banca', importoCentesimi: 100000, data: quando, registrazioneIncassoId: null }];

    const res = await storna('reg-1');

    expect(res.statusCode).toBe(201);
    expect(spie.aggiornaMovimento).toHaveBeenCalledWith({ where: { id: 'mv-1' }, data: { registrazioneIncassoId: 'reg-1' } });
    expect(spie.creaMovimento.mock.calls[0]![0].data.contoBancarioId).toBe('c-banca');
  });

  it('movimento dell’incasso non riconoscibile → 409 e niente scritto (non si sceglie un conto a caso)', async () => {
    db.movimenti = [];

    const res = await storna('reg-1');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ codice: 'MOVIMENTO_NON_RICONOSCIUTO' });
    expect(spie.creaRegistrazione).not.toHaveBeenCalled();
    expect(spie.aggiornaRata).not.toHaveBeenCalled();
  });
});
