// La configurazione della posta: caselle collegate (stato, prova, pausa, scollega, modulo) e inoltro dei clienti.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ConfigurazionePosta } from './ConfigurazionePosta';
import { statoCasella } from '../../utils/postaTesti';
import {
  aggiornaCasellaPostaApi, creaCasellaPostaApi, fetchCasellePostaApi, fetchInoltriClientiApi, impostaInoltroClienteApi,
  provaCasellaPostaApi, scollegaCasellaPostaApi,
} from '../../api/posta';

vi.mock('../../api/posta', () => ({
  fetchCasellePostaApi: vi.fn(), fetchInoltriClientiApi: vi.fn(), creaCasellaPostaApi: vi.fn(), aggiornaCasellaPostaApi: vi.fn(),
  scollegaCasellaPostaApi: vi.fn(), provaCasellaPostaApi: vi.fn(), impostaInoltroClienteApi: vi.fn(),
}));
const toast = { successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() };
vi.mock('../ui/ToastProvider', () => ({ useToast: () => toast }));
const conferma = vi.fn();
vi.mock('../ui/ConfirmProvider', () => ({ useConfirm: () => conferma }));

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const casella = (extra: Record<string, unknown> = {}) => ({
  id: 'c-1', nome: 'Raccolta', indirizzo: 'posta@studio.it', tipo: 'raccolta', attiva: true, host: 'imap.studio.it', servername: null, porta: 993,
  utente: 'posta@studio.it', cartella: 'INBOX', clienteId: null, raccogliDal: null, consensoDichiaratoAt: null, passwordSalvata: true,
  ultimaRaccoltaAt: null, ultimoSuccessoAt: null, ultimoErrore: null, cliente: null, ...extra,
});
const cliente = (extra: Record<string, unknown> = {}) => ({
  id: 'cl-1', nome: 'Rossi Srl', email: 'rossi@esempio.it', aliasPosta: null, postaAttivataAt: null, indirizzoInoltro: null, ...extra,
});

const onCambiato = vi.fn();
const apri = () => render(<ConfigurazionePosta onCambiato={onCambiato} />);
const compila = (modulo: HTMLElement, valori: Record<string, string>) => {
  for (const [etichetta, valore] of Object.entries(valori)) fireEvent.change(within(modulo).getByLabelText(new RegExp(`^${etichetta}`)), { target: { value: valore } });
};
const DATI = { Nome: 'Casella Rossi', 'Indirizzo della casella': 'rossi@esempio.it', 'Server IMAP': 'imap.esempio.it', Utenza: 'rossi@esempio.it', Password: 'segreta-di-prova' };

beforeEach(() => {
  vi.clearAllMocks();
  conferma.mockResolvedValue(true);
  mock(fetchCasellePostaApi).mockResolvedValue([casella()]);
  mock(fetchInoltriClientiApi).mockResolvedValue({ casellaDiRaccolta: 'posta@studio.it', clienti: [cliente()] });
});

describe('statoCasella', () => {
  it('distingue attiva, in pausa, ferma per errore e scollegata', () => {
    expect(statoCasella({ attiva: true, passwordSalvata: true, ultimoErrore: null }).testo).toBe('Attiva');
    expect(statoCasella({ attiva: false, passwordSalvata: true, ultimoErrore: null }).testo).toBe('In pausa');
    expect(statoCasella({ attiva: true, passwordSalvata: true, ultimoErrore: 'rifiutata' }).testo).toBe('Non risponde');
    expect(statoCasella({ attiva: false, passwordSalvata: false, ultimoErrore: null }).testo).toBe('Scollegata');
  });
});

describe('ConfigurazionePosta — caselle', () => {
  it('mostra le caselle con lo stato, e l’ultimo errore se c’è', async () => {
    mock(fetchCasellePostaApi).mockResolvedValue([casella({ ultimoErrore: 'imap.studio.it ha rifiutato utenza o password.' })]);
    apri();
    const sezione = await screen.findByRole('region', { name: 'Caselle collegate' });
    expect(within(sezione).getByText('Non risponde')).toBeTruthy();
    expect(within(sezione).getByRole('alert').textContent).toContain('ha rifiutato utenza o password');
    expect(within(sezione).getByText(/mai raccolta finora/)).toBeTruthy();
  });

  it('caselle non lette → errore con «Riprova», e gli inoltri restano usabili', async () => {
    mock(fetchCasellePostaApi).mockRejectedValue(new Error('Le caselle non sono state lette'));
    apri();
    expect(await screen.findByText('Le caselle non sono state lette', { selector: 'div[style*="font-weight: 700"]' })).toBeTruthy();
    expect(screen.queryByText(/Nessuna casella collegata/)).toBeNull();
    expect(await screen.findByRole('region', { name: 'Inoltro dei clienti' })).toBeTruthy();
    mock(fetchCasellePostaApi).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Nessuna casella collegata/)).toBeTruthy();
  });

  it('la casella di un cliente non si collega senza cliente e senza la dichiarazione di autorizzazione', async () => {
    apri();
    fireEvent.click(await screen.findByRole('button', { name: /Collega una casella/ }));
    const modulo = screen.getByRole('form', { name: 'Collega una casella' });
    fireEvent.click(within(modulo).getByRole('radio', { name: /Casella di un cliente/ }));
    compila(modulo, DATI);

    fireEvent.submit(modulo);
    expect((await within(modulo).findByRole('alert')).textContent).toContain('Indica di quale cliente');
    fireEvent.change(within(modulo).getByLabelText(/Cliente a cui appartiene/), { target: { value: 'cl-1' } });
    fireEvent.submit(modulo);
    expect((await within(modulo).findByRole('alert')).textContent).toContain('autorizzato per iscritto');
    expect(mock(creaCasellaPostaApi)).not.toHaveBeenCalled();

    mock(creaCasellaPostaApi).mockResolvedValue(casella({ id: 'c-2', nome: 'Casella Rossi', tipo: 'cliente' }));
    fireEvent.click(within(modulo).getByRole('checkbox', { name: /Dichiaro che il cliente ha autorizzato/ }));
    fireEvent.submit(modulo);
    await waitFor(() => expect(mock(creaCasellaPostaApi)).toHaveBeenCalledWith({
      nome: 'Casella Rossi', indirizzo: 'rossi@esempio.it', host: 'imap.esempio.it', porta: 993, utente: 'rossi@esempio.it',
      password: 'segreta-di-prova', cartella: 'INBOX', tipo: 'cliente', clienteId: 'cl-1', consensoCliente: true,
    }));
    await waitFor(() => expect(onCambiato).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: 'Collega una casella' })).toBeNull();
  });

  it('salvataggio rifiutato → il modulo resta aperto con i dati e mostra il motivo', async () => {
    mock(creaCasellaPostaApi).mockRejectedValue(new Error('Server IMAP non raggiungibile da qui'));
    apri();
    fireEvent.click(await screen.findByRole('button', { name: /Collega una casella/ }));
    const modulo = screen.getByRole('form', { name: 'Collega una casella' });
    compila(modulo, DATI);
    fireEvent.submit(modulo);
    expect((await within(modulo).findByRole('alert')).textContent).toContain('non raggiungibile');
    expect((within(modulo).getByLabelText(/^Nome/) as HTMLInputElement).value).toBe('Casella Rossi');
    expect(onCambiato).not.toHaveBeenCalled();
  });

  it('«Prova senza salvare» riporta il rifiuto del server di posta e non salva niente', async () => {
    mock(provaCasellaPostaApi).mockRejectedValue(new Error('imap.esempio.it ha rifiutato utenza o password.'));
    apri();
    fireEvent.click(await screen.findByRole('button', { name: /Collega una casella/ }));
    const modulo = screen.getByRole('form', { name: 'Collega una casella' });
    compila(modulo, DATI);
    fireEvent.click(within(modulo).getByRole('button', { name: 'Prova senza salvare' }));
    expect((await within(modulo).findByRole('alert')).textContent).toContain('ha rifiutato utenza o password');
    expect(mock(provaCasellaPostaApi)).toHaveBeenCalledWith({ host: 'imap.esempio.it', porta: 993, utente: 'rossi@esempio.it', password: 'segreta-di-prova', cartella: 'INBOX' });
    expect(mock(creaCasellaPostaApi)).not.toHaveBeenCalled();
  });

  it('«Scollega» chiede conferma: senza conferma non tocca niente, con la conferma chiama il server', async () => {
    mock(scollegaCasellaPostaApi).mockResolvedValue(casella({ attiva: false, passwordSalvata: false }));
    apri();
    const sezione = await screen.findByRole('region', { name: 'Caselle collegate' });
    conferma.mockResolvedValueOnce(false);
    fireEvent.click(within(sezione).getByRole('button', { name: 'Scollega' }));
    await waitFor(() => expect(conferma).toHaveBeenCalledTimes(1));
    expect(mock(scollegaCasellaPostaApi)).not.toHaveBeenCalled();

    fireEvent.click(within(sezione).getByRole('button', { name: 'Scollega' }));
    await waitFor(() => expect(mock(scollegaCasellaPostaApi)).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(onCambiato).toHaveBeenCalled());
  });

  it('una casella scollegata si ricollega solo con la password, che la riattiva', async () => {
    mock(fetchCasellePostaApi).mockResolvedValue([casella({ attiva: false, passwordSalvata: false })]);
    mock(aggiornaCasellaPostaApi).mockResolvedValue(casella());
    apri();
    const sezione = await screen.findByRole('region', { name: 'Caselle collegate' });
    expect(within(sezione).queryByRole('button', { name: 'Prova' })).toBeNull();
    expect(within(sezione).queryByRole('button', { name: /Riprendi la raccolta/ })).toBeNull();
    fireEvent.click(within(sezione).getByRole('button', { name: 'Ricollega con la password' }));
    fireEvent.change(within(sezione).getByLabelText('Nuova password di Raccolta'), { target: { value: 'nuova-di-prova' } });
    fireEvent.click(within(sezione).getByRole('button', { name: 'Salva la password' }));
    await waitFor(() => expect(mock(aggiornaCasellaPostaApi)).toHaveBeenCalledWith('c-1', { password: 'nuova-di-prova', attiva: true }));
  });

  it('«Metti in pausa» fallito → lo dice e non rilegge come se fosse andato', async () => {
    mock(aggiornaCasellaPostaApi).mockRejectedValue(new Error('La casella non è stata aggiornata'));
    apri();
    const sezione = await screen.findByRole('region', { name: 'Caselle collegate' });
    fireEvent.click(within(sezione).getByRole('button', { name: 'Metti in pausa' }));
    await waitFor(() => expect(toast.errore).toHaveBeenCalledWith('La casella non è stata aggiornata'));
    expect(mock(aggiornaCasellaPostaApi)).toHaveBeenCalledWith('c-1', { attiva: false });
    expect(onCambiato).not.toHaveBeenCalled();
  });
});

describe('ConfigurazionePosta — inoltro dei clienti', () => {
  it('attivare l’inoltro lo chiede al server e poi mostra l’indirizzo personale del cliente', async () => {
    mock(impostaInoltroClienteApi).mockResolvedValue(cliente({ aliasPosta: 'k7m2p9qa', indirizzoInoltro: 'posta+k7m2p9qa@studio.it' }));
    apri();
    const sezione = await screen.findByRole('region', { name: 'Inoltro dei clienti' });
    expect(within(sezione).queryByText(/Inoltra a/)).toBeNull();
    mock(fetchInoltriClientiApi).mockResolvedValue({ casellaDiRaccolta: 'posta@studio.it', clienti: [cliente({ aliasPosta: 'k7m2p9qa', indirizzoInoltro: 'posta+k7m2p9qa@studio.it' })] });
    fireEvent.click(within(sezione).getByRole('button', { name: 'Attiva l’inoltro' }));
    await waitFor(() => expect(mock(impostaInoltroClienteApi)).toHaveBeenCalledWith('cl-1', true));
    expect(await within(sezione).findByText('posta+k7m2p9qa@studio.it')).toBeTruthy();
    expect(within(sezione).getByRole('button', { name: 'Disattiva l’inoltro' })).toBeTruthy();
  });

  it('senza casella di raccolta lo dice: l’inoltro attivo non ha ancora un indirizzo', async () => {
    mock(fetchInoltriClientiApi).mockResolvedValue({ casellaDiRaccolta: null, clienti: [cliente({ aliasPosta: 'k7m2p9qa' })] });
    apri();
    const sezione = await screen.findByRole('region', { name: 'Inoltro dei clienti' });
    expect(within(sezione).getByRole('alert').textContent).toContain('Non c’è una casella di raccolta attiva');
    expect(within(sezione).getByText(/manca la casella di raccolta/)).toBeTruthy();
    expect(within(sezione).queryByRole('button', { name: 'Copia' })).toBeNull();
  });

  it('disattivare chiede conferma, e senza conferma l’inoltro resta', async () => {
    mock(fetchInoltriClientiApi).mockResolvedValue({ casellaDiRaccolta: 'posta@studio.it', clienti: [cliente({ aliasPosta: 'k7m2p9qa', indirizzoInoltro: 'posta+k7m2p9qa@studio.it' })] });
    conferma.mockResolvedValue(false);
    apri();
    const sezione = await screen.findByRole('region', { name: 'Inoltro dei clienti' });
    fireEvent.click(within(sezione).getByRole('button', { name: 'Disattiva l’inoltro' }));
    await waitFor(() => expect(conferma).toHaveBeenCalledTimes(1));
    expect(mock(impostaInoltroClienteApi)).not.toHaveBeenCalled();
  });

  it('inoltri non letti → errore, non «nessun cliente»', async () => {
    mock(fetchInoltriClientiApi).mockRejectedValue(new Error('Gli inoltri dei clienti non sono stati letti'));
    apri();
    await screen.findByRole('region', { name: 'Caselle collegate' });
    expect(await screen.findByText('Gli inoltri dei clienti non sono stati letti', { selector: 'div[style*="font-weight: 700"]' })).toBeTruthy();
    expect(screen.queryByText('Nessun cliente in anagrafica.')).toBeNull();
  });
});
