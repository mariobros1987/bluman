// Analisi del 26/11, E12 — «Salda con F24» era il secondo di due passi: senza aver premuto prima
// «Salva LIPE» il server rispondeva «non trovata». E il versamento non chiedeva da quale conto
// usciva il denaro, quindi l'uscita non scendeva da nessun saldo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LiquidazioneIvaPage } from './LiquidazioneIvaPage';
import { calcolaLipeApi, fetchLiquidazioniIvaApi, salvaLipeApi, marcaVersataLipeApi } from '../api/liquidazioneIva';
import { fetchContiBancariApi } from '../api/client';

vi.mock('../api/liquidazioneIva', () => ({
  calcolaLipeApi: vi.fn(),
  fetchLiquidazioniIvaApi: vi.fn(),
  salvaLipeApi: vi.fn(),
  marcaVersataLipeApi: vi.fn(),
}));
vi.mock('../api/client', () => ({ fetchContiBancariApi: vi.fn() }));
vi.mock('../components/contabilita/EsportaFascicoloCommercialistaModal', () => ({ EsportaFascicoloCommercialistaModal: () => null }));

const CALCOLO = {
  periodo: { tipo: 'trimestrale', anno: 2026, trimestre: 4, codicePeriodo: '2026-Q4', dataInizio: '2026-10-01', dataFine: '2026-12-31' },
  totaleImponibileVenditeCent: 48800, ivaDebitoCent: 10736, totaleImponibileAcquistiCent: 0, ivaCreditoCent: 0,
  saldoIvaCent: 10736, stato: 'debito', importoDaVersareCent: 10736, creditoRiportabileCent: 0,
  prospettoF24: { annoRiferimento: 2026, periodoRiferimento: '2026-Q4', righe: [], totaleDebitoCent: 10736, totaleCreditoCent: 0, saldoFinaleCent: 10736 },
  registrazioneEsistente: null,
};
const mockSalva = salvaLipeApi as ReturnType<typeof vi.fn>;
const mockMarca = marcaVersataLipeApi as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (calcolaLipeApi as ReturnType<typeof vi.fn>).mockResolvedValue(CALCOLO);
  (fetchLiquidazioniIvaApi as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (fetchContiBancariApi as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'conto-1', nomeConto: 'Conto operativo', banca: 'Banca Uno', isDefault: false },
    { id: 'conto-2', nomeConto: 'Conto principale', banca: 'Banca Due', isDefault: true },
  ]);
  mockSalva.mockResolvedValue({ riepilogo: CALCOLO });
  mockMarca.mockResolvedValue({ ok: true });
});

async function apriVersamento() {
  render(<LiquidazioneIvaPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Salda con F24/ }));
  return screen.findByLabelText(/Conto da cui esce il versamento/);
}

describe('LiquidazioneIvaPage — «Salda con F24» in un gesto solo (E12)', () => {
  it('liquidazione mai salvata: la conferma la salva e poi la segna versata, in quest’ordine', async () => {
    await apriVersamento();
    fireEvent.click(screen.getByRole('button', { name: /Conferma Saldo F24/ }));

    await waitFor(() => expect(mockMarca).toHaveBeenCalledTimes(1));
    expect(mockSalva).toHaveBeenCalledTimes(1);
    expect(mockSalva.mock.invocationCallOrder[0]).toBeLessThan(mockMarca.mock.invocationCallOrder[0]);
  });

  it('il conto proposto è il predefinito, quello scelto arriva al server, e il riferimento vuoto non si inventa', async () => {
    const conto = (await apriVersamento()) as HTMLSelectElement;
    expect(conto.value).toBe('conto-2');
    fireEvent.change(conto, { target: { value: 'conto-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Conferma Saldo F24/ }));

    await waitFor(() => expect(mockMarca).toHaveBeenCalledTimes(1));
    const dati = mockMarca.mock.calls[0][1];
    expect(dati.contoBancarioId).toBe('conto-1');
    expect(dati.riferimentoTransazione).toBeNull();
  });

  it('se il salvataggio fallisce non si segna versata, e l’errore si legge nel modale', async () => {
    mockSalva.mockRejectedValue(new Error('Errore salvataggio liquidazione IVA'));
    await apriVersamento();
    fireEvent.click(screen.getByRole('button', { name: /Conferma Saldo F24/ }));

    await waitFor(() => expect(screen.getAllByText(/Errore salvataggio liquidazione IVA/).length).toBeGreaterThan(0));
    expect(mockMarca).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Conferma Saldo F24/ })).toBeTruthy();
  });
});
