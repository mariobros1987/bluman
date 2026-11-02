// 3.7 — il Time Tracker non mostra mai i progetti dimostrativi di Bluecode Ltd. Prima
// `getTenantSeedData` scattava con l'API irraggiungibile e permetteva di avviare il timer su
// «Progetto Structuring Holding Malta», una pratica che non esiste. Ora: database vuoto → invito
// a creare una pratica; server muto → «progetti non caricati» e timer bloccato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from './ui/ToastProvider';
import { QuickTimeTracker } from './QuickTimeTracker';
import { BLUECODE_TENANT_ID } from '../utils/tenant';

vi.mock('../api/client', () => ({
  fetchProgetti: vi.fn(),
  salvaProgettoDettaglioApi: vi.fn(),
}));

import { fetchProgetti } from '../api/client';

const mockFetchProgetti = fetchProgetti as ReturnType<typeof vi.fn>;

const ALTRO_TENANT = '11111111-1111-1111-1111-111111111111';

/** Un nome che esisteva solo nel seed: se compare in pagina, il ripiego ha parlato. */
const NOME_DEL_SEED = /Structuring Holding Malta/;

function mostraTracker(tenantId: string) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <QuickTimeTracker user={{ id: 1, ruolo: 'advisor', tenantId }} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('QuickTimeTracker — niente progetti dimostrativi (3.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('col database che risponde zero progetti non mostra il seed né la tendina', async () => {
    mockFetchProgetti.mockResolvedValue([]);

    mostraTracker(BLUECODE_TENANT_ID);

    // Il segnale che ha finito di caricare: senza progetti compare l'invito a crearne uno.
    await waitFor(() => expect(screen.getByText(/Crea Pratica/)).toBeTruthy());
    expect(screen.queryByText(NOME_DEL_SEED)).toBeNull();
    expect(screen.queryByTitle('Seleziona la pratica su cui registrare il tempo')).toBeNull();
  });

  it('con l\'API irraggiungibile niente seed: «progetti non caricati» e timer non avviabile', async () => {
    mockFetchProgetti.mockRejectedValue(new Error('rete assente'));

    mostraTracker(BLUECODE_TENANT_ID);

    await waitFor(() => expect(screen.getByText(/Progetti non caricati/)).toBeTruthy());
    expect(screen.queryByText(NOME_DEL_SEED)).toBeNull();
    const avvia = screen.getByTitle('Avvia Time Tracker');
    expect(avvia).toBeDisabled();
    fireEvent.click(avvia);
    expect(screen.queryByTitle('Pausa Timer')).toBeNull();
  });

  it('«Riprova» rilegge i progetti e, se il server risponde, sblocca il timer', async () => {
    mockFetchProgetti
      .mockRejectedValueOnce(new Error('rete assente'))
      .mockResolvedValueOnce([{ id: 'p-1', tenantId: BLUECODE_TENANT_ID, nome: 'Pratica vera', cliente: { nome: 'Cliente Vero' }, moduli: [] }]);

    mostraTracker(BLUECODE_TENANT_ID);

    fireEvent.click(await screen.findByText(/Progetti non caricati/));
    await waitFor(() => expect(screen.getByTitle('Seleziona la pratica su cui registrare il tempo')).toBeTruthy());
    expect(screen.getByTitle('Avvia Time Tracker')).not.toBeDisabled();
  });

  it('su un altro studio, con l\'API irraggiungibile, stesso avviso e nessun seed', async () => {
    mockFetchProgetti.mockRejectedValue(new Error('rete assente'));

    mostraTracker(ALTRO_TENANT);

    await waitFor(() => expect(screen.getByText(/Progetti non caricati/)).toBeTruthy());
    expect(screen.queryByText(NOME_DEL_SEED)).toBeNull();
  });
});
