// Analisi del 26/11, E7 — DELETE /prima-nota/:id.
//
// Tre cose che prima non valevano: il movimento di un incasso non si elimina (la rata resterebbe
// «incassata» senza denaro), l'eliminazione di un movimento libero lascia traccia nel registro,
// e saldo e riga si muovono dentro una transazione col contesto dello studio.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  movimento: null as any,
  eventi: [] as string[],
  audit: [] as any[],
}));

vi.mock('./util/prismaClient.js', () => {
  const tx = {
    $executeRaw: async () => { stato.eventi.push('set_config'); return 1; },
    contoBancario: { update: async (args: any) => { stato.eventi.push(`saldo:${args.data.saldoAttuale.increment}`); return {}; } },
    movimentoPrimaNota: { delete: async (args: any) => { stato.eventi.push(`delete:${args.where.id}`); return {}; } },
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
      movimentoPrimaNota: {
        findFirst: vi.fn(async () => stato.movimento),
        // Fuori dalla transazione non si deve cancellare niente: se la rotta lo facesse, si vedrebbe qui.
        delete: async () => { stato.eventi.push('delete-fuori-transazione'); return {}; },
      },
      contoBancario: { update: async () => { stato.eventi.push('saldo-fuori-transazione'); return {}; } },
      auditLog: { create: vi.fn(async (args: any) => { stato.audit.push(args.data); return {}; }) },
      $transaction: async (fn: any) => fn(tx),
    },
    prismaAmministrativo: () => ({
      user: { findUnique: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async (args: any) => { stato.audit.push(args.data); return {}; }) },
    }),
  };
});

async function elimina() {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({ userId: 'admin-1', tenantId: 't-1', ruolo: 'advisor', email: 'ada@studio.it', sessionVersion: 0 });
  return server.inject({ method: 'DELETE', url: '/prima-nota/mov-1', headers: { authorization: `Bearer ${token}` } });
}

const MOVIMENTO_LIBERO = {
  id: 'mov-1', tenantId: 't-1', tipo: 'uscita', importoCentesimi: 12050, descrizione: 'Cancelleria',
  data: new Date('2026-11-20T00:00:00.000Z'), contoBancarioId: 'conto-1', fatturaId: null, fatturaRicevutaId: null,
  fattura: null, fatturaRicevuta: null,
};

beforeEach(() => {
  stato.eventi.length = 0;
  stato.audit.length = 0;
  stato.movimento = { ...MOVIMENTO_LIBERO };
});

describe('DELETE /prima-nota/:id', () => {
  it('il movimento di un incasso non si elimina: 409, niente scritture, la frase nomina la fattura', async () => {
    stato.movimento = { ...MOVIMENTO_LIBERO, tipo: 'entrata', fatturaId: 'f-1', fattura: { numero: 'FT-2026/001' } };
    const res = await elimina();
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toContain('FT-2026/001');
    expect(stato.eventi).toEqual([]);
    expect(stato.audit.some((a) => a.azione === 'MOVIMENTO_PRIMANOTA_ELIMINATO')).toBe(false);
  });

  it('il pagamento di una fattura d’acquisto non si elimina', async () => {
    stato.movimento = { ...MOVIMENTO_LIBERO, fatturaRicevutaId: 'fr-1', fatturaRicevuta: { numero: 'A-77' } };
    const res = await elimina();
    expect(res.statusCode).toBe(409);
    expect(stato.eventi).toEqual([]);
  });

  it('un movimento libero si elimina in transazione: contesto dello studio, poi saldo, poi riga', async () => {
    const res = await elimina();
    expect(res.statusCode).toBe(200);
    // Un'uscita di 120,50 € tolta fa risalire il saldo di 12050 centesimi.
    expect(stato.eventi).toEqual(['set_config', 'saldo:12050', 'delete:mov-1']);
  });

  it('l’eliminazione lascia traccia: chi, con che ruolo, da dove, cosa e quanto', async () => {
    await elimina();
    const riga = stato.audit.find((a) => a.azione === 'MOVIMENTO_PRIMANOTA_ELIMINATO');
    expect(riga).toBeTruthy();
    expect(riga.userId).toBe('admin-1');
    expect(riga.ruolo).toBe('advisor');
    expect(riga.ipAddress).toBeTruthy();
    expect(riga.dettagli).toContain('120.50');
    expect(riga.dettagli).toContain('2026-11-20');
  });

  it('movimento inesistente → 404', async () => {
    stato.movimento = null;
    expect((await elimina()).statusCode).toBe(404);
  });
});
