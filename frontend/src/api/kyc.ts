import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

// Fascicolo KYC governato (§5.5). Il KYC passivo (rischioAml/ubo/dataKyc su Cliente) resta come
// proiezione read-only; questo e il processo vero: stato, livello di verifica, rischio, scadenza.
export interface FascicoloKyc {
  id: string;
  // v0.2 (spec §8) — ciclo di vita completo; i primi due sono legacy v0.1 ancora leggibili sui vecchi record.
  stato:
    | 'bozza' | 'in_attesa_revisione' | 'scaduto'
    | 'in_raccolta' | 'in_verifica' | 'in_attesa_approvazione'
    | 'approvato' | 'respinto' | 'sospeso' | 'in_revisione' | 'chiuso';
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

// Attivazione moduli per-studio: quali moduli sono concessi dalla piattaforma, quali spenti dallo
// studio, e quali risultano attivi (concesso E non spento). Serve a nascondere le schede KYC quando
// il modulo non è attivo. `attivi.includes('kyc')` è la condizione di visibilità del modulo KYC.
export async function fetchModuliTenant(): Promise<{ concessi: string[]; disattivati: string[]; attivi: string[] }> {
  const res = await apiFetch(`${API_BASE}/tenant/moduli`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura moduli dello studio'));
  return await res.json();
}

// Sblocco motivato del gate KYC (K4, §8, OverrideKyc): riservato all'admin dello studio; il backend
// rifiuta 403 gli altri ruoli e 400 una motivazione troppo corta. Vale 30 giorni.
export async function sbloccaKycApi(fascicoloId: string, motivazione: string) {
  const res = await apiFetch(`${API_BASE}/kyc/${fascicoloId}/override`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ motivazione }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore sblocco KYC'));
  return await res.json();
}

// K2 — titolare effettivo, catena di controllo, deposito al registro.
export interface TitolareEffettivoRiga {
  id: string;
  criterio: string;
  percentuale: string | number | null;
  fonte: string;
  note: string | null;
  soggetto: { id: string; denominazione: string; tipo: string; codiceFiscale: string | null };
}
export interface CatenaCalcolata { soggettoId: string; percentualeEffettiva: number }

export async function fetchTitolareEffettivo(fascicoloId: string): Promise<{
  titolari: TitolareEffettivoRiga[];
  legami: Array<{ id: string; daId: string; aId: string; percentuale: string | number | null }>;
  deposito: { stato: string; scadenza: string | null; dataDeposito: string | null; riferimento: string | null } | null;
  catena: CatenaCalcolata[];
  soglia: number;
}> {
  const res = await apiFetch(`${API_BASE}/kyc/${fascicoloId}/titolare-effettivo`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura titolari effettivi'));
  return await res.json();
}

export async function aggiungiTitolareEffettivo(fascicoloId: string, body: {
  denominazione: string; tipo?: string; codiceFiscale?: string; criterio?: string; percentuale?: number; fonte?: string; note?: string;
}) {
  const res = await apiFetch(`${API_BASE}/kyc/${fascicoloId}/titolare-effettivo`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore aggiunta titolare effettivo'));
  return await res.json();
}

// K3 — valutazione del rischio a 4 pilastri.
export type LivelloRischio3 = 'basso' | 'medio' | 'alto';
export interface RiskAssessmentRiga {
  id: string; versione: number; livelloComplessivo: LivelloRischio3; prossimaRevisione: string | null;
  clienteLivello: LivelloRischio3; clienteMotivazione: string | null;
  geografiaLivello: LivelloRischio3; geografiaMotivazione: string | null;
  prodottoLivello: LivelloRischio3; prodottoMotivazione: string | null;
  canaleLivello: LivelloRischio3; canaleMotivazione: string | null;
  motivazioneComplessiva: string | null; createdAt: string;
}

export async function fetchRischio(fascicoloId: string): Promise<{ corrente: RiskAssessmentRiga | null; storico: RiskAssessmentRiga[] }> {
  const res = await apiFetch(`${API_BASE}/kyc/${fascicoloId}/rischio`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura valutazione rischio'));
  return await res.json();
}

export async function salvaRischio(fascicoloId: string, body: Record<string, unknown>) {
  const res = await apiFetch(`${API_BASE}/kyc/${fascicoloId}/rischio`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore salvataggio valutazione rischio'));
  return await res.json();
}

// K6 — documenti d'identità del soggetto (upload sicuro + hash).
export interface DocumentoIdentitaRiga {
  id: string; tipo: string; numero: string | null; emittente: string | null;
  scadenza: string | null; urlStorage: string | null; hashSha256: string | null; createdAt: string;
}

export async function fetchDocumentiSoggetto(soggettoId: string): Promise<{ documenti: DocumentoIdentitaRiga[] }> {
  const res = await apiFetch(`${API_BASE}/kyc/soggetto/${soggettoId}/documenti`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore lettura documenti'));
  return await res.json();
}

export async function caricaDocumentoSoggetto(soggettoId: string, body: {
  tipo: string; filename: string; contentBase64: string; numero?: string; emittente?: string; scadenza?: string;
}) {
  const res = await apiFetch(`${API_BASE}/kyc/soggetto/${soggettoId}/documento`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore caricamento documento'));
  return await res.json();
}

