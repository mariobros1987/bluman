// I form dello studio (titolare, 28/11/2026): quelli che il cliente compila per un articolo.
// Prima vivevano nello stato della pagina Libreria. Una lettura fallita si dichiara: non è
// «nessun form» (regola 13).
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';
import { invalidateCache } from './cache';

export interface FormMaster {
  id: string;
  nome: string;
  /** Le domande, nell'ordine in cui il cliente le vede. */
  campi: string[];
  /** Quanti articoli attivi indicano questo form. */
  articoli: number;
}

export async function fetchFormMasterApi(): Promise<FormMaster[]> {
  const res = await apiFetch(`${API_BASE}/form-master`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura dei form'));
  const dati = await res.json();
  return Array.isArray(dati) ? dati : [];
}

export async function creaFormMasterApi(input: { nome: string; campi: string[] }): Promise<FormMaster> {
  const res = await apiFetch(`${API_BASE}/form-master`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione del form'));
  return await res.json();
}

export async function eliminaFormMasterApi(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/form-master/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione del form'));
  // L'articolo che lo indicava non c'è (il server lo rifiuta), ma i conteggi cambiano.
  invalidateCache('articoli');
}
