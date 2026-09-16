/**
 * Telegram, con il bot dello studio.
 *
 * Vive qui e non dentro `otpDispatch.ts` per la stessa ragione per cui `chiamaGraphWhatsapp` è
 * finito in `whatsappService.ts`: la stessa chiamata serve a due percorsi — il codice di firma e
 * le comunicazioni del fascicolo — e una seconda copia diverge. La copia che c'era era privata,
 * quindi la chat del fascicolo non poteva chiamarla e ripiegava su un riscontro inventato:
 * scegliendo Telegram il messaggio entrava nel registro con «notificato via TELEGRAM» e nessun
 * messaggio partiva.
 *
 * Il bot è dello studio (`tgBotToken` sulla riga Tenant): non esiste un bot di piattaforma con
 * cui ripiegare, e un canale non configurato resta spento con il motivo, non funziona per conto
 * di qualcun altro.
 */

export interface CredenzialiTelegram {
  tgBotToken: string | null;
  tgBotUsername: string | null;
}

export interface EsitoTelegram {
  ok: boolean;
  errore?: string;
}

/** Quanto si aspetta `api.telegram.org` prima di dichiararlo irraggiungibile. */
const TIMEOUT_MS = 15_000;

export function telegramConfigurato(cred: CredenzialiTelegram): boolean {
  // Con il solo `Boolean`, un campo svuotato lasciando uno spazio risultava configurato e la
  // rotta tentava l'invio per leggere da Telegram un 404 che poteva dirlo da sola.
  return Boolean(cred.tgBotToken?.trim());
}

/**
 * L'identificativo della chat, nella forma che accetta il Bot API.
 *
 * È un intero, negativo per i gruppi. Un `@nomeutente` non è una chat id: Telegram lo accetta
 * solo per i canali pubblici, e per un cliente il valore giusto è quello che il bot riceve
 * quando la persona gli scrive. Accettare qualunque stringa significherebbe inoltrare a Telegram
 * qualcosa che non è un destinatario, e leggere il suo errore al posto di dirlo qui.
 */
export function chatIdTelegram(valore: string | null | undefined): string | null {
  const grezzo = String(valore ?? '').trim();
  return /^-?\d{5,20}$/.test(grezzo) ? grezzo : null;
}

/**
 * L'identificativo del bot, letto dal token stesso.
 *
 * Il token di Telegram è `<id-del-bot>:<segreto>`: l'id è nella prima metà, quindi si conosce
 * senza chiamare `getMe` e senza conservarlo in una colonna. Serve a riconoscere il caso in cui
 * la chat id configurata è quella del bot: Telegram risponde «the bot can't send messages to the
 * bot», e riconoscerlo qui trasforma un giro di rete e un errore in inglese in una frase che
 * dice cosa correggere.
 */
export function idDelBot(token: string | null | undefined): string | null {
  const id = String(token ?? '').trim().split(':')[0] ?? '';
  return /^\d{5,20}$/.test(id) ? id : null;
}

/**
 * Traduce la risposta di Telegram in una frase che dice cosa fare.
 *
 * Telegram risponde in inglese e in gergo: «Forbidden: the bot can't send messages to the bot»
 * non fa pensare all'identificativo sbagliato, e chi lo legge va a cercare il difetto nel posto
 * sbagliato — è successo davvero, ed è il motivo per cui questa funzione esiste. Il testo
 * originale resta in coda, perché chi conosce l'API lo cerca.
 *
 * I casi tradotti sono quelli che si incontrano configurando uno studio: la chat id presa da
 * `getMe` invece che dalla conversazione, un cliente che non ha mai scritto al bot, un bot
 * bloccato. Il resto esce com'è: inventare una spiegazione per un errore che non si conosce è
 * peggio che riportarlo.
 */
export function spiegaErroreTelegram(descrizione: string): string {
  const d = descrizione.toLowerCase();
  const originale = ` (Telegram: «${descrizione}»)`;

  // L'identificativo è quello del bot stesso. Capita leggendo `getMe`, o `getUpdates` prima che
  // il cliente scriva: `getMe` risponde con l'id del bot, ed è quello che viene copiato.
  if (d.includes("can't send messages to the bot") || d.includes('can not send messages to the bot')) {
    return 'la chat id configurata è quella del bot stesso, non del cliente. Non usare l\'identificativo '
      + 'che risponde `getMe`: serve il `chat.id` (o `message.from.id`) che compare in `getUpdates` '
      + 'dopo che il cliente ha scritto al bot.' + originale;
  }
  if (d.includes('chat not found')) {
    return 'quella chat non esiste, oppure il cliente non ha mai scritto al bot. Telegram permette al bot '
      + 'di scrivere solo a chi gli ha scritto almeno una volta: chiedi al cliente di aprire il bot e '
      + 'premere Avvio, poi riprova.' + originale;
  }
  if (d.includes('bot was blocked by the user') || d.includes('user is deactivated')) {
    return 'il destinatario ha bloccato il bot, oppure l\'account non esiste più. Il messaggio non '
      + 'arriverà finché non sblocca.' + originale;
  }
  if (d.includes('not enough rights') || d.includes('have no rights')) {
    return 'il bot non ha il permesso di scrivere in quella chat: in un gruppo serve che sia stato '
      + 'promosso, o che i permessi di invio non siano limitati.' + originale;
  }
  return descrizione;
}

/**
 * Spedisce un messaggio di testo.
 *
 * Telegram non ha la finestra di 24 ore di WhatsApp: il bot può scrivere a chi gli ha scritto
 * almeno una volta, e da lì in poi il canale resta aperto. È il motivo per cui
 * `canaliDisponibili` chiede al cliente di scrivere al bot prima di scegliere questo canale.
 */
export async function inviaTestoTelegram(
  cred: CredenzialiTelegram,
  chatId: string,
  testo: string,
): Promise<EsitoTelegram> {
  if (!telegramConfigurato(cred)) {
    return { ok: false, errore: 'Il bot Telegram non è configurato nelle impostazioni dello studio (Impostazioni → Canali).' };
  }
  const token = cred.tgBotToken!.trim();

  const destinatario = chatIdTelegram(chatId);
  if (!destinatario) {
    return {
      ok: false,
      errore:
        'La chat Telegram del destinatario non è utilizzabile: serve l\'identificativo numerico della chat, quello che il bot riceve quando il cliente gli scrive.',
    };
  }
  if (!testo.trim()) return { ok: false, errore: 'Nessun testo da spedire.' };

  // Il destinatario è il bot stesso: un bot non può scrivere a se stesso, e Telegram lo
  // rifiuterebbe con una frase che non fa pensare all'identificativo. Qui lo si dice prima di
  // partire — è il guasto vero capitato in produzione il 16/09/2026, con l'id di `getMe`
  // copiato nell'anagrafica al posto di quello della conversazione.
  if (destinatario === idDelBot(token)) {
    return {
      ok: false,
      errore:
        'La chat Telegram configurata è quella del bot stesso: un bot non può scrivere a se stesso. '
        + 'Nell\'anagrafica del cliente va il `chat.id` che compare in `getUpdates` dopo che il '
        + 'cliente ha scritto al bot — non l\'identificativo che risponde `getMe`, che è del bot.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const risposta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: destinatario, text: testo, disable_web_page_preview: true }),
      signal: controller.signal,
    });

    const dettaglio: any = await risposta.json().catch(() => null);
    if (!risposta.ok || dettaglio?.ok === false) {
      const motivo = dettaglio?.description || `HTTP ${risposta.status}`;
      return { ok: false, errore: `Telegram non ha accettato l'invio: ${spiegaErroreTelegram(motivo)}` };
    }

    return { ok: true };
  } catch (err) {
    const causa = err instanceof Error && err.name === 'AbortError'
      ? `nessuna risposta entro ${TIMEOUT_MS / 1000} secondi`
      : (err instanceof Error ? err.message : 'errore di rete');
    return { ok: false, errore: `Invio Telegram non riuscito: ${causa}.` };
  } finally {
    clearTimeout(timer);
  }
}
