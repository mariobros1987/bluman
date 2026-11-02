// F4 — le note di una voce: nessuna nota creata all'apertura, e l'autore è l'utente collegato.
// Prima il modale apriva con una nota fabbricata e firmava ogni nota nuova con un nome scritto nel
// codice, qualunque fosse l'operatore.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const { errore, fetchProfiloUtenteApi } = vi.hoisted(() => ({
  errore: vi.fn(),
  fetchProfiloUtenteApi: vi.fn(),
}));

vi.mock('../api/auth', () => ({ fetchProfiloUtenteApi }));
vi.mock('../api/client', () => ({
  salvaDocumentoApi: vi.fn(),
  generaDocumentoApi: vi.fn(),
  listaDocumentiProgetto: vi.fn().mockResolvedValue([]),
  aggiornaStatoDocumentoApi: vi.fn(),
  nuovaVersioneDocumentoApi: vi.fn(),
  aggiornaRichiestaModificaDocumentoApi: vi.fn(),
  sbloccaDocumentoApi: vi.fn(),
  scaricaDocumentoClient: vi.fn(),
  scaricaDocumentoWordClient: vi.fn(),
  urlFileArchivio: vi.fn(),
}));
vi.mock('../api/progetti', () => ({ fetchComunicazioniMicrovoceApi: vi.fn().mockResolvedValue([]) }));
vi.mock('./ui/ToastProvider', () => ({
  useToast: () => ({ successo: vi.fn(), errore, info: vi.fn(), attenzione: vi.fn() }),
}));
vi.mock('./ui/ConfirmProvider', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
// Le altre schede e i modali secondari non c'entrano: qui si guarda solo la scheda Note.
vi.mock('./passaggio/TabPassaggi', () => ({ TabPassaggi: () => null }));
vi.mock('./passaggio/TabDocumenti', () => ({ TabDocumenti: () => null }));
vi.mock('./passaggio/TabMessaggi', () => ({ TabMessaggi: () => null }));
vi.mock('./passaggio/ComposerMicrovoce', () => ({ ComposerMicrovoce: () => null }));
vi.mock('./passaggio/ModaleCatalogo', () => ({ ModaleCatalogo: () => null }));
vi.mock('./passaggio/ModaleConfigFirma', () => ({ ModaleConfigFirma: () => null }));
vi.mock('./passaggio/ModaleNuovaAzione', () => ({ ModaleNuovaAzione: () => null }));
vi.mock('./passaggio/ModaleFormPassaggio', () => ({ ModaleFormPassaggio: () => null }));

import { PassaggioModal } from './PassaggioModal';

function progetto() {
  return {
    id: 'p-1',
    n: 'Pratica di prova',
    mods: [{ id: 1, n: 'Costituzione', cat: 'societario', v: [{ n: 'Atto costitutivo', proc: [] }] }],
  } as any;
}

function apriNote(onSaveVoce = vi.fn()) {
  render(<PassaggioModal project={progetto()} mid={1} vidx={0} onClose={vi.fn()} onSaveVoce={onSaveVoce} />);
  fireEvent.click(screen.getByRole('button', { name: /Note & Registro Attività/ }));
  return onSaveVoce;
}

function registra(testo: string) {
  fireEvent.change(screen.getByPlaceholderText(/Inserisci dettagli/), { target: { value: testo } });
  fireEvent.click(screen.getByRole('button', { name: /Registra Nota/ }));
}

beforeEach(() => {
  errore.mockClear();
  fetchProfiloUtenteApi.mockReset();
});

describe('PassaggioModal — note (F4)', () => {
  it("all'apertura non c'è nessuna nota fabbricata", async () => {
    fetchProfiloUtenteApi.mockResolvedValue({ nome: 'Giulia Neri', email: 'giulia@studio.example' });
    apriNote();

    expect(screen.getByRole('button', { name: /Note & Registro Attività \(0\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/Dibenedetto/)).toBeNull();
  });

  it("l'autore della nota è l'utente collegato", async () => {
    fetchProfiloUtenteApi.mockResolvedValue({ nome: 'Giulia Neri', email: 'giulia@studio.example' });
    const onSaveVoce = apriNote();
    // Lascia risolvere la lettura del profilo e il relativo aggiornamento di stato.
    await act(async () => {});

    registra('Chiamato il notaio');

    await waitFor(() => expect(onSaveVoce).toHaveBeenCalled());
    const note = onSaveVoce.mock.calls[0]![1];
    expect(note[0]).toMatchObject({ autore: 'Giulia Neri', testo: 'Chiamato il notaio' });
    expect(screen.getByText(/Giulia Neri/)).toBeInTheDocument();
  });

  it("senza profilo leggibile la nota non si registra e l'errore si dichiara", async () => {
    fetchProfiloUtenteApi.mockRejectedValue(new Error('Errore recupero profilo'));
    const onSaveVoce = apriNote();
    await act(async () => {});

    registra('Nota orfana');

    expect(errore).toHaveBeenCalledWith(expect.stringMatching(/utente collegato/));
    expect(onSaveVoce).not.toHaveBeenCalled();
  });
});
