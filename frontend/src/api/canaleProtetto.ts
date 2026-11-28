// Il canale protetto studio ↔ cliente e la pagina personale del cliente.
//
// Nessuna copia locale: messaggi, richieste e riepilogo si leggono e si scrivono sul server
// (regola 3), e ogni errore risale a chi chiama, che lo mostra — un messaggio non partito non
// deve sembrare partito. Gli allegati del canale non hanno un indirizzo da aprire: si scaricano
// da qui, con il token della sessione.
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

/** Tetti dichiarati dal server (`canaleProtetto.ts`): servono a dirlo prima di spedire. */
export const MASSIMO_ALLEGATI_MESSAGGIO = 5;
export const MASSIMO_BYTE_ALLEGATO = 15 * 1024 * 1024;
/** Il corpo della richiesta ha un tetto unico: più file grandi insieme non passano. */
export const MASSIMO_BYTE_ALLEGATI_INSIEME = 28 * 1024 * 1024;

export interface AllegatoMessaggio {
  nome: string;
  url: string;
  dimensione?: string;
  mime?: string;
  /** Vero per gli allegati del canale protetto: si scaricano con `scaricaAllegatoProtettoApi`. */
  protetto?: boolean;
}

export interface MessaggioCanale {
  id: string;
  canale: string;
  mittente: string;
  destinatario: string;
  direzione: string;
  testo: string;
  allegatiJson: string | null;
  createdAt: string;
  stato?: string | null;
  inviatoAt?: string | null;
  consegnatoAt?: string | null;
  lettoAt?: string | null;
  errore?: string | null;
  /** Il server dichiara se questa riga è cifrata a riposo: il lucchetto si mostra solo se lo è. */
  cifrato?: boolean;
  /** La riga c'è ma su questo server manca la chiave per aprirla. */
  illeggibile?: boolean;
}

export interface AllegatoDaInviare {
  nome: string;
  contentBase64: string;
}

/** Gli allegati di un messaggio, qualunque forma abbia `allegatiJson` (testo JSON o già elenco). */
export function allegatiDelMessaggio(messaggio: { allegatiJson?: unknown; allegati?: unknown }): AllegatoMessaggio[] {
  let valore: unknown = messaggio.allegatiJson ?? messaggio.allegati;
  if (typeof valore === 'string') {
    try { valore = JSON.parse(valore); } catch { return []; }
  }
  if (!Array.isArray(valore)) return [];
  return valore.filter((a): a is AllegatoMessaggio => Boolean(a) && typeof a === 'object' && typeof (a as AllegatoMessaggio).nome === 'string');
}

/** Legge un file scelto dall'utente nella forma che il server si aspetta. */
export function fileComeAllegato(file: File): Promise<AllegatoDaInviare> {
  return new Promise((resolve, reject) => {
    const lettore = new FileReader();
    lettore.onload = () => resolve({ nome: file.name, contentBase64: String(lettore.result) });
    lettore.onerror = () => reject(new Error(`Non è stato possibile leggere «${file.name}».`));
    lettore.readAsDataURL(file);
  });
}

/** Il motivo per cui un gruppo di file non si può allegare, o `null` se va bene. */
export function motivoAllegatiNonAmmessi(file: Array<{ name: string; size: number }>): string | null {
  if (file.length > MASSIMO_ALLEGATI_MESSAGGIO) return `Puoi allegare al massimo ${MASSIMO_ALLEGATI_MESSAGGIO} file per volta.`;
  const troppoGrande = file.find((f) => f.size > MASSIMO_BYTE_ALLEGATO);
  if (troppoGrande) return `«${troppoGrande.name}» supera il limite di 15 MB.`;
  const vuoto = file.find((f) => f.size === 0);
  if (vuoto) return `«${vuoto.name}» è vuoto.`;
  if (file.reduce((somma, f) => somma + f.size, 0) > MASSIMO_BYTE_ALLEGATI_INSIEME) {
    return 'I file scelti superano insieme i 28 MB: mandali in due messaggi.';
  }
  return null;
}

export async function leggiMessaggiApi(progettoId: string): Promise<MessaggioCanale[]> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/comunicazioni`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'I messaggi non sono stati letti'));
  const corpo = await res.json();
  return Array.isArray(corpo) ? corpo : [];
}

/** Scrive nel canale protetto. Identità e direzione del cliente le impone il server. */
export async function inviaMessaggioProtettoApi(
  progettoId: string,
  messaggio: {
    testo: string;
    allegatiProtetti?: AllegatoDaInviare[];
    mittente?: string;
    destinatario?: string;
    direzione?: 'entrata' | 'uscita';
    microvoceProgettoId?: string;
  },
): Promise<MessaggioCanale> {
  const res = await apiFetch(
    `${API_BASE}/progetti/${encodeURIComponent(progettoId)}/comunicazioni`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ canale: 'portal', ...messaggio }) },
    180000,
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Il messaggio non è stato inviato'));
  return await res.json();
}

/** Scarica un allegato del canale protetto: il file passa solo da questa chiamata autenticata. */
export async function scaricaAllegatoProtettoApi(allegato: Pick<AllegatoMessaggio, 'url' | 'nome'>): Promise<void> {
  const intestazioni = { ...getAuthHeaders() } as Record<string, string>;
  delete intestazioni['Content-Type'];
  const res = await apiFetch(`${API_BASE}${allegato.url}`, { headers: intestazioni }, 180000);
  if (!res.ok) throw new Error(await leggiErroreApi(res, `«${allegato.nome}» non è stato scaricato`));
  const indirizzo = URL.createObjectURL(await res.blob());
  const collegamento = document.createElement('a');
  collegamento.href = indirizzo;
  collegamento.download = allegato.nome;
  document.body.appendChild(collegamento);
  collegamento.click();
  collegamento.remove();
  setTimeout(() => URL.revokeObjectURL(indirizzo), 4000);
}

// ── La pagina personale del cliente ─────────────────────────────────────────────────────────

export type FaseCliente = 'da_iniziare' | 'in_attesa' | 'in_corso' | 'completato';
export type SchedaAzione = 'proposta' | 'richieste' | 'avanzamento' | 'fatture' | 'contatti' | 'documenti';

export interface AzioneCliente {
  tipo: 'firma_incarico' | 'richiesta' | 'conferma_fase' | 'fattura' | 'messaggi' | 'firma_documento';
  titolo: string;
  dettaglio: string;
  scheda: SchedaAzione;
  riferimentoId: string | null;
  urgente: boolean;
  importoCentesimi?: number;
  scadenza?: string;
}

export interface FaseRiepilogo {
  id: string;
  nome: string;
  categoria: string;
  fase: FaseCliente;
  percentuale: number;
  attivitaTotali: number;
  attivitaConcluse: number;
  attende: string[];
  richiesteDaFare: number;
  daConfermare: boolean;
  confermata: boolean;
}

export interface CampoRichiesta {
  nome: string;
  valore: string | null;
  ripreso: boolean;
}

export interface RichiestaCliente {
  id: string;
  progettoId: string;
  faseId: string;
  faseNome: string;
  attivitaId: string;
  attivitaNome: string;
  titolo: string;
  descrizione: string | null;
  tipo: 'form' | 'documento' | 'info' | 'verifica';
  campi: CampoRichiesta[];
  modelloUrl: string | null;
  linkIstruzioni: string | null;
  stato: 'da_fare' | 'inviata' | 'chiusa';
  quando: 'ora' | 'piu_avanti';
  inviataIl: string | null;
}

export interface RiepilogoProgetto {
  id: string;
  nome: string;
  numeroContratto: string | null;
  stato: string;
  percentuale: number;
  turno: 'cliente' | 'studio' | 'concluso';
  letteraFirmata: boolean;
  fasi: FaseRiepilogo[];
  azioni: AzioneCliente[];
  richieste: RichiestaCliente[];
}

export interface RiepilogoPortale {
  canaleProtetto: { cifraturaAttiva: boolean; disponibile: boolean };
  progetti: RiepilogoProgetto[];
}

export async function fetchRiepilogoPortaleApi(clienteId?: string): Promise<RiepilogoPortale> {
  const coda = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : '';
  const res = await apiFetch(`${API_BASE}/portal/riepilogo${coda}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Lo stato degli incarichi non è stato letto'));
  const corpo = await res.json();
  return { canaleProtetto: corpo.canaleProtetto, progetti: Array.isArray(corpo.progetti) ? corpo.progetti : [] };
}

export async function rispondiRichiestaApi(
  passaggioId: string,
  risposta: { risposte?: Record<string, string>; nota?: string; allegatiProtetti?: AllegatoDaInviare[] },
): Promise<{ ok: true; inviataIl: string }> {
  const res = await apiFetch(
    `${API_BASE}/portal/richieste/${encodeURIComponent(passaggioId)}/risposta`,
    { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(risposta) },
    180000,
  );
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La risposta non è stata salvata'));
  return await res.json();
}

/** Lo studio avvisa il cliente delle richieste aperte su un incarico. */
export async function avvisaClienteRichiesteApi(progettoId: string): Promise<{ ok: true; richieste: number }> {
  const res = await apiFetch(`${API_BASE}/progetti/${encodeURIComponent(progettoId)}/richieste-cliente/avviso`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Il cliente non è stato avvisato'));
  return await res.json();
}
