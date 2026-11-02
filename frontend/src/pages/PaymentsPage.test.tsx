// 2.2 — la data dell'incasso si sceglie nella modale e arriva all'API come `dataIncasso`
// (AAAA-MM-GG): prima la schermata non la chiedeva e il server registrava sempre «oggi».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { errore } = vi.hoisted(() => ({ errore: vi.fn() }));
vi.mock('../api/client', () => ({
  fetchScadenzarioIncassiApi: vi.fn(),
  registraIncassoApi: vi.fn(),
  fetchClienti: vi.fn(),
}));
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ successo: vi.fn(), errore, info: vi.fn(), attenzione: vi.fn() }),
}));

import { PaymentsPage } from './PaymentsPage';
import { fetchScadenzarioIncassiApi, registraIncassoApi, fetchClienti } from '../api/client';
import { oggi, aggiungiGiorni } from '../utils/calendarioDate';

const SCADENZA = {
  id: 'scad-1',
  numeroRata: 1,
  dataScadenza: '2026-10-01',
  importoCentesimi: 50000,
  stato: 'da_incassare',
  fattura: { numero: 'FT-2026/001', progetto: { cliente: { nome: 'Rossi Spa' } } },
};

async function apriModale() {
  render(<PaymentsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Registra Incasso/ }));
  return screen.getByLabelText("Data dell'incasso *") as HTMLInputElement;
}

beforeEach(() => {
  errore.mockClear();
  vi.mocked(fetchScadenzarioIncassiApi).mockResolvedValue([SCADENZA] as any);
  vi.mocked(fetchClienti).mockResolvedValue([] as any);
  vi.mocked(registraIncassoApi).mockReset().mockResolvedValue({ ok: true } as any);
});

describe('2.2 — data dell’incasso nella modale', () => {
  it('campo data con etichetta, default oggi e massimo oggi', async () => {
    const campo = await apriModale();
    expect(campo.type).toBe('date');
    expect(campo.value).toBe(oggi());
    expect(campo.max).toBe(oggi());
  });

  it('la data scelta arriva all’API come dataIncasso AAAA-MM-GG', async () => {
    const campo = await apriModale();
    const ieri = aggiungiGiorni(oggi(), -1);
    fireEvent.change(campo, { target: { value: ieri } });
    fireEvent.click(screen.getByRole('button', { name: /Salva in Prima Nota/ }));

    await waitFor(() => expect(registraIncassoApi).toHaveBeenCalled());
    expect(vi.mocked(registraIncassoApi).mock.calls[0]![1]).toMatchObject({
      importoIncassatoCentesimi: 50000,
      dataIncasso: ieri,
    });
  });

  it('una data futura non parte: lo si dice e l’API non viene chiamata', async () => {
    const campo = await apriModale();
    fireEvent.change(campo, { target: { value: aggiungiGiorni(oggi(), 1) } });
    fireEvent.submit(campo.closest('form')!);

    expect(errore).toHaveBeenCalledWith(expect.stringMatching(/mai futura/));
    expect(registraIncassoApi).not.toHaveBeenCalled();
  });
});
