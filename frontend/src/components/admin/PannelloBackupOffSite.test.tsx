// Voce 8-bis — il pannello del super admin per la copia off-site.
//
// Le API sono mockate: qui si presidia il COMPORTAMENTO del pannello, che è fatto di tre
// promesse. La prima: il token si incolla e non si rilegge **mai** — nemmeno se il server,
// sbagliando, lo restituisse; per questo il test gli mette in risposta un campo `token` e
// pretende che il campo resti vuoto. La seconda: un backend che non vede la cartella lo dice e
// disabilita il salvataggio, invece di far credere che sia arrivato da qualche parte (regola 7).
// La terza: il campo si svuota dopo il salvataggio anche se è fallito, perché un token lasciato
// a schermo è un token in una schermata condivisa.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../ui/ToastProvider';
import { ConfirmProvider } from '../ui/ConfirmProvider';
import { PannelloBackupOffSite } from './PannelloBackupOffSite';
import {
  disattivaTokenBackupApi,
  fetchStatoBackupAdminApi,
  salvaTokenBackupApi,
  type StatoBackupAdmin,
} from '../../api/backup';

vi.mock('../../api/backup', async importOriginal => {
  const reale = await importOriginal<typeof import('../../api/backup')>();
  // `formattaByte` resta quello vero: è una funzione pura e verificarla qui non direbbe niente
  // sul componente. Le tre chiamate di rete invece si sostituiscono tutte.
  return {
    ...reale,
    fetchStatoBackupAdminApi: vi.fn(),
    salvaTokenBackupApi: vi.fn(),
    disattivaTokenBackupApi: vi.fn(),
  };
});

const mockStato = fetchStatoBackupAdminApi as ReturnType<typeof vi.fn>;
const mockSalva = salvaTokenBackupApi as ReturnType<typeof vi.fn>;
const mockDisattiva = disattivaTokenBackupApi as ReturnType<typeof vi.fn>;

const TOKEN_INCOLLATO = '{"access_token":"x","refresh_token":"y"}';

function statoDiProva(patch: Partial<StatoBackupAdmin> = {}): StatoBackupAdmin {
  return {
    cartellaConfigurazione: '/app/backup-config',
    cartellaStato: '/app/backup-stato',
    configurazioneDisponibile: true,
    statoDisponibile: true,
    destinazione: 'dropbox:bluman-backup',
    configurato: true,
    configuratoIl: '2026-10-01T09:00:00.000Z',
    disponibile: true,
    copiaConfigurata: true,
    backup: {
      esito: 'ok',
      quando: '2026-10-10T03:17:00.000Z',
      file: 'bluman-2026-10-10.sql.gz.enc',
      byte: 1_500_000,
      copiaOffSite: 'ok',
      dettaglio: 'backup completato',
    },
    verifica: {
      stato: 'ok',
      quando: '2026-10-10T08:00:00.000Z',
      ore: 4,
      file: 'bluman-2026-10-10.sql.gz.enc',
      dettaglio: 'la copia più recente sul remoto ha 4 ore',
    },
    ...patch,
  };
}

const disegna = () => render(
  <ToastProvider>
    <ConfirmProvider>
      <PannelloBackupOffSite />
    </ConfirmProvider>
  </ToastProvider>,
);

const campo = () => document.querySelector('textarea') as HTMLTextAreaElement;

/** Il pulsante cambia parola secondo che ci sia già una credenziale o no: «Salva» la prima
 *  volta, «Sostituisci» dopo. Il test non deve dipendere da quale delle due è. */
const pulsanteSalva = () => screen.getByRole('button', { name: /(Salva|Sostituisci) credenziale/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PannelloBackupOffSite — cosa mostra', () => {
  it('un errore di lettura si dice, non si maschera con uno stato vuoto', async () => {
    mockStato.mockRejectedValue(new Error('Server irraggiungibile'));
    disegna();

    expect(await screen.findByText(/Server irraggiungibile/)).toBeInTheDocument();
    // Nessun riquadro di stato: mostrarlo vuoto farebbe sembrare «non configurato» un guasto.
    expect(screen.queryByText('Stato')).toBeNull();
  });

  it('lo stato verificato dal monitor è mostrato con la sua freschezza ricalcolata', async () => {
    mockStato.mockResolvedValue(statoDiProva({
      verifica: {
        stato: 'ok',
        quando: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        ore: 4,
        file: null,
        dettaglio: 'la copia più recente sul remoto ha 4 ore',
      },
    }));
    disegna();

    expect(await screen.findByText(/Copia di sicurezza: ultima copia 6 ore fa/)).toBeInTheDocument();
    // Le due cose che si leggono insieme e che non vanno confuse.
    expect(screen.getByText('Copia sul remoto')).toBeInTheDocument();
    expect(screen.getByText('Verifica del monitor')).toBeInTheDocument();
  });

  it('la destinazione mancante si vede come mancante, non come stringa vuota', async () => {
    mockStato.mockResolvedValue(statoDiProva({ destinazione: null }));
    disegna();

    expect(await screen.findByText(/non impostata \(BLUMAN_BACKUP_RCLONE_REMOTE\)/)).toBeInTheDocument();
  });

  it('dove la cartella non c’è lo dichiara e disabilita il salvataggio', async () => {
    // È il caso di Railway: la credenziale non arriverebbe mai al backup notturno, e un
    // salvataggio che «riesce» sarebbe la bugia peggiore.
    mockStato.mockResolvedValue(statoDiProva({ configurazioneDisponibile: false }));
    disegna();

    expect(await screen.findByText(/Questo backend non vede la cartella della credenziale/)).toBeInTheDocument();
    expect(screen.getByText(/\/app\/backup-config/)).toBeInTheDocument();
    expect(pulsanteSalva()).toBeDisabled();
  });

  it('un backup fallito è mostrato come fallito, col dettaglio del backup', async () => {
    mockStato.mockResolvedValue(statoDiProva({
      backup: {
        esito: 'fallito',
        quando: null,
        file: null,
        byte: null,
        copiaOffSite: 'saltata',
        dettaglio: 'il dump del database non è stato completato',
      },
    }));
    disegna();

    expect(await screen.findByText(/L’ultimo backup notturno è fallito/)).toBeInTheDocument();
    expect(screen.getByText(/il dump del database non è stato completato/)).toBeInTheDocument();
  });
});

describe('PannelloBackupOffSite — il campo del token', () => {
  it('non viene mai precompilato, nemmeno se il server lo restituisse', async () => {
    // Il server non lo restituisce, e questo test tiene ferma la promessa da entrambi i lati:
    // se un giorno una risposta lo contenesse, il pannello non lo metterebbe a schermo.
    mockStato.mockResolvedValue({ ...statoDiProva(), token: 'valore-che-non-dovrebbe-esserci' } as StatoBackupAdmin);
    disegna();

    await waitFor(() => expect(mockStato).toHaveBeenCalledTimes(1));
    expect(campo().value).toBe('');
    expect(document.body.textContent).not.toContain('valore-che-non-dovrebbe-esserci');
  });

  it('salva il testo incollato, svuota il campo e rilegge lo stato', async () => {
    mockStato.mockResolvedValue(statoDiProva({ configurato: false, configuratoIl: null }));
    mockSalva.mockResolvedValue({ messaggio: 'Credenziale salvata.', configuratoIl: '2026-10-10T12:00:00.000Z' });
    disegna();

    const salva = await screen.findByRole('button', { name: /Salva credenziale/i });
    fireEvent.change(campo(), { target: { value: TOKEN_INCOLLATO } });
    fireEvent.click(salva);

    await waitFor(() => expect(mockSalva).toHaveBeenCalledWith(TOKEN_INCOLLATO));
    await waitFor(() => expect(campo().value).toBe(''));
    // Rileggere lo stato è il punto: «salvato» senza rileggere lascerebbe sullo schermo la
    // fotografia di prima.
    expect(mockStato).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Credenziale salvata.')).toBeInTheDocument();
  });

  it('un salvataggio fallito svuota comunque il campo e non annuncia un successo', async () => {
    mockStato.mockResolvedValue(statoDiProva({ configurato: false }));
    mockSalva.mockRejectedValue(new Error('Manca `refresh_token`: senza, la copia si fermerebbe senza avvisare.'));
    disegna();

    const salva = await screen.findByRole('button', { name: /Salva credenziale/i });
    fireEvent.change(campo(), { target: { value: TOKEN_INCOLLATO } });
    fireEvent.click(salva);

    expect(await screen.findByText(/Manca `refresh_token`/)).toBeInTheDocument();
    expect(campo().value).toBe('');
    expect(screen.queryByText(/Credenziale salvata/)).toBeNull();
    // E lo stato non viene riletto: non è cambiato niente da rileggere.
    expect(mockStato).toHaveBeenCalledTimes(1);
  });

  it('con il campo vuoto non chiama l’API e lo dice', async () => {
    mockStato.mockResolvedValue(statoDiProva());
    disegna();

    fireEvent.click(await screen.findByRole('button', { name: /Sostituisci credenziale/i }));

    expect(await screen.findByText(/Incolla il token JSON/)).toBeInTheDocument();
    expect(mockSalva).not.toHaveBeenCalled();
  });
});

describe('PannelloBackupOffSite — disattivare', () => {
  it('non offre «Disattiva» quando non c’è niente da disattivare', async () => {
    mockStato.mockResolvedValue(statoDiProva({ configurato: false }));
    disegna();

    await screen.findByRole('button', { name: /Salva credenziale/i });
    expect(screen.queryByRole('button', { name: /Disattiva la copia off-site/i })).toBeNull();
  });

  it('chiede conferma, spiegando cosa si perde, e solo allora chiama l’API', async () => {
    mockStato.mockResolvedValue(statoDiProva());
    mockDisattiva.mockResolvedValue({ rimosso: true });
    disegna();

    fireEvent.click(await screen.findByRole('button', { name: /Disattiva la copia off-site/i }));

    // Il dialog di conferma: l'azione toglie la copia fuori dal server, e va detto.
    expect(await screen.findByText(/I backup continueranno a essere fatti/)).toBeInTheDocument();
    expect(mockDisattiva).not.toHaveBeenCalled();

    const conferma = screen.getAllByRole('button', { name: /^Disattiva$/ }).pop()!;
    fireEvent.click(conferma);

    await waitFor(() => expect(mockDisattiva).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Copia off-site disattivata.')).toBeInTheDocument();
  });

  it('annullando la conferma non succede niente', async () => {
    mockStato.mockResolvedValue(statoDiProva());
    disegna();

    fireEvent.click(await screen.findByRole('button', { name: /Disattiva la copia off-site/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Annulla/i }));

    expect(mockDisattiva).not.toHaveBeenCalled();
  });
});
