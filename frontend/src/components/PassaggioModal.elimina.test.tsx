// «Elimina passaggio»: il passaggio si toglie prima dal server e poi dalla pagina. Prima spariva
// solo a schermo e tornava alla riapertura; e se il server non lo toglie, resta e lo si dice.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { errore, eliminaPassaggioMicrovoceApi } = vi.hoisted(() => ({ errore: vi.fn(), eliminaPassaggioMicrovoceApi: vi.fn() }));

vi.mock('../api/auth', () => ({ fetchProfiloUtenteApi: vi.fn().mockResolvedValue({ nome: 'Lorenzo' }) }));
vi.mock('../api/client', () => ({
  salvaDocumentoApi: vi.fn(), generaDocumentoApi: vi.fn(), listaDocumentiProgetto: vi.fn().mockResolvedValue([]),
  aggiornaStatoDocumentoApi: vi.fn(), nuovaVersioneDocumentoApi: vi.fn(), aggiornaRichiestaModificaDocumentoApi: vi.fn(),
  sbloccaDocumentoApi: vi.fn(), scaricaDocumentoClient: vi.fn(), scaricaDocumentoWordClient: vi.fn(), urlFileArchivio: vi.fn(),
}));
vi.mock('../api/progetti', () => ({
  fetchComunicazioniMicrovoceApi: vi.fn().mockResolvedValue({ microvoce: { id: 'mv-1', nome: '' }, messaggi: [] }),
  eliminaPassaggioMicrovoceApi,
}));
vi.mock('./ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore, info: vi.fn(), attenzione: vi.fn() }) }));
vi.mock('./ui/ConfirmProvider', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
// Della scheda dei passaggi qui serve solo l'elenco e il comando di eliminazione.
vi.mock('./passaggio/TabPassaggi', () => ({
  TabPassaggi: (p: any) => (
    <div>
      {p.visible.map((s: any) => (
        <button key={s.id} type="button" onClick={() => void p.handleDeleteStep(s.id)}>Elimina {s.title}</button>
      ))}
    </div>
  ),
}));
vi.mock('./passaggio/TabDocumenti', () => ({ TabDocumenti: () => null }));
vi.mock('./passaggio/TabMessaggi', () => ({ TabMessaggi: () => null }));
vi.mock('./passaggio/TabNote', () => ({ TabNote: () => null }));
vi.mock('./passaggio/ComposerMicrovoce', () => ({ ComposerMicrovoce: () => null }));
vi.mock('./passaggio/ModaleCatalogo', () => ({ ModaleCatalogo: () => null }));
vi.mock('./passaggio/ModaleConfigFirma', () => ({ ModaleConfigFirma: () => null }));
vi.mock('./passaggio/ModaleNuovaAzione', () => ({ ModaleNuovaAzione: () => null }));
vi.mock('./passaggio/ModaleFormPassaggio', () => ({ ModaleFormPassaggio: () => null }));

import { PassaggioModal } from './PassaggioModal';

const PASSAGGI = [
  { id: 'a1', title: 'Briefing', type: 'info', who: 'operatore', stato: 'pending' },
  { id: 'a2', title: 'Raccolta dati', type: 'form', who: 'cliente', stato: 'pending' },
];
const progetto = () => ({
  id: 'p-1', n: 'Pratica di prova', cl: 'Cliente',
  mods: [{ id: 1, n: 'Costituzione', cat: 'societario', v: [{ n: 'Atto costitutivo', s: 'pending', proc: PASSAGGI.map((p) => ({ ...p })) }] }],
}) as any;

function apri(onSaveVoce = vi.fn(), microvoceDbId: string | undefined = 'mv-1') {
  render(<PassaggioModal project={progetto()} mid={1} vidx={0} onClose={vi.fn()} onSaveVoce={onSaveVoce} microvoceDbId={microvoceDbId} />);
  return onSaveVoce;
}

beforeEach(() => {
  errore.mockClear();
  eliminaPassaggioMicrovoceApi.mockReset();
  eliminaPassaggioMicrovoceApi.mockResolvedValue({ eliminato: true });
});

describe('PassaggioModal — eliminare un passaggio', () => {
  it('lo toglie dal server e poi dalla pagina', async () => {
    const onSaveVoce = apri();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina Raccolta dati' }));

    await waitFor(() => expect(eliminaPassaggioMicrovoceApi).toHaveBeenCalledWith('mv-1', 'a2'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Elimina Raccolta dati' })).toBeNull());
    expect(onSaveVoce.mock.calls[0]![0].map((s: any) => s.id)).toEqual(['a1']);
  });

  it('se il server non lo toglie, il passaggio resta e lo si dice', async () => {
    eliminaPassaggioMicrovoceApi.mockRejectedValue(new Error('Il passaggio non è stato eliminato. Riprova.'));
    const onSaveVoce = apri();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina Raccolta dati' }));

    await waitFor(() => expect(errore).toHaveBeenCalledWith('Il passaggio non è stato eliminato. Riprova.'));
    expect(screen.getByRole('button', { name: 'Elimina Raccolta dati' })).toBeTruthy();
    expect(onSaveVoce).not.toHaveBeenCalled();
  });
});
