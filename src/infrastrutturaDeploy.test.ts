import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Presidio dell'infrastruttura di deployment (`docker-compose.prod.yml`, `nginx.conf`,
 * `nginx_bluman_app.inc`).
 *
 * Nasce da due difetti che nessun test copriva, perché i presidi esistenti guardano solo
 * `.ts`/`.tsx` (vedi `CARTELLE_DA_ISPEZIONARE` in src/credenziali.test.ts):
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
 */

const RADICE = path.resolve(import.meta.dirname, '..');
const METODI_HTTP = 'get|post|put|patch|delete|head|options|all';

/** Toglie commenti di riga e di blocco, così un esempio in un commento non conta come rotta. */
function soloCodice(sorgente: string): string {
  return sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Primo segmento di ogni percorso registrato su Fastify.
 *
 * La ricerca non pretende che il literal stia sulla stessa riga di `server.get`: con i
 * generici (`server.get<{ Querystring: … }>(`) il percorso finisce spesso due righe sotto,
 * ed è esattamente così che `comunicazioni` e `uploads` erano stati dimenticati.
 */
function prefissiRotteDaSorgente(sorgente: string): Set<string> {
  const codice = soloCodice(sorgente);
  const prefissi = new Set<string>();
  const registrazioni = new RegExp(`\\b(?:server|app|fastify)\\s*\\.\\s*(?:${METODI_HTTP})\\b`, 'g');

  for (const occorrenza of codice.matchAll(registrazioni)) {
    const finestra = codice.slice(occorrenza.index, occorrenza.index + 600);
    const literal = finestra.match(/(['"`])(\/[A-Za-z0-9_\-/:.]*)\1/);
    const percorso = literal?.[2];
    if (!percorso) continue;
    const segmento = percorso.split('/')[1] || '';
    // `/:id` come primo segmento sarebbe un percorso parametrico in radice: non esiste in
    // questo backend, e in nginx non sarebbe esprimibile come prefisso.
    if (!segmento || segmento.startsWith(':')) continue;
    prefissi.add(segmento);
  }
  return prefissi;
}

function prefissiRotteDelBackend(): Set<string> {
  const cartellaRotte = path.join(RADICE, 'src', 'routes');
  const files = readdirSync(cartellaRotte)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(cartellaRotte, f));
  // `src/server.ts` registra in proprio /health e le rotte di autenticazione.
  files.push(path.join(RADICE, 'src', 'server.ts'));

  const prefissi = new Set<string>();
  for (const file of files) {
    for (const p of prefissiRotteDaSorgente(readFileSync(file, 'utf8'))) prefissi.add(p);
  }
  return prefissi;
}

function prefissiDichiaratiInNginx(): Set<string> {
  const inc = readFileSync(path.join(RADICE, 'nginx_bluman_app.inc'), 'utf8');
  const location = inc.match(/location\s+~\s+\^\/\(([^)]+)\)/);
  expect(location, 'nginx_bluman_app.inc deve contenere il location regex dei prefissi API').toBeTruthy();
  return new Set((location?.[1] || '').split('|').map((s) => s.trim()).filter(Boolean));
}

describe('🚦 nginx — instradamento delle rotte API', () => {
  it('proxa a Fastify ogni prefisso realmente registrato dal backend', () => {
    const backend = prefissiRotteDelBackend();
    const nginx = prefissiDichiaratiInNginx();

    expect(backend.size).toBeGreaterThan(20);
    const mancanti = [...backend].filter((p) => !nginx.has(p)).sort();
    // Un prefisso mancante non dà 404: dà 200 con l'index.html della SPA.
    expect(mancanti, `prefissi registrati su Fastify ma non proxati da nginx: ${mancanti.join(', ')}`).toEqual([]);
  });

  it('non dichiara prefissi che non corrispondono a nessuna rotta', () => {
    const backend = prefissiRotteDelBackend();
    const nginx = prefissiDichiaratiInNginx();
    const orfani = [...nginx].filter((p) => !backend.has(p)).sort();
    expect(orfani, `prefissi in nginx senza rotta corrispondente: ${orfani.join(', ')}`).toEqual([]);
  });

  it('tiene i prefissi in un solo file, incluso da entrambi i server block', () => {
    const conf = readFileSync(path.join(RADICE, 'nginx.conf'), 'utf8');
    // Due copie dell'elenco divergono: la prima modifica ne aggiorna una sola.
    expect(conf).not.toMatch(/location\s+~\s+\^\/\(/);
    expect(conf).toContain('include /etc/nginx/conf.d/bluman_app.inc;');
  });

  it('proxa /uploads/ all API invece di servirlo come file statico', () => {
    const inc = readFileSync(path.join(RADICE, 'nginx_bluman_app.inc'), 'utf8');
    const compose = readFileSync(path.join(RADICE, 'docker-compose.prod.yml'), 'utf8');

    // L'autorizzazione dei documenti del vault la fa la rotta (Bearer oppure firma HMAC a
    // scadenza, vedi src/routes/catalogo.ts): serviti da nginx sarebbero scaricabili da
    // chiunque conoscesse il nome del file.
    expect(prefissiDichiaratiInNginx().has('uploads')).toBe(true);
    expect(inc).not.toMatch(/location\s+\/uploads/);

    const montaggiNginx = compose.slice(compose.indexOf('nginx:'));
    expect(montaggiNginx).not.toMatch(/bluman_uploads:\s*\/usr\/share\/nginx/);
  });

  it('conserva gli header che l audit usa come prova (IP e schema del chiamante)', () => {
    const inc = readFileSync(path.join(RADICE, 'nginx_bluman_app.inc'), 'utf8');
    // Regola 7: il sigillo di firma registra l'IP del firmatario. Senza questi header
    // l'audit registrerebbe l'indirizzo del container nginx come prova legale.
    expect(inc).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(inc).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    expect(inc).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    // Server-Sent Events (/stream): con il buffering le notifiche non arrivano.
    expect(inc).toContain('proxy_buffering off;');
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
