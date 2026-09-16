/**
 * L'arrivo di un `/start` al bot dello studio: il cliente ha toccato il link di una pratica.
 *
 * Sta in un servizio e non dentro la rotta webhook per due ragioni. La prima è che la rotta
 * Telegram aveva già superato le ottocento righe, e aggiungerci questo blocco l'avrebbe portata
 * oltre il limite oltre il quale la divisione è obbligatoria (regola 8). La seconda è che qui non
 * c'è niente di HTTP: c'è una decisione di dominio — *questo* payload collega *questa* chat a
 * *quella* pratica — con il suo testo di risposta e il suo avviso allo studio.
 *
 * L'ordine delle scritture è la parte da non cambiare. Prima il collegamento, **poi** la riga di
 * idempotenza: se si scrivesse prima la riga, un rinvio di Telegram la troverebbe e uscirebbe senza
 * aver mai collegato nulla — il collegamento sparirebbe in silenzio, che è la classe di guasto che
 * questa funzione esiste per chiudere. Al contrario, riscrivere il collegamento prima della riga è
 * innocuo: l'`upsert` è idempotente e riscrive gli stessi valori.
 */
import { prisma } from '../util/prismaClient.js';
import { notificaStudio } from './notificheService.js';
import { credenzialiCanali } from './otpDispatch.js';
import { inviaTestoTelegram } from './telegramService.js';
import { collegaChatAProgetto } from './collegamentoChat.js';
import { progettoIdDaPayloadCollegamento } from '../util/webhookSecurity.js';

/**
 * Riconosce un `/start`, con o senza payload.
 *
 * Telegram manda `message.text` = `/start <payload>` quando si apre `t.me/<Bot>?start=<payload>`, e
 * `/start` da solo quando si preme Avvio. La forma con il nome del bot (`/start@StudioBot`) arriva
 * nei gruppi. Restituisce `null` se il testo non è un `/start`: in quel caso il messaggio segue il
 * percorso normale.
 */
export function leggiRichiestaAvvio(testo: string): { payload: string | null } | null {
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(testo.trim());
  if (!match) return null;
  return { payload: match[1] ?? null };
}

export type StatoAvvio =
  | 'collegato'
  | 'duplicato'
  | 'senza_payload'
  | 'payload_non_valido'
  | 'progetto_non_trovato'
  | 'progetto_chiuso';

export interface EsitoAvvio {
  stato: StatoAvvio;
  progetto?: { id: string; nome: string };
  cliente?: { id: string; nome: string };
}

const TESTO_SENZA_PAYLOAD =
  'Ciao! Questa chat non è ancora collegata a una pratica. Per collegarla apri il link che ti ha '
  + 'inviato lo studio: da quel momento i messaggi che scrivi qui entrano nel fascicolo di quella '
  + 'pratica.';

const TESTO_PAYLOAD_NON_VALIDO =
  'Il link con cui sei arrivato non è valido, oppure è scaduto. Chiedi allo studio di rimandartelo: '
  + 'senza un link valido non riesco a capire a quale pratica appartiene questa chat.';

const TESTO_PROGETTO_NON_TROVATO =
  'Il link con cui sei arrivato non corrisponde a nessuna pratica di questo studio. Chiedi allo '
  + 'studio di rimandartelo.';

const TESTO_PROGETTO_CHIUSO =
  'La pratica di questo link è conclusa o archiviata, quindi non raccoglie più messaggi. Chiedi '
  + 'allo studio il link della pratica aperta.';

/**
 * Risponde nella chat del cliente.
 *
 * Un invio non riuscito **non** fa fallire il webhook: il collegamento è già scritto e la riga di
 * idempotenza pure, quindi far rispondere 500 significherebbe che Telegram ritenta un update che è
 * già stato applicato. Il motivo resta nel log, dove serve a chi indaga.
 */
async function rispondiAllaChat(tenantId: string, chatId: string, testo: string): Promise<void> {
  try {
    const cred = await credenzialiCanali(tenantId);
    const esito = await inviaTestoTelegram(cred, chatId, testo);
    if (!esito.ok) console.warn('[Telegram] risposta al cliente non inviata:', esito.errore);
  } catch (err) {
    console.warn('[Telegram] risposta al cliente non inviata:', err);
  }
}

/**
 * Applica un `/start`: collega la chat alla pratica del payload, o spiega perché non si può.
 *
 * Non lancia per un payload non valido o per una pratica chiusa: sono esiti previsti di una richiesta
 * che arriva da fuori, e ognuno ha la sua risposta nella chat.
 */
export async function gestisciAvvio(
  tenantId: string,
  chatId: string,
  updateId: string,
  payload: string | null,
  masterSecret: string | undefined,
): Promise<EsitoAvvio> {
  if (!payload) {
    await rispondiAllaChat(tenantId, chatId, TESTO_SENZA_PAYLOAD);
    return { stato: 'senza_payload' };
  }

  const progettoId = progettoIdDaPayloadCollegamento(payload, tenantId, masterSecret);
  if (!progettoId) {
    // Il payload non è autentico: non si distingue fra «manomesso» e «di un altro studio» nemmeno
    // nel messaggio, perché chi prova non deve poter capire cosa ha sbagliato.
    await rispondiAllaChat(tenantId, chatId, TESTO_PAYLOAD_NON_VALIDO);
    return { stato: 'payload_non_valido' };
  }

  const collegamento = await collegaChatAProgetto(tenantId, 'telegram', chatId, progettoId, 'link');
  if (!collegamento.ok) {
    await rispondiAllaChat(
      tenantId,
      chatId,
      collegamento.motivo === 'progetto_non_trovato' ? TESTO_PROGETTO_NON_TROVATO : TESTO_PROGETTO_CHIUSO,
    );
    return { stato: collegamento.motivo };
  }

  try {
    await prisma.webhookInbox.create({
      data: { tenantId, provider: 'telegram_update', eventId: updateId },
    });
  } catch (err) {
    // Riga già presente: questo update era già stato applicato. Il collegamento sopra è stato
    // riscritto con gli stessi valori, quindi non c'è niente da correggere e niente da rispondere.
    if ((err as { code?: string })?.code === 'P2002') {
      return { stato: 'duplicato', progetto: collegamento.progetto, cliente: collegamento.cliente };
    }
    throw err;
  }

  await rispondiAllaChat(
    tenantId,
    chatId,
    `✅ Fatto: questa chat è collegata alla pratica «${collegamento.progetto.nome}». Da ora i `
    + 'messaggi che scrivi qui entrano in quel fascicolo. Se ti serviva un\'altra pratica, apri il '
    + 'link di quella e questa chat passerà lì.',
  );

  // Lo studio lo deve sapere: è la conferma che il link che ha mandato ha funzionato, e da quel
  // momento i messaggi di quella chat arrivano da soli senza che nessuno li instradi a mano.
  await notificaStudio(tenantId, {
    tipoEvento: 'chat_collegata_progetto',
    oggetto: `Chat Telegram collegata — ${collegamento.cliente.nome}`,
    corpo: `${collegamento.cliente.nome} ha collegato la propria chat Telegram (${chatId}) alla `
      + `pratica «${collegamento.progetto.nome}». I messaggi che scriverà lì entreranno in quel `
      + 'fascicolo senza bisogno di altro.',
    link: `/projects/${collegamento.progetto.id}`,
  }).catch(() => {});

  return { stato: 'collegato', progetto: collegamento.progetto, cliente: collegamento.cliente };
}
