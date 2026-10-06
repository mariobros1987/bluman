/**
 * I messaggi abbinati alle micro-voci, e il contesto che li abbina da sé.
 *
 * Perché esiste. Un messaggio sapeva a quale **pratica** apparteneva e nient'altro: la micro-voce —
 * dove il lavoro accade davvero — non sapeva che il cliente aveva scritto qualcosa che la riguardava,
 * e per scoprirlo bisognava rileggere la chat a mano.
 *
 * La scelta di fondo è la stessa che `collegamentoChat.ts` aveva già fatto un livello sopra. Lì
 * l'instradamento chat→pratica era un'euristica a due cancelli, cadeva nel caso normale di uno studio
 * (un cliente con due incarichi aperti), e la soluzione è stata il collegamento **esplicito**: «toglie
 * l'ambiguità invece di indovinare meglio». Indovinare *di cosa parla* un messaggio è più difficile
 * che indovinare *a chi appartiene*, quindi la stessa conclusione vale a maggior ragione — e questo
 * esclude sia i tag nel testo (li leggerebbe il cliente) sia un modello che decide da solo.
 *
 * Quattro strade, in ordine di affidabilità:
 *
 *   1. **contesto** — la micro-voce di cui si sta parlando *adesso* in quella chat. La arma il
 *      cliente toccando il link della micro-voce, oppure l'operatore dalla scheda. Non si indovina:
 *      qualcuno l'ha detto.
 *   2. **manuale** — l'operatore abbina a mano. È la rete che non fallisce mai.
 *   3. **microvoce** — il messaggio è stato **scritto da dentro** la micro-voce, quindi nasce
 *      abbinato: non c'è stato nessun abbinamento da fare, e non c'è niente da indovinare.
 *   4. **eredita** — una risposta a un messaggio già abbinato (non ancora cablata: dipende dal
 *      payload dei provider, e va verificata per canale prima di prometterla).
 *
 * `origine` registra quale delle quattro, perché un abbinamento senza motivo è indistinguibile da
 * un abbinamento sbagliato.
 *
 * **Perché la 3 non è `manuale`.** La metrica con cui si decide se la 4 vale il lavoro conta
 * `manuale` come «il residuo che l'operatore ha dovuto sistemare a mano»: un messaggio nato
 * abbinato la falserebbe in su, e le due voci dicono cose diverse — «una persona ha deciso questo
 * legame» e «questo legame è la conseguenza di dove il messaggio è stato scritto». La card, senza
 * una voce propria, direbbe «abbinata a mano dall'operatore» di un messaggio che nessuno ha
 * abbinato.
 *
 * **Perché non arma il contesto.** Il contesto parla della **chat** («questa conversazione riguarda
 * quella voce»), il legame nato parla di **quel messaggio**. Una risposta sola non rende tutta la
 * conversazione una conversazione su quella voce — e il contesto resterebbe armato ad abbinare i
 * messaggi successivi, che è esattamente il modo in cui un'etichetta sopravvive alla conversazione
 * che l'aveva giustificata.
 *
 * **La precedenza fra 1 e 4 è decisa qui, prima che la 4 esista.** Quando l'eredità arriverà, un
 * messaggio che è *sia* risposta a un messaggio abbinato *sia* dentro un contesto armato per
 * un'altra micro-voce va abbinato all'**eredità**, e il contesto non lo tocca. La ragione è che le
 * due prove non sono della stessa forza: l'eredità parla di *quel messaggio* (qualcuno ha risposto
 * a una cosa precisa), il contesto parla della *chat* (una dichiarazione d'intenti che può essere
 * invecchiata). Se questa regola non fosse scritta, il comportamento sarebbe quello che capita per
 * primo nell'ordine degli `if` — cioè niente di voluto. Va quindi implementata con un ramo
 * esplicito, e verificata da un test che le mette in conflitto apposta.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../util/prismaClient.js';
import { proiettaRecapito, type RecapitoComunicazione } from '../util/statoComunicazione.js';

/**
 * Quanto resta armato un contesto senza che nessuno ci scriva dentro.
 *
 * Il numero non è una preferenza: un contesto armato tre settimane fa non descrive più la
 * conversazione, e da lì in poi abbinerebbe **in silenzio** i messaggi sbagliati — cioè il fascicolo
 * mentirebbe, che è la cosa che questa feature esiste per evitare. Ventiquattro ore coprono una
 * conversazione e non coprono un mese.
 */
export const ORE_VALIDITA_CONTESTO = 24;

/**
 * Il tetto assoluto dall'armamento, oltre il quale il contesto muore **anche se è attivo**.
 *
 * Senza, il rinnovo per attività si mangerebbe la regola che dovrebbe servire: ogni messaggio
 * abbinato sposta la scadenza in avanti, quindi una chat che scrive tutti i giorni non scade mai —
 * nemmeno se la conversazione è *scivolata* su un altro argomento. Il rinnovo misura l'attività, non
 * la pertinenza, e sono due cose diverse: la pertinenza non è misurabile, l'età sì.
 *
 * Sette giorni è un compromesso dichiarato: abbastanza da non chiedere conferma a ogni scambio,
 * poco da non lasciare in giro un'etichetta di cui nessuno si ricorda. Alla scadenza il contesto non
 * «sbaglia»: smette di abbinare, e il messaggio torna a essere quello che sarebbe senza contesto.
 *
 * Ri-armare (il cliente che ritocca il link, l'operatore che risceglie la voce) riporta `armatoAt`
 * a ora e fa ripartire il tetto: è una decisione nuova, presa da una persona.
 */
export const ORE_TETTO_CONTESTO = 168;

export type OrigineAbbinamento = 'contesto' | 'manuale' | 'microvoce' | 'eredita';
export type ChiArmaContesto = 'link' | 'operatore';

/** La scadenza di un contesto armato adesso. */
export function scadenzaContesto(da: Date = new Date()): Date {
  return new Date(da.getTime() + ORE_VALIDITA_CONTESTO * 3600_000);
}

/**
 * Un contesto armato vale ancora? Due condizioni, entrambe necessarie: non è scaduto per inattività,
 * e non ha superato il tetto assoluto dall'armamento.
 *
 * È una funzione pura apposta: la regola più facile da sbagliare di tutta la feature è questa, e
 * così si può provare da sola, senza database.
 */
export function contestoAncoraValido(
  armatoAt: Date,
  scadeAt: Date | null,
  adesso: Date = new Date(),
): boolean {
  if (scadeAt && scadeAt.getTime() <= adesso.getTime()) return false;
  if (adesso.getTime() - armatoAt.getTime() >= ORE_TETTO_CONTESTO * 3600_000) return false;
  return true;
}

/**
 * La parte di `tx` che serve ad abbinare dentro una transazione di ingestion.
 *
 * Strutturale come i `TransazioneWebhook`/`TransazioneIngestione` dei chiamanti: il webhook gira su
 * un finto database nei test, e chiedere il tipo intero di Prisma lo costringerebbe a fingere anche
 * i modelli che non usa.
 */
export type TxAbbinamento = {
  comunicazioneMicrovoce: {
    upsert: (args: Prisma.ComunicazioneMicrovoceUpsertArgs) => Promise<unknown>;
  };
  contestoMicrovoceChat: {
    findUnique: (args: Prisma.ContestoMicrovoceChatFindUniqueArgs) => Promise<{
      progettoId: string;
      microvoceProgettoId: string;
      armatoAt: Date;
      scadeAt: Date | null;
    } | null>;
    update: (args: Prisma.ContestoMicrovoceChatUpdateArgs) => Promise<unknown>;
  };
};

/**
 * Abbina a una micro-voce il messaggio appena entrato, **se** quella chat ha un contesto armato e
 * valido **e** la micro-voce è della stessa pratica in cui il messaggio è finito.
 *
 * Torna l'id della micro-voce quando ha abbinato, `null` quando non c'era niente da fare.
 *
 * Legge e scrive su `tx`, quindi sta dentro la stessa transazione che crea il messaggio: o il
 * messaggio esiste con il suo abbinamento, o non esiste. Scrivere l'abbinamento dopo il commit
 * lascerebbe una finestra in cui il fascicolo ha il messaggio e ha perso il motivo per cui è lì.
 *
 * **Il confronto sulla pratica non è ridondante rispetto al disarmo sul collegamento.** Su Telegram
 * e WhatsApp la chat è collegata a una pratica e il contesto nasce da una micro-voce della stessa,
 * quindi il caso non si presenta; su **Signal** il collegamento non esiste e la pratica si deduce
 * dal messaggio, per cui la stessa chat può produrre messaggi in pratiche diverse nel tempo. Senza
 * questo confronto lì l'abbinamento sarebbe sbagliato in silenzio — e in silenzio è la parola che
 * conta: nessuno se ne accorgerebbe leggendo il fascicolo.
 *
 * Il `upsert` è anche l'idempotenza: un rinvio del provider che arrivasse fin qui non fallisce sul
 * vincolo unico, e comunque non ci arriva, perché la riga di idempotenza lo ferma prima.
 *
 * Rinnova la scadenza: finché si scrive in quella chat della micro-voce, il contesto resta vivo
 * (entro il tetto assoluto, che il rinnovo non sposta).
 */
export async function abbinaAlContesto(
  tx: TxAbbinamento,
  tenantId: string,
  canale: string,
  chatId: string,
  progettoId: string,
  comunicazioneId: string,
): Promise<string | null> {
  const contesto = await tx.contestoMicrovoceChat.findUnique({
    where: { tenantId_canale_chatId: { tenantId, canale, chatId } },
    select: { progettoId: true, microvoceProgettoId: true, armatoAt: true, scadeAt: true },
  });
  if (!contesto) return null;
  if (!contestoAncoraValido(contesto.armatoAt, contesto.scadeAt)) return null;
  if (contesto.progettoId !== progettoId) return null;

  await tx.comunicazioneMicrovoce.upsert({
    where: {
      comunicazioneId_microvoceProgettoId: {
        comunicazioneId,
        microvoceProgettoId: contesto.microvoceProgettoId,
      },
    },
    create: {
      tenantId,
      comunicazioneId,
      microvoceProgettoId: contesto.microvoceProgettoId,
      origine: 'contesto' satisfies OrigineAbbinamento,
    },
    update: {},
  });

  await tx.contestoMicrovoceChat.update({
    where: { tenantId_canale_chatId: { tenantId, canale, chatId } },
    data: { scadeAt: scadenzaContesto() },
  });

  return contesto.microvoceProgettoId;
}

/**
 * La micro-voce, se è di questo studio e (quando serve) di questa pratica.
 *
 * Il `progettoId` non è decorativo, ed è lo stesso ragionamento del `progettoId` nella `where` di
 * `scollegaPerId`: senza, l'identificativo di una micro-voce basterebbe ad abbinare un messaggio di
 * un'altra pratica dello stesso studio — e la rotta risponderebbe «fatto».
 *
 * Il progetto si risale dal modulo **proprietario** (`moduloProgettoId`): una micro-voce condivisa
 * compare anche in altri moduli, ma resta una riga sola, e il suo proprietario è nella stessa
 * pratica dei moduli che la condividono.
 *
 * È esportata perché serve anche a chi riceve un link per micro-voce: lì bisogna collegare la chat
 * alla pratica **prima** di armare il contesto, e la pratica la dice solo questa risalita.
 */
export async function microvoceDiProgetto(
  tenantId: string,
  microvoceId: string,
  progettoId?: string,
): Promise<{ id: string; progettoId: string; moduloProgettoId: string; nome: string } | null> {
  const mv = await prisma.microvoceProgetto.findFirst({
    where: { id: microvoceId, tenantId },
    select: {
      id: true,
      nome: true,
      moduloProgettoId: true,
      moduloProgetto: { select: { progettoId: true } },
    },
  });
  if (!mv) return null;
  const progettoDellaVoce = mv.moduloProgetto.progettoId;
  if (progettoId && progettoDellaVoce !== progettoId) return null;
  return {
    id: mv.id,
    nome: mv.nome,
    moduloProgettoId: mv.moduloProgettoId,
    progettoId: progettoDellaVoce,
  };
}

export type EsitoAbbinamento =
  | { ok: true; microvoceId: string }
  | { ok: false; motivo: 'comunicazione_non_trovata' | 'microvoce_non_trovata' };

/**
 * Abbina a mano un messaggio a una micro-voce.
 *
 * `upsert` e non `create`: abbinare due volte la stessa coppia è un doppio clic, non un errore, e
 * rispondere con un errore a un doppio clic insegna a non fidarsi del tasto. L'`origine` invece si
 * aggiorna: se l'operatore conferma un abbinamento che il contesto aveva fatto da sé, il legame è
 * ora suo, e dirlo è più onesto che lasciare scritto «contesto».
 */
export async function abbinaManuale(
  tenantId: string,
  progettoId: string,
  comunicazioneId: string,
  microvoceId: string,
): Promise<EsitoAbbinamento> {
  const comunicazione = await prisma.comunicazioneProgetto.findFirst({
    where: { id: comunicazioneId, tenantId, progettoId },
    select: { id: true },
  });
  if (!comunicazione) return { ok: false, motivo: 'comunicazione_non_trovata' };

  const mv = await microvoceDiProgetto(tenantId, microvoceId, progettoId);
  if (!mv) return { ok: false, motivo: 'microvoce_non_trovata' };

  await prisma.comunicazioneMicrovoce.upsert({
    where: {
      comunicazioneId_microvoceProgettoId: { comunicazioneId, microvoceProgettoId: mv.id },
    },
    create: {
      tenantId,
      comunicazioneId,
      microvoceProgettoId: mv.id,
      origine: 'manuale' satisfies OrigineAbbinamento,
    },
    update: { origine: 'manuale' satisfies OrigineAbbinamento },
  });

  return { ok: true, microvoceId: mv.id };
}

/**
 * Toglie un abbinamento. `false` se non c'era.
 *
 * Tutti e tre i filtri sono necessari: `tenantId` per RLS *e* per l'applicazione, `progettoId` perché
 * l'id di un abbinamento non deve poter toccare quello di un'altra pratica, `comunicazioneId` perché
 * un abbinamento appartiene a un messaggio preciso.
 */
export async function rimuoviAbbinamento(
  tenantId: string,
  progettoId: string,
  comunicazioneId: string,
  microvoceId: string,
): Promise<boolean> {
  const comunicazione = await prisma.comunicazioneProgetto.findFirst({
    where: { id: comunicazioneId, tenantId, progettoId },
    select: { id: true },
  });
  if (!comunicazione) return false;

  const esito = await prisma.comunicazioneMicrovoce.deleteMany({
    where: { tenantId, comunicazioneId, microvoceProgettoId: microvoceId },
  });
  return esito.count > 0;
}

export interface MessaggioAbbinato {
  id: string;
  canale: string;
  mittente: string;
  destinatario: string;
  direzione: string;
  testo: string;
  createdAt: Date;
  allegatiJson: string | null;
  origine: string;
  /**
   * Il recapito, proiettato da `proiettaRecapito` esattamente come nel fascicolo.
   *
   * Serve da quando si può **scrivere** da dentro una micro-voce: prima questa vista mostrava solo
   * messaggi arrivati, e per un messaggio arrivato lo stato non è una domanda. Per uno scritto da
   * qui la domanda è la prima cosa che ci si fa — «è partito?» — e una card muta lascerebbe
   * l'operatore a ricaricare il fascicolo per scoprirlo.
   */
  stato: RecapitoComunicazione['stato'];
  inviatoAt: string | null;
  consegnatoAt: string | null;
  lettoAt: string | null;
  errore: string | null;
}

/**
 * I messaggi abbinati a una micro-voce, dal più vecchio al più nuovo.
 *
 * `origine` viaggia con il messaggio e non è un dettaglio tecnico: è ciò che permette all'interfaccia
 * di dire *perché* quel messaggio è lì, e all'operatore di correggere un abbinamento automatico che
 * ha sbagliato invece di subirlo.
 */
export async function elencaComunicazioniMicrovoce(
  tenantId: string,
  microvoceId: string,
): Promise<MessaggioAbbinato[]> {
  const righe = await prisma.comunicazioneMicrovoce.findMany({
    where: { tenantId, microvoceProgettoId: microvoceId },
    select: {
      origine: true,
      comunicazione: {
        select: {
          id: true,
          canale: true,
          mittente: true,
          destinatario: true,
          direzione: true,
          testo: true,
          createdAt: true,
          allegatiJson: true,
          externalId: true,
        },
      },
    },
    orderBy: { comunicazione: { createdAt: 'asc' } },
  });
  return righe.map((r) => {
    // `externalId` non esce da qui: è la colonna da cui si legge lo stato e porta anche le chiavi
    // del provider (`whatsapp:<wamid>`). Il browser riceve il recapito proiettato, non la materia
    // prima.
    const { externalId, ...messaggio } = r.comunicazione;
    return {
      ...messaggio,
      ...proiettaRecapito(messaggio.direzione, externalId, messaggio.createdAt),
      origine: r.origine,
    };
  });
}

/**
 * Abbina i messaggi di una micro-voce, per il badge nella chat: una mappa id → abbinamenti.
 *
 * Una query sola per l'intero fascicolo invece di una per messaggio: la chat si apre spesso e con
 * molti messaggi, e con la RLS ogni query è già cara (è la ragione per cui
 * `comunicazione_progetto` ha preso i suoi indici il 21/09/2026).
 */
export async function mappaAbbinamentiDelProgetto(
  tenantId: string,
  progettoId: string,
): Promise<Map<string, { microvoceId: string; nome: string; origine: string }[]>> {
  const righe = await prisma.comunicazioneMicrovoce.findMany({
    where: { tenantId, comunicazione: { progettoId } },
    select: {
      origine: true,
      comunicazioneId: true,
      microvoceProgetto: { select: { id: true, nome: true } },
    },
  });
  const mappa = new Map<string, { microvoceId: string; nome: string; origine: string }[]>();
  for (const r of righe) {
    const elenco = mappa.get(r.comunicazioneId) ?? [];
    elenco.push({ microvoceId: r.microvoceProgetto.id, nome: r.microvoceProgetto.nome, origine: r.origine });
    mappa.set(r.comunicazioneId, elenco);
  }
  return mappa;
}

export type EsitoArmamento =
  | { ok: true; microvoce: { id: string; nome: string }; progettoId: string; scadeAt: Date }
  | { ok: false; motivo: 'microvoce_non_trovata' };

/**
 * Arma il contesto di una chat: da qui in poi i suoi messaggi si abbinano a questa micro-voce.
 *
 * Chiamata da **due** strade, e sono la stessa cosa: il cliente che tocca il link della micro-voce
 * (`armatoDa: 'link'`) e l'operatore che la sceglie dalla scheda (`armatoDa: 'operatore'`). Chi dei
 * due l'ha armato è registrato perché è una cosa che si vuole poter sapere — un contesto che nessuno
 * ricorda di aver armato è la prima cosa da guardare quando un abbinamento sembra sbagliato.
 *
 * L'`upsert` **sostituisce** il contesto precedente: una chat ne ha uno solo alla volta, come ha un
 * solo collegamento. È anche la via d'uscita da un contesto armato per sbaglio.
 *
 * `progettoId` si scrive qui perché è la micro-voce a dirlo: nessun chiamante deve poter armare un
 * contesto per una pratica diversa da quella della voce, e derivarlo qui toglie la possibilità di
 * sbagliarlo.
 */
export async function armaContesto(
  tenantId: string,
  canale: string,
  chatId: string,
  microvoceId: string,
  armatoDa: ChiArmaContesto,
): Promise<EsitoArmamento> {
  const mv = await microvoceDiProgetto(tenantId, microvoceId);
  if (!mv) return { ok: false, motivo: 'microvoce_non_trovata' };

  const scadeAt = scadenzaContesto();
  const chiave = { tenantId, canale, chatId };
  await prisma.contestoMicrovoceChat.upsert({
    where: { tenantId_canale_chatId: chiave },
    create: { ...chiave, microvoceProgettoId: mv.id, progettoId: mv.progettoId, armatoDa, scadeAt },
    // `armatoAt` si riporta a ora, come `creatoAt` nel collegamento: dice da quando *questo*
    // contesto vale — e, non secondario, fa ripartire il tetto assoluto, perché ri-armare è una
    // decisione nuova presa da una persona.
    update: {
      microvoceProgettoId: mv.id,
      progettoId: mv.progettoId,
      armatoDa,
      armatoAt: new Date(),
      scadeAt,
    },
  });

  return { ok: true, microvoce: { id: mv.id, nome: mv.nome }, progettoId: mv.progettoId, scadeAt };
}

/** La parte di `tx` che serve a disarmare un contesto. */
export type TxContesto = {
  contestoMicrovoceChat: {
    deleteMany: (args: Prisma.ContestoMicrovoceChatDeleteManyArgs) => Promise<{ count: number }>;
  };
};

/**
 * Disarma il contesto di una chat. `false` se non ce n'era uno.
 *
 * Il `tx` è opzionale e la ragione è concreta: la rotta del tasto «disarma» scrive da sola e usa il
 * client normale (il contesto tenant lo mette la richiesta), mentre i percorsi che **cambiano il
 * collegamento** di una chat devono togliere il contesto nella stessa transazione che sposta il
 * collegamento. Sono la stessa scrittura, quindi è la stessa funzione: se il collegamento si sposta
 * e il contesto no, resta una finestra in cui la chat è nella pratica nuova con addosso l'etichetta
 * vecchia — e la prima cosa che ci scrive dentro nasce abbinata a una micro-voce che non c'entra.
 */
export async function disarmaContesto(
  tenantId: string,
  canale: string,
  chatId: string,
  tx: TxContesto = prisma,
): Promise<boolean> {
  const esito = await tx.contestoMicrovoceChat.deleteMany({ where: { tenantId, canale, chatId } });
  return esito.count > 0;
}

export interface ContestoArmato {
  id: string;
  canale: string;
  chatId: string;
  armatoDa: string;
  armatoAt: Date;
  scadeAt: Date | null;
  microvoce: { id: string; nome: string };
}

export interface ChatDelProgetto {
  canale: string;
  chatId: string;
  /**
   * Come si legge quella conversazione, quando l'identificativo da solo non basta.
   *
   * Serve a una cosa sola, e non è cosmetica: sul **portale** il `chatId` è l'id del cliente, e
   * mostrarlo tale e quale metterebbe un uuid davanti all'operatore nel momento esatto in cui deve
   * scegliere su quale conversazione armare il contesto. Sugli altri canali l'identificativo *è*
   * la cosa leggibile — un numero, un id di chat — e resta `null`.
   */
  nome: string | null;
  ultimoMessaggioAt: Date;
  messaggi: number;
}

/**
 * Le chat da cui è arrivato qualcosa in questa pratica: canale e identificativo, dal più recente.
 *
 * Serve a una cosa sola, e vale la pena dire perché è necessaria. L'operatore può armare il contesto
 * su qualunque canale, ma per farlo deve poter **nominare** la chat — e su WhatsApp e Signal non
 * esiste nessun elenco di chat collegate: il collegamento è una cosa di Telegram. L'unica traccia di
 * una conversazione WhatsApp è il numero su cui il cliente ha scritto, che sta su
 * `comunicazione_progetto.chat_id`. Quindi l'elenco delle chat di una pratica *è* un'aggregazione dei
 * suoi messaggi, e non una tabella in più da tenere allineata.
 *
 * Raggruppata per `(canale, chatId)` e non per solo `chatId`: lo stesso numero su due canali sono due
 * conversazioni diverse, con due contesti diversi.
 */
export async function elencaChatDelProgetto(
  tenantId: string,
  progettoId: string,
): Promise<ChatDelProgetto[]> {
  const righe = await prisma.comunicazioneProgetto.groupBy({
    by: ['canale', 'chatId'],
    where: { tenantId, progettoId, chatId: { not: null } },
    _max: { createdAt: true },
    _count: { _all: true },
    orderBy: { _max: { createdAt: 'desc' } },
  });
  const chat: ChatDelProgetto[] = righe
    .filter((r): r is typeof r & { chatId: string; _max: { createdAt: Date } } => r.chatId !== null)
    .map((r) => ({
      canale: r.canale,
      chatId: r.chatId,
      nome: null,
      ultimoMessaggioAt: r._max.createdAt,
      messaggi: r._count._all,
    }));

  // Sul portale il `chatId` è un id di cliente, e un id di cliente non si legge. Una query sola per
  // tutte le conversazioni del portale della pratica — che è una, perché una pratica ha un cliente:
  // il `where` sul tenant non è decorativo, perché quei `chatId` arrivano dai messaggi.
  const idClienti = chat.filter((c) => c.canale === 'portal').map((c) => c.chatId);
  if (idClienti.length > 0) {
    const clienti = await prisma.cliente.findMany({
      where: { tenantId, id: { in: idClienti } },
      select: { id: true, nome: true },
    });
    const nomePerId = new Map(clienti.map((c) => [c.id, c.nome]));
    for (const c of chat) {
      if (c.canale === 'portal') c.nome = nomePerId.get(c.chatId) ?? null;
    }
  }

  return chat;
}

/** I contesti armati di una pratica, per mostrarli (e disarmarli) nell'interfaccia. */
export async function elencaContestiProgetto(
  tenantId: string,
  progettoId: string,
): Promise<ContestoArmato[]> {
  const righe = await prisma.contestoMicrovoceChat.findMany({
    // Filtro sul `progettoId` della riga e non sulla risalita `microvoce → modulo → progetto`:
    // è lo stesso insieme — la colonna è la pratica di quella micro-voce — con un indice che serve
    // a qualcosa e senza una join.
    where: { tenantId, progettoId },
    select: {
      id: true,
      canale: true,
      chatId: true,
      armatoDa: true,
      armatoAt: true,
      scadeAt: true,
      microvoceProgetto: { select: { id: true, nome: true } },
    },
    orderBy: { armatoAt: 'desc' },
  });
  return righe.map((r) => ({
    id: r.id,
    canale: r.canale,
    chatId: r.chatId,
    armatoDa: r.armatoDa,
    armatoAt: r.armatoAt,
    scadeAt: r.scadeAt,
    microvoce: r.microvoceProgetto,
  }));
}
