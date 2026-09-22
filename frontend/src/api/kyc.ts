import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

// Fascicolo KYC governato (§5.5). Il KYC passivo (rischioAml/ubo/dataKyc su Cliente) resta come
// proiezione read-only; questo e il processo vero: stato, livello di verifica, rischio, scadenza.
export interface FascicoloKyc {
  id: string;
  stato: 'bozza' | 'in_attesa_revisione' | 'approvato' | 'respinto' | 'scaduto';
  livelloVerifica: 'semplificata' | 'ordinaria' | 'rafforzata';
  rischioCalcolato: 'basso' | 'medio' | 'alto';
  punteggioRischio: number;
  dataScadenza?: string | null;
  dataVerifica?: string | null;
  pep?: boolean;
  storico?: Array<{ id: string; statoPrecedente?: string | null; statoNuovo: string; motivazione?: string | null; createdAt: string }>;
}

export async function fetchKycFascicoloApi(clienteId: string): Promise<{ fascicolo: FascicoloKyc | null }> {
  const res = await apiFetch(`${API_BASE}/clienti/${clienteId}/kyc`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura fascicolo KYC'));
  return await res.json();
}

export async function creaKycFascicoloApi(
  clienteId: string,
  input: {
    tipoCliente?: string;
    pep?: boolean;
    paeseResidenza?: string;
    valoreOperazioneCent?: number;
    senzaPresenzaFisica?: boolean;
    identificatoConSpidOCie?: boolean;
  },
): Promise<{ ok: boolean; fascicolo: FascicoloKyc; esito: { motivazioni: string[] } }> {
  const res = await apiFetch(`${API_BASE}/clienti/${clienteId}/kyc`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione fascicolo KYC'));
  return await res.json();
}

export async function aggiornaStatoKycApi(id: string, stato: string, motivazione?: string) {
  const res = await apiFetch(`${API_BASE}/kyc/${id}/stato`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ stato, motivazione }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento stato KYC'));
  return await res.json();
}
