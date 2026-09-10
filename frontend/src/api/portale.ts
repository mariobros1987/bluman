import type { RichiestaModificaDoc } from './documenti';
import { urlFileArchivio } from './documenti';
import { API_BASE, apiFetch, erroreDellaRisposta, fetchWithTimeout, getAuthHeaders } from './http';

// ── Blocco 2: portale cliente su database ──────────────────────────────────────────────
// §2.6 contatti dello studio (lead advisor reale), §2.3 proposte di modifica dei dati
// fiscali, §2.5 richieste di addendum, §2.11 fatture e stato di pagamento.

export interface ContattiStudio {
  studio: string | null;
  advisorNome: string | null;
  advisorEmail: string | null;
  telefono: string | null;
  emailStudio: string | null;
  sedeLegale: string | null;
}

export async function contattiPortaleApi(clienteId?: string): Promise<ContattiStudio> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await apiFetch(`${API_BASE}/portal/contatti${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura contatti dello studio');
  }
  const data = await res.json();
  return data.contatti;
}

export interface PropostaDatiFiscale {
  id: string;
  clienteId: string;
  campo: string;
  valoreAttuale: string | null;
  valoreProposto: string;
  notaCliente: string | null;
  notaStudio: string | null;
  stato: 'in_attesa' | 'confermata' | 'rifiutata';
  createdAt: string;
  updatedAt: string;
  cliente?: { id: string; nome: string };
}

export async function proposteDatiPortaleApi(clienteId?: string): Promise<PropostaDatiFiscale[]> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await apiFetch(`${API_BASE}/portal/proposte-dati${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura proposte dati');
  }
  const data = await res.json();
  return data.proposte ?? [];
}

export async function inviaPropostaDatiApi(input: {
  campo: string;
  valoreProposto: string;
  notaCliente?: string;
  clienteId?: string;
}): Promise<PropostaDatiFiscale> {
  const res = await apiFetch(`${API_BASE}/portal/proposte-dati`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore invio proposta dati');
  }
  const data = await res.json();
  return data.proposta;
}

export async function proposteDatiStudioApi(filtri?: { clienteId?: string; stato?: string }): Promise<PropostaDatiFiscale[]> {
  const params = new URLSearchParams();
  if (filtri?.clienteId) params.set('clienteId', filtri.clienteId);
  if (filtri?.stato) params.set('stato', filtri.stato);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`${API_BASE}/proposte-dati${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura proposte dati');
  }
  const data = await res.json();
  return data.proposte ?? [];
}

export async function confermaPropostaDatiApi(id: string): Promise<PropostaDatiFiscale> {
  const res = await apiFetch(`${API_BASE}/proposte-dati/${encodeURIComponent(id)}/conferma`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore conferma proposta');
  }
  const data = await res.json();
  return data.proposta;
}

export async function rifiutaPropostaDatiApi(id: string, notaStudio?: string): Promise<PropostaDatiFiscale> {
  const res = await apiFetch(`${API_BASE}/proposte-dati/${encodeURIComponent(id)}/rifiuta`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ notaStudio }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore rifiuto proposta');
  }
  const data = await res.json();
  return data.proposta;
}

export interface RichiestaAddendum {
  id: string;
  clienteId: string;
  progettoId: string;
  testoRichiesta: string;
  stato: 'richiesta' | 'in_preparazione' | 'pronta' | 'rifiutata';
  rispostaStudio: string | null;
  createdAt: string;
  updatedAt: string;
  cliente?: { id: string; nome: string };
  progetto?: { id: string; nome: string };
}

export async function richiesteAddendumPortaleApi(clienteId?: string, progettoId?: string): Promise<RichiestaAddendum[]> {
  const params = new URLSearchParams();
  if (clienteId) params.set('clienteId', clienteId);
  if (progettoId) params.set('progettoId', progettoId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`${API_BASE}/portal/addendum${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura richieste addendum');
  }
  const data = await res.json();
  return data.richieste ?? [];
}

export async function inviaRichiestaAddendumApi(input: {
  testoRichiesta: string;
  progettoId?: string;
  clienteId?: string;
}): Promise<RichiestaAddendum> {
  const res = await apiFetch(`${API_BASE}/portal/addendum`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore invio richiesta addendum');
  }
  const data = await res.json();
  return data.richiesta;
}

export async function richiesteAddendumStudioApi(filtri?: { progettoId?: string; stato?: string }): Promise<RichiestaAddendum[]> {
  const params = new URLSearchParams();
  if (filtri?.progettoId) params.set('progettoId', filtri.progettoId);
  if (filtri?.stato) params.set('stato', filtri.stato);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await apiFetch(`${API_BASE}/addendum${query}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore lettura richieste addendum');
  }
  const data = await res.json();
  return data.richieste ?? [];
}

export async function aggiornaStatoAddendumApi(id: string, input: { stato?: string; rispostaStudio?: string }): Promise<RichiestaAddendum> {
  const res = await apiFetch(`${API_BASE}/addendum/${encodeURIComponent(id)}/stato`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errore ?? 'Errore aggiornamento addendum');
  }
  const data = await res.json();
  return data.richiesta;
}

export interface DocumentoPortale {
  id: string;
  nome: string;
  titolo: string;
  categoria: string;
  modulo: string | null;
  moduloProgettoId?: string | null;
  moduloNome?: string | null;
  microvoceProgettoId?: string | null;
  microvoceNome?: string | null;
  progetto: string | null;
  progettoId: string | null;
  fileUrl: string | null;
  /** §Punto-1 — URL del PDF master generato dal motore server-side (stesso contenuto del fileUrl per i documenti generati). */
  filePdfUrl?: string | null;
  /** §Punto-1 — URL del file Word (.docx) generato dal motore server-side; null se il documento non ha un export Word. */
  fileDocxUrl?: string | null;
  /**
   * Fix firma — URL dell'atto effettivamente sottoscritto: il file firmato caricato
   * (FEQ/SES manuale) oppure la copia §36 con la firma grafica incastonata (OTP/FEA).
   * Rinnovato dal server a ogni lettura perché la firma HMAC sugli URL /uploads/ scade.
   * Per le firme OTP è null: l'atto sottoscritto è la copia §36, che la rotta download
   * serve con formato=firmato.
   */
  fileFirmatoUrl?: string | null;
  /** §Punto-1 — formato del file master caricato ('pdf' per i documenti generati dal motore). */
  formatoOrigine?: string | null;
  tipo: string;
  versione: number | null;
  caricatoIl: string | null;
  scadenza: string | null;
  statoScansione: 'in_corso' | 'pulito' | 'infetto' | null;
  scaricabile: boolean;
  firmato: boolean;
  richiedeFirma: boolean;
  /** Piano firma §3 — livello (ses|fea|feq) che il documento esige; normalizzato dal server. */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq' | null;
  dataFirma: string | null;
  tipoFirma: string | null;
  signatureId: string | null;
  canaleVerificato: string | null;
  ipAddress?: string | null;
  documentoHash?: string | null;
  firmaGrafometricaPng?: string | null;
  firmatarioNome?: string | null;
  standard?: string | null;
  /** Piano firma §3 — valore legale effettivo della firma apposta, scritto dal server. */
  valoreLegale?: 'ses' | 'fea' | 'feq' | null;
  statoDoc?: 'bozza' | 'pubblicato' | 'in_revisione' | 'firmato';
  pubblicatoAt?: string | null;
  richiesteModifica?: RichiestaModificaDoc[];
  /** §WF-DOC — id del documento che questa versione ha sostituito (catena di tracciabilità). */
  documentoPadreId?: string | null;
  /**
   * §WF-DOC — versioni precedenti, dalla più recente alla più antica, ricostruita dal server
   * risalendo `documentoPadreId`. Permette al cliente di ripercorrere il documento all'indietro
   * fino alla versione che aveva eventualmente firmato.
   */
  versioniPrecedenti?: {
    id: string;
    versione: number;
    caricatoIl: string | null;
    statoDoc: string | null;
    firmatoAt: string | null;
  }[];
  documentoNonPiuDisponibile?: boolean;
}

/**
 * I documenti del fascicolo del cliente, con lo stato di firma che sta a database.
 *
 * Non c'è ripiego su un elenco vuoto: un errore di lettura viene propagato perché «lo studio non
 * ti ha caricato niente» e «non riesco a leggere i tuoi documenti» sono due messaggi diversi, e
 * mostrare il primo al posto del secondo fa chiudere la pagina a chi invece deve firmare.
 */
export async function documentiPortaleApi(clienteId?: string): Promise<{ ok: boolean; documenti: DocumentoPortale[] }> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/portal/documenti${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere i documenti del fascicolo.');
  return await res.json();
}

/**
 * §Punto-1 / Fix firma — Scarica un documento del fascicolo nel formato richiesto passando
 * dall'endpoint server `/portal/documenti/:id/download`: 'pdf' è il PDF master generato dal
 * motore (il file su cui è fissata l'impronta di firma), 'docx' la copia Word del motore,
 * 'firmato' l'atto effettivamente sottoscritto — il file firmato caricato (FEQ/SES manuale)
 * oppure la copia con la firma grafica incastonata (OTP/FEA) — distinto dal master e dal
 * verbale di firma. Il server risolve il file reale in archivio, ne verifica lo stato di
 * scansione e restituisce un URL firmato + nome file con l'estensione vera (.p7m/.docx
 * compresi). Il client scarica quei byte veri: nessun testo inventato, nessun file
 * fabbricato in locale.
 */
export async function scaricaDocumentoPortaleApi(
  documentoId: string,
  formato: 'pdf' | 'docx' | 'firmato',
  clienteId?: string,
): Promise<{ ok: boolean } | null> {
  try {
    const params = new URLSearchParams({ formato });
    if (clienteId) params.set('clienteId', clienteId);
    const res = await fetchWithTimeout(
      `${API_BASE}/portal/documenti/${encodeURIComponent(documentoId)}/download?${params.toString()}`,
      { headers: getAuthHeaders() },
    );
    if (!res.ok) throw await erroreDellaRisposta(res, 'Download del documento non riuscito.');
    const body = await res.json();
    if (!body?.ok || !body?.url) throw new Error('Il server non ha restituito un file scaricabile.');

    // L'endpoint rifirma gli URL di archivio, ma per i file sul disco dell'API restituisce
    // percorsi relativi `/uploads/…`: un fetch diretto li risolverebbe contro l'origine del
    // portale (Vercel), dove quel file non esiste. Li risolviamo verso l'host dell'API,
    // come fa già l'app operatore con urlFileArchivio. Gli URL Supabase sono già assoluti
    // e passano invariati.
    const urlFile = urlFileArchivio(typeof body.url === 'string' ? body.url : null);
    if (!urlFile) throw new Error('Il server non ha restituito un file scaricabile.');
    const fileRes = await fetch(urlFile);
    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
    const blob = await fileRes.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = body.filename || `documento.${formato}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    return { ok: true };
  } catch (err: any) {
    alert('Errore download documento: ' + (err?.message || 'errore sconosciuto'));
    return null;
  }
}
