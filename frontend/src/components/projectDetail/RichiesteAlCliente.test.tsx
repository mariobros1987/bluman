// La riga «In mano al cliente» sopra i moduli: compare solo se c'è qualcosa di aperto per il
// cliente, e l'avviso dice com'è andata con le parole del server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { avvisaClienteRichiesteApi } = vi.hoisted(() => ({ avvisaClienteRichiesteApi: vi.fn() }));
vi.mock('../../api/canaleProtetto', () => ({ avvisaClienteRichiesteApi }));

import { RichiesteAlCliente } from './RichiesteAlCliente';

const moduli = [
  {
    microvoci: [
      {
        passaggi: [
          { chi: 'cliente', stato: 'pending', rispostaClienteAt: '2026-11-20T10:00:00.000Z' },
          { chi: 'cliente', stato: 'pending', rispostaClienteAt: null },
          { chi: 'cliente', stato: 'done', rispostaClienteAt: '2026-11-18T10:00:00.000Z' },
          { chi: 'operatore', stato: 'pending' },
        ],
      },
      { passaggi: undefined },
    ],
  },
  { microvoci: undefined },
];

beforeEach(() => {
  avvisaClienteRichiesteApi.mockReset();
});

describe('RichiesteAlCliente', () => {
  it('senza passaggi aperti per il cliente non mostra niente', () => {
    const { container } = render(<RichiesteAlCliente progettoId="p-1" moduli={[{ microvoci: [{ passaggi: [{ chi: 'operatore', stato: 'pending' }] }] }]} />);
    expect(container.textContent).toBe('');
    // Un progetto senza moduli letti non è un errore: non c'è niente da dire.
    expect(render(<RichiesteAlCliente progettoId="p-1" moduli={undefined} />).container.textContent).toBe('');
  });

  it('conta solo i passaggi del cliente ancora aperti, dice quanti hanno già la risposta, e avvisa', async () => {
    avvisaClienteRichiesteApi.mockResolvedValue({ ok: true, richieste: 1 });
    render(<RichiesteAlCliente progettoId="p-1" moduli={moduli} />);

    expect(screen.getByText(/2 passaggi aperti/)).toBeTruthy();
    expect(screen.getByText(/1 ha già la sua risposta/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Avvisa il cliente/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Cliente avvisato: 1 richiesta'));
    expect(avvisaClienteRichiesteApi).toHaveBeenCalledWith('p-1');
  });

  it('se l’avviso non parte lo dice, con il motivo del server', async () => {
    avvisaClienteRichiesteApi.mockRejectedValue(new Error('Non ci sono richieste aperte da segnalare.'));
    render(<RichiesteAlCliente progettoId="p-1" moduli={moduli} />);

    fireEvent.click(screen.getByRole('button', { name: /Avvisa il cliente/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Non ci sono richieste aperte'));
  });
});
