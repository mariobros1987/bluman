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
import { armaContesto, microvoceDiProgetto } from './comunicazioniMicrovoci.js';
import {
  progettoIdDaPayloadCollegamento,
  microvoceIdDaPayloadCollegamento,
} from '../util/webhookSecurity.js';

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
  | 'contesto_armato'
  | 'duplicato'
  | 'senza_payload'
  | 'payload_non_valido'
  | 'progetto_non_trovato'
  | 'progetto_chiuso'
  | 'microvoce_non_trovata';

export interface EsitoAvvio {
  stato: StatoAvvio;
  progetto?: { id: string; nome: string };
  cliente?: { id: string; nome: string };
  microvoce?: { id: string; nome: string };
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

const TESTO_MICROVOCE_NON_TROVATA =
  'Il link con cui sei arrivato non corrisponde a nessuna voce di questo studio: può essere stata '
  + 'cancellata dopo che il link è stato inviato. Chiedi allo studio di rimandartelo.';

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
 *
 * Il payload può dire **due** cose: a quale pratica appartiene la chat (il caso di sempre) o quale
 * micro-voce di quella pratica il cliente sta per raccontare. Si prova prima la micro-voce, perché
 * il suo payload è il più specifico — e i due non si possono confondere: quello della micro-voce ha
 * il prefisso `z`, che nessun payload di pratica può avere (i loro iniziano con l'UUID, quindi con
 * un carattere esadecimale). Un link già spedito continua a significare la stessa cosa.
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

  const microvoceId = microvoceIdDaPayloadCollegamento(payload, tenantId, masterSecret);
  if (microvoceId) return gestisciAvvioMicrovoce(tenantId, chatId, updateId, microvoceId);

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
    + 'link di quella e questa chat passerà lì.'
    // Se la chat aveva una micro-voce selezionata e la si è spostata su un'altra pratica, quella
    // selezione è caduta: va detta, perché il cliente l'aveva fatta e non vedrebbe sparire niente.
    // È un messaggio del bot, non un'etichetta dentro il messaggio del cliente.
    + (collegamento.contestoDisarmato
      ? '\n\nℹ️ La micro-voce che avevi selezionato riguardava l\'altra pratica, quindi è stata '
        + 'deselezionata: se ti serve, aprine di nuovo il link.'
      : ''),
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

/**
 * Il `/start` di un link per **micro-voce**: il cliente ha toccato il link di una voce e da quel
 * momento racconta *quella*.
 *
 * Fa due cose, e l'ordine conta. Prima **collega la chat alla pratica** che possiede la micro-voce
 * (riusando `collegaChatAProgetto`, con tutto ciò che comporta: rifiuto di una pratica chiusa,
 * spostamento se la chat era altrove, e — se era altrove davvero — disarmo del contesto vecchio).
 * Poi **arma il contesto** su quella micro-voce.
 *
 * Il collegamento non si sposta sulla micro-voce, e non potrebbe: la chiave unica è sulla **chat** e
 * una chat parla di tutte le voci della pratica. Se la micro-voce scrivesse il collegamento, un
 * cliente che parla di due moduli lo farebbe saltellare a ogni link. Il contesto è la cosa che ha la
 * granularità giusta per una cosa che può cambiare da un messaggio all'altro.
 */
async function gestisciAvvioMicrovoce(
  tenantId: string,
  chatId: string,
  updateId: string,
  microvoceId: string,
): Promise<EsitoAvvio> {
  const microvoce = await microvoceDiProgetto(tenantId, microvoceId);
  if (!microvoce) {
    await rispondiAllaChat(tenantId, chatId, TESTO_MICROVOCE_NON_TROVATA);
    return { stato: 'microvoce_non_trovata' };
  }

  const collegamento = await collegaChatAProgetto(tenantId, 'telegram', chatId, microvoce.progettoId, 'link');
  if (!collegamento.ok) {
    await rispondiAllaChat(
      tenantId,
      chatId,
      collegamento.motivo === 'progetto_non_trovato' ? TESTO_PROGETTO_NON_TROVATO : TESTO_PROGETTO_CHIUSO,
    );
    return { stato: collegamento.motivo };
  }

  // Arma dopo il collegamento: prima di questo istante la chat può essere in un'altra pratica, e un
  // contesto armato lì sarebbe stato rifiutato dal confronto sulla pratica — ma il cliente avrebbe
  // visto una conferma per un armamento che non c'era.
  const armato = await armaContesto(tenantId, 'telegram', chatId, microvoce.id, 'link');
  if (!armato.ok) {
    await rispondiAllaChat(tenantId, chatId, TESTO_MICROVOCE_NON_TROVATA);
    return { stato: 'microvoce_non_trovata' };
  }

  try {
    await prisma.webhookInbox.create({
      data: { tenantId, provider: 'telegram_update', eventId: updateId },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      return {
        stato: 'duplicato',
        progetto: collegamento.progetto,
        cliente: collegamento.cliente,
        microvoce: { id: microvoce.id, nome: microvoce.nome },
      };
    }
    throw err;
  }

  await rispondiAllaChat(
    tenantId,
    chatId,
    `✅ Fatto: da ora i messaggi che scrivi qui riguardano «${microvoce.nome}», nella pratica `
    + `«${collegamento.progetto.nome}». Se ti serve un'altra voce, apri il link di quella e questa `
    + 'chat passerà a quella: la pratica resta la stessa.',
  );

  await notificaStudio(tenantId, {
    tipoEvento: 'chat_collegata_progetto',
    oggetto: `Micro-voce selezionata — ${collegamento.cliente.nome}`,
    corpo: `${collegamento.cliente.nome} ha selezionato la voce «${microvoce.nome}» della pratica `
      + `«${collegamento.progetto.nome}» (chat Telegram ${chatId}): i messaggi che scriverà lì `
      + 'verranno abbinati a quella voce.',
    link: `/projects/${collegamento.progetto.id}`,
  }).catch(() => {});

  return {
    stato: 'contesto_armato',
    progetto: collegamento.progetto,
    cliente: collegamento.cliente,
    microvoce: { id: microvoce.id, nome: microvoce.nome },
  };
}
