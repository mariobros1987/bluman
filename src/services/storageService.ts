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
  if (!filename || filename.length > 255) return false;
  if (filename.includes('..')) return false;
  return !CARATTERI_VIETATI.test(filename);
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

export async function uploadDocumento(filename: string, contentBase64: string): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const buffer = decodificaBase64Documento(contentBase64);
  const scansione = scanFileBuffer(buffer, filename);
  if (!scansione.safe) throw new Error(scansione.reason ?? 'File non ammesso');
  const safeFilename = `${Date.now()}_${nomeFileSicuro(filename)}`;
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
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/bluman-documents/${safeFilename}`;
        return { ok: true, url: publicUrl, name: filename, size: sizeKb };
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
  const percorsoBucket = /^\/storage\/v1\/object\/(?:public\/)?bluman-documents\/[^/]+$/;
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
 * giorni. Gli URL di Supabase Storage e quelli esterni passano invariati — non sono nostri
 * da firmare. Riconosce anche i valori scritti prima di questa modifica, che erano URL
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
