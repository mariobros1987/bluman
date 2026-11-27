// Note della beta: ciò che chi prova il gestionale segnala pagina per pagina.
// Nessuna cache e nessuna copia locale: le note si leggono e si scrivono sul server, così da un
// altro PC si vedono le stesse (regola 3). Ogni errore risale a chi chiama.
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export type TipoNotaBeta = 'errore' | 'miglioramento' | 'domanda';
export type StatoNotaBeta = 'aperta' | 'risolta';

export interface NotaBeta {
  id: string;
  userId: string | null;
  autoreNome: string;
  ruolo: string;
  pagina: string;
  percorso: string;
  tipo: TipoNotaBeta;
  testo: string;
  stato: StatoNotaBeta;
  risoltaAt: string | null;
  createdAt: string;
}

/** Le note di una pagina (`pagina`) oppure, senza, tutte quelle dello studio (solo per chi lo gestisce). */
export async function fetchNoteBetaApi(filtri: { pagina?: string; stato?: StatoNotaBeta } = {}): Promise<NotaBeta[]> {
  const qs = new URLSearchParams();
  if (filtri.pagina) qs.set('pagina', filtri.pagina);
  if (filtri.stato) qs.set('stato', filtri.stato);
  const coda = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiFetch(`${API_BASE}/note-beta${coda}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Le note della beta non sono state lette'));
  return await res.json();
}

export async function creaNotaBetaApi(nota: { percorso: string; tipo: TipoNotaBeta; testo: string }): Promise<NotaBeta> {
  const res = await apiFetch(`${API_BASE}/note-beta`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(nota) });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La nota non è stata salvata'));
  return await res.json();
}

export async function aggiornaNotaBetaApi(id: string, stato: StatoNotaBeta): Promise<NotaBeta> {
  const res = await apiFetch(`${API_BASE}/note-beta/${id}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ stato }) });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La nota non è stata aggiornata'));
  return await res.json();
}

export async function eliminaNotaBetaApi(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/note-beta/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'La nota non è stata eliminata'));
}
