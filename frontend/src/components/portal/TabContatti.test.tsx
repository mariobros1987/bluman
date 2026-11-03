// 3.20 — nel portale cliente il polling della chat segnava come letti i messaggi dello studio
// dentro un `.catch(() => {})`: se il server rifiutava, lo studio continuava a vederli «non letti»
// e il cliente non lo sapeva. Lo stesso per la lettura dei messaggi. Ora l'errore si mostra, una
// volta sola per tipo finché la chiamata non torna a riuscire.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../ui/ToastProvider';
import { TabContatti } from './TabContatti';

vi.mock('../../api/client', () => ({
  inviaComunicazioneApi: vi.fn(),
  fetchComunicazioniApi: vi.fn(),
  segnaComunicazioniLetteApi: vi.fn(),
}));
vi.mock('../../api/documenti', () => ({
  uploadFileApi: vi.fn(),
  urlDocumentoAssoluto: (u: string) => u,
}));

import { fetchComunicazioniApi, segnaComunicazioniLetteApi } from '../../api/client';

const mockFetch = fetchComunicazioniApi as ReturnType<typeof vi.fn>;
const mockSegnaLette = segnaComunicazioniLetteApi as ReturnType<typeof vi.fn>;

function mostra() {
  return render(
    <ToastProvider>
      <TabContatti
        contattiStudio={null}
        messaggi={[]}
        setMessaggi={() => {}}
        nuovoMessaggio=""
        setNuovoMessaggio={() => {}}
        inviandoMessaggio={false}
        setInviandoMessaggio={() => {}}
        canaleMessaggio="portal"
        setCanaleMessaggio={() => {}}
        clientName="Alfa Srl"
        clientObj={null}
        progettoId="prog-1"
      />
    </ToastProvider>,
  );
}

describe('TabContatti (portale) — gli errori del polling si dicono', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('messaggi dello studio non segnati come letti: compare l\'errore', async () => {
    mockFetch.mockResolvedValue([
      { id: 'm1', direzione: 'uscita', stato: 'consegnato', testo: 'Ecco il preventivo.', createdAt: new Date().toISOString() },
    ]);
    mockSegnaLette.mockRejectedValue(new Error('Sessione scaduta'));

    mostra();

    await waitFor(() => expect(screen.getByText(/Messaggi non segnati come letti: Sessione scaduta/)).toBeTruthy());
    expect(mockSegnaLette).toHaveBeenCalledWith('prog-1', 'uscita');
  });

  it('lettura dei messaggi fallita: compare l\'errore', async () => {
    mockFetch.mockRejectedValue(new Error('Server non raggiungibile'));

    mostra();

    await waitFor(() => expect(screen.getByText(/Messaggi non aggiornati: Server non raggiungibile/)).toBeTruthy());
  });
});
