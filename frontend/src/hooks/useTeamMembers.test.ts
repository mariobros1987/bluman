/**
 * §1ter.6 (C1) — chi può essere assegnato a un compito.
 *
 * Questa guardia esiste perché per mesi il pulsante «assegna operatore» ha offerto persone che
 * il database non poteva accettare: l'elenco veniva riempito con righe il cui `id` non esiste in
 * `bluman_user`, la chiamata veniva rifiutata dalla chiave esterna, e l'errore finiva in un
 * `.catch(() => {})` mentre la finestra annunciava «assegnato con successo». Il presidio che
 * conta è uno solo: **nel menu non deve poter entrare nessuno che non sia un utente vero**, e
 * non basta che l'id sia una stringa — il seed dimostrativo usa `usr-01`.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../api/client', () => ({
  fetchUtentiTenant: vi.fn(),
}));

import { fetchUtentiTenant } from '../api/client';
import { loadTeamMembersFromDb } from './useTeamMembers';

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';

/** Utente reale di questo studio. */
const MARIO = {
  id: '11111111-2222-4333-8444-555555555555',
  nome: 'Mario Dibenedetto',
  ruolo: 'advisor',
  tenantId: TENANT_A,
};

/** Utente reale, ma di un altro studio: non deve comparire nel menu di questo. */
const ALTRO_STUDIO = {
  id: '99999999-8888-4777-8666-555555555555',
  nome: 'Estraneo',
  ruolo: 'advisor',
  tenantId: TENANT_B,
};

/** Il seed dimostrativo di `api/tenant.ts`: una stringa non vuota, e non un id di database. */
const SEED_DEMO = {
  id: 'usr-01',
  nome: 'Joe Disabato',
  ruolo: 'super_admin',
  tenantId: TENANT_A,
};

const apiRestituisce = (righe: unknown[]) =>
  vi.mocked(fetchUtentiTenant).mockResolvedValue(righe as never);

describe('loadTeamMembersFromDb — solo utenti realmente assegnabili', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: TENANT_A }));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    vi.clearAllMocks();
  });

  it('un utente dello studio entra nel menu, con l\'uuid accanto all\'id di interfaccia', async () => {
    apiRestituisce([MARIO]);

    const team = await loadTeamMembersFromDb();

    expect(team).toHaveLength(1);
    // `dbId` è ciò che finisce in `risorsa_id`: deve essere l'uuid, non l'id numerico della UI.
    expect(team[0].dbId).toBe(MARIO.id);
    expect(typeof team[0].id).toBe('number');
    expect(team[0].n).toBe('Mario Dibenedetto');
  });

  it('il seed dimostrativo «usr-01» non entra nel menu: non è un id di database', async () => {
    apiRestituisce([SEED_DEMO]);

    const team = await loadTeamMembersFromDb();

    // Il punto del test. Con la sola verifica «è una stringa non vuota» questa riga passava,
    // e il menu offriva una persona che `risorsa_id` avrebbe rifiutato.
    expect(team).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('una riga senza id non entra nel menu', async () => {
    apiRestituisce([{ nome: 'Collaboratore locale', tenantId: TENANT_A }, { id: '', nome: 'Vuoto', tenantId: TENANT_A }]);

    const team = await loadTeamMembersFromDb();

    expect(team).toEqual([]);
  });

  it('un utente di un altro studio non entra nel menu, anche se l\'API lo restituisce', async () => {
    apiRestituisce([MARIO, ALTRO_STUDIO]);

    const team = await loadTeamMembersFromDb();

    expect(team.map(m => m.dbId)).toEqual([MARIO.id]);
  });

  it('elenco misto: restano solo gli assegnabili, e il menu non si popola di scarti', async () => {
    apiRestituisce([SEED_DEMO, MARIO, ALTRO_STUDIO, { id: 'usr-03', nome: 'Seed 3', tenantId: TENANT_A }]);

    const team = await loadTeamMembersFromDb();

    expect(team).toHaveLength(1);
    expect(team[0].dbId).toBe(MARIO.id);
    // Due righe scartate: il seed e l'utente di un altro studio. Gli scarti si dicono.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('senza API e senza dati locali l\'elenco è vuoto, non un nome inventato', async () => {
    apiRestituisce([]);

    const team = await loadTeamMembersFromDb();

    // Qui c'era una riga costruita con i dati dello studio: un nome che il selettore mostrava,
    // faceva scegliere, e non poteva assegnare.
    expect(team).toEqual([]);
  });
});
