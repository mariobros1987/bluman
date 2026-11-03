// 3.17 — Lato server il nome dello studio non si inventa.
//
// GET /tenant/info, davanti a uno studio senza riga a database, la CREAVA con un nome di
// ripiego («Studio Advisory & Legal Partners», «Studio Professionale»…), e se il database non
// rispondeva restituiva lo stesso nome da una copia in memoria: una lettura che scriveva, e un
// nome mai scelto da nessuno. I solleciti al cliente partivano firmati «Studio Professionale
// BluMan» quando la ragione sociale mancava. Questi test tengono ferme le tre cose: la lettura
// non crea, l'errore del database è un errore, il sollecito senza ragione sociale non parte.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { creaTenant, inviaEmail, inviaWhatsapp } = vi.hoisted(() => ({
  creaTenant: vi.fn(async (args: any) => args?.data),
  inviaEmail: vi.fn(async (_args: any) => ({ ok: true })),
  inviaWhatsapp: vi.fn(async (..._args: any[]) => ({ ok: true })),
}));

const db = vi.hoisted(() => ({
  /** La riga del tenant come la restituisce `findUnique`; null = studio non registrato. */
  tenant: null as any,
  /** Per il caso «il database non risponde». */
  tenantFallisce: false,
  sollecitiPrecedenti: [] as any[],
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'admin-1' ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 } : null,
      findUnique: async () => ({ nome: 'Ada', email: 'ada@studio.it', ruolo: 'advisor' }),
    },
    cliente: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    tenant: {
      findUnique: async (args: any) => {
        // Le letture con `select` sono quelle dei guardiani (moduli dello studio): rispondono
        // sempre, così il test esercita la rotta e non la guardia.
        if (args?.select) return { moduliConcessi: [], moduliDisattivati: [] };
        if (db.tenantFallisce) throw new Error('database non raggiungibile');
        return db.tenant;
      },
      findFirst: async () => ({ id: 't-1', moduliDisattivati: [] }),
      create: creaTenant,
      upsert: creaTenant,
    },
    permessoModulo: { findUnique: async () => null },
    scadenzaIncasso: {
      findFirst: async () => ({
        id: 'sc-1',
        fatturaId: 'fattura-0001',
        numeroRata: 1,
        importoCentesimi: 100000,
        dataScadenza: new Date('2026-09-01'),
        registrazioniRegistrate: [],
        fattura: {
          numero: 'FT-1',
          data: new Date('2026-08-01'),
          cliente: { nome: 'Alpha Srl', email: 'alpha@cliente.it', referentiJson: null },
          contoAccredito: null,
        },
      }),
      update: async (args: any) => ({ id: 'sc-1', ...args?.data }),
    },
    sollecito: {
      findMany: async () => db.sollecitiPrecedenti,
      create: async (args: any) => ({ id: 'sol-1', ...args?.data }),
    },
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

vi.mock('./services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/emailService.js')>()),
  inviaEmail,
}));

vi.mock('./services/whatsappService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/whatsappService.js')>()),
  inviaTestoWhatsapp: inviaWhatsapp,
}));

async function richiesta(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const { buildServer } = await import('./server.js');
  const { signJwt } = await import('./util/jwt.js');
  const server = buildServer({} as any);
  await server.ready();
  const token = signJwt({ userId: 'admin-1', tenantId: 't-1', ruolo: 'advisor', email: 'ada@studio.it', sessionVersion: 0 });
  return server.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  creaTenant.mockClear();
  inviaEmail.mockClear();
  inviaWhatsapp.mockClear();
  db.tenant = { id: 't-1', ragioneSociale: 'Studio Rossi & Associati', piano: 'enterprise', stato: 'attivo' };
  db.tenantFallisce = false;
  db.sollecitiPrecedenti = [];
});

describe('GET /tenant/info — una lettura non crea lo studio', () => {
  it('studio registrato: risponde la sua anagrafica', async () => {
    const res = await richiesta('GET', '/tenant/info');
    expect(res.statusCode).toBe(200);
    expect(res.json().ragioneSociale).toBe('Studio Rossi & Associati');
  });

  it('studio senza riga a database: 404, nessuna creazione, nessun nome', async () => {
    db.tenant = null;
    const res = await richiesta('GET', '/tenant/info');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ errore: 'Studio non registrato' });
    expect(creaTenant).not.toHaveBeenCalled();
  });

  it('database non raggiungibile: 500, non un nome di ripiego da una copia in memoria', async () => {
    db.tenantFallisce = true;
    const res = await richiesta('GET', '/tenant/info');
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/Studio Professionale|Advisory/);
  });
});

describe('solleciti — senza ragione sociale dello studio non si scrive al cliente', () => {
  const ERRORE = 'Ragione sociale dello studio mancante: completala in Impostazioni prima di inviare solleciti.';

  it('invio: 409 e nessuna email partita', async () => {
    db.tenant = { id: 't-1', ragioneSociale: '  ', piano: 'enterprise', stato: 'attivo' };
    const res = await richiesta('POST', '/invoices/scadenze/sc-1/invia-sollecito', { livello: '1_avviso_bonario', canale: 'email' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ errore: ERRORE });
    expect(inviaEmail).not.toHaveBeenCalled();
    expect(inviaWhatsapp).not.toHaveBeenCalled();
  });

  it('anteprima: 409, non un testo firmato da uno studio inventato', async () => {
    db.tenant = null;
    const res = await richiesta('POST', '/invoices/scadenze/sc-1/anteprima-sollecito', { livello: '1_avviso_bonario' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ errore: ERRORE });
  });

  it('con la ragione sociale il sollecito parte, firmato dallo studio vero', async () => {
    const res = await richiesta('POST', '/invoices/scadenze/sc-1/invia-sollecito', { livello: '1_avviso_bonario', canale: 'email' });
    expect(res.statusCode).toBe(200);
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(inviaEmail.mock.calls[0]?.[0]?.subject).toContain('Studio Rossi & Associati');
  });
});
