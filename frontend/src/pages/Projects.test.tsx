// F5 — quando l'API non risponde la pagina Progetti non mostra dati di prova come reali: niente
// progetti di seed né copie locali. Mostra l'errore con «Riprova», non «nessuna pratica».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/NewProjectWizard', () => ({ NewProjectWizard: () => null }));
vi.mock('../hooks/useTeamMembers', () => ({ useTeamMembers: () => ({ team: [], loading: false, reload: vi.fn() }) }));
vi.mock('../api/client', () => ({ fetchProgetti: vi.fn() }));

import { Projects } from './Projects';
import { fetchProgetti } from '../api/client';
import { BLUECODE_TENANT_ID, getTenantStorageKey } from '../utils/tenant';

const PROGETTO_LOCALE = { id: 'loc-1', n: 'Pratica Solo Locale', cl: 'Cliente Locale', st: 'in_progress', pct: 0, val: 0, mods: [] };

beforeEach(() => {
  vi.mocked(fetchProgetti).mockReset();
  localStorage.clear();
  localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: BLUECODE_TENANT_ID }));
  localStorage.setItem(getTenantStorageKey('bluman_custom_projects', BLUECODE_TENANT_ID), JSON.stringify([PROGETTO_LOCALE]));
});

describe('Projects — API non raggiungibile (F5)', () => {
  it('mostra l’errore con «Riprova», nessuna pratica di seed o locale, non lo stato vuoto', async () => {
    vi.mocked(fetchProgetti).mockRejectedValue(new Error('rete giù'));
    render(<Projects />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Le pratiche non sono state caricate: rete giù/);
    expect(screen.queryByText('Pratica Solo Locale')).toBeNull();
    expect(screen.queryByText(/Nessuna pratica corrisponde ai filtri/)).toBeNull();
  });

  it('«Riprova» rilegge, e un elenco davvero vuoto mostra lo stato vuoto', async () => {
    vi.mocked(fetchProgetti)
      .mockRejectedValueOnce(new Error('rete giù'))
      .mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 50, totale: 0, pagine: 0 } } as any);
    render(<Projects />);

    fireEvent.click(await screen.findByRole('button', { name: /Riprova/ }));

    expect(await screen.findByText(/Nessuna pratica corrisponde ai filtri/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
