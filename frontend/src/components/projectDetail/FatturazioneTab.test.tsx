// N3, N4, F2 — la scheda Fatturazione non inventa dati.
// - N3: una voce senza valore aveva 400 €, 120 €/h o 1000 € di ripiego; ora è «importo mancante».
// - N4: numero e stato della fattura venivano dall'indice in elenco e da un testo fisso.
// - F2: la proforma ripiegava su una riga «Incarico Professionale» da 3500 €, e un pulsante
//   annunciava una sincronizzazione con Scadenzario e Prima Nota che nessuna API faceva.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { navigate, attenzione, successo } = vi.hoisted(() => ({
  navigate: vi.fn(),
  attenzione: vi.fn(),
  successo: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../api/client', () => ({ emettiFatturaApi: vi.fn() }));
vi.mock('../../api/fatturazione', () => ({ downloadFatturaPdfServerApi: vi.fn() }));
vi.mock('../ui/ToastProvider', () => ({
  useToast: () => ({ successo, errore: vi.fn(), info: vi.fn(), attenzione }),
}));

import { FatturazioneTab } from './FatturazioneTab';
import { emettiFatturaApi } from '../../api/client';

function progetto(extra: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    n: 'Pratica Rossi',
    cl: 'Rossi Spa',
    val: 5000,
    fatture: [],
    // Modulo senza valore, con una voce completata e 5 ore consuntivate: prima valeva 5 × 120 €.
    mods: [{ id: 1, n: 'Modulo A', st: 'in_progress', v: [{ id: 11, n: 'Parere', s: 'done', hA: 5 }] }],
    ...extra,
  } as any;
}

function apriCompositore(p = progetto()) {
  render(<FatturazioneTab project={p} rawDbProject={{ id: 'p-1', fatture: [] }} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Componi Fattura da Microvoci/ }));
}

beforeEach(() => {
  navigate.mockClear();
  attenzione.mockClear();
  successo.mockClear();
  vi.mocked(emettiFatturaApi).mockReset();
  sessionStorage.clear();
});

describe('N3 — una voce senza importo resta senza importo', () => {
  it('mostra «importo mancante», non è preselezionata e non ha un valore inventato', () => {
    apriCompositore();

    expect(screen.getByText('importo mancante')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Importo Parere')).toHaveValue(null);
  });

  it('non si emette finché non le si dà un importo', async () => {
    vi.mocked(emettiFatturaApi).mockResolvedValue({ numero: 'FT-2026/008' });
    apriCompositore();
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /Emetti Fattura Fiscale/ }));
    expect(emettiFatturaApi).not.toHaveBeenCalled();
    expect(attenzione).toHaveBeenCalledWith(expect.stringMatching(/importo per: Parere/));

    fireEvent.change(screen.getByLabelText('Importo Parere'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: /Emetti Fattura Fiscale/ }));
    await waitFor(() => expect(emettiFatturaApi).toHaveBeenCalledTimes(1));
    expect(vi.mocked(emettiFatturaApi).mock.calls[0]![0].righe[0].importo).toBe(30000);
  });
});

describe('N4 — numero e stato della fattura vengono dai dati reali', () => {
  it('mostra il numero vero, non quello costruito dalla posizione in elenco', () => {
    const fatture = [{ id: 'f-1', numero: 'FT-2026/007', desc: 'Consulenza', importo: 1220, stato: 'emessa' }];
    render(<FatturazioneTab project={progetto({ fatture })} onRefresh={vi.fn()} />);

    expect(screen.getByText('FT-2026/007')).toBeInTheDocument();
    expect(screen.queryByText(/FT-2026-001/)).toBeNull();
    expect(screen.queryByText(/pronta per invio/)).toBeNull();
  });

  it('senza numero lo dice, invece di inventarlo', () => {
    const fatture = [{ id: 'f-1', desc: 'Consulenza', importo: 1220, stato: 'emessa' }];
    render(<FatturazioneTab project={progetto({ fatture })} onRefresh={vi.fn()} />);

    expect(screen.getByText('numero non disponibile')).toBeInTheDocument();
  });
});

describe('F2 — niente righe o conferme fabbricate', () => {
  it('nessun pulsante annuncia una sincronizzazione che non avviene', () => {
    render(<FatturazioneTab project={progetto()} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Registro Incassi Progetto/ })).toBeNull();
  });

  it('progetto senza voci: la proforma non riceve una riga «Incarico Professionale»', () => {
    render(<FatturazioneTab project={progetto({ mods: [] })} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redigi Proforma in Document Studio/ }));

    expect(attenzione).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bluman_proforma_table_rows')).toBeNull();
  });

  it('progetto con voci: la proforma riceve le voci vere', () => {
    render(<FatturazioneTab project={progetto()} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redigi Proforma in Document Studio/ }));

    const salvato = JSON.parse(sessionStorage.getItem('bluman_proforma_table_rows') || '{}');
    expect(salvato.rows.map((r: any) => r.titolo)).toEqual(['Parere']);
    expect(salvato.rows[0].importo).toBeNull();
    expect(navigate).toHaveBeenCalled();
  });
});
