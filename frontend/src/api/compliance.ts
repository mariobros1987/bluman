// KYC/AML Fase K0 (Malta, spec v0.2) — client delle impostazioni di compliance dello studio.
// Lettura per i ruoli interni; scrittura riservata ad advisor/super_admin (il backend rifiuta 403
// gli altri). L'audit log è la catena append-only di ComplianceEvent con verifica d'integrità.
import { API_BASE, apiFetch, getAuthHeaders } from './http';

export interface ComplianceSettings {
  id: string;
  tenantId: string;
  jurisdictionPack: string;
  regulatoryProfile: string | null;
  otherSubjectCategory: string | null;
  retentionYears: number;
  mlroUserId: string | null;
  reportingChannel: string;
  screeningProvider: string;
  featureFlags: Record<string, unknown> | null;
  // K2 — configurazione titolare effettivo
  sogliaTitolareEffettivo: number;
  allarmeVariazioniTe: boolean;
  gestioneRegistroTe: boolean;
  versione: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceEvent {
  id: string;
  tenantId: string;
  tipo: string;
  attoreUserId: string | null;
  payload: Record<string, unknown> | null;
  hashPrecedente: string | null;
  hash: string;
  createdAt: string;
}

export interface IntegritaCatena {
  integra: boolean;
  rotturaIndice: number | null;
}

/** Impostazioni compliance dello studio. Il backend crea la riga di default al primo accesso. */
export async function fetchComplianceSettings(): Promise<{ settings: ComplianceSettings; modalitaBozza: boolean }> {
  const res = await apiFetch(`${API_BASE}/tenant/compliance-settings`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura impostazioni di compliance');
  return data;
}

/** Aggiorna le impostazioni (solo advisor/super_admin) e appende un evento alla catena hash. */
export async function salvaComplianceSettings(
  body: Partial<Pick<ComplianceSettings,
    'jurisdictionPack' | 'regulatoryProfile' | 'otherSubjectCategory' | 'retentionYears' | 'mlroUserId' | 'reportingChannel' | 'screeningProvider' | 'sogliaTitolareEffettivo' | 'allarmeVariazioniTe' | 'gestioneRegistroTe'>>
    & { featureFlags?: Record<string, unknown> },
): Promise<{ ok: boolean; settings: ComplianceSettings; modalitaBozza: boolean }> {
  const res = await apiFetch(`${API_BASE}/tenant/compliance-settings`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore salvataggio impostazioni di compliance');
  return data;
}

/** Audit trail append-only, dal più recente, con l'esito della verifica d'integrità della catena. */
export async function fetchComplianceEvents(): Promise<{ eventi: ComplianceEvent[]; catena: IntegritaCatena }> {
  const res = await apiFetch(`${API_BASE}/tenant/compliance-events`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura audit trail di compliance');
  return data;
}

// K9/§5.5 — valutazione del rischio dell'attività (business risk assessment), a livello di studio.
// Versionata e mai sovrascritta: ogni salvataggio crea una nuova versione. Scrittura riservata al
// responsabile/MLRO (il backend rifiuta 403 gli altri); worst-case sui quattro fattori calcolato dal server.
export type LivelloRischioBra = 'basso' | 'medio' | 'alto';
export interface BusinessRiskAssessment {
  id: string;
  versione: number;
  clientelaLivello: LivelloRischioBra; clientelaMotivazione: string | null;
  serviziLivello: LivelloRischioBra; serviziMotivazione: string | null;
  geografiaLivello: LivelloRischioBra; geografiaMotivazione: string | null;
  canaliLivello: LivelloRischioBra; canaliMotivazione: string | null;
  livelloComplessivo: LivelloRischioBra; motivazioneComplessiva: string | null;
  prossimaRevisione: string | null; redattoDa: string | null; createdAt: string;
}

export async function fetchBusinessRisk(): Promise<{ corrente: BusinessRiskAssessment | null; storico: BusinessRiskAssessment[] }> {
  const res = await apiFetch(`${API_BASE}/tenant/business-risk`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura valutazione rischio studio');
  return data;
}

export async function salvaBusinessRisk(body: {
  clientelaLivello: LivelloRischioBra; clientelaMotivazione: string;
  serviziLivello: LivelloRischioBra; serviziMotivazione: string;
  geografiaLivello: LivelloRischioBra; geografiaMotivazione: string;
  canaliLivello: LivelloRischioBra; canaliMotivazione: string;
  motivazioneComplessiva?: string;
}): Promise<{ ok: boolean; corrente: BusinessRiskAssessment }> {
  const res = await apiFetch(`${API_BASE}/tenant/business-risk`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore salvataggio valutazione rischio studio');
  return data;
}

// K9/§5.5 — registro della formazione AML (§7 TrainingRecord). Log a livello di studio; scrittura al
// responsabile/MLRO (il backend rifiuta 403 gli altri). Ogni riga è un evento formativo (non versionato).
export interface TrainingRecord {
  id: string;
  titolo: string;
  tipo: string;
  data: string;
  partecipanti: string | null;
  oreFormazione: string | number | null;
  ente: string | null;
  note: string | null;
  registratoDa: string | null;
  createdAt: string;
}

export async function fetchFormazione(): Promise<{ record: TrainingRecord[] }> {
  const res = await apiFetch(`${API_BASE}/tenant/formazione`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura registro formazione');
  return data;
}

export async function salvaFormazione(body: {
  titolo: string; tipo: string; data: string; partecipanti?: string; oreFormazione?: number; ente?: string; note?: string;
}): Promise<{ ok: boolean; record: TrainingRecord }> {
  const res = await apiFetch(`${API_BASE}/tenant/formazione`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore salvataggio formazione');
  return data;
}

// K9/§5.5 — questionario periodico FIAU (REQ). Una riga per anno; il sistema raccoglie i dati per
// l'MLRO e registra il riferimento dopo l'invio manuale. Scrittura al responsabile/MLRO (403 gli altri).
export interface QuestionarioFiau {
  id: string;
  anno: number;
  stato: 'bozza' | 'completato' | 'trasmesso';
  note: string | null;
  riferimento: string | null;
  trasmessoAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchQuestionariFiau(): Promise<{ questionari: QuestionarioFiau[] }> {
  const res = await apiFetch(`${API_BASE}/tenant/questionario-fiau`, { headers: getAuthHeaders() });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore lettura questionario FIAU');
  return data;
}

export async function salvaQuestionarioFiau(body: {
  anno: number; stato: 'bozza' | 'completato' | 'trasmesso'; note?: string; riferimento?: string;
}): Promise<{ ok: boolean; questionario: QuestionarioFiau }> {
  const res = await apiFetch(`${API_BASE}/tenant/questionario-fiau`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errore || 'Errore salvataggio questionario FIAU');
  return data;
}

/** K9/§5.5 — scarica il report PDF di studio (panoramica AML complessiva, documento interno). */
export async function scaricaReportStudioPdf(): Promise<void> {
  const res = await apiFetch(`${API_BASE}/tenant/compliance-report.pdf`, { headers: getAuthHeaders() });
  if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.errore || 'Errore download report di studio'); }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'report-compliance-studio.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
