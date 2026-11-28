// Titolare, 28/11/2026 (risposta 7) — «campo sconto sul progetto». Il valore lo calcola e lo
// salva il server: qui si scrive solo lo sconto, e un salvataggio fallito lascia il modale aperto.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScontoProgettoModal } from './ScontoProgettoModal';
import { salvaScontoProgettoApi } from '../../api/client';

vi.mock('../../api/client', () => ({ salvaScontoProgettoApi: vi.fn() }));
vi.mock('../ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() }) }));

const salva = salvaScontoProgettoApi as ReturnType<typeof vi.fn>;
const onClose = vi.fn();
const onSalvato = vi.fn();

function apri(scontoCentesimi = 0) {
  render(<ScontoProgettoModal progettoId="p-1" sommaModuliCentesimi={1860000} scontoCentesimi={scontoCentesimi} onClose={onClose} onSalvato={onSalvato} />);
  return screen.getByLabelText('Sconto (€)') as HTMLInputElement;
}

beforeEach(() => { vi.clearAllMocks(); salva.mockResolvedValue({ ok: true }); });

describe('ScontoProgettoModal', () => {
  it('lo sconto scritto arriva al server in centesimi, poi la pagina rilegge e il modale si chiude', async () => {
    const campo = apri();
    fireEvent.change(campo, { target: { value: '1000.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva sconto' }));

    await waitFor(() => expect(salva).toHaveBeenCalledWith('p-1', 100050));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSalvato).toHaveBeenCalled();
  });

  it('parte dallo sconto già salvato; svuotarlo lo toglie', async () => {
    const campo = apri(100000);
    expect(campo.value).toBe('1000.00');
    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva sconto' }));
    await waitFor(() => expect(salva).toHaveBeenCalledWith('p-1', 0));
  });

  it('uno sconto pari alla somma dei moduli non si salva, e lo dice', () => {
    const campo = apri();
    fireEvent.change(campo, { target: { value: '18600' } });
    expect(screen.getByRole('alert').textContent).toContain('più basso della somma dei moduli');
    expect((screen.getByRole('button', { name: 'Salva sconto' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('salvataggio rifiutato → il modale resta aperto', async () => {
    salva.mockRejectedValue(new Error('Solo il responsabile dello studio può scrivere lo sconto di un progetto.'));
    const campo = apri();
    fireEvent.change(campo, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva sconto' }));
    await waitFor(() => expect(salva).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSalvato).not.toHaveBeenCalled();
  });
});
