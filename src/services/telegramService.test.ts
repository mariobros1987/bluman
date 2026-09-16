/**
 * Telegram: la chat del fascicolo poteva offrirlo ma non spedirlo.
 *
 * La chiamata a `api.telegram.org` stava privata dentro `otpDispatch.ts`, quindi la rotta delle
 * comunicazioni non poteva usarla e il ramo Telegram della chat finiva in un `else` che
 * annunciava «notificato via TELEGRAM al cliente» senza che partisse niente. Qui si verifica che
 * ogni rifiuto abbia un motivo e che nessuna richiesta parta prima dei controlli.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatIdTelegram, inviaTestoTelegram, spiegaErroreTelegram, telegramConfigurato } from './telegramService.js';

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
