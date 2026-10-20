// Client delle credenziali dei servizi esterni dello studio (visura, screening PEP, TSA).
// Il segreto non arriva mai dal server: si può solo scrivere, mai rileggere.
import { API_BASE, apiFetch, getAuthHeaders } from './http';

export type ServizioEsternoKey = 'kyc_visura' | 'kyc_screening' | 'tsa';

export interface ServizioEsterno {
  servizio: ServizioEsternoKey;
  etichetta: string;
  descrizione: string;
  endpoint: string | null;
  username: string | null;
  segretoMascherato: string | null;
  segretoConfigurato: boolean;
  extra: Record<string, unknown> | null;
  aggiornatoDa: string | null;
  updatedAt: string | null;
}

export async function fetchServiziEsterni(): Promise<{ servizi: ServizioEsterno[] }> {
  const res = await apiFetch(`${API_BASE}/tenant/servizi-esterni`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura credenziali dei servizi esterni');
  return data;
}

export async function salvaServizioEsterno(
  servizio: ServizioEsternoKey,
  body: {
    endpoint?: string | null;
    username?: string | null;
    etichetta?: string | null;
    /** Assente = invariato; '' = cancella; valore = sostituisce. */
    segreto?: string;
    extra?: Record<string, unknown> | null;
  },
): Promise<{ ok: boolean; servizio: ServizioEsterno }> {
  const res = await apiFetch(`${API_BASE}/tenant/servizi-esterni/${servizio}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore salvataggio credenziali del servizio');
  return data;
}

/** Esito della prova di collegamento con la TSA (marca un'impronta casuale, non conserva nulla). */
export interface EsitoVerificaTsa {
  ok: boolean;
  stato: string;
  endpoint: string;
  genTime: string | null;
  policy: string | null;
  serialNumber: string | null;
  hashVerificato: boolean;
  avviso: string | null;
  errore: string | null;
}

export async function verificaCollegamentoTsa(): Promise<EsitoVerificaTsa> {
  const res = await apiFetch(`${API_BASE}/tenant/servizi-esterni/tsa/verifica`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && !data?.errore) throw new Error('Errore nella prova di collegamento con la TSA');
  return data;
}
