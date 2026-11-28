// Titolare, 28/11/2026 — i form per il cliente si leggono e si salvano sul server. Prima erano
// tre form scritti nella pagina, e quelli nuovi sparivano al ricaricamento.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = { successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() };
vi.mock('../ui/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('../ui/ConfirmProvider', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../api/formMaster', () => ({
  fetchFormMasterApi: vi.fn(),
  creaFormMasterApi: vi.fn(),
  eliminaFormMasterApi: vi.fn(),
}));

import { FormMasterSection } from './FormMasterSection';
import { creaFormMasterApi, eliminaFormMasterApi, fetchFormMasterApi } from '../../api/formMaster';

const SOCIETARI = { id: 'f-1', nome: 'Dati societari', campi: ['Ragione sociale', 'IBAN'], articoli: 1 };
const LIBERO = { id: 'f-2', nome: 'Titolare effettivo', campi: ['Nome'], articoli: 0 };

beforeEach(() => {
  vi.mocked(fetchFormMasterApi).mockReset();
  vi.mocked(creaFormMasterApi).mockReset();
  vi.mocked(eliminaFormMasterApi).mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
});

describe('FormMasterSection', () => {
  it('mostra i form dello studio; quello indicato da un articolo non si elimina', async () => {
    vi.mocked(fetchFormMasterApi).mockResolvedValue([SOCIETARI, LIBERO]);
    render(<FormMasterSection />);

    expect(await screen.findByText(/Dati societari/)).toBeTruthy();
    expect(screen.getByText(/indicato da 1 articolo/)).toBeTruthy();
    const elimina = screen.getAllByRole('button', { name: /Elimina/ }) as HTMLButtonElement[];
    expect(elimina[0].disabled).toBe(true);
    expect(elimina[1].disabled).toBe(false);
  });

  it('nessun form: lo dice, senza form di esempio', async () => {
    vi.mocked(fetchFormMasterApi).mockResolvedValue([]);
    render(<FormMasterSection />);
    expect(await screen.findByText(/non ha ancora nessun form/)).toBeTruthy();
    expect(screen.queryByText(/UBO|KYC|Societari/)).toBeNull();
  });

  it('lettura fallita: è un errore con «Riprova», non «nessun form»', async () => {
    vi.mocked(fetchFormMasterApi).mockRejectedValueOnce(new Error('Server non raggiungibile')).mockResolvedValueOnce([LIBERO]);
    render(<FormMasterSection />);

    expect((await screen.findByRole('alert')).textContent).toContain('Server non raggiungibile');
    expect(screen.queryByText(/non ha ancora nessun form/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Titolare effettivo/)).toBeTruthy();
  });

  it('crea: manda nome e domande (una per riga o con la virgola) e rilegge l’elenco', async () => {
    vi.mocked(fetchFormMasterApi).mockResolvedValue([]);
    vi.mocked(creaFormMasterApi).mockResolvedValue({ ...LIBERO });
    render(<FormMasterSection />);
    await screen.findByText(/non ha ancora nessun form/);

    fireEvent.click(screen.getByRole('button', { name: '+ Crea nuovo form' }));
    fireEvent.change(screen.getByLabelText(/Nome del form/), { target: { value: ' Titolare effettivo ' } });
    fireEvent.change(screen.getByLabelText(/Domande/), { target: { value: 'Nome\nQuote, Residenza fiscale\n' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Crea form' }));

    await waitFor(() => expect(creaFormMasterApi).toHaveBeenCalledWith({ nome: 'Titolare effettivo', campi: ['Nome', 'Quote', 'Residenza fiscale'] }));
    await waitFor(() => expect(fetchFormMasterApi).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText(/Nome del form/)).toBeNull();
  });

  it('creazione fallita: il modale resta aperto e l’errore si dichiara', async () => {
    vi.mocked(fetchFormMasterApi).mockResolvedValue([]);
    vi.mocked(creaFormMasterApi).mockRejectedValue(new Error('Esiste già un form che si chiama «Dati»'));
    render(<FormMasterSection />);
    await screen.findByText(/non ha ancora nessun form/);

    fireEvent.click(screen.getByRole('button', { name: '+ Crea nuovo form' }));
    fireEvent.change(screen.getByLabelText(/Nome del form/), { target: { value: 'Dati' } });
    fireEvent.change(screen.getByLabelText(/Domande/), { target: { value: 'Una domanda' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Crea form' }));

    await waitFor(() => expect(toast.errore).toHaveBeenCalledWith(expect.stringContaining('Esiste già un form')));
    expect(screen.getByLabelText(/Nome del form/)).toBeTruthy();
  });

  it('elimina: chiama il server e rilegge', async () => {
    vi.mocked(fetchFormMasterApi).mockResolvedValue([LIBERO]);
    vi.mocked(eliminaFormMasterApi).mockResolvedValue(undefined);
    render(<FormMasterSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Elimina/ }));
    await waitFor(() => expect(eliminaFormMasterApi).toHaveBeenCalledWith('f-2'));
    await waitFor(() => expect(fetchFormMasterApi).toHaveBeenCalledTimes(2));
  });
});
