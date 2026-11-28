// Accentratore delle mail: la posta dei clienti raccolta dalle caselle collegate.
// Nessuna cache e nessuna copia locale: messaggi, smistamento e configurazione stanno sul server
// (regola 3). Ogni errore risale a chi chiama, che lo mostra: mai un elenco vuoto al posto di un errore.
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export type VistaPosta = 'tutti' | 'da_smistare' | 'attribuiti';
export type AttribuzionePosta = 'automatica' | 'manuale' | 'da_smistare';

export interface MessaggioPosta {
  id: string;
  casellaId: string;
  mittenteEmail: string;
  mittenteNome: string | null;
  destinatari: string | null;
  oggetto: string | null;
  anteprima: string | null;
  ricevutoAt: string;
  clienteId: string | null;
  progettoId: string | null;
  attribuzione: AttribuzionePosta;
  criterio: string | null;
  lettoAt: string | null;
  archiviatoAt: string | null;
  haAllegati: boolean;
  cliente: { id: string; nome: string } | null;
  progetto: { id: string; nome: string } | null;
  casella: { id: string; nome: string; tipo: string } | null;
}

export interface AllegatoPosta {
  id: string;
  nome: string;
  mime: string | null;
  dimensioneByte: number | null;
  url: string | null;
  motivoNonSalvato: string | null;
}

export interface DettaglioMessaggioPosta extends MessaggioPosta {
  testo?: string | null;
  html: string | null;
  consegnatoA: string | null;
  allegati: AllegatoPosta[];
}

export interface FiltriPosta {
  vista?: VistaPosta;
  letti?: 'si' | 'no';
  archiviati?: boolean;
  clienteId?: string;
  q?: string;
  pagina?: number;
}

export interface ElencoPosta {
  messaggi: MessaggioPosta[];
  totale: number;
  pagina: number;
  perPagina: number;
}

export interface StatoCasella {
  id: string;
  nome: string;
  indirizzo: string;
  tipo: 'raccolta' | 'cliente';
  attiva: boolean;
  ultimaRaccoltaAt: string | null;
  ultimoSuccessoAt: string | null;
  ultimoErrore: string | null;
  cliente: { id: string; nome: string } | null;
}

export interface StatoPosta {
  caselle: StatoCasella[];
  daSmistare: number;
  nonLetti: number;
}

export interface CasellaPosta extends StatoCasella {
  host: string;
  servername: string | null;
  porta: number;
  utente: string;
  cartella: string;
  clienteId: string | null;
  raccogliDal: string | null;
  consensoDichiaratoAt: string | null;
  passwordSalvata: boolean;
}

export interface NuovaCasella {
  nome: string;
  indirizzo: string;
  host: string;
  porta: number;
  utente: string;
  password: string;
  cartella: string;
  tipo: 'raccolta' | 'cliente';
  clienteId?: string | null;
  consensoCliente?: boolean;
  raccogliDal?: string | null;
}

export interface ClienteInoltro {
  id: string;
  nome: string;
  email: string | null;
  aliasPosta: string | null;
  postaAttivataAt: string | null;
  indirizzoInoltro: string | null;
}

export interface EsitoRaccolta {
  nuovi: number;
  caselle: Array<{ casellaId: string; nome: string; ok: boolean; nuovi: number; errore?: string }>;
}

const json = (corpo: unknown) => ({ headers: getAuthHeaders(), body: JSON.stringify(corpo) });

async function leggi<T>(percorso: string, seFallisce: string): Promise<T> {
  const res = await apiFetch(`${API_BASE}${percorso}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, seFallisce));
  return await res.json();
}

async function scrivi<T>(metodo: 'POST' | 'PATCH', percorso: string, corpo: unknown, seFallisce: string): Promise<T> {
  const res = await apiFetch(`${API_BASE}${percorso}`, { method: metodo, ...json(corpo) });
  if (!res.ok) throw new Error(await leggiErroreApi(res, seFallisce));
  return await res.json();
}

export function fetchMessaggiPostaApi(filtri: FiltriPosta = {}): Promise<ElencoPosta> {
  const qs = new URLSearchParams();
  if (filtri.vista && filtri.vista !== 'tutti') qs.set('vista', filtri.vista);
  if (filtri.letti) qs.set('letti', filtri.letti);
  if (filtri.archiviati) qs.set('archiviati', 'si');
  if (filtri.clienteId) qs.set('clienteId', filtri.clienteId);
  if (filtri.q && filtri.q.trim().length >= 2) qs.set('q', filtri.q.trim());
  if (filtri.pagina && filtri.pagina > 1) qs.set('pagina', String(filtri.pagina));
  const coda = qs.toString() ? `?${qs.toString()}` : '';
  return leggi(`/posta/messaggi${coda}`, 'I messaggi non sono stati letti');
}

export const fetchMessaggioPostaApi = (id: string): Promise<DettaglioMessaggioPosta> =>
  leggi(`/posta/messaggi/${id}`, 'Il messaggio non è stato letto');

export const fetchStatoPostaApi = (): Promise<StatoPosta> => leggi('/posta/stato', 'Lo stato della raccolta non è stato letto');

export const fetchSmistamentoPostaApi = (): Promise<{ clienti: Array<{ id: string; nome: string }>; progetti: Array<{ id: string; nome: string; clienteId: string }> }> =>
  leggi('/posta/smistamento', 'Clienti e progetti non sono stati letti');

export const aggiornaMessaggioPostaApi = (
  id: string,
  modifica: { clienteId?: string | null; progettoId?: string | null; letto?: boolean; archiviato?: boolean },
): Promise<MessaggioPosta> => scrivi('PATCH', `/posta/messaggi/${id}`, modifica, 'Il messaggio non è stato aggiornato');

/** «Raccogli ora». Attesa lunga: il giro legge ogni casella e salva gli allegati prima di rispondere. */
export async function raccogliPostaApi(): Promise<EsitoRaccolta> {
  const res = await apiFetch(`${API_BASE}/posta/raccogli`, { method: 'POST', ...json({}) }, 180000);
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La raccolta non è partita'));
  return await res.json();
}

// ─── Configurazione (solo chi risponde dello studio) ───────────────────────────
export const fetchCasellePostaApi = (): Promise<CasellaPosta[]> => leggi('/posta/caselle', 'Le caselle non sono state lette');

export const creaCasellaPostaApi = (casella: NuovaCasella): Promise<CasellaPosta> =>
  scrivi('POST', '/posta/caselle', casella, 'La casella non è stata salvata');

export const aggiornaCasellaPostaApi = (id: string, modifica: { attiva?: boolean; password?: string }): Promise<CasellaPosta> =>
  scrivi('PATCH', `/posta/caselle/${id}`, modifica, 'La casella non è stata aggiornata');

export const scollegaCasellaPostaApi = (id: string): Promise<CasellaPosta> =>
  scrivi('POST', `/posta/caselle/${id}/scollega`, {}, 'La casella non è stata scollegata');

/** Prova una casella senza salvare niente. Un rifiuto arriva come errore, con il motivo dato dal server di posta. */
export async function provaCasellaPostaApi(dati: { casellaId?: string; host?: string; porta?: number; utente?: string; password?: string; cartella?: string }): Promise<string> {
  const res = await apiFetch(`${API_BASE}/posta/caselle/prova`, { method: 'POST', ...json(dati) }, 45000);
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La casella non risponde'));
  return ((await res.json()) as { messaggio: string }).messaggio;
}

export const fetchInoltriClientiApi = (): Promise<{ casellaDiRaccolta: string | null; clienti: ClienteInoltro[] }> =>
  leggi('/posta/clienti', 'Gli inoltri dei clienti non sono stati letti');

export const impostaInoltroClienteApi = (clienteId: string, attivo: boolean): Promise<ClienteInoltro> =>
  scrivi('POST', `/posta/clienti/${clienteId}/inoltro`, { attivo }, 'L’inoltro del cliente non è stato aggiornato');
