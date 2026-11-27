// F5 — quando l'API non risponde la Dashboard non mostra dati di prova come reali: niente
// progetti di seed né copie locali, nessuna riga «Dati aggiornati». Mostra l'errore con «Riprova».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../components/NewProjectWizard', () => ({ NewProjectWizard: () => null }));
vi.mock('../api/client', async () => ({
  fetchProgetti: vi.fn(),
  // Il riquadro «Da fare oggi» legge rate e fatture d'acquisto: qui non interessano.
  fetchScadenzarioIncassiApi: vi.fn(async () => []),
  fetchFattureRicevuteApi: vi.fn(async () => []),
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
  it('mostra l’errore con «Riprova», nessun progetto e nessuna riga «Dati aggiornati»', async () => {
    vi.mocked(fetchProgetti).mockRejectedValue(new Error('rete giù'));
    render(<Dashboard />);

    expect(await screen.findByText(/I progetti non sono stati caricati: rete giù/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Riprova/ })).toBeInTheDocument();
    expect(screen.queryByText(/Dati aggiornati alle/)).toBeNull();
    expect(screen.queryByText('Pratica Solo Locale')).toBeNull();
  });

  it('«Riprova» rilegge e, con il server che risponde, mostra quando ha letto i dati', async () => {
    vi.mocked(fetchProgetti)
      .mockRejectedValueOnce(new Error('rete giù'))
      .mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 50, totale: 0, pagine: 0 } } as any);
    render(<Dashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /Riprova/ }));

    // Non una scritta fissa: l'ora dell'ultima lettura riuscita (prima: «Enterprise Cloud Database Collegato»).
    expect(await screen.findByText(/Dati aggiornati alle \d{2}:\d{2}/)).toBeInTheDocument();
    expect(fetchProgetti).toHaveBeenCalledTimes(2);
  });
});

describe('Dashboard — contatori', () => {
  const progetto = (id: string, stato: string) => ({
    id, nome: `Pratica ${id}`, tenantId: BLUECODE_TENANT_ID, stato, moduli: [],
    avanzamento: { stato, percentuale: 40, moduli: [] },
  });

  it('«Progetti attivi» non conta gli archiviati', async () => {
    vi.mocked(fetchProgetti).mockResolvedValue({
      data: [progetto('a', 'in_progress'), progetto('b', 'archived')],
      meta: { page: 1, limit: 50, totale: 2, pagine: 1 },
    } as any);
    render(<Dashboard />);
    const etichetta = await screen.findByText('Progetti attivi');
    expect(etichetta.parentElement).toHaveTextContent('1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('se il periodo ha più progetti di quelli letti, lo dice', async () => {
    vi.mocked(fetchProgetti).mockResolvedValue({
      data: [progetto('a', 'in_progress')],
      meta: { page: 1, limit: 50, totale: 120, pagine: 3 },
    } as any);
    render(<Dashboard />);
    expect(await screen.findByRole('status')).toHaveTextContent('1 progetti più recenti su 120');
  });

  it('nell\'errore non c\'è più l\'indirizzo email scritto a mano', async () => {
    vi.mocked(fetchProgetti).mockRejectedValue(new Error('rete giù'));
    render(<Dashboard />);
    await screen.findByRole('button', { name: /Riprova/ });
    expect(screen.queryByText(/Contatta Amministratore/)).toBeNull();
  });
});
