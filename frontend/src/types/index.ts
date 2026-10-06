// BluMan — Shared TypeScript types

export type StatoProgetto = 'pre_project' | 'in_progress' | 'completed' | 'archived';
export type StatoModulo   = 'pending' | 'attesa_dipendenza' | 'in_progress' | 'delayed' | 'blocked' | 'done';
export type StatoMicrovoce = 'pending' | 'attesa_dipendenza' | 'active' | 'in_progress' | 'delayed' | 'blocked' | 'done';
export type TipoCliente   = 'individual' | 'company';
export type CategoriaModulo = 'Analisi' | 'Societario' | 'Trust' | 'Banking' | 'Fiscale' | 'Legale' | 'IP' | 'Compliance';

export interface Cliente {
  id: string;
  nome: string;
  tipo: TipoCliente;
  piva?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  giurisdizione?: string;
  sedeLegale?: string;
  sdiCode?: string;
  codiceSdi?: string;
  iban?: string;
  rischioAml?: 'basso' | 'medio' | 'alto';
  ubo?: string;
  fontePatrimonio?: string;
  dataKyc?: string;
  email?: string;
  pec?: string;
  telefono?: string;
  cellulare?: string;
  /**
   * Chat id numerica del bot dello studio: è quello che `sendMessage` vuole, e la chat esiste
   * solo dopo che il cliente ha scritto almeno una volta al bot. È una colonna del cliente.
   */
  telegramChatId?: string;
  /**
   * `telegram` e `signal` non sono colonne: `serializzaCliente` distende il `referentiJson`
   * sanificato nella risposta, quindi arrivano da lì. Per Signal è anche l'unico posto in cui il
   * recapito vive — `recapitiCliente` lato server legge `referentiJson.signal` e non ripiega sul
   * cellulare, perché un numero Signal non è un numero qualsiasi.
   */
  telegram?: string;
  signal?: string;
  referenteNome?: string;
  referentiJson?: any;
  isAttivo?: boolean;
  /**
   * Non è una colonna: lo ricava `serializzaCliente` da `passwordHash`, che non esce mai dal
   * server (regola 5). Dice se al cliente è già stata assegnata la password del portale, ed è
   * la stessa cosa su cui filtra `?portale=con|senza`.
   */
  hasPassword?: boolean;
}

/**
 * I campi che bastano a **disegnare** una persona: id numerico per le chiavi React,
 * iniziali, colore, nome, ruolo.
 *
 * Non bastano ad assegnarle un lavoro. Un avatar si disegna anche per un id che non
 * risolve più — un assegnatario storico, un utente disattivato, un id arrivato da un
 * progetto vecchio — e in quel caso un identificativo di database non esiste. Tenere
 * questo caso e quello del membro vero nello stesso tipo è il modo in cui
 * `` `usr-0${operatorId}` `` è potuto sembrare un identificativo: il tipo diceva che
 * `dbId` poteva mancare, quindi costruirne uno a mano non sembrava sbagliato.
 */
export interface PersonaVisualizzata {
  id: number;
  n: string;
  r: string;
  i: string;
  c: string;
}

/**
 * Un membro dello studio che **esiste a database**: è l'unico assegnabile.
 *
 * `dbId` è obbligatorio perché è la ragione per cui questo tipo esiste. Era opzionale, e
 * il primo consumatore che ha dovuto mandarlo al server ha ripiegato su un id costruito a
 * mano che nessuna riga soddisfaceva: la chiave esterna lo rifiutava a ogni chiamata, e la
 * chiamata stava dentro un `.catch(() => {})`, quindi il pulsante «assegna operatore» non
 * ha mai funzionato e non l'ha mai detto. Con il campo obbligatorio quel ripiego non
 * compila, e il caso «non c'è un id vero» si vede mentre si scrive invece che in produzione.
 */
export interface TeamMember extends PersonaVisualizzata {
  dbId: string;
}

export interface MicroVoce {
  /**
   * Identificativo della riga a database (`microvoce_progetto.id`).
   *
   * Assente sulle micro-voci che vivono solo nel browser (dati di esempio, progetti salvati
   * prima che questo campo esistesse). Serve al salvataggio per sapere quale riga aggiornare:
   * il ripiego sul nome non distingue due voci omonime.
   */
  dbId?: string;
  /** Id numerico locale dei dati seed/legacy (non è l'id di database). */
  id?: number;
  n: string;
  hE: number; // ore estimate
  hA: number; // ore actual
  s: StatoMicrovoce;
  /**
   * Assegnatario, **id numerico della UI**: serve a scegliere il nome, le iniziali e il
   * colore dell'avatar, e non esiste in nessuna tabella. Per dire al server chi lavora alla
   * micro-voce si usa `risorsaId`.
   */
  as?: number;
  /**
   * §1ter.6 (C3) — l'uuid dell'utente assegnato (`microvoce_progetto.risorsa_id`).
   *
   * È il campo che il salvataggio manda al server. Sta accanto ad `as` e non al suo posto
   * perché i due non sono la stessa cosa: `as` è l'id interno con cui il browser disegna,
   * `risorsaId` è la riga di `bluman_user`. Tenerli distinti è ciò che permette di
   * mandare il secondo senza dover tradurre il primo al confine.
   */
  risorsaId?: string | null;
  /** Numero documenti. Opzionale: i dati seed non lo valorizzano. */
  d?: number;
  /** Nome operatore in forma testuale (dati seed/legacy). */
  op?: string;
  /** Data scadenza assegnata dalla pianificazione calendario. */
  due?: string;
  vn?: string; // nota ritardo
  proc?: Passaggio[];
  note?: Array<{ id: string; autore: string; data: string; testo: string }>;
}

export interface Passaggio {
  id: string;
  title: string;
  type: 'doc' | 'form' | 'info' | 'check';
  who: 'operatore' | 'cliente';
  stato: 'pending' | 'done';
  desc?: string;
  file?: string | null;
  fileSize?: number;
  fields?: string[];
  /**
   * Le risposte raccolte per un passaggio di tipo `form`: campo → valore.
   *
   * È il gemello di `fields` sul lato delle risposte, e sta a database in
   * `passaggio_progetto.risposte_form_json`. L'operatore le registra da
   * «Compila / Visualizza Form» quando il cliente gliele passa a voce, per email o
   * di persona: il portale non ha ancora una scheda che le raccolga da solo.
   */
  risposte?: Record<string, string>;
  documentoAllegatoUrl?: string;
  formMasterId?: string;
  linkIstruzioni?: string;
  /** Piano firma §3 — livello (ses|fea|feq) che l'atto collegato esige; default 'ses'. */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
}

export interface ModuloProgetto {
  /** Indice sintetico usato dai confronti dentro le pagine. Non è l'id di database. */
  id: number;
  /** Identificativo della riga a database (`modulo_progetto.id`). Vedi `MicroVoce.dbId`. */
  dbId?: string;
  n: string;
  cat: CategoriaModulo;
  st: StatoModulo;
  pct: number;
  h: number;
  a: number;
  p: number;
  team: number[];
  delay?: boolean;
  dn?: string;
  waitDep?: boolean;
  wdn?: string;
  /**
   * §16.1 — segnale di rischio alzato dal motore di stato: almeno una micro-voce attiva ha
   * consuntivato oltre il preventivo. È distinto da `delay`, che è un ritardo di calendario
   * dichiarato a mano: qui il lavoro procede, ma costa più di quanto è stato venduto.
   * `oreExtra` è lo sforamento accumulato, e resta contato anche quando la voce viene chiusa
   * (la spesa è avvenuta) mentre il segnale si spegne.
   */
  rischio?: boolean;
  oreExtra?: number;
  v: MicroVoce[];
}

/**
 * Una fattura collegata a un progetto, come viene realmente letta e scritta:
 * dal mapping del database (`ProjectDetail`), dai dati seed e dalle fatture create in pagina.
 *
 * In passato qui c'erano `tipo`/`mid`/`pct`, che modellano l'INPUT della generazione
 * fattura (definito inline in `api/client.ts`), non la fattura salvata: nessun codice li
 * leggeva da `Progetto.fatture`, e i dati reali non li hanno mai avuti.
 */
export interface FatturaRiga {
  id?: string | number;
  numero?: string;
  desc?: string;
  /** Il totale del documento (imponibile + IVA), in euro. */
  importo: number;
  /**
   * La scomposizione fiscale, quando la fattura viene dal database. Opzionali perché i progetti
   * seed/locali non ce l'hanno: chi mostra l'anteprima ripiega su `importo` quando mancano, invece
   * di inventare un'aliquota. `aliquotaIva` è la percentuale (0..100) letta dalla riga salvata.
   */
  imponibile?: number;
  iva?: number;
  aliquotaIva?: number;
  data?: string;
  stato: 'bozza' | 'emessa' | 'incassata';
}

export interface Progetto {
  /**
   * Id del progetto: numero per i dati seed/legacy locali, stringa (UUID) per quelli dal
   * database. I confronti in pagina usano sempre `String(p.id)`, quindi entrambi sono validi.
   */
  id: number | string;
  n: string;
  cl: string;
  ct: TipoCliente;
  st: StatoProgetto;
  pct: number;
  start: string;
  due: string;
  val: number;
  delay: boolean;
  fisc: string;
  fatture: FatturaRiga[];
  mods: ModuloProgetto[];
  /**
   * §52 — Stato della firma della lettera d'incarico **di questo progetto**.
   *
   * `'completata'` quando esiste la riga `firma_elettronica` (ambito `engagement_letter`) che
   * riferisce questo progetto — la stessa che legge il portale; `'in_attesa'` altrimenti.
   * Assente solo per i progetti locali/legacy, che non passano dal backend: lì la firma non è
   * tracciata e non si afferma niente.
   */
  statoFirma?: 'in_attesa' | 'completata';
  firmatoAt?: string | null;
  /** La firma che rende `statoFirma` «completata», con la sua evidenza. Nulla se non firmata. */
  firmaLettera?: FirmaLetteraProgetto | null;
}

/**
 * §52 — La firma elettronica della lettera d'incarico di un progetto, come la espone
 * `getProgetto`. È la riga `FirmaElettronica` (ambito `engagement_letter`, `riferimentoId` = il
 * progetto) scritta dalle rotte di firma: lo studio la legge dalla stessa fonte del portale.
 *
 * L'IP e il file caricato sono evidenza che esiste solo per certi canali di firma: restano
 * `null` quando il canale non li produce, e il render non li inventa (regola 7).
 */
export interface FirmaLetteraProgetto {
  id: string;
  signatureId: string;
  tipoFirma: string;
  valoreLegale: string;
  firmatarioNome: string;
  firmatarioRuolo: string | null;
  documentoTitolo: string;
  documentoHash: string;
  canaleVerificato: string | null;
  ipAddress: string | null;
  fileFirmatoUrl: string | null;
  standard: string;
  firmatoAt: string;
}

export interface Articolo {
  id: string;
  n: string;
  cat: CategoriaModulo;
  h: number;
  p: number;
  ver: number;
  documentoAllegatoUrl?: string | null;
  documentiRichiesti?: string[]; // Array di ID modelli documenti (es. ['m1', 'm4'])
  formMasterId?: string | null;  // ID Form Master dinamico (es. 'f1')
  linkIstruzioni?: string | null;
}

export interface RigaDistinta {
  art: string;
  qty?: number;
  oO?: number;
  oP?: number;
}

export interface Giurisdizione {
  id: string;
  nome: string;
  codice: string;
  tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro';
  note?: string;
}

export interface ModuloTemplate {
  id: string;
  n: string;
  cat: CategoriaModulo;
  ver: number;
  deps: string[];
  pkg?: number;
  giurisdizioneId?: string | null;
  giurisdizione?: Giurisdizione | null;
  righe: RigaDistinta[];
}
