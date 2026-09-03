import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

// ─────────────────────────────────────────────────────────────────
// BLOCCO 6.1 — TIMESHEET SETTIMANALE
// Griglia ore membro×giorno: registrazione propria (bozza), approvazione
// o rifiuto del responsabile. Le ore approvate alimentano il report
// "Ore per Operatore" (Blocco 5).
// ─────────────────────────────────────────────────────────────────

export type StatoTimesheet = 'bozza' | 'approvato' | 'rifiutato';

export interface VoceTimesheetApi {
  id: string;
  userId: string;
  giorno: string; // YYYY-MM-DD
  minuti: number;
  stato: StatoTimesheet;
  nota: string | null;
  progettoId: string | null;
  nomeProgetto: string | null;
  motivoRifiuto: string | null;
  approvatoDa: string | null;
  approvatoAt: string | null;
}

export interface MembroTimesheetApi {
  id: string;
  nome: string;
  email: string;
  ruolo: string;
  specializzazione: string | null;
}

export interface SettimanaTimesheetApi {
  inizio: string; // lunedì, YYYY-MM-DD
  fine: string;   // domenica, YYYY-MM-DD
  puoApprovare: boolean;
  membri: MembroTimesheetApi[];
  progetti: Array<{ id: string; nome: string }>;
  voci: VoceTimesheetApi[];
}

/** Carica la griglia della settimana (lunedì di riferimento `inizioIso`, o settimana corrente). */
export async function fetchSettimanaTimesheet(inizioIso?: string): Promise<SettimanaTimesheetApi> {
  const qs = inizioIso ? `?inizio=${encodeURIComponent(inizioIso)}` : '';
  const res = await apiFetch(`${API_BASE}/timesheet${qs}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore caricamento timesheet'));
  return (await res.json()) as SettimanaTimesheetApi;
}

/** Upsert della propria giornata: minuti=0 svuota la cella. */
export async function salvaVoceTimesheet(body: { giorno: string; minuti: number; nota?: string; progettoId?: string | null }): Promise<any> {
  const res = await apiFetch(`${API_BASE}/timesheet`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore salvataggio ore'));
  return await res.json();
}

/** Approvazione di una singola registrazione (solo responsabile). */
export async function approvaVoceTimesheet(id: string): Promise<any> {
  const res = await apiFetch(`${API_BASE}/timesheet/${id}/approva`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore approvazione ore'));
  return await res.json();
}

/** Rifiuto di una singola registrazione con motivazione (solo responsabile). */
export async function rifiutaVoceTimesheet(id: string, motivo?: string): Promise<any> {
  const res = await apiFetch(`${API_BASE}/timesheet/${id}/rifiuta`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ motivo }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore rifiuto ore'));
  return await res.json();
}

/** Approva in blocco tutte le bozze della settimana (opzionalmente di un solo membro). */
export async function approvaSettimanaTimesheet(inizioIso: string, userId?: string): Promise<{ approvate: number; inizio: string; fine: string }> {
  const res = await apiFetch(`${API_BASE}/timesheet/approva-settimana`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ inizio: inizioIso, userId }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore approvazione settimana'));
  return await res.json();
}
