// Analisi del 26/11, E8 — l'incasso si registrava senza data e senza conto: il modale non li
// chiedeva, quindi ogni incasso prendeva la data di oggi e nessuno sceglieva dove entrava il denaro.
// Dal 28/11 (titolare) il conto è obbligatorio e un incasso sbagliato si storna dalla rata.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ScadenzarioPage } from './ScadenzarioPage';
import { fetchScadenzarioIncassiApi, registraIncassoApi, stornaIncassoApi, fetchClienti, fetchContiBancariApi } from '../api/client';

vi.mock('../api/client', () => ({
  fetchScadenzarioIncassiApi: vi.fn(),
  registraIncassoApi: vi.fn(),
  stornaIncassoApi: vi.fn(),
  fetchClienti: vi.fn(),
  fetchContiBancariApi: vi.fn(),
}));
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../context/PeriodoContext', () => ({ usePeriodo: () => ({ dataDa: '', dataA: '' }) }));
vi.mock('../components/ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() }) }));
vi.mock('../components/solleciti/InviaSollecitoModal', () => ({ InviaSollecitoModal: () => null }));
vi.mock('../components/ui/FiltroPeriodo', () => ({ FiltroPeriodo: () => null }));

const mockRegistra = registraIncassoApi as ReturnType<typeof vi.fn>;
const mockStorna = stornaIncassoApi as ReturnType<typeof vi.fn>;
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

// Il primo mount del file paga il riscaldamento di React e jsdom (misurato: 228 ms contro ~35 ms
// dei successivi): sotto il carico di più giri di prove insieme ha portato il primo test oltre i
// 5 s (run 46151502939). Lo si paga qui, una volta, fuori dai test, col modale compreso.
beforeAll(async () => {
  (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([RATA]);
  (fetchClienti as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockConti.mockResolvedValue(CONTI);
  const pagina = render(<ScadenzarioPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Registra Incasso/ }));
  await screen.findByLabelText(/Data dell'incasso/);
  pagina.unmount();
});

beforeEach(() => {
  vi.clearAllMocks();
  (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([RATA]);
  (fetchClienti as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockConti.mockResolvedValue(CONTI);
  mockRegistra.mockResolvedValue({ ok: true });
  mockStorna.mockResolvedValue({ ok: true });
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

  it('senza un conto scelto l’incasso non parte: il conto è obbligatorio', async () => {
    mockConti.mockResolvedValue([{ id: 'conto-1', nomeConto: 'Conto operativo', banca: 'Banca Uno', isDefault: false }]);
    await apriModale();
    const conto = (await screen.findByLabelText(/Conto su cui è entrato il denaro/)) as HTMLSelectElement;
    await waitFor(() => expect(conto.disabled).toBe(false));
    expect(conto.value).toBe('');
    expect(conto.required).toBe(true);
    expect((screen.getByRole('button', { name: /Conferma/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockRegistra).not.toHaveBeenCalled();
  });

  it('studio senza conti → lo dice, manda a Banche e conti e non registra niente', async () => {
    mockConti.mockResolvedValue([]);
    await apriModale();
    expect((await screen.findByRole('alert')).textContent).toContain('Lo studio non ha ancora un conto');
    expect((screen.getByRole('button', { name: /Conferma/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Apri Banche e conti/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/banks');
    expect(mockRegistra).not.toHaveBeenCalled();
  });

  it('elenco dei conti non letto → è un errore dichiarato, non «nessun conto», e si può riprovare', async () => {
    mockConti.mockRejectedValueOnce(new Error('Errore recupero conti bancari'));
    await apriModale();
    expect((await screen.findByRole('alert')).textContent).toContain('Elenco dei conti non letto');
    expect(screen.queryByText(/Lo studio non ha ancora un conto/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Riprova/ }));
    await waitFor(() => expect((screen.getByLabelText(/Conto su cui è entrato il denaro/) as HTMLSelectElement).value).toBe('conto-2'));
  });
});

describe('ScadenzarioPage — storno di un incasso', () => {
  const INCASSO = { id: 'inc-1', importoIncassatoCentesimi: 48800, dataIncasso: '2026-11-20T00:00:00.000Z', metodoPagamento: 'bonifico', stornoDiId: null };
  const SALDATA = { ...RATA, stato: 'incassato', registrazioniRegistrate: [INCASSO] };

  it('una rata senza incassi non offre lo storno', async () => {
    render(<ScadenzarioPage />);
    await screen.findByRole('button', { name: /Registra Incasso/ });
    expect(screen.queryByRole('button', { name: /Storna incasso/ })).toBeNull();
  });

  it('un incasso già stornato non si storna una seconda volta', async () => {
    const storno = { id: 'st-1', importoIncassatoCentesimi: -48800, stornoDiId: 'inc-1' };
    (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...RATA, stato: 'in_attesa', registrazioniRegistrate: [INCASSO, storno] }]);
    render(<ScadenzarioPage />);
    await screen.findByRole('button', { name: /Registra Incasso/ });
    expect(screen.queryByRole('button', { name: /Storna incasso/ })).toBeNull();
  });

  it('rata saldata → «Storna incasso» chiede il motivo e lo manda al server con l’incasso giusto', async () => {
    (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([SALDATA]);
    render(<ScadenzarioPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Storna incasso/ }));
    const conferma = (await screen.findByRole('button', { name: /^Storna incasso$/ })) as HTMLButtonElement;
    // Senza motivo non si storna.
    expect(conferma.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo dello storno/), { target: { value: 'Registrato sulla rata sbagliata' } });
    expect(conferma.disabled).toBe(false);
    fireEvent.click(conferma);

    await waitFor(() => expect(mockStorna).toHaveBeenCalledTimes(1));
    expect(mockStorna).toHaveBeenCalledWith('sc-1', 'inc-1', { motivo: 'Registrato sulla rata sbagliata' });
    // Dopo la conferma la pagina rilegge le rate dal server.
    await waitFor(() => expect((fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1));
  });

  it('storno rifiutato dal server → il modale resta aperto', async () => {
    (fetchScadenzarioIncassiApi as ReturnType<typeof vi.fn>).mockResolvedValue([SALDATA]);
    mockStorna.mockRejectedValue(new Error('Questo incasso è già stato stornato.'));
    render(<ScadenzarioPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Storna incasso/ }));
    fireEvent.change(await screen.findByLabelText(/Motivo dello storno/), { target: { value: 'Importo sbagliato' } });
    fireEvent.click(screen.getByRole('button', { name: /^Storna incasso$/ }));
    await waitFor(() => expect(mockStorna).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/Motivo dello storno/)).toBeTruthy();
  });
});
