// F5 — quando l'API non risponde la Dashboard non mostra dati di prova come reali: niente
// progetti di seed né copie locali, niente «Database Collegato». Mostra l'errore con «Riprova».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/NewProjectWizard', () => ({ NewProjectWizard: () => null }));
vi.mock('../api/client', async () => ({
  fetchProgetti: vi.fn(),
  isRispostaPaginata: (await import('../api/paginazione')).isRispostaPaginata,
}));

import { Dashboard } from './Dashboard';
import { fetchProgetti } from '../api/client';
import { BLUECODE_TENANT_ID, getTenantStorageKey } from '../utils/tenant';

const PROGETTO_LOCALE = { id: 'loc-1', n: 'Pratica Solo Locale', cl: 'Cliente Locale', st: 'in_progress', pct: 0, val: 0, mods: [] };

beforeEach(() => {
  vi.mocked(fetchProgetti).mockReset();
  localStorage.clear();
  // Il tenant demo: è quello per cui prima comparivano i progetti di seed.
  localStorage.setItem('bluman_user', JSON.stringify({ ruolo: 'advisor', tenantId: BLUECODE_TENANT_ID }));
  localStorage.setItem(getTenantStorageKey('bluman_custom_projects', BLUECODE_TENANT_ID), JSON.stringify([PROGETTO_LOCALE]));
});

describe('Dashboard — API non raggiungibile (F5)', () => {
  it('mostra l’errore con «Riprova», nessun progetto e niente «Database Collegato»', async () => {
    vi.mocked(fetchProgetti).mockRejectedValue(new Error('rete giù'));
    render(<Dashboard />);

    expect(await screen.findByText(/I progetti non sono stati caricati: rete giù/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Riprova/ })).toBeInTheDocument();
    expect(screen.queryByText(/Database Collegato/)).toBeNull();
    expect(screen.queryByText('Pratica Solo Locale')).toBeNull();
  });

  it('«Riprova» rilegge e, con il server che risponde, mostra «Database Collegato»', async () => {
    vi.mocked(fetchProgetti)
      .mockRejectedValueOnce(new Error('rete giù'))
      .mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 50, totale: 0, pagine: 0 } } as any);
    render(<Dashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /Riprova/ }));

    expect(await screen.findByText(/Database Collegato/)).toBeInTheDocument();
    expect(fetchProgetti).toHaveBeenCalledTimes(2);
  });
});
