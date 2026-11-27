// Il pulsante 📝 delle note della beta, uguale in ogni pagina: le note sono della pagina che si sta guardando,
// si salvano sul server, e un salvataggio fallito non fa perdere ciò che si è scritto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PulsanteNoteBeta } from './PulsanteNoteBeta';
import { creaNotaBetaApi, eliminaNotaBetaApi, fetchNoteBetaApi } from '../../api/noteBeta';

vi.mock('../../api/noteBeta', () => ({ fetchNoteBetaApi: vi.fn(), creaNotaBetaApi: vi.fn(), eliminaNotaBetaApi: vi.fn() }));
const mockLeggi = fetchNoteBetaApi as ReturnType<typeof vi.fn>;
const mockCrea = creaNotaBetaApi as ReturnType<typeof vi.fn>;
const mockElimina = eliminaNotaBetaApi as ReturnType<typeof vi.fn>;

const nota = (extra: Record<string, unknown> = {}) => ({
  id: 'n-1', userId: 'u-2', autoreNome: 'Sara', ruolo: 'collaboratore_interno', pagina: '/projects/:id',
  percorso: '/projects/abc', tipo: 'errore', testo: 'Il totale non torna', stato: 'aperta', risoltaAt: null,
  createdAt: '2026-11-27T10:00:00.000Z', ...extra,
});
const PROGETTO = '/projects/6a3bca5d-69ca-4eae-8e73-360ab1aed785';
const apri = (percorso = PROGETTO, userId = 'u-1') =>
  render(<PulsanteNoteBeta percorso={percorso} titoloPagina="Dettaglio Progetto" userId={userId} />);
const pulsante = () => screen.getByRole('button', { name: /^Note della beta su Dettaglio Progetto/ });

beforeEach(() => {
  vi.clearAllMocks();
  mockLeggi.mockResolvedValue([]);
  mockCrea.mockImplementation(async (n: any) => nota({ id: 'n-nuova', userId: 'u-1', autoreNome: 'Lorenzo', ...n }));
  mockElimina.mockResolvedValue(undefined);
});

describe('PulsanteNoteBeta', () => {
  it('chiede le note della pagina in forma generale, e mostra quante sono aperte', async () => {
    mockLeggi.mockResolvedValue([nota(), nota({ id: 'n-2', stato: 'risolta' })]);
    apri();
    await waitFor(() => expect(pulsante().getAttribute('aria-label')).toContain('1 aperta'));
    expect(mockLeggi).toHaveBeenCalledWith({ pagina: '/projects/:id' });
  });

  it('scrivere una nota: va al server con l’indirizzo esatto e il tipo scelto, e compare in elenco', async () => {
    apri();
    fireEvent.click(pulsante());
    fireEvent.click(screen.getByRole('radio', { name: /Miglioramento/ }));
    fireEvent.change(screen.getByLabelText('La tua nota'), { target: { value: '  Il pulsante è poco visibile  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi la nota' }));

    await waitFor(() => expect(mockCrea).toHaveBeenCalledWith({ percorso: PROGETTO, tipo: 'miglioramento', testo: 'Il pulsante è poco visibile' }));
    expect(await screen.findByText('Il pulsante è poco visibile')).toBeTruthy();
    expect((screen.getByLabelText('La tua nota') as HTMLTextAreaElement).value).toBe('');
  });

  it('salvataggio fallito → lo dice, e il testo scritto resta nel campo', async () => {
    mockCrea.mockRejectedValue(new Error('La nota non è stata salvata'));
    apri();
    fireEvent.click(pulsante());
    fireEvent.change(screen.getByLabelText('La tua nota'), { target: { value: 'Una nota importante' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi la nota' }));

    expect((await screen.findByRole('alert')).textContent).toContain('non è stata salvata');
    expect((screen.getByLabelText('La tua nota') as HTMLTextAreaElement).value).toBe('Una nota importante');
  });

  it('una nota di due lettere non si può mandare', async () => {
    apri();
    fireEvent.click(pulsante());
    fireEvent.change(screen.getByLabelText('La tua nota'), { target: { value: 'ok' } });
    expect((screen.getByRole('button', { name: 'Aggiungi la nota' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lettura fallita → errore con «Riprova», non «nessuna nota»', async () => {
    mockLeggi.mockRejectedValue(new Error('Le note della beta non sono state lette'));
    apri();
    fireEvent.click(pulsante());
    expect((await screen.findByRole('alert')).textContent).toContain('non sono state lette');
    expect(screen.queryByText(/Nessuna nota su questa pagina/)).toBeNull();
    mockLeggi.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Nessuna nota su questa pagina/)).toBeTruthy();
  });

  it('si elimina solo la propria nota ancora aperta', async () => {
    mockLeggi.mockResolvedValue([nota({ id: 'mia', userId: 'u-1', testo: 'La mia' }), nota({ id: 'altrui', userId: 'u-2', testo: 'Di Sara' })]);
    apri();
    fireEvent.click(pulsante());
    await screen.findByText('La mia');
    const elimina = screen.getAllByRole('button', { name: 'Elimina questa mia nota' });
    expect(elimina).toHaveLength(1);
    fireEvent.click(elimina[0]!);
    await waitFor(() => expect(mockElimina).toHaveBeenCalledWith('mia'));
    await waitFor(() => expect(screen.queryByText('La mia')).toBeNull());
    expect(screen.getByText('Di Sara')).toBeTruthy();
  });

  it('cambiando pagina si rileggono le note della pagina nuova', async () => {
    const { rerender } = apri('/primanota');
    await waitFor(() => expect(mockLeggi).toHaveBeenCalledWith({ pagina: '/primanota' }));
    rerender(<PulsanteNoteBeta percorso="/scadenzario" titoloPagina="Scadenzario incassi" userId="u-1" />);
    await waitFor(() => expect(mockLeggi).toHaveBeenCalledWith({ pagina: '/scadenzario' }));
  });
});
