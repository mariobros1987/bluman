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
    'jurisdictionPack' | 'regulatoryProfile' | 'otherSubjectCategory' | 'retentionYears' | 'mlroUserId' | 'reportingChannel' | 'screeningProvider'>>
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
