import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

export type LivelloSollecito = '1_avviso_bonario' | '2_sollecito_mora' | '3_diffida_legale';

export interface CalcoloMora {
  giorniRitardo: number;
  saggioAnnuoPercentuale: number;
  importoCapitaleCent: number;
  interessiMoraCent: number;
  speseForfettarieRecuperoCent: number;
  totaleDovutoCent: number;
}

export interface ScadenzaInsoluta {
  id: string;
  fatturaId: string;
  numeroFattura: string;
  numeroRata: number;
  clienteId: string;
  clienteNome: string;
  clienteEmail?: string | null;
  clientePiva?: string | null;
  dataEmissione: string;
  dataScadenza: string;
  importoRataCent: number;
  importoIncassatoCent: number;
  capitaleResiduoCent: number;
  stato: string;
  isScaduta: boolean;
  calcoloMora: CalcoloMora;
}

export interface AnteprimaSollecitoResponse {
  scadenzaId: string;
  clienteEmail?: string | null;
  sollecito: {
    livello: LivelloSollecito;
    oggettoEmail: string;
    corpoTesto: string;
    calcoloMora: CalcoloMora;
  };
}

export async function fetchScadenzeInsoluteApi(): Promise<ScadenzaInsoluta[]> {
  const res = await apiFetch(`${API_BASE}/invoices/solleciti/insoluti`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero scadenze insolute'));
  return await res.json();
}

export async function anteprimaSollecitoApi(
  scadenzaId: string,
  livello: LivelloSollecito = '1_avviso_bonario',
  saggioInteresse?: number,
): Promise<AnteprimaSollecitoResponse> {
  const res = await apiFetch(`${API_BASE}/invoices/scadenze/${scadenzaId}/anteprima-sollecito`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ livello, saggioInteresse }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore generazione anteprima sollecito'));
  return await res.json();
}

export async function inviaSollecitoApi(
  scadenzaId: string,
  dati: {
    livello: LivelloSollecito;
    canale?: 'email' | 'whatsapp' | 'entrambi';
    emailDestinatario?: string | null;
    telefonoDestinatario?: string | null;
    oggettoPersonalizzato?: string | null;
    testoPersonalizzato?: string | null;
    saggioInteresse?: number;
  },
): Promise<{ ok: boolean; messaggio: string; calcoloMora: CalcoloMora }> {
  const res = await apiFetch(`${API_BASE}/invoices/scadenze/${scadenzaId}/invia-sollecito`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore invio sollecito di pagamento'));
  return await res.json();
}
