// F6 — un errore di caricamento non è «nessun conto configurato». Prima `fetchContiBancariApi`
// ingoiava l'errore e restituiva [], e la pagina invitava a creare il primo conto anche quando
// il database non rispondeva.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api/client', () => ({
  fetchContiBancariApi: vi.fn(),
  creaContoBancarioApi: vi.fn(),
}));
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ successo: vi.fn(), errore: vi.fn(), info: vi.fn() }),
}));

import { BanksPage } from './BanksPage';
import { fetchContiBancariApi } from '../api/client';

beforeEach(() => {
  vi.mocked(fetchContiBancariApi).mockReset();
});

describe('BanksPage — errore di caricamento distinto dal vuoto (F6)', () => {
  it('chiede la variante che rigetta e su errore mostra «Riprova», non «Nessun conto»', async () => {
    vi.mocked(fetchContiBancariApi).mockRejectedValueOnce(new Error('Errore recupero conti bancari'));
    render(<BanksPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Impossibile caricare i conti bancari/);
    expect(screen.queryByText(/Nessun conto bancario configurato/)).toBeNull();
    expect(fetchContiBancariApi).toHaveBeenCalledWith({ rigettaSuErrore: true });
  });

  it('«Riprova» rilegge, e un elenco davvero vuoto mostra lo stato vuoto', async () => {
    vi.mocked(fetchContiBancariApi)
      .mockRejectedValueOnce(new Error('Errore recupero conti bancari'))
      .mockResolvedValueOnce([]);
    render(<BanksPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));

    expect(await screen.findByText(/Nessun conto bancario configurato/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchContiBancariApi).toHaveBeenCalledTimes(2);
  });
});
