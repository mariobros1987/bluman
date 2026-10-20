/**
 * GET /firme/:id/marca-temporale — il token RFC 3161 conservato con la firma.
 *
 * Il token è la prova che si porta fuori dalla piattaforma (`openssl ts -verify`): la
 * rotta lo restituisce solo a chi possiede la firma. RLS isola gli studi, non i clienti
 * fra loro, quindi il controllo sul `clienteId` è della rotta e qui viene inchiodato.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { prisma } from './util/prismaClient.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';
const CLIENTE_TEST = 'cli-marca-1';
const ALTRO_CLIENTE = 'cli-marca-2';

const TOKEN_TEST_CLIENTE = signJwt({
  userId: `client-${CLIENTE_TEST}`,
  tenantId: TENANT_TEST,
  email: 'cliente@marca.example',
  ruolo: 'cliente',
  sessionVersion: 0,
});

const stato = vi.hoisted(() => ({ riga: null as any }));

vi.spyOn(prisma.cliente as any, 'findFirst').mockImplementation(async (args: any) => {
  if (args?.where?.id?.startsWith?.('cli-marca-')) return { sessionVersion: 0 } as any;
  return null as any;
});
vi.spyOn(prisma.firmaElettronica as any, 'findFirst').mockImplementation(async () => stato.riga);

function nuovoServer() {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { authorization: `Bearer ${TOKEN_TEST_CLIENTE}`, ...opts?.headers },
    });
  return server;
}

beforeEach(() => {
  stato.riga = null;
});

describe('GET /firme/:id/marca-temporale', () => {
  it('restituisce il token al cliente che possiede la firma', async () => {
    stato.riga = {
      id: 'firma-1',
      signatureId: 'BLU-1',
      clienteId: CLIENTE_TEST,
      documentoTitolo: 'Lettera di incarico',
      sigilloDigest: 'ab'.repeat(32),
      marcaTemporaleToken: Buffer.from('token-der', 'utf8').toString('base64'),
      marcaTemporaleImpronta: 'ab'.repeat(32),
      marcaTemporaleTsa: 'https://freetsa.org/tsr',
      marcaTemporaleGenTime: new Date('2026-10-17T15:51:26.000Z'),
      marcaTemporalePolicy: '1.2.3.4.1',
      marcaTemporaleSerial: '987654321',
      marcaTemporaleTokenHash: 'cd'.repeat(32),
      marcaTemporaleErrore: null,
      marcaTemporaleRichiestaAt: new Date('2026-10-17T15:51:27.000Z'),
    };

    const res = await nuovoServer().inject({
      method: 'GET',
      url: '/firme/firma-1/marca-temporale',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tokenBase64).toBe(stato.riga.marcaTemporaleToken);
    expect(body.firma.impronta).toBe('ab'.repeat(32));
    expect(body.firma.serialNumber).toBe('987654321');
    expect(body.firma.tsa).toBe('https://freetsa.org/tsr');
  });

  it("rifiuta la firma di un altro cliente dello stesso studio", async () => {
    stato.riga = {
      id: 'firma-2',
      clienteId: ALTRO_CLIENTE,
      marcaTemporaleToken: 'token',
      marcaTemporaleErrore: null,
    };

    const res = await nuovoServer().inject({
      method: 'GET',
      url: '/firme/firma-2/marca-temporale',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().errore).toMatch(/non accessibile/i);
  });

  it('se la marca non c’è dice perché, invece di fingere che non esista la firma', async () => {
    stato.riga = {
      id: 'firma-3',
      clienteId: CLIENTE_TEST,
      marcaTemporaleToken: null,
      marcaTemporaleErrore: 'Invio alla TSA non riuscito: nessuna risposta entro 5 secondi.',
    };

    const res = await nuovoServer().inject({
      method: 'GET',
      url: '/firme/firma-3/marca-temporale',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().motivo).toMatch(/nessuna risposta entro 5 secondi/);
  });
});
