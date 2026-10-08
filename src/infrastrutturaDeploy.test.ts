import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Presidio dell'infrastruttura di deployment (`docker-compose.prod.yml`, `nginx/default.conf`,
 * `nginx/bluman_app.inc`, `nginx/bluman_proxy.inc`, `scripts/distribuisci.sh`).
 *
 * Nasce da due difetti che nessun test copriva, perché i presidi esistenti guardano solo
 * `.ts`/`.tsx` (vedi `CARTELLE_DA_ISPEZIONARE` in `src/credenziali.test.ts`):
 *
 * 1. L'elenco dei prefissi proxati a Fastify era stato scritto a mano dai *nomi dei file*
 *    di `src/routes/`, non dai percorsi reali delle rotte. Le rotte fuori elenco non
 *    davano 404: cadevano nel `location /` della SPA e tornavano `200` con `index.html`.
 *    Il browser riceveva HTML dove aspettava JSON — «Unexpected token <» invece di un
 *    errore leggibile, e nessun log lato API perché la richiesta non ci arrivava mai.
 *
 * 2. I segreti in `docker-compose.prod.yml` avevano un ripiego `${VAR:-valore}`, cioè lo
 *    stack partiva con la password del database e il `JWT_SECRET` scritti nel repository
 *    (regola 6). Con un `JWT_SECRET` noto si firma un token per qualsiasi tenant e
 *    qualsiasi ruolo, e l'isolamento RLS cade con lui perché `app_tenant_corrente()` si
 *    fida del tenant che sta nel token.
 *
 * Il 02/10/2026 l'elenco dei prefissi — che il punto 1 aveva solo reso *corretto* — si è
 * rivelato anche la cosa sbagliata da costruire. Sette percorsi della SPA (`/portal`,
 * `/invoices`, `/fornitori`, `/timesheet`, `/liquidazione-iva`, `/reports`, `/admin/tenants`)
 * si chiamano come rotte dell'API, e la regex se li prendeva: chi ricaricava una di quelle
 * pagine riceveva il 404 dell'API, o un 401, al posto dell'applicazione.
 *
 * Non lo si è visto per giorni perché **ogni test qui dentro guardava nella stessa direzione**:
 * dalle rotte del backend ai prefissi di nginx. Nessuno confrontava le rotte della SPA con
 * quello che nginx serve in radice — ed è esattamente da lì che è passato il guasto. Quel
 * confronto ora c'è, e da allora le API vivono sotto `/api`, così la collisione non è più
 * possibile per costruzione invece che per diligenza.
 */

const RADICE = path.resolve(import.meta.dirname, '..');

const leggi = (...pezzi: string[]) => readFileSync(path.join(RADICE, ...pezzi), 'utf8');

/**
 * I percorsi serviti in radice dall'API, cioè NON sotto `/api`. Ognuno è un'eccezione con un
 * motivo che non dipende da questo repository: `/webhooks/` lo consegna il backend a Meta e
 * Telegram, `/uploads/` è salvato a database e dentro email già spedite, `/health` lo interroga
 * il monitor del VPS. Sono tre perché devono restare tre: ognuna è un percorso che qualcun
 * altro ha già in mano, e spostarla è una migrazione, non una modifica di configurazione.
 */
const PERCORSI_IN_RADICE = ['/api', '/webhooks', '/uploads', '/health'] as const;

/** I percorsi delle pagine, letti dal router: sono l'altra metà del confronto. */
function rotteDellaSpa(): string[] {
  const app = leggi('frontend', 'src', 'App.tsx');
  return [...app.matchAll(/path="([^"]*)"/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== '*'); // il catch-all non è un percorso, è il ripiego
}

describe('🚦 nginx — API sotto /api, pagine in radice', () => {
  const sorgente = () => leggi('nginx', 'bluman_app.inc');

  it('proxa le API sotto /api togliendo il prefisso', () => {
    // `proxy_pass` CON uri in un location di prefisso sostituisce il prefisso: `/api/invoices`
    // arriva a Fastify come `/invoices`. Un `proxy_pass` senza uri manderebbe `/api/invoices`
    // e l'API risponderebbe 404.
    expect(sorgente()).toMatch(/location\s+\^~\s+\/api\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/api:3000\/;/);
  });

  it('non tiene più nessun elenco di prefissi API', () => {
    // È il punto dell'intera modifica: con il prefisso una rotta nuova nasce già coperta, e non
    // c'è nessun elenco da aggiornare. Se questo test diventa rosso, qualcuno sta reintroducendo
    // la regex — e con lei il modo di sbagliare che ha rotto sette pagine.
    expect(sorgente()).not.toMatch(/location\s+~\s+\^\/\(/);
  });

  it('lascia in radice solo le tre eccezioni, e passandogli il percorso invariato', () => {
    for (const eccezione of ['/webhooks/', '/uploads/']) {
      expect(sorgente(), `${eccezione} deve restare proxata in radice`).toMatch(
        new RegExp(`location\\s+\\^~\\s+${eccezione.replace(/\//g, '\\/')}\\s*\\{[\\s\\S]*?proxy_pass\\s+http:\\/\\/api:3000;`),
      );
    }
    expect(sorgente()).toMatch(/location\s+=\s+\/health\s*\{[\s\S]*?proxy_pass\s+http:\/\/api:3000\/health;/);
  });

  it('scrive accanto a ogni eccezione il motivo per cui resta', () => {
    // Le eccezioni non sono dimenticanze, e fra sei mesi nessuno se lo ricorderà: il commento
    // deve nominare le cose vere — chi consegna quell'URL, dove è salvato, chi lo interroga.
    const inc = sorgente();
    expect(inc).toContain('urlPubblicaBackend');
    expect(inc).toContain('BLUMAN_MONITOR_HEALTH_URL');
    expect(inc).toContain('catalogo.ts');
  });

  it('nessuna rotta della SPA collide con un percorso servito in radice', () => {
    // Il test che mancava. Il 02/10/2026 `path="/portal"` in App.tsx e `portal` fra i prefissi
    // di nginx erano la stessa URL, e nessuno confrontava le due liste.
    const rotte = rotteDellaSpa();
    // Soglia bassa di proposito: serve solo a distinguere «letto zero percorsi» (regex rotta,
    // file spostato) da «letto i percorsi». Oggi sono 23, quindi un numero alto qui
    // diventerebbe un falso allarme alla prima pagina che si toglie.
    expect(rotte.length, 'App.tsx deve avere delle rotte: il test non sta leggendo niente').toBeGreaterThan(10);

    const collisioni = rotte
      .map((rotta) => ({
        rotta,
        conflitto: PERCORSI_IN_RADICE.find((p) => rotta === p || rotta.startsWith(`${p}/`)),
      }))
      .filter((c) => c.conflitto);

    expect(
      collisioni.map((c) => `${c.rotta} ↔ ${c.conflitto}`),
      'una pagina che si chiama come un percorso dell API è irraggiungibile quando la si ricarica',
    ).toEqual([]);
  });

  it('manda le direttive di proxy da un file solo, incluso da tutti i location', () => {
    // Gli header sono la prova che l'audit registra (regola 7). Quattro copie sono quattro
    // occasioni di dimenticarne uno, in un punto che nessuno guarda finché non è tardi.
    const inc = sorgente();
    const inclusioni = inc.match(/include \/etc\/nginx\/conf\.d\/bluman_proxy\.inc;/g) ?? [];
    expect(inclusioni.length, 'i quattro location che parlano con l API devono includere il file condiviso').toBe(4);

    const proxy = leggi('nginx', 'bluman_proxy.inc');
    expect(proxy).not.toMatch(/^\s*location\s/m); // viene incluso DENTRO un blocco
    expect(proxy).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(proxy).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(proxy).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    // Server-Sent Events (/stream): con il buffering le notifiche non arrivano.
    expect(proxy).toContain('proxy_buffering off;');
  });

  it('tiene l instradamento in un solo file, incluso da entrambi i server block', () => {
    const conf = leggi('nginx', 'default.conf');
    expect(conf).not.toMatch(/location\s+\^~\s+\/api\//);
    expect(conf).toContain('include /etc/nginx/conf.d/bluman_app.inc;');
  });

  it('monta in nginx l intera cartella dei file inclusi', () => {
    // Un `include` che punta a un file non montato fa fallire l'avvio di nginx. Il sintomo è il
    // VPS intero giù con un errore che parla di un percorso nel container, non del compose.
    const compose = leggi('docker-compose.prod.yml');
    expect(compose).toContain('./nginx:/etc/nginx/conf.d:ro');
  });

  it('non monta i file di nginx uno per uno, o il deploy mentirebbe', () => {
    // Il presidio che mancava, e nasce da un guasto vero (08/10/2026). Un bind mount di un FILE
    // SINGOLO lega l'**inode**, non il percorso; `git` non riscrive sul posto ma rinomina,
    // quindi cambia inode. Il container continuava a servire il file vecchio — in quel caso
    // `bluman_app.inc` del 02/10 contro quello dell'08/10 — mentre `nginx -t` e
    // `nginx -s reload` riuscivano, perché rileggevano il file vecchio. Deploy verde,
    // configurazione di giorni prima, nessun errore da nessuna parte.
    //
    // Montata la CARTELLA il percorso si risolve a ogni accesso, e il reload diventa corretto
    // per costruzione. Questo test esiste per impedire che qualcuno «semplifichi» tornando ai
    // tre mount singoli: il guasto che ne segue non si vede, si vede solo il deploy dire ✔.
    const compose = leggi('docker-compose.prod.yml');
    const montaggi = [...compose.matchAll(/^\s*-\s*\.\/([^\s:]+):/gm)].map((m) => m[1]!);
    const fileSingoli = montaggi.filter(
      (sorgente) => sorgente.endsWith('.conf') || sorgente.endsWith('.inc'),
    );
    expect(
      fileSingoli,
      `montaggi di file singoli in docker-compose.prod.yml: ${fileSingoli.join(', ')} — ` +
        'usare la cartella `./nginx:/etc/nginx/conf.d:ro`',
    ).toEqual([]);
  });

  it('proxa /uploads/ all API invece di servirlo come file statico', () => {
    const inc = sorgente();
    const compose = leggi('docker-compose.prod.yml');

    // L'autorizzazione dei documenti del vault la fa la rotta (Bearer oppure firma HMAC a
    // scadenza, vedi src/routes/catalogo.ts): serviti da nginx sarebbero scaricabili da
    // chiunque conoscesse il nome del file.
    expect(inc).toMatch(/location\s+\^~\s+\/uploads\/\s*\{/);
    expect(inc).not.toMatch(/location\s+\/uploads/);

    const montaggiNginx = compose.slice(compose.indexOf('nginx:'));
    expect(montaggiNginx).not.toMatch(/bluman_uploads:\s*\/usr\/share\/nginx/);
  });
});

describe('🚀 distribuisci.sh — la build del VPS e il frontend devono concordare', () => {
  const script = leggi('scripts', 'distribuisci.sh');

  it('compila il frontend dichiarando il prefisso delle API', () => {
    // Se lo script smettesse di passarlo, `getApiBase()` ricadrebbe sull'indirizzo di Railway
    // **in silenzio**: l'app del VPS funzionerebbe parlando con l'altro database, e nessuno se
    // ne accorgerebbe finché non si notasse un cliente che non c'è.
    expect(script).toContain('VITE_API_BASE=/api');
  });

  it('non compila più il frontend con la vecchia stessa-origine senza prefisso', () => {
    expect(script).not.toContain('VITE_API_SAME_ORIGIN');
  });

  it('sonda una pagina, non solo l API: è il controllo che mancava', () => {
    // Il deploy del 02/10/2026 era verde mentre sette pagine rispondevano 404 in JSON, perché
    // ogni sonda guardava l'API e nessuna guardava una pagina.
    expect(script).toMatch(/Pagine della SPA/);
    expect(script).toContain('text/html*');
    // L'elenco deve comprendere almeno una pagina che è stata davvero rotta: una lista che non
    // contiene nessuna delle sette passerebbe senza provare niente.
    expect(script).toMatch(/for PAGINA in [^\n]*\/portal/);
  });
});

describe('🔐 docker-compose.prod.yml — segreti', () => {
  const compose = readFileSync(path.join(RADICE, 'docker-compose.prod.yml'), 'utf8');

  it('non ha ripieghi cablati sui segreti: fallisce chiuso e rumoroso', () => {
    // `${VAR:-valore}` su un nome che contiene password/secret/token/key è una credenziale
    // versionata (regola 6). `${VAR:-}` — ripiego vuoto — è invece la disattivazione
    // esplicita di una funzione opzionale, e resta ammessa.
    const ripieghi = [...compose.matchAll(/\$\{([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|KEY|APIKEY)[A-Z0-9_]*):-([^}]*)\}/g)]
      .filter((m) => (m[2] || '').trim() !== '')
      .map((m) => `${m[1]}=${m[2]}`);
    expect(ripieghi, `segreti con valore di ripiego nel repository: ${ripieghi.join(', ')}`).toEqual([]);
  });

  it('pretende i segreti obbligatori con :? invece di inventarli', () => {
    for (const variabile of ['POSTGRES_PASSWORD', 'JWT_SECRET']) {
      expect(compose, `${variabile} deve usare \${${variabile}:?…}`).toMatch(
        new RegExp(`\\$\\{${variabile}:\\?`),
      );
    }
  });
});
