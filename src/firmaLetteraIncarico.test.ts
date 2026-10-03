/**
 * Piano firma §8.4 (decisione del titolare, 03/10/2026) — l'impronta della lettera d'incarico
 * la calcola il server, a qualunque livello.
 *
 * La lettera è l'unico atto firmabile che **non esiste come file**: il testo delle clausole è un
 * template del portale (`frontend/src/utils/documentTemplates.ts`, voce `tmpl-engagement`)
 * riempito nel browser con i dati dell'incarico. Il server non ha niente da rileggere in
 * archivio, quindi l'impronta è quella dei **dati dell'incarico** (parti, studio, progetto,
 * moduli con i corrispettivi) più l'impronta del **testo delle clausole**, che è una costante di
 * piattaforma. Questi test inchiodano le due metà:
 *
 *  1. la costante è ancora quella del template del frontend: se qualcuno cambia una clausola
 *     del mandato e non aggiorna `LETTERA_INCARICO_TESTO_SHA256`, il test è rosso e glielo dice
 *     — altrimenti ogni firma continuerebbe a dichiarare una versione della lettera che il
 *     cliente non legge più;
 *  2. le rotte non ricevono più l'impronta dal browser: una richiesta di firma della lettera
 *     **senza** `documentoHash` non incontra più il guard dell'impronta (che resta per
 *     `addendum`), e senza il progetto incontra il rifiuto dell'incarico, non quello
 *     dell'impronta.
 *
 * In ambiente di test il database è irraggiungibile (vitest.setup): le richieste che superano le
 * validazioni si fermano sulla prima lettura Prisma con un 500 — ed è proprio questo a
 * distinguere «il guard ha lasciato passare» (500) da «il guard ha rifiutato» (400).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { prisma } from './util/prismaClient.js';
import { signJwt } from './util/jwt.js';
import {
  LETTERA_INCARICO_TESTO_SHA256,
  estraiTestoLetteraIncarico,
  improntaTestoLetteraIncarico,
  normalizzaFineRiga,
} from './services/letteraIncarico.js';

const RADICE = path.resolve(import.meta.dirname, '..');

describe('§8.4 il testo della lettera è una costante di piattaforma, e questo test la tiene onesta', () => {
  const sorgente = readFileSync(
    path.join(RADICE, 'frontend', 'src', 'utils', 'documentTemplates.ts'),
    'utf8',
  );

  it('il template della lettera si estrae ancora dal sorgente del frontend', () => {
    const testo = estraiTestoLetteraIncarico(sorgente);
    expect(
      testo,
      'La voce tmpl-engagement di documentTemplates.ts non ha più la forma attesa: ' +
        "l'estrazione non trova la stringa contenutoHtml. Non aggiornare la costante a caso — " +
        'controlla prima che il template della lettera sia ancora lì.',
    ).not.toBeNull();
    // Guardia contro un'estrazione che «riesce» su una fetta sbagliata di file.
    expect(testo!.length).toBeGreaterThan(1000);
    expect(testo!).toContain('LETTERA D');
  });

  it("LETTERA_INCARICO_TESTO_SHA256 è l'impronta del template della lettera", () => {
    const impronta = improntaTestoLetteraIncarico(sorgente);
    expect(impronta).not.toBeNull();
    expect(
      impronta,
      'Il testo della lettera d\'incarico è cambiato. Aggiorna LETTERA_INCARICO_TESTO_SHA256 in ' +
        'src/services/letteraIncarico.ts con questo valore: da lì in avanti ogni firma della ' +
        'lettera porta un\'impronta diversa, e le firme già registrate restano con la loro, che ' +
        'è la verità di ciò che è stato firmato allora.',
    ).toBe(LETTERA_INCARICO_TESTO_SHA256);
  });

  it('i fine riga non contano: un checkout CRLF e uno LF danno la stessa impronta', () => {
    // Il file è CRLF su Windows e LF altrove. Se i fine riga entrassero nell'impronta, il
    // presidio diventerebbe rosso al primo checkout su un altro sistema, senza che una sola
    // clausola sia cambiata — e un presidio che grida a sproposito si impara a ignorarlo.
    expect(normalizzaFineRiga('a\r\nb')).toBe('a\nb');
    expect(improntaTestoLetteraIncarico(sorgente.replace(/\r\n/g, '\n'))).toBe(LETTERA_INCARICO_TESTO_SHA256);
  });

  it("un template che interpolasse dati non si impronta: meglio l'errore di un'impronta falsa", () => {
    // Con `${…}` il testo dipenderebbe dai dati e non sarebbe più una costante: l'impronta
    // direbbe di coprire una clausola che invece cambia da cliente a cliente.
    const finto = "id: 'tmpl-engagement', contenutoHtml: `clausola ${cliente.nome}`";
    expect(estraiTestoLetteraIncarico(finto)).toBeNull();
  });
});

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';
const CLIENTE_TEST = 'cli-firma-lettera-incarico';

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

describe('§8.4 POST /portal/verify-otp-and-sign — la lettera non dichiara più la sua impronta', () => {
  it("senza documentoHash NON scatena il guard dell'impronta: la calcola il server dai dati dell'incarico", async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'engagement_letter', riferimentoId: 'prj-1' },
    });
    // Supera le validazioni e arriva alla lettura del cliente (500: DB assente nei test).
    // Se il guard dell'impronta fosse ancora attivo per questo ambito arriverebbe il 400
    // "Impronta SHA-256 del documento mancante o non valida".
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });

  it("senza il progetto rifiuta per l'incarico, non per l'impronta", async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: '123456', ambito: 'engagement_letter' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });
});

describe('§8.4 POST /portal/firma-con-file — lo stesso vincolo sull\'altro canale', () => {
  const FILE_FINTO = { filename: 'mandato.pdf', contentBase64: Buffer.from('prova').toString('base64') };

  it("senza documentoHash NON scatena il guard dell'impronta", async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: {
        tipoFirma: 'manuale_scansionata',
        ambito: 'engagement_letter',
        riferimentoId: 'prj-1',
        ...FILE_FINTO,
      },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });

  it("senza il progetto rifiuta per l'incarico, non per l'impronta", async () => {
    const server = nuovoServer();
    const res = await server.inject({
      method: 'POST',
      url: '/portal/firma-con-file',
      payload: { tipoFirma: 'manuale_scansionata', ambito: 'engagement_letter', ...FILE_FINTO },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Manca il progetto da incaricare/);
    expect(res.json().errore).not.toMatch(/Impronta SHA-256/);
  });
});
