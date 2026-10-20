// Coda KYC — la pagina.
//
// Non si prova l'impaginazione: si prova che la pagina **non tolga né aggiunga potere** rispetto
// al server. Tre cose in particolare:
//
// - ciò che il server dice non approvabile arriva a schermo con il suo motivo, e la casella non si
//   può spuntare: un pulsante che promette un'approvazione che il backend rifiuterà è un inganno,
//   anche se il rifiuto è corretto;
// - «tutte le approvabili» seleziona **solo** quelle, non tutte le righe;
// - i rifiuti dell'ultima approvazione restano visibili: la coda non deve far credere che sia
//   passato tutto perché una parte è passata.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompliancePage } from './CompliancePage';
import { fetchCodaKycApi, fetchModuliTenant, approvaMassivaKycApi } from '../api/kyc';
import { confirm } from '../components/ui/ConfirmProvider';

vi.mock('../api/kyc', () => ({
  fetchCodaKycApi: vi.fn(),
  fetchModuliTenant: vi.fn(),
  approvaMassivaKycApi: vi.fn(),
}));

vi.mock('../components/ui/ConfirmProvider', () => ({
  confirm: vi.fn(),
}));

const mockCoda = fetchCodaKycApi as ReturnType<typeof vi.fn>;
const mockModuli = fetchModuliTenant as ReturnType<typeof vi.fn>;
const mockApprova = approvaMassivaKycApi as ReturnType<typeof vi.fn>;
const mockConfirm = confirm as unknown as ReturnType<typeof vi.fn>;

const riga = (over: Record<string, unknown> = {}) => ({
  id: 'f-1',
  stato: 'in_attesa_approvazione',
  livelloVerifica: 'ordinaria',
  rischio: 'basso',
  punteggioRischio: 10,
  dataScadenza: null,
  aggiornatoIl: '2026-10-19T08:00:00Z',
  cliente: { id: 'c-1', nome: 'Rossi Srl', tipo: 'company' },
  soggetto: 'Rossi Srl',
  screeningBloccante: false,
  anomalieAperte: 0,
  approvabile: true,
  motivi: [],
  ...over,
});

const PRONTA = riga({ id: 'f-pronta', cliente: { id: 'c-1', nome: 'Rossi Srl', tipo: 'company' } });
const BLOCCATA = riga({
  id: 'f-bloccata',
  stato: 'in_verifica',
  cliente: { id: 'c-2', nome: 'Bianchi Spa', tipo: 'company' },
  soggetto: 'Bianchi Spa',
  approvabile: false,
  motivi: ['Il fascicolo è in «in_verifica»: prima va portato in attesa di approvazione.'],
});

function coda(over: Record<string, unknown> = {}) {
  return {
    fascicoli: [PRONTA, BLOCCATA],
    totale: 2,
    profiloConfigurato: true,
    puoApprovareRafforzata: true,
    ...over,
  };
}

beforeEach(() => {
  mockCoda.mockReset();
  mockModuli.mockReset();
  mockApprova.mockReset();
  mockConfirm.mockReset();
  mockModuli.mockResolvedValue({ concessi: ['kyc'], disattivati: [], attivi: ['kyc'] });
  mockCoda.mockResolvedValue(coda());
  mockConfirm.mockResolvedValue(true);
});

describe('CompliancePage — cosa è approvabile', () => {
  it('mostra il motivo del blocco e non lascia spuntare quella riga', async () => {
    render(<CompliancePage />);

    expect(await screen.findByText(/prima va portato in attesa di approvazione/i)).toBeInTheDocument();
    const casellaBloccata = screen.getByRole('checkbox', { name: /Seleziona la pratica di Bianchi Spa/i });
    expect(casellaBloccata).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Seleziona la pratica di Rossi Srl/i })).toBeEnabled();
  });

  it('senza profilo regolatorio lo dice e non si può selezionare nulla', async () => {
    mockCoda.mockResolvedValue(coda({
      profiloConfigurato: false,
      fascicoli: [riga({ approvabile: false, motivi: ['Profilo regolatorio non configurato: prima va impostato in Impostazioni.'] })],
    }));
    render(<CompliancePage />);

    expect(await screen.findByText(/Il profilo regolatorio non è configurato/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i })).toBeDisabled();
  });

  it('con il modulo KYC spento lo spiega, invece di mostrare una coda vuota', async () => {
    mockModuli.mockResolvedValue({ concessi: [], disattivati: [], attivi: [] });
    render(<CompliancePage />);

    expect(await screen.findByText(/non è attivo per questo studio/i)).toBeInTheDocument();
  });
});

describe('CompliancePage — l’approvazione massiva', () => {
  it('«tutte le approvabili» seleziona solo quelle e l’API riceve solo i loro id', async () => {
    render(<CompliancePage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i }));
    expect(screen.getByRole('button', { name: /Approva selezionate \(1\)/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /Approva selezionate/i }));
    await waitFor(() => expect(mockApprova).toHaveBeenCalledTimes(1));
    const [ids, motivazione] = mockApprova.mock.calls[0]!;
    expect(ids).toEqual(['f-pronta']);
    expect(motivazione).toBeUndefined();
  });

  it('i rifiuti restano a schermo con il loro motivo', async () => {
    mockApprova.mockResolvedValue({
      ok: true,
      approvati: 1,
      rifiutati: [{ id: 'f-bloccata', motivo: 'Screening PEP con un match non risolto.' }],
    });
    render(<CompliancePage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approva selezionate/i }));

    const pannello = await screen.findByText(/L’ultima approvazione ha lasciato fuori 1 pratica/i);
    expect(pannello).toBeInTheDocument();
    // Il motivo è attribuito alla pratica giusta, non lasciato senza nome.
    expect(screen.getByText(/Bianchi Spa: Screening PEP con un match non risolto/i)).toBeInTheDocument();
  });

  it('annullare la conferma non chiama il backend', async () => {
    mockConfirm.mockResolvedValue(false);
    render(<CompliancePage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approva selezionate/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockApprova).not.toHaveBeenCalled();
  });

  it('passa la motivazione solo se scritta', async () => {
    render(<CompliancePage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i }));
    await userEvent.type(screen.getByLabelText(/Motivazione/i), 'Coda settimanale');
    await userEvent.click(screen.getByRole('button', { name: /Approva selezionate/i }));

    await waitFor(() => expect(mockApprova).toHaveBeenCalledTimes(1));
    expect(mockApprova.mock.calls[0]![1]).toBe('Coda settimanale');
  });
});

describe('CompliancePage — l’intestazione', () => {
  it('conta separatamente quante sono in coda e quante sono approvabili ora', async () => {
    render(<CompliancePage />);
    await screen.findByRole('checkbox', { name: /Seleziona tutte le pratiche approvabili/i });

    // «2 in coda» da solo sarebbe scoraggiante: dice quanta carta c'è, non quanta se ne può evadere.
    expect(screen.getByText('2 in coda')).toBeInTheDocument();
    expect(screen.getByText('1 approvabili ora')).toBeInTheDocument();
  });
});
