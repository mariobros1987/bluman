// La scheda Messaggi del portale: un messaggio compare quando il server lo ha salvato, un invio
// fallito si dichiara lasciando il testo dov'è, e il lucchetto non si mostra se la cifratura non c'è.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TabMessaggi } from './TabMessaggi';

vi.mock('../../api/canaleProtetto', async (importOriginal) => {
  const reale = await importOriginal<typeof import('../../api/canaleProtetto')>();
  return { ...reale, leggiMessaggiApi: vi.fn(), inviaMessaggioProtettoApi: vi.fn(), scaricaAllegatoProtettoApi: vi.fn() };
});
vi.mock('../../api/progetti', () => ({ segnaComunicazioniLetteApi: vi.fn(async () => ({ ok: true })) }));

import { inviaMessaggioProtettoApi, leggiMessaggiApi, scaricaAllegatoProtettoApi } from '../../api/canaleProtetto';
import { segnaComunicazioniLetteApi } from '../../api/progetti';

const leggi = leggiMessaggiApi as ReturnType<typeof vi.fn>;
const inviaApi = inviaMessaggioProtettoApi as ReturnType<typeof vi.fn>;
const scarica = scaricaAllegatoProtettoApi as ReturnType<typeof vi.fn>;
const segnaLette = segnaComunicazioniLetteApi as ReturnType<typeof vi.fn>;

const messaggio = (parziale: Record<string, unknown>) => ({
  id: 'm-1', canale: 'portal', mittente: 'Ada (Studio)', destinatario: 'Rossi', direzione: 'uscita', testo: 'Buongiorno',
  allegatiJson: null, createdAt: '2026-11-20T10:00:00Z', stato: 'consegnato', cifrato: true, ...parziale,
});

function mostra(parziale: Partial<Parameters<typeof TabMessaggi>[0]> = {}) {
  return render(<TabMessaggi contattiStudio={null} progettoId="p-1" nomeProgetto="Costituzione Malta" cifraturaAttiva anteprima={false} {...parziale} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  leggi.mockResolvedValue([]);
});

describe('canale protetto', () => {
  it('dichiara il lucchetto solo se il server dice che la cifratura è attiva', async () => {
    const { unmount } = mostra({ cifraturaAttiva: true });
    expect(await screen.findByText(/Canale protetto\./)).toBeTruthy();
    unmount();
    mostra({ cifraturaAttiva: false });
    expect(await screen.findByText(/non ancora cifrato/)).toBeTruthy();
    expect(screen.queryByText(/Canale protetto\./)).toBeNull();
  });

  it('non offre più di scegliere un altro canale', async () => {
    mostra();
    await screen.findByText(/Nessun messaggio finora/);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });

  it('segna come letti i messaggi dello studio, ma non in anteprima', async () => {
    leggi.mockResolvedValue([messaggio({})]);
    const { unmount } = mostra();
    await screen.findByText('Buongiorno');
    await waitFor(() => expect(segnaLette).toHaveBeenCalledWith('p-1', 'uscita'));
    unmount();
    segnaLette.mockClear();
    mostra({ anteprima: true });
    await screen.findByText('Buongiorno');
    expect(segnaLette).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Invia' })).toBeNull();
  });

  it('un errore di lettura non è «nessun messaggio»', async () => {
    leggi.mockRejectedValue(new Error('server non raggiungibile'));
    mostra();
    expect(await screen.findByText(/non si è potuta leggere/)).toBeTruthy();
    expect(screen.queryByText(/Nessun messaggio finora/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('server non raggiungibile');
  });
});

describe('invio', () => {
  it('se il server rifiuta lo dice, e il testo resta nel campo', async () => {
    inviaApi.mockRejectedValue(new Error('Il canale protetto non accetta messaggi in questo momento.'));
    mostra();
    const campo = await screen.findByLabelText('Scrivi allo studio') as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: 'Il mio IBAN è questo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia' }));
    expect(await screen.findByText(/Messaggio non inviato\./)).toBeTruthy();
    expect(campo.value).toBe('Il mio IBAN è questo');
    // Niente bolla per un messaggio che il server non ha salvato.
    expect(screen.queryAllByText('Il mio IBAN è questo').filter((e) => e.tagName !== 'TEXTAREA')).toHaveLength(0);
  });

  it('a messaggio salvato lo mostra e svuota il campo', async () => {
    inviaApi.mockResolvedValue(messaggio({ id: 'm-2', direzione: 'entrata', testo: 'Ecco i dati', mittente: 'Rossi (Cliente)' }));
    mostra();
    const campo = await screen.findByLabelText('Scrivi allo studio') as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: '  Ecco i dati ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia' }));
    await waitFor(() => expect(campo.value).toBe(''));
    expect(inviaApi).toHaveBeenCalledWith('p-1', { testo: 'Ecco i dati', allegatiProtetti: [] });
    expect(screen.getByText('Ecco i dati')).toBeTruthy();
  });
});

describe('allegati', () => {
  it('un allegato protetto si scarica con la sessione, e un errore si legge accanto al file', async () => {
    leggi.mockResolvedValue([messaggio({ allegatiJson: JSON.stringify([{ protetto: true, nome: 'visura.pdf', dimensione: '12 KB', url: '/progetti/p-1/comunicazioni/m-1/allegati/0' }]) })]);
    scarica.mockRejectedValue(new Error('«visura.pdf» non è stato scaricato'));
    mostra();
    fireEvent.click(await screen.findByRole('button', { name: /Scarica/ }));
    expect(await screen.findByText('«visura.pdf» non è stato scaricato')).toBeTruthy();
    expect(scarica).toHaveBeenCalledWith(expect.objectContaining({ url: '/progetti/p-1/comunicazioni/m-1/allegati/0', nome: 'visura.pdf' }));
    // Nessun collegamento da copiare e inoltrare.
    expect(screen.queryByRole('link', { name: /Scarica/ })).toBeNull();
  });
});
