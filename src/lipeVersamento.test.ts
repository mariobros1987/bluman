// Analisi del 26/11, E12 — POST /liquidazione-iva/:periodo/marca-versata.
//
// Segnare la liquidazione versata e scrivere l'uscita in Prima Nota erano due scritture separate:
// se la seconda falliva restava una liquidazione «versata» senza uscita, e non più riprovabile.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  lipe: null as any,
  eventi: [] as string[],
  movimenti: [] as any[],
  guastoMovimento: false,
  /** Quante righe trova il passaggio condizionato a `versata = false`. */
  righeSegnate: 1,
}));

vi.mock('./util/prismaClient.js', () => {
  const tx = {
    $executeRaw: async () => { stato.eventi.push('set_config'); return 1; },
    liquidazioneIva: {
      updateMany: async (args: any) => {
        stato.eventi.push(`segna:versata=${args.where.versata}`);
        return { count: stato.righeSegnate };
      },
      findUnique: async () => ({ ...stato.lipe, versata: true }),
    },
    movimentoPrimaNota: {
      create: async (args: any) => {
        if (stato.guastoMovimento) throw new Error('guasto simulato sul movimento');
        stato.eventi.push('movimento');
        stato.movimenti.push(args.data);
        return { id: 'mov-1', ...args.data };
      },
    },
    contoBancario: { update: async (args: any) => { stato.eventi.push(`saldo:${args.data.saldoAttuale.increment}`); return {}; } },
  };
  return {
    attivaContestoTenant: () => {},
    contestoTenant: () => ({ tenantId: 't-1', ruolo: 'advisor' }),
    conContestoInTransazione: async (t: any, fn: any) => { await t.$executeRaw(); return fn(); },
    prisma: {
      user: {
        findFirst: vi.fn(async (args: any) => (args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null)),
        findUnique: vi.fn(async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' })),
      },
      cliente: { findFirst: vi.fn(async () => null) },
      tenant: {
        findUnique: vi.fn(async () => ({ id: 't-1', moduliDisattivati: [] })),
        findFirst: vi.fn(async () => ({ id: 't-1', moduliDisattivati: [] })),
      },
      permessoModulo: { findUnique: vi.fn(async () => null) },
      liquidazioneIva: {
        findFirst: vi.fn(async () => stato.lipe),
        update: async () => { stato.eventi.push('update-fuori-transazione'); return {}; },
        upsert: async () => { stato.eventi.push('upsert'); return { ...stato.lipe }; },
      },
      fattura: { findMany: async () => [] },
      fatturaRicevuta: { findMany: async () => [] },
      movimentoPrimaNota: { create: async () => { stato.eventi.push('movimento-fuori-transazione'); return {}; } },
      contoBancario: { update: async () => ({}) },
      auditLog: { create: vi.fn(async () => ({})) },
      // Una transazione vera annulla le scritture se il callback lancia: qui basta che l'errore risalga.
      $transaction: async (fn: any) => fn(tx),
    },
    prismaAmministrativo: () => ({ user: { findUnique: vi.fn(async () => null) }, auditLog: { create: vi.fn(async () => ({})) } }),
  };
});

const CONTO = '11111111-1111-4111-8111-111111111111';

async function versa(payload: Record<string, unknown> = {}) {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({ userId: 'admin-1', tenantId: 't-1', ruolo: 'advisor', email: 'ada@studio.it', sessionVersion: 0 });
  return server.inject({
    method: 'POST',
    url: '/liquidazione-iva/2026-Q4/marca-versata',
    headers: { authorization: `Bearer ${token}` },
    payload: { dataVersamento: '2026-11-27', contoBancarioId: CONTO, ...payload },
  });
}

beforeEach(() => {
  stato.lipe = { id: 'lipe-1', tenantId: 't-1', periodo: '2026-Q4', versata: false, saldoCentesimi: 10736 };
  stato.eventi.length = 0;
  stato.movimenti.length = 0;
  stato.guastoMovimento = false;
  stato.righeSegnate = 1;
});

describe('POST /liquidazione-iva/:periodo/marca-versata', () => {
  it('segna versata e scrive l’uscita dentro la stessa transazione, col contesto dello studio', async () => {
    const res = await versa();
    expect(res.statusCode).toBe(200);
    expect(stato.eventi).toEqual(['set_config', 'segna:versata=false', 'movimento', 'saldo:-10736']);
    expect(stato.movimenti[0]).toMatchObject({ tipo: 'uscita', importoCentesimi: 10736, contoBancarioId: CONTO });
  });

  it('riferimento non scritto → resta vuoto, non diventa «F24-<periodo>»', async () => {
    await versa();
    expect(stato.movimenti[0].riferimentoTransazione).toBeNull();
    await versa({ riferimentoTransazione: ' QUIETANZA-77 ' });
    expect(stato.movimenti[1].riferimentoTransazione).toBe('QUIETANZA-77');
  });

  it('se il movimento fallisce l’errore risale: la transazione non si chiude con la liquidazione versata', async () => {
    stato.guastoMovimento = true;
    const res = await versa();
    expect(res.statusCode).toBe(500);
    expect(stato.eventi).not.toContain('update-fuori-transazione');
    expect(stato.eventi).not.toContain('movimento');
  });

  it('due conferme insieme: quella che non trova più `versata = false` riceve 409 e non scrive l’uscita', async () => {
    stato.righeSegnate = 0;
    const res = await versa();
    expect(res.statusCode).toBe(409);
    expect(stato.movimenti).toEqual([]);
  });

  it('liquidazione già versata → 409 prima di aprire la transazione', async () => {
    stato.lipe.versata = true;
    const res = await versa();
    expect(res.statusCode).toBe(409);
    expect(stato.eventi).toEqual([]);
  });
});

// Segnalato dal revisore sulla #6: «Salva LIPE» non guardava se la liquidazione era già versata, e
// l'upsert ne riscriveva gli importi.
describe('POST /liquidazione-iva/salva', () => {
  async function salva() {
    const { buildServer } = await import('./server.js');
    const { signJwt } = await import('./util/jwt.js');
    const server = buildServer({} as any);
    await server.ready();
    const token = signJwt({ userId: 'admin-1', tenantId: 't-1', ruolo: 'advisor', email: 'ada@studio.it', sessionVersion: 0 });
    return server.inject({
      method: 'POST', url: '/liquidazione-iva/salva', headers: { authorization: `Bearer ${token}` },
      payload: { periodo: '2026-Q4', creditoPrecedenteCent: 0 },
    });
  }

  it('liquidazione già versata → 409, e gli importi salvati non si toccano', async () => {
    stato.lipe.versata = true;
    const res = await salva();
    expect(res.statusCode).toBe(409);
    expect(stato.eventi).not.toContain('upsert');
  });

  it('liquidazione non versata → si salva come prima', async () => {
    const res = await salva();
    expect(res.statusCode, res.body).toBe(200);
    expect(stato.eventi).toContain('upsert');
  });
});
