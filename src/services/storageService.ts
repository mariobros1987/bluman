import fs from 'fs';
import path from 'path';
import { firmaDownload } from '../util/jwt.js';

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

/** Sanifica in scrittura: qualunque cosa arrivi, diventa un nome innocuo. */
export function nomeFileSicuro(filename: string): string {
  return filename.replace(CARATTERI_VIETATI_TUTTI, '_');
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

export async function uploadDocumento(filename: string, contentBase64: string): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  const cleanBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
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
          'Content-Type': 'application/pdf',
        },
        body: buffer,
      });

      if (response.ok) {
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/bluman-documents/${safeFilename}`;
        return { ok: true, url: publicUrl, name: filename, size: sizeKb };
      }
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
