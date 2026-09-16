/**
 * Telegram: la chat del fascicolo poteva offrirlo ma non spedirlo.
 *
 * La chiamata a `api.telegram.org` stava privata dentro `otpDispatch.ts`, quindi la rotta delle
 * comunicazioni non poteva usarla e il ramo Telegram della chat finiva in un `else` che
 * annunciava «notificato via TELEGRAM al cliente» senza che partisse niente. Qui si verifica che
 * ogni rifiuto abbia un motivo e che nessuna richiesta parta prima dei controlli.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatIdTelegram, idDelBot, inviaTestoTelegram, spiegaErroreTelegram, telegramConfigurato, usernameBotTelegram, usernameBotUsabile } from './telegramService.js';

const BOT = { tgBotToken: '123456:token-di-prova', tgBotUsername: 'studio_bot' };

function risposta(corpo: unknown, stato = 200) {
  const testo = JSON.stringify(corpo);
  return {
    ok: stato < 400,
    status: stato,
    json: async () => JSON.parse(testo),
  } as unknown as Response;
}

let fetchFinto: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFinto = vi.fn();
  vi.stubGlobal('fetch', fetchFinto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatIdTelegram — la forma che il Bot API accetta', () => {
  it('accetta un identificativo numerico, anche negativo per i gruppi', () => {
    expect(chatIdTelegram('123456789')).toBe('123456789');
    expect(chatIdTelegram('-1001234567890')).toBe('-1001234567890');
    expect(chatIdTelegram('  123456789  ')).toBe('123456789');
  });

  it('rifiuta un @nomeutente: per un cliente non è un destinatario', () => {
    // Telegram accetta il nome solo per i canali pubblici. Inoltrarlo significherebbe leggere
    // l'errore di Telegram al posto di dire all'operatore cosa mettere nell'anagrafica.
    expect(chatIdTelegram('@mario')).toBeNull();
    expect(chatIdTelegram('mario')).toBeNull();
    expect(chatIdTelegram('123')).toBeNull();
    expect(chatIdTelegram('')).toBeNull();
    expect(chatIdTelegram(null)).toBeNull();
  });
});

describe('telegramConfigurato', () => {
  it('senza token il canale è spento: non esiste un bot di piattaforma con cui ripiegare', () => {
    expect(telegramConfigurato({ tgBotToken: 'x', tgBotUsername: null })).toBe(true);
    expect(telegramConfigurato({ tgBotToken: null, tgBotUsername: 'studio_bot' })).toBe(false);
    // Un campo svuotato lasciando uno spazio non è un token: trattarlo come configurato faceva
    // partire la richiesta per leggere da Telegram un 404 che si poteva prevedere.
    expect(telegramConfigurato({ tgBotToken: '   ', tgBotUsername: null })).toBe(false);
  });
});

describe('inviaTestoTelegram — nessun successo inventato', () => {
  it('bot non configurato: lo dice e non contatta nessuno', async () => {
    const esito = await inviaTestoTelegram({ tgBotToken: null, tgBotUsername: null }, '123456789', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/bot Telegram non è configurato/i);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('chat non numerica o testo vuoto: si ferma prima della rete', async () => {
    const chat = await inviaTestoTelegram(BOT, '@mario', 'ciao');
    expect(chat.ok).toBe(false);
    expect(chat.errore).toMatch(/identificativo numerico/i);

    const testo = await inviaTestoTelegram(BOT, '123456789', '   ');
    expect(testo.ok).toBe(false);
    expect(testo.errore).toMatch(/Nessun testo/i);

    expect(fetchFinto).not.toHaveBeenCalled();
  });
});

describe('idDelBot — l\'identificativo del bot letto dal token', () => {
  it('il token è `<id-del-bot>:<segreto>`: l\'id è la prima metà', () => {
    expect(idDelBot('8973080750:AAH-segreto')).toBe('8973080750');
    expect(idDelBot('  123456:xyz  ')).toBe('123456');
  });

  it('un token che non ha quella forma non produce un id inventato', () => {
    expect(idDelBot('non-un-token')).toBeNull();
    expect(idDelBot('abc:xyz')).toBeNull();
    expect(idDelBot(':xyz')).toBeNull();
    expect(idDelBot('')).toBeNull();
    expect(idDelBot(null)).toBeNull();
  });
});

describe('inviaTestoTelegram — la chat del bot viene riconosciuta prima della rete', () => {
  it('chat id uguale all\'id del bot: lo dice, e non contatta Telegram', async () => {
    // Il guasto vero del 16/09/2026: nell'anagrafica era finito l'id che risponde `getMe`.
    // Riconoscerlo dal token evita un giro di rete e restituisce una frase che dice cosa
    // correggere, invece dell'inglese di Telegram.
    const esito = await inviaTestoTelegram(BOT, '123456', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/chat Telegram configurata è quella del bot stesso/i);
    expect(esito.errore).toMatch(/getUpdates/);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('una chat id diversa da quella del bot si spedisce normalmente', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ ok: true, result: { message_id: 9 } }));

    const esito = await inviaTestoTelegram(BOT, '245520495', 'ciao');

    expect(esito.ok).toBe(true);
    expect(fetchFinto).toHaveBeenCalledTimes(1);
  });
});

describe('inviaTestoTelegram — la richiesta', () => {
  it('spedisce a sendMessage col token dello studio nel percorso', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ ok: true, result: { message_id: 1 } }));

    const esito = await inviaTestoTelegram(BOT, '123456789', 'Buongiorno');

    expect(esito.ok).toBe(true);
    const [url, init] = fetchFinto.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bot123456:token-di-prova/sendMessage');
    expect(JSON.parse(init.body)).toEqual({
      chat_id: '123456789',
      text: 'Buongiorno',
      disable_web_page_preview: true,
    });
  });

  it('se Telegram rifiuta, riporta la sua descrizione invece di un generico «non riuscito»', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ ok: false, description: 'chat not found' }, 400));

    const esito = await inviaTestoTelegram(BOT, '123456789', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toContain('chat not found');
  });

  it('una risposta 200 con `ok: false` non è un invio riuscito', async () => {
    // Telegram risponde 200 anche quando il messaggio non è stato accettato: fidarsi del solo
    // stato HTTP è il modo in cui un fallimento diventa un riscontro verde in interfaccia.
    fetchFinto.mockResolvedValueOnce(risposta({ ok: false, description: 'bot was blocked by the user' }));

    const esito = await inviaTestoTelegram(BOT, '123456789', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toContain('bot was blocked by the user');
  });

  it('rete caduta: lo dice, e non fa finta di aver spedito', async () => {
    fetchFinto.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const esito = await inviaTestoTelegram(BOT, '123456789', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/Invio Telegram non riuscito/i);
  });
});

describe('spiegaErroreTelegram — la risposta di Telegram tradotta in cosa fare', () => {
  /**
   * Il caso vero, capitato in produzione il 16/09/2026: la chat id configurata era quella del
   * bot, e Telegram aveva risposto «Forbidden: the bot can't send messages to the bot». Il
   * messaggio è arrivato intatto all'utente, che ha dovuto indovinare cosa significasse.
   */
  it('la chat id del bot: dice quale identificativo serve invece di quello', () => {
    const spiegazione = spiegaErroreTelegram("Forbidden: the bot can't send messages to the bot");

    expect(spiegazione).toMatch(/chat id configurata è quella del bot/i);
    expect(spiegazione).toMatch(/getMe/);
    expect(spiegazione).toMatch(/getUpdates/);
    // L'originale resta: chi conosce l'API lo cerca, e senza non saprebbe cosa ha risposto.
    expect(spiegazione).toContain("the bot can't send messages to the bot");
  });

  it('chat not found: la causa vera è che il cliente non ha mai scritto al bot', () => {
    const spiegazione = spiegaErroreTelegram('Bad Request: chat not found');

    expect(spiegazione).toMatch(/non ha mai scritto al bot/i);
    expect(spiegazione).toMatch(/Avvio/i);
  });

  it('bot bloccato dal destinatario', () => {
    expect(spiegaErroreTelegram('Forbidden: bot was blocked by the user')).toMatch(/ha bloccato il bot/i);
  });

  it('un errore che non si conosce esce com\'è, senza spiegazioni inventate', () => {
    // Inventare una causa per un errore non previsto manderebbe a cercare il difetto altrove.
    expect(spiegaErroreTelegram('Bad Request: something entirely new')).toBe('Bad Request: something entirely new');
  });

  it('l\'invio fallito porta la spiegazione, non il solo testo di Telegram', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ ok: false, description: "Forbidden: the bot can't send messages to the bot" }));

    const esito = await inviaTestoTelegram(BOT, '123456789', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/chat id configurata è quella del bot/i);
  });
});

describe('usernameBotTelegram — lo username del bot, non il suo id', () => {
  it("accetta lo username e toglie la chiocciola, che nell'anagrafica c'è o non c'è", () => {
    expect(usernameBotTelegram('studio_bot')).toBe('studio_bot');
    expect(usernameBotTelegram('@studio_bot')).toBe('studio_bot');
    expect(usernameBotTelegram('  @StudioDiProvaBot  ')).toBe('StudioDiProvaBot');
  });

  it("rifiuta un numero: è l'id del bot, e t.me/<numero> è un utente inesistente", () => {
    // Il guasto vero del 16/09/2026. `getMe` risponde con **due** cose — `id` e `username` — e
    // l'id, copiato nel campo «Bot Username», passava la forma di Telegram senza protestare:
    // alfanumerico, dieci caratteri, dentro i 5-32 ammessi. Il link si componeva, e sul telefono
    // del cliente si apriva «questo utente non esiste» mentre il bot funzionava benissimo.
    expect(usernameBotTelegram('87654321')).toBeNull();
    expect(usernameBotTelegram('12345')).toBeNull();
    expect(usernameBotTelegram('1234567890123')).toBeNull();
  });

  it('rifiuta le forme che Telegram non assegna', () => {
    expect(usernameBotTelegram('abc')).toBeNull(); // sotto i 5 caratteri
    expect(usernameBotTelegram('a'.repeat(33))).toBeNull(); // sopra i 32
    expect(usernameBotTelegram('studio bot')).toBeNull(); // lo spazio non è ammesso
    expect(usernameBotTelegram('studio-bot')).toBeNull(); // nemmeno il trattino
    expect(usernameBotTelegram('')).toBeNull();
    expect(usernameBotTelegram(null)).toBeNull();
    expect(usernameBotTelegram(undefined)).toBeNull();
  });
});

describe('usernameBotUsabile — il motivo, non il silenzio', () => {
  it("quando va bene torna lo username, con la chiocciola tolta", () => {
    expect(usernameBotUsabile('@StudioDiProvaBot')).toEqual({ ok: true, username: 'StudioDiProvaBot' });
  });

  it("dice che è l'id del bot, e non lo ripete nel messaggio", () => {
    const esito = usernameBotUsabile('87654321');

    expect(esito.ok).toBe(false);
    if (esito.ok) throw new Error('atteso un rifiuto');
    expect(esito.errore).toMatch(/id numerico/i);
    expect(esito.errore).toMatch(/Registra webhook/i);
    // Regola 6, e non è un dettaglio: se il valore è l'id del bot, è la **prima metà del token**.
    // Ripeterlo nel messaggio d'errore lo manderebbe al browser per spiegare un guasto, cioè
    // proprio ciò che la regola vieta.
    expect(esito.errore).not.toContain('87654321');
  });

  it('campo vuoto e campo sbagliato hanno messaggi diversi, perché i rimedi sono diversi', () => {
    // Un messaggio solo per entrambi («manca lo username») manderebbe a compilare a mano un campo
    // che «Registra webhook» riempie da solo — e non spiegherebbe cosa c'era di sbagliato.
    const vuoto = usernameBotUsabile('   ');
    const sbagliato = usernameBotUsabile('studio bot');

    expect(vuoto.ok).toBe(false);
    expect(sbagliato.ok).toBe(false);
    if (vuoto.ok || sbagliato.ok) throw new Error('attesi due rifiuti');
    expect(vuoto.errore).toMatch(/Manca lo @username/);
    expect(sbagliato.errore).toMatch(/non è uno username Telegram valido/);
  });
});
