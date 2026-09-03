/**
 * §23 — i due buchi sfruttabili del portale cliente, come proprietà verificabili.
 *
 * Cosa succedeva prima, per memoria:
 *
 * 1. `POST /auth/magic-login` accettava **qualunque** stringa che iniziasse per `client_` e
 *    in cambio firmava un JWT con tenant ed email cablati nel sorgente. Non era una verifica
 *    debole da irrobustire: era assente, perché i token non venivano persistiti da nessuna
 *    parte e non c'era nulla contro cui confrontarli. Un `curl` con
 *    `{"magicToken":"client_x"}` otteneva una sessione valida di ruolo `cliente` sul tenant
 *    che contiene i dati. Il rate limiting non c'entrava — non c'era niente da indovinare.
 *
 * 2. `GET /uploads/:filename` era pubblica e concatenava il parametro di rotta senza
 *    sanificarlo. Fastify decodifica i parametri, quindi `..%2f..%2fpackage.json` arrivava al
 *    handler come `../../package.json` e `path.join` usciva dalla cartella `uploads/`.
 *
 * Il mock del client Prisma serve perché entrambi gli endpoint parlano col database: senza
 * di esso non si può osservare cosa accade *dopo* i controlli, che è dove stava il difetto.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Righe restituite dal finto client, riscritte da ogni test prima dell'uso. */
const stato: {
  magicLink: any;
  magicLinkCreati: any[];
  magicLinkAggiornati: any[];
  cliente: any;
} = { magicLink: null, magicLinkCreati: [], magicLinkAggiornati: [], cliente: null };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    magicLink: {
      // `findUnique` filtra su `tokenHash`: il finto lo onora, altrimenti il test
      // "token inventato → 401" passerebbe anche con una verifica rotta.
      findUnique: async (args: any) =>
        stato.magicLink && stato.magicLink.tokenHash === args?.where?.tokenHash ? stato.magicLink : null,
      create: async (args: any) => {
        stato.magicLinkCreati.push(args.data);
        return { id: 'ml-1', ...args.data };
      },
      update: async (args: any) => {
        stato.magicLinkAggiornati.push(args);
        return { ...stato.magicLink, ...args.data };
      },
    },
    cliente: {
      findUnique: async () => stato.cliente,
      findFirst: async () => stato.cliente,
      update: async (args: any) => ({ ...stato.cliente, ...args.data }),
    },
    auditLog: { create: async () => ({}) },
    tenant: { findUnique: async () => null, create: async (a: any) => a.data, upsert: async (a: any) => a.update },
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Importati dopo `vi.mock`: `server.js` risolve `prismaClient.js` al proprio import.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt, hashMagicToken, firmaDownload } = await import('./util/jwt.js');
const { hashPassword } = await import('./util/password.js');
const { CARTELLA_UPLOADS } = await import('./services/storageService.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const TENANT_ALTRO = '00000000-0000-0000-0000-000000000002';

function server() {
  return buildServer(new InMemoryApp()) as any;
}

function tokenAdvisor(tenantId = TENANT_STUDIO) {
  return signJwt({ userId: 'usr-advisor', tenantId, email: 'advisor@studio.example', ruolo: 'advisor' });
}

/** Riga `magic_link` valida per un cliente del tenant indicato. */
function linkValido(token: string, opzioni: { scadenza?: Date; tenantId?: string; usatoAt?: Date | null } = {}) {
  const tenantId = opzioni.tenantId ?? TENANT_ALTRO;
  return {
    id: 'ml-1',
    tenantId,
    clienteId: 'cli-42',
    tokenHash: hashMagicToken(token),
    scadenza: opzioni.scadenza ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    email: 'cliente@esempio.it',
    usatoAt: opzioni.usatoAt ?? null,
    createdAt: new Date(),
    cliente: { id: 'cli-42', tenantId, nome: 'Holding Beta S.r.l.' },
  };
}

function payloadJwt(token: string): any {
  const parte = token.split('.')[1]!;
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

beforeEach(() => {
  stato.magicLink = null;
  stato.magicLinkCreati = [];
  stato.magicLinkAggiornati = [];
  stato.cliente = null;
});

describe('§23 POST /auth/magic-login — solo i token che abbiamo emesso', () => {
  it('rifiuta un token inventato che rispetta il vecchio formato `client_...`', async () => {
    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-login',
      payload: { magicToken: 'client_inventato_deadbeef' },
    });

    expect(res.statusCode).toBe(401);
    // Nessun token in risposta: prima qui arrivava un JWT valido di ruolo `cliente`.
    expect(res.json().token).toBeUndefined();
  });

  it('rifiuta un token assente o non stringa', async () => {
    const app = server();

    const senza = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: {} });
    expect(senza.statusCode).toBe(401);

    const numerico = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: 42 } });
    expect(numerico.statusCode).toBe(401);
  });

  it('rifiuta un token emesso ma scaduto', async () => {
    const token = 'client_cli-42_' + crypto.randomBytes(16).toString('hex');
    stato.magicLink = linkValido(token, { scadenza: new Date(Date.now() - 1000) });

    const app = server();
    const res = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: token } });

    expect(res.statusCode).toBe(401);
    // Nessuna scrittura: un link scaduto non si segna come usato.
    expect(stato.magicLinkAggiornati).toHaveLength(0);
  });

  it('dà lo stesso messaggio per token inesistente e token scaduto', async () => {
    const app = server();

    const inesistente = await app.inject({
      method: 'POST',
      url: '/auth/magic-login',
      payload: { magicToken: 'client_mai_emesso' },
    });

    const token = 'client_cli-42_' + crypto.randomBytes(16).toString('hex');
    stato.magicLink = linkValido(token, { scadenza: new Date(Date.now() - 1000) });
    const scaduto = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: token } });

    // Distinguerli direbbe a chi prova se un token è mai esistito.
    expect(inesistente.json()).toEqual(scaduto.json());
  });

  it('accetta un token valido e firma il tenant preso dalla riga, non una costante', async () => {
    const token = 'client_cli-42_' + crypto.randomBytes(16).toString('hex');
    // Di proposito un tenant diverso dal default cablato in `/auth/magic-login` prima del fix.
    stato.magicLink = linkValido(token, { tenantId: TENANT_ALTRO });

    const app = server();
    const res = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: token } });

    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.token).toBeTruthy();

    const payload = payloadJwt(corpo.token);
    expect(payload.tenantId).toBe(TENANT_ALTRO);
    expect(payload.tenantId).not.toBe(TENANT_STUDIO);
    expect(payload.ruolo).toBe('cliente');
    // L'email non è più `client@holdingbeta.advisory` cablata nel sorgente.
    expect(payload.email).toBe('cliente@esempio.it');
    expect(corpo.user.clienteId).toBe('cli-42');
  });

  it('registra il primo utilizzo e resta valido per i successivi', async () => {
    const token = 'client_cli-42_' + crypto.randomBytes(16).toString('hex');
    stato.magicLink = linkValido(token);

    const app = server();
    const primo = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: token } });
    expect(primo.statusCode).toBe(200);
    expect(stato.magicLinkAggiornati).toHaveLength(1);
    expect(stato.magicLinkAggiornati[0].data.usatoAt).toBeInstanceOf(Date);

    // Un cliente riapre il proprio link: invalidarlo al primo accesso lo chiuderebbe fuori.
    stato.magicLink = { ...stato.magicLink, usatoAt: new Date() };
    const secondo = await app.inject({ method: 'POST', url: '/auth/magic-login', payload: { magicToken: token } });
    expect(secondo.statusCode).toBe(200);
    expect(stato.magicLinkAggiornati).toHaveLength(1); // non riscrive `usatoAt`
  });
});

describe('§23 POST /clienti/:id/magic-link — emissione verificabile', () => {
  it('persiste solo lo SHA-256 del token, non il token', async () => {
    stato.cliente = { id: 'cli-42', tenantId: TENANT_STUDIO, nome: 'Holding Beta S.r.l.' };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/clienti/cli-42/magic-link',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
      payload: { email: 'cliente@esempio.it' },
    });

    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.magicToken).toBeTruthy();
    expect(stato.magicLinkCreati).toHaveLength(1);

    const salvato = stato.magicLinkCreati[0];
    // Chi legge il database non deve poter entrare al posto del cliente.
    expect(salvato.tokenHash).not.toBe(corpo.magicToken);
    expect(salvato.tokenHash).toBe(hashMagicToken(corpo.magicToken));
    expect(salvato.clienteId).toBe('cli-42');
    expect(salvato.email).toBe('cliente@esempio.it');
    expect(salvato.scadenza.getTime()).toBeGreaterThan(Date.now());
  });

  it('emette un token imprevedibile, non derivato dall orologio', async () => {
    stato.cliente = { id: 'cli-42', tenantId: TENANT_STUDIO, nome: 'Holding Beta S.r.l.' };
    const app = server();

    const emetti = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/clienti/cli-42/magic-link',
        headers: { authorization: `Bearer ${tokenAdvisor()}` },
        payload: { email: 'cliente@esempio.it' },
      });
      return res.json().magicToken as string;
    };

    const primo = await emetti();
    const secondo = await emetti();

    expect(primo).not.toBe(secondo);
    // 16 byte esadecimali di `crypto.randomBytes` in coda: prima era `Date.now()`.
    expect(primo).toMatch(/_[0-9a-f]{32}$/);
  });

  it('pretende un indirizzo email: non ne inventa uno cablato nel sorgente', async () => {
    stato.cliente = { id: 'cli-42', tenantId: TENANT_STUDIO, nome: 'Holding Beta S.r.l.' };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/clienti/cli-42/magic-link',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(stato.magicLinkCreati).toHaveLength(0);
  });

  it('404 su un cliente che non esiste, invece di emettere un link non verificabile', async () => {
    stato.cliente = null;

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/clienti/cli-inesistente/magic-link',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
      payload: { email: 'cliente@esempio.it' },
    });

    expect(res.statusCode).toBe(404);
    expect(stato.magicLinkCreati).toHaveLength(0);
  });

  it('resta dietro il guard di autenticazione', async () => {
    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/clienti/cli-42/magic-link',
      payload: { email: 'cliente@esempio.it' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('§Sicurezza GET /uploads/:filename — confinata e non anonima', () => {
  const NOME_FILE = 'test_uploads_presidio.png';
  const percorsoFile = path.join(CARTELLA_UPLOADS, NOME_FILE);

  beforeEach(() => {
    if (!fs.existsSync(CARTELLA_UPLOADS)) fs.mkdirSync(CARTELLA_UPLOADS, { recursive: true });
    fs.writeFileSync(percorsoFile, Buffer.from('89504e470d0a1a0a', 'hex'));
  });

  // Il file di prova sta nella cartella vera perché il handler risolve `CARTELLA_UPLOADS`
  // all'import: va quindi rimosso, per non lasciare residui fra un'esecuzione e l'altra.
  afterAll(() => {
    if (fs.existsSync(percorsoFile)) fs.unlinkSync(percorsoFile);
  });

  it('rifiuta il path traversal con 400, anche percent-encoded', async () => {
    const app = server();

    // Fastify decodifica i parametri di rotta: prima questo arrivava al handler come
    // `../../package.json` e `path.join` usciva dalla cartella uploads.
    for (const nome of ['..%2f..%2fpackage.json', '..%2F.env', '%2e%2e%2f%2e%2e%2fpackage.json']) {
      const res = await app.inject({
        method: 'GET',
        url: `/uploads/${nome}`,
        headers: { authorization: `Bearer ${tokenAdvisor()}` },
      });
      expect(res.statusCode, `nome: ${nome}`).toBe(400);
    }
  });

  it('non serve alcun file senza Bearer né firma', async () => {
    const app = server();
    const res = await app.inject({ method: 'GET', url: `/uploads/${NOME_FILE}` });

    expect(res.statusCode).toBe(401);
  });

  it('serve il file a una richiesta autenticata col Bearer', async () => {
    const app = server();
    const res = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_FILE}`,
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('serve il file con la firma in query string, che è la prova per gli `<img src>`', async () => {
    const { firma, scad } = firmaDownload(NOME_FILE);

    const app = server();
    const res = await app.inject({ method: 'GET', url: `/uploads/${NOME_FILE}?firma=${firma}&scad=${scad}` });

    expect(res.statusCode).toBe(200);
  });

  it('rifiuta una firma manomessa, di un altro file, o scaduta', async () => {
    const app = server();
    const { firma, scad } = firmaDownload(NOME_FILE);

    const manomessa = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_FILE}?firma=${'0'.repeat(firma.length)}&scad=${scad}`,
    });
    expect(manomessa.statusCode).toBe(401);

    // Una firma valida per un altro nome non vale per questo: il nome entra nell'HMAC.
    const altroFile = firmaDownload('altro_file.png');
    const riusata = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_FILE}?firma=${altroFile.firma}&scad=${altroFile.scad}`,
    });
    expect(riusata.statusCode).toBe(401);

    // Scadenza nel passato: il timestamp è dentro l'HMAC, quindi non si può spostare avanti.
    const passata = await app.inject({
      method: 'GET',
      url: `/uploads/${NOME_FILE}?firma=${firma}&scad=${Math.floor(Date.now() / 1000) - 10}`,
    });
    expect(passata.statusCode).toBe(401);
  });
});

describe('§23 POST /auth/client-login — credenziali dedicate per cliente', () => {
  it('autentica il cliente con email e password corrette e rilascia JWT cliente', async () => {
    const PWD_TEST = 'PasswordForte123!';
    stato.cliente = {
      id: 'cli-test-99',
      tenantId: TENANT_ALTRO,
      nome: 'Società Alfa S.r.l.',
      email: 'alfa@holding.it',
      passwordHash: hashPassword(PWD_TEST),
    };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/client-login',
      payload: { email: 'alfa@holding.it', password: PWD_TEST },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.user.ruolo).toBe('cliente');
    expect(body.user.clienteId).toBe('cli-test-99');
    expect(body.user.tenantId).toBe(TENANT_ALTRO);

    const decoded = payloadJwt(body.token);
    expect(decoded.ruolo).toBe('cliente');
    expect(decoded.tenantId).toBe(TENANT_ALTRO);
    expect(decoded.userId).toBe('client-cli-test-99');
  });

  it('rifiuta password errata con 401', async () => {
    stato.cliente = {
      id: 'cli-test-99',
      tenantId: TENANT_ALTRO,
      nome: 'Società Alfa S.r.l.',
      email: 'alfa@holding.it',
      passwordHash: hashPassword('PasswordCorretta!'),
    };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/client-login',
      payload: { email: 'alfa@holding.it', password: 'PasswordSbagliata!' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().errore).toContain('non valide');
  });

  it('rifiuta cliente senza password configurata', async () => {
    stato.cliente = {
      id: 'cli-test-99',
      tenantId: TENANT_ALTRO,
      nome: 'Società Alfa S.r.l.',
      email: 'alfa@holding.it',
      passwordHash: null,
    };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/client-login',
      payload: { email: 'alfa@holding.it', password: 'QualunquePassword' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('§23 POST /clienti/:id/reset-password — generazione credenziali cliente', () => {
  it('genera una nuova password e la restituisce in chiaro nella risposta', async () => {
    stato.cliente = {
      id: 'cli-test-88',
      tenantId: TENANT_STUDIO,
      nome: 'Cliente Beta',
      email: 'beta@holding.it',
      passwordHash: null,
    };

    const app = server();
    const res = await app.inject({
      method: 'POST',
      url: '/clienti/cli-test-88/reset-password',
      headers: { authorization: `Bearer ${tokenAdvisor(TENANT_STUDIO)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.passwordChiaro).toBe('string');
    expect(body.passwordChiaro.length).toBeGreaterThanOrEqual(12);
  });
});

