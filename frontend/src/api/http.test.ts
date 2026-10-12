// Test del layer HTTP del frontend — le difese che vivono qui sono tre, e tutte nate
// da guasti reali documentati in http.ts:
//   1. il rifiuto delle risposte HTML (una pagina 200 passava per salvataggio riuscito);
//   2. il rinnovo scorrevole del token via X-Bluman-Token (sessione che muore a metà lavoro);
//   3. l'evento `bluman_unauthorized` sul 401 (per il logout automatico di App.tsx).
// Più la coerenza corpo/intestazione: il Content-Type JSON senza body veniva rifiutato
// da Fastify con «Body cannot be empty».
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch as apiFetchReale, fetchWithTimeout as fetchReale, conCorpoCoerente, scegliBaseApi } from '../api/http';

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

// Il ripiego della base delle API: la difesa che impedisce a una build sbagliata di **scrivere
// nel database di prova** credendo di scrivere in produzione. Il 12/10/2026 la produzione è
// passata al VPS e Railway è rimasto l'ambiente di prove, ma il ripiego continuava a puntare là:
// una build del frontend senza `VITE_API_BASE=/api` avrebbe parlato col database di prova senza
// un errore — salvataggio riuscito, interfaccia che conferma, dato assente in produzione. La
// regola verificata qui è: **Railway solo da `*.vercel.app`, ovunque altro il prefisso `/api`.
describe('scegliBaseApi — solo l\'ambiente di prova può ricadere su Railway', () => {
  const VPS = 'https://blusmart.eu';
  const RAILWAY = 'https://bluman-api-production.up.railway.app';

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('la base dichiarata vince su qualunque ripiego', () => {
    expect(scegliBaseApi(RAILWAY, VPS)).toBe(RAILWAY);
    expect(scegliBaseApi('/api', VPS)).toBe('/api');
    expect(scegliBaseApi('https://api.esempio.test/', VPS)).toBe('https://api.esempio.test');
  });

  it('sul dominio del VPS, senza dichiarazione, usa il prefisso /api di quella origine', () => {
    // È il caso che conta: la dimenticanza di `VITE_API_BASE=/api` non manda più il frontend di
    // produzione a parlare con il database di prova. Qui il ripiego **indovina**, perché sul VPS
    // l'API sta davvero sotto `/api`.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scegliBaseApi(undefined, VPS)).toBe('/api');
    expect(scegliBaseApi('', VPS)).toBe('/api');
    // Anche dichiarando la stessa origine: un dominio nudo non dice dove sta l'API, `/api` sì.
    expect(scegliBaseApi(VPS, VPS)).toBe('/api');
    expect(scegliBaseApi(`${VPS}/`, VPS)).toBe('/api');
  });

  it('sull\'IP del VPS, che è la via di riserva, si comporta allo stesso modo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scegliBaseApi(undefined, 'http://136.144.234.118')).toBe('/api');
  });

  it('dall\'ambiente di prova (Vercel) il ripiego resta Railway, dove le API esistono', () => {
    // Su Vercel `/api` non è un backend: `vercel.json` riscrive su `/index.html` tutto ciò che
    // non è `send-email`, quindi il ripiego relativo spezzerebbe la prova al primo deploy senza
    // variabili d'ambiente.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scegliBaseApi(undefined, 'https://bluman.vercel.app')).toBe(RAILWAY);
    expect(scegliBaseApi(undefined, 'https://una-prova.vercel.app')).toBe(RAILWAY);
  });

  it('l\'ambiente di prova si riconosce dal suffisso, non da un nome dentro una parola', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // `vercel.app` come parte di un nome più lungo non è Vercel: là il ripiego deve restare
    // relativo, perché quell'origine non è la piattaforma di prova.
    expect(scegliBaseApi(undefined, 'https://vercel.app.esempio.test')).toBe('/api');
    expect(scegliBaseApi(undefined, 'https://notvercel.app')).toBe('/api');
  });

  it('in sviluppo locale resta il backend sulla porta 3000', () => {
    expect(scegliBaseApi(undefined, 'http://localhost:5173')).toBe('http://localhost:3000');
    expect(scegliBaseApi(undefined, 'http://127.0.0.1:5173')).toBe('http://localhost:3000');
  });

  it('senza finestra (origine vuota) non sceglie Railway: quella non è la piattaforma di prova', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scegliBaseApi(undefined, '')).toBe('/api');
  });

  it('dice in console quale base ha scelto e perché', () => {
    // Regola 3: un ripiego silenzioso è un guasto che si scopre tardi. Chi apre la console deve
    // leggere la causa e la scelta, non dedurle.
    const avviso = vi.spyOn(console, 'error').mockImplementation(() => {});
    scegliBaseApi(undefined, VPS);
    expect(avviso).toHaveBeenCalledOnce();
    expect(String(avviso.mock.calls[0][0])).toContain('non è dichiarata');
    expect(String(avviso.mock.calls[0][0])).toContain('/api');

    avviso.mockClear();
    scegliBaseApi(VPS, VPS);
    expect(String(avviso.mock.calls[0][0])).toContain('dominio di questa pagina');
  });
});
