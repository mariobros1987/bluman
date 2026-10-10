// Voce 8-bis — la credenziale della copia off-site e lo stato che ne dà conto.
//
// PERCHÉ UN FILE E NON UNA TABELLA (decisione del 10/10/2026). Il database **è** ciò che viene
// scaricato e spedito su Dropbox, e il `.env` **è** l'archivio dei segreti che viene archiviato
// insieme a esso. Mettere la credenziale della copia dentro uno dei due significherebbe spedire
// la chiave insieme alla cassaforte. Un file dedicato, fuori da entrambi, non entra in nessuno
// dei due. Il prezzo è dichiarato e non nascosto: questa configurazione vale **solo** dal backend
// che vede la cartella, cioè il VPS. Su Railway la cartella non esiste, `leggiConfigurazione`
// risponde «non disponibile» e il salvataggio **fallisce** invece di riuscire a vuoto.
//
// PERCHÉ DUE FILE DI STATO E NON UNO. Un backup che si dichiara riuscito e una copia che esiste
// davvero sul remoto sono due fatti distinti, e la distinzione è esattamente ciò che serve quando
// l'autenticazione di Dropbox scade: il primo resta verde, il secondo no. Tenerli separati evita
// anche due scrittori sullo stesso file (`backup-vps.sh` e `monitor-vps.sh`).
//
// REGOLA DEL MODULO: ciò che non si è potuto leggere vale `sconosciuto`, mai `ok`. Un file
// assente, illeggibile o malformato non è un backup riuscito: è un'informazione che manca, e
// fingerla verde è il modo in cui un guasto silenzioso diventa invisibile.

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Il nome del remote nella configurazione rclone: è lo stesso che scrive `componiConfigRclone`
 *  e lo stesso che `backup-vps.sh` pretende di trovare prima di invocare rclone. */
export const NOME_REMOTE_RCLONE = 'dropbox';

export const NOME_FILE_CONFIG = 'rclone.conf';
export const NOME_FILE_BACKUP = 'backup.json';
export const NOME_FILE_VERIFICA = 'verifica.json';

/** Poche centinaia di caratteri in tutto: il doppio è già sospetto. */
const MAX_CARATTERI_TOKEN = 4096;

/**
 * Le due cartelle, lette a ogni chiamata e non una volta all'import.
 *
 * Servono dai parametri d'ambiente per due ragioni concrete: sul VPS il percorso è quello dei
 * montaggi descritti in `docker-compose.prod.yml`, e nei test deve poter essere una cartella
 * temporanea — un modulo che scrivesse in `/var/lib` a ogni esecuzione della suite non sarebbe
 * verificabile, e non verificabile significa non verificato.
 */
export function cartellaConfigurazione(): string {
  return process.env.BLUMAN_BACKUP_CONFIG_DIR || '/app/backup-config';
}

export function cartellaStato(): string {
  return process.env.BLUMAN_BACKUP_STATO_DIR || '/app/backup-stato';
}

/** La destinazione (`dropbox:bluman-backup`). Non è un segreto: sta nel `.env`, non nel file
 *  della credenziale, ed è utile vederla per distinguere «non configurato» da «configurato male». */
export function destinazioneBackup(): string | null {
  const valore = (process.env.BLUMAN_BACKUP_RCLONE_REMOTE || '').trim();
  return valore || null;
}

// ── Validazione del token ────────────────────────────────────────────────────────────────

export type EsitoToken = { ok: true; token: string } | { ok: false; errore: string };

/**
 * Accetta il JSON che stampa `rclone authorize dropbox`, e nient'altro.
 *
 * `refresh_token` è obbligatorio per una ragione che non è formale: l'access token di Dropbox
 * dura poche ore e rclone lo rinnova **solo** col refresh token. Un token senza refresh sembra
 * accettato e funziona fino a sera, poi la copia smette in silenzio — cioè esattamente il guasto
 * da cui questa voce vuole difendersi. Meglio rifiutarlo mentre l'operatore è ancora davanti al
 * modulo e sa cosa rifare.
 */
export function validaTokenRclone(testo: unknown): EsitoToken {
  if (typeof testo !== 'string' || !testo.trim()) {
    return { ok: false, errore: 'Incolla il token JSON stampato da `rclone authorize dropbox`.' };
  }
  const grezzo = testo.trim();
  if (grezzo.length > MAX_CARATTERI_TOKEN) {
    return {
      ok: false,
      errore: `Testo troppo lungo (${grezzo.length} caratteri): il token di rclone ne ha poche centinaia. Hai incollato altro?`,
    };
  }
  // Una configurazione rclone intera non è un token. Accettarla scriverebbe un file che rclone
  // legge ma che non contiene nessuna credenziale: la copia non partirebbe, e il modulo
  // direbbe «configurato».
  //
  // Il nome di sezione si riconosce perché non contiene virgolette né virgole: senza quel
  // vincolo anche `["access","refresh"]` — un array JSON, che è tutt'altro errore — verrebbe
  // respinto con l'accusa sbagliata, e chi ha incollato l'array non capirebbe cosa rifare.
  if (/^\s*\[[^\]"',]+\]\s*$/m.test(grezzo) || /^\s*type\s*=/m.test(grezzo)) {
    return {
      ok: false,
      errore: 'Sembra una configurazione rclone, non il token. Serve solo il JSON fra graffe che stampa `rclone authorize dropbox`.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(grezzo);
  } catch {
    return { ok: false, errore: 'Il testo non è JSON valido: incolla il blocco che comincia con `{` e finisce con `}`.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errore: 'Il JSON deve essere un oggetto con i campi del token (access_token, refresh_token).' };
  }
  const campi = parsed as Record<string, unknown>;
  const access = typeof campi.access_token === 'string' ? campi.access_token.trim() : '';
  const refresh = typeof campi.refresh_token === 'string' ? campi.refresh_token.trim() : '';
  if (!access) {
    return { ok: false, errore: 'Manca `access_token`: il JSON incollato non è un token di Dropbox.' };
  }
  if (!refresh) {
    return {
      ok: false,
      errore:
        'Manca `refresh_token`: senza, la copia funzionerebbe poche ore e poi si fermerebbe senza avvisare. Rifai `rclone authorize dropbox` e incolla il JSON intero.',
    };
  }
  // Si riscrive compatto e non si conserva il testo com'è arrivato: così il file ha una forma
  // sola, e un token incollato con indentature diverse non produce due file diversi.
  return { ok: true, token: JSON.stringify(campi) };
}

/** La forma che rclone si aspetta: una sezione, il tipo, e il token su una riga. */
export function componiConfigRclone(tokenJson: string): string {
  return `[${NOME_REMOTE_RCLONE}]\ntype = dropbox\ntoken = ${tokenJson}\n`;
}

// ── Configurazione (la cartella del segreto) ─────────────────────────────────────────────

export interface ConfigurazioneBackup {
  /** Vero solo se il file della credenziale esiste **ed è leggibile**: non basta che la
   *  destinazione sia impostata nel `.env`, quella non autentica niente. */
  configurato: boolean;
  /** Quando è stata salvata, dal `mtime` del file: così non serve un terzo file di metadati. */
  configuratoIl: string | null;
  /** La cartella montata esiste su questo backend. Falso su Railway: il modulo lo dice
   *  invece di lasciar credere che il salvataggio sia arrivato da qualche parte. */
  cartellaDisponibile: boolean;
  percorso: string;
  destinazione: string | null;
}

export function leggiConfigurazione(): ConfigurazioneBackup {
  const cartella = cartellaConfigurazione();
  const percorso = join(cartella, NOME_FILE_CONFIG);
  const destinazione = destinazioneBackup();
  const cartellaDisponibile = existsSync(cartella);
  if (!cartellaDisponibile || !existsSync(percorso)) {
    return { configurato: false, configuratoIl: null, cartellaDisponibile, percorso, destinazione };
  }
  try {
    const info = statSync(percorso);
    return {
      configurato: info.size > 0,
      configuratoIl: new Date(info.mtimeMs).toISOString(),
      cartellaDisponibile: true,
      percorso,
      destinazione,
    };
  } catch {
    // Il file c'è ma non si legge (permessi): non è «configurato», è «non verificabile».
    return { configurato: false, configuratoIl: null, cartellaDisponibile: true, percorso, destinazione };
  }
}

/**
 * Scrive la credenziale. **Non crea la cartella**: se manca, questa non è la macchina che fa i
 * backup e il salvataggio deve fallire. Creandola, su Railway si scriverebbe un file dentro il
 * container — che nessun backup legge — e l'interfaccia direbbe «configurato» (regola 7).
 */
export function scriviTokenRclone(configTesto: string): void {
  const cartella = cartellaConfigurazione();
  if (!existsSync(cartella)) {
    throw new Error(
      `La cartella ${cartella} non esiste su questo backend: la copia off-site si configura dal server che esegue i backup.`,
    );
  }
  const percorso = join(cartella, NOME_FILE_CONFIG);
  const temporaneo = `${percorso}.tmp-${process.pid}`;
  try {
    // Scrittura su file temporaneo e rinomina: un lettore (rclone, alle 03:17) non trova mai un
    // file a metà. È sicuro proprio perché si monta la **cartella** e non il file singolo.
    writeFileSync(temporaneo, configTesto, { mode: 0o640 });
    renameSync(temporaneo, percorso);
    // Esplicito dopo la rinomina: `mode` non tocca un file che esiste già, e la credenziale non
    // deve restare leggibile da tutti per via di un vecchio file lasciato lì.
    chmodSync(percorso, 0o640);
  } catch (err: any) {
    try { unlinkSync(temporaneo); } catch { /* niente da pulire */ }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw new Error(
        `La cartella ${cartella} non è scrivibile dall'API: sul VPS dev'essere di proprietà dell'utente 1000 (l'utente del container) e del gruppo bluman, con permessi 0750.`,
      );
    }
    throw err;
  }
}

/** Disattiva la copia off-site. Il file sparisce, la destinazione nel `.env` resta. */
export function rimuoviTokenRclone(): boolean {
  const percorso = join(cartellaConfigurazione(), NOME_FILE_CONFIG);
  if (!existsSync(percorso)) return false;
  unlinkSync(percorso);
  return true;
}

// ── Stato (la cartella dell'evidenza, montata in sola lettura) ───────────────────────────

/** Cosa il backup **crede** di aver fatto (`backup.json`, scritto da `backup-vps.sh`). */
export interface EsitoBackupFile {
  esito: 'ok' | 'fallito' | 'sconosciuto';
  quando: string | null;
  file: string | null;
  byte: number | null;
  /** Esito della copia sul remoto, com'è stata vista dallo script che l'ha tentata. */
  copiaOffSite: 'ok' | 'saltata' | 'fallita' | 'sconosciuto';
  dettaglio: string;
}

/** Cosa il monitor ha **constatato** interrogando Dropbox (`verifica.json`, scritto da
 *  `monitor-vps.sh`). È l'unico dei due che si accorge di un'autenticazione scaduta. */
export interface EsitoVerificaFile {
  stato: 'ok' | 'fail' | 'unknown';
  quando: string | null;
  /** Età in ore della copia più recente sul remoto, al momento della verifica. */
  ore: number | null;
  file: string | null;
  dettaglio: string;
}

export interface StatoOffSite {
  /** La cartella di stato è montata e leggibile: è anche l'indicatore di «sono sul backend che
   *  fa i backup». Su Railway è falso, e l'interfaccia lo dice. */
  disponibile: boolean;
  backup: EsitoBackupFile;
  verifica: EsitoVerificaFile;
}

const BACKUP_SCONOSCIUTO: EsitoBackupFile = {
  esito: 'sconosciuto',
  quando: null,
  file: null,
  byte: null,
  copiaOffSite: 'sconosciuto',
  dettaglio: 'nessuna informazione leggibile',
};

const VERIFICA_SCONOSCIUTA: EsitoVerificaFile = {
  stato: 'unknown',
  quando: null,
  ore: null,
  file: null,
  dettaglio: 'nessuna informazione leggibile',
};

function testo(valore: unknown, ripiego: string): string {
  return typeof valore === 'string' && valore.trim() ? valore.trim() : ripiego;
}

function testoOppureNull(valore: unknown): string | null {
  return typeof valore === 'string' && valore.trim() ? valore.trim() : null;
}

function numeroOppureNull(valore: unknown): number | null {
  return typeof valore === 'number' && Number.isFinite(valore) ? valore : null;
}

/** Legge un JSON senza mai fidarsi di ciò che contiene: campi assenti o di tipo sbagliato
 *  diventano `sconosciuto`, non un valore plausibile inventato. */
function leggiJson(percorso: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(percorso, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function leggiStato(cartella: string = cartellaStato()): StatoOffSite {
  if (!existsSync(cartella)) {
    return { disponibile: false, backup: { ...BACKUP_SCONOSCIUTO }, verifica: { ...VERIFICA_SCONOSCIUTA } };
  }

  let backup = { ...BACKUP_SCONOSCIUTO };
  const grezzoBackup = leggiJson(join(cartella, NOME_FILE_BACKUP));
  if (grezzoBackup) {
    const esito = grezzoBackup.esito === 'ok' || grezzoBackup.esito === 'fallito' ? grezzoBackup.esito : 'sconosciuto';
    const copia = grezzoBackup.copiaOffSite;
    backup = {
      esito,
      quando: testoOppureNull(grezzoBackup.quando),
      file: testoOppureNull(grezzoBackup.file),
      byte: numeroOppureNull(grezzoBackup.byte),
      copiaOffSite:
        copia === 'ok' || copia === 'saltata' || copia === 'fallita' ? copia : 'sconosciuto',
      dettaglio: testo(grezzoBackup.dettaglio, 'nessun dettaglio'),
    };
  }

  let verifica = { ...VERIFICA_SCONOSCIUTA };
  const grezzoVerifica = leggiJson(join(cartella, NOME_FILE_VERIFICA));
  if (grezzoVerifica) {
    const stato = grezzoVerifica.stato;
    verifica = {
      stato: stato === 'ok' || stato === 'fail' || stato === 'unknown' ? stato : 'unknown',
      quando: testoOppureNull(grezzoVerifica.quando),
      ore: numeroOppureNull(grezzoVerifica.ore),
      file: testoOppureNull(grezzoVerifica.file),
      dettaglio: testo(grezzoVerifica.dettaglio, 'nessun dettaglio'),
    };
  }

  return { disponibile: true, backup, verifica };
}

/**
 * Lo stato che il **titolare** dello studio può vedere: la freschezza della copia e basta.
 *
 * Non è una riduzione di comodo: il titolare non ha nessuna azione da compiere su questa
 * configurazione e non deve sapere dove sta la credenziale né quale sia la destinazione. Gli
 * serve sapere se i suoi dati esistono in un posto che sopravvive a questo server.
 */
export interface StatoOffSiteTitolare {
  disponibile: boolean;
  copiaConfigurata: boolean;
  backup: EsitoBackupFile;
  verifica: EsitoVerificaFile;
}

export function statoPerTitolare(): StatoOffSiteTitolare {
  const stato = leggiStato();
  return {
    disponibile: stato.disponibile,
    copiaConfigurata: leggiConfigurazione().configurato && destinazioneBackup() !== null,
    backup: stato.backup,
    verifica: stato.verifica,
  };
}
