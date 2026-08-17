import { useState, useEffect } from 'react';
import { fetchUtentiTenant } from '../api/client';
import { TEAM, extractInitialsFromName } from '../store/mockData';
import type { TeamMember } from '../types';

export { extractInitialsFromName };

/**
 * Hook React che carica la lista degli operatori/team members dal database PostgreSQL
 * tramite l'API GET /tenant/utenti e li converte nel formato TeamMember usato dall'app.
 * 
 * Supporta iniziali intelligenti (es. 'MD' per Avv. Mario Dibenedetto) e colori personalizzati.
 */

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#6366f1',
  advisor: '#3b82f6',
  collaboratore_interno: '#ec4899',
  collaboratore_esterno: '#f59e0b',
  cliente: '#94a3b8',
};

// Mappa nota per i membri ufficiali per garantire ID numerici stabili
const KNOWN_MEMBERS_MAP: Record<string, { id: number; initials: string; color: string; defaultRole: string }> = {
  'joe@bluecode.advisory': { id: 1, initials: 'JD', color: '#6366f1', defaultRole: 'Lead Advisor & Senior Partner' },
  'francesca.disabato@bluecode.advisory': { id: 2, initials: 'FD', color: '#ec4899', defaultRole: 'Back Office & Compliance' },
  'francesca@bluecode.advisory': { id: 2, initials: 'FD', color: '#ec4899', defaultRole: 'Back Office & Compliance' },
  'lorenzo.marino@bluecode.advisory': { id: 3, initials: 'LM', color: '#10b981', defaultRole: 'Legal Counsel — Diritto Societario' },
  'lorenzo@bluecode.advisory': { id: 3, initials: 'LM', color: '#10b981', defaultRole: 'Legal Counsel' },
  'elena.russo@bluecode.advisory': { id: 4, initials: 'ER', color: '#f59e0b', defaultRole: 'Tax Advisor & Fiscalità Internazionale' },
  'elena@bluecode.advisory': { id: 4, initials: 'ER', color: '#f59e0b', defaultRole: 'Tax Advisor' },
  'mario.dibenedetto@bluecode.advisory': { id: 5, initials: 'MD', color: '#3b82f6', defaultRole: 'Legal Counsel & Partner' },
};

function apiUserToTeamMember(u: any, idx: number): TeamMember {
  const emailKey = (u.email || '').toLowerCase().trim();
  const known = KNOWN_MEMBERS_MAP[emailKey];

  const name = u.nome || u.name || u.n || (known ? 'Avv. Mario Dibenedetto' : u.email || 'Operatore Studio');
  const role = u.specializzazione || u.ruolo || u.role || u.r || (known?.defaultRole) || 'Collaboratore Studio';

  const memberId = typeof u.id === 'number' ? u.id : (known ? known.id : (typeof u.id === 'string' && u.id.startsWith('usr-0') ? parseInt(u.id.replace('usr-0', ''), 10) : idx + 1));

  // Verifica se l'utente ha configurato iniziali o colore custom nel profilo / local storage
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

// Cache globale per evitare chiamate API ripetute nella stessa sessione
let _cachedTeam: TeamMember[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 15_000; // 15 secondi

export async function loadTeamMembersFromDb(): Promise<TeamMember[]> {
  const now = Date.now();
  if (_cachedTeam && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedTeam;
  }

  try {
    const apiUsers = await fetchUtentiTenant();
    if (Array.isArray(apiUsers) && apiUsers.length > 0) {
      _cachedTeam = apiUsers.map(apiUserToTeamMember);
      _cacheTimestamp = now;
      return _cachedTeam;
    }
  } catch (err) {
    console.warn('useTeamMembers: API offline, fallback a TEAM mock', err);
  }

  // Fallback: TEAM
  return [...TEAM];
}

export function invalidateTeamCache() {
  _cachedTeam = null;
  _cacheTimestamp = 0;
}

export function useTeamMembers(): { team: TeamMember[]; loading: boolean; reload: () => void } {
  const [team, setTeam] = useState<TeamMember[]>(TEAM);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    invalidateTeamCache();
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
