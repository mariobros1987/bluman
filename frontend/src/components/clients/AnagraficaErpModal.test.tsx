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
