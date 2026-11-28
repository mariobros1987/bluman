// Titolare, 28/11/2026 (risposta 7) — «campo sconto sul progetto». Prima il valore di un progetto
// con moduli era solo la somma dei loro prezzi, e uno sconto si faceva cambiando il prezzo di un modulo.
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

const db: { progetto: any | null } = { progetto: null };
const audit = vi.fn(async (_voce: any) => {});

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    progetto: {
      findFirst: async ({ where }: any) =>
        // Una copia, come fa Prisma: la riga letta non cambia quando poi la si aggiorna.
        db.progetto && db.progetto.id === where.id && db.progetto.tenantId === where.tenantId ? { ...db.progetto } : null,
      findUnique: async () => (db.progetto ? { scontoCentesimi: db.progetto.scontoCentesimi } : null),
      update: async ({ data }: any) => { Object.assign(db.progetto, data); return db.progetto; },
    },
    moduloProgetto: {
      aggregate: async () => ({
        _sum: { prezzo: db.progetto.moduli.reduce((t: number, m: any) => t + m.prezzo, 0) },
        _count: { _all: db.progetto.moduli.length },
      }),
    },
    $executeRaw: async () => 1,
  };
  finto.$transaction = async (fn: any) => fn(finto);
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return { ...reale, recordAudit: (voce: any) => audit(voce) };
});

const { registraRottaScontoProgetto } = await import('./routes/progettiSconto.js');

async function scrivi(scontoCentesimi: unknown, ruolo = 'advisor', id = 'prg-1') {
  const server = Fastify();
  server.addHook('onRequest', async (req) => {
    req.tenantId = TENANT;
    req.ruolo = ruolo as typeof req.ruolo;
    req.userId = 'u-1';
  });
  await registraRottaScontoProgetto(server);
  return server.inject({ method: 'PUT', url: `/progetti/${id}/sconto`, payload: { scontoCentesimi } });
}

beforeEach(() => {
  db.progetto = {
    id: 'prg-1', tenantId: TENANT, nome: 'Holding Rossi', scontoCentesimi: 0, valoreTotale: 1_860_000,
    moduli: [{ prezzo: 1_150_000 }, { prezzo: 500_000 }, { prezzo: 210_000 }],
  };
  audit.mockClear();
});

describe('PUT /progetti/:id/sconto', () => {
  it('scrive lo sconto e il valore diventa somma dei moduli meno sconto', async () => {
    const res = await scrivi(100_000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ scontoCentesimi: 100_000, sommaModuliCentesimi: 1_860_000, valoreTotale: 1_760_000 });
    expect(db.progetto).toMatchObject({ scontoCentesimi: 100_000, valoreTotale: 1_760_000 });
  });

  it('lo sconto si toglie rimettendolo a zero', async () => {
    db.progetto.scontoCentesimi = 100_000;
    const res = await scrivi(0);
    expect(res.statusCode).toBe(200);
    expect(db.progetto).toMatchObject({ scontoCentesimi: 0, valoreTotale: 1_860_000 });
  });

  it('resta nel registro chi l’ha scritto, da quanto a quanto (regola 10)', async () => {
    await scrivi(100_000);
    expect(audit).toHaveBeenCalledTimes(1);
    const voce = audit.mock.calls[0]![0];
    expect(voce).toMatchObject({ tenantId: TENANT, userId: 'u-1', ruolo: 'advisor', azione: 'PROGETTO_SCONTO', entita: 'prg-1' });
    expect(voce.ipAddress).toBeTruthy();
    expect(voce.dettagli).toContain('da €0.00 a €1000.00');
  });

  it('solo chi risponde dello studio: un collaboratore riceve 403 e niente cambia', async () => {
    const res = await scrivi(100_000, 'collaboratore_interno');
    expect(res.statusCode).toBe(403);
    expect(db.progetto.scontoCentesimi).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([[-1], [10.5], ['100'], [null]])('sconto non valido (%j) → 400', async (valore) => {
    const res = await scrivi(valore);
    expect(res.statusCode).toBe(400);
    expect(db.progetto.scontoCentesimi).toBe(0);
  });

  it('uno sconto pari o superiore alla somma dei moduli → 400', async () => {
    const res = await scrivi(1_860_000);
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('più basso della somma dei moduli');
    expect(db.progetto.scontoCentesimi).toBe(0);
  });

  it('progetto senza moduli → 409: lì il valore si scrive a mano', async () => {
    db.progetto.moduli = [];
    const res = await scrivi(1000);
    expect(res.statusCode).toBe(409);
  });

  it('progetto di un altro studio o inesistente → 404', async () => {
    const res = await scrivi(1000, 'advisor', 'prg-altro');
    expect(res.statusCode).toBe(404);
  });
});
