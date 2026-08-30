/**
 * §35 — «dalle impostazioni neanche il test passa»: cosa risponde una prova che non può riuscire.
 *
 * Le due rotte che il pulsante «Testa» chiama, `POST /tenant/test-email` e
 * `POST /tenant/test-imap`, prima completavano la configurazione mancante con
 * `process.env.SMTP_*` e, in ultima istanza, con un host e un'utenza scritti nel codice: uno
 * studio che non aveva configurato niente vedeva la prova **riuscire**, perché passava dalla
 * casella della piattaforma, e uno studio con l'host sbagliato leggeva l'errore di un server
 * che non aveva mai indicato (regola 6, regola 7).
 *
 * Questi test verificano il comportamento a valle di quella correzione: la prova di una casella
 * non configurata risponde 400 dicendo cosa manca, non nomina nessun provider, e la rotta resta
 * protetta. Nessuno di questi rami apre un socket — la verifica si ferma prima — quindi il test
 * non dipende dalla rete.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/** Riga Tenant finta, riscritta da ogni test. */
const stato: { tenant: any } = { tenant: null };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    tenant: {
      findUnique: async () => stato.tenant,
      findFirst: async () => stato.tenant,
      upsert: async (args: any) => {
        stato.tenant = { ...stato.tenant, ...args.update };
        return stato.tenant;
      },
    },
    auditLog: { create: async () => ({}) },
    user: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [] },
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';
const TOKEN = signJwt({ userId: 'usr-advisor', tenantId: TENANT, email: 'advisor@studio.example', ruolo: 'advisor' });

const server = () => buildServer(new InMemoryApp()) as any;
const auth = () => ({ authorization: `Bearer ${TOKEN}` });

/** Nomi che non devono comparire in una risposta: sono server e mittenti di altri. */
const NOMI_DI_ALTRI = ['register.it', 'bluecode-ltd.com', 'securemail.pro', 'bluecode.advisory', 'BlueCode'];

/**
 * Senza questa pulizia una macchina con `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` impostati farebbe
 * passare per «configurata» una casella che il tenant non ha — cioè esattamente il difetto che
 * questi test presidiano — e `EMAIL_RELAY_URL` farebbe partire una richiesta HTTP vera.
 */
const AMBIENTE_DA_SVUOTARE = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_RELAY_URL', 'APP_BASE_URL'] as const;

const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE_DA_SVUOTARE) ambienteOriginale.set(chiave, process.env[chiave]);

beforeEach(() => {
  stato.tenant = null;
  for (const chiave of AMBIENTE_DA_SVUOTARE) delete process.env[chiave];
});

afterAll(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});

describe('§35 — POST /tenant/test-email', () => {
  it('casella non configurata: 400 con l\'elenco di cosa manca', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Posta' };

    const res = await server().inject({ method: 'POST', url: '/tenant/test-email', headers: auth(), payload: {} });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.errore).toMatch(/non configurata/i);
    expect(body.errore).toMatch(/il server SMTP/);
    expect(body.errore).toMatch(/utenza/);
    expect(body.errore).toMatch(/password/);
    // Il pulsante mostra `message`: deve dire che è andata male, non restare ambiguo.
    expect(body.message).toContain('❌');
  });

  it('solo la password mancante: lo dice al singolare, senza toccare la rete', async () => {
    stato.tenant = { id: TENANT, smtpHost: 'smtp.esempio.test', smtpUser: 'studio@esempio.test' };

    const res = await server().inject({ method: 'POST', url: '/tenant/test-email', headers: auth(), payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/la password nelle impostazioni dello studio è vuot/i);
  });

  it('nessun server né mittente di altri nella risposta', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Posta' };

    const res = await server().inject({ method: 'POST', url: '/tenant/test-email', headers: auth(), payload: {} });

    for (const nome of NOMI_DI_ALTRI) expect(res.body).not.toContain(nome);
  });

  it('la rotta resta protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'POST', url: '/tenant/test-email', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('§35 — POST /tenant/test-imap', () => {
  it('casella in arrivo non configurata: 400 col motivo', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Posta' };

    const res = await server().inject({ method: 'POST', url: '/tenant/test-imap', headers: auth(), payload: {} });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.errore).toMatch(/non configurata/i);
    expect(body.message).toContain('❌');
    for (const nome of NOMI_DI_ALTRI) expect(res.body).not.toContain(nome);
  });

  it('host IMAP presente ma nessuna credenziale: non ricade sulla casella di un altro', async () => {
    // Il ripiego era `imap.register.it` con l'utenza di `process.env`: la prova si collegava —
    // o tentava di collegarsi — a un server che questo studio non ha mai indicato.
    stato.tenant = { id: TENANT, imapHost: 'imap.esempio.test' };
    process.env.SMTP_USER = 'piattaforma@esempio.test';
    process.env.SMTP_PASS = 'segreto-della-piattaforma';

    const res = await server().inject({ method: 'POST', url: '/tenant/test-imap', headers: auth(), payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/non configurata/i);
    // E soprattutto: la credenziale d'ambiente non è stata usata né riportata.
    expect(res.body).not.toContain('piattaforma@esempio.test');
    expect(res.body).not.toContain('segreto-della-piattaforma');
  });

  it('la rotta resta protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'POST', url: '/tenant/test-imap', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('§35 — POST /tenant/test-channel, canale email', () => {
  it('senza posta configurata risponde con l\'esito della prova, non «non raggiungibile»', async () => {
    // Prima qui si chiamava `createTransporter(...).verify()`: su Railway scadeva sempre, e il
    // pulsante rispondeva «server non raggiungibile» anche su configurazioni funzionanti.
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Posta' };

    const res = await server().inject({
      method: 'POST',
      url: '/tenant/test-channel',
      headers: auth(),
      payload: { channel: 'email' },
    });

    const body = res.json();
    expect(body.ok ?? body.success).toBe(false);
    expect(JSON.stringify(body)).toMatch(/non configurata/i);
    for (const nome of NOMI_DI_ALTRI) expect(res.body).not.toContain(nome);
  });
});
