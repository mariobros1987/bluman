// Titolare, 28/11/2026 — il form scelto sull'articolo si salva. Prima valeva finché la pagina
// restava aperta, e i form erano tre nomi scritti nel codice.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore: vi.fn(), attenzione: vi.fn(), info: vi.fn() }) }));
vi.mock('../../hooks/useCartellaTemplate', () => ({
  useCartellaTemplate: () => ({ modelli: [], sincronizza: vi.fn().mockResolvedValue(undefined), crea: vi.fn() }),
}));
vi.mock('../../api/client', () => ({ updateArticoloPrezzoApi: vi.fn() }));
vi.mock('../../api/formMaster', () => ({ fetchFormMasterApi: vi.fn() }));

import { ArticoliCatalogView } from './ArticoliCatalogView';
import { updateArticoloPrezzoApi } from '../../api/client';
import { fetchFormMasterApi } from '../../api/formMaster';
import type { Articolo } from '../../types';

const FORM = [{ id: 'f-1', nome: 'Dati societari', campi: ['Ragione sociale', 'IBAN'], articoli: 0 }];

function articolo(over: Partial<Articolo> = {}): Articolo {
  return { id: 'art-1', n: 'Atto costitutivo', cat: 'Societario' as Articolo['cat'], h: 4, p: 500, ver: 1, formMasterId: null, ...over };
}

function apri(art: Articolo) {
  render(
    <MemoryRouter>
      <ArticoliCatalogView articoliList={[art]} onOpenNew={vi.fn()} onDisattiva={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(updateArticoloPrezzoApi).mockReset().mockResolvedValue({});
  vi.mocked(fetchFormMasterApi).mockReset().mockResolvedValue(FORM);
});

describe('ArticoliCatalogView — il form del cliente sull’articolo', () => {
  it('la scheda dell’articolo nomina il form vero, letto dal server', async () => {
    apri(articolo({ formMasterId: 'f-1' }));
    expect(await screen.findByText('Dati societari')).toBeTruthy();
  });

  it('scegliere un form e salvare lo manda al server', async () => {
    apri(articolo());
    fireEvent.click(screen.getByRole('button', { name: /Modifica/ }));
    const scelta = (await screen.findByLabelText(/Form da far compilare al cliente/)) as HTMLSelectElement;
    await waitFor(() => expect(scelta.disabled).toBe(false));
    fireEvent.change(scelta, { target: { value: 'f-1' } });
    fireEvent.submit(scelta.closest('form')!);

    await waitFor(() =>
      expect(updateArticoloPrezzoApi).toHaveBeenCalledWith('art-1', expect.objectContaining({ formMasterId: 'f-1', nome: 'Atto costitutivo' })),
    );
  });

  it('«nessun form» si salva come `null`, non come stringa vuota', async () => {
    apri(articolo({ formMasterId: 'f-1' }));
    fireEvent.click(screen.getByRole('button', { name: /Modifica/ }));
    const scelta = (await screen.findByLabelText(/Form da far compilare al cliente/)) as HTMLSelectElement;
    await waitFor(() => expect(scelta.disabled).toBe(false));
    fireEvent.change(scelta, { target: { value: '' } });
    fireEvent.submit(scelta.closest('form')!);

    await waitFor(() => expect(updateArticoloPrezzoApi).toHaveBeenCalledWith('art-1', expect.objectContaining({ formMasterId: null })));
  });

  it('form non letti: è un errore dichiarato, e la scelta resta ferma', async () => {
    vi.mocked(fetchFormMasterApi).mockRejectedValue(new Error('Server non raggiungibile'));
    apri(articolo({ formMasterId: 'f-1' }));
    fireEvent.click(screen.getByRole('button', { name: /Modifica/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('Form non letti');
    expect((screen.getByLabelText(/Form da far compilare al cliente/) as HTMLSelectElement).disabled).toBe(true);
  });
});
