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
}

export interface TeamMember {
  id: number;
  /**
   * Identificativo reale a database dell'utente (UUID), quando il membro
   * proviene dall'API del tenant. Assente sui membri costruiti localmente.
   * Serve alle chiamate che richiedono lo userId vero (es. assegnazione
   * accessi progetto §19): `id` è numerico e serve solo alla UI/avatar.
   */
  dbId?: string;
  n: string;
  r: string;
  i: string;
  c: string;
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
  /** Assignee id. Opzionale: i dati seed non lo valorizzano. */
  as?: number;
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
  importo: number;
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
