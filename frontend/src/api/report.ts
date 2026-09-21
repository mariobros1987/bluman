import { API_BASE, apiFetch, getAuthHeaders } from './http';
import { toast } from '../components/ui/ToastProvider';

// ─────────────────────────────────────────────────────────────────────────────
// BLOCCO 5 — REPORTISTICA DIREZIONALE (JSON + export PDF/Excel)
// ─────────────────────────────────────────────────────────────────────────────

/** Cella della tabella report: testo, numero (valuta/ore/%) o null. */
export type CellaReport = string | number | null;

/** Struttura tabellare comune restituita da GET /reports/:tipo. */
export interface ReportTabella {
  chiave: string;
  titolo: string;
  sottotitolo: string;
  intestazioni: string[];
  righe: CellaReport[][];
  colonneValuta: number[];
  colonneOre: number[];
  colonnePercentuali: number[];
  totali?: CellaReport[][];
  riepilogo?: Array<{ etichetta: string; valore: string }>;
}

/** Catalogo dei report disponibili (chiave → etichetta per la UI). */
export const CHIAVI_REPORT: Array<{ chiave: string; label: string; icona: string; desc: string; conFiltroAnno?: boolean }> = [
  { chiave: 'ore-operatori', label: 'Ore per Operatore', icona: '⏱️', desc: 'Consuntivazione ore di progetto per risorsa' },
  { chiave: 'margine-progetti', label: 'Margine per Progetto', icona: '📈', desc: 'Ricavo contrattuale vs costo ore' },
  { chiave: 'ricavi-mensili', label: 'Ricavi Mensili', icona: '🗓️', desc: 'Fatturato netto mese per mese', conFiltroAnno: true },
  { chiave: 'scadenzario', label: 'Scadenzario Incassi', icona: '⏰', desc: 'Partite aperte e residui da incassare' },
  { chiave: 'redditivita-clienti', label: 'Redditività per Cliente', icona: '👥', desc: 'Margine aggregato per cliente' },
];

/**
 * Carica il report richiesto. Lancia un errore (con messaggio reale) se la chiamata
 * fallisce: nessun fallback mock, la pagina mostra l'errore invece di dati finti.
 */
export async function fetchReportApi(chiave: string, anno?: number): Promise<ReportTabella> {
  const qs = anno ? `?anno=${encodeURIComponent(String(anno))}` : '';
  const res = await apiFetch(`${API_BASE}/reports/${chiave}${qs}`, { headers: getAuthHeaders() }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.errore || `Errore caricamento report (HTTP ${res.status})`);
  }
  return (await res.json()) as ReportTabella;
}

/** Scarica il file PDF/Excel del report come allegato. */
export async function downloadReportApi(chiave: string, formato: 'pdf' | 'xlsx', anno?: number): Promise<{ ok: boolean } | null> {
  try {
    const params = new URLSearchParams({ formato });
    if (anno) params.set('anno', String(anno));
    const res = await apiFetch(`${API_BASE}/reports/${chiave}/export?${params.toString()}`, { headers: getAuthHeaders() }, 60000);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.errore || 'Errore generazione file');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chiave}${anno ? `_${anno}` : ''}.${formato}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err: any) {
    toast.errore('Errore export report: ' + (err?.message || 'errore sconosciuto'));
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// RICERCA GLOBALE (Blocco 4)
// Ricerca trasversale server-side su clienti, progetti, fatture,
// documenti, team, calendario e retainer. I risultati tornano già
// raggruppati per tipo, con link di navigazione pronti all'uso.
// ─────────────────────────────────────────────────────────────────

export interface RisultatoRicerca {
  id: string;
  titolo: string;
  sottotitolo: string;
  link: string;
}

export interface GruppoRicerca {
  tipo: string;
  etichetta: string;
  icona: string;
  risultati: RisultatoRicerca[];
}

export interface RispostaRicercaGlobale {
  query: string;
  totale: number;
  gruppi: GruppoRicerca[];
}

/** Ricerca globale: lancia la query e restituisce i risultati raggruppati (THROW su errore). */
export async function ricercaGlobaleApi(query: string): Promise<RispostaRicercaGlobale> {
  const qs = `?q=${encodeURIComponent(query)}`;
  const res = await apiFetch(`${API_BASE}/search${qs}`, { headers: getAuthHeaders() }, 20000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.errore || `Errore ricerca (HTTP ${res.status})`);
  }
  return (await res.json()) as RispostaRicercaGlobale;
}
