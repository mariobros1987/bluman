// La pagina personale del cliente: tre stati distinti, «tocca a te» in testa, e le fasi con lo
// stato che ha calcolato il server.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { AzioneCliente, FaseRiepilogo, RiepilogoProgetto } from '../../api/canaleProtetto';
import type { DocumentoPortale } from '../../api/client';
import { TabRiepilogo } from './TabRiepilogo';
import type { StatoRiepilogo } from './usePortalRiepilogo';

const fase = (parziale: Partial<FaseRiepilogo>): FaseRiepilogo => ({
  id: 'm-1', nome: 'Costituzione', categoria: 'Societario', fase: 'in_corso', percentuale: 40, attivitaTotali: 5, attivitaConcluse: 2,
  attende: [], richiesteDaFare: 0, daConfermare: false, confermata: false, ...parziale,
});

function progetto(parziale: Partial<RiepilogoProgetto> = {}): RiepilogoProgetto {
  return { id: 'p-1', nome: 'Costituzione Malta', numeroContratto: 'EL-2026-001', stato: 'in_progress', percentuale: 40, turno: 'studio', letteraFirmata: true, fasi: [fase({})], azioni: [], richieste: [], ...parziale };
}

const pronto = (progetti: RiepilogoProgetto[]): StatoRiepilogo => ({ fase: 'pronto', dati: { canaleProtetto: { cifraturaAttiva: true, disponibile: true }, progetti } });

const richiesta: AzioneCliente = { tipo: 'richiesta', titolo: 'Dati della società', dettaglio: 'Richiesto dallo studio per la fase «Costituzione».', scheda: 'richieste', riferimentoId: 'r-1', urgente: false };
const fattura: AzioneCliente = { tipo: 'fattura', titolo: 'Fattura FT-1 scaduta', dettaglio: 'La scadenza della rata è passata.', scheda: 'fatture', riferimentoId: 'f-1', urgente: true, importoCentesimi: 122000, scadenza: '2026-11-15T00:00:00.000Z' };

describe('stati della pagina', () => {
  it('caricamento, errore e «nessun incarico» sono tre cose diverse', () => {
    const ricarica = vi.fn();
    const { rerender } = render(<TabRiepilogo stato={{ fase: 'caricamento' }} ricarica={ricarica} documenti={[]} onApri={() => {}} />);
    expect(screen.getByText(/Leggo lo stato dei tuoi incarichi/)).toBeTruthy();

    rerender(<TabRiepilogo stato={{ fase: 'errore', messaggio: 'HTTP 500.' }} ricarica={ricarica} documenti={[]} onApri={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('Non vuol dire che non ci sia niente da fare');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(ricarica).toHaveBeenCalled();

    rerender(<TabRiepilogo stato={pronto([])} ricarica={ricarica} documenti={[]} onApri={() => {}} />);
    expect(screen.getByText(/Non hai ancora incarichi aperti/)).toBeTruthy();
  });
});

describe('tocca a te', () => {
  it('senza niente da fare lo dice, e dice chi sta lavorando', () => {
    render(<TabRiepilogo stato={pronto([progetto()])} ricarica={() => {}} documenti={[]} onApri={() => {}} />);
    expect(screen.getByRole('heading', { name: /Adesso non devi fare niente/ })).toBeTruthy();
    expect(screen.getByText('Ci sta lavorando lo studio')).toBeTruthy();
    expect(screen.getByText(/Come si forma questo elenco/)).toBeTruthy();
  });

  it('elenca le cose da fare, con importo e scadenza della fattura, e apre la scheda giusta', () => {
    const onApri = vi.fn();
    const documenti = [{ id: 'd-1', titolo: 'Atto costitutivo', progettoId: 'p-1', richiedeFirma: true } as DocumentoPortale];
    render(<TabRiepilogo stato={pronto([progetto({ turno: 'cliente', azioni: [fattura, richiesta] })])} ricarica={() => {}} documenti={documenti} onApri={onApri} />);
    expect(screen.getByRole('heading', { name: 'Tocca a te: 3 cose da fare' })).toBeTruthy();
    const righe = screen.getAllByRole('listitem').filter((li) => within(li).queryByRole('button'));
    expect(righe.slice(0, 3).map((li) => within(li).getByRole('button').textContent)).toEqual(['Vedi la fattura →', 'Apri i documenti →', 'Rispondi →']);
    // Stesso formato delle altre schede del portale, dall'importo in centesimi dato dal server.
    expect(righe[0]!.textContent).toContain('€ 1.220');
    expect(righe[0]!.textContent).toContain('15/11/2026');
    fireEvent.click(within(righe[2]!).getByRole('button'));
    expect(onApri).toHaveBeenCalledWith('p-1', 'richieste');
    expect(screen.getByText('Tocca a te: 3 cose da fare', { selector: 'span' })).toBeTruthy();
  });
});

describe('fasi dell’incarico', () => {
  it('mostra lo stato del server: in corso con la percentuale, in attesa con ciò che aspetta, conclusa da confermare', () => {
    const onApri = vi.fn();
    render(
      <TabRiepilogo
        stato={pronto([progetto({
          fasi: [
            fase({ id: 'a', nome: 'Analisi', fase: 'completato', percentuale: 100, attivitaConcluse: 5, daConfermare: true }),
            fase({ id: 'b', nome: 'Costituzione', richiesteDaFare: 2 }),
            fase({ id: 'c', nome: 'Apertura conto', fase: 'in_attesa', percentuale: 0, attivitaConcluse: 0, attende: ['Costituzione'] }),
            fase({ id: 'd', nome: 'Chiusura', fase: 'da_iniziare', percentuale: 0, attivitaTotali: 0, attivitaConcluse: 0 }),
          ],
        })])}
        ricarica={() => {}}
        documenti={[]}
        onApri={onApri}
      />,
    );
    expect(screen.getByText('Completato')).toBeTruthy();
    expect(screen.getByText('In corso (40%)')).toBeTruthy();
    expect(screen.getByText('Inizia dopo: Costituzione')).toBeTruthy();
    expect(screen.getByText('Da iniziare')).toBeTruthy();
    expect(screen.getByText('2 di 5 attività concluse')).toBeTruthy();
    expect(screen.getByText(/non ha ancora dettagliato le attività/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    fireEvent.click(screen.getByRole('button', { name: /2 richieste per te/ }));
    expect(onApri).toHaveBeenLastCalledWith('p-1', 'richieste');
    fireEvent.click(screen.getByRole('button', { name: /aspetta la tua conferma/ }));
    expect(onApri).toHaveBeenLastCalledWith('p-1', 'avanzamento');
  });

  it('con più incarichi ogni cosa da fare dice di quale incarico è', () => {
    render(
      <TabRiepilogo
        stato={pronto([progetto({ azioni: [richiesta] }), progetto({ id: 'p-2', nome: 'Trust familiare', fasi: [] })])}
        ricarica={() => {}}
        documenti={[]}
        onApri={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'I tuoi incarichi' })).toBeTruthy();
    expect(screen.getByText(/Incarico:/).textContent).toContain('Costituzione Malta');
    expect(screen.getByText(/non ha ancora aperto le fasi di lavoro/)).toBeTruthy();
  });
});
