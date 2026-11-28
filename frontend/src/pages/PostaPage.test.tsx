// «Posta dei clienti»: l'elenco, gli stati distinti (vuoto, errore, casella ferma), lo smistamento e i permessi.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PostaPage } from './PostaPage';
import {
  aggiornaMessaggioPostaApi, fetchMessaggiPostaApi, fetchMessaggioPostaApi, fetchSmistamentoPostaApi, fetchStatoPostaApi, raccogliPostaApi,
} from '../api/posta';
import { permessoPosta, puoConfigurarePosta } from '../utils/postaAccesso';

vi.mock('../api/posta', () => ({
  fetchMessaggiPostaApi: vi.fn(), fetchMessaggioPostaApi: vi.fn(), fetchStatoPostaApi: vi.fn(), fetchSmistamentoPostaApi: vi.fn(),
  aggiornaMessaggioPostaApi: vi.fn(), raccogliPostaApi: vi.fn(),
}));
vi.mock('../utils/postaAccesso', () => ({ permessoPosta: vi.fn(), puoConfigurarePosta: vi.fn() }));
vi.mock('../components/posta/ConfigurazionePosta', () => ({ ConfigurazionePosta: () => <div>scheda configurazione</div> }));
const toast = { successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() };
vi.mock('../components/ui/ToastProvider', () => ({ useToast: () => toast }));

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const messaggio = (extra: Record<string, unknown> = {}) => ({
  id: 'm-1', casellaId: 'c-1', mittenteEmail: 'banca@esempio.it', mittenteNome: 'Banca Esempio', destinatari: 'rossi@esempio.it',
  oggetto: 'Estratto conto', anteprima: 'In allegato il suo estratto', ricevutoAt: '2026-11-27T09:30:00.000Z',
  clienteId: null, progettoId: null, attribuzione: 'da_smistare', criterio: null, lettoAt: null, archiviatoAt: null, haAllegati: true,
  cliente: null, progetto: null, casella: { id: 'c-1', nome: 'Raccolta', tipo: 'raccolta' }, ...extra,
});
const elenco = (messaggi: unknown[]) => ({ messaggi, totale: messaggi.length, pagina: 1, perPagina: 30 });
const casella = (extra: Record<string, unknown> = {}) => ({
  id: 'c-1', nome: 'Raccolta', indirizzo: 'posta@studio.it', tipo: 'raccolta', attiva: true,
  ultimaRaccoltaAt: null, ultimoSuccessoAt: null, ultimoErrore: null, cliente: null, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock(permessoPosta).mockReturnValue('write');
  mock(puoConfigurarePosta).mockReturnValue(true);
  mock(fetchMessaggiPostaApi).mockResolvedValue(elenco([messaggio()]));
  mock(fetchStatoPostaApi).mockResolvedValue({ caselle: [casella()], daSmistare: 1, nonLetti: 1 });
  mock(fetchSmistamentoPostaApi).mockResolvedValue({
    clienti: [{ id: 'cl-1', nome: 'Rossi Srl' }],
    progetti: [{ id: 'p-1', nome: 'Trasferimento', clienteId: 'cl-1' }],
  });
});

describe('PostaPage', () => {
  it('mostra i messaggi raccolti con i conteggi, e quello senza cliente è «Da smistare»', async () => {
    render(<PostaPage />);
    expect(await screen.findByText('Estratto conto')).toBeTruthy();
    expect(screen.getByText('Banca Esempio')).toBeTruthy();
    expect(screen.getByText('1 da smistare')).toBeTruthy();
    expect(screen.getByText('1 da leggere')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Estratto conto/ })).getByText('Da smistare')).toBeTruthy();
  });

  it('lettura fallita → errore con «Riprova», non «nessun messaggio»', async () => {
    mock(fetchMessaggiPostaApi).mockRejectedValue(new Error('I messaggi non sono stati letti'));
    render(<PostaPage />);
    const avviso = await screen.findByText('I messaggi non sono stati letti', { selector: 'div' });
    expect(avviso.closest('[role="alert"]')?.textContent).toContain('Non vuol dire che non ce ne siano');
    expect(screen.queryByText(/Nessun messaggio/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('nessuna casella collegata → il vuoto dice perché, e dove si collega', async () => {
    mock(fetchMessaggiPostaApi).mockResolvedValue(elenco([]));
    mock(fetchStatoPostaApi).mockResolvedValue({ caselle: [], daSmistare: 0, nonLetti: 0 });
    render(<PostaPage />);
    expect(await screen.findByText(/Nessuna casella collegata.*Collegala dalla scheda Configurazione/)).toBeTruthy();
  });

  it('una casella che non risponde si vede in pagina, con il motivo', async () => {
    mock(fetchStatoPostaApi).mockResolvedValue({ caselle: [casella({ ultimoErrore: 'imap.esempio.it ha rifiutato utenza o password.' })], daSmistare: 0, nonLetti: 0 });
    render(<PostaPage />);
    const avviso = await screen.findByText(/non viene raccolta/);
    expect(avviso.closest('[role="alert"]')?.textContent).toContain('ha rifiutato utenza o password');
    expect(avviso.closest('[role="alert"]')?.textContent).toContain('Non è mai stata raccolta');
  });

  it('aprire un messaggio e smistarlo: cliente e progetto vanno al server, l’elenco si aggiorna', async () => {
    mock(fetchMessaggioPostaApi).mockResolvedValue({ ...messaggio(), testo: 'Buongiorno, in allegato.', html: null, consegnatoA: null, allegati: [] });
    mock(aggiornaMessaggioPostaApi).mockResolvedValue(messaggio({
      clienteId: 'cl-1', progettoId: 'p-1', attribuzione: 'manuale', cliente: { id: 'cl-1', nome: 'Rossi Srl' }, progetto: { id: 'p-1', nome: 'Trasferimento' },
    }));
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Estratto conto/ }));
    const dettaglio = await screen.findByRole('region', { name: 'Messaggio aperto' });
    expect(within(dettaglio).getByText('Buongiorno, in allegato.')).toBeTruthy();
    expect(within(dettaglio).getByText(/Nessun cliente riconosciuto/)).toBeTruthy();

    fireEvent.change(within(dettaglio).getByLabelText('Cliente a cui attribuire il messaggio'), { target: { value: 'cl-1' } });
    fireEvent.change(within(dettaglio).getByLabelText('Progetto a cui attribuire il messaggio'), { target: { value: 'p-1' } });
    fireEvent.click(within(dettaglio).getByRole('button', { name: 'Salva lo smistamento' }));

    await waitFor(() => expect(mock(aggiornaMessaggioPostaApi)).toHaveBeenCalledWith('m-1', { clienteId: 'cl-1', progettoId: 'p-1' }));
    expect(await within(dettaglio).findByText(/Attribuito a mano da un operatore/)).toBeTruthy();
    await waitFor(() => expect(within(screen.getAllByRole('button', { name: /Estratto conto/ })[0]!).getByText(/Rossi Srl · Trasferimento/)).toBeTruthy());
    expect(toast.successo).toHaveBeenCalledWith('Messaggio smistato.');
  });

  it('smistamento fallito → lo dice, e le scelte restano a schermo', async () => {
    mock(fetchMessaggioPostaApi).mockResolvedValue({ ...messaggio(), testo: 'Testo', html: null, consegnatoA: null, allegati: [] });
    mock(aggiornaMessaggioPostaApi).mockRejectedValue(new Error('Il messaggio non è stato aggiornato'));
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Estratto conto/ }));
    const dettaglio = await screen.findByRole('region', { name: 'Messaggio aperto' });
    const cliente = within(dettaglio).getByLabelText('Cliente a cui attribuire il messaggio') as HTMLSelectElement;
    fireEvent.change(cliente, { target: { value: 'cl-1' } });
    fireEvent.click(within(dettaglio).getByRole('button', { name: 'Salva lo smistamento' }));
    await waitFor(() => expect(toast.errore).toHaveBeenCalledWith('Il messaggio non è stato aggiornato'));
    expect(cliente.value).toBe('cl-1');
  });

  it('un allegato non salvato si dichiara con il motivo, senza un link che non porta a niente', async () => {
    mock(fetchMessaggioPostaApi).mockResolvedValue({
      ...messaggio(), testo: 'Testo', html: null, consegnatoA: null,
      allegati: [
        { id: 'a-1', nome: 'estratto.pdf', mime: 'application/pdf', dimensioneByte: 2048, url: '/uploads/estratto.pdf', motivoNonSalvato: null },
        { id: 'a-2', nome: 'video.mov', mime: 'video/quicktime', dimensioneByte: null, url: null, motivoNonSalvato: 'supera i 15 MB' },
      ],
    });
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Estratto conto/ }));
    const dettaglio = await screen.findByRole('region', { name: 'Messaggio aperto' });
    expect(within(dettaglio).getByRole('link', { name: 'estratto.pdf' })).toBeTruthy();
    expect(within(dettaglio).getByText('2 KB')).toBeTruthy();
    expect(within(dettaglio).queryByRole('link', { name: 'video.mov' })).toBeNull();
    expect(within(dettaglio).getByText(/non salvato: supera i 15 MB/)).toBeTruthy();
  });

  it('«Raccogli ora»: una casella che non risponde è un errore, non un «tutto bene»', async () => {
    mock(raccogliPostaApi).mockResolvedValue({ nuovi: 2, caselle: [{ casellaId: 'c-1', nome: 'Raccolta', ok: false, nuovi: 0, errore: 'rifiutata' }, { casellaId: 'c-2', nome: 'Rossi', ok: true, nuovi: 2 }] });
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Raccogli ora/ }));
    await waitFor(() => expect(toast.errore).toHaveBeenCalledWith(expect.stringContaining('la casella «Raccolta» non ha risposto')));
    expect(toast.successo).not.toHaveBeenCalled();
    // Dopo la raccolta l'elenco e lo stato si rileggono: una volta all'apertura, una dopo.
    await waitFor(() => expect(mock(fetchMessaggiPostaApi)).toHaveBeenCalledTimes(2));
    expect(mock(fetchStatoPostaApi)).toHaveBeenCalledTimes(2);
  });

  it('chi può solo leggere non vede «Raccogli ora», né lo smistamento, né la configurazione', async () => {
    mock(permessoPosta).mockReturnValue('read');
    mock(puoConfigurarePosta).mockReturnValue(false);
    mock(fetchMessaggioPostaApi).mockResolvedValue({ ...messaggio(), testo: 'Testo', html: null, consegnatoA: null, allegati: [] });
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Estratto conto/ }));
    const dettaglio = await screen.findByRole('region', { name: 'Messaggio aperto' });
    expect(screen.queryByRole('button', { name: /Raccogli ora/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Configurazione' })).toBeNull();
    expect(within(dettaglio).queryByRole('button', { name: 'Salva lo smistamento' })).toBeNull();
    expect(within(dettaglio).queryByRole('button', { name: /Archivia/ })).toBeNull();
  });

  it('i filtri arrivano al server e riportano alla prima pagina', async () => {
    render(<PostaPage />);
    await screen.findByText('Estratto conto');
    fireEvent.change(screen.getByLabelText('Quali messaggi mostrare'), { target: { value: 'da_smistare' } });
    await waitFor(() => expect(mock(fetchMessaggiPostaApi)).toHaveBeenLastCalledWith(expect.objectContaining({ vista: 'da_smistare', pagina: 1 })));
    fireEvent.change(screen.getByLabelText('Cerca nei messaggi'), { target: { value: ' estratto ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cerca' }));
    await waitFor(() => expect(mock(fetchMessaggiPostaApi)).toHaveBeenLastCalledWith(expect.objectContaining({ vista: 'da_smistare', q: 'estratto' })));
  });

  it('la scheda Configurazione si apre solo a chi risponde dello studio', async () => {
    render(<PostaPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Configurazione' }));
    expect(screen.getByText('scheda configurazione')).toBeTruthy();
  });
});
