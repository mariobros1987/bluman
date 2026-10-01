import fs from 'fs';
import path from 'path';
import { firmaDownload } from '../util/jwt.js';
import { scanFileBuffer } from './securityScanner.js';

export interface UploadResult {
  ok: boolean;
  url: string;
  name: string;
  size: string;
}

/** Cartella del fallback locale. Esportata perché la serve anche GET /uploads/:filename. */
export const CARTELLA_UPLOADS = path.join(process.cwd(), 'uploads');

/**
 * Tutto ciò che non è alfanumerico, `_`, `.` o `-` è vietato in un nome file: nessun
 * separatore di percorso, nessun carattere che possa cambiare directory. Unico punto di
 * verità, perché la divergenza fra le due metà era il guasto — la scrittura sanificava, la
 * lettura concatenava il parametro della rotta così com'era.
 */
const CARATTERI_VIETATI = /[^a-zA-Z0-9_.-]/;
// Stessa classe con `g` per la sostituzione. Due oggetti e non uno perché una regex con
// `g` conserva `lastIndex` fra le chiamate a `.test()`: riusarla per validare darebbe
// esiti alternati sullo stesso input.
const CARATTERI_VIETATI_TUTTI = new RegExp(CARATTERI_VIETATI.source, 'g');

/**
 * Sanifica in scrittura: qualunque cosa arrivi, diventa un nome innocuo.
 *
 * Anche le sequenze di punti vengono collassate: il punto è un carattere ammesso, ma
 * un nome d'origine come `../../etc/passwd` resterebbe `.._.._etc_passwd` — ancora
 * contenente `..`, che `nomeFileValido` rifiuta in lettura. Il file finirebbe scritto
 * ma irrecuperabile: la stessa divergenza fra le due metà che questa coppia di funzioni
 * deve impedire.
 */
export function nomeFileSicuro(filename: string): string {
  return filename.replace(CARATTERI_VIETATI_TUTTI, '_').replace(/\.{2,}/g, '_');
}

/**
 * Valida in lettura. Qui non si sanifica ma si rifiuta: un nome riscritto in silenzio
 * darebbe 404 invece di dire che la richiesta era malformata, e nasconderebbe il
 * tentativo. Ogni nome prodotto da `nomeFileSicuro` passa questo controllo — è
 * l'invariante che tiene allineate le due metà.
 */
export function nomeFileValido(filename: string): boolean {
  if (!filename || filename.length > LUNGHEZZA_MASSIMA_NOME) return false;
  if (filename.includes('..')) return false;
  return !CARATTERI_VIETATI.test(filename);
}

/**
 * Il tetto di lunghezza di un nome file. È il limite di `nomeFileValido` e vale anche per
 * la scrittura: `accorciaNomeFile` garantisce che nessun nome prodotto lo superi.
 *
 * Da questo dipende anche `maxParamLength` dell'istanza Fastify: un nome più lungo del
 * tetto viene rifiutato dal router **prima** che la rotta esista, con un 414 che non dice
 * niente a chi legge. Tenendo i due valori uguali, ogni nome che l'applicazione scrive è
 * anche un nome che l'applicazione sa servire.
 */
export const LUNGHEZZA_MASSIMA_NOME = 255;

/**
 * Accorcia un nome troppo lungo conservando l'estensione.
 *
 * `nomeFileSicuro` sanifica i caratteri ma non la lunghezza, e il nome finale aggiunge 51
 * caratteri di prefisso (`<tenantId>_<timestamp>_`): un nome d'origine di 300 caratteri
 * diventava un nome di 351, scritto su disco e poi rifiutato in lettura da
 * `nomeFileValido` — un documento «collegato» e irraggiungibile. Si taglia il gambo e non
 * l'estensione, perché è l'estensione che dice al browser come aprire il file.
 */
export function accorciaNomeFile(nome: string, massimo = LUNGHEZZA_MASSIMA_NOME): string {
  if (nome.length <= massimo) return nome;

  const punto = nome.lastIndexOf('.');
  const lunghezzaEstensione = punto > 0 ? nome.length - punto : 0;
  // Estensione solo se è tale: un punto a 200 caratteri dalla fine fa parte del nome, e
  // comunque non si tiene un'estensione che da sola occuperebbe tutto lo spazio.
  const estensione =
    lunghezzaEstensione > 0 && lunghezzaEstensione <= 16 && lunghezzaEstensione < massimo
      ? nome.slice(punto)
      : '';

  const gambo = (estensione ? nome.slice(0, punto) : nome)
    .slice(0, massimo - estensione.length)
    // Il taglio può lasciare un punto in coda al gambo: unito all'estensione darebbe `..`,
    // che `nomeFileValido` rifiuta. Si toglie qui, dov'è nato.
    .replace(/\.+$/, '');

  return `${gambo || 'file'}${estensione}`;
}

/**
 * §21 — il MIME dichiarato a Supabase Storage in base all'estensione.
 *
 * Prima era `application/pdf` per ogni upload: un .docx o una scansione .jpg venivano
 * custoditi dichiarando di essere PDF, quindi l'URL pubblico li serviva nel formato
 * sbagliato e l'anteprima del fascicolo non riusciva ad aprirli. I tipi non riconosciuti
 * ricadono su `application/octet-stream`, che il browser scarica senza tentare di
 * interpretarli.
 */
export function mimeDaEstensione(filename: string): string {
  const mappa: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.p7m': 'application/pkcs7-mime',
    '.zip': 'application/zip',
    '.eml': 'message/rfc822',
  };
  return mappa[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

export function decodificaBase64Documento(contentBase64: string): Buffer {
  if (typeof contentBase64 !== 'string') throw new Error('Contenuto base64 non valido');
  const cleanBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!cleanBase64 || cleanBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
    throw new Error('Contenuto base64 non valido');
  }
  const buffer = Buffer.from(cleanBase64, 'base64');
  const normalizzato = cleanBase64.replace(/=+$/, '');
  if (buffer.toString('base64').replace(/=+$/, '') !== normalizzato) throw new Error('Contenuto base64 non valido');
  return buffer;
}

/**
 * Il tenant proprietario del file, quando il nome lo dichiara.
 *
 * I file caricati da quando esiste l'isolamento portano un prefisso `<tenantId>_` prima
 * del timestamp. I file storici (solo `<timestamp>_<nome>`) non dichiarano nessun tenant:
 * chi li legge non può sapere a chi appartengono, e restano soggetti alle regole di prima.
 */
export function tenantDaNomeFile(filename: string): string | null {
  // UUID v4 standard (36 caratteri) seguito da `_`. Il match comprende l'underscore:
  // il tenant è tutto ciò che sta prima.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/;
  const match = UUID.exec(filename);
  return match ? match[0].slice(0, -1) : null;
}

export async function uploadDocumento(
  filename: string,
  contentBase64: string,
  tenantId?: string,
): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const buffer = decodificaBase64Documento(contentBase64);
  const scansione = scanFileBuffer(buffer, filename);
  if (!scansione.safe) throw new Error(scansione.reason ?? 'File non ammesso');
  // Il nome porta il tenant che ha caricato il file: è l'unica chiave che `GET /uploads`
  // ha per rifiutare a uno studio il file di un altro senza una tabella di registro.
  // Senza `tenantId` (chiamate senza contesto, es. alcuni script) il nome resta nella
  // forma storica e il file segue le regole di prima.
  const prefissoTenant = tenantId ? `${tenantId}_` : '';
  // `accorciaNomeFile` e non solo `nomeFileSicuro`: il prefisso e il timestamp aggiungono
  // 51 caratteri, quindi un nome d'origine lungo produrrebbe un nome che la rotta di
  // lettura rifiuta — il file resterebbe scritto e irraggiungibile.
  const safeFilename = accorciaNomeFile(`${prefissoTenant}${Date.now()}_${nomeFileSicuro(filename)}`);
  const sizeKb = `${Math.round(buffer.length / 1024)} KB`;

  // 1. Supabase Storage API Integration (Se le chiavi sono configurate)
  if (supabaseUrl && supabaseKey) {
    try {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/bluman-documents/${safeFilename}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey,
          'Content-Type': mimeDaEstensione(filename),
        },
        body: new Uint8Array(buffer),
      });

      if (response.ok) {
        // URL FIRMATO, non pubblico. Prima qui finiva `object/public/...`: chiunque
        // conoscesse l'URL scaricava atti societari e documenti KYC senza autenticazione,
        // perché il bucket era raggiungibile senza titolo. Il token firmato scade
        // (TTL sotto), quindi l'URL che resta nelle tabelle non è permanente: chi deve
        // rileggere il file passa da `urlSupabaseFirmato()`, che lo rifirma al volo.
        const url = await urlSupabaseFirmato(safeFilename);
        return { ok: true, url, name: filename, size: sizeKb };
      }
      // Regola 5: una risposta non-ok non solleva eccezione, quindi prima di questa
      // riga finiva nel fallback locale in totale silenzio — per tutto agosto
      // Supabase Storage ha fallito così, senza che nessun log dicesse perché.
      console.warn(
        `[Storage Warning] Supabase storage ha risposto ${response.status} per ${safeFilename}: uso local storage fallback.`,
      );
    } catch (err) {
      console.warn('[Storage Warning] Supabase storage non disponibile, uso local storage fallback:', err);
    }
  }

  // 2. Local Storage Fallback
  if (!fs.existsSync(CARTELLA_UPLOADS)) {
    fs.mkdirSync(CARTELLA_UPLOADS, { recursive: true });
  }

  const filePath = path.join(CARTELLA_UPLOADS, safeFilename);
  fs.writeFileSync(filePath, buffer);

  return {
    ok: true,
    url: urlUploadFirmato(safeFilename),
    name: filename,
    size: sizeKb,
  };
}

/**
 * URL relativo e già firmato per un file del fallback locale.
 *
 * Relativo di proposito: prima era `http://127.0.0.1:3000/uploads/...`, cioè un indirizzo
 * che dal browser di un utente in produzione non porta da nessuna parte. Il frontend
 * risolve i percorsi `/uploads` verso l'host dell'API da sé (`getFormattedLogoUrl`).
 */
export function urlUploadFirmato(safeFilename: string): string {
  const { firma, scad } = firmaDownload(safeFilename);
  return `/uploads/${safeFilename}?firma=${firma}&scad=${scad}`;
}

/**
 * TTL dei token firmati Supabase. Una settimana come la firma HMAC dei download locali:
 * gli URL finiscono in `logoUrl` e in `fileUrl` che restano in tabella per anni, e senza
 * un rinnovo alla lettura il contenuto sparirebbe dopo la scadenza. `rifirmaUrlUpload`
 * fa per questi URL ciò che fa per `/uploads/`.
 */
const TTL_URL_SUPABASE_SECONDI = 7 * 24 * 60 * 60;

/**
 * URL firmato per un oggetto del bucket Supabase (`bluman-documents`).
 *
 * Serve la service key: è l'unico modo di firmare un oggetto di uno storage privato senza
 * passare dalle policy per-utente di Supabase (che qui non esistono: gli utenti di BluMan
 * non sono utenti di Supabase). Se la firma non riesce — storage giù, chiave girata —
 * ritorna l'URL NON firmato come ripiego: meglio un file che la service key può ancora
 * leggere via `leggiFileArchivio` che un `null` che il chiamante tratterebbe come errore
 * di upload per un file che in realtà è già stato scritto.
 */
export async function urlSupabaseFirmato(safeFilename: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const base = `${supabaseUrl}/storage/v1/object/bluman-documents/${safeFilename}`;
  if (!supabaseUrl || !supabaseKey) return base;
  try {
    const risposta = await fetch(`${supabaseUrl}/storage/v1/object/sign/bluman-documents/${safeFilename}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: TTL_URL_SUPABASE_SECONDI }),
    });
    if (!risposta.ok) {
      console.warn(`[Storage Warning] Firma URL Supabase ha risposto ${risposta.status} per ${safeFilename}.`);
      return base;
    }
    const json = (await risposta.json()) as { signedURL?: string };
    if (!json?.signedURL) return base;
    return `${supabaseUrl}/storage/v1${json.signedURL.replace(/^\/?storage\/v1/, '')}`;
  } catch (err) {
    console.warn('[Storage Warning] Firma URL Supabase non riuscita:', err);
    return base;
  }
}

/**
 * Il nome oggetto Supabase dentro un URL, qualunque sia la forma (firmato o pubblica).
 * `null` se l'URL non è del nostro bucket.
 */
function nomeOggettoSupabaseDaUrl(url: string): string | null {
  const match = /^\/?storage\/v1\/object\/(?:sign|public)?\/?bluman-documents\/([^?/]+)/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Legge dall'archivio il contenuto di un file già caricato, qualunque sia il ripiego usato.
 *
 * Serve a chi deve calcolare l'impronta di un documento senza fidarsi di quella che gli manda
 * il browser: il file sta qui, e chi firma non deve poter dire al server quale sia l'impronta
 * di ciò che sta firmando. Gestisce le due forme che `uploadDocumento` produce — l'URL
 * pubblico di Supabase Storage e il percorso relativo `/uploads/<nome>` del ripiego locale.
 *
 * Ritorna `null` quando il file non è raggiungibile: chi chiama deve trattarlo come un errore,
 * non come un file vuoto.
 */
export async function leggiFileArchivio(url: string): Promise<Buffer | null> {
  if (typeof url !== 'string' || url.trim() === '') return null;
  const pulito = url.trim();

  if (pulito.startsWith('/uploads/')) {
    const nomeCodificato = pulito.split('?')[0]?.slice('/uploads/'.length);
    if (!nomeCodificato) return null;
    let nome: string;
    try { nome = decodeURIComponent(nomeCodificato); } catch { return null; }
    if (!nomeFileValido(nome)) return null;
    const percorso = path.join(CARTELLA_UPLOADS, nome);
    try {
      return await fs.promises.readFile(percorso);
    } catch {
      return null;
    }
  }

  const supabase = process.env.SUPABASE_URL;
  if (!supabase) return null;
  let archivio: URL;
  let atteso: URL;
  try {
    archivio = new URL(pulito);
    atteso = new URL(supabase);
  } catch {
    return null;
  }
  if (archivio.origin !== atteso.origin || archivio.username || archivio.password) return null;
  // Accetta la forma pubblica storica e quella firmata (`/object/sign/…?token=…`):
  // la chiave service legge comunque via API autenticata qui sotto, il token in query
  // non serve a questa funzione.
  const percorsoBucket = /^\/storage\/v1\/object\/(?:public\/|sign\/)?bluman-documents\/[^/]+$/;
  if (!percorsoBucket.test(archivio.pathname)) return null;

  try {
    const chiave = process.env.SUPABASE_SERVICE_KEY;
    const intestazioni: Record<string, string> = chiave
      ? { Authorization: `Bearer ${chiave}`, apikey: chiave }
      : {};
    const risposta = await fetch(archivio, { headers: intestazioni, redirect: 'error' });
    if (!risposta.ok) return null;
    return Buffer.from(await risposta.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Rinnova la firma di un URL `/uploads/` già memorizzato, e lascia intatto tutto il resto.
 *
 * Serve perché la firma scade e i valori come `tenant.logoUrl` restano in tabella per anni:
 * senza rifirmare alla lettura il logo dello studio smetterebbe di caricarsi dopo sette
 * giorni. Gli URL di Supabase Storage e quelli esterni passano invariati: i token firmati
 * di Supabase si rinnovano con `rinnovaUrlSupabaseSeServe` dove il file va davvero
 * riletto, perché la firma è una chiamata di rete e non tutte le letture la meritano.
 * Riconosce anche i valori scritti prima di questa modifica, che erano URL
 * assoluti verso `http://127.0.0.1:3000/uploads/...`.
 */
export function rifirmaUrlUpload(url: unknown): unknown {
  if (typeof url !== 'string' || !url.includes('/uploads/')) return url;

  const nome = url.split('?')[0]?.split('/uploads/').pop();
  // Un nome che non passa la validazione non lo firmiamo: sarebbe una firma valida per una
  // richiesta che il handler rifiuterà comunque con 400.
  if (!nome || !nomeFileValido(nome)) return url;

  return urlUploadFirmato(nome);
}

/**
 * Rinnova il token di un URL Supabase Storage firmato, quando l'URL è nostro e firmato.
 *
 * Gli altri casi passano invariati: URL pubblici (non scadono), URL locali `/uploads/`
 * (li firma `rifirmaUrlUpload`), URL esterni (non sono nostri). È asincrona perché firmare
 * è una chiamata a Supabase: si usa dove il file viene davvero riletto o mostrato, non su
 * ogni serializzazione.
 */
export async function rinnovaUrlSupabaseSeServe(url: unknown): Promise<unknown> {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  const senzaQuery = url.split('?')[0] ?? '';
  const nome = nomeOggettoSupabaseDaUrl(senzaQuery.replace(/^https?:\/\/[^/]+/, ''));
  if (!nome) return url;
  return urlSupabaseFirmato(nome);
}
