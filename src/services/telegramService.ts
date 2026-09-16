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
      return { ok: false, errore: `Telegram non ha accettato l'invio: ${motivo}` };
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
