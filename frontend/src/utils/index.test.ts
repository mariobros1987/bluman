// Il logo dello studio è un percorso `/uploads/...` quando il backend usa il ripiego locale
// (`storageService.urlUploadFirmato` produce `/uploads/<nome>?firma=…`, relativo apposta) — e
// lo stesso file di backend dice che a risolverlo è proprio `getFormattedLogoUrl`.
//
// Chi risolve quei percorsi deve seguire la base delle API, non un indirizzo scritto a mano:
// sul VPS la base è `/api` (il prefisso che nginx toglie prima di consegnare la richiesta
// all'API), quindi un indirizzo fisso manda la richiesta a **un altro backend, con un altro
// database e un altro volume** — il logo sparisce. Su Vercel la base è l'indirizzo assoluto di
// Railway, che per caso coincide con quello scritto a mano: è il motivo per cui il difetto del
// 01/10/2026 non si era mai visto.
//
// `API_BASE` si calcola al caricamento del modulo, quindi ogni caso qui reimporta `./index`
// dopo aver stabilito le variabili d'ambiente: senza `resetModules` si osserverebbe sempre la
// prima valutazione e il test passerebbe senza provare niente.
import { describe, it, expect, vi, afterEach } from 'vitest';

const LOGO = '/uploads/abc_123_logo.png?firma=x&scad=y';

async function risolutoreCon(vars: Record<string, string>) {
  vi.resetModules();
  for (const [chiave, valore] of Object.entries(vars)) vi.stubEnv(chiave, valore);
  const { getFormattedLogoUrl } = await import('./index');
  return getFormattedLogoUrl;
}

describe('getFormattedLogoUrl — i percorsi /uploads seguono la base delle API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('sul VPS segue il prefisso /api, che è quello che nginx sa instradare', async () => {
    const risolutore = await risolutoreCon({ VITE_API_BASE: '/api' });
    // `/api/uploads/…` e non `/uploads/…`: sul VPS anche il percorso nudo arriverebbe all'API
    // (è una delle tre eccezioni in radice), ma su Vercel no — là `vercel.json` riscrive su
    // `/index.html` tutto ciò che non è sotto `/api`. Un percorso che funziona su un ambiente
    // solo è il difetto del 01/10/2026 con un'altra faccia, quindi si verifica la forma che
    // vale in entrambi.
    expect(risolutore(LOGO)).toBe(`/api${LOGO}`);
    expect(risolutore(LOGO)).not.toMatch(/^https?:\/\//);
  });

  it('con una base dichiarata (Vercel) la antepone', async () => {
    const risolutore = await risolutoreCon({
      VITE_API_BASE: 'https://api.esempio.test',
    });
    expect(risolutore(LOGO)).toBe(`https://api.esempio.test${LOGO}`);
  });

  it('non tocca ciò che è già assoluto o vuoto, e non scambia lo statico per un upload', async () => {
    const risolutore = await risolutoreCon({ VITE_API_BASE: '/api' });
    expect(risolutore('https://cdn.esempio.test/logo.png')).toBe('https://cdn.esempio.test/logo.png');
    expect(risolutore('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    // `/logo.png` è il marchio statico servito dal frontend: non è un file caricato, e
    // riscriverlo verso la base delle API lo renderebbe irraggiungibile.
    expect(risolutore('/logo.png')).toBe('/logo.png');
    expect(risolutore('')).toBe('');
    expect(risolutore(null)).toBe('');
    expect(risolutore(undefined)).toBe('');
  });
});
