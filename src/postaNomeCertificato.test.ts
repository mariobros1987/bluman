/**
 * §35 — il nome dichiarato per il certificato arriva davvero sul filo.
 *
 * Il guasto che questi test presidiano è misurato sulla casella dello studio: `imap.register.it`
 * risolve nel DNS ma presenta un certificato per `*.securemail.pro`, mentre `imap.securemail.pro`
 * è coperto dal certificato e non ha alcun record DNS. Nessun singolo valore nel campo «Server»
 * può soddisfare insieme la risoluzione e la verifica: chi metteva il nome che risolve leggeva
 * «Host … is not in the cert's altnames», chi metteva quello del certificato leggeva ENOTFOUND.
 *
 * Il tentativo precedente — risolvere il nome con `dns.lookup` sul backend e collegarsi all'IP —
 * non poteva funzionare: un nome senza record A non risolve da Railway più di quanto risolva da
 * Vercel, il DNS è lo stesso. La correzione separa i due nomi: `host` è l'indirizzo a cui
 * collegarsi, `servername` il nome che il certificato deve attestare.
 *
 * Quello che questi test NON accettano: che `servername` diventi un modo per non verificare il
 * certificato. `rejectUnauthorized` resta vero in ogni caso qui sotto (§3.4) — cambia il nome con
 * cui il certificato viene confrontato, non il fatto che venga confrontato.
 *
 * Nessun test apre un socket: `fetch` e `nodemailer` sono finti, e si osserva cosa ricevono.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/** Opzioni con cui `nodemailer.createTransport` è stato chiamato, in ordine. */
const trasporti: any[] = [];
/** Corpi JSON inviati al relay, già decodificati. */
const corpiRelay: any[] = [];

vi.mock('./util/networkPolicy.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/networkPolicy.js')>();
  return {
    ...reale,
    risolviEndpointPubblico: async (hostInput: unknown, servernameInput?: unknown) => {
      const host = reale.validaHost(hostInput);
      const servername = servernameInput ? reale.validaServername(servernameInput) : host;
      return { host, address: '203.1.2.3', family: 4 as const, servername };
    },
  };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opzioni: any) => {
      trasporti.push(opzioni);
      return {
        sendMail: async () => ({ messageId: 'finto' }),
        verify: async () => true,
      };
    },
  },
}));

const { inviaEmail } = await import('./services/emailRelay.js');
const { leggiPostaInArrivo } = await import('./services/imapInbound.js');

const RELAY = 'https://esempio.test/api/send-email';

const AMBIENTE = [
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SERVERNAME',
  'EMAIL_RELAY_URL', 'EMAIL_RELAY_SECRET', 'APP_BASE_URL', 'NODE_ENV',
] as const;

const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE) ambienteOriginale.set(chiave, process.env[chiave]);

const fetchOriginale = global.fetch;

/** Relay che accetta tutto e registra il corpo: serve a leggere cosa gli è stato spedito. */
function relayCheAccetta() {
  global.fetch = (async (_url: any, opzioni: any) => {
    corpiRelay.push(JSON.parse(String(opzioni?.body ?? '{}')));
    return { ok: true, status: 200, json: async () => ({ success: true, email: [] }) } as any;
  }) as any;
}

/** Relay che rifiuta: costringe `inviaEmail` a ripiegare sull'SMTP diretto. */
function relayCheRifiuta() {
  global.fetch = (async (_url: any, opzioni: any) => {
    corpiRelay.push(JSON.parse(String(opzioni?.body ?? '{}')));
    return { ok: false, status: 502, json: async () => ({ success: false, errore: 'relay finto spento' }) } as any;
  }) as any;
}

beforeEach(() => {
  trasporti.length = 0;
  corpiRelay.length = 0;
  for (const chiave of AMBIENTE) delete process.env[chiave];
  global.fetch = fetchOriginale;
});

afterAll(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
  global.fetch = fetchOriginale;
});

const CASELLA = {
  host: 'authsmtp.esempio.test',
  servername: 'authsmtp.certificato.test',
  port: 465,
  secure: true,
  user: 'studio@esempio.test',
  pass: 'password-di-prova-non-reale',
};

const MESSAGGIO = {
  to: 'cliente@esempio.test',
  subject: 'Codice di firma',
  html: '<p>123456</p>',
  etichetta: 'OTP',
};

describe('§35 — posta in uscita: il nome del certificato viaggia con la richiesta', () => {
  it('via relay: il corpo porta `smtpServername` accanto all\'host', async () => {
    process.env.EMAIL_RELAY_URL = RELAY;
    relayCheAccetta();

    const esito = await inviaEmail({ ...MESSAGGIO, smtp: CASELLA });

    expect(esito.ok).toBe(true);
    expect(corpiRelay).toHaveLength(1);
    // I due nomi restano distinti: l'host è quello a cui si collega, il servername quello che il
    // certificato deve attestare. Confonderli è il difetto da cui nasce questa colonna.
    expect(corpiRelay[0].smtpHost).toBe('authsmtp.esempio.test');
    expect(corpiRelay[0].smtpServername).toBe('authsmtp.certificato.test');
  });

  it('SMTP diretto: nodemailer riceve `tls.servername` e verifica comunque il certificato', async () => {
    // Nessun relay configurato: è la strada della macchina di chi sviluppa, e il ripiego in
    // produzione quando il relay è spento.
    const esito = await inviaEmail({ ...MESSAGGIO, smtp: CASELLA });

    expect(esito.ok).toBe(true);
    expect(trasporti).toHaveLength(1);
    expect(trasporti[0].host).toBe('203.1.2.3');
    expect(trasporti[0].tls.servername).toBe('authsmtp.certificato.test');
    // §3.4 — il nome dichiarato non è un'eccezione alla verifica.
    expect(trasporti[0].tls.rejectUnauthorized).toBe(true);
  });

  it('campo vuoto: nessun `servername`, si verifica l\'host come di norma', async () => {
    const esito = await inviaEmail({ ...MESSAGGIO, smtp: { ...CASELLA, servername: undefined } });

    expect(esito.ok).toBe(true);
    expect(trasporti[0].tls.servername).toBe('authsmtp.esempio.test');
    expect(trasporti[0].tls.rejectUnauthorized).toBe(true);
  });

  it('ripiego dopo un relay rifiutato: il nome dichiarato resta su entrambe le strade', async () => {
    process.env.EMAIL_RELAY_URL = RELAY;
    relayCheRifiuta();

    const esito = await inviaEmail({ ...MESSAGGIO, smtp: CASELLA });

    expect(esito.ok).toBe(true);
    expect(corpiRelay[0].smtpServername).toBe('authsmtp.certificato.test');
    expect(trasporti[0].tls.servername).toBe('authsmtp.certificato.test');
  });

  it('`SMTP_SERVERNAME` serve solo dove lo studio non ha dichiarato niente', async () => {
    process.env.SMTP_SERVERNAME = 'nome.di-ambiente.test';

    await inviaEmail({ ...MESSAGGIO, smtp: CASELLA });
    // La riga Tenant vince sull'ambiente: su un'installazione multi-studio l'ambiente è di uno
    // solo, e verificare il certificato contro il nome di un altro studio è un guasto silenzioso.
    expect(trasporti[0].tls.servername).toBe('authsmtp.certificato.test');

    trasporti.length = 0;
    await inviaEmail({ ...MESSAGGIO, smtp: { ...CASELLA, servername: undefined } });
    expect(trasporti[0].tls.servername).toBe('nome.di-ambiente.test');
  });
});

describe('§35 — posta in arrivo: il nome del certificato arriva al relay', () => {
  it('il corpo della lettura porta `imapServername`', async () => {
    process.env.EMAIL_RELAY_URL = RELAY;
    relayCheAccetta();

    const esito = await leggiPostaInArrivo({
      host: 'imap.esempio.test',
      servername: 'imap.certificato.test',
      port: 993,
      user: 'studio@esempio.test',
      pass: 'password-di-prova-non-reale',
    });

    expect(esito.ok).toBe(true);
    expect(corpiRelay).toHaveLength(1);
    expect(corpiRelay[0].imapHost).toBe('imap.esempio.test');
    expect(corpiRelay[0].imapServername).toBe('imap.certificato.test');
  });

  it('casella non configurata: nessuna richiesta, e il motivo invece di un elenco vuoto', async () => {
    process.env.EMAIL_RELAY_URL = RELAY;
    relayCheAccetta();

    const esito = await leggiPostaInArrivo({ host: '', servername: 'imap.certificato.test', user: '', pass: '' });

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/non configurata/i);
    expect(corpiRelay).toHaveLength(0);
  });
});

describe('§35 — il backend fissa l’indirizzo verificato', () => {
  it('la risoluzione e la policy vivono nel modulo centralizzato, non nei servizi posta', async () => {
    // Le connessioni dirette passano da `networkPolicy`: lì ogni risposta DNS viene verificata e
    // viene restituito un solo IP, che i servizi usano senza una seconda risoluzione (TOCTOU).
    const { readFileSync } = await import('node:fs');
    const policy = readFileSync('src/util/networkPolicy.ts', 'utf8');
    expect(policy).toMatch(/node:dns\/promises/);
    expect(policy).toMatch(/indirizzoVietato/);
    expect(policy).toMatch(/address:\s*primo\.address/);

    for (const file of ['src/services/imapInbound.ts', 'src/services/emailRelay.ts']) {
      const codice = readFileSync(file, 'utf8');
      expect(codice).toMatch(/risolviEndpointPubblico/);
      expect(codice).toMatch(/host:\s*endpoint\.address/);
    }
  });
});
