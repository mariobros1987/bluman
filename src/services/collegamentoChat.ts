/**
 * Il collegamento fra la chat di un canale e una pratica.
 *
 * Perché esiste. L'instradamento dei messaggi in ingresso era un'euristica a due cancelli: il
 * `chat_id` doveva stare in **una sola** scheda cliente, e quel cliente doveva avere **un solo**
 * progetto aperto. Quando una delle due condizioni cadeva — e nella realtà degli studi cade spesso:
 * un cliente con due pratiche aperte, una persona che scrive per due clienti — il messaggio non
 * poteva entrare in nessun fascicolo e diventava un avviso. Non era un difetto della prudenza:
 * mancava il modo per cui **il cliente dice lui** a quale pratica si riferisce.
 *
 * Quel modo è il link per progetto (`t.me/<Bot>?start=<payload>`). Chi lo tocca manda al bot un
 * `/start` con un payload firmato, e da lì il collegamento è un fatto in tabella invece di una
 * deduzione. Le due euristiche restano, ma come ripiego per chi scrive senza aver mai toccato un
 * link.
 *
 * La chiave unica è sulla chat (`tenantId`, `canale`, `chatId`): una chat scrive in una sola
 * pratica, e un secondo `/start` dalla stessa chat **sposta** il collegamento — è anche la via
 * d'uscita se il cliente ha toccato il link sbagliato. Più chat possono puntare alla stessa
 * pratica.
 */
import { prisma } from '../util/prismaClient.js';

/**
 * Una pratica che non accetta più messaggi.
 *
 * **Non** è `isProgettoAttivo`, e la differenza conta. `isProgettoAttivo` significa «in corso»
 * (`in_progress`): serve all'euristica di ripiego, dove fra più pratiche bisogna scegliere la più
 * stretta, e una pratica appena creata non è ancora «in corso». Qui la domanda è un'altra — «questa
 * pratica è chiusa?» — e una pratica `pre_project` non lo è: è la pratica nuova, che è esattamente
 * quella per cui si manda il link. Chiusa è solo una pratica conclusa o archiviata.
 */
export function progettoChiuso(stato: string): boolean {
  return stato === 'completed' || stato === 'archived';
}

export type EsitoCollegamento =
  | { ok: true; progetto: { id: string; nome: string }; cliente: { id: string; nome: string } }
  | { ok: false; motivo: 'progetto_non_trovato' }
  | { ok: false; motivo: 'progetto_chiuso'; stato: string };

/**
 * Aggancia una chat a una pratica, o sposta il collegamento che c'era.
 *
 * La pratica dev'essere **dello studio** e non chiusa. Il controllo del tenant non è ridondante
 * rispetto a RLS: RLS garantisce che non si *legga* la pratica di un altro studio, e questa lettura
 * filtrata è ciò che rende impossibile collegarsi a essa — un collegamento creato verso un progetto
 * che non si vede non deve poter esistere.
 *
 * Rifiutare una pratica chiusa è deliberato: è meglio che il cliente lo sappia subito, toccando il
 * link, invece di scrivere in una pratica conclusa e non vedere arrivare nulla.
 *
 * Torna i nomi oltre agli identificativi perché chi risponde al cliente deve poter nominare la
 * pratica: una seconda lettura per una riga che si è appena letta sarebbe un giro di rete inutile
 * dentro il webhook, che ha un tempo di risposta da rispettare.
 */
export async function collegaChatAProgetto(
  tenantId: string,
  canale: string,
  chatId: string,
  progettoId: string,
  creatoDa: string = 'link',
): Promise<EsitoCollegamento> {
  const progetto = await prisma.progetto.findFirst({
    where: { id: progettoId, tenantId },
    select: { id: true, nome: true, stato: true, cliente: { select: { id: true, nome: true } } },
  });
  if (!progetto) return { ok: false, motivo: 'progetto_non_trovato' };
  if (progettoChiuso(progetto.stato)) return { ok: false, motivo: 'progetto_chiuso', stato: progetto.stato };

  const chiave = { tenantId, canale, chatId };
  await prisma.collegamentoChatProgetto.upsert({
    where: { tenantId_canale_chatId: chiave },
    create: { ...chiave, clienteId: progetto.cliente.id, progettoId: progetto.id, creatoDa },
    // `creatoAt` si riporta a ora: il campo dice da quando *questo* collegamento vale, e dopo uno
    // spostamento il collegamento è un altro.
    update: {
      clienteId: progetto.cliente.id,
      progettoId: progetto.id,
      creatoDa,
      creatoAt: new Date(),
    },
  });

  return {
    ok: true,
    progetto: { id: progetto.id, nome: progetto.nome },
    cliente: progetto.cliente,
  };
}

export interface FascicoloCollegato {
  collegamentoId: string;
  cliente: { id: string; nome: string };
  progetto: { id: string; nome: string; stato: string };
}

/**
 * Il fascicolo a cui appartiene una chat, se è collegata.
 *
 * Una query sola con le relazioni incluse: la rotta webhook la chiama a ogni messaggio in ingresso,
 * e due letture separate per una cosa sola sarebbero due giri di rete per messaggio.
 */
export async function risolviFascicoloDaChat(
  tenantId: string,
  canale: string,
  chatId: string,
): Promise<FascicoloCollegato | null> {
  const collegamento = await prisma.collegamentoChatProgetto.findUnique({
    where: { tenantId_canale_chatId: { tenantId, canale, chatId } },
    select: {
      id: true,
      cliente: { select: { id: true, nome: true } },
      progetto: { select: { id: true, nome: true, stato: true } },
    },
  });
  if (!collegamento) return null;
  return {
    collegamentoId: collegamento.id,
    cliente: collegamento.cliente,
    progetto: collegamento.progetto,
  };
}

export interface CollegamentoElenco {
  id: string;
  canale: string;
  chatId: string;
  creatoAt: Date;
  creatoDa: string;
}

/** Le chat collegate a una pratica, per mostrarle (e revocarle) nell'interfaccia. */
export async function elencaCollegamentiProgetto(
  tenantId: string,
  progettoId: string,
): Promise<CollegamentoElenco[]> {
  return prisma.collegamentoChatProgetto.findMany({
    where: { tenantId, progettoId },
    select: { id: true, canale: true, chatId: true, creatoAt: true, creatoDa: true },
    orderBy: { creatoAt: 'desc' },
  });
}

/**
 * Revoca un collegamento. `false` se non esisteva (o non era di quella pratica).
 *
 * Il `progettoId` nella `where` non è decorativo: senza, l'identificativo di un collegamento
 * basterebbe a revocare quello di un'altra pratica dello stesso studio, e la rotta risponderebbe
 * «fatto» avendo cancellato qualcos'altro.
 *
 * `deleteMany` invece di `delete` perché l'assenza non è un'eccezione da tradurre: è una risposta.
 */
export async function scollegaPerId(
  tenantId: string,
  progettoId: string,
  collegamentoId: string,
): Promise<boolean> {
  const esito = await prisma.collegamentoChatProgetto.deleteMany({
    where: { id: collegamentoId, tenantId, progettoId },
  });
  return esito.count > 0;
}
