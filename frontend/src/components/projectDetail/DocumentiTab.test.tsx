// §7 — il vault non fabbrica documenti. Prima, per il tenant Bluecode e per i progetti con id
// `1`/`2`/`proj-001`/`proj-002`, costruiva a runtime tutti i modelli dello studio con data
// 15/08/2026 e due marcati `firmato: true` («sottoscritti con Firma Elettronica Semplice»):
// due documenti firmati che nessuno aveva firmato, dati da leggere come atti reali.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../api/client', () => ({
  listaDocumentiProgetto: vi.fn().mockResolvedValue([]),
  salvaDocumentoApi: vi.fn(),
  eliminaDocumentoApi: vi.fn(),
  archiviaDocumentoApi: vi.fn(),
  scaricaDocumentoClient: vi.fn(),
  scaricaDocumentoWordClient: vi.fn(),
}));

vi.mock('../ui/ToastProvider', () => ({
  useToast: () => ({ successo: vi.fn(), errore: vi.fn(), info: vi.fn() }),
}));

vi.mock('../ui/ConfirmProvider', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('../documenti/FirmaStudioModal', () => ({ FirmaStudioModal: () => null }));

import { DocumentiTab } from './DocumentiTab';
import { listaDocumentiProgetto } from '../../api/client';

function progetto(id: string) {
  return { id, cl: 'Holding Beta S.r.l.', n: 'Progetto Structuring Holding Malta', val: 5000 } as any;
}

describe('DocumentiTab — il vault contiene solo documenti che esistono', () => {
  beforeEach(() => localStorage.clear());

  it('con un id progetto numerico e il tenant demo il vault è vuoto, senza atti «firmati»', async () => {
    render(<DocumentiTab project={progetto('1')} />);

    // Il vault si è disegnato davvero: senza questa riga il test passerebbe anche se il
    // componente non rendesse nulla.
    expect(screen.getByPlaceholderText(/Cerca file nel Vault/)).toBeTruthy();

    // La lettura dal database è l'unica fonte: qui risponde vuota.
    await waitFor(() => expect(listaDocumentiProgetto).toHaveBeenCalled());

    // I due documenti che il vault fabbricava e marcava come firmati.
    expect(screen.queryByText(/Lettera d'Incarico Professionale \(Engagement Letter\)/)).toBeNull();
    expect(screen.queryByText(/Accordo di Riservatezza & Non Divulgazione \(NDA\)/)).toBeNull();
    expect(screen.queryByText(/15\/08\/2026/)).toBeNull();
    expect(screen.queryByText(/Sottoscritto con Firma Elettronica Semplice/)).toBeNull();
  });
});
