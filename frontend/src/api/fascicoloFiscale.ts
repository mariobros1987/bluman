import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './client.js';

export interface ParametriExportFascicolo {
  anno: number;
  tipo: 'mensile' | 'trimestrale' | 'annuale';
  mese?: number;
  trimestre?: number;
}

export interface AnteprimaFascicoloFiscale {
  nomeFile: string;
  conteggioFattureAttive: number;
  conteggioFatturePassive: number;
  conteggioMovimentiPrimaNota: number;
  /** XML che finiranno davvero nello ZIP: le bozze non ne hanno. */
  conteggioXmlAttiviGenerati: number;
  conteggioBozzeEscluseDaXml: number;
  /** XML d'acquisto allegati: solo quelli trasmessi dal fornitore, non ricostruiti. */
  conteggioXmlPassiviAllegati: number;
  totaleImponibileVenditeEuro: number;
  totaleIvaVenditeEuro: number;
  totaleImponibileAcquistiEuro: number;
  totaleIvaAcquistiEuro: number;
  saldoIvaEuro: number;
}

export async function anteprimaFascicoloFiscaleApi(
  params: ParametriExportFascicolo
): Promise<AnteprimaFascicoloFiscale> {
  const query = new URLSearchParams({
    anno: String(params.anno),
    tipo: params.tipo,
    ...(params.mese ? { mese: String(params.mese) } : {}),
    ...(params.trimestre ? { trimestre: String(params.trimestre) } : {}),
  });
  const res = await apiFetch(`${API_BASE}/contabilita/anteprima-fascicolo-commercialista?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(await leggiErroreApi(res, 'Impossibile caricare anteprima fascicolo'));
  }
  return res.json();
}

export async function scaricaFascicoloFiscaleZipApi(
  params: ParametriExportFascicolo
): Promise<{ blob: Blob; nomeFile: string }> {
  const query = new URLSearchParams({
    anno: String(params.anno),
    tipo: params.tipo,
    ...(params.mese ? { mese: String(params.mese) } : {}),
    ...(params.trimestre ? { trimestre: String(params.trimestre) } : {}),
  });

  const url = `${API_BASE}/contabilita/export-fascicolo-commercialista?${query.toString()}`;
  const response = await apiFetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(await leggiErroreApi(response, 'Errore durante il download del fascicolo'));
  }

  const disposition = response.headers.get('content-disposition');
  let nomeFile = `Fascicolo_Fiscale_${params.anno}.zip`;
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) {
      nomeFile = match[1];
    }
  }

  const blob = await response.blob();
  return { blob, nomeFile };
}
