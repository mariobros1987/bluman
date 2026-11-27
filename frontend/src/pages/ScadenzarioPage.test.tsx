// Analisi del 26/11, E8 — l'incasso si registrava senza data e senza conto: il modale non li
// chiedeva, quindi ogni incasso prendeva la data di oggi e nessuno sceglieva dove entrava il denaro.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ScadenzarioPage } from './ScadenzarioPage';
import { fetchScadenzarioIncassiApi, registraIncassoApi, fetchClienti, fetchContiBancariApi } from '../api/client';

vi.mock('../api/client', () => ({
  fetchScadenzarioIncassiApi: vi.fn(),
  registraIncassoApi: vi.fn(),
  fetchClienti: vi.fn(),
  fetchContiBancariApi: vi.fn(),
}));
vi.mock('../context/PeriodoContext', () => ({ usePeriodo: () => ({ dataDa: '', dataA: '' }) }));
vi.mock('../components/ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/solleciti/InviaSollecitoModal', () => ({ InviaSollecitoModal: () => null }));
vi.mock('../components/ui/FiltroPeriodo', () => ({ FiltroPeriodo: () => null }));

const mockRegistra = registraIncassoApi as ReturnType<typeof vi.fn>;
const mockConti = fetchContiBancariApi as ReturnType<typeof vi.fn>;

const RATA = {
  id: 'sc-1', numeroRata: 1, stato: 'aperta', importoCentesimi: 48800, dataScadenza: '2026-12-31T00:00:00.000Z',
  registrazioniRegistrate: [],
  fattura: { id: 'f-1', numero: 'FT-2026/001', clienteId: 'c-1', cliente: { id: 'c-1', nome: 'Rossi Srl' }, contoAccreditoId: null },
};
const CONTI = [
  { id: 'conto-1', nomeConto: 'Conto operativo', banca: 'Banca Uno', isDefault: false },
  { id: 'conto-2', nomeConto: 'Conto principale', banca: 'Banca Due', isDefault: true },
];

async function apriModale() {
  render(<ScadenzarioPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Registra Incasso/ }));
  return screen.findByLabelText(/Data dell'incasso/);
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([RATA]);
  (fetchClienti as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockConti.mockResolvedValue(CONTI);
  mockRegistra.mockResolvedValue({ ok: true });
});

describe('ScadenzarioPage — data e conto dell’incasso (E8)', () => {
  it('la data scelta e il conto scelto arrivano al server', async () => {
    const campoData = await apriModale();
    fireEvent.change(campoData, { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText(/Conto su cui è entrato il denaro/), { target: { value: 'conto-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Conferma/ }));

    await waitFor(() => expect(mockRegistra).toHaveBeenCalledTimes(1));
    expect(mockRegistra).toHaveBeenCalledWith('sc-1', expect.objectContaining({
      importoIncassatoCentesimi: 48800,
      dataIncasso: '2026-11-20',
      contoBancarioId: 'conto-1',
    }));
  });

  it('il conto proposto è il predefinito dello studio, e la data proposta è oggi', async () => {
    const campoData = (await apriModale()) as HTMLInputElement;
    expect(campoData.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(campoData.max).toBe(campoData.value);
    expect((screen.getByLabelText(/Conto su cui è entrato il denaro/) as HTMLSelectElement).value).toBe('conto-2');
  });

  it('se la fattura indica un conto di accredito, è quello il conto proposto', async () => {
    (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...RATA, fattura: { ...RATA.fattura, contoAccreditoId: 'conto-1' } }]);
    await apriModale();
    expect((screen.getByLabelText(/Conto su cui è entrato il denaro/) as HTMLSelectElement).value).toBe('conto-1');
  });

  it('studio senza conti → lo dice, e non manda un conto inventato', async () => {
    mockConti.mockResolvedValue([]);
    await apriModale();
    expect(screen.getByText(/non entra nel saldo di nessun conto/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Conferma/ }));
    await waitFor(() => expect(mockRegistra).toHaveBeenCalledTimes(1));
    expect(mockRegistra.mock.calls[0][1].contoBancarioId).toBeUndefined();
  });

  it('elenco dei conti non letto → è un errore dichiarato, non «nessun conto»', async () => {
    mockConti.mockRejectedValue(new Error('Errore recupero conti bancari'));
    await apriModale();
    expect(screen.getByRole('alert').textContent).toContain('Elenco dei conti non letto');
    expect(screen.queryByText(/non entra nel saldo di nessun conto/)).toBeNull();
  });
});
