// Test del layer HTTP del frontend — le difese che vivono qui sono tre, e tutte nate
// da guasti reali documentati in http.ts:
//   1. il rifiuto delle risposte HTML (una pagina 200 passava per salvataggio riuscito);
//   2. il rinnovo scorrevole del token via X-Bluman-Token (sessione che muore a metà lavoro);
//   3. l'evento `bluman_unauthorized` sul 401 (per il logout automatico di App.tsx).
// Più la coerenza corpo/intestazione: il Content-Type JSON senza body veniva rifiutato
// da Fastify con «Body cannot be empty».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch as apiFetchReale, fetchWithTimeout as fetchReale, conCorpoCoerente } from '../api/http';

function rispostaFetch(over: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({}),
    ...over,
  } as unknown as Response;
}

describe('conCorpoCoerente — niente Content-Type JSON senza corpo', () => {
  it('aggiunge body {} alle POST senza corpo che dichiarano JSON', () => {
    const opzioni = conCorpoCoerente({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(opzioni.body).toBe('{}');
  });

  it('non tocca le POST che un corpo ce l\'hanno già', () => {
    const opzioni = conCorpoCoerente({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(opzioni.body).toBe('{"a":1}');
  });

  it('toglie il Content-Type dalle GET senza corpo', () => {
    const opzioni = conCorpoCoerente({ method: 'GET', headers: { 'Content-Type': 'application/json' } }) as RequestInit;
    const intestazioni = opzioni.headers as Record<string, string>;
    expect(intestazioni['Content-Type']).toBeUndefined();
    expect(intestazioni['content-type']).toBeUndefined();
  });

  it('non inventa corpi per i metodi senza body', () => {
    const opzioni = conCorpoCoerente({ method: 'DELETE', headers: {} }) as RequestInit;
    expect(opzioni.body).toBeUndefined();
  });
});

describe('apiFetch — una risposta HTML non è mai una riuscita', () => {
  it('rifiuta con errore parlante una risposta text/html', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      rispostaFetch({ headers: new Headers({ 'content-type': 'text/html' }) }),
    ));

    await expect(apiFetchReale('https://api.test/prova')).rejects.toThrow('non è arrivata al backend');

    vi.unstubAllGlobals();
  });

  it('lascia passare le risposte JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      rispostaFetch({ headers: new Headers({ 'content-type': 'application/json' }) }),
    ));

    const res = await apiFetchReale('https://api.test/prova');
    expect(res.status).toBe(200);

    vi.unstubAllGlobals();
  });
});

describe('fetchWithTimeout — rinnovo token e sessione scaduta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('memorizza il token rinnovato da X-Bluman-Token (header della risposta)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      rispostaFetch({ headers: new Headers({ 'X-Bluman-Token': 'token-rinnovato' }) }),
    ));

    await fetchReale('https://api.test/prova');
    expect(localStorage.getItem('bluman_jwt_token')).toBe('token-rinnovato');
  });

  it('non rinnova quando l\'header è assente', async () => {
    localStorage.setItem('bluman_jwt_token', 'token-vecchio');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rispostaFetch()));

    await fetchReale('https://api.test/prova');
    expect(localStorage.getItem('bluman_jwt_token')).toBe('token-vecchio');
  });

  it('emettono l\'evento bluman_unauthorized sul 401 (fuori dal login e dal portale)', async () => {
    // jsdom parte da about:blank: pathname '/' non inizia per /portal, ok.
    const ascoltatore = vi.fn();
    window.addEventListener('bluman_unauthorized', ascoltatore);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rispostaFetch({ status: 401 })));

    await fetchReale('https://api.test/progetti');
    expect(ascoltatore).toHaveBeenCalledTimes(1);

    window.removeEventListener('bluman_unauthorized', ascoltatore);
  });

  it('il 401 del login non scatena il logout globale', async () => {
    const ascoltatore = vi.fn();
    window.addEventListener('bluman_unauthorized', ascoltatore);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rispostaFetch({ status: 401 })));

    await fetchReale('https://api.test/auth/login');
    expect(ascoltatore).not.toHaveBeenCalled();

    window.removeEventListener('bluman_unauthorized', ascoltatore);
  });
});
