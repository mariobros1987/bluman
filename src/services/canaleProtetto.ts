// Il canale protetto studio ↔ cliente: i messaggi del portale (`canale: 'portal'` del fascicolo)
// e i loro allegati.
//
// Tre cose lo distinguono dagli altri canali del fascicolo (email, WhatsApp, Telegram, Signal),
// che per loro natura passano da fornitori esterni:
//  1. testo ed elenco degli allegati stanno a database cifrati (`cifraturaCanale.ts`);
//  2. gli allegati stanno in archivio cifrati e si scaricano solo da una rotta autenticata che
//     controlla pratica e cliente — non esiste un link che, girato a un terzo, apra il file;
//  3. le notifiche dicono che c'è un messaggio, non cosa dice.
//
// Qui c'è tutto ciò che legge e scrive quel contenuto: le rotte chiamano queste funzioni e non
// toccano mai `testo`/`allegatiJson` di un messaggio del portale direttamente.
import { createHash, randomBytes } from 'node:crypto';
import { ErroreCifratura, cifraFile, cifraTesto, decifraFile, decifraTesto, eTestoCifrato } from './cifraturaCanale.js';
import { scanFileBuffer } from './securityScanner.js';
import {
  decodificaBase64Documento,
  leggiFileArchivio,
  mimeDaEstensione,
  riferimentoArchivio,
  salvaBufferInArchivio,
} from './storageService.js';

export const CANALE_PROTETTO = 'portal';

/** Tetti del canale: un messaggio porta pochi file, ognuno entro il limite che il portale dichiara. */
export const MASSIMO_ALLEGATI_PER_MESSAGGIO = 5;
export const MASSIMO_BYTE_ALLEGATO = 15 * 1024 * 1024;

/** Un allegato rifiutato, con il motivo da mostrare a chi lo ha mandato. */
export class ErroreAllegato extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = 'ErroreAllegato';
  }
}

export interface AllegatoInArrivo {
  nome: string;
  contentBase64: string;
}

/** Com'è scritto un allegato protetto dentro `allegatiJson` (cifrato): mai mandato al browser. */
interface AllegatoArchiviato {
  protetto: true;
  nome: string;
  dimensione: string;
  mime: string;
  /** Dove sta il contenuto in archivio. Resta sul server. */
  oggetto: string;
  sha256: string;
  /** Falso quando il file è stato scritto senza chiave configurata: si legge senza decifrare. */
  cifrato: boolean;
}

function ambitoMessaggi(progettoId: string): string {
  return `msg:${progettoId}`;
}

function ambitoFile(progettoId: string): string {
  return `file:${progettoId}`;
}

function eAllegatoArchiviato(valore: unknown): valore is AllegatoArchiviato {
  return Boolean(valore) && typeof valore === 'object'
    && (valore as AllegatoArchiviato).protetto === true
    && typeof (valore as AllegatoArchiviato).oggetto === 'string';
}

function dimensioneLeggibile(byte: number): string {
  return byte >= 1024 * 1024 ? `${(byte / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(byte / 1024))} KB`;
}

/**
 * Controlla, cifra e archivia gli allegati di un messaggio del canale protetto.
 *
 * Il controllo di sicurezza si fa sul contenuto in chiaro, prima di cifrare: dopo, lo scanner
 * vedrebbe solo rumore. In archivio il file ha un nome che non dice niente (studio, istante, un
 * codice a caso): il nome vero sta nei metadati, cifrati col messaggio.
 */
export async function archiviaAllegatiProtetti(
  tenantId: string,
  progettoId: string,
  allegati: AllegatoInArrivo[],
): Promise<AllegatoArchiviato[]> {
  if (allegati.length > MASSIMO_ALLEGATI_PER_MESSAGGIO) {
    throw new ErroreAllegato(`Un messaggio può portare al massimo ${MASSIMO_ALLEGATI_PER_MESSAGGIO} allegati.`);
  }
  const archiviati: AllegatoArchiviato[] = [];
  for (const allegato of allegati) {
    const nome = String(allegato?.nome ?? '').trim().slice(0, 200);
    if (!nome) throw new ErroreAllegato('Un allegato non ha il nome del file.');
    let contenuto: Buffer;
    try {
      contenuto = decodificaBase64Documento(String(allegato?.contentBase64 ?? ''));
    } catch {
      throw new ErroreAllegato(`«${nome}» non è arrivato integro: riprova a caricarlo.`);
    }
    if (contenuto.length > MASSIMO_BYTE_ALLEGATO) {
      throw new ErroreAllegato(`«${nome}» supera il limite di 15 MB per gli allegati dei messaggi.`);
    }
    const scansione = scanFileBuffer(contenuto, nome);
    if (!scansione.safe) throw new ErroreAllegato(`«${nome}» non è stato accettato: ${scansione.reason ?? 'tipo di file non ammesso'}.`);

    const protetto = cifraFile(tenantId, ambitoFile(progettoId), contenuto);
    const nomeOggetto = `${tenantId}_${Date.now()}_${randomBytes(16).toString('hex')}_protetto.bin`;
    const url = await salvaBufferInArchivio(nomeOggetto, protetto.contenuto, 'application/octet-stream');
    archiviati.push({
      protetto: true,
      nome,
      dimensione: dimensioneLeggibile(contenuto.length),
      mime: mimeDaEstensione(nome),
      oggetto: riferimentoArchivio(nomeOggetto, url),
      sha256: createHash('sha256').update(contenuto).digest('hex'),
      cifrato: protetto.cifrato,
    });
  }
  return archiviati;
}

/** Gli allegati già caricati per altra via (elenco con `url`), come li mandano i client esistenti. */
function allegatiDichiarati(allegatiJson: unknown): unknown[] {
  if (allegatiJson == null || allegatiJson === '') return [];
  let valore: unknown = allegatiJson;
  if (typeof valore === 'string') {
    try { valore = JSON.parse(valore); } catch { return []; }
  }
  if (Array.isArray(valore)) return valore;
  return valore && typeof valore === 'object' ? [valore] : [];
}

/**
 * Testo e allegati come vanno scritti nella riga di un messaggio del canale protetto.
 * `allegatiJson` è l'elenco già dichiarato dal client (file caricati per altra via), `archiviati`
 * quelli appena passati da `archiviaAllegatiProtetti`.
 */
export function contenutoDaScrivere(
  tenantId: string,
  progettoId: string,
  dati: { testo: string; allegatiJson?: unknown; archiviati?: AllegatoArchiviato[] },
): { testo: string; allegatiJson: string | null } {
  const ambito = ambitoMessaggi(progettoId);
  const allegati = [...allegatiDichiarati(dati.allegatiJson), ...(dati.archiviati ?? [])];
  return {
    testo: cifraTesto(tenantId, ambito, dati.testo),
    allegatiJson: allegati.length > 0 ? cifraTesto(tenantId, ambito, JSON.stringify(allegati)) : null,
  };
}

/**
 * Tutto ciò che serve prima di scrivere la riga di un messaggio del canale protetto: archivia gli
 * allegati (cifrati) e cifra testo ed elenco. Lancia `ErroreAllegato` per un file rifiutato ed
 * `ErroreCifratura` se la chiave è configurata male: in entrambi i casi niente è stato scritto a
 * database.
 */
export async function preparaMessaggioProtetto(
  tenantId: string,
  progettoId: string,
  dati: { testo: string; allegatiJson?: unknown; allegatiProtetti?: AllegatoInArrivo[] | null },
): Promise<{ testo: string; allegatiJson: string | null; conAllegati: boolean }> {
  // Prima il testo: se la chiave non va, lo si scopre senza aver già lasciato file in archivio.
  cifraTesto(tenantId, ambitoMessaggi(progettoId), '');
  const archiviati = await archiviaAllegatiProtetti(tenantId, progettoId, dati.allegatiProtetti ?? []);
  const contenuto = contenutoDaScrivere(tenantId, progettoId, { testo: dati.testo, allegatiJson: dati.allegatiJson, archiviati });
  return { ...contenuto, conAllegati: contenuto.allegatiJson !== null };
}

/**
 * Come rispondere a chi ha provato a scrivere quando il canale ha rifiutato. `null` per un errore
 * che non è del canale (va rilanciato). Al cliente non si dice il nome della variabile sbagliata:
 * non è cosa sua, e il dettaglio resta nel log del server.
 */
export function rispostaAErroreCanale(err: unknown, perIlCliente: boolean): { stato: number; errore: string } | null {
  if (err instanceof ErroreAllegato) return { stato: 400, errore: err.message };
  if (err instanceof ErroreCifratura) {
    return {
      stato: 503,
      errore: perIlCliente
        ? 'Il canale protetto non accetta messaggi in questo momento per un problema di configurazione del server. Il messaggio non è stato salvato.'
        : `Messaggio non salvato. ${err.message}`,
    };
  }
  return null;
}

/** Canale, testo e allegati di un messaggio in arrivo su `POST /progetti/:id/comunicazioni`. */
export interface IngressoMessaggio {
  canale: string;
  protetto: boolean;
  testo: string;
  allegatiProtetti: AllegatoInArrivo[];
}

/**
 * Legge dal corpo della richiesta in quale canale va il messaggio e con cosa. Dal portale si scrive
 * solo nel canale protetto: prima il cliente poteva scegliere «email» o «WhatsApp» e la riga
 * nasceva come se fosse arrivata da lì, senza essere mai passata da lì. Nel canale protetto un file
 * può viaggiare da solo; altrove il testo resta obbligatorio e gli allegati protetti non si accettano.
 */
export function ingressoMessaggio(
  body: { canale?: string | null; testo?: string | null; allegatiProtetti?: AllegatoInArrivo[] | null },
  dalCliente: boolean,
): IngressoMessaggio | { errore: string } {
  const canale = dalCliente ? CANALE_PROTETTO : (body.canale ?? '').trim().slice(0, 50);
  const protetto = canale === CANALE_PROTETTO;
  const ricevuti = body.allegatiProtetti ?? [];
  const testo = (body.testo ?? '').trim();
  if (!canale || (!testo && !(protetto && ricevuti.length > 0))) return { errore: 'Canale e testo sono obbligatori.' };
  if (!protetto && ricevuti.length > 0) return { errore: 'Gli allegati protetti si mandano solo nel canale del portale.' };
  return { canale, protetto, testo, allegatiProtetti: protetto ? ricevuti : [] };
}

/**
 * Il contenuto del messaggio come va scritto a database. Nel canale protetto: allegati cifrati in
 * archivio, testo ed elenco cifrati nella riga; gli allegati «dichiarati» dal cliente (un elenco di
 * indirizzi) non si accettano, perché non ha una rotta di caricamento e sarebbero indirizzi scelti
 * da lui mostrati allo studio come file. Un rifiuto del canale torna come risposta pronta, con
 * l'errore da scrivere nel log; ogni altro errore si rilancia.
 */
export async function contenutoMessaggio(
  tenantId: string,
  progettoId: string,
  ingresso: IngressoMessaggio,
  allegatiJson: unknown,
  dalCliente: boolean,
): Promise<
  | { ok: true; testo: string; allegatiJson: string | null; conAllegati: boolean }
  | { ok: false; stato: number; errore: string; err: unknown }
> {
  if (!ingresso.protetto) {
    const elenco = allegatiJson ? (typeof allegatiJson === 'string' ? allegatiJson : JSON.stringify(allegatiJson)) : null;
    return { ok: true, testo: ingresso.testo, allegatiJson: elenco, conAllegati: elenco !== null };
  }
  try {
    const preparato = await preparaMessaggioProtetto(tenantId, progettoId, {
      testo: ingresso.testo,
      allegatiJson: dalCliente ? null : allegatiJson,
      allegatiProtetti: ingresso.allegatiProtetti,
    });
    return { ok: true, ...preparato };
  } catch (err) {
    const risposta = rispostaAErroreCanale(err, dalCliente);
    if (!risposta) throw err;
    return { ok: false, ...risposta, err };
  }
}

/** Il minimo che serve di una riga `comunicazione_progetto` per leggerne il contenuto. */
export interface RigaMessaggio {
  id: string;
  tenantId: string;
  progettoId: string;
  canale: string;
  testo: string;
  allegatiJson: string | null;
}

export const TESTO_NON_LEGGIBILE = 'Messaggio protetto non leggibile: su questo server manca la chiave con cui è stato cifrato.';

function allegatiDellaRiga(riga: RigaMessaggio): unknown[] {
  if (!riga.allegatiJson) return [];
  const chiaro = decifraTesto(riga.tenantId, ambitoMessaggi(riga.progettoId), riga.allegatiJson);
  return allegatiDichiarati(chiaro);
}

/**
 * Il messaggio come lo vede chi ha titolo a leggerlo: testo in chiaro, allegati protetti come
 * indirizzo della rotta di scarico (mai il riferimento dell'archivio).
 *
 * `cifrato` dice se questa riga è cifrata a riposo: l'interfaccia mostra il lucchetto per ciò che
 * lo è davvero. Se la chiave manca il messaggio resta in elenco con `illeggibile: true` e il testo
 * che lo dichiara: un messaggio che c'è e non si apre non deve sembrare un messaggio che non c'è.
 */
export function messaggioLeggibile<T extends RigaMessaggio>(riga: T): T & { cifrato: boolean; illeggibile?: true } {
  const cifrato = eTestoCifrato(riga.testo);
  if (riga.canale !== CANALE_PROTETTO && !cifrato) return { ...riga, cifrato: false };
  try {
    const allegati = allegatiDellaRiga(riga).map((allegato, indice) =>
      eAllegatoArchiviato(allegato)
        ? {
            protetto: true,
            nome: allegato.nome,
            dimensione: allegato.dimensione,
            mime: allegato.mime,
            url: `/progetti/${riga.progettoId}/comunicazioni/${riga.id}/allegati/${indice}`,
          }
        : allegato,
    );
    return {
      ...riga,
      testo: decifraTesto(riga.tenantId, ambitoMessaggi(riga.progettoId), riga.testo),
      allegatiJson: allegati.length > 0 ? JSON.stringify(allegati) : null,
      cifrato,
    };
  } catch (err) {
    if (!(err instanceof ErroreCifratura)) throw err;
    return { ...riga, testo: TESTO_NON_LEGGIBILE, allegatiJson: null, cifrato, illeggibile: true };
  }
}

/**
 * Il contenuto di un allegato protetto, per la rotta di scarico. `null` quando a quell'indice non
 * c'è un allegato protetto o il file non è più in archivio.
 */
export async function leggiAllegatoProtetto(
  riga: RigaMessaggio,
  indice: number,
): Promise<{ nome: string; mime: string; contenuto: Buffer } | null> {
  const allegato = allegatiDellaRiga(riga)[indice];
  if (!eAllegatoArchiviato(allegato)) return null;
  const archiviato = await leggiFileArchivio(allegato.oggetto);
  if (!archiviato) return null;
  const contenuto = allegato.cifrato ? decifraFile(riga.tenantId, ambitoFile(riga.progettoId), archiviato) : archiviato;
  // L'impronta è stata presa al caricamento: un file diverso da quello caricato non si consegna.
  if (createHash('sha256').update(contenuto).digest('hex') !== allegato.sha256) {
    throw new ErroreCifratura('Il file in archivio non corrisponde a quello caricato.');
  }
  return { nome: allegato.nome, mime: allegato.mime, contenuto };
}
