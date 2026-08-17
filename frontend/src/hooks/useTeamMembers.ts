import { useState, useEffect } from 'react';
import { fetchUtentiTenant } from '../api/client';
import { TEAM } from '../store/mockData';
import type { TeamMember } from '../types';

/**
 * Hook React che carica la lista degli operatori/team members dal database PostgreSQL
 * tramite l'API GET /tenant/utenti e li converte nel formato TeamMember usato dall'app.
 * 
 * Fallback: se l'API è offline, usa il TEAM hardcoded come ultima risorsa.
 * 
 * Questo hook è la SINGOLA SORGENTE DI VERITÀ per la lista operatori in tutta l'app.
 */

// Colori assegnati per ruolo
const ROLE_COLORS: Record<string, string> = {
  super_admin: '#6366f1',
  advisor: '#10b981',
  collaboratore_interno: '#ec4899',
  collaboratore_esterno: '#f59e0b',
  cliente: '#94a3b8',
};

function apiUserToTeamMember(u: any, idx: number): TeamMember {
  const name = u.nome || u.name || u.email || 'Operatore';
  const role = u.specializzazione || u.ruolo || u.role || 'Collaboratore';
  const initials = name
    .split(' ')
    .filter((p: string) => p.length > 0 && p[0] === p[0].toUpperCase())
    .map((p: string) => p[0])
    .join('')
    .slice(0, 2) || 'OP';
  const color = ROLE_COLORS[u.ruolo] || ROLE_COLORS[u.role] || '#8b5cf6';

  return {
    id: typeof u.id === 'number' ? u.id : idx + 1,
    n: name,
    r: role,
    i: initials,
    c: color,
  };
}

// Cache globale per evitare chiamate API ripetute nella stessa sessione
let _cachedTeam: TeamMember[] | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 secondi

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

  // Fallback: TEAM hardcoded (solo se API completamente offline)
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
