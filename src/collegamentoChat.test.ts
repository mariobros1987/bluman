/**
 * Le rotte del link per progetto.
 *
 * Il link si compone sul server perché la firma è un HMAC con `TELEGRAM_WEBHOOK_SECRET`: la prima
 * proprietà da presidiare è che quel segreto — e il token del bot, da cui il webhook dello studio
 * si deriva — **non compaiano** in nessuna risposta (regola 6). Il link che torna al browser è una
 * capacità, e va bene che ci sia; il token no.
 *
 * La seconda è che l'invito spedito **rientri nel fascicolo**: un messaggio mandato a un cliente è
 * una comunicazione con quel cliente, e se vivesse solo nella testata dell'interfaccia il fascicolo
 * mentirebbe per omissione (regola 3). Il rovescio è altrettanto importante: un invio **non**
 * riuscito non deve lasciare una riga in `comunicazione_progetto`, perché una comunicazione
 * registrata che non è partita è una fonte che mente (regola 7).
 *
 * Il client Prisma è finto e osserva le scritture; le due funzioni di invio sono finte, così nessun
 * test contatta SMTP o Meta. Il server è quello vero (`buildServer`), quindi auth, hook e contesto
 * tenant sono quelli di produzione: senza token si risponde 401 come su ogni altra rotta.
 */
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

const stato: {
  tenant: any;
  pratica: any;
  collegamenti: any[];
  comunicazioni: any[];
  audits: any[];
  revocati: number;
} = { tenant: null, pratica: null, collegamenti: [], comunicazioni: [], audits: [], revocati: 1 };

// Il parametro è dichiarato perché questi test ispezionano *cosa* è stato spedito
// (`mock.calls[0][0].html`): con `vi.fn<any>` la chiamata registrata è `unknown[]` e l'accesso
// non compila — cioè proprio la proprietà da verificare, che il messaggio contenga il link.
const inviaEmail = vi.fn<(messaggio: any) => Promise<any>>(async () => ({ ok: true, via: 'relay' }));
const inviaTestoWhatsapp = vi.fn<(cred: any, a: any, testo: any) => Promise<any>>(async () => ({ ok: true }));

vi.mock('./services/emailRelay.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./services/emailRelay.js')>()),
  inviaEmail,
}));
vi.mock('./services/whatsappService.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./services/whatsappService.js')>()),
  inviaTestoWhatsapp,
}));

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    tenant: { findUnique: async () => stato.tenant },
    progetto: { findFirst: async () => stato.pratica },
    comunicazioneProgetto: {
      create: async (args: any) => {
        stato.comunicazioni.push(args.data);
        return { id: `com-${stato.comunicazioni.length}`, ...args.data };
      },
    },
    collegamentoChatProgetto: {
      findMany: async () => stato.collegamenti,
      deleteMany: async () => ({ count: stato.revocati }),
    },
    auditLog: { create: async (args: any) => { stato.audits.push(args.data); return {}; } },
    // `stato` e `sessionVersion` non sono decorativi: l'hook di autenticazione verifica che
    // l'identità esista ancora, sia attiva e abbia la stessa versione di sessione del token
    // (`server.ts`, verifica fail-closed). Un finto utente senza questi due campi fa fallire il
    // confronto `undefined === 0` e **ogni** richiesta di questo file diventa 401.
    user: {
      findUnique: async () => ({ ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }),
      findFirst: async () => ({ ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }),
      findMany: async () => [],
    },
    // La matrice dei permessi. Senza questa riga `prisma.permessoModulo` è `undefined`,
    // `findUnique` lancia, il `catch` di `server.ts` logga e lascia passare: i test sarebbero
    // verdi lo stesso, ma il cancello dei permessi non verrebbe attraversato — cioè la riga che
    // questo file vorrebbe dimostrare sana resterebbe l'unica mai eseguita. Una riga assente
    // (null) è la risposta reale di uno studio che non ha mai toccato la matrice: nessun
    // restringimento, come da commento in `server.ts`.
    permessoModulo: { findUnique: async () => null },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');
const { progettoIdDaPayloadCollegamento } = await import('./util/webhookSecurity.js');

const TENANT = '00000000-0000-4000-8000-000000000001';
const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
const MASTER = 'master-segreto-di-prova';

const TOKEN = signJwt({
  userId: 'usr-advisor',
  tenantId: TENANT,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
  sessionVersion: 0,
});
const auth = () => ({ authorization: `Bearer ${TOKEN}` });

/** Uno studio con il bot configurato. Nessun valore qui è una credenziale reale. */
const TENANT_CON_BOT = {
  id: TENANT,
  ragioneSociale: 'Studio di Prova',
  tgBotToken: '123456:token-di-prova-non-reale',
  tgBotUsername: 'StudioDiProvaBot',
  smtpHost: 'smtp.esempio.test',
  smtpPort: 465,
  smtpUser: 'studio@esempio.test',
  smtpFromEmail: 'studio@esempio.test',
  smtpFromName: 'Studio di Prova',
  waPhoneId: '000000000000000',
  waAccessToken: 'token-meta-di-prova',
};

const praticaCon = (cliente: Record<string, unknown>) => ({
  id: PROGETTO,
  nome: 'Emirati Arabi 123',
  cliente: { id: 'cli-1', nome: 'Mario Emirati', email: null, cellulare: null, referentiJson: null, ...cliente },
});

function server() {
  return buildServer(new InMemoryApp()) as any;
}

const SEGRETO_PRECEDENTE = process.env.TELEGRAM_WEBHOOK_SECRET;

beforeEach(() => {
  // `clearAllMocks` e non `resetAllMocks`: azzera la **cronologia** delle chiamate senza togliere
  // le implementazioni. Senza questa riga le chiamate si accumulano fra i test, e le asserzioni
  // sulla *quantità* — `toHaveBeenCalledTimes(1)`, `not.toHaveBeenCalled()` — diventano verdi o
  // rosse a seconda dell'ordine di esecuzione invece che del comportamento della rotta.
  vi.clearAllMocks();
  stato.tenant = { ...TENANT_CON_BOT };
  stato.pratica = praticaCon({ email: 'mario@esempio.test', cellulare: '+393351234567' });
  stato.collegamenti = [];
  stato.comunicazioni = [];
  stato.audits = [];
  stato.revocati = 1;
  inviaEmail.mockResolvedValue({ ok: true, via: 'relay' });
  inviaTestoWhatsapp.mockResolvedValue({ ok: true });
  process.env.TELEGRAM_WEBHOOK_SECRET = MASTER;
});

afterAll(() => {
  if (SEGRETO_PRECEDENTE === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = SEGRETO_PRECEDENTE;
});

describe('GET /progetti/:id/link-telegram', () => {
  it('restituisce un link firmato e spendibile, senza far uscire il token del bot', async () => {
    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.botUsername).toBe('StudioDiProvaBot');
    expect(body.url.startsWith('https://t.me/StudioDiProvaBot?start=')).toBe(true);

    // Il payload che il cliente manderà al bot si scioglie nell'identificativo di questa pratica:
    // è la verifica che il link è quello giusto per questa pratica e non per un'altra.
    const payload = body.url.split('?start=')[1];
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(PROGETTO);

    // Regola 6: il token del bot non esce dal server, nemmeno in un link che lo riguarda.
    expect(res.body).not.toContain(TENANT_CON_BOT.tgBotToken);
    expect(payload).toHaveLength(55);
  });

  it('lo @username si legge anche se salvato con la chiocciola davanti', async () => {
    stato.tenant = { ...TENANT_CON_BOT, tgBotUsername: '@StudioDiProvaBot' };

    const body = (await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() })).json();

    expect(body.url.startsWith('https://t.me/StudioDiProvaBot?start=')).toBe(true);
    expect(body.botUsername).toBe('StudioDiProvaBot');
  });

  it('senza bot configurato risponde 400 indicando dove si configura', async () => {
    stato.tenant = { id: TENANT, ragioneSociale: 'Studio Senza Bot' };

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Impostazioni → Canali/);
  });

  it('con il token ma senza @username dice di registrare il webhook, che è il rimedio vero', async () => {
    stato.tenant = { ...TENANT_CON_BOT, tgBotUsername: null };

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Registra webhook/i);
  });

  it("con l'id numerico del bot nel campo non compone nulla, e dice cosa c'è dentro", async () => {
    // Il guasto vero del 16/09/2026: l'id numerico del bot in `tgBotUsername`, e il link composto
    // apriva «questo utente non esiste» sul telefono del cliente. Il campo era **pieno**, quindi
    // «manca lo username» sarebbe stato falso e il rimedio indicato inutile.
    stato.tenant = { ...TENANT_CON_BOT, tgBotUsername: '87654321' };

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/id numerico/i);
    expect(res.json().errore).not.toMatch(/Manca lo @username/);
    // Regola 6: l'id del bot è la prima metà del token, e non esce nemmeno per spiegare un errore.
    expect(res.body).not.toContain('87654321');
    expect(res.body).not.toContain(TENANT_CON_BOT.tgBotToken);
  });

  it('un valore che non è nemmeno uno username lo dice, invece di provare a comporre il link', async () => {
    stato.tenant = { ...TENANT_CON_BOT, tgBotUsername: 'studio bot' };

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/non è uno username Telegram valido/);
  });

  it('senza TELEGRAM_WEBHOOK_SECRET risponde 503: il link non si firma con niente', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(503);
    expect(res.json().errore).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('una pratica che non è di questo studio risponde 404, non 200 con un link inutile', async () => {
    stato.pratica = null;

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(404);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /progetti/:id/link-telegram/invia', () => {
  it("l'invito via email parte e rientra nel fascicolo come comunicazione in uscita", async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, destinatario: 'mario@esempio.test' });

    expect(inviaEmail).toHaveBeenCalledTimes(1);
    const messaggio = inviaEmail.mock.calls[0]![0];
    expect(messaggio.to).toBe('mario@esempio.test');
    // Il link che il cliente deve toccare è dentro il messaggio: senza, l'invito non serve a nulla.
    expect(messaggio.html).toContain('https://t.me/StudioDiProvaBot?start=');
    // E il nome della pratica, così il cliente sa a cosa serve.
    expect(messaggio.html).toContain('Emirati Arabi 123');

    expect(stato.comunicazioni).toHaveLength(1);
    const riga = stato.comunicazioni[0];
    expect(riga).toMatchObject({
      tenantId: TENANT,
      progettoId: PROGETTO,
      canale: 'email',
      direzione: 'uscita',
      destinatario: 'mario@esempio.test',
    });
    expect(riga.testo).toContain('https://t.me/StudioDiProvaBot?start=');
  });

  it("l'invito via WhatsApp usa il recapito e registra la comunicazione", async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'whatsapp' },
    });

    expect(res.statusCode).toBe(200);
    expect(inviaTestoWhatsapp).toHaveBeenCalledTimes(1);
    expect(inviaTestoWhatsapp.mock.calls[0]![1]).toBe('+393351234567');
    expect(stato.comunicazioni[0]).toMatchObject({ canale: 'whatsapp', direzione: 'uscita' });
  });

  it("un recapito che sta solo nel referentiJson non viene dato per assente", async () => {
    // È il guasto documentato da `recapitiCliente`: le anagrafiche create dal seed hanno
    // l'indirizzo dentro il JSON e la colonna vuota. Leggendo la sola colonna, l'invito direbbe
    // «il cliente non ha email» a un cliente che ce l'ha.
    stato.pratica = praticaCon({ email: null, referentiJson: { email: 'referente@esempio.test' } });

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email' },
    });

    expect(res.statusCode).toBe(200);
    expect(inviaEmail.mock.calls[0]![0].to).toBe('referente@esempio.test');
    expect(stato.comunicazioni[0].destinatario).toBe('referente@esempio.test');
  });

  it('senza recapito risponde 400 con il rimedio, e non registra nessuna comunicazione', async () => {
    stato.pratica = praticaCon({ email: null, cellulare: null });

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/non ha un indirizzo email/i);
    expect(inviaEmail).not.toHaveBeenCalled();
    expect(stato.comunicazioni).toHaveLength(0);
  });

  it('un invio rifiutato da Meta o dal relay non lascia una riga nel fascicolo', async () => {
    // Fuori dalla finestra di 24 ore WhatsApp risponde 131047: il motivo va riportato, e la
    // comunicazione **non** si registra — registrarla renderebbe il fascicolo una fonte che mente.
    inviaTestoWhatsapp.mockResolvedValue({ ok: false, errore: 'Meta: 131047 finestra di 24 ore scaduta' });

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'whatsapp' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/131047/);
    expect(stato.comunicazioni).toHaveLength(0);
  });

  it('una posta in uscita non configurata si ferma con il motivo, senza tentare invii di ripiego', async () => {
    stato.tenant = { ...TENANT_CON_BOT, smtpHost: null, smtpUser: null };

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/SMTP/i);
    expect(inviaEmail).not.toHaveBeenCalled();
    expect(stato.comunicazioni).toHaveLength(0);
  });

  it('un canale non previsto è respinto prima di qualunque invio', async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'telegram' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/email o via WhatsApp/);
    expect(stato.comunicazioni).toHaveLength(0);
  });

  it('la spedizione lascia una traccia di audit', async () => {
    await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email' },
    });

    expect(stato.audits.some(a => a.azione === 'LINK_TELEGRAM_INVIATO')).toBe(true);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      payload: { canale: 'email' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET e DELETE /progetti/:id/collegamenti', () => {
  it("l'elenco torna le chat collegate alla pratica", async () => {
    stato.collegamenti = [{
      id: 'coll-1',
      canale: 'telegram',
      chatId: '99',
      creatoAt: new Date('2026-09-16T10:00:00Z'),
      creatoDa: 'link',
    }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/collegamenti`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().collegamenti).toHaveLength(1);
    expect(res.json().collegamenti[0].chatId).toBe('99');
  });

  it('un elenco vuoto è un elenco vuoto, non un errore', async () => {
    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/collegamenti`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().collegamenti).toEqual([]);
  });

  it('la revoca rimuove il collegamento e ne lascia traccia di audit', async () => {
    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/collegamenti/coll-1`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(stato.audits.some(a => a.azione === 'COLLEGAMENTO_CHAT_REVOCATO')).toBe(true);
  });

  it('revocare qualcosa che non esiste risponde 404 invece di dire «fatto»', async () => {
    stato.revocati = 0;

    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/collegamenti/coll-inesistente`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(404);
  });

  it('le due rotte sono protette: senza token 401', async () => {
    const elenco = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/collegamenti` });
    const revoca = await server().inject({ method: 'DELETE', url: `/progetti/${PROGETTO}/collegamenti/coll-1` });
    expect([elenco.statusCode, revoca.statusCode]).toEqual([401, 401]);
  });
});
