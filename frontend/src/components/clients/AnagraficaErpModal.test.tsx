// F3 — un salvataggio fallito dell'anagrafica si dichiara: niente onSaved(), il modale resta aperto
// e la copia in localStorage non si scrive. Prima il localStorage era scritto *prima* della chiamata
// API e onSaved() partiva in `finally`, anche sull'errore.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api/client', () => ({
  fetchProgetti: vi.fn().mockResolvedValue([]),
  creaClienteApi: vi.fn(),
  aggiornaClienteApi: vi.fn(),
  proposteDatiStudioApi: vi.fn().mockResolvedValue([]),
  confermaPropostaDatiApi: vi.fn(),
  rifiutaPropostaDatiApi: vi.fn(),
}));
vi.mock('../../api/kyc', () => ({
  fetchKycFascicoloApi: vi.fn().mockResolvedValue({ fascicolo: null }),
  creaKycFascicoloApi: vi.fn(),
  aggiornaStatoKycApi: vi.fn(),
  fetchModuliTenant: vi.fn().mockResolvedValue([]),
  scaricaReportFascicoloPdf: vi.fn(),
}));

import { AnagraficaErpModal } from './AnagraficaErpModal';
import { aggiornaClienteApi } from '../../api/client';

const CLIENTE = { id: 'c-0f3a', nome: 'Rossi Spa', tipo: 'company' } as any;

function chiaviClientiInLocalStorage(): string[] {
  return Object.keys(localStorage).filter((k) => k.includes('bluman_custom_clients'));
}

function salva() {
  const form = document.querySelector('form');
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
}

beforeEach(() => {
  vi.mocked(aggiornaClienteApi).mockReset();
});

describe('AnagraficaErpModal — salvataggio (F3)', () => {
  it("su errore API mostra l'errore, non chiama onSaved e non scrive il localStorage", async () => {
    vi.mocked(aggiornaClienteApi).mockRejectedValue(new Error('Errore aggiornamento cliente'));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<AnagraficaErpModal client={{ ...CLIENTE }} onClose={onClose} onSaved={onSaved} />);

    salva();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Salvataggio non riuscito/);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(chiaviClientiInLocalStorage()).toEqual([]);
  });

  it('su successo chiama onSaved e solo allora scrive la copia in localStorage', async () => {
    vi.mocked(aggiornaClienteApi).mockResolvedValue({ id: CLIENTE.id });
    const onSaved = vi.fn();
    render(<AnagraficaErpModal client={{ ...CLIENTE }} onClose={vi.fn()} onSaved={onSaved} />);

    salva();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(aggiornaClienteApi).toHaveBeenCalledWith(CLIENTE.id, expect.objectContaining({ nome: 'Rossi Spa' }));
    expect(chiaviClientiInLocalStorage()).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// Analisi del 26/11, E6 ed F4 — un cliente senza dati nasceva con giurisdizione e nazione «Italia»,
// capitale 10.000 €, codice SDI «0000000» e regime «RF01 - Ordinario», e al primo salvataggio quei
// valori diventavano suoi. E tredici campi erano obbligatori per tutti, PEC e codice SDI compresi:
// per un cliente estero si riempivano con dati finti.
describe('AnagraficaErpModal — niente dati inventati, niente campi obbligatori che non valgono per tutti (E6, F4)', () => {
  it('cliente senza dati: il salvataggio non scrive Italia, 10.000, 0000000 né RF01', async () => {
    vi.mocked(aggiornaClienteApi).mockResolvedValue({ id: CLIENTE.id });
    const onSaved = vi.fn();
    render(<AnagraficaErpModal client={{ ...CLIENTE }} onClose={vi.fn()} onSaved={onSaved} />);

    salva();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const inviato = vi.mocked(aggiornaClienteApi).mock.calls[0][1] as any;
    const testo = JSON.stringify(inviato);
    expect(testo).not.toMatch(/Italia/);
    expect(testo).not.toMatch(/10000/);
    expect(testo).not.toMatch(/0000000/);
    expect(testo).not.toMatch(/RF01/);
    expect(inviato.giurisdizione).toBe('');
    expect(inviato.sdiCode).toBe('');
    expect(inviato.sedeLegale).toBe('');
  });

  it('i dati che il cliente ha davvero restano quelli', async () => {
    vi.mocked(aggiornaClienteApi).mockResolvedValue({ id: CLIENTE.id });
    const onSaved = vi.fn();
    render(
      <AnagraficaErpModal
        client={{ ...CLIENTE, giurisdizione: 'Malta', sdiCode: 'ABC1234', referentiJson: { capitale: 1200, nazione: 'Malta', citta: 'Sliema' } }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    salva();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const inviato = vi.mocked(aggiornaClienteApi).mock.calls[0][1] as any;
    expect(inviato.giurisdizione).toBe('Malta');
    expect(inviato.sdiCode).toBe('ABC1234');
    expect(inviato.sedeLegale).toBe('Sliema - Malta');
    expect(JSON.stringify(inviato)).toContain('1200');
  });

  it('l’unico campo obbligatorio del modulo è il nome', () => {
    render(<AnagraficaErpModal client={{ ...CLIENTE }} onClose={vi.fn()} onSaved={vi.fn()} />);
    const obbligatori = Array.from(document.querySelectorAll('input[required], select[required], textarea[required]')).map((e) => e.id);
    expect(obbligatori).toEqual(['cli-nome']);
  });
});

// Proposta M4 dell'analisi del 26/11 — la scheda chiede a ciascun tipo di cliente i dati che ha.
describe('AnagraficaErpModal — campi secondo il tipo di cliente (M4)', () => {
  it('società: ragione sociale, registro imprese e capitale ci sono', () => {
    render(<AnagraficaErpModal client={{ ...CLIENTE, tipo: 'company' }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Ragione sociale *')).toBeTruthy();
    expect(screen.getByLabelText('Registro Imprese / REA')).toBeTruthy();
    expect(screen.getByLabelText('Capitale Sociale (€)')).toBeTruthy();
  });

  it('persona fisica: nome e cognome, e niente registro imprese né capitale sociale', () => {
    render(<AnagraficaErpModal client={{ ...CLIENTE, tipo: 'individual' }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Nome e cognome *')).toBeTruthy();
    expect(screen.queryByLabelText('Registro Imprese / REA')).toBeNull();
    expect(screen.queryByLabelText('Capitale Sociale (€)')).toBeNull();
    expect(screen.getByLabelText('Partita IVA (solo se ne ha una)')).toBeTruthy();
  });

  it('cambiando tipo i campi seguono, e i dati societari già salvati non si perdono', async () => {
    vi.mocked(aggiornaClienteApi).mockResolvedValue({ id: CLIENTE.id });
    const onSaved = vi.fn();
    render(<AnagraficaErpModal client={{ ...CLIENTE, tipo: 'company', giurisdizione: 'Malta' }} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Tipo di cliente *'), { target: { value: 'individual' } });
    expect(screen.queryByLabelText('Paese di costituzione')).toBeNull();

    salva();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const inviato = vi.mocked(aggiornaClienteApi).mock.calls[0][1] as any;
    expect(inviato.tipo).toBe('individual');
    expect(inviato.giurisdizione).toBe('Malta');
  });
});
