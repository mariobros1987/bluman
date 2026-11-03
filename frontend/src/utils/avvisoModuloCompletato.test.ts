// 3.21 — l'avviso WhatsApp di modulo completato aveva il mittente scritto a mano
// («BlueCode Advisor Studio»), lo stesso per ogni studio. Ora è la ragione sociale letta dal
// server; senza, l'avviso non parte e l'operatore riceve il messaggio che dice cosa completare.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import sorgenteProjectDetail from '../pages/ProjectDetail.tsx?raw';

const { fetchTenantInfoApi, inviaComunicazioneApi } = vi.hoisted(() => ({
  fetchTenantInfoApi: vi.fn(),
  inviaComunicazioneApi: vi.fn(),
}));
vi.mock('../api/client', () => ({ fetchTenantInfoApi, inviaComunicazioneApi }));

import { inviaAvvisoModuloCompletato, AVVISO_SENZA_RAGIONE_SOCIALE } from './avvisoModuloCompletato';

const dati = { progettoId: 'p1', nomeProgetto: 'Riorganizzazione', nomeModulo: 'Due diligence', destinatario: 'Cliente Srl' };

describe('inviaAvvisoModuloCompletato — mittente dallo studio, mai inventato', () => {
  beforeEach(() => {
    fetchTenantInfoApi.mockReset();
    inviaComunicazioneApi.mockReset().mockResolvedValue({ id: 'c1' });
  });

  it('il mittente è la ragione sociale letta dal server', async () => {
    fetchTenantInfoApi.mockResolvedValue({ id: 't1', ragioneSociale: 'Studio Rossi & Associati' });
    const errore = vi.fn();

    expect(await inviaAvvisoModuloCompletato(dati, errore)).toBe(true);

    expect(inviaComunicazioneApi).toHaveBeenCalledWith('p1', expect.objectContaining({
      canale: 'whatsapp',
      mittente: 'Studio Rossi & Associati',
      destinatario: 'Cliente Srl',
    }));
    expect(errore).not.toHaveBeenCalled();
  });

  it.each([
    ['anagrafica non letta', null],
    ['ragione sociale vuota', { id: 't1', ragioneSociale: '   ' }],
  ])('%s: l\'avviso non parte e l\'operatore lo sa', async (_caso, risposta) => {
    fetchTenantInfoApi.mockResolvedValue(risposta);
    const errore = vi.fn();

    expect(await inviaAvvisoModuloCompletato(dati, errore)).toBe(false);

    expect(inviaComunicazioneApi).not.toHaveBeenCalled();
    expect(errore).toHaveBeenCalledWith(AVVISO_SENZA_RAGIONE_SOCIALE);
  });

  it('un invio fallito si dichiara con il nome del modulo', async () => {
    fetchTenantInfoApi.mockResolvedValue({ id: 't1', ragioneSociale: 'Studio Rossi' });
    inviaComunicazioneApi.mockRejectedValue(new Error('canale non configurato'));
    const errore = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await inviaAvvisoModuloCompletato(dati, errore)).toBe(false);
    expect(errore).toHaveBeenCalledWith('Avviso al cliente sul modulo "Due diligence" non inviato: canale non configurato.');
  });

  it('ProjectDetail non ha più un mittente scritto a mano e usa l\'helper', () => {
    expect(sorgenteProjectDetail).not.toContain('BlueCode Advisor Studio');
    expect(sorgenteProjectDetail).toContain('inviaAvvisoModuloCompletato(');
  });
});
