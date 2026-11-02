// 3.11 — la rotta della firma dello studio restituisce `copiaFirmataErrore` quando la copia
// firmata del PDF non si genera. Il modale lo ignorava: l'operatore credeva di avere il PDF
// firmato. La firma resta valida (onSigned) e l'avviso dice cosa manca.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api/documenti', () => ({
  firmaStudioDocumentoApi: vi.fn(),
  richiediOtpStudioApi: vi.fn(),
}));
vi.mock('../ui/ToastProvider', () => ({
  toast: { successo: vi.fn(), errore: vi.fn(), info: vi.fn(), attenzione: vi.fn() },
}));

import { FirmaStudioModal } from './FirmaStudioModal';
import { firmaStudioDocumentoApi } from '../../api/documenti';
import { toast } from '../ui/ToastProvider';

const doc = { id: 'doc-1', fileUrl: 'https://storage.test/originale.pdf' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom non disegna: basta che la firma grafica produca un'immagine.
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

async function firma() {
  const onSigned = vi.fn();
  const onClose = vi.fn();
  render(<FirmaStudioModal doc={doc} onClose={onClose} onSigned={onSigned} />);
  fireEvent.click(screen.getByRole('button', { name: /Apponi Firma Studio/ }));
  await waitFor(() => expect(onSigned).toHaveBeenCalled());
  return { onSigned, onClose };
}

describe('FirmaStudioModal — copia firmata non generata (3.11)', () => {
  it('firma valida ma copia mancante: avviso con il motivo, la firma resta mostrata come apposta', async () => {
    vi.mocked(firmaStudioDocumentoApi).mockResolvedValue({
      ok: true,
      firma: { signatureId: 'SIG-1' },
      fileFirmatoUrl: doc.fileUrl,
      copiaFirmataErrore: 'Copia firmata non generata: lettura firme fallita',
    });
    const { onSigned } = await firma();

    expect(onSigned).toHaveBeenCalledWith(expect.objectContaining({ firmato: true, firmatoDaStudio: true }));
    expect(toast.attenzione).toHaveBeenCalledWith(
      "Firma apposta. La copia firmata del PDF non è stata generata: lettura firme fallita. Riprova la generazione o contatta l'amministratore.",
      0,
    );
  });

  it('copia generata: nessun avviso', async () => {
    vi.mocked(firmaStudioDocumentoApi).mockResolvedValue({ ok: true, firma: { signatureId: 'SIG-1' }, fileFirmatoUrl: 'https://storage.test/firmato.pdf' });
    await firma();
    expect(toast.attenzione).not.toHaveBeenCalled();
  });
});
