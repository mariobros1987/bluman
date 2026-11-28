// L'invio dallo studio sul portale: il file viaggia dentro il messaggio (`allegatiProtetti`), così
// il server lo cifra; non passa dall'archivio pubblico, dove resterebbe in chiaro dietro un link.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  inviaComunicazioneApi: vi.fn(),
  uploadFileApi: vi.fn(),
  sendEmailDirectApi: vi.fn(),
  fetchTenantInfoApi: vi.fn(),
  sendSignalDirectApi: vi.fn(),
  sendTelegramDirectApi: vi.fn(),
  sendWhatsAppDirectApi: vi.fn(),
}));
vi.mock('../api/client', () => api);

import { useInvioComunicazione, type AllegatoInviato, type MessaggioInviato } from './useInvioComunicazione';

const contatto = { referente: 'Anna Rossi', email: 'anna@example.com', whatsapp: '', telegram: '', signal: '' };
const file = { nome: 'visura.pdf', base64: 'data:application/pdf;base64,JVBERi0=', sizeStr: '12 KB', mime: 'application/pdf' };
const evento = { preventDefault: () => {} } as React.FormEvent;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

describe('useInvioComunicazione — allegato sul portale', () => {
  it('manda il file dentro il messaggio e non lo carica nell’archivio pubblico', async () => {
    api.inviaComunicazioneApi.mockResolvedValue({
      id: 'c-1',
      allegatiJson: [{ protetto: true, nome: 'visura.pdf', dimensione: '12 KB', mime: 'application/pdf', url: '/progetti/p-1/comunicazioni/c-1/allegati/0' }],
    });
    const inviati: MessaggioInviato[] = [];
    const registrati: AllegatoInviato[][] = [];
    const { result } = renderHook(() => useInvioComunicazione({
      progettoId: 'p-1',
      contatto: contatto as never,
      canalePredefinito: 'portal',
      onInviato: (m) => inviati.push(m),
      onAllegati: (_id, allegati) => registrati.push(allegati),
    }));

    act(() => result.current.setFileAllegato(file));
    await act(async () => { await result.current.invia(evento); });

    expect(api.uploadFileApi).not.toHaveBeenCalled();
    expect(api.inviaComunicazioneApi).toHaveBeenCalledWith('p-1', expect.objectContaining({
      canale: 'portal',
      allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: file.base64 }],
    }));
    expect(api.inviaComunicazioneApi.mock.calls[0]![1]).not.toHaveProperty('allegatiJson');
    // La riga compare subito col nome del file; l'indirizzo per riscaricarlo arriva dal server.
    expect(inviati[0]!.allegati).toEqual([expect.objectContaining({ nome: 'visura.pdf', protetto: true, url: '' })]);
    expect(registrati[0]![0]!.url).toBe('/progetti/p-1/comunicazioni/c-1/allegati/0');
  });

  it('sugli altri canali l’allegato resta un file caricato, com’era', async () => {
    api.uploadFileApi.mockResolvedValue({ url: '/uploads/visura.pdf', name: 'visura.pdf', size: '12 KB' });
    api.inviaComunicazioneApi.mockResolvedValue({ id: 'c-2' });
    api.fetchTenantInfoApi.mockResolvedValue({ ragioneSociale: 'Studio Prova' });
    api.sendEmailDirectApi.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useInvioComunicazione({ progettoId: 'p-1', contatto: contatto as never, canalePredefinito: 'email' }));

    act(() => result.current.setFileAllegato(file));
    await act(async () => { await result.current.invia(evento); });

    expect(api.uploadFileApi).toHaveBeenCalledWith('visura.pdf', file.base64);
    const corpo = api.inviaComunicazioneApi.mock.calls[0]![1];
    expect(corpo.allegatiJson).toEqual([expect.objectContaining({ url: '/uploads/visura.pdf' })]);
    expect(corpo).not.toHaveProperty('allegatiProtetti');
  });
});
