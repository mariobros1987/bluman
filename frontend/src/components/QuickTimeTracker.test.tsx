// Il ripiego dimostrativo del Time Tracker — i due progetti finti di Bluecode Ltd presi da
// `getTenantSeedData` — non deve scattare quando il database **risponde** che non ci sono
// progetti: quello è un fatto, non un guasto. Deve restare vivo solo per la demo offline,
// quando l'API non risponde affatto: è la stessa regola degli altri tre punti che leggono il
// seed (Projects, Dashboard, ClientsPage), e qui mancava.
//
// Il 12/10/2026 la produzione è passata al VPS e il suo database è stato azzerato: da quel
// momento «database vuoto» ha smesso di essere un caso teorico, e il ripiego senza guardia ha
// cominciato a mostrare «Progetto Structuring Holding Malta» accanto ad «Avvia Time Tracker»
// come se fosse una pratica vera (regola 7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

/** Un nome che esiste solo nel seed: se compare in pagina, il ripiego ha parlato. */
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

describe('QuickTimeTracker — i progetti dimostrativi non coprono un database vuoto', () => {
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

  it('con l\'API irraggiungibile il seed resta, così la demo offline funziona ancora', async () => {
    mockFetchProgetti.mockRejectedValue(new Error('rete assente'));

    mostraTracker(BLUECODE_TENANT_ID);

    await waitFor(() => expect(screen.getByText(NOME_DEL_SEED)).toBeTruthy());
    expect(screen.queryByText(/Crea Pratica/)).toBeNull();
  });

  it('su un altro studio il seed non compare nemmeno con l\'API irraggiungibile', async () => {
    mockFetchProgetti.mockRejectedValue(new Error('rete assente'));

    mostraTracker(ALTRO_TENANT);

    await waitFor(() => expect(screen.getByText(/Crea Pratica/)).toBeTruthy());
    expect(screen.queryByText(NOME_DEL_SEED)).toBeNull();
  });
});
