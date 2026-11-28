// Titolare, 28/11/2026 (risposta 13) — l'ultimo passaggio chiude l'attività: se non ci sono ore
// segnate si chiede «completare lo stesso?», e un no lascia il passaggio com'era.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../api/auth', () => ({ fetchProfiloUtenteApi: vi.fn().mockResolvedValue({ nome: 'Giulia Neri' }) }));
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
vi.mock('./ui/ToastProvider', () => ({ useToast: () => ({ successo: vi.fn(), errore: vi.fn(), info: vi.fn(), attenzione: vi.fn() }) }));
vi.mock('./ui/ConfirmProvider', () => ({ confirm }));
// Della scheda Passaggi qui serve solo il gesto «spunta il passaggio».
vi.mock('./passaggio/TabPassaggi', () => ({
  TabPassaggi: ({ visible, toggleDone }: any) => (
    <div>
      {visible.map((s: any) => (
        <button key={s.id} type="button" onClick={() => toggleDone(s.id)}>{`${s.titolo} [${s.stato}]`}</button>
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

function apri(hA: number, onSaveVoce = vi.fn()) {
  const proc = [
    { id: 's-1', titolo: 'Raccolta dati', tipo: 'azione', chi: 'studio', stato: 'done' },
    { id: 's-2', titolo: 'Deposito', tipo: 'azione', chi: 'studio', stato: 'pending' },
  ];
  const project = { id: 'p-1', n: 'Pratica', mods: [{ id: 1, n: 'Costituzione', cat: 'societario', v: [{ n: 'Atto', hA, hE: 4, s: 'active', proc }] }] } as any;
  render(<PassaggioModal project={project} mid={1} vidx={0} onClose={vi.fn()} onSaveVoce={onSaveVoce} />);
  return onSaveVoce;
}

beforeEach(() => confirm.mockReset());

describe('PassaggioModal — ultimo passaggio senza ore segnate', () => {
  it('chiede conferma; con un no il passaggio resta da fare e non si salva niente', async () => {
    confirm.mockResolvedValue(false);
    const onSaveVoce = apri(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposito [pending]' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      messaggio: 'Non hai segnato ore su questa attività: completare lo stesso?',
    })));
    expect(screen.getByRole('button', { name: 'Deposito [pending]' })).toBeTruthy();
    expect(onSaveVoce).not.toHaveBeenCalled();
  });

  it('con un sì il passaggio si chiude e l’attività si salva', async () => {
    confirm.mockResolvedValue(true);
    const onSaveVoce = apri(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposito [pending]' }));

    expect(await screen.findByRole('button', { name: 'Deposito [done]' })).toBeTruthy();
    expect(onSaveVoce).toHaveBeenCalledTimes(1);
  });

  it('con ore segnate non chiede niente', async () => {
    const onSaveVoce = apri(3);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposito [pending]' }));

    expect(await screen.findByRole('button', { name: 'Deposito [done]' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(onSaveVoce).toHaveBeenCalledTimes(1);
  });

  it('riaprire un passaggio fatto non chiede niente', async () => {
    apri(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Raccolta dati [done]' }));
    expect(await screen.findByRole('button', { name: 'Raccolta dati [pending]' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });
});
