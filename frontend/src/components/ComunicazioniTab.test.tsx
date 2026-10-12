// §7 — la chat di una pratica non deve contenere conversazioni inventate. Qui c'era un
// messaggio di benvenuto che usava il numero WhatsApp vero del cliente come mittente: non si
// distingueva da un messaggio ricevuto. Il test presidia che con zero comunicazioni a database
// la chat resti vuota (e lo dica), e che quando il database ha messaggi veri sia il database a
// riempirla.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from './ui/ToastProvider';
import { ComunicazioniTab } from './ComunicazioniTab';

vi.mock('../api/client', () => ({
  fetchComunicazioniApi: vi.fn(),
  inviaComunicazioneApi: vi.fn(),
  segnaComunicazioniLetteApi: vi.fn(),
  fetchClienti: vi.fn(),
  sendWhatsAppDirectApi: vi.fn(),
  fetchInboundImapEmailsApi: vi.fn(),
  fetchInboundImapAllegatiApi: vi.fn(),
  // Letto dagli hook dei canali dello studio che vivono dentro questa scheda: `null` significa
  // «il server non ha risposto», quindi si scende al ripiego locale — che nei test è vuoto.
  fetchTenantInfoApi: vi.fn().mockResolvedValue(null),
  urlDocumentoAssoluto: (u: string) => u,
}));

import { fetchComunicazioniApi, fetchClienti, fetchInboundImapEmailsApi } from '../api/client';

const mockFetchComunicazioni = fetchComunicazioniApi as ReturnType<typeof vi.fn>;
const mockFetchClienti = fetchClienti as ReturnType<typeof vi.fn>;
const mockFetchImap = fetchInboundImapEmailsApi as ReturnType<typeof vi.fn>;

function mostra() {
  return render(
    <ToastProvider>
      <ComunicazioniTab progettoId="prog-1" nomeCliente="Holding Beta S.r.l." emailCliente="cliente@esempio.test" />
    </ToastProvider>,
  );
}

describe('ComunicazioniTab — nessuna conversazione inventata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchClienti.mockResolvedValue([]);
  });

  it('con zero comunicazioni a database lo dice, invece di mostrare un messaggio finto', async () => {
    mockFetchComunicazioni.mockResolvedValue([]);
    mockFetchImap.mockResolvedValue({ ok: true, email: [] });

    mostra();

    await waitFor(() => expect(screen.getByText(/Nessun messaggio in questa pratica/)).toBeTruthy());
    // Il testo del vecchio messaggio di benvenuto, e soprattutto il destinatario inventato.
    expect(screen.queryByText(/Buongiorno Studio, confermiamo l'avvio/)).toBeNull();
    expect(screen.queryByText(/\+356 79001122/)).toBeNull();
  });

  it('quando il database ha comunicazioni vere è il database a riempire la chat', async () => {
    mockFetchComunicazioni.mockResolvedValue([
      {
        id: 'com-1',
        canale: 'email',
        mittente: 'cliente@esempio.test',
        destinatario: 'studio@esempio.test',
        direzione: 'entrata',
        testo: 'Vi ho inviato i documenti richiesti.',
        createdAt: new Date().toISOString(),
        stato: 'consegnato',
      },
    ]);
    mockFetchImap.mockResolvedValue({ ok: true, email: [] });

    mostra();

    await waitFor(() => expect(screen.getByText(/Vi ho inviato i documenti richiesti\./)).toBeTruthy());
    expect(screen.queryByText(/Nessun messaggio in questa pratica/)).toBeNull();
  });
});
