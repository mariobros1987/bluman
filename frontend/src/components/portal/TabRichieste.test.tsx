// Le richieste dello studio nel portale: tre stati distinti, quattro gruppi, e una risposta che
// non si perde se il salvataggio fallisce.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RichiestaCliente, RiepilogoProgetto } from '../../api/canaleProtetto';
import { TabRichieste } from './TabRichieste';
import type { StatoRiepilogo } from './usePortalRiepilogo';

vi.mock('../../api/canaleProtetto', async (importOriginal) => {
  const reale = await importOriginal<typeof import('../../api/canaleProtetto')>();
  return { ...reale, rispondiRichiestaApi: vi.fn() };
});

import { rispondiRichiestaApi } from '../../api/canaleProtetto';

const rispondi = rispondiRichiestaApi as ReturnType<typeof vi.fn>;

function richiesta(parziale: Partial<RichiestaCliente> = {}): RichiestaCliente {
  return {
    id: 'r-1', progettoId: 'p-1', faseId: 'm-1', faseNome: 'Costituzione', attivitaId: 'mv-1', attivitaNome: 'Raccolta dati',
    titolo: 'Dati della società', descrizione: 'Servono per l’atto.', tipo: 'form',
    campi: [{ nome: 'P.IVA', valore: null, ripreso: false }, { nome: 'Sede', valore: 'Valletta', ripreso: true }],
    modelloUrl: null, linkIstruzioni: null, stato: 'da_fare', quando: 'ora', inviataIl: null, ...parziale,
  };
}

function pronto(richieste: RichiestaCliente[]): StatoRiepilogo {
  const progetto: RiepilogoProgetto = { id: 'p-1', nome: 'Costituzione Malta', numeroContratto: null, stato: 'in_progress', percentuale: 10, turno: 'cliente', letteraFirmata: true, fasi: [], azioni: [], richieste };
  return { fase: 'pronto', dati: { canaleProtetto: { cifraturaAttiva: true, disponibile: true }, progetti: [progetto] } };
}

beforeEach(() => vi.clearAllMocks());

describe('stati della scheda', () => {
  it('caricamento, errore e «nessuna richiesta» sono tre cose diverse', () => {
    const ricarica = vi.fn();
    const { rerender } = render(<TabRichieste stato={{ fase: 'caricamento' }} ricarica={ricarica} anteprima={false} />);
    expect(screen.getByText(/Leggo le richieste/)).toBeTruthy();

    rerender(<TabRichieste stato={{ fase: 'errore', messaggio: 'HTTP 500.' }} ricarica={ricarica} anteprima={false} />);
    expect(screen.getByRole('alert').textContent).toContain('Non vuol dire che non ce ne siano');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(ricarica).toHaveBeenCalled();

    rerender(<TabRichieste stato={pronto([])} ricarica={ricarica} anteprima={false} />);
    expect(screen.getByText(/non ti ha chiesto niente/)).toBeTruthy();
  });

  it('divide le richieste per ciò che il cliente deve farne', () => {
    render(
      <TabRichieste
        stato={pronto([
          richiesta({ id: 'a' }),
          richiesta({ id: 'b', stato: 'inviata', inviataIl: '2026-11-20T10:00:00Z' }),
          richiesta({ id: 'c', quando: 'piu_avanti' }),
          richiesta({ id: 'd', stato: 'chiusa' }),
        ])}
        ricarica={() => {}}
        anteprima={false}
      />,
    );
    for (const titolo of ['Da fare adesso (1)', 'Inviate, in controllo (1)', 'Più avanti (1)', 'Chiuse (1)']) {
      expect(screen.getByRole('heading', { name: titolo })).toBeTruthy();
    }
    expect(screen.getByText(/✓ Chiusa dallo studio/)).toBeTruthy();
  });
});

describe('rispondere a una richiesta', () => {
  it('propone il valore già dato altrove e lo dichiara; un campo vuoto ferma l’invio prima del server', async () => {
    render(<TabRichieste stato={pronto([richiesta()])} ricarica={() => {}} anteprima={false} />);
    expect((screen.getByLabelText('Sede') as HTMLInputElement).value).toBe('Valletta');
    expect(screen.getByText(/L'avevi già indicato in un'altra richiesta/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia allo studio' }));
    expect(await screen.findByText(/Manca la risposta a «P.IVA»/)).toBeTruthy();
    expect(rispondi).not.toHaveBeenCalled();
  });

  it('se il salvataggio fallisce lo dice e lascia ciò che è stato scritto', async () => {
    rispondi.mockRejectedValue(new Error('La risposta non è stata salvata. Riprova.'));
    const ricarica = vi.fn();
    render(<TabRichieste stato={pronto([richiesta()])} ricarica={ricarica} anteprima={false} />);
    fireEvent.change(screen.getByLabelText('P.IVA'), { target: { value: 'MT12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia allo studio' }));
    expect(await screen.findByText(/Risposta non inviata\./)).toBeTruthy();
    expect((screen.getByLabelText('P.IVA') as HTMLInputElement).value).toBe('MT12345678');
    expect(ricarica).not.toHaveBeenCalled();
  });

  it('a risposta salvata rilegge dal server', async () => {
    rispondi.mockResolvedValue({ ok: true, inviataIl: '2026-11-28T10:00:00Z' });
    const ricarica = vi.fn();
    render(<TabRichieste stato={pronto([richiesta()])} ricarica={ricarica} anteprima={false} />);
    fireEvent.change(screen.getByLabelText('P.IVA'), { target: { value: ' MT12345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia allo studio' }));
    await waitFor(() => expect(ricarica).toHaveBeenCalled());
    expect(rispondi).toHaveBeenCalledWith('r-1', { risposte: { 'P.IVA': 'MT12345678', Sede: 'Valletta' }, nota: undefined, allegatiProtetti: [] });
  });

  it('un documento richiesto non parte senza il file', async () => {
    render(<TabRichieste stato={pronto([richiesta({ tipo: 'documento', campi: [], modelloUrl: '/uploads/modulo.pdf?sig=1' })])} ricarica={() => {}} anteprima={false} />);
    expect(screen.getByRole('link', { name: /Scarica il documento dello studio/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia allo studio' }));
    expect(await screen.findByText(/aspetta un documento/)).toBeTruthy();
    expect(rispondi).not.toHaveBeenCalled();
  });

  it('in anteprima lo studio vede la richiesta ma non risponde al posto del cliente', () => {
    render(<TabRichieste stato={pronto([richiesta()])} ricarica={() => {}} anteprima />);
    expect(screen.getByText(/la risposta la invia il cliente/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Invia allo studio' })).toBeNull();
    expect((screen.getByLabelText('P.IVA') as HTMLInputElement).disabled).toBe(true);
  });
});
