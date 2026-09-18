import { useState, useEffect } from 'react';
import { fetchUtentiTenant } from '../api/client';
import { extractInitialsFromName } from '../utils';
import { getCurrentTenantId, getTenantStorageKey } from '../utils/tenant';
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

/**
 * §1ter.6 (C1) — la forma dell'identificativo di un utente a database.
 *
 * `User.id` è `String @id @default(uuid())` (prisma/schema.prisma:164) e `risorsa_id` è una
 * chiave esterna verso di esso: solo un uuid può stare in quella colonna.
 *
 * Non basta che l'id sia una stringa non vuota. `DEFAULT_TEAM_USERS` in `api/tenant.ts` usa
 * `usr-01`…`usr-05`: sono stringhe non vuote, e non sono uuid. Controllando solo il tipo
 * quelle passavano la guardia, e con esse tornava il difetto che questa guardia esiste per
 * chiudere — il menu offriva cinque persone che il database rifiuta. Non è un caso di
 * laboratorio: `fetchUtentiTenant` restituisce `DEFAULT_TEAM_USERS` per il tenant demo ogni
 * volta che l'API non risponde, e lo fa **senza sollevare eccezioni** (il ripiego è dentro di
 * essa, riga 57), quindi il ramo di ripiego qui sotto non scattava mai e l'elenco arrivava
 * pieno di id inassegnabili invece che vuoto.
 *
 * Gli id in produzione hanno tutti questa forma (verificato il 18/09/2026 su `bluman_user`:
 * 7 utenti, 0 fuori forma), quindi la guardia non toglie dal menu nessuna persona reale.
 */
const ID_DATABASE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiUserToTeamMember(u: any, idx: number): TeamMember | null {
  // §1ter.6 (C1) — senza un id di database questo non è un membro dello studio, è una
  // riga di provenienza locale (i `bluman_custom_team_users` salvati prima che l'anagrafica
  // passasse dall'API) o una voce del seed dimostrativo. Non si può assegnare loro niente:
  // `risorsa_id` e `accesso_risorsa` sono chiavi esterne verso `bluman_user`, e un id che
  // non esiste lì viene rifiutato dal database. Tenerli in elenco significava offrire una
  // scelta che non poteva riuscire — ed è esattamente ciò che è successo per mesi, in
  // silenzio. Si scartano, e lo si dice.
  if (typeof u.id !== 'string' || !ID_DATABASE.test(u.id)) {
    console.warn(
      `useTeamMembers: scartato «${u.nome || u.email || idx}» — l'identificativo ` +
        `«${u.id}» non è un id di database, quindi non è assegnabile a un progetto.`,
    );
    return null;
  }

  const name = u.nome || u.name || u.n || u.email || 'Operatore Studio';
  const role = u.specializzazione || u.ruolo || u.role || u.r || 'Collaboratore Studio';

  // La guardia in testa alla funzione ha già stabilito che `u.id` è una stringa con la forma
  // di un uuid: la chiave stabile **è** l'uuid, e i ripieghi su email e indice non sono più
  // raggiungibili. Erano lì per le righe senza id, che ora non arrivano fin qui.
  const memberId = idNumericoStabile(u.id);

  let initials = u.iniziali || u.i;
  if (!initials) {
    initials = extractInitialsFromName(name);
  }
  try {
    const customInitials = localStorage.getItem(`bluman_avatar_initials_${memberId}`);
    if (customInitials) initials = customInitials;
  } catch {}

  let color = u.colore || u.c || ROLE_COLORS[u.ruolo] || ROLE_COLORS[u.role] || coloreDaChiave(u.id);
  try {
    const customColor = localStorage.getItem(`bluman_avatar_color_${memberId}`);
    if (customColor) color = customColor;
  } catch {}

  return {
    id: memberId,
    // §Blocco 7 (fix) — l'id reale a database viaggia accanto a quello UI:
    // le API che richiedono lo userId vero (accessi progetto §19) usano questo.
    // §1ter.6 (C1) — non è più opzionale: la guardia in testa alla funzione ha già escluso
    // le righe che non hanno un id di database, quindi qui la stringa c'è.
    dbId: u.id as string,
    n: name,
    r: role,
    i: initials,
    c: color,
  };
}

export async function loadTeamMembersFromDb(): Promise<TeamMember[]> {
  const currentTenantId = getCurrentTenantId();

  /** Scarta i `null` di `apiUserToTeamMember`: le righe senza id di database non sono membri. */
  const soloAssegnabili = (righe: any[]): TeamMember[] =>
    disambiguaId(righe.map(apiUserToTeamMember).filter((m): m is TeamMember => m !== null));

  // 1. Prova a caricare da API tenant
  try {
    const apiUsers = await fetchUtentiTenant();
    if (Array.isArray(apiUsers) && apiUsers.length > 0) {
      const filtered = apiUsers.filter((u: any) => u.tenantId === currentTenantId);
      if (filtered.length > 0) {
        return soloAssegnabili(filtered);
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
    return soloAssegnabili(customUsers);
  }

  // 3. Nessuna squadra. Ed è la risposta giusta, non una resa.
  //
  // §1ter.6 (C1) — qui c'era una riga costruita con i dati dello studio (il lead advisor,
  // `id: 1`, nessun id di database) che serviva a non mostrare un elenco vuoto. Ma un elenco
  // pieno di una persona che non si può scegliere è peggio di un elenco vuoto: il selettore
  // sembrava funzionante, la scelta sembrava riuscita, e l'unica chiamata che partiva
  // portava un id che il database rifiutava. Se l'API non risponde e non c'è nulla di
  // salvato in locale, le persone di questo studio non sono note a questo browser: il
  // selettore lo dice, invece di riempirsi di un nome che non può assegnare.
  return [];
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
