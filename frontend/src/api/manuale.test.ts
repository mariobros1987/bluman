// L'aiuto in-app — il confine fra «il server ha risposto», «ha risposto che non si può leggere» e
// «non ha risposto affatto».
//
// Le tre cose finiscono tutte in un `letto: false`, ma il messaggio che portano è diverso, e in
// pagina è la differenza fra «questa scheda è riservata» e «il manuale non c'è in questa
// installazione». Confonderle è l'errore che questa pagina esiste per non fare (§7).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./http', () => ({
  API_BASE: '/api',
  apiFetch: vi.fn(),
  getAuthHeaders: () => ({}),
  // Nel test l'errore porta il messaggio del server così com'è: è quello che la pagina mostra.
  erroreDellaRisposta: vi.fn(async (res: any, ripiego: string) =>
    Object.assign(new Error(res?.errore ?? ripiego), { status: res?.status ?? 500 })),
}));

import { apiFetch } from './http';
import { fetchIndiceManualeApi, fetchSchedaManualeApi } from './manuale';

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

const risposta = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, errore: (body as any)?.errore, json: async () => body }) as any;

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe('fetchIndiceManualeApi', () => {
  it('porta a casa indice e testi', async () => {
    mockApiFetch.mockResolvedValue(risposta({
      letto: true,
      schede: [{ slug: '01-progetti-motore-stato', numero: '01', titolo: '01 · Progetti', riservata: false, testo: 'Un progetto è una pratica.' }],
    }));

    const esito = await fetchIndiceManualeApi();
    expect(esito.letto).toBe(true);
    expect(esito.schede).toHaveLength(1);
    expect(esito.schede[0]?.testo).toContain('pratica');
  });

  it('un 401 non è un indice vuoto', async () => {
    // Se diventasse `{ letto: true, schede: [] }` la pagina direbbe «non c'è aiuto» invece di
    // «non ho potuto leggere»: la stessa schermata con il significato opposto.
    mockApiFetch.mockResolvedValue(risposta({ errore: 'Non autorizzato' }, false, 401));

    const esito = await fetchIndiceManualeApi();
    expect(esito.letto).toBe(false);
    expect(esito.schede).toEqual([]);
  });

  it('una risposta senza `letto` non è una risposta', async () => {
    // Il caso che conta: un corpo con `schede` ma senza `letto` non deve passare per un indice
    // valido — sarebbe un «ecco le schede» che nessuno ha verificato.
    mockApiFetch.mockResolvedValue(risposta({ schede: [{ slug: 'x' }] }));

    const esito = await fetchIndiceManualeApi();
    expect(esito.letto).toBe(false);
    expect(esito.schede).toEqual([]);
  });

  it('se la richiesta lancia, è «non letto» e non un errore che risale', async () => {
    mockApiFetch.mockRejectedValue(new Error('rete giù'));
    await expect(fetchIndiceManualeApi()).resolves.toEqual({ letto: false, schede: [] });
  });
});

describe('fetchSchedaManualeApi', () => {
  it('porta a casa l’HTML sanitizzato dal server', async () => {
    mockApiFetch.mockResolvedValue(risposta({
      letto: true, slug: '05-fatture-sdi', numero: '05', titolo: '05 · Fatture / Note di Credito & SDI',
      riservata: false, html: '<h1>05 · Fatture</h1>',
    }));

    const esito = await fetchSchedaManualeApi('05-fatture-sdi');
    expect(esito.letto).toBe(true);
    expect(esito.html).toContain('<h1>');
    expect(esito.riservata).toBe(false);
  });

  it('il 403 di una scheda riservata conserva la parola del server', async () => {
    // È l'unico modo per cui la pagina può dire «è riservata all'amministratore della piattaforma»
    // invece di un generico «non disponibile»: la distinzione la fa il server, non il browser.
    mockApiFetch.mockResolvedValue(risposta(
      { errore: 'La scheda «19-infra-deploy» è riservata all\'amministratore della piattaforma.' },
      false, 403,
    ));

    const esito = await fetchSchedaManualeApi('19-infra-deploy');
    expect(esito.letto).toBe(false);
    expect(esito.html).toBe('');
    expect(esito.errore).toMatch(/riservata all'amministratore della piattaforma/);
  });

  it('il 404 di una scheda inesistente conserva il proprio messaggio', async () => {
    mockApiFetch.mockResolvedValue(risposta({ errore: 'Scheda «99-inventata» non trovata nel manuale.' }, false, 404));

    const esito = await fetchSchedaManualeApi('99-inventata');
    expect(esito.letto).toBe(false);
    expect(esito.errore).toMatch(/non trovata nel manuale/);
  });

  it('un 200 con `letto: true` ma senza HTML non passa per una scheda', async () => {
    // Togliere questa condizione significherebbe consegnare `undefined` a `dangerouslySetInnerHTML`.
    mockApiFetch.mockResolvedValue(risposta({ letto: true, titolo: '05 · Fatture' }));

    const esito = await fetchSchedaManualeApi('05-fatture-sdi');
    expect(esito.letto).toBe(false);
    expect(esito.html).toBe('');
  });

  it('lo slug viaggia codificato nel percorso', async () => {
    mockApiFetch.mockResolvedValue(risposta({ letto: true, titolo: 'x', slug: 'x', numero: '00', riservata: false, html: '<p>x</p>' }));
    await fetchSchedaManualeApi('05-fatture-sdi');
    expect(mockApiFetch.mock.calls[0]?.[0]).toBe('/api/manuale/05-fatture-sdi');
  });
});
