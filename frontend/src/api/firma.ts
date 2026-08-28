import { API_BASE, erroreDellaRisposta, fetchWithTimeout, getAuthHeaders } from './http';

// ── FIRMA ELETTRONICA SEMPLICE: CANALI, OTP, FILE FIRMATO ──────────────────
//
// Qui c'erano due ripieghi che rendevano la firma una finzione:
//
//   · se `/portal/request-otp` non rispondeva, la funzione restituiva
//     `{ ok: true, devOtp: '482910', maskedTarget: '+39 333 *** 6278' }`. Il portale
//     mostrava "codice inviato" e il numero di una persona reale, senza che partisse niente;
//   · se `/portal/verify-otp-and-sign` non rispondeva, digitando `482910` o `123456` il
//     browser fabbricava da sé un sigillo eIDAS — id, timestamp e un SHA-256 costante che
//     è l'hash della stringa vuota — e il portale lo mostrava come firma apposta. Nessuna
//     riga a database: la firma esisteva solo nella schermata, e chiunque leggesse il
//     bundle JavaScript conosceva le due cifre per produrne una.
//
// Ora un errore è un errore. Se il backend non risponde la firma non avviene, e il
// cliente legge perché.

export type CanaleOtp = 'whatsapp' | 'email' | 'telegram';
export type AmbitoFirma = 'engagement_letter' | 'documento_vault' | 'modulo_completato' | 'addendum';

export interface CanaleFirma {
  canale: CanaleOtp;
  disponibile: boolean;
  motivo?: string;
  recapitoMascherato: string | null;
}

/** Su quali canali il cliente può ricevere il codice, e perché non sugli altri. */
export async function canaliFirmaApi(clienteId?: string): Promise<{
  ok: boolean;
  canalePreferito: CanaleOtp | null;
  canali: CanaleFirma[];
  botTelegram: string | null;
}> {
  const query = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/portal/canali-firma${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere i canali di firma disponibili.');
  return await res.json();
}

export async function requestPortalOtpApi(input: {
  canale: CanaleOtp;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  /** Recapito diverso da quello in anagrafica, digitato dal firmatario. */
  recapitoDichiarato?: string;
  clienteId?: string;
  signerName?: string;
}): Promise<{
  ok: boolean;
  canale: CanaleOtp;
  maskedTarget: string;
  recapitoDichiarato: boolean;
  expiresInSeconds: number;
  reinviiRimanenti: number;
  attesaReinvioSecondi: number;
}> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/request-otp`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    15000, // La consegna passa da WhatsApp Cloud API o da un SMTP: 8 secondi sono pochi.
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Invio del codice non riuscito.');
  return await res.json();
}

export interface SigilloFirma {
  id: string;
  signatureId: string;
  tipoFirma: string;
  /** Piano firma §3 — valore legale effettivo (ses|fea|feq) fissato dal server al momento della firma. */
  valoreLegale?: string | null;
  signerName: string;
  documentoTitolo: string;
  timestampIso: string;
  documentoHash: string;
  sha256Digest: string;
  ipAddress: string | null;
  userAgent: string | null;
  canaleVerificato: string;
  standard: string;
  fileFirmatoUrl?: string;
}

export async function verifyPortalOtpAndSignApi(input: {
  otp: string;
  /**
   * Impronta del testo che il cliente ha davvero letto.
   *
   * Va mandata per la lettera d'incarico, il cui testo è composto qui nel browser. Per un
   * documento del fascicolo si omette: la calcola il backend dal file che ha in archivio, ed è
   * l'unico modo perché il sigillo descriva il documento firmato e non quello che il firmatario
   * dichiara di aver firmato.
   */
  documentoHash?: string;
  signerName?: string;
  firmatarioRuolo?: string;
  documentoTitolo?: string;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  clienteId?: string;
  /** Grafometrica raccolta dopo l'OTP, allegata al sigillo. */
  firmaGrafometricaPng?: string;
}): Promise<{ ok: boolean; seal: SigilloFirma; progettoAttivato: string | null; message: string }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/verify-otp-and-sign`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    15000,
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Codice non valido: la firma non è stata apposta.');
  return await res.json();
}

/** Documento scaricato e firmato a penna, o firmato con il provider digitale del cliente. */
export async function firmaConFileApi(input: {
  tipoFirma: 'manuale_scansionata' | 'qualificata_esterna';
  /** Impronta dell'originale: facoltativa per i documenti del fascicolo, vedi sopra. */
  documentoHash?: string;
  filename: string;
  contentBase64: string;
  ambito?: AmbitoFirma;
  riferimentoId?: string;
  clienteId?: string;
  documentoTitolo?: string;
  signerName?: string;
  firmatarioRuolo?: string;
  otp?: string;
}): Promise<{ ok: boolean; seal: SigilloFirma }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/portal/firma-con-file`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) },
    30000, // Caricamento di un file: qui il timeout breve tagliava le scansioni pesanti.
  );
  if (!res.ok) throw await erroreDellaRisposta(res, 'Caricamento del documento firmato non riuscito.');
  return await res.json();
}

/** Le firme registrate: il cliente vede le proprie, lo studio quelle del tenant. */
export async function elencoFirmeApi(filtri?: { clienteId?: string; ambito?: AmbitoFirma }): Promise<{
  ok: boolean;
  firme: Array<SigilloFirma & {
    ambito: string;
    riferimentoId: string | null;
    firmatarioNome: string;
    firmatarioRuolo: string | null;
    fileFirmatoHash: string | null;
    firmatoAt: string;
    cliente: { id: string; nome: string };
  }>;
}> {
  const params = new URLSearchParams();
  if (filtri?.clienteId) params.set('clienteId', filtri.clienteId);
  if (filtri?.ambito) params.set('ambito', filtri.ambito);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/firme${query}`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Impossibile leggere le firme registrate.');
  return await res.json();
}

export async function grafometricaFirmaApi(firmaId: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${API_BASE}/firme/${firmaId}/grafometrica`, { headers: getAuthHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.firmaGrafometricaPng ?? null;
}
