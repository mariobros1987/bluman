/**
 * N1, N2 — `POST /progetti/:id/fatture`.
 * - N1: `tipoDocumento: 'nota_credito'` saltava il gate KYC, ma l'adapter emetteva comunque una FT.
 * - N2: un id inesistente saltava il gate (nessun cliente trovato) e l'adapter ripiegava su una
 *   ricerca per `nome contains`, intestando la fattura a un progetto diverso.
 * Il gate KYC qui è quello vero (`kycGate.ts`, `guardiaModuli.ts`): il finto risponde alle letture.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

const db: { progetti: any[]; statoFascicolo: string | null } = { progetti: [], statoFascicolo: null };

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    progetto: {
      findFirst: async ({ where }: any) =>
        db.progetti.find((p) => p.id === where.id && p.tenantId === where.tenantId) ?? null,
    },
    // Nessuna riga tenant: il modulo KYC si considera attivo (guardiaModuli).
    tenant: { findUnique: async () => null },
    tenantComplianceSettings: { findUnique: async () => ({ regulatoryProfile: 'commercialista' }) },
    fascicoloKyc: {
      findFirst: async () => (db.statoFascicolo ? { id: 'fk-1', stato: db.statoFascicolo } : null),
    },
    overrideKyc: { findFirst: async () => null },
    $executeRaw: async () => 1,
  };
  finto.$transaction = async (fn: any) => fn(finto);
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

vi.mock('./util/serverHelpers.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return { ...reale, recordAudit: async () => {} };
});

const { registraRotteContabilitaRegistro } = await import('./routes/contabilitaRegistro.js');

const emettiFattura = vi.fn(async (input: any) => ({ id: 'f-1', numero: 'FT-2026/001', progettoId: input.progettoId }));

async function emetti(id: string, corpo: Record<string, unknown> = {}) {
  const server = Fastify();
  server.addHook('onRequest', async (req) => {
    req.tenantId = TENANT;
    req.ruolo = 'advisor';
  });
  await registraRotteContabilitaRegistro(server, { emettiFattura } as any);
  return server.inject({
    method: 'POST',
    url: `/progetti/${id}/fatture`,
    payload: {
      tipoClienteFiscale: 'business_italia',
      canale: 'sdi',
      righe: [{ tipo: 'milestone_libera', importo: 100000, descrizione: 'Consulenza' }],
      ...corpo,
    },
  });
}

beforeEach(() => {
  db.progetti = [{ id: 'prg-1', nome: 'Bilancio Rossi 2026', tenantId: TENANT, clienteId: 'cli-1' }];
  db.statoFascicolo = null;
  emettiFattura.mockClear();
});

describe('N1 — da questa rotta escono solo fatture', () => {
  it("tipoDocumento 'nota_credito' → 400, niente emissione", async () => {
    const res = await emetti('prg-1', { tipoDocumento: 'nota_credito' });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/solo fatture/);
    expect(emettiFattura).not.toHaveBeenCalled();
  });

  it("tipoDocumento 'fattura' esplicito passa", async () => {
    const res = await emetti('prg-1', { tipoDocumento: 'fattura' });
    expect(res.statusCode).toBe(201);
  });
});

describe('N2 — il progetto si cerca solo per id esatto, prima del gate', () => {
  it('un id che è un pezzo di nome → 404, niente emissione', async () => {
    const res = await emetti('Rossi');
    expect(res.statusCode).toBe(404);
    expect(emettiFattura).not.toHaveBeenCalled();
  });

  it('cliente con KYC non approvato → 409, niente emissione', async () => {
    db.statoFascicolo = 'bozza';
    const res = await emetti('prg-1');
    expect(res.statusCode).toBe(409);
    expect(emettiFattura).not.toHaveBeenCalled();
  });

  it('progetto esistente, KYC senza pratica → 201', async () => {
    const res = await emetti('prg-1');
    expect(res.statusCode).toBe(201);
    expect(emettiFattura).toHaveBeenCalledTimes(1);
  });
});
