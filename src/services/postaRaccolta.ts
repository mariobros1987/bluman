/**
 * Accentratore delle mail — il giro di raccolta: dalle caselle IMAP al database.
 *
 * Per ogni casella attiva dello studio: si apre in sola lettura, si leggono i messaggi arrivati
 * dopo il segnalibro (`ultimoUid`), si salvano con il loro cliente e i loro allegati, si sposta
 * il segnalibro. Tutto gira con il `prisma` del tenant corrente: dentro una richiesta («Raccogli
 * ora») o dentro `contestoTenant.run` (il giro automatico, `scripts/raccogliPosta.ts`).
 *
 * Tre scelte che non si vedono dal codice:
 *
 * - **il segnalibro avanza un messaggio alla volta**, dopo il salvataggio. Se il giro si
 *   interrompe (rete, database), il prossimo riparte dal primo messaggio non salvato: nessun
 *   messaggio saltato, e l'indice unico `(casella, uidValidity, uid)` impedisce i doppioni;
 * - **un allegato non salvabile non ferma il messaggio**: resta la riga con il motivo
 *   (`motivoNonSalvato`), così l'operatore sa che c'era e lo chiede al cliente;
 * - **l'errore di una casella resta scritto sulla casella** (`ultimoErrore`), già spiegato: una
 *   raccolta ferma non deve sembrare «nessun messaggio nuovo» (regola 13).
 */
import { prisma } from '../util/prismaClient.js';
import { cifraSegreto, decifraSegreto } from '../util/cifraturaSegreti.js';
import { spiegaErrorePosta } from './diagnosiPosta.js';
import { uploadDocumento } from './storageService.js';
import { attribuisciMessaggio, type ClientePerPosta, type EsitoAttribuzione } from './postaAttribuzione.js';
import { lettoreImap, type AccessoCasella, type AllegatoGrezzo, type LettoreCasella, type MessaggioGrezzo } from './postaImap.js';

export const AMBITO_PASSWORD_CASELLA = 'casella-posta';

/** Messaggi salvati per casella in un giro: un arretrato lungo si smaltisce in più giri. */
export const MAX_MESSAGGI_PER_GIRO = 50;
export const MAX_ALLEGATI_PER_MESSAGGIO = 20;
export const MAX_ALLEGATO_BYTE = 15 * 1024 * 1024;
const GIORNI_PRIMA_LETTURA = 30;
const MAX_CARATTERI_TESTO = 200_000;
const MAX_CARATTERI_HTML = 500_000;

export interface EsitoCasella {
  casellaId: string;
  nome: string;
  ok: boolean;
  nuovi: number;
  errore?: string;
}

export interface EsitoRaccolta {
  caselle: EsitoCasella[];
  nuovi: number;
}

export interface DipendenzeRaccolta {
  creaLettore?: (accesso: AccessoCasella) => LettoreCasella;
  carica?: typeof uploadDocumento;
  adesso?: Date;
}

interface RigaCasella {
  id: string;
  tenantId: string;
  nome: string;
  host: string;
  servername: string | null;
  porta: number;
  utente: string;
  passwordCifrata: string | null;
  cartella: string;
  tipo: string;
  clienteId: string | null;
  raccogliDal: Date | null;
  uidValidity: string | null;
  ultimoUid: number;
}

/** Caselle con un giro in corso in questo processo: «Raccogli ora» non si accavalla al giro automatico. */
const inCorso = new Set<string>();

function messaggioErrore(err: unknown, casella: RigaCasella): string {
  const e = err as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
  if (e?.authenticationFailed) {
    return `${casella.host} ha rifiutato utenza o password della casella «${casella.nome}»: reinserisci la password in Posta → Configurazione.`;
  }
  const tecnico = `${e?.code ? `${e.code}: ` : ''}${e?.responseText || e?.message || 'errore non riportato'}`;
  return spiegaErrorePosta({ protocollo: 'IMAP', host: casella.host, porta: casella.porta, messaggio: tecnico, codice: e?.code });
}

function taglia(valore: string | null, massimo: number): string | null {
  if (!valore) return null;
  // Il byte NUL non è ammesso in una colonna di testo di Postgres: un solo messaggio che lo
  // contiene farebbe fallire il salvataggio e fermerebbe il segnalibro su di lui.
  const pulito = valore.replace(/\u0000/g, '');
  return pulito.length > massimo ? pulito.slice(0, massimo) : pulito;
}

async function salvaAllegato(
  lettore: LettoreCasella,
  carica: typeof uploadDocumento,
  casella: RigaCasella,
  messaggioId: string,
  uid: number,
  allegato: AllegatoGrezzo,
): Promise<void> {
  let url: string | null = null;
  let motivo: string | null = null;
  let dimensione = allegato.dimensioneByte;

  try {
    const contenuto = await lettore.scaricaAllegato(uid, allegato.parte, MAX_ALLEGATO_BYTE);
    if (contenuto === null) {
      motivo = `supera ${MAX_ALLEGATO_BYTE / (1024 * 1024)} MB`;
    } else {
      dimensione = contenuto.length;
      const esito = await carica(allegato.nome, `data:${allegato.mime};base64,${contenuto.toString('base64')}`, casella.tenantId);
      url = esito.url;
    }
  } catch (err) {
    // Tipo di file non ammesso (`scanFileBuffer`), file vuoto, archivio irraggiungibile: il
    // motivo è quello che ha dato chi ha rifiutato.
    motivo = err instanceof Error ? err.message : 'salvataggio non riuscito';
  }

  await prisma.allegatoPosta.create({
    data: {
      tenantId: casella.tenantId,
      messaggioId,
      nome: taglia(allegato.nome, 255) || 'allegato',
      mime: allegato.mime,
      dimensioneByte: dimensione,
      url,
      motivoNonSalvato: url ? null : motivo || 'salvataggio non riuscito',
    },
  });
}

/** Salva un messaggio con i suoi allegati. `false` se c'era già (stesso UID, o stesso Message-ID nella casella). */
async function salvaMessaggio(
  lettore: LettoreCasella,
  carica: typeof uploadDocumento,
  casella: RigaCasella,
  uidValidity: string,
  grezzo: MessaggioGrezzo,
  clienti: ClientePerPosta[],
  adesso: Date,
): Promise<boolean> {
  if (grezzo.messageId) {
    // Dopo un cambio di UIDVALIDITY il server rinumera tutto: il Message-ID è ciò che resta uguale.
    // Solo contro le righe della numerazione vecchia: con la stessa numerazione due copie dello
    // stesso messaggio sono due consegne vere (due clienti che inoltrano la stessa comunicazione).
    const gia = await prisma.messaggioPosta.findFirst({
      where: { tenantId: casella.tenantId, casellaId: casella.id, messageId: grezzo.messageId, uidValidity: { not: uidValidity } },
      select: { id: true },
    });
    if (gia) return false;
  }

  // La casella di un cliente è tutta sua: non c'è niente da riconoscere. Su quella di raccolta
  // decide `attribuisciMessaggio` (alias, destinatario, mittente).
  const attribuzione: EsitoAttribuzione =
    casella.tipo === 'cliente' && casella.clienteId
      ? { clienteId: casella.clienteId, attribuzione: 'automatica', criterio: null, consegnatoA: null }
      : attribuisciMessaggio({ intestazioni: grezzo.intestazioni, mittenteEmail: grezzo.mittenteEmail, clienti });

  const allegati = grezzo.allegati.slice(0, MAX_ALLEGATI_PER_MESSAGGIO);
  let creato: { id: string };
  try {
    creato = await prisma.messaggioPosta.create({
      data: {
        tenantId: casella.tenantId,
        casellaId: casella.id,
        uid: grezzo.uid,
        uidValidity,
        messageId: taglia(grezzo.messageId, 990),
        mittenteEmail: grezzo.mittenteEmail,
        mittenteNome: taglia(grezzo.mittenteNome, 255),
        destinatari: taglia(grezzo.destinatari, 2000),
        oggetto: taglia(grezzo.oggetto, 990),
        testo: taglia(grezzo.testo, MAX_CARATTERI_TESTO),
        html: taglia(grezzo.html, MAX_CARATTERI_HTML),
        // Senza data nel messaggio vale il momento della raccolta: una data assente lo
        // toglierebbe da ogni elenco ordinato per data.
        ricevutoAt: grezzo.data ?? adesso,
        clienteId: attribuzione.clienteId,
        attribuzione: attribuzione.attribuzione,
        criterio: casella.tipo === 'cliente' ? 'casella' : attribuzione.criterio,
        consegnatoA: attribuzione.consegnatoA,
        haAllegati: allegati.length > 0,
      },
      select: { id: true },
    });
  } catch (err: any) {
    // Lo stesso UID salvato da un giro concorrente (due processi): non è un errore.
    if (err?.code === 'P2002') return false;
    throw err;
  }

  for (const allegato of allegati) {
    await salvaAllegato(lettore, carica, casella, creato.id, grezzo.uid, allegato);
  }
  return true;
}

async function raccogliCasella(casella: RigaCasella, clienti: ClientePerPosta[], dip: Required<DipendenzeRaccolta>): Promise<EsitoCasella> {
  const esito: EsitoCasella = { casellaId: casella.id, nome: casella.nome, ok: false, nuovi: 0 };
  if (inCorso.has(casella.id)) return { ...esito, ok: true };
  inCorso.add(casella.id);

  let lettore: LettoreCasella | null = null;
  try {
    if (casella.tipo === 'cliente' && !casella.clienteId) {
      throw new Error(`Il cliente della casella «${casella.nome}» non c'è più: scollegala da Posta → Configurazione.`);
    }
    if (!casella.passwordCifrata) {
      throw new Error(`La casella «${casella.nome}» non ha una password salvata: inseriscila in Posta → Configurazione.`);
    }
    let aperto: ReturnType<typeof decifraSegreto>;
    try {
      aperto = decifraSegreto(casella.passwordCifrata, AMBITO_PASSWORD_CASELLA);
    } catch {
      throw new Error(`La password della casella «${casella.nome}» non si legge più con le chiavi di questo ambiente: reinseriscila in Posta → Configurazione.`);
    }
    const password = aperto.chiaro;
    // Aperta con una chiave precedente (rotazione di JWT_SECRET): si riscrive con quella corrente.
    // Fuori dal `try` qui sopra: se la scrittura fallisce è un errore del database, non della password.
    if (aperto.daRicifrare) {
      await prisma.casellaPosta.update({
        where: { id: casella.id },
        data: { passwordCifrata: cifraSegreto(password, AMBITO_PASSWORD_CASELLA) },
      });
    }

    lettore = dip.creaLettore({
      host: casella.host,
      servername: casella.servername,
      porta: casella.porta,
      utente: casella.utente,
      password,
      cartella: casella.cartella,
    });

    let aperta: { uidValidity: string; uidNext: number };
    let daLeggere: number[];
    let ultimoUid = casella.ultimoUid;
    try {
      aperta = await lettore.apri();
      // UIDVALIDITY diversa: il server ha rinumerato la cartella, il segnalibro non vale più.
      const primaLettura = !casella.uidValidity || casella.uidValidity !== aperta.uidValidity || ultimoUid === 0;
      if (primaLettura) {
        ultimoUid = 0;
        const dal = casella.raccogliDal ?? new Date(dip.adesso.getTime() - GIORNI_PRIMA_LETTURA * 24 * 60 * 60 * 1000);
        daLeggere = await lettore.uidDal(dal);
        // Niente nel periodo: il segnalibro va comunque all'ultimo messaggio presente, altrimenti
        // ogni giro rifarebbe la ricerca per data e una casella vecchia non partirebbe mai.
        if (daLeggere.length === 0) ultimoUid = Math.max(0, aperta.uidNext - 1);
      } else {
        daLeggere = await lettore.uidDopo(ultimoUid);
      }
    } catch (err) {
      throw new Error(messaggioErrore(err, casella));
    }

    await prisma.casellaPosta.update({
      where: { id: casella.id },
      data: { uidValidity: aperta.uidValidity, ultimoUid },
    });

    for (const uid of daLeggere.slice(0, MAX_MESSAGGI_PER_GIRO)) {
      let grezzo: MessaggioGrezzo | null;
      try {
        grezzo = await lettore.leggi(uid);
      } catch (err) {
        throw new Error(`messaggio ${uid}: ${messaggioErrore(err, casella)}`);
      }
      // `null`: cancellato fra la ricerca e la lettura. Il segnalibro lo supera lo stesso.
      if (grezzo && (await salvaMessaggio(lettore, dip.carica, casella, aperta.uidValidity, grezzo, clienti, dip.adesso))) {
        esito.nuovi += 1;
      }
      ultimoUid = uid;
      await prisma.casellaPosta.update({ where: { id: casella.id }, data: { ultimoUid } });
    }

    await prisma.casellaPosta.update({
      where: { id: casella.id },
      data: { ultimaRaccoltaAt: dip.adesso, ultimoSuccessoAt: dip.adesso, ultimoErrore: null },
    });
    esito.ok = true;
  } catch (err) {
    esito.errore = err instanceof Error ? err.message : 'errore non riportato';
    try {
      await prisma.casellaPosta.update({
        where: { id: casella.id },
        data: { ultimaRaccoltaAt: dip.adesso, ultimoErrore: esito.errore.slice(0, 2000) },
      });
    } catch (errScrittura) {
      // L'errore della raccolta resta nell'esito restituito; qui si dichiara che non è stato
      // possibile scriverlo sulla casella (database irraggiungibile).
      console.error(`[posta] casella ${casella.id}: errore non registrato sulla casella:`, errScrittura);
    }
  } finally {
    inCorso.delete(casella.id);
    if (lettore) await lettore.chiudi();
  }
  return esito;
}

/** Raccoglie la posta di tutte le caselle attive dello studio, una dopo l'altra. */
export async function raccogliPostaDelTenant(tenantId: string, dipendenze: DipendenzeRaccolta = {}): Promise<EsitoRaccolta> {
  const dip: Required<DipendenzeRaccolta> = {
    creaLettore: dipendenze.creaLettore ?? lettoreImap,
    carica: dipendenze.carica ?? uploadDocumento,
    adesso: dipendenze.adesso ?? new Date(),
  };

  const caselle = await prisma.casellaPosta.findMany({
    where: { tenantId, attiva: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, tenantId: true, nome: true, host: true, servername: true, porta: true, utente: true,
      passwordCifrata: true, cartella: true, tipo: true, clienteId: true, raccogliDal: true,
      uidValidity: true, ultimoUid: true,
    },
  });
  if (caselle.length === 0) return { caselle: [], nuovi: 0 };

  // Una volta per giro, non per messaggio: l'attribuzione è pura e riceve l'elenco già pronto.
  const clienti = await prisma.cliente.findMany({
    where: { tenantId },
    select: { id: true, email: true, aliasPosta: true },
  });

  const esiti: EsitoCasella[] = [];
  for (const casella of caselle) {
    esiti.push(await raccogliCasella(casella, clienti, dip));
  }
  return { caselle: esiti, nuovi: esiti.reduce((somma, e) => somma + e.nuovi, 0) };
}
