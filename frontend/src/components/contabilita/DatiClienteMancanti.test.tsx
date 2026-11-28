// Titolare, 28/11/2026 — la fattura non parte senza i dati del cliente: il rifiuto del server
// diventa un elenco di ciò che manca, con il pulsante che porta alla scheda del cliente.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDatiClienteMancanti } from './DatiClienteMancanti';
import { ErroreDatiClienteMancanti, erroreEmissione } from '../../api/erroriEmissione';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

let esito: boolean | null = null;
function Pagina({ errore }: { errore: unknown }) {
  const dati = useDatiClienteMancanti();
  return (
    <div>
      <button type="button" onClick={() => { esito = dati.intercetta(errore); }}>Emetti</button>
      {dati.modale}
    </div>
  );
}

const risposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });

beforeEach(() => { navigate.mockClear(); esito = null; });

describe('dati del cliente mancanti', () => {
  it('il 409 del server diventa l’errore con l’elenco dei dati', async () => {
    const err = await erroreEmissione(risposta(409, {
      errore: 'La fattura non si può emettere', codice: 'DATI_CLIENTE_MANCANTI',
      datiMancanti: ['partita IVA (o codice fiscale)'], clienteId: 'c-1', clienteNome: 'Rossi Srl',
    }), 'Errore emissione fattura');
    expect(err).toBeInstanceOf(ErroreDatiClienteMancanti);
    expect((err as ErroreDatiClienteMancanti).datiMancanti).toEqual(['partita IVA (o codice fiscale)']);
  });

  it('un altro rifiuto resta un errore normale, col messaggio del server', async () => {
    const err = await erroreEmissione(risposta(409, { errore: 'KYC non approvato' }), 'Errore emissione fattura');
    expect(err).not.toBeInstanceOf(ErroreDatiClienteMancanti);
    expect(err.message).toBe('KYC non approvato');
  });

  it('mostra cosa manca e porta alla scheda del cliente', () => {
    const errore = new ErroreDatiClienteMancanti('x', ['partita IVA (o codice fiscale)', 'indirizzo (sede legale o residenza)'], 'Rossi & Figli Srl', 'c-1');
    render(<Pagina errore={errore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Emetti' }));

    expect(esito).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('partita IVA (o codice fiscale)')).toBeTruthy();
    expect(screen.getByText('indirizzo (sede legale o residenza)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Apri la scheda del cliente/ }));
    expect(navigate).toHaveBeenCalledWith('/clients?client=Rossi%20%26%20Figli%20Srl');
  });

  it('un errore qualunque non apre il modale: lo mostra la pagina', () => {
    render(<Pagina errore={new Error('Errore di rete')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Emetti' }));
    expect(esito).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
