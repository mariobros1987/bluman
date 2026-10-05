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

  const utente = (args: any) => {
    const id = args?.where?.id;
    if (id === 'usr-advisor') {
      return { id, tenantId: TENANT, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 };
    }
    if (id === 'usr-collaboratore') {
      return { id, tenantId: TENANT, ruolo: 'collaboratore_interno', stato: 'attivo', sessionVersion: 0 };
    }
    return null;
  };
  const finto: any = {
    tenant,
    auditLog: { create: async () => ({}) },
    user: { findUnique: async (args: any) => utente(args), findFirst: async (args: any) => utente(args), findMany: async () => [] },
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
  sessionVersion: 0,
});
const TOKEN_COLLABORATORE = signJwt({
  userId: 'usr-collaboratore',
  tenantId: TENANT,
  email: 'collaboratore@studio.example',
  ruolo: 'collaboratore_interno',
  sessionVersion: 0,
});

function server() {
  return buildServer(new InMemoryApp()) as any;
}

function auth() {
  return { authorization: `Bearer ${TOKEN}` };
}

function authCollaboratore() {
  return { authorization: `Bearer ${TOKEN_COLLABORATORE}` };
}

/** I valori che non devono comparire in nessuna risposta. Nessuno è una credenziale reale. */
const SEGRETI = {
  smtpPass: 'segreto-smtp-di-prova',
  imapPass: 'segreto-imap-di-prova',
  waAccessToken: 'segreto-meta-di-prova',
  waVerifyToken: 'segreto-verifica-di-prova',
  tgBotToken: 'segreto-telegram-di-prova',
  signalToken: 'segreto-signal-di-prova',
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

  it('un collaboratore non può modificare le impostazioni dello studio (né canali né anagrafica)', async () => {
    // Decisione titolare 27/09/2026 (rilievo audit §01): PATCH /tenant/info è riservato ad
    // advisor/super_admin per intero — non solo i canali. Un collaboratore non può cambiare l'IBAN,
    // i dati fiscali né la ragione sociale (prima l'anagrafica era modificabile: rischio manomissione).
    stato.tenant = { ...TENANT_CONFIGURATO };
    const canale = await server().inject({
      method: 'PATCH', url: '/tenant/info', headers: authCollaboratore(), payload: { smtpHost: 'smtp.example.com' },
    });
    expect(canale.statusCode).toBe(403);
    expect(stato.upsert).toHaveLength(0);

    const anagrafica = await server().inject({
      method: 'PATCH', url: '/tenant/info', headers: authCollaboratore(), payload: { ragioneSociale: 'Studio Rinominato' },
    });
    expect(anagrafica.statusCode).toBe(403);
    expect(stato.upsert).toHaveLength(0);
  });

  it('rifiuta configurazioni SMTP/IMAP non valide prima del database', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };
    const porta = await server().inject({
      method: 'PATCH', url: '/tenant/info', headers: auth(), payload: { smtpPort: 0 },
    });
    expect(porta.statusCode).toBe(400);

    const cartella = await server().inject({
      method: 'PATCH', url: '/tenant/info', headers: auth(), payload: { imapFolder: 'INBOX\r\nA9 LOGOUT' },
    });
    expect(cartella.statusCode).toBe(400);
    expect(stato.upsert).toHaveLength(0);
  });
});

/**
 * §2bis — i campi di piattaforma non si scrivono dalle Impostazioni dello studio.
 *
 * `durataMesi`, `dataAttivazione`, `dataScadenza`, `piano` e `stato` erano in `allowedKeys` di
 * `PATCH /tenant/info`, cioè nella rotta che lo studio usa per le **proprie** impostazioni: un
 * advisor poteva quindi cambiarsi il piano o spostarsi la scadenza da sé. Sono i termini del
 * contratto fra studio e piattaforma, e li scrive solo il super_admin da
 * `PATCH /admin/tenants/:id` (rilievo medio dell'audit 27/09/2026, chiuso il 05/10/2026).
 *
 * La differenza da un rifiuto secco conta: la rotta risponde `200` e salva il resto, perché
 * `SettingsPage` rimanda indietro l'anagrafica intera — compresi i campi che ha solo letto.
 * Un `403` sull'intero salvataggio romperebbe il salvataggio delle impostazioni vere.
 */
describe('§2bis — PATCH /tenant/info: i campi di piattaforma restano del super_admin', () => {
  const CAMPI_PIATTAFORMA = {
    durataMesi: 120,
    dataAttivazione: '01/01/2020',
    dataScadenza: '01/01/2099',
    piano: 'free',
    stato: 'sospeso',
  };

  it('un advisor che li manda non li scrive, e il resto del salvataggio passa', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: { ...CAMPI_PIATTAFORMA, ragioneSociale: 'Studio di Prova (rinominato)' },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.upsert).toHaveLength(1);
    const scritto = stato.upsert[0].update;
    for (const chiave of Object.keys(CAMPI_PIATTAFORMA)) {
      expect(chiave in scritto).toBe(false);
    }
    // Controllo positivo: nella stessa richiesta un campo che allo studio spetta **si scrive**.
    // Senza questo, il test passerebbe anche se la rotta avesse smesso di salvare qualsiasi cosa.
    expect(scritto.ragioneSociale).toBe('Studio di Prova (rinominato)');
    // E la riga a database è rimasta quella di prima, non solo l'`update` a essere pulito.
    expect(stato.tenant.stato).toBe('attivo');
    expect(stato.tenant.piano).toBe('enterprise');
  });

  it('restano leggibili: tolti dalla scrittura, non fatti sparire dalla UI', async () => {
    // `GET /tenant/info` li deve continuare a consegnare — l'intestazione e la scheda studio li
    // mostrano. Il difetto era che si potevano **scrivere**, non che si vedessero.
    stato.tenant = { ...TENANT_CONFIGURATO };
    const res = await server().inject({ method: 'GET', url: '/tenant/info', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().stato).toBe('attivo');
    expect(res.json().piano).toBe('enterprise');
  });
});

describe('§35 — Signal: configurato davvero, o dichiarato spento', () => {
  it('il token del demone è un segreto come gli altri: non esce dal server', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({ method: 'GET', url: '/tenant/info', headers: auth() });

    expect(res.json().signalToken).toBe('');
    expect(res.json().signalTokenImpostata).toBe(true);
    expect(res.body).not.toContain(SEGRETI.signalToken);
  });

  it('il numero si salva normalizzato: un «0039 335 1234567» diventa la forma che il demone vuole', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: {
        signalEndpoint: 'https://signal.studio.example/',
        signalNumber: '0039 335 123 4567',
      },
    });

    expect(res.statusCode).toBe(200);
    const scritto = stato.upsert[0].update;
    // La barra finale è rumore: `signalService` compone i percorsi da sé.
    expect(scritto.signalEndpoint).toBe('https://signal.studio.example');
    expect(scritto.signalNumber).toBe('+393351234567');
  });

  it('un numero senza prefisso internazionale è respinto con il motivo, prima del database', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: { signalNumber: '3351234567' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/prefisso/i);
    expect(stato.upsert).toHaveLength(0);
  });

  it('un indirizzo con credenziali dentro, o con parametri, è respinto', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    for (const signalEndpoint of [
      'https://utente:password@signal.studio.example',
      'https://signal.studio.example?token=abc',
      'non-un-indirizzo',
    ]) {
      const res = await server().inject({
        method: 'PATCH', url: '/tenant/info', headers: auth(), payload: { signalEndpoint },
      });
      expect(res.statusCode, signalEndpoint).toBe(400);
    }
    expect(stato.upsert).toHaveLength(0);
  });

  it('il campo morto `emailInboundParseUrl` non si scrive più: puntava a una rotta che non esiste', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    await server().inject({
      method: 'PATCH',
      url: '/tenant/info',
      headers: auth(),
      payload: { emailInboundParseUrl: 'https://esempio.test/api/webhooks/inbound-email' },
    });

    expect('emailInboundParseUrl' in (stato.upsert[0]?.update ?? {})).toBe(false);
  });

  it('la prova del canale senza configurazione dice cosa manca, non «demone in ascolto»', async () => {
    // Era la bugia da sanare: la rotta rispondeva «Daemon Signal REST API v1 in ascolto sul
    // container Docker» senza aver contattato nessuno, e quel demone non esisteva.
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Signal' };

    const res = await server().inject({
      method: 'POST', url: '/tenant/test-channel', headers: auth(), payload: { channel: 'signal' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(res.json().message).toMatch(/indirizzo del demone/i);
    expect(res.body).not.toMatch(/in ascolto/i);
  });

  it('senza numero registrato la prova si ferma: il numero è il mittente', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO, signalEndpoint: 'https://signal.studio.example', signalNumber: null };

    const res = await server().inject({
      method: 'POST', url: '/tenant/test-channel', headers: auth(), payload: { channel: 'signal' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/numero Signal dello studio/i);
  });

  it('la lettura dei messaggi senza canale configurato risponde 400, non 200 con lista vuota', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Signal' };

    const res = await server().inject({
      method: 'POST', url: '/comunicazioni/signal-in-arrivo', headers: auth(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errore).toMatch(/non è configurato/i);
  });

  it('le due rotte Signal restano protette: senza token 401', async () => {
    const prova = await server().inject({
      method: 'POST', url: '/tenant/test-channel', payload: { channel: 'signal' },
    });
    expect(prova.statusCode).toBe(401);

    const lettura = await server().inject({ method: 'POST', url: '/comunicazioni/signal-in-arrivo' });
    expect(lettura.statusCode).toBe(401);
  });
});

/**
 * La rotta che mancava. `ComunicazioniTab` offriva Signal fra i canali della chat e, scegliendolo,
 * il messaggio finiva nel registro del fascicolo con un riscontro verde — «notificato via SIGNAL» —
 * senza che nessuno contattasse un demone. Questi test presidiano che ora l'invio o avviene
 * davvero, o risponde 400 col motivo.
 */
describe('§35 — POST /comunicazioni/invia-signal', () => {
  it('senza canale configurato risponde 400 col motivo, non un successo inventato', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Signal' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-signal',
      headers: auth(),
      payload: { to: '+393351111111', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errore).toMatch(/indirizzo del demone/i);
  });

  it('un destinatario senza prefisso internazionale è respinto prima del demone', async () => {
    // `3351234567` non è «un numero italiano senza +39»: è un numero di cui non si conosce il
    // paese, e normalizzarlo lo farebbe partire verso un estraneo.
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-signal',
      headers: auth(),
      payload: { to: '3351234567', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/prefisso/i);
  });

  it('senza numero del destinatario e senza contenuto non si spedisce niente', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const senzaNumero = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-signal', headers: auth(), payload: { testo: 'Buongiorno.' },
    });
    expect(senzaNumero.statusCode).toBe(400);
    expect(senzaNumero.json().errore).toMatch(/destinatario/i);

    const senzaTesto = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-signal', headers: auth(), payload: { to: '+393351111111', testo: '   ' },
    });
    expect(senzaTesto.statusCode).toBe(400);
    expect(senzaTesto.json().errore).toMatch(/contenuto/i);
  });

  it('un allegato oltre il tetto del Vault è respinto prima di contattare il demone', async () => {
    // L'indirizzo è di loopback, che la policy di rete rifiuta: se il controllo di dimensione non
    // venisse per primo, la risposta parlerebbe di indirizzo non pubblico invece che di peso.
    stato.tenant = { ...TENANT_CONFIGURATO, signalEndpoint: 'https://127.0.0.1', signalNumber: '+393350000000' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-signal',
      headers: auth(),
      payload: { to: '+393351111111', testo: 'Ecco il documento.', allegati: [{ nome: 'visura.pdf', base64: 'A'.repeat(21_000_000) }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/troppo grande/i);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-signal', payload: { to: '+393351111111', testo: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * Stessa storia della rotta Signal: la chat del fascicolo offriva Telegram e il messaggio
 * finiva nel registro con un riscontro verde, mentre la chiamata a Telegram era privata dentro
 * `otpDispatch.ts` e nessuno la raggiungeva.
 */
describe('§35 — POST /comunicazioni/invia-telegram', () => {
  it('senza bot configurato risponde 400 col motivo, e non contatta Telegram', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Bot' };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-telegram',
      headers: auth(),
      payload: { to: '123456789', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(res.json().errore).toMatch(/bot Telegram non è configurato/i);
  });

  it('una chat id che non è numerica è respinta: un @nomeutente non è un destinatario', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const res = await server().inject({
      method: 'POST',
      url: '/comunicazioni/invia-telegram',
      headers: auth(),
      payload: { to: '@mario', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/identificativo numerico/i);
  });

  it('senza destinatario o senza contenuto non si spedisce niente', async () => {
    stato.tenant = { ...TENANT_CONFIGURATO };

    const senzaChat = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-telegram', headers: auth(), payload: { testo: 'Buongiorno.' },
    });
    expect(senzaChat.statusCode).toBe(400);
    expect(senzaChat.json().errore).toMatch(/Chat Telegram/i);

    const senzaTesto = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-telegram', headers: auth(), payload: { to: '123456789', testo: '  ' },
    });
    expect(senzaTesto.statusCode).toBe(400);
    expect(senzaTesto.json().errore).toMatch(/contenuto/i);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({
      method: 'POST', url: '/comunicazioni/invia-telegram', payload: { to: '123456789', testo: 'x' },
    });
    expect(res.statusCode).toBe(401);
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
