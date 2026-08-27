/**
 * §2.9 — La conclusione di un'operazione (`modulo_completato`) è una firma FEA a tutti gli
 * effetti, come i documenti del fascicolo. Questi test inchiodano il contratto delle due rotte
 * di firma per il nuovo ambito:
 *
 *  - l'impronta NON arriva dal browser: il server la calcola dai dati del modulo
 *    (`improntaModuloCompletato`), quindi la richiesta senza `documentoHash` non viene
 *    respinta dal guard dell'impronta come per la lettera d'incarico;
 *  - il `riferimentoId` (l'id del modulo) è obbligatorio: senza, niente firma;
 *  - gli ambiti storici restano sotto il guard dell'impronta SHA-256.
 *
 * In ambiente di test il database è irraggiungibile (vitest.setup): le richieste che superano
 * le validazioni si fermano sulla prima lettura Prisma con un 500 — ed è proprio questo che
 * dimostra il passaggio dal guard, perché il 400 dell'impronta non arriva.
 */
import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';
const CLIENTE_TEST = 'cli-firma-modulo';

/** Sessione cliente: come quella emessa da /auth/client-login, userId `client-<id>`. */
const TOKEN_TEST_CLIENTE = signJwt({
  userId: `client-${CLIENTE_TEST}`,
  tenantId: TENANT_TEST,
  email: 'cliente@firma.example',
  ruolo: 'cliente',
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

describe('§2.9 POST /portal/verify-otp-and-sign — ambito modulo_completato', () => {
  it('senza riferimentoId rifiuta la firma: manca il modulo da confermare', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'modulo_completato' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toBe('Manca il modulo da confermare.');
  });

  it('senza documentoHash NON scatena il guard dell\'impronta: l\'hash lo calcola il server dai dati del modulo', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'modulo_completato', riferimentoId: 'mod-123' },
    });
    // Supera le validazioni e arriva alla lettura del cliente (500: DB assente nei test).
    // Se il guard dell'impronta fosse ancora attivo per questo ambito, arriverebbe il 400
    // "Impronta SHA-256 del documento mancante o non valida".
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });

  it('la lettera d\'incarico resta sotto il guard dell\'impronta SHA-256 (contrapposizione)', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'engagement_letter' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Impronta SHA-256 del documento mancante o non valida/);
  });
});

describe('§2.9 POST /portal/firma-con-file — ambito modulo_completato', () => {
  const FILE_FINTO = { filename: 'conferma.pdf', contentBase64: Buffer.from('prova').toString('base64') };

  it('senza riferimentoId rifiuta la firma: manca il modulo a cui si riferisce', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: { tipoFirma: 'manuale_scansionata', ambito: 'modulo_completato', ...FILE_FINTO },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toBe('Manca il modulo a cui si riferisce la firma.');
  });

  it('senza documentoHash NON scatena il guard dell\'impronta: l\'hash lo calcola il server dai dati del modulo', async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: {
        tipoFirma: 'manuale_scansionata',
        ambito: 'modulo_completato',
        riferimentoId: 'mod-123',
        ...FILE_FINTO,
      },
    });
    // Come sopra: supera le validazioni e si ferma sulla lettura del cliente (DB assente).
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });
});
