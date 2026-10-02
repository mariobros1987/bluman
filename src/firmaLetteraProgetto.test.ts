/**
 * La lettera d'incarico si firma **su un progetto**, non «presso un cliente».
 *
 * Fino al 02/10/2026 non era così: per questo ambito `riferimento_id` restava nullo, e il
 * portale decideva se una lettera risultava firmata guardando le firme del **cliente**. Sul VPS
 * il progetto «prova server», creato il 02/10/2026, appariva già firmato da una firma del
 * 08/09/2026 che non lo riguardava: due difetti in uno — la firma non diceva su cosa fosse
 * stata apposta, e la lettura non poteva che indovinare.
 *
 * Questi test inchiodano il lato server dell'invariante: senza il progetto, la firma non si
 * appone e il codice non si genera. Il lato portale — `signed` ricavato dal progetto attivo
 * invece che dal cliente — sta in `frontend/src/components/portal/usePortalData.ts`, e la
 * lettura che lo rende possibile è la stessa riga `FirmaElettronica` che si verifica qui.
 *
 * In ambiente di test il database è irraggiungibile (vitest.setup): le richieste che superano
 * le validazioni si fermano sulla prima lettura Prisma con un 500. È proprio questo a
 * distinguere «il guard ha lasciato passare» (500) da «il guard ha rifiutato» (400).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { prisma } from './util/prismaClient.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';
const CLIENTE_TEST = 'cli-firma-lettera';

/** Sessione cliente: come quella emessa da /auth/client-login, userId `client-<id>`. */
const TOKEN_TEST_CLIENTE = signJwt({
  userId: `client-${CLIENTE_TEST}`,
  tenantId: TENANT_TEST,
  email: 'cliente@lettera.example',
  ruolo: 'cliente',
  sessionVersion: 0,
});

const findFirstClienteReale = prisma.cliente.findFirst.bind(prisma.cliente);
vi.spyOn(prisma.cliente as any, 'findFirst').mockImplementation(async (args: any) => {
  if (args?.where?.id === CLIENTE_TEST && args?.select?.sessionVersion) return { sessionVersion: 0 } as any;
  return findFirstClienteReale(args as any);
});

function nuovoServer() {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { authorization: `Bearer ${TOKEN_TEST_CLIENTE}`, ...(opts?.headers || {}) },
    });
  return server;
}

/** Impronta di forma valida: serve a dimostrare che il rifiuto parla del progetto, non dell'hash. */
const HASH = 'ab'.repeat(32);

describe("🔗 POST /portal/verify-otp-and-sign — la lettera senza progetto non si firma", () => {
  it("senza riferimentoId rifiuta: è la richiesta che il portale mandava prima del 02/10/2026", async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      // L'impronta c'è: l'unica cosa che manca è il progetto, che è esattamente il caso reale.
      payload: { otp: '123456', ambito: 'engagement_letter', documentoHash: HASH },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
  });

  it('con il riferimento al progetto supera le validazioni e arriva al database', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'engagement_letter', riferimentoId: 'prj-1', documentoHash: HASH },
    });
    // 500 = prima lettura Prisma, database assente nei test. Se il guard rifiutasse ancora il
    // riferimento arriverebbe il 400, ed è quello che questo test esiste per distinguere.
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Manca il progetto da incaricare/);
  });

  it('un riferimento vuoto vale come assente', async () => {
    // Il portale compone il riferimento da `progettoAttivo?.id`: quando l'elenco progetti non è
    // ancora arrivato quello è `undefined`, e una stringa vuota non deve passare per un id.
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'engagement_letter', riferimentoId: '', documentoHash: HASH },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
  });
});

describe("🔗 POST /portal/request-otp — il codice non parte per una lettera senza progetto", () => {
  it('senza riferimentoId rifiuta prima di generare e inviare il codice', async () => {
    // Generare il codice e poi rifiutare la firma sarebbe il peggio dei due mondi: un invio
    // sprecato al cliente, e al momento della firma «Nessun codice in attesa di verifica» —
    // perché la sessione OTP è intestata anche al riferimento — invece di «manca il progetto».
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/request-otp',
      payload: { canale: 'email', ambito: 'engagement_letter' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
  });

  it('con il riferimento al progetto passa il guard e arriva al database', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/request-otp',
      payload: { canale: 'email', ambito: 'engagement_letter', riferimentoId: 'prj-1' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Manca il progetto da incaricare/);
  });
});

describe('🔗 POST /portal/firma-con-file — stesso vincolo sull\'altro canale', () => {
  const FILE_FINTO = { filename: 'mandato.pdf', contentBase64: Buffer.from('prova').toString('base64') };

  it('senza riferimentoId rifiuta la firma della lettera', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: {
        tipoFirma: 'manuale_scansionata',
        ambito: 'engagement_letter',
        documentoHash: HASH,
        ...FILE_FINTO,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
  });

  it('con il riferimento al progetto il guard dell\'incarico non blocca più', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: {
        tipoFirma: 'manuale_scansionata',
        ambito: 'engagement_letter',
        riferimentoId: 'prj-1',
        documentoHash: HASH,
        ...FILE_FINTO,
      },
    });
    expect(res.json().errore).not.toMatch(/Manca il progetto da incaricare/);
  });
});
