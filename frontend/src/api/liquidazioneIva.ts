import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';
import { cachedQuery, invalidateCache } from './cache';
import { getCurrentTenantId } from '../utils/tenant';

export interface LiquidazioneIvaRecord {
  id: string;
  tenantId: string;
  periodo: string;
  ivaDebitoCentesimi: number;
  ivaCreditoCentesimi: number;
  saldoCentesimi: number;
  versata: boolean;
  dataVersamento?: string | null;
  createdAt: string;
}

export interface RigoTributoF24 {
  sezione: 'ERARIO';
  codiceTributo: string;
  rateazione?: string;
  annoRiferimento: number;
  importoDebitoCent: number;
  importoCreditoCent: number;
  descrizione: string;
}

export interface ProspettoF24 {
  annoRiferimento: number;
  periodoRiferimento: string;
  righe: RigoTributoF24[];
  totaleDebitoCent: number;
  totaleCreditoCent: number;
  saldoFinaleCent: number;
}

/** Vedi `DifferitaTrattataComeImmediata` in `src/services/lipeEngine.ts` per il perché. */
export interface DifferitaTrattataComeImmediata {
  count: number;
  imponibileCent: number;
  ivaDebitoCent: number;
  documenti: string[];
}

export interface CalcoloLipeResponse {
  periodo: {
    tipo: 'mensile' | 'trimestrale';
    anno: number;
    mese?: number;
    trimestre?: number;
    codicePeriodo: string;
    dataInizio: string;
    dataFine: string;
  };
  totaleImponibileVenditeCent: number;
  ivaDebitoCent: number;
  totaleImponibileAcquistiCent: number;
  ivaCreditoCent: number;
  saldoIvaCent: number;
  stato: 'debito' | 'credito' | 'a_pareggio';
  importoDaVersareCent: number;
  creditoRiportabileCent: number;
  /**
   * Facoltativo di proposito: durante un deploy la pagina nuova può girare contro il backend
   * ancora vecchio, che questo campo non lo manda. Assente vale «non lo so», e la pagina non
   * disegna l'avviso — non lo inventa a zero, che direbbe «nessuna differita» senza saperlo.
   */
  differitaTrattataComeImmediata?: DifferitaTrattataComeImmediata;
  prospettoF24: ProspettoF24;
  registrazioneEsistente?: LiquidazioneIvaRecord | null;
}

export async function fetchLiquidazioniIvaApi(options?: { forceRefresh?: boolean }): Promise<LiquidazioneIvaRecord[]> {
  const currentTenantId = getCurrentTenantId();
  return cachedQuery(
    `liquidazioni_iva_${currentTenantId}`,
    async () => {
      const res = await apiFetch(`${API_BASE}/liquidazione-iva`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore recupero storico liquidazioni IVA'));
      return await res.json();
    },
    { ttlMs: 30_000, forceRefresh: options?.forceRefresh }
  );
}

export async function calcolaLipeApi(periodo: string, creditoPrecedenteCent: number = 0): Promise<CalcoloLipeResponse> {
  const res = await apiFetch(`${API_BASE}/liquidazione-iva/calcola`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ periodo, creditoPrecedenteCent }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore calcolo liquidazione IVA'));
  return await res.json();
}

export async function salvaLipeApi(periodo: string, creditoPrecedenteCent: number = 0): Promise<{ ok: boolean; liquidazione: LiquidazioneIvaRecord; riepilogo: CalcoloLipeResponse }> {
  const res = await apiFetch(`${API_BASE}/liquidazione-iva/salva`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ periodo, creditoPrecedenteCent }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore salvataggio liquidazione IVA'));
  invalidateCache('liquidazioni_iva');
  return await res.json();
}

export async function marcaVersataLipeApi(periodo: string, dati: {
  dataVersamento: string;
  contoBancarioId?: string | null;
  registraPrimaNota?: boolean;
  riferimentoTransazione?: string | null;
  note?: string | null;
}): Promise<any> {
  const res = await apiFetch(`${API_BASE}/liquidazione-iva/${periodo}/marca-versata`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(dati),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Errore registrazione versamento F24'));
  invalidateCache('liquidazioni_iva');
  invalidateCache('prima_nota');
  return await res.json();
}
