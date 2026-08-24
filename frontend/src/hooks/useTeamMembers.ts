import { useState, useEffect } from 'react';
import { fetchUtentiTenant } from '../api/client';
import { extractInitialsFromName } from '../utils';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant } from '../utils/tenant';
import type { TeamMember } from '../types';

export { extractInitialsFromName };

/**
 * Hook React che carica la lista degli operatori/team members isolati per Tenant
 */

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#6366f1',
  advisor: '#3b82f6',
  collaboratore_interno: '#ec4899',
  collaboratore_esterno: '#f59e0b',
  cliente: '#94a3b8',
};

// Mappa nota per i membri per garantire ID numerici stabili
const KNOWN_MEMBERS_MAP: Record<string, { id: number; initials: string; color: string; defaultRole: string }> = {
  'joe@bluecode.advisory': { id: 1, initials: 'JD', color: '#6366f1', defaultRole: 'Lead Advisor & Senior Partner' },
  'francesca.disabato@bluecode.advisory': { id: 2, initials: 'FD', color: '#ec4899', defaultRole: 'Back Office & Compliance' },
  'francesca@bluecode.advisory': { id: 2, initials: 'FD', color: '#ec4899', defaultRole: 'Back Office & Compliance' },
  'lorenzo.marino@bluecode.advisory': { id: 3, initials: 'LM', color: '#10b981', defaultRole: 'Legal Counsel — Diritto Societario' },
  'lorenzo.marino@advisory.it': { id: 3, initials: 'LM', color: '#10b981', defaultRole: 'Lead Partner — Advisory Italia' },
  'elena.russo@bluecode.advisory': { id: 4, initials: 'ER', color: '#f59e0b', defaultRole: 'Tax Advisor & Fiscalità Internazionale' },
  'elena.russo@swisswealth.ch': { id: 4, initials: 'ER', color: '#f59e0b', defaultRole: 'Lead Partner — Swiss Wealth SA' },
  'mario.dibenedetto@bluecode.advisory': { id: 5, initials: 'MD', color: '#3b82f6', defaultRole: 'Legal Counsel & Partner' },
};

function apiUserToTeamMember(u: any, idx: number): TeamMember {
  const emailKey = (u.email || '').toLowerCase().trim();
  const known = KNOWN_MEMBERS_MAP[emailKey];

  const name = u.nome || u.name || u.n || (known ? 'Avv. Mario Dibenedetto' : u.email || 'Operatore Studio');
  const role = u.specializzazione || u.ruolo || u.role || u.r || (known?.defaultRole) || 'Collaboratore Studio';

  const memberId = typeof u.id === 'number' ? u.id : (known ? known.id : (typeof u.id === 'string' && u.id.startsWith('usr-0') ? parseInt(u.id.replace('usr-0', ''), 10) : idx + 1));

  let initials = known?.initials || u.iniziali || u.i;
  if (!initials) {
    initials = extractInitialsFromName(name);
  }
  try {
    const customInitials = localStorage.getItem(`bluman_avatar_initials_${memberId}`);
    if (customInitials) initials = customInitials;
  } catch {}

  let color = known?.color || u.colore || u.c || ROLE_COLORS[u.ruolo] || ROLE_COLORS[u.role] || '#8b5cf6';
  try {
    const customColor = localStorage.getItem(`bluman_avatar_color_${memberId}`);
    if (customColor) color = customColor;
  } catch {}

  return {
    id: memberId,
    n: name,
    r: role,
    i: initials,
    c: color,
  };
}

export async function loadTeamMembersFromDb(): Promise<TeamMember[]> {
  const currentTenantId = getCurrentTenantId();
  const studioInfo = getStudioInfoForTenant(currentTenantId);

  // 1. Prova a caricare da API tenant
  try {
    const apiUsers = await fetchUtentiTenant();
    if (Array.isArray(apiUsers) && apiUsers.length > 0) {
      const filtered = apiUsers.filter((u: any) => u.tenantId === currentTenantId);
      if (filtered.length > 0) {
        return filtered.map(apiUserToTeamMember);
      }
    }
  } catch (err) {
    console.warn('useTeamMembers: API offline, uso isolamento locale', err);
  }

  // 2. Carica eventuali collaboratori salvati localmente per questo tenant
  const teamStorageKey = getTenantStorageKey('bluman_custom_team_users', currentTenantId);
  const customStr = localStorage.getItem(teamStorageKey);
  const customUsers: any[] = customStr ? JSON.parse(customStr) : [];

  if (customUsers.length > 0) {
    return customUsers.map(apiUserToTeamMember);
  }

  // 3. Fallback per tenant: niente squadra finta precostituita. Se l'API non risponde e
  // non ci sono collaboratori salvati in locale, si mostra solo il lead advisor del tenant,
  // costruito dai dati dello studio — mai un elenco di persone inventate nel sorgente.
  return [
    {
      id: 1,
      n: studioInfo.leadAdvisor || 'Lead Senior Advisor',
      r: `Managing Partner — ${studioInfo.ragioneSociale}`,
      i: extractInitialsFromName(studioInfo.leadAdvisor || 'Lead Advisor'),
      c: '#3b82f6',
    }
  ];
}

export function useTeamMembers(): { team: TeamMember[]; loading: boolean; reload: () => void } {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    loadTeamMembersFromDb().then(t => {
      setTeam(t);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadTeamMembersFromDb().then(t => {
      setTeam(t);
      setLoading(false);
    });
  }, []);

  return { team, loading, reload };
}
