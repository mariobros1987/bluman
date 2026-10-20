// §7 — la chat di una pratica non deve contenere conversazioni inventate. Qui c'era un
// messaggio di benvenuto che usava il numero WhatsApp vero del cliente come mittente: non si
// distingueva da un messaggio ricevuto. Il test presidia che con zero comunicazioni a database
// la chat resti vuota (e lo dica), e che quando il database ha messaggi veri sia il database a
// riempirla.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
  // Lo stream SSE: il componente si sottoscrive al montaggio e chiude allo smontaggio. Il test
  // tiene il callback per poter simulare un frame, come arriverebbe dal backend.
  apriStreamNotifiche: vi.fn(() => () => {}),
  // Letto dagli hook dei canali dello studio che vivono dentro questa scheda: `null` significa
  // «il server non ha risposto», quindi si scende al ripiego locale — che nei test è vuoto.
  fetchTenantInfoApi: vi.fn().mockResolvedValue(null),
  urlDocumentoAssoluto: (u: string) => u,
}));

import { fetchComunicazioniApi, fetchClienti, fetchInboundImapEmailsApi, apriStreamNotifiche } from '../api/client';

const mockFetchComunicazioni = fetchComunicazioniApi as ReturnType<typeof vi.fn>;
const mockFetchClienti = fetchClienti as ReturnType<typeof vi.fn>;
const mockFetchImap = fetchInboundImapEmailsApi as ReturnType<typeof vi.fn>;
const mockApriStream = apriStreamNotifiche as ReturnType<typeof vi.fn>;

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

  it('la chat si aggiorna sul frame SSE della *sua* pratica, e ignora le altre', async () => {
    mockFetchComunicazioni.mockResolvedValue([]);
    mockFetchImap.mockResolvedValue({ ok: true, email: [] });

    mostra();
    await waitFor(() => expect(screen.getByText(/Nessun messaggio in questa pratica/)).toBeTruthy());

    // Il componente si è sottoscritto allo stream: teniamo il callback con cui riceve i frame.
    expect(mockApriStream).toHaveBeenCalledTimes(1);
    const riceviFrame = mockApriStream.mock.calls[0][0] as (e: {
      id: string;
      tipoEvento: string;
      oggetto: string;
      corpo: string;
      link: string;
      createdAt: string;
    }) => void;

    const chiamatePrima = mockFetchComunicazioni.mock.calls.length;

    // Un messaggio su un'altra pratica non deve costare una query né far lampeggiare questa chat.
    act(() => {
      riceviFrame({
        id: 'not-1',
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Nuovo messaggio dal cliente',
        corpo: 'Ha scritto su un altro fascicolo',
        link: '/projects/prog-2',
        createdAt: new Date().toISOString(),
      });
    });
    await new Promise(r => setTimeout(r, 0));
    expect(mockFetchComunicazioni).toHaveBeenCalledTimes(chiamatePrima);

    // Lo stesso evento legato a questa pratica sì: è il percorso che sostituisce il polling.
    mockFetchComunicazioni.mockResolvedValue([
      {
        id: 'com-2',
        canale: 'whatsapp',
        mittente: 'Holding Beta S.r.l.',
        destinatario: 'Studio',
        direzione: 'entrata',
        testo: 'Sono arrivati i documenti firmati.',
        createdAt: new Date().toISOString(),
        stato: 'consegnato',
      },
    ]);
    act(() => {
      riceviFrame({
        id: 'not-2',
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Nuovo messaggio WhatsApp',
        corpo: 'Ha scritto su questa pratica',
        link: '/projects/prog-1',
        createdAt: new Date().toISOString(),
      });
    });
    await waitFor(() => expect(screen.getByText(/Sono arrivati i documenti firmati\./)).toBeTruthy());
  });
});
