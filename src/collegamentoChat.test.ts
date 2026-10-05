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
  microvoce: any;
  collegamenti: any[];
  comunicazioni: any[];
  chat: any[];
  contesti: any[];
  contestiArmati: any[];
  /** Le righe del fascicolo, per `GET /progetti/:id/comunicazioni`. */
  messaggi: any[];
  /** Gli abbinamenti del fascicolo intero, come li legge `mappaAbbinamentiDelProgetto`. */
  abbinamenti: any[];
  /** Gli abbinamenti di **una** micro-voce, come li legge `elencaComunicazioniMicrovoce`. */
  abbinamentiPerVoce: any[];
  abbinati: any[];
  slegati: number;
  /** La riga cliente che l'hook di autenticazione cerca per un token del portale. */
  clientePortale: any;
  /** Le `where` con cui si è cercata la pratica: serve a presidiare il filtro sul tenant. */
  ricercheProgetto: any[];
  audits: any[];
  revocati: number;
  contestiDisarmati: number;
} = {
  tenant: null, pratica: null, microvoce: null, collegamenti: [], comunicazioni: [], chat: [],
  contesti: [], contestiArmati: [], messaggi: [], abbinamenti: [], abbinamentiPerVoce: [],
  abbinati: [], slegati: 1, clientePortale: null, ricercheProgetto: [], audits: [], revocati: 1, contestiDisarmati: 0,
};

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
    progetto: {
      findFirst: async (args: any) => { stato.ricercheProgetto.push(args?.where); return stato.pratica; },
      // La rilettura che precede l'avviso allo studio per un messaggio in arrivo. Il finto deve
      // rispondere: la rotta legge `progetto.cliente.nome` **fuori** dal `catch` dell'avviso,
      // quindi un `findUnique` assente non produce un avviso perso ma un 500 — e i test
      // sull'abbinamento in entrata fallirebbero per il finto, sembrando rotti nel servizio.
      findUnique: async () => stato.pratica,
    },
    comunicazioneProgetto: {
      create: async (args: any) => {
        stato.comunicazioni.push(args.data);
        return { id: `com-${stato.comunicazioni.length}`, ...args.data };
      },
      // Il fascicolo di una pratica, per la rotta della chat. `findFirst` filtra su
      // `{ id, tenantId, progettoId }`: è il cancello che impedisce di abbinare un messaggio di
      // un'altra pratica, quindi il finto deve **guardarlo**, non rispondere sempre lo stesso.
      findMany: async () => stato.messaggi,
      findFirst: async (args: any) => {
        const where = args?.where ?? {};
        return stato.messaggi.find(m => m.id === where.id && (where.progettoId === undefined || where.progettoId === PROGETTO)) ?? null;
      },
      // L'aggregazione con cui si elencano le chat di una pratica: `elencaChatDelProgetto` passa da
      // qui, e senza il finto la rotta `/chat` esploderebbe con un 500.
      groupBy: async () => stato.chat,
    },
    microvoceProgetto: { findFirst: async () => stato.microvoce },
    // Il token del portale si autentica solo se la riga cliente esiste **e** ha la stessa
    // `sessionVersion` del token (`server.ts`): senza questa chiave l'hook risponde 401, e i test
    // sul 403 del ruolo cliente misurerebbero un rifiuto diverso da quello che vogliono provare.
    cliente: {
      findFirst: async (args: any) =>
        stato.clientePortale && stato.clientePortale.id === args?.where?.id ? stato.clientePortale : null,
      // La risoluzione del nome per le conversazioni del **portale**, dove il `chatId` è un id di
      // cliente. Il finto rispetta il `tenantId`: un finto che lo ignorasse direbbe che il filtro
      // c'è anche quando qualcuno l'ha tolto.
      findMany: async (args: any) => {
        if (args?.where?.tenantId !== TENANT) return [];
        return (args?.where?.id?.in ?? []).map((id: string) => ({ id, nome: id === 'cli-1' ? 'Mario Emirati' : `Cliente ${id}` }));
      },
    },
    // Il legame messaggio ↔ micro-voce. `findMany` serve a **due** letture con due forme diverse —
    // il fascicolo intero e l'elenco di una voce — e le distingue dalla `where`, che è esattamente
    // ciò che le distingue nel servizio: chi filtra per `comunicazione.progettoId` vuole la mappa
    // del fascicolo, chi filtra per `microvoceProgettoId` vuole i messaggi di quella voce.
    comunicazioneMicrovoce: {
      findMany: async (args: any) =>
        args?.where?.comunicazione ? stato.abbinamenti : stato.abbinamentiPerVoce,
      upsert: async (args: any) => { stato.abbinati.push(args); return {}; },
      deleteMany: async (args: any) => {
        // Il finto rispetta il filtro: `rimuoviAbbinamento` deve poter dire «c'era» o «non c'era»
        // in base alla riga che gli si mette davanti, non a un numero deciso dal test.
        const where = args?.where ?? {};
        const esiste = stato.abbinamentiPerVoce.some(a => a.microvoceProgettoId === where.microvoceProgettoId);
        return { count: esiste ? 1 : 0 };
      },
    },
    collegamentoChatProgetto: {
      findMany: async () => stato.collegamenti,
      // La revoca legge la riga prima di cancellarla: le serve il `chatId` per sapere **quale**
      // contesto micro-voce cade insieme al collegamento, e l'id del collegamento da solo non lo dice.
      findFirst: async (args: any) => stato.collegamenti.find(c => c.id === args?.where?.id) ?? null,
      deleteMany: async () => ({ count: stato.revocati }),
    },
    contestoMicrovoceChat: {
      deleteMany: async () => ({ count: stato.contestiDisarmati }),
      upsert: async (args: any) => { stato.contestiArmati.push(args); return {}; },
      findMany: async () => stato.contesti,
      // La lettura che fa `abbinaAlContesto` prima di legare un messaggio in ingresso. Cerca per
      // la chiave unica `(tenantId, canale, chatId)`: il finto deve guardarla davvero, perché
      // «il contesto di **questa** chat, e non di un'altra» è esattamente ciò che i test sul
      // portale devono poter distinguere.
      findUnique: async (args: any) => {
        const w = args?.where?.tenantId_canale_chatId ?? {};
        return stato.contesti.find(c => c.canale === w.canale && c.chatId === w.chatId) ?? null;
      },
      // L'abbinamento rinnova la scadenza: senza questo metodo la rotta esplode **dopo** aver
      // scritto l'abbinamento, cioè con il lavoro già fatto e l'errore che sembra venire da altro.
      update: async () => ({}),
    },
    // `$transaction` e `$executeRaw` servono a `conContestoInTransazione`, che la revoca e lo
    // spostamento del collegamento attraversano: senza, la rotta esplode con un 500 e il test
    // fallirebbe per il finto e non per il codice.
    $transaction: async (fn: any) => fn(finto),
    $executeRaw: async () => 1,
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
const { progettoIdDaPayloadCollegamento, microvoceIdDaPayloadCollegamento } = await import('./util/webhookSecurity.js');

const TENANT = '00000000-0000-4000-8000-000000000001';
const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
const ALTRA_PRATICA = '00000000-0000-4000-8000-0000000000a2';
const MICROVOCE = '00000000-0000-4000-8000-0000000000b1';
const MASTER = 'master-segreto-di-prova';

const TOKEN = signJwt({
  userId: 'usr-advisor',
  tenantId: TENANT,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
  sessionVersion: 0,
});
const auth = () => ({ authorization: `Bearer ${TOKEN}` });

/**
 * Il token del portale, per i casi in cui la risposta giusta è **403**.
 *
 * Le rotte che abbinano non sono in `ROTTE_CLIENTE_CONSENTITE` (`src/util/authorization.ts`), che è
 * un elenco per **uguaglianza**: una rotta non elencata è chiusa al ruolo cliente senza che nessuno
 * debba ricordarsene. Vale la pena provarlo lo stesso, perché è una proprietà che si perde in
 * silenzio — basta aggiungere il path all'elenco, e nessun test se ne accorgerebbe.
 */
const TOKEN_CLIENTE = signJwt({
  userId: 'client-cli-1',
  tenantId: TENANT,
  email: 'cliente@esempio.test',
  ruolo: 'cliente',
  sessionVersion: 0,
});

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
  // Il `clienteId` di primo livello è la colonna che `clienteDellaPratica` legge per etichettare
  // la conversazione del portale: nel database è un campo della **pratica**, e il cliente
  // annidato qui sotto è la relazione. Averli tutti e due è ciò che rende il finto fedele.
  clienteId: 'cli-1',
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
  // Una micro-voce del modulo di questa pratica. Il `progettoId` sta sul modulo proprietario, ed è
  // il confronto che `microvoceDiProgetto` fa: cambiarlo è il modo in cui i test simulano una voce
  // di un'altra pratica.
  stato.microvoce = {
    id: MICROVOCE,
    nome: 'Costituzione Srl',
    moduloProgettoId: 'mod-1',
    moduloProgetto: { progettoId: PROGETTO },
  };
  stato.collegamenti = [];
  stato.comunicazioni = [];
  stato.chat = [];
  stato.contesti = [];
  stato.contestiArmati = [];
  stato.messaggi = [];
  stato.abbinamenti = [];
  stato.abbinamentiPerVoce = [];
  stato.abbinati = [];
  stato.slegati = 1;
  stato.clientePortale = { id: 'cli-1', tenantId: TENANT, nome: 'Mario Emirati', sessionVersion: 0 };
  stato.ricercheProgetto = [];
  stato.audits = [];
  stato.revocati = 1;
  stato.contestiDisarmati = 0;
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
    stato.collegamenti = [{ id: 'coll-1', canale: 'telegram', chatId: '99' }];
    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/collegamenti/coll-1`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(stato.audits.some(a => a.azione === 'COLLEGAMENTO_CHAT_REVOCATO')).toBe(true);
  });

  it('la revoca porta via anche il contesto micro-voce della chat, e lo dice', async () => {
    // Il caso che rende la revoca completa: la chat era collegata a questa pratica **e** aveva una
    // micro-voce armata. Se il contesto sopravvivesse, la chat rientrando con lo stesso link su
    // un'altra pratica abbinerebbe i messaggi a un modulo che non c'entra.
    stato.collegamenti = [{ id: 'coll-1', canale: 'telegram', chatId: '99' }];
    stato.contestiDisarmati = 1;

    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/collegamenti/coll-1`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contestoDisarmato).toBe(true);
    // E l'audit lo scrive: un contesto sparito senza traccia è indistinguibile da uno mai armato.
    expect(stato.audits.some(a => String(a.dettagli).includes('contesto micro-voce disarmato'))).toBe(true);
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

describe('GET /progetti/:id/link-telegram?microvoceId=', () => {
  it('compone il link della micro-voce, e il payload si scioglie in quella voce', async () => {
    const res = await server().inject({
      method: 'GET',
      url: `/progetti/${PROGETTO}/link-telegram?microvoceId=${MICROVOCE}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tipo).toBe('microvoce');
    const payload = body.url.split('?start=')[1];
    expect(microvoceIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(MICROVOCE);
    // E non è spendibile come link di pratica: è il dominio MAC separato a garantirlo, e senza
    // questo test la separazione resterebbe una dichiarazione in un commento.
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBeNull();
    // Telegram accetta al massimo 64 caratteri in `?start=`: oltre, il link non si apre.
    expect(payload.length).toBeLessThanOrEqual(64);
    // Regola 6, di nuovo: nessun segreto esce, nemmeno da questa rotta.
    expect(res.body).not.toContain(TENANT_CON_BOT.tgBotToken);
  });

  it('senza microvoceId resta il link della pratica, e lo dichiara', async () => {
    // La regressione che romperebbe i link già spediti: la rotta senza parametro deve comportarsi
    // esattamente come prima, forma del payload compresa.
    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/link-telegram`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().tipo).toBe('pratica');
    const payload = res.json().url.split('?start=')[1];
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(PROGETTO);
    expect(payload).toHaveLength(55);
  });

  it('una micro-voce di un\'altra pratica non diventa un link per questa', async () => {
    // L'id di una voce di un altro fascicolo non deve bastare a comporre una capacità che apre
    // questo: la verifica sul progetto sta qui **e** al momento dell'abbinamento.
    stato.microvoce = { ...stato.microvoce, moduloProgetto: { progettoId: ALTRA_PRATICA } };

    const res = await server().inject({
      method: 'GET',
      url: `/progetti/${PROGETTO}/link-telegram?microvoceId=${MICROVOCE}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toMatch(/non trovata in questa pratica/i);
  });

  it('una micro-voce inesistente non produce un link muto', async () => {
    stato.microvoce = null;

    const res = await server().inject({
      method: 'GET',
      url: `/progetti/${PROGETTO}/link-telegram?microvoceId=${MICROVOCE}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /progetti/:id/link-telegram/invia con una micro-voce', () => {
  it("spedisce il link della voce, non quello della pratica, e lo nomina nel messaggio", async () => {
    // La divergenza da non introdurre: la scheda mostra il link della voce e l'invito parte con
    // quello della pratica. Il cliente atterrerebbe altrove senza che nessuno se ne accorga.
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email', microvoceId: MICROVOCE },
    });

    expect(res.statusCode).toBe(200);
    const html = inviaEmail.mock.calls[0]![0].html as string;
    const payload = html.split('?start=')[1]!.split(/[\s<"']/)[0]!;
    expect(microvoceIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(MICROVOCE);
    expect(html).toContain('Costituzione Srl');
    expect(stato.audits.some(a => a.azione === 'LINK_TELEGRAM_INVIATO' && /Costituzione Srl/.test(String(a.dettagli)))).toBe(true);
  });

  it('una micro-voce di un\'altra pratica si ferma prima di spedire', async () => {
    stato.microvoce = { ...stato.microvoce, moduloProgetto: { progettoId: ALTRA_PRATICA } };

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/link-telegram/invia`,
      headers: auth(),
      payload: { canale: 'email', microvoceId: MICROVOCE },
    });

    expect(res.statusCode).toBe(404);
    expect(inviaEmail).not.toHaveBeenCalled();
    expect(stato.comunicazioni).toHaveLength(0);
  });
});

describe('contesti micro-voce di una chat', () => {
  it("armare il contesto si registra, con la pratica della voce e chi l'ha armato", async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/contesti-microvoce`,
      headers: auth(),
      payload: { canale: 'whatsapp', chatId: '393351234567', microvoceId: MICROVOCE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().microvoce.nome).toBe('Costituzione Srl');
    expect(stato.contestiArmati).toHaveLength(1);
    // `progettoId` si scrive dalla voce e non da chi chiama: è la colonna che il controllo
    // sull'abbinamento confronta, e deve dire la pratica della voce.
    expect(stato.contestiArmati[0].create).toMatchObject({
      tenantId: TENANT,
      canale: 'whatsapp',
      chatId: '393351234567',
      microvoceProgettoId: MICROVOCE,
      progettoId: PROGETTO,
      armatoDa: 'operatore',
    });
    expect(stato.audits.some(a => a.azione === 'CONTESTO_MICROVOCE_ARMATO')).toBe(true);
  });

  it('una voce di un\'altra pratica non si arma su questa', async () => {
    stato.microvoce = { ...stato.microvoce, moduloProgetto: { progettoId: ALTRA_PRATICA } };

    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/contesti-microvoce`,
      headers: auth(),
      payload: { canale: 'whatsapp', chatId: '393351234567', microvoceId: MICROVOCE },
    });

    expect(res.statusCode).toBe(404);
    expect(stato.contestiArmati).toHaveLength(0);
  });

  it('senza canale, chat o voce la richiesta è respinta senza scrivere niente', async () => {
    const res = await server().inject({
      method: 'POST',
      url: `/progetti/${PROGETTO}/contesti-microvoce`,
      headers: auth(),
      payload: { canale: 'whatsapp', chatId: '393351234567' },
    });

    expect(res.statusCode).toBe(400);
    expect(stato.contestiArmati).toHaveLength(0);
  });

  it('disarmare toglie il contesto e ne lascia traccia', async () => {
    stato.contesti = [{
      canale: 'whatsapp', chatId: '393351234567', armatoDa: 'operatore',
      armatoAt: new Date(), scadeAt: null, microvoceProgetto: { id: MICROVOCE, nome: 'Costituzione Srl' },
    }];
    stato.contestiDisarmati = 1;

    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/contesti-microvoce?canale=whatsapp&chatId=393351234567`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().disarmato).toBe(true);
    expect(stato.audits.some(a => a.azione === 'CONTESTO_MICROVOCE_DISARMATO')).toBe(true);
  });

  it('disarmare una chat che non aveva niente risponde «non c\'era», senza scrivere un audit falso', async () => {
    // Su una pratica diversa da quella del contesto: la rotta verifica il percorso, quindi non deve
    // poter togliere l'ascolto alla chat di un'altra pratica passando dal proprio URL.
    const res = await server().inject({
      method: 'DELETE',
      url: `/progetti/${PROGETTO}/contesti-microvoce?canale=whatsapp&chatId=393351234567`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().disarmato).toBe(false);
    expect(stato.audits.some(a => a.azione === 'CONTESTO_MICROVOCE_DISARMATO')).toBe(false);
  });

  it('le due rotte sono protette: senza token 401', async () => {
    const arma = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/contesti-microvoce`, payload: { canale: 'x', chatId: 'y', microvoceId: 'z' },
    });
    const disarma = await server().inject({ method: 'DELETE', url: `/progetti/${PROGETTO}/contesti-microvoce?canale=x&chatId=y` });
    expect([arma.statusCode, disarma.statusCode]).toEqual([401, 401]);
  });
});

describe('GET /progetti/:id/chat', () => {
  it('unisce le conversazioni della pratica al contesto che hanno addosso', async () => {
    stato.chat = [{ canale: 'whatsapp', chatId: '393351234567', _max: { createdAt: new Date('2026-10-01T09:00:00Z') }, _count: { _all: 7 } }];
    stato.contesti = [{
      canale: 'whatsapp', chatId: '393351234567', armatoDa: 'operatore',
      armatoAt: new Date('2026-10-01T09:00:00Z'), scadeAt: null, microvoceProgetto: { id: MICROVOCE, nome: 'Costituzione Srl' },
    }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/chat`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().chat).toHaveLength(1);
    expect(res.json().chat[0]).toMatchObject({
      canale: 'whatsapp', chatId: '393351234567', messaggi: 7,
      contesto: { microvoce: { id: MICROVOCE, nome: 'Costituzione Srl' } },
    });
  });

  it('una chat senza contesto lo dichiara `null`, non un contesto vuoto', async () => {
    stato.chat = [{ canale: 'signal', chatId: '393350000000', _max: { createdAt: new Date('2026-10-02T09:00:00Z') }, _count: { _all: 2 } }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/chat`, headers: auth() });

    expect(res.json().chat[0].contesto).toBeNull();
  });

  it('la conversazione del portale si nomina col cliente, non col suo uuid', async () => {
    // Il `chatId` del portale è un id di cliente: senza il nome, l'operatore che deve scegliere su
    // quale conversazione armare il contesto leggerebbe un uuid — e sarebbe l'unica riga della lista
    // a non dire a chi appartiene.
    stato.chat = [{ canale: 'portal', chatId: 'cli-1', _max: { createdAt: new Date('2026-10-03T09:00:00Z') }, _count: { _all: 3 } }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/chat`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().chat[0]).toMatchObject({ canale: 'portal', nome: 'Mario Emirati', messaggi: 3 });
  });

  it('sugli altri canali il nome resta `null`: lì l\'identificativo *è* la cosa leggibile', async () => {
    stato.chat = [{ canale: 'whatsapp', chatId: '393351234567', _max: { createdAt: new Date('2026-10-01T09:00:00Z') }, _count: { _all: 7 } }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/chat`, headers: auth() });

    expect(res.json().chat[0].nome).toBeNull();
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/chat` });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * Il legame messaggio ↔ micro-voce visto dalle rotte.
 *
 * Tre cose, e sono tre modi diversi di sbagliare: che l'abbinamento arrivi **al messaggio** (senza,
 * la chat è muta e la bolla non può dire perché quel messaggio è lì), che **non attraversi i
 * confini** — né la pratica né lo studio — e che ciò che si toglie lo dica **solo quando era lì**:
 * un audit scritto per una rimozione che non è avvenuta è una traccia che mente, ed è peggio di
 * nessuna traccia, perché l'audit è la fonte a cui si crede.
 */
describe('GET /progetti/:id/comunicazioni con gli abbinamenti', () => {
  it('ogni messaggio porta le sue micro-voci con il motivo per cui è lì', async () => {
    stato.messaggi = [{ id: 'msg-1', canale: 'whatsapp', direzione: 'ingresso', testo: 'Ho caricato i documenti', externalId: null, createdAt: new Date('2026-10-01T09:00:00Z') }];
    stato.abbinamenti = [{ comunicazioneId: 'msg-1', origine: 'contesto', microvoceProgetto: { id: MICROVOCE, nome: 'Costituzione Srl' } }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/comunicazioni`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].microvoci).toEqual([{ microvoceId: MICROVOCE, nome: 'Costituzione Srl', origine: 'contesto' }]);
  });

  it('un messaggio mai abbinato porta un elenco vuoto, non un campo assente', async () => {
    // La differenza conta nel browser: `undefined` costringe ogni consumatore a un `?.` e a un
    // ripiego, e il ripiego che qualcuno scriverà sarà «nessuna micro-voce» — giusto per caso, e
    // sbagliato il giorno in cui la mappa non è stata letta.
    stato.messaggi = [{ id: 'msg-1', canale: 'email', direzione: 'uscita', testo: 'Buongiorno', externalId: null, createdAt: new Date('2026-10-01T09:00:00Z') }];

    const res = await server().inject({ method: 'GET', url: `/progetti/${PROGETTO}/comunicazioni`, headers: auth() });

    expect(res.json()[0].microvoci).toEqual([]);
  });
});

/**
 * Il portale era l'ultimo canale senza abbinamento automatico.
 *
 * Telegram, WhatsApp e Signal entrano dai webhook, e il `chatId` della conversazione lo dice il
 * provider. Il portale un provider non ce l'ha: la sua conversazione è il **cliente**, e la rotta
 * non lo sa se nessuno glielo dice. Da qui la prima proprietà da presidiare, ed è quella che
 * *abilita* la funzione: la riga nasce con quel `chatId`, che è la chiave con cui la scheda «chat»
 * della pratica elenca la conversazione — cioè l'unica su cui l'operatore può armare il contesto.
 * Senza, la rotta consulterebbe un contesto che nessuno ha modo di creare, e tutti questi test
 * sarebbero verdi su una funzione inutilizzabile.
 *
 * La seconda è il **confine**: si abbina solo in entrata. Il contesto dice «questa conversazione
 * parla di questa voce» dei messaggi che *arrivano*; un messaggio in uscita scritto da dentro una
 * micro-voce nascerebbe abbinato per costruzione, che è la seconda regola della Fase 3 e non va
 * confusa con questa. Il test in fondo lo tiene fermo.
 */
describe('il portale consulta il contesto armato sulla conversazione del cliente', () => {
  const contestoArmato = (extra: Record<string, unknown> = {}) => ({
    canale: 'portal',
    chatId: 'cli-1',
    progettoId: PROGETTO,
    microvoceProgettoId: MICROVOCE,
    armatoAt: new Date(),
    scadeAt: new Date(Date.now() + 3600_000),
    ...extra,
  });

  const dalPortale = (extra: Record<string, unknown> = {}) => ({
    method: 'POST' as const,
    url: `/progetti/${PROGETTO}/comunicazioni`,
    headers: auth(),
    payload: {
      canale: 'portal', mittente: 'Mario Emirati', destinatario: 'Studio',
      direzione: 'entrata', testo: 'Ho caricato i documenti della costituzione.', ...extra,
    },
  });

  it('un messaggio in entrata nasce già abbinato, e la riga porta il cliente come chat', async () => {
    stato.contesti = [contestoArmato()];

    const res = await server().inject(dalPortale());

    expect(res.statusCode).toBe(201);
    expect(stato.comunicazioni[0].chatId).toBe('cli-1');
    expect(stato.abbinati).toHaveLength(1);
    expect(stato.abbinati[0].create).toMatchObject({
      tenantId: TENANT, microvoceProgettoId: MICROVOCE, origine: 'contesto',
    });
    // L'abbinamento è agganciato **al messaggio appena scritto**: la transazione esiste proprio
    // per questo, e un id sbagliato qui sarebbe un legame orfano — invisibile nel fascicolo, che
    // mostrerebbe il messaggio senza il motivo per cui è lì.
    expect(stato.abbinati[0].create.comunicazioneId).toBe('com-1');
  });

  it('senza contesto armato il messaggio entra come sempre, senza abbinarsi', async () => {
    const res = await server().inject(dalPortale());

    expect(res.statusCode).toBe(201);
    expect(stato.comunicazioni).toHaveLength(1);
    expect(stato.abbinati).toEqual([]);
  });

  it("un contesto armato su un'altra pratica non abbina questo messaggio", async () => {
    // La chiave del contesto è il **cliente**, e un cliente ha più pratiche: senza il confronto
    // sulla pratica, una voce del modulo A abbinerebbe i messaggi dell'altra. È lo stesso caso di
    // Signal, dove il collegamento alla pratica non esiste e la pratica si deduce dal messaggio.
    stato.contesti = [contestoArmato({ progettoId: ALTRA_PRATICA })];

    const res = await server().inject(dalPortale());

    expect(res.statusCode).toBe(201);
    expect(stato.abbinati).toEqual([]);
  });

  it('un messaggio di un altro cliente non si abbina al contesto di questo', async () => {
    // Il finto cerca per `(canale, chatId)`: se la rotta passasse il cliente sbagliato — o non
    // passasse niente — il contesto di `cli-1` non si troverebbe. È il controllo che rende il
    // `chatId` una chiave e non un'etichetta decorativa.
    stato.contesti = [contestoArmato({ chatId: 'cli-9' })];

    const res = await server().inject(dalPortale());

    expect(res.statusCode).toBe(201);
    expect(stato.abbinati).toEqual([]);
  });

  it('il cliente della conversazione si cerca dentro lo studio della richiesta', async () => {
    // L'id della pratica arriva dal percorso e non è un segreto: senza il `tenantId` nella
    // `where`, l'id di una pratica di un altro studio farebbe etichettare questa conversazione con
    // il cliente di quello — e nel portale dell'altro studio comparirebbe una conversazione che
    // non è sua.
    await server().inject(dalPortale());

    expect(stato.ricercheProgetto[0]).toEqual({ id: PROGETTO, tenantId: TENANT });
  });

  it('un contesto scaduto non abbina', async () => {
    // Il tetto assoluto è nell'altro ramo di `contestoAncoraValido`; qui basta la scadenza per
    // inattività, che è quella che si rinnova a ogni messaggio abbinato.
    stato.contesti = [contestoArmato({ scadeAt: new Date(Date.now() - 1000) })];

    const res = await server().inject(dalPortale());

    expect(res.statusCode).toBe(201);
    expect(stato.abbinati).toEqual([]);
  });

  it('il messaggio in uscita non eredita il contesto: quello vale per chi arriva', async () => {
    // L'operatore che risponde dal portale mentre il contesto è armato. Il legame non si crea:
    // «il messaggio in uscita nasce abbinato per costruzione» è la Fase 3, e non è cablata.
    stato.contesti = [contestoArmato()];

    const res = await server().inject(dalPortale({ direzione: 'uscita', mittente: 'Studio', destinatario: 'Mario Emirati' }));

    expect(res.statusCode).toBe(201);
    expect(stato.comunicazioni[0].chatId).toBe('cli-1');
    expect(stato.abbinati).toEqual([]);
  });
});

describe('abbinare a mano un messaggio a una micro-voce', () => {
  beforeEach(() => {
    stato.messaggi = [{ id: 'msg-1', canale: 'whatsapp', direzione: 'ingresso', testo: 'Ho caricato i documenti', externalId: null, createdAt: new Date('2026-10-01T09:00:00Z') }];
  });

  it("abbina, e l'origine diventa «manuale» perché da lì il legame è dell'operatore", async () => {
    const res = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci`,
      headers: auth(), payload: { microvoceProgettoId: MICROVOCE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, microvoceId: MICROVOCE });
    expect(stato.abbinati[0].create).toMatchObject({
      tenantId: TENANT, comunicazioneId: 'msg-1', microvoceProgettoId: MICROVOCE, origine: 'manuale',
    });
    // `upsert` e non `create`: se il contesto aveva già abbinato quel messaggio, l'operatore che
    // conferma **adotta** il legame, e `update` è la metà che riscrive l'origine.
    expect(stato.abbinati[0].update).toEqual({ origine: 'manuale' });
    expect(stato.audits.some(a => a.azione === 'COMUNICAZIONE_ABBINATA_MICROVOCE')).toBe(true);
  });

  it("un messaggio di un'altra pratica non si abbina: 404, e niente riga scritta", async () => {
    // Il `progettoId` nella lettura è ciò che lo impedisce: senza, l'id di un messaggio basterebbe
    // ad abbinarlo a una voce che appartiene a un altro fascicolo dello stesso studio.
    const res = await server().inject({
      method: 'POST', url: `/progetti/${ALTRA_PRATICA}/comunicazioni/msg-1/microvoci`,
      headers: auth(), payload: { microvoceProgettoId: MICROVOCE },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toMatch(/Messaggio non trovato/);
    expect(stato.abbinati).toEqual([]);
    expect(stato.audits).toEqual([]);
  });

  it("una micro-voce di un'altra pratica non si abbina, e il messaggio dice quale delle due manca", async () => {
    // Lo stesso 404 con un messaggio diverso: davanti a una voce di un altro fascicolo, «messaggio
    // non trovato» manderebbe a cercare la cosa sbagliata.
    stato.microvoce = { ...stato.microvoce, moduloProgetto: { progettoId: ALTRA_PRATICA } };

    const res = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci`,
      headers: auth(), payload: { microvoceProgettoId: MICROVOCE },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().errore).toMatch(/Micro-voce non trovata/);
    expect(stato.abbinati).toEqual([]);
  });

  it('senza microvoceProgettoId risponde 400, invece di cercare una voce che non è stata chiesta', async () => {
    const res = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci`,
      headers: auth(), payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(stato.abbinati).toEqual([]);
  });

  it("il ruolo cliente non può abbinare: scegliere dentro il fascicolo è un atto dell'operatore", async () => {
    // Il cliente la micro-voce la **dichiara** toccando il link, e resta tracciata come `contesto`.
    // Ma il portale non ha il selettore né la vista dei moduli: una rotta aperta al suo token
    // sarebbe una superficie che nessuna interfaccia gli mostra.
    const res = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci`,
      headers: { authorization: `Bearer ${TOKEN_CLIENTE}` }, payload: { microvoceProgettoId: MICROVOCE },
    });

    expect(res.statusCode).toBe(403);
    expect(stato.abbinati).toEqual([]);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({
      method: 'POST', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci`, payload: { microvoceProgettoId: MICROVOCE },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('togliere un abbinamento', () => {
  beforeEach(() => {
    stato.messaggi = [{ id: 'msg-1', canale: 'whatsapp', direzione: 'ingresso', testo: 'Ho caricato i documenti', externalId: null, createdAt: new Date('2026-10-01T09:00:00Z') }];
  });

  it('toglie il legame e lascia la traccia', async () => {
    stato.abbinamentiPerVoce = [{ microvoceProgettoId: MICROVOCE }];

    const res = await server().inject({
      method: 'DELETE', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci/${MICROVOCE}`, headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, rimosso: true });
    expect(stato.audits.some(a => a.azione === 'COMUNICAZIONE_SBINATA_MICROVOCE')).toBe(true);
  });

  it("togliere un legame che non c'è più è il risultato voluto: 200, e nessun audit inventato", async () => {
    // Un doppio clic non deve insegnare a non fidarsi del tasto — ma nemmeno lasciare una riga di
    // audit per una rimozione che non è avvenuta: una traccia falsa è peggio di nessuna traccia.
    stato.abbinamentiPerVoce = [];

    const res = await server().inject({
      method: 'DELETE', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci/${MICROVOCE}`, headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, rimosso: false });
    expect(stato.audits.some(a => a.azione === 'COMUNICAZIONE_SBINATA_MICROVOCE')).toBe(false);
  });

  it("un messaggio di un'altra pratica non si tocca, e non si lascia traccia", async () => {
    const res = await server().inject({
      method: 'DELETE', url: `/progetti/${ALTRA_PRATICA}/comunicazioni/msg-1/microvoci/${MICROVOCE}`, headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, rimosso: false });
    expect(stato.audits).toEqual([]);
  });

  it('il ruolo cliente non può togliere: 403', async () => {
    const res = await server().inject({
      method: 'DELETE', url: `/progetti/${PROGETTO}/comunicazioni/msg-1/microvoci/${MICROVOCE}`,
      headers: { authorization: `Bearer ${TOKEN_CLIENTE}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /microvoci/:id/comunicazioni', () => {
  it('elenca i messaggi di quella voce, dal più vecchio, ognuno con la sua origine', async () => {
    stato.abbinamentiPerVoce = [
      { origine: 'contesto', comunicazione: { id: 'msg-1', canale: 'whatsapp', mittente: 'Cliente', destinatario: 'Studio', direzione: 'ingresso', testo: 'Ho caricato i documenti', createdAt: new Date('2026-10-01T09:00:00Z'), allegatiJson: null } },
      { origine: 'manuale', comunicazione: { id: 'msg-2', canale: 'email', mittente: 'Cliente', destinatario: 'Studio', direzione: 'ingresso', testo: 'Serve altro?', createdAt: new Date('2026-10-02T09:00:00Z'), allegatiJson: null } },
    ];

    const res = await server().inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni`, headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().microvoce).toEqual({ id: MICROVOCE, nome: 'Costituzione Srl' });
    expect(res.json().messaggi.map((m: any) => [m.id, m.origine])).toEqual([['msg-1', 'contesto'], ['msg-2', 'manuale']]);
  });

  it("una micro-voce di un altro studio risponde 404, non un elenco vuoto", async () => {
    // Vuoto e «non esiste» sono due risposte diverse: la prima dice «non ha messaggi», la seconda
    // «quella voce non è tua». Confonderle nasconderebbe un errore di identificativo dietro una
    // schermata che sembra normale.
    stato.microvoce = null;

    const res = await server().inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni`, headers: auth() });

    expect(res.statusCode).toBe(404);
  });

  it('la rotta è protetta: senza token 401', async () => {
    const res = await server().inject({ method: 'GET', url: `/microvoci/${MICROVOCE}/comunicazioni` });
    expect(res.statusCode).toBe(401);
  });
});
