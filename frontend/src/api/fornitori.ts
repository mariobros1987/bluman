import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export interface Fornitore {
  id: string;
  tenantId: string;
  ragioneSociale: string;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  email?: string | null;
  pec?: string | null;
  sdiCode?: string | null;
  indirizzo?: string | null;
  citta?: string | null;
  cap?: string | null;
  nazione?: string | null;
  iban?: string | null;
  note?: string | null;
  createdAt: string;
  _count?: {
    fattureRicevute: number;
  };
}

export interface FatturaRicevuta {
  id: string;
  tenantId: string;
  fornitoreId: string;
  fornitore?: Fornitore;
  numero: string;
  data: string;
  imponibileCentesimi: number;
  ivaCentesimi: number;
  totaleCentesimi: number;
  esigibilitaIva: 'immediata' | 'differita' | 'split';
  pagata: boolean;
  dataPagamento?: string | null;
  xmlSdiRaw?: string | null;
  createdAt: string;
}

export async function fetchFornitoriApi(): Promise<Fornitore[]> {
  const res = await apiFetch(`${API_BASE}/fornitori`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero lista fornitori'));
  return await res.json();
}

export async function creaFornitoreApi(dati: Partial<Fornitore>): Promise<Fornitore> {
  const res = await apiFetch(`${API_BASE}/fornitori`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore creazione fornitore'));
  return await res.json();
}

export async function aggiornaFornitoreApi(id: string, dati: Partial<Fornitore>): Promise<Fornitore> {
  const res = await apiFetch(`${API_BASE}/fornitori/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiornamento fornitore'));
  return await res.json();
}

export async function eliminaFornitoreApi(id: string): Promise<{ ok: boolean; messaggio: string }> {
  const res = await apiFetch(`${API_BASE}/fornitori/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore eliminazione fornitore'));
  return await res.json();
}

export async function fetchFattureRicevuteApi(fornitoreId?: string): Promise<FatturaRicevuta[]> {
  const url = fornitoreId ? `${API_BASE}/fatture-ricevute?fornitoreId=${fornitoreId}` : `${API_BASE}/fatture-ricevute`;
  const res = await apiFetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero fatture passive'));
  return await res.json();
}

export const fetchFatturePassiveApi = fetchFattureRicevuteApi;

export async function registraFatturaRicevutaApi(dati: any): Promise<FatturaRicevuta> {
  const res = await apiFetch(`${API_BASE}/fatture-ricevute`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore registrazione fattura passiva'));
  return await res.json();
}

export const registraFatturaPassivaApi = registraFatturaRicevutaApi;

export async function importaXmlFatturaRicevutaApi(dati: {
  xmlContent: string;
  pagata?: boolean;
  dataPagamento?: string;
  contoBancarioId?: string;
}): Promise<{ ok: boolean; fattura: FatturaRicevuta }> {
  const res = await apiFetch(`${API_BASE}/fatture-ricevute/import-xml`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, "Errore importazione XML fattura d'acquisto"));
  return await res.json();
}

export const importaFatturaPassivaXmlApi = importaXmlFatturaRicevutaApi;

export async function pagaFatturaRicevutaApi(id: string, dati: {
  dataPagamento: string;
  metodoPagamento?: string | null;
  contoBancarioId?: string | null;
  riferimentoTransazione?: string | null;
  note?: string | null;
}): Promise<any> {
  const res = await apiFetch(`${API_BASE}/fatture-ricevute/${id}/paga`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore registrazione pagamento fattura passiva'));
  return await res.json();
}
