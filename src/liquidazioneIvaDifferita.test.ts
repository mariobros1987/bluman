// La segnalazione delle fatture a **esigibilità differita** deve arrivare fino alla pagina con i
// numeri dei documenti, non solo con un totale.
//
// Perché serve un test di rotta e non bastano quelli del motore: `calcolaLiquidazioneIvaPeriodo`
// riceve la riga già letta, e il numero della fattura esiste solo se la rotta lo chiede nel
// `select`. Dimenticare `numero: true` là dentro non rompe niente — il motore ripiega sull'id — ma
// trasforma l'avviso in «documento senza numero», cioè in qualcosa che non si può andare a
// controllare. È il modo in cui questa segnalazione diventerebbe inutile senza che nessuno se ne
// accorga.
//
// Il finto database **proietta davvero secondo il `select`** che riceve. È il punto: un finto che
// restituisce la riga intera comunque passerebbe identico con e senza `numero` nel `select`, cioè
// non proverebbe nulla di ciò che si vuole provare.
import { describe, it, expect, vi } from 'vitest';

const db = vi.hoisted(() => ({
  fatture: [] as any[],
  passive: [] as any[],
}));

vi.mock('./util/prismaClient.js', () => {
  /** Applica il `select` di Prisma alla riga: senza, il finto non proverebbe la proiezione. */
  const proietta = (riga: any, select: any) =>
    select
      ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, riga[k]]))
      : riga;

  const nellIntervallo = (data: Date, range: any) =>
    (!range?.gte || data.getTime() >= range.gte.getTime()) &&
    (!range?.lte || data.getTime() <= range.lte.getTime());

  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1'
          ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
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
    // Senza, la verifica dei permessi *lancia* e il fail-closed ripiega sul default di ruolo:
    // funziona, ma riempie l'uscita di un errore che sembra un guasto del test.
    permessoModulo: { findUnique: async () => null },
    fattura: {
      findMany: async (args: any) =>
        db.fatture
          .filter((f) => f.tenantId === (args?.where?.tenantId ?? 't-1'))
          .filter((f) => nellIntervallo(f.data, args?.where?.data))
          .filter((f) =>
            args?.where?.tipoDocumento?.in ? args.where.tipoDocumento.in.includes(f.tipoDocumento) : true,
          )
          .map((f) => proietta(f, args?.select)),
    },
    fatturaRicevuta: {
      findMany: async (args: any) =>
        db.passive
          .filter((f) => nellIntervallo(f.data, args?.where?.data))
          .map((f) => proietta(f, args?.select)),
    },
    liquidazioneIva: { findFirst: async () => null, findMany: async () => [], upsert: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);

  return {
    // `attivaContestoTenant` riceve un **contesto**, non una callback, e l'hook la chiama senza
    // `await`: una firma sbagliata qui non fa fallire la richiesta, lascia solo una promessa
    // rifiutata che nessuno guarda.
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

const fattura = (over: any = {}) => ({
  id: 'f-1',
  tenantId: 't-1',
  data: new Date(2026, 8, 15),
  tipoDocumento: 'fattura',
  stato: 'emessa',
  numero: 'FT-2026/012',
  totaleImponibileCentesimi: 100000,
  totaleIvaCentesimi: 22000,
  esigibilitaIva: 'immediata',
  ...over,
});

async function calcola(periodo: string) {
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
    url: '/liquidazione-iva/calcola',
    headers: { authorization: `Bearer ${token}` },
    payload: { periodo },
  });
}

describe('POST /liquidazione-iva/calcola — le differite arrivano in pagina coi loro numeri', () => {
  it('la differita entra nel debito, e la risposta la nomina', async () => {
    db.fatture = [
      fattura(),
      fattura({ id: 'f-2', numero: 'FT-2026/013', esigibilitaIva: 'differita' }),
    ];
    db.passive = [];

    const res = await calcola('2026-09');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ivaDebitoCent).toBe(44000);
    expect(body.differitaTrattataComeImmediata).toEqual({
      count: 1,
      imponibileCent: 100000,
      ivaDebitoCent: 22000,
      // Il numero vero, non l'id: se la rotta smettesse di chiedere `numero` nel `select`,
      // qui comparirebbe `f-2` e il presidio fallirebbe.
      documenti: ['FT-2026/013'],
    });
  });

  it('lo split resta fuori dal debito e non viene segnalato come differita', async () => {
    // Le due esigibilità si assomigliano solo nel nome: questa è la differenza fra escludere IVA
    // che non è mai dello studio e IVA che lo è, solo più tardi.
    db.fatture = [
      fattura({ id: 'f-2', numero: 'FT-2026/013', esigibilitaIva: 'split', totaleIvaCentesimi: 6600 }),
    ];
    db.passive = [];

    const body = (await calcola('2026-09')).json();

    expect(body.ivaDebitoCent).toBe(0);
    expect(body.differitaTrattataComeImmediata.count).toBe(0);
  });

  it('una fattura di un altro periodo non entra, né nel debito né nella segnalazione', async () => {
    // Il filtro del periodo è della rotta, non del motore: senza questo caso, un `where` allentato
    // farebbe entrare nel prospetto documenti di un altro mese senza che nessun test se ne accorga.
    db.fatture = [fattura({ data: new Date(2026, 7, 15), esigibilitaIva: 'differita' })];
    db.passive = [];

    const body = (await calcola('2026-09')).json();

    expect(body.ivaDebitoCent).toBe(0);
    expect(body.differitaTrattataComeImmediata.count).toBe(0);
  });
});
