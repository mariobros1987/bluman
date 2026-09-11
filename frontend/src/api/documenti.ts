import { downloadRealPdf, downloadRealWordDoc } from '../utils/pdfGenerator';
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi, urlDocumentoAssoluto } from './http';

export async function uploadFileApi(filename: string, contentBase64: string) {
  // §3.3 — prima il `catch` restituiva `{ ok: true, url: '<API>/uploads/<nome>', size: '450 KB' }`:
  // un upload mai avvenuto veniva riferito come riuscito, con un URL che puntava al nulla.
  // Il documento «caricato» non esisteva né sul server né altrove, ma i moduli lo citavano.
  const res = await apiFetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ filename, contentBase64 }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore upload file'));
  return await res.json();
}

// ── §2.9 — Fascicolo documentale del progetto: lettura/scrittura sul database ──────────
// L'upload dello studio crea una riga nella tabella `documento` (agganciata al progetto),
// così il portale del cliente e gli altri operatori vedono davvero i file caricati.

export interface RichiestaModificaDoc {
  id: string;
  commento: string;
  stato: string;
  creatoAt: string;
  rispostoAt?: string | null;
  rispostaStudio?: string | null;
  cliente?: { id: string; nome: string; email?: string } | null;
}

export interface DocumentoProgetto {
  id: string;
  tipo: string;
  fileUrl: string;
  /** §Punto-1 — URL del PDF master generato dal motore server-side (stesso contenuto del fileUrl per i documenti generati). */
  filePdfUrl?: string | null;
  /** §Punto-1 — URL del file Word (.docx) generato dal motore server-side; null se il documento non ha un export Word. */
  fileDocxUrl?: string | null;
  /** §Punto-1 — formato del file master caricato ('pdf' per i documenti generati dal motore). */
  formatoOrigine?: string | null;
  versione: number;
  createdAt: string;
  categoriaDoc: string | null;
  statoScansione: string;
  dataScadenzaDoc: string | null;
  progettoId: string | null;
  microvoceProgettoId: string | null;
  statoDoc?: 'bozza' | 'pubblicato' | 'in_revisione' | 'firmato';
  pubblicatoAt?: string | null;
  documentoPadreId?: string | null;
  /** Punto 3 piano gap — un documento firmato non si cancella: si archivia. Il server lo restituisce sempre. */
  isArchiviato?: boolean;
  archiviatoAt?: string | null;
  microvoceProgetto?: { nome: string } | null;
  caricatoDa?: { id: string; nome?: string; email?: string } | null;
  /** Piano firma §3 — livello (ses|fea|feq) che il documento esige; default 'ses'. */
  livelloFirmaRichiesto?: string | null;
  firmato: boolean;
  firma: {
    riferimentoId: string | null;
    firmatoAt: string | null;
    signatureId: string | null;
    tipoFirma: string | null;
    valoreLegale?: string | null;
    /**
     * Fix firma — URL dell'atto effettivamente sottoscritto: il file firmato caricato
     * (FEQ/SES manuale). Rinnovato dal server a ogni lettura perché la firma HMAC sugli
     * URL /uploads/ scade. Null per le firme OTP/FEA: l'atto sottoscritto è la copia §36
     * (tipo 'firmato'), il cui PDF è già il file firmato.
     */
    fileFirmatoUrl?: string | null;
    /** Standard del sigillo inciso dal server (per distinguere SES/FEA/FEQ senza inventarlo). */
    standard?: string | null;
  } | null;
  richiesteModifica?: RichiestaModificaDoc[];
}

export async function listaDocumentiProgetto(progettoId: string, includiArchiviati = false): Promise<DocumentoProgetto[]> {
  // §37 — `includiArchiviati` esiste già lato server (Punto 3 del piano gap): le liste
  // operative escludono gli archiviati, l'archivio dello studio li mostra su richiesta.
  const parametri = new URLSearchParams({ progettoId });
  if (includiArchiviati) parametri.set('includiArchiviati', 'true');
  const res = await apiFetch(`${API_BASE}/documenti?${parametri.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura documenti del progetto');
  }
  const data = await res.json();
  return (data.documenti ?? []).map((d: DocumentoProgetto) => ({
    ...d,
    fileUrl: urlDocumentoAssoluto(d.fileUrl),
    // §Punto-1 — anche i due formati generati devono puntare a URL assoluti.
    filePdfUrl: d.filePdfUrl ? urlDocumentoAssoluto(d.filePdfUrl) : d.filePdfUrl ?? null,
    fileDocxUrl: d.fileDocxUrl ? urlDocumentoAssoluto(d.fileDocxUrl) : d.fileDocxUrl ?? null,
  }));
}

export async function salvaDocumentoApi(input: {
  progettoId: string;
  microvoceProgettoId?: string;
  filename: string;
  contentBase64: string;
  categoriaDoc?: string;
  dataScadenzaDoc?: string;
  statoDoc?: 'bozza' | 'pubblicato';
  // `PassaggioModal` lo passava già, ma non era dichiarato: TypeScript lo segnalava come
  // proprietà sconosciuta (errore invisibile finché il typecheck girava su zero file) e il
  // valore, pur arrivando al server, veniva appiattito su 'allegato'.
  tipo?: 'template_vuoto' | 'compilato' | 'firmato' | 'allegato' | 'verbale_firma';
  /** Piano firma §3 — livello richiesto (ses|fea|feq); se assente il server usa 'ses'. */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
}): Promise<DocumentoProgetto> {
  const res = await apiFetch(`${API_BASE}/documenti`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore archiviazione documento');
  }
  const data = await res.json();
  return { ...data.documento, fileUrl: urlDocumentoAssoluto(data.documento?.fileUrl) };
}

// §Punto-1 — generazione server-side di un documento da template: lo stesso merge dati
// produce PDF (master, sigillo legale) e Word (.docx, copia per firma autografa). Il
// template viaggia con i placeholder {{...}} irrisolti: la risoluzione avviene sul server
// dai dati autorevoli di DB (tenant, cliente, progetto), non dallo snapshot localStorage.
export async function generaDocumentoApi(input: {
  progettoId: string;
  microvoceProgettoId?: string;
  modelloId?: string;
  contenutoHtml?: string;
  titolo?: string;
  categoriaDoc?: string;
  statoDoc?: 'bozza' | 'pubblicato';
  dataScadenzaDoc?: string;
  /** Piano firma §3 — se assente, il server eredita il livello del template (default 'ses'). */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
}): Promise<DocumentoProgetto> {
  const res = await apiFetch(`${API_BASE}/documenti/genera`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore generazione documento');
  }
  const data = await res.json();
  return {
    ...data.documento,
    fileUrl: urlDocumentoAssoluto(data.documento?.fileUrl),
    filePdfUrl: data.documento?.filePdfUrl ? urlDocumentoAssoluto(data.documento.filePdfUrl) : data.documento?.filePdfUrl ?? null,
    fileDocxUrl: data.documento?.fileDocxUrl ? urlDocumentoAssoluto(data.documento.fileDocxUrl) : data.documento?.fileDocxUrl ?? null,
  };
}

// 'firmato' non è più un valore accettato: lo scrive solo il sigillo di firma sul server
// (regola 7). Per uscire dallo stato firmato si usa `sbloccaDocumentoApi`.
export async function aggiornaStatoDocumentoApi(documentoId: string, statoDoc: 'bozza' | 'pubblicato' | 'in_revisione') {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/stato`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ statoDoc }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore aggiornamento stato documento');
  }
  return await res.json();
}

/**
 * §WF-DOC — riapre un documento firmato dal cliente. Il server accetta solo `advisor` e
 * `super_admin` e pretende la motivazione, che finisce nel giornale di audit. La firma già
 * apposta non viene cancellata: resta la prova dell'atto del cliente.
 */
export async function sbloccaDocumentoApi(documentoId: string, motivo: string): Promise<DocumentoProgetto> {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/sblocca`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ motivo }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore sblocco documento');
  }
  const data = await res.json();
  return data.documento;
}

/**
 * Piano firma §3.3 — cambia il livello richiesto (ses|fea|feq) di un documento NON ancora
 * firmato. Dopo la firma il server rifiuta: il valore legale è già fissato dal sigillo.
 */
export async function aggiornaLivelloFirmaDocumentoApi(documentoId: string, livelloFirmaRichiesto: 'ses' | 'fea' | 'feq'): Promise<DocumentoProgetto> {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/livello-firma`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ livelloFirmaRichiesto }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore aggiornamento livello di firma');
  }
  const data = await res.json();
  return data.documento;
}

export async function nuovaVersioneDocumentoApi(documentoId: string, input: {
  filename: string;
  contentBase64: string;
  categoriaDoc?: string;
  pubblicaSubito?: boolean;
}): Promise<DocumentoProgetto> {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/nuova-versione`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore caricamento nuova versione');
  }
  const data = await res.json();
  return { ...data.documento, fileUrl: urlDocumentoAssoluto(data.documento?.fileUrl) };
}

export async function listaRichiesteModificaDocumentoApi(documentoId: string): Promise<RichiestaModificaDoc[]> {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/richieste-modifica`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura richieste modifica');
  }
  const data = await res.json();
  return data.richieste ?? [];
}

export async function aggiornaRichiestaModificaDocumentoApi(rid: string, input: { stato?: string; rispostaStudio?: string }) {
  const res = await apiFetch(`${API_BASE}/documenti/richieste-modifica/${encodeURIComponent(rid)}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore aggiornamento richiesta');
  }
  return await res.json();
}

export async function richiediModificaDocumentoApi(documentoId: string, commento: string, clienteId?: string) {
  const res = await apiFetch(`${API_BASE}/portal/documenti/${encodeURIComponent(documentoId)}/richiesta-modifica`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ commento, clienteId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore invio richiesta modifica');
  }
  return await res.json();
}

export async function eliminaDocumentoApi(id: string) {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore eliminazione documento');
  }
  return await res.json();
}

/** Punto 3 piano gap — un documento firmato non si cancella mai: lo studio lo archivia.
    Il file e il sigillo legale restano conservati; l'API risponde `{ ok: true, ... }`. */
export async function archiviaDocumentoApi(id: string) {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(id)}/archivia`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore archiviazione documento');
  }
  return await res.json();
}

// ── §37 — Archivio documentale dello studio: l'albero Cliente → Progetto ──────────────
// Solo la mappa delle cartelle con i conteggi: le carte dentro un progetto continuano
// ad arrivare da `listaDocumentiProgetto`, che è l'unico posto che sa rinnovare la firma
// HMAC degli URL e leggere lo stato di firma.

export interface ContatoriArchivio {
  documenti: number;
  firmati: number;
  daFirmare: number;
  archiviati: number;
  /** ISO del caricamento più recente fra i documenti non archiviati; null se la cartella è vuota. */
  ultimoCaricamento: string | null;
}

export interface ProgettoArchivio extends ContatoriArchivio {
  id: string;
  nome: string;
  stato: string;
  numeroContratto: string | null;
  createdAt: string;
}

export interface ClienteArchivio extends ContatoriArchivio {
  id: string;
  nome: string;
  tipo: string;
  progetti: ProgettoArchivio[];
}

export interface TotaliArchivio {
  clienti: number;
  progetti: number;
  documenti: number;
  firmati: number;
  daFirmare: number;
  archiviati: number;
  /** Documenti il cui progetto è stato eliminato: esistono, ma non hanno più una cartella. */
  nonCollocati: number;
}

export async function archivioDocumentiApi(): Promise<{ clienti: ClienteArchivio[]; totali: TotaliArchivio }> {
  const res = await apiFetch(`${API_BASE}/documenti/archivio`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, "Errore lettura archivio documenti"));
  const data = await res.json();
  return { clienti: data.clienti ?? [], totali: data.totali };
}

// ── §40 — Collocare un documento: collegarlo al progetto e alla micro-voce ─────────────
// L'archivio (§37) sapeva solo leggere e dichiarava «N documenti non compaiono in nessuna
// cartella» senza offrire un rimedio. Queste due chiamate sono il rimedio: elencano quei
// documenti e li spostano. Ogni spostamento è verbalizzato dal server nell'audit.

export interface DocumentoNonCollocato {
  id: string;
  tipo: string;
  /** Il nome del file già ripulito dal prefisso `${Date.now()}_` (lo fa il server). */
  nome: string;
  categoriaDoc: string | null;
  statoDoc: string | null;
  isArchiviato: boolean;
  versione: number;
  createdAt: string;
  caricatoDa: string | null;
}

export async function documentiNonCollocatiApi(): Promise<DocumentoNonCollocato[]> {
  const res = await apiFetch(`${API_BASE}/documenti/non-collocati`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura documenti non collocati'));
  const data = await res.json();
  return data.documenti ?? [];
}

/**
 * Sposta il documento nel progetto indicato e, dentro quello, sulla micro-voce indicata.
 *
 * `microvoceProgettoId: null` stacca la micro-voce lasciando il documento nel fascicolo del
 * progetto. Il progetto non si può togliere: un documento senza progetto non compare in nessuna
 * cartella, e il server rifiuta con 400 — la cartella «non collocati» nasce da un progetto
 * eliminato, non da una scelta.
 */
export async function collegaDocumentoApi(
  documentoId: string,
  input: { progettoId?: string | null; microvoceProgettoId?: string | null },
): Promise<{ id: string; progettoId: string | null; microvoceProgettoId: string | null; progetto: string | null; microvoce: string | null }> {
  const res = await apiFetch(`${API_BASE}/documenti/${encodeURIComponent(documentoId)}/collegamento`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore collegamento documento'));
  const data = await res.json();
  return data.documento;
}

/**
 * URL con cui il browser può davvero aprire un file dell'archivio.
 *
 * I file caricati sul ripiego locale sono memorizzati come `/uploads/<nome>?firma=…`, relativi
 * all'host dell'API: aperti così come sono porterebbero a una pagina inesistente del frontend.
 * Quelli su Supabase Storage sono già assoluti e passano invariati. Ritorna `null` quando non
 * c'è nessun file, perché «nessun documento» e «documento non apribile» non sono la stessa cosa.
 */
export function urlFileArchivio(url?: string | null): string | null {
  const valore = (url ?? '').trim();
  if (valore === '') return null;
  if (/^(data:|blob:|https?:\/\/)/i.test(valore)) return valore;
  if (valore.startsWith('/uploads')) return `${API_BASE}${valore}`;
  if (valore.startsWith('uploads/')) return `${API_BASE}/${valore}`;
  return valore;
}

/**
 * Scarica un file dell'archivio/fascicolo direttamente nel browser in formato PDF A4 apribile.
 */
export async function scaricaDocumentoClient(fileUrl?: string | null, nomeFile?: string): Promise<void> {
  const url = urlFileArchivio(fileUrl);
  if (!url) return;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    // Rileva se il contenuto è HTML (modelli di studio o contratti salvati come HTML)
    const textSnippet = await blob.slice(0, 1000).text().catch(() => '');
    const isHtml = textSnippet.includes('<html') || textSnippet.includes('<!DOCTYPE') || textSnippet.includes('<body') || textSnippet.includes('<div') || textSnippet.includes('<p>') || textSnippet.includes('<table');

    if (isHtml) {
      const fullHtml = await blob.text();
      const cleanPdfTitle = (nomeFile || 'Documento').replace(/\.(docx?|html?|txt)$/i, '');
      await downloadRealPdf(cleanPdfTitle, fullHtml);
      return;
    }

    // Se è un file binario (PDF reale, immagine, o altro allegato)
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;

    let finalName = (nomeFile || 'documento').trim();
    if (blob.type === 'application/pdf' && !finalName.toLowerCase().endsWith('.pdf')) {
      finalName = finalName.replace(/\.[^/.]+$/, '') + '.pdf';
    }
    link.download = finalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  } catch (err) {
    // Regola 5: un errore HTTP del backend non è un blocco di fetch, e confonderli era
    // l'«errore download» dell'incidente — un 401 o un 404 del catalogo finiva aperto in
    // una scheda col JSON d'errore, che all'operatore sembra un file rotto. Se il server
    // ha risposto, lo diciamo con lo status vero; la navigazione in una scheda resta solo
    // per quando la fetch è davvero bloccata (rete/CORS), l'unico caso in cui provarci
    // ha senso perché il browser può ancora scaricare direttamente.
    const messaggio = err instanceof Error ? err.message : '';
    if (/^HTTP \d+$/.test(messaggio)) {
      alert(`Errore download documento: il server ha risposto ${messaggio} per «${nomeFile || 'documento'}»`);
      return;
    }
    // Fallback con navigazione link se la fetch diretta è bloccata
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    let fallbackName = nomeFile;
    if (fallbackName) link.download = fallbackName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Scarica un file dell'archivio/fascicolo direttamente nel browser in formato Microsoft Word (.doc) apribile senza errori.
 */
export async function scaricaDocumentoWordClient(fileUrl?: string | null, nomeFile?: string, fallbackHtml?: string): Promise<void> {
  const cleanWordTitle = (nomeFile || 'Documento').replace(/\.(docx?|pdf|html?|txt)$/i, '');

  if (fallbackHtml && fallbackHtml.trim().length > 10) {
    downloadRealWordDoc(cleanWordTitle, fallbackHtml);
    return;
  }

  const url = urlFileArchivio(fileUrl);
  if (!url) {
    if (fallbackHtml) downloadRealWordDoc(cleanWordTitle, fallbackHtml);
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    // Rileva se è un file Word binario nativo (.docx OpenXML / .doc)
    const isDocx = (nomeFile && /\.(docx?)$/i.test(nomeFile)) || blob.type.includes('wordprocessingml') || blob.type.includes('msword');
    if (isDocx) {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      let finalName = (nomeFile || 'documento').trim();
      if (!finalName.toLowerCase().endsWith('.docx') && !finalName.toLowerCase().endsWith('.doc')) {
        finalName += '.docx';
      }
      link.download = finalName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      return;
    }

    // Rileva se il contenuto è testo / HTML
    const textSnippet = await blob.slice(0, 1000).text().catch(() => '');
    const isPdfBinary = textSnippet.startsWith('%PDF-');
    const isHtml = textSnippet.includes('<html') || textSnippet.includes('<!DOCTYPE') || textSnippet.includes('<body') || textSnippet.includes('<div') || textSnippet.includes('<p>') || textSnippet.includes('<table');

    if (isPdfBinary && !isHtml) {
      const docHtml = fallbackHtml || `
        <div style="font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 10px;">
          <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
            ${cleanWordTitle}
          </h1>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
            <strong>Documento Fascicolo:</strong> ${nomeFile || cleanWordTitle}<br/>
            <strong>Data Elaborazione:</strong> ${new Date().toLocaleDateString('it-IT')}<br/>
            <strong>Formato:</strong> Microsoft Word (.doc) — Valido per consultazione e redazione
          </div>
          <p>Estratto del documento fascicolo collegato. L'originale firmato con firma elettronica semplice (OTP verificata · art. 20 CAD) è custodito nel Vault telematico.</p>
        </div>
      `;
      downloadRealWordDoc(cleanWordTitle, docHtml);
      return;
    }

    const fullText = await blob.text();
    downloadRealWordDoc(cleanWordTitle, fullText);
  } catch {
    const fallback = fallbackHtml || `
      <div style="font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 10px;">
        <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
          ${cleanWordTitle}
        </h1>
        <p>Documento archiviato: ${nomeFile || cleanWordTitle}</p>
      </div>
    `;
    downloadRealWordDoc(cleanWordTitle, fallback);
  }
}

/**
 * Impronta SHA-256 del testo che il cliente sta leggendo sullo schermo.
 *
 * Il backend pretende questo valore e non ne inventa più uno: il sigillo deve identificare
 * il documento firmato, altrimenti certifica una volontà su un testo qualunque. Si calcola
 * qui perché il testo del mandato è ancora composto nel frontend — quando il documento
 * passerà lato server, l'impronta arriverà da lì e questa funzione servirà solo ai file.
 */
export async function calcolaHashSha256(contenuto: string | ArrayBuffer): Promise<string> {
  const dati = typeof contenuto === 'string' ? new TextEncoder().encode(contenuto) : contenuto;
  const digest = await crypto.subtle.digest('SHA-256', dati);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// §41 — Le quattro funzioni `*DocumentoTemplateApi*` (i modelli dello studio) stavano qui e
// sono in `api/modelliDocumento.ts`, insieme alla revisione, all'archiviazione e all'adozione.
// I chiamanti importano da `api/client`, che ri-esporta entrambi i moduli: nessuna firma è
// cambiata, tranne `fetchDocumentiTemplateApi`, che non restituisce più i dati di localStorage
// travestiti da risposta del server.

