import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  urlPubblicaBackend,
  slugValido,
  urlWebhookWhatsapp,
  urlWebhookTelegram,
} from './util/urlPubblica.js';

/**
 * L'indirizzo pubblico del backend è il valore che si copia nella dashboard di Meta e che
 * Telegram usa per consegnare gli aggiornamenti. Un errore qui **non produce un errore**: produce
 * un webhook che punta altrove, cioè clienti che scrivono e nessuno che riceve. Per questo ha un
 * presidio, pur essendo un file di tre funzioni.
 *
 * Il caso concreto da impedire è quello che ha motivato il file: lo stesso indirizzo era scritto
 * in tre punti con convenzioni diverse, e il primo che avesse dimenticato `RAILWAY_PUBLIC_DOMAIN`
 * avrebbe mostrato allo studio un indirizzo che non esiste più.
 *
 * E il caso che ha motivato la **seconda** sorgente (`APP_BASE_URL`, 01/10/2026): `Railway` non è
 * l'unico ambiente. Sul VPS quella variabile non esiste, quindi il dominio di produzione restava
 * l'unica risposta e i webhook si componevano su Railway — un altro backend, un altro database.
 * Nessun errore visibile, solo clienti che scrivono e nessuno che riceve.
 */

// Entrambe vanno svuotate. `APP_BASE_URL` è impostata anche nel `.env` di sviluppo
// (`http://localhost:5173`): senza toglierla, il ripiego sul dominio di produzione non sarebbe
// mai raggiunto e i test osserverebbero l'ambiente di questa macchina invece di quello che
// credono di provare.
const AMBIENTE = ['RAILWAY_PUBLIC_DOMAIN', 'APP_BASE_URL'] as const;
const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE) ambienteOriginale.set(chiave, process.env[chiave]);

beforeEach(() => {
  for (const chiave of AMBIENTE) delete process.env[chiave];
});

afterEach(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});

describe('urlPubblicaBackend', () => {
  it('senza RAILWAY_PUBLIC_DOMAIN ripiega sul dominio di produzione, con https', () => {
    expect(urlPubblicaBackend()).toBe('https://bluman-api-production.up.railway.app');
  });

  it('usa il dominio fornito da Railway, normalizzando schema e barra finale', () => {
    // Railway lo espone nudo, ma chi lo legge da un altro contesto può avercelo messo con lo
    // schema o con la barra: entrambi produrrebbero `https://https://…` o un doppio slash nel
    // path, cioè un 404 al momento della verifica in Meta, non un errore di configurazione.
    for (const valore of [
      'bluman-api-staging.up.railway.app',
      'https://bluman-api-staging.up.railway.app',
      '  https://bluman-api-staging.up.railway.app/  ',
    ]) {
      process.env.RAILWAY_PUBLIC_DOMAIN = valore;
      expect(urlPubblicaBackend()).toBe('https://bluman-api-staging.up.railway.app');
    }
  });

  it('una variabile vuota o di soli spazi vale come assente', () => {
    for (const valore of ['', '   ', 'https://']) {
      process.env.RAILWAY_PUBLIC_DOMAIN = valore;
      expect(urlPubblicaBackend()).toBe('https://bluman-api-production.up.railway.app');
    }
  });

  it('fuori da Railway decide APP_BASE_URL: il callback non può puntare a Railway', () => {
    // Il caso che ha motivato questa sorgente. Sul VPS `RAILWAY_PUBLIC_DOMAIN` non esiste —
    // l'abbiamo verificato: la variabile è vuota — e `APP_BASE_URL` è l'unica cosa che sa dove
    // vive il backend. Prima della correzione il webhook si componeva su
    // `bluman-api-production.up.railway.app`, cioè **un altro backend con un altro database**:
    // uno studio che avesse configurato Meta da lì avrebbe mandato i messaggi dei suoi clienti
    // all'ambiente sbagliato.
    process.env.APP_BASE_URL = 'http://136.144.234.118';
    const url = urlWebhookTelegram();
    expect(url).toBe('http://136.144.234.118/webhooks/communications/telegram');
    expect(url).not.toContain('railway.app');
  });

  it('conserva lo schema di APP_BASE_URL: prima del TLS è legittimamente http', () => {
    process.env.APP_BASE_URL = 'http://136.144.234.118';
    expect(urlPubblicaBackend()).toBe('http://136.144.234.118');
  });

  it('toglie la barra finale e aggiunge https quando lo schema manca', () => {
    process.env.APP_BASE_URL = 'studio.esempio/';
    expect(urlPubblicaBackend()).toBe('https://studio.esempio');
  });

  it('dove Railway espone il proprio dominio, quello vince su APP_BASE_URL', () => {
    // Su Railway esiste **anche** `APP_BASE_URL`, e lì vale l'indirizzo del frontend: se
    // vincesse lei, i webhook si comporrebbero sul dominio sbagliato proprio nell'ambiente dove
    // oggi funzionano. L'ordine è la regola, e questo test lo fissa.
    process.env.RAILWAY_PUBLIC_DOMAIN = 'bluman-api.up.railway.app';
    process.env.APP_BASE_URL = 'https://bluman.vercel.app';
    expect(urlPubblicaBackend()).toBe('https://bluman-api.up.railway.app');
  });

  it('un APP_BASE_URL senza host vale come assente, non produce `https://https:`', () => {
    for (const valore of ['', '   ', 'https://', 'http://']) {
      process.env.APP_BASE_URL = valore;
      expect(urlPubblicaBackend()).toBe('https://bluman-api-production.up.railway.app');
    }
  });
});

describe('slugValido — il discriminante del path di callback', () => {
  it('accetta la forma che produce il database (32 esadecimali)', () => {
    expect(slugValido('a'.repeat(32))).toBe('a'.repeat(32));
    expect(slugValido('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
  });

  it('accetta il margine dichiarato: da 16 a 64 caratteri, anche con trattino e underscore', () => {
    expect(slugValido('a'.repeat(16))).toBe('a'.repeat(16));
    expect(slugValido('a'.repeat(64))).toBe('a'.repeat(64));
    expect(slugValido('AbC_123-xyz_789-ABC')).toBe('AbC_123-xyz_789-ABC');
  });

  it('rifiuta ciò che cambierebbe il path invece di nominarlo', () => {
    // Il punto del controllo: uno slug con `/`, `..` o `%` non identifica uno studio, riscrive
    // l'URL. `..%2F` è il tentativo ovvio; `a/../b` lo è altrettanto.
    for (const cattivo of [
      'a/../b'.padEnd(20, 'a'),
      '../'.repeat(6),
      'aaaaaaaaaaaaaa%2Faa',
      'aaaaaaaaaaaaaa/aaa',
      'aaaaaaaaaaaaaa?x=1',
      'aaaaaaaaaaaaaa#frag',
      'aaaaaaaaaaaaaa aaa',
      'aaaaaaaaaaaaaa\naaa',
    ]) {
      expect(slugValido(cattivo), `avrebbe dovuto rifiutare: ${JSON.stringify(cattivo)}`).toBeNull();
    }
  });

  it('rifiuta le lunghezze fuori intervallo', () => {
    expect(slugValido('a'.repeat(15))).toBeNull();
    expect(slugValido('a'.repeat(65))).toBeNull();
    expect(slugValido('')).toBeNull();
  });

  it('rifiuta ciò che non è una stringa, senza lanciare', () => {
    for (const valore of [null, undefined, 42, {}, [], true, Symbol('x')]) {
      expect(slugValido(valore)).toBeNull();
    }
  });

  it('toglie gli spazi ai bordi di uno slug valido', () => {
    expect(slugValido(`  ${'a'.repeat(32)}  `)).toBe('a'.repeat(32));
  });
});

describe('composizione degli indirizzi di callback', () => {
  it('la Callback URL di WhatsApp è dominio + rotta + slug', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'bluman-api.up.railway.app';
    const slug = 'f'.repeat(32);
    expect(urlWebhookWhatsapp(slug)).toBe(
      `https://bluman-api.up.railway.app/webhooks/communications/whatsapp/${slug}`,
    );
  });

  it('senza slug non si compone nessun indirizzo: `null`, non un path monco', () => {
    // Uno studio che non ha ancora uno slug non deve ricevere in interfaccia un indirizzo
    // plausibile ma inesistente da incollare in Meta (regola 7): l'assenza si vede.
    for (const valore of [null, undefined, '', 'troppo-corto']) {
      expect(urlWebhookWhatsapp(valore)).toBeNull();
    }
  });

  it('il webhook Telegram non ha slug: è uno per bot, e il bot è dello studio', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'bluman-api.up.railway.app';
    expect(urlWebhookTelegram()).toBe(
      'https://bluman-api.up.railway.app/webhooks/communications/telegram',
    );
  });

  it('un dominio manomesso non può spostare lo slug fuori dal path previsto', () => {
    // Lo slug viene interpolato in un URL che finisce in un campo dell'interfaccia: se un
    // chiamante passasse un valore non validato, il path cambierebbe. La validazione è prima
    // della composizione, e questo test la fissa.
    process.env.RAILWAY_PUBLIC_DOMAIN = 'bluman-api.up.railway.app';
    expect(urlWebhookWhatsapp('../../../admin/tenants')).toBeNull();
    expect(urlWebhookWhatsapp('abc?x=1&y=2')).toBeNull();
  });
});
