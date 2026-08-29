/**
 * §35 — le credenziali dei canali restano sul server, e un canale non configurato lo dice.
 *
 * Prima di questo lavoro il browser spediva email e WhatsApp da sé, chiamando le funzioni
 * serverless con la password SMTP dello studio letta da `localStorage`. La password ci
 * arrivava perché `GET /tenant/info` restituiva la riga Tenant intera. I tre difetti che
 * questi test presidiano, uno per volta:
 *
 * 1. i segreti non devono uscire da `GET /tenant/info` (regola 6). Il flag
 *    `<chiave>Impostata` sostituisce il valore: serve alla UI per distinguere «campo vuoto
 *    perché mascherato» da «nessuna password salvata».
 * 2. il mascheramento deve sopravvivere al giro di ritorno. Il browser riceve `smtpPass: ''`
 *    e rimanda indietro tutto il modulo: se `PATCH` prendesse quella stringa vuota per una
 *    password nuova, salvare la ragione sociale spegnerebbe la posta in uscita dello studio.
 * 3. un canale non configurato risponde 400 col motivo, non 200 con un successo inventato
 *    né 200 con un elenco vuoto (regola 7).
 *
 * Il client Prisma è finto: queste rotte parlano direttamente col database, e qui interessa
 * osservare *cosa* viene scritto — la stringa vuota che non deve comparire nell'`update` non
 * si vede dalla risposta HTTP.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/** Riga Tenant finta e registro delle scritture, riscritti da ogni test. */
const stato: {
  tenant: any;
  upsert: any[];
} = { tenant: null, upsert: [] };

vi.mock('./util/prismaClient.js', async importOriginal => {
  // Il contesto tenant resta quello vero (AsyncLocalStorage, non tocca il database): gli
  // hook di `buildServer` lo impostano su ogni richiesta.
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const tenant = {
    findUnique: async () => stato.tenant,
    findFirst: async () => stato.tenant,
    create: async (args: any) => {
      stato.tenant = { ...args.data };
      return stato.tenant;
    },
    upsert: async (args: any) => {
      stato.upsert.push(args);
      stato.tenant = { ...stato.tenant, ...args.update };
      return stato.tenant;
    },
  };

  const finto: any = {
    tenant,
    auditLog: { create: async () => ({}) },
    user: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [] },
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

const TOKEN = signJwt({
  userId: 'usr-advisor',
  tenantId: TENANT,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
});

function server() {
  return buildServer(new InMemoryApp()) as any;
}

function auth() {
  return { authorization: `Bearer ${TOKEN}` };
}

/** I valori che non devono comparire in nessuna risposta. Nessuno è una credenziale reale. */
const SEGRETI = {
  smtpPass: 'segreto-smtp-di-prova',
  imapPass: 'segreto-imap-di-prova',
  waAccessToken: 'segreto-meta-di-prova',
  waVerifyToken: 'segreto-verifica-di-prova',
  tgBotToken: 'segreto-telegram-di-prova',
};

const TENANT_CONFIGURATO = {
  id: TENANT,
  ragioneSociale: 'Studio di Prova',
  piano: 'enterprise',
  stato: 'attivo',
  smtpHost: 'smtp.esempio.test',
  smtpPort: 465,
  smtpUser: 'studio@esempio.test',
  smtpFromEmail: 'studio@esempio.test',
  smtpFromName: 'Studio di Prova',
  imapHost: 'imap.esempio.test',
  imapUser: 'studio@esempio.test',
  waPhoneId: '000000000000000',
  ...SEGRETI,
};

/**
 * `credenzialiCanali` ricade sull'ambiente quando il tenant non ha le sue credenziali: senza
 * questa pulizia una macchina con `WHATSAPP_ACCESS_TOKEN` impostato farebbe passare il test
 * «canale non configurato» tentando una chiamata vera a Graph.
 */
const AMBIENTE_DA_SVUOTARE = [
  'WA_PHONE_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_RELAY_URL',
  'APP_BASE_URL',
] as const;

const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE_DA_SVUOTARE) ambienteOriginale.set(chiave, process.env[chiave]);

beforeEach(() => {
  stato.tenant = null;
  stato.upsert = [];
  for (const chiave of AMBIENTE_DA_SVUOTARE) delete process.env[chiave];
});

afterAll(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});

describe('§35 — GET /tenant/info non consegna le credenziali al browser', () => {
  it('i cinque segreti escono vuoti, con il flag «Impostata» al loro posto', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({ method: 'GET', url: '/tenant/info', headers: auth() });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    for (const chiave of Object.keys(SEGRETI)) {
      expect(body[chiave]).toBe('');
      expect(body[`${chiave}Impostata`]).toBe(true);
    }

    // La verifica che conta davvero: il valore non deve comparire da nessuna parte nella
    // risposta, nemmeno sotto un'altra chiave aggiunta per distrazione in futuro.
    for (const valore of Object.values(SEGRETI)) {
      expect(res.body).not.toContain(valore);
    }
  });

  it('senza credenziali salvate il flag è falso: «vuoto» e «mascherato» restano distinguibili', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Nuovo', smtpPass: null, imapPass: '', waAccessToken: null };

    const body = (await server().inject({ method: 'GET', url: '/tenant/info', headers: auth() })).json();

    expect(body.smtpPassImpostata).toBe(false);
    expect(body.imapPassImpostata).toBe(false);
    expect(body.waAccessTokenImpostata).toBe(false);
  });

  it('la rotta resta protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'GET', url: '/tenant/info' });
    expect(res.statusCode).toBe(401);
  });
});

describe('§35 — PATCH /tenant/info: la stringa vuota non cancella la password salvata', () => {
  it("salvare l'anagrafica col campo password vuoto non scrive smtpPass", async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    // È esattamente il corpo che manda `SettingsPage` dopo aver ricevuto i segreti mascherati.
    const res = await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: {
        ragioneSociale: 'Studio di Prova (rinominato)',
        smtpPass: '',
        imapPass: '',
        waAccessToken: '',
        waVerifyToken: '',
        tgBotToken: '',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.upsert).toHaveLength(1);
    const scritto = stato.upsert[0].update;
    expect(scritto.ragioneSociale).toBe('Studio di Prova (rinominato)');
    for (const chiave of Object.keys(SEGRETI)) {
      expect(chiave in scritto).toBe(false);
    }
    // E la password vera è ancora quella di prima.
    expect(stato.tenant.smtpPass).toBe(SEGRETI.smtpPass);
  });

  it('una password nuova invece si scrive, e torna mascherata', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: { smtpPass: 'password-nuova-di-prova' },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.upsert[0].update.smtpPass).toBe('password-nuova-di-prova');
    expect(res.json().smtpPass).toBe('');
    expect(res.json().smtpPassImpostata).toBe(true);
    expect(res.body).not.toContain('password-nuova-di-prova');
  });

  it('`null` esplicito cancella: spegnere un canale deve restare possibile', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: { smtpPass: null, waAccessToken: null },
    });

    expect(stato.upsert[0].update.smtpPass).toBeNull();
    expect(stato.upsert[0].update.waAccessToken).toBeNull();
  });
});

describe('§35 — POST /comunicazioni/invia-email', () => {
  it('senza SMTP configurato risponde 400 col motivo, non un successo', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Posta' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-email',
      headers: auth(),
      payload: { to: 'cliente@esempio.test', subject: 'Documenti', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errore).toMatch(/non configurata/i);
  });

  it('destinatario non valido: 400 prima di qualunque tentativo di consegna', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-email',
      headers: auth(),
      payload: { to: 'non-un-indirizzo', subject: 'Documenti', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/destinatario/i);
  });

  it('senza contenuto non spedisce una email vuota', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-email',
      headers: auth(),
      payload: { to: 'cliente@esempio.test', subject: 'Documenti', testo: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/contenuto/i);
  });

  it('la rotta è protetta: il bypass browser→Vercel non torna come rotta aperta', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-email',
      payload: { to: 'cliente@esempio.test', subject: 'x', testo: 'y' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('§35 — POST /comunicazioni/invia-whatsapp', () => {
  it('senza access token risponde 400 e non tenta nessun ripiego su hello_world', async () => {
    // Il Phone ID c'è, il token no: è la configurazione a metà con cui l'operatore si trovava
    // un «inviato» in interfaccia e nessun messaggio sul telefono del cliente.
    stato.tenant = { id: TENANT, waPhoneId: '000000000000000' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      headers: auth(),
      payload: { to: '+390000000000', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errore).toMatch(/non è configurato/i);
  });

  it('numero assente: 400, senza chiamare Meta', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      headers: auth(),
      payload: { testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/numero/i);
  });

  it('numero troppo corto: 400 con il motivo, non un tentativo a vuoto', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      headers: auth(),
      payload: { to: '12345', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/8 cifre/);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('§35 — POST /comunicazioni/email-in-arrivo', () => {
  it('casella non configurata: 400 con il motivo, non 200 con un elenco vuoto', async () => {
    // 200 + `[]` era il difetto: il fascicolo mostrava «il cliente non ha risposto» quando la
    // verità era «la casella non è configurata» (regola 7).
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza IMAP' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/email-in-arrivo',
      headers: auth(),
      payload: { clientEmail: 'cliente@esempio.test' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.email).toEqual([]);
    expect(body.errore).toMatch(/non configurata/i);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'POST', url: '/comunicazioni/email-in-arrivo', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
