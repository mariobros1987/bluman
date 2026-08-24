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

// §Blocco 7 (fix) — nessun elenco di persone "note" hardcoded nel sorgente.
// L'id numerico stabile (usato dalla UI come chiave e per le personalizzazioni
// avatar in localStorage) deriva da un hash dell'identificativo reale del
// membro; iniziali e colore si ricavano da nome e ruolo. La squadra così
// funziona per qualsiasi tenant senza mappe da mantenere a mano.
const TAVOLOZZA_COLORI = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];

function idNumericoStabile(chiave: string): number {
  let hash = 0;
  for (let i = 0; i < chiave.length; i++) hash = (hash * 31 + chiave.charCodeAt(i)) >>> 0;
  return (hash % 90000) + 1;
}

function coloreDaChiave(chiave: string): string {
  return TAVOLOZZA_COLORI[idNumericoStabile(chiave) % TAVOLOZZA_COLORI.length];
}

// Due hash diversi possono coincidere: se due membri ottengono lo stesso id
// numerico, il secondo riceve un id fuori banda così le key React e le
// personalizzazioni avatar non si mescolano.
function disambiguaId(membri: TeamMember[]): TeamMember[] {
  const visti = new Set<number>();
  return membri.map((m, idx) => {
    if (!visti.has(m.id)) {
      visti.add(m.id);
      return m;
    }
    const nuovo = { ...m, id: 90000 + idx + 1 };
    visti.add(nuovo.id);
    return nuovo;
  });
}

function apiUserToTeamMember(u: any, idx: number): TeamMember {
  const emailKey = (u.email || '').toLowerCase().trim();
  const chiaveStabile = (typeof u.id === 'string' && u.id) || emailKey || `membro-${idx}`;

  const name = u.nome || u.name || u.n || u.email || 'Operatore Studio';
  const role = u.specializzazione || u.ruolo || u.role || u.r || 'Collaboratore Studio';

  const memberId = typeof u.id === 'number' ? u.id : idNumericoStabile(chiaveStabile);

  let initials = u.iniziali || u.i;
  if (!initials) {
    initials = extractInitialsFromName(name);
  }
  try {
    const customInitials = localStorage.getItem(`bluman_avatar_initials_${memberId}`);
    if (customInitials) initials = customInitials;
  } catch {}

  let color = u.colore || u.c || ROLE_COLORS[u.ruolo] || ROLE_COLORS[u.role] || coloreDaChiave(chiaveStabile);
  try {
    const customColor = localStorage.getItem(`bluman_avatar_color_${memberId}`);
    if (customColor) color = customColor;
  } catch {}

  return {
    id: memberId,
    // §Blocco 7 (fix) — l'id reale a database viaggia accanto a quello UI:
    // le API che richiedono lo userId vero (accessi progetto §19) usano questo.
    dbId: typeof u.id === 'string' ? u.id : undefined,
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
        return disambiguaId(filtered.map(apiUserToTeamMember));
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
    return disambiguaId(customUsers.map(apiUserToTeamMember));
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
