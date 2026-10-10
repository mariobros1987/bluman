// Voce 8-bis — il riquadro della copia di sicurezza in Impostazioni → Manutenzione.
//
// Questa schermata la vede ogni ruolo, quindi il test presidia la distinzione che la rende
// sopportabile: **403 = non ti riguarda** (niente riquadro, nessuna spiegazione da leggere), e
// **guasto = non lo so** (lo si dice). Confonderle è il modo in cui un'informazione mancante
// passa per «tutto a posto», che è la regola 7 applicata a una riga di testo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TabManutenzione } from './TabManutenzione';
import { fetchStatoBackupTitolareApi } from '../../api/backup';

vi.mock('../../api/backup', async importOriginal => {
  const reale = await importOriginal<typeof import('../../api/backup')>();
  return { ...reale, fetchStatoBackupTitolareApi: vi.fn() };
});

const mockStato = fetchStatoBackupTitolareApi as ReturnType<typeof vi.fn>;

const props = {
  chiaviLocali: [] as string[],
  setChiaviLocali: vi.fn(),
  chiaviRimosse: null as string[] | null,
  setChiaviRimosse: vi.fn(),
  confermaSvuota: false,
  setConfermaSvuota: vi.fn(),
};

/** L'errore che il client API solleva: porta con sé lo `status`, ed è quello che distingue un
 *  permesso mancante da un guasto. */
const erroreCon = (status: number, messaggio: string) =>
  Object.assign(new Error(messaggio), { status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TabManutenzione — riquadro della copia di sicurezza', () => {
  it('a un ruolo senza permesso non mostra niente, e la scheda resta quella di prima', async () => {
    mockStato.mockRejectedValue(erroreCon(403, 'Lo stato della copia di sicurezza è visibile al responsabile dello studio.'));
    render(<TabManutenzione {...props} />);

    await waitFor(() => expect(mockStato).toHaveBeenCalledTimes(1));
    // Nessun riquadro, nessun messaggio di permesso negato: una spiegazione qui sarebbe rumore
    // su una schermata che parla dei dati locali del browser.
    await waitFor(() => expect(screen.queryByText('Copia di sicurezza')).toBeNull());
    expect(screen.queryByText(/responsabile dello studio/)).toBeNull();
    expect(screen.getByText(/Dati di lavoro salvati in questo browser/)).toBeInTheDocument();
  });

  it('al titolare mostra la freschezza, con la frase calcolata dai dati del server', async () => {
    mockStato.mockResolvedValue({
      disponibile: true,
      copiaConfigurata: true,
      backup: {
        esito: 'ok',
        quando: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        file: null,
        byte: null,
        copiaOffSite: 'ok',
        dettaglio: 'backup completato',
      },
      verifica: {
        stato: 'unknown',
        quando: null,
        ore: null,
        file: null,
        dettaglio: 'rclone non è installato su questo server',
      },
    });
    render(<TabManutenzione {...props} />);

    expect(await screen.findByText('Copia di sicurezza')).toBeInTheDocument();
    expect(screen.getByText(/verifica non ancora disponibile/i)).toBeInTheDocument();
    expect(screen.getByText(/rclone non è installato/)).toBeInTheDocument();
  });

  it('una copia vecchia è mostrata come vecchia, non come «tutto a posto»', async () => {
    mockStato.mockResolvedValue({
      disponibile: true,
      copiaConfigurata: true,
      backup: {
        esito: 'ok',
        quando: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        file: null,
        byte: null,
        copiaOffSite: 'ok',
        dettaglio: 'backup completato',
      },
      verifica: {
        stato: 'fail',
        quando: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        ore: 14 * 24,
        file: null,
        dettaglio: 'la copia più recente sul remoto ha 336 ore',
      },
    });
    render(<TabManutenzione {...props} />);

    expect(await screen.findByText(/fuori dal server non è aggiornata/i)).toBeInTheDocument();
    expect(screen.getByText(/la copia più recente sul remoto ha 336 ore/)).toBeInTheDocument();
  });

  it('un guasto vero si dice: non è la stessa cosa di «non ti riguarda»', async () => {
    mockStato.mockRejectedValue(erroreCon(500, 'Errore interno del server'));
    render(<TabManutenzione {...props} />);

    expect(await screen.findByText(/Errore interno del server/)).toBeInTheDocument();
    // E il resto della scheda resta utilizzabile: il guasto riguarda una riga, non la pagina.
    expect(screen.getByText(/Dati di lavoro salvati in questo browser/)).toBeInTheDocument();
  });

  it('un backend che non esegue i backup lo dichiara invece di tacere', async () => {
    mockStato.mockResolvedValue({
      disponibile: false,
      copiaConfigurata: false,
      backup: {
        esito: 'sconosciuto', quando: null, file: null, byte: null,
        copiaOffSite: 'sconosciuto', dettaglio: 'nessuna informazione leggibile',
      },
      verifica: {
        stato: 'unknown', quando: null, ore: null, file: null,
        dettaglio: 'nessuna informazione leggibile',
      },
    });
    render(<TabManutenzione {...props} />);

    expect(await screen.findByText(/non verificabile da qui/i)).toBeInTheDocument();
  });
});
