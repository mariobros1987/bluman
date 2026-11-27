// «Note della beta», la raccolta: le note per pagina, «risolta», e «Copia tutto» per passarle a chi corregge.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NoteBetaPage } from './NoteBetaPage';
import { aggiornaNotaBetaApi, fetchNoteBetaApi } from '../api/noteBeta';

vi.mock('../api/noteBeta', () => ({ fetchNoteBetaApi: vi.fn(), aggiornaNotaBetaApi: vi.fn(), eliminaNotaBetaApi: vi.fn() }));
const toast = { successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() };
vi.mock('../components/ui/ToastProvider', () => ({ useToast: () => toast }));
const mockLeggi = fetchNoteBetaApi as ReturnType<typeof vi.fn>;
const mockAggiorna = aggiornaNotaBetaApi as ReturnType<typeof vi.fn>;

const nota = (extra: Record<string, unknown> = {}) => ({
  id: 'n-1', userId: 'u-2', autoreNome: 'Sara', ruolo: 'collaboratore_interno', pagina: '/primanota', percorso: '/primanota',
  tipo: 'errore', testo: 'Il totale non torna', stato: 'aperta', risoltaAt: null, createdAt: '2026-11-27T10:00:00.000Z', ...extra,
});
const apri = () => render(<MemoryRouter><NoteBetaPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mockLeggi.mockResolvedValue([
    nota(),
    nota({ id: 'n-2', pagina: '/projects/:id', percorso: '/projects/abc', tipo: 'miglioramento', testo: 'Pulsante poco visibile' }),
    nota({ id: 'n-3', testo: 'Già sistemata', stato: 'risolta' }),
  ]);
});

describe('NoteBetaPage', () => {
  it('mostra le aperte divise per pagina, col nome della pagina', async () => {
    apri();
    const primaNota = await screen.findByRole('region', { name: 'Note su Prima Nota' });
    expect(within(primaNota).getByText('Il totale non torna')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Note su Dettaglio Progetto' })).getByText('Pulsante poco visibile')).toBeTruthy();
    expect(screen.queryByText('Già sistemata')).toBeNull();
    expect(screen.getByText('2 aperte')).toBeTruthy();
  });

  it('«Segna risolta» lo chiede al server e la nota esce dalle aperte', async () => {
    mockAggiorna.mockImplementation(async (id: string, stato: string) => nota({ id, stato }));
    apri();
    const primaNota = await screen.findByRole('region', { name: 'Note su Prima Nota' });
    fireEvent.click(within(primaNota).getByRole('button', { name: /Segna risolta/ }));
    await waitFor(() => expect(mockAggiorna).toHaveBeenCalledWith('n-1', 'risolta'));
    await waitFor(() => expect(screen.queryByText('Il totale non torna')).toBeNull());
  });

  it('«Copia tutto» mette negli appunti le note mostrate, raggruppate per pagina', async () => {
    const scrivi = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: scrivi }, configurable: true });
    apri();
    await screen.findByText('Il totale non torna');
    fireEvent.click(screen.getByRole('button', { name: /Copia tutto/ }));
    await waitFor(() => expect(scrivi).toHaveBeenCalledTimes(1));
    const testo = (scrivi.mock.calls[0] as unknown as [string])[0];
    expect(testo).toContain('# Note della beta (2)');
    expect(testo).toContain('## Prima Nota (/primanota)');
    expect(testo).toContain('Pulsante poco visibile');
    expect(testo).not.toContain('Già sistemata');
  });

  it('lettura fallita → errore con «Riprova», non «nessuna nota»', async () => {
    mockLeggi.mockRejectedValue(new Error('Le note della beta non sono state lette'));
    apri();
    expect((await screen.findByRole('alert')).textContent).toContain('non sono state lette');
    expect(screen.queryByText(/Nessuna nota ancora/)).toBeNull();
  });

  it('nessuna nota → lo dice, e spiega da dove si scrivono', async () => {
    mockLeggi.mockResolvedValue([]);
    apri();
    expect(await screen.findByText(/Nessuna nota ancora/)).toBeTruthy();
  });
});
