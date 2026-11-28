import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

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

  it('esegue entrambe le suite prima del push, senza ignorare errori del frontend', () => {
    const frontend = script.indexOf('(cd frontend && npm test)');
    const backend = script.indexOf('npx vitest run');
    const push = script.indexOf('git push origin main');
    expect(frontend).toBeGreaterThan(-1);
    expect(backend).toBeGreaterThan(frontend);
    expect(push).toBeGreaterThan(backend);
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).not.toMatch(/\(cd frontend && npm test\)\s*\|\|/);
  });

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

  it('sonda /aiuto, che è una pagina e ha anche un indirizzo profondo', () => {
    expect(script).toMatch(/for PAGINA in [^\n]*\/aiuto\b/);
    // `/aiuto/<scheda>` è il percorso che si ricarica o si incolla in chat: un fallback della SPA
    // che non regge i percorsi annidati lascerebbe funzionare l'indice e romperebbe ogni singola
    // scheda linkata — un guasto che si vede solo quando serve.
    expect(script).toMatch(/for PAGINA in [^\n]*\/aiuto\/[a-z0-9-]+/);
  });

  it("sonda che il manuale abbia la rotta E i file: un indice vuoto sarebbe la bugia da evitare", () => {
    // 401 e non 404: l'autenticazione precede la lettura del file, quindi una rotta *presente*
    // risponde 401 anche quando i `.md` non ci sono. Il 404 direbbe «rotta assente», che è un
    // guasto diverso e si aggiusta altrove.
    expect(script).toContain('/api/manuale');
    expect(script).toMatch(/CODICE_MAN.*401/s);
    // Il conteggio fatto dentro il container è l'unica sonda che vede un `docs/` fuori
    // dall'immagine: da fuori, un indice vuoto è indistinguibile da «non c'è aiuto da leggere».
    expect(script).toMatch(/\/app\/docs\/manuale/);
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

describe('🛡️ RLS — lo script permissivo del 15/08 non è più fra quelli applicabili (D1)', () => {
  // `20260815_enable_rls.sql` crea policy PERMISSIVE senza destinatario: rieseguito, si
  // sommerebbe in OR a `isolamento_tenant` e l'isolamento tornerebbe inerte senza errori.
  // Resta in docs/storico come traccia di cosa c'era, fuori dalla cartella delle migrazioni.
  it('supabase/migrations contiene solo la RLS effettiva', () => {
    expect(readdirSync(path.join(RADICE, 'supabase', 'migrations'))).toEqual(['20260819_rls_effettiva.sql']);
    expect(existsSync(path.join(RADICE, 'docs', 'storico', '20260815_enable_rls.sql'))).toBe(true);
  });

  it('docker-compose.prod.yml monta solo rls_effettiva', () => {
    const compose = leggi('docker-compose.prod.yml');
    const montati = [...compose.matchAll(/^\s*-\s*([^\s:]+\.sql):/gm)].map((m) => m[1]);
    expect(montati).toEqual(['./supabase/migrations/20260819_rls_effettiva.sql']);
  });

  it('applyRls.ts indica dove sta ora lo script superato', () => {
    const script = leggi('src', 'adapters', 'prisma', 'applyRls.ts');
    expect(script).toContain('docs/storico/20260815_enable_rls.sql');
    expect(script).not.toContain('supabase/migrations/20260815_enable_rls.sql');
  });
});

describe('🖥️ aggiorna-blusmart.sh — l aggiornamento di blusmart.eu lanciato da Fabio', () => {
  const script = leggi('scripts', 'aggiorna-blusmart.sh');
  const posizione = (testo: string) => {
    const i = script.indexOf(testo);
    expect(i, `manca «${testo}»`).toBeGreaterThan(-1);
    return i;
  };

  it('senza --applica controlla e basta: esce prima della copia e di qualunque modifica', () => {
    expect(script).toMatch(/^set -euo pipefail$/m);
    const uscita = posizione('if [ "$APPLICA" != si ]; then');
    expect(uscita).toBeLessThan(posizione('bash ./scripts/backup-vps.sh'));
  });

  it('copia di sicurezza prima di frontend, migrazioni e container; migrate prima di rls', () => {
    const copia = posizione('bash ./scripts/backup-vps.sh');
    const frontend = posizione('-e VITE_API_BASE=/api');
    const migrate = posizione('run --rm -T migrate');
    const rls = posizione('run --rm -T rls');
    const su = posizione('$COMPOSE up -d </dev/null');
    expect(copia).toBeLessThan(frontend);
    expect(frontend).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(rls);
    expect(rls).toBeLessThan(su);
  });

  it('ogni comando docker ha lo stdin chiuso: lanciato via ssh, un container si mangerebbe il terminale', () => {
    // Le righe spezzate con `\` si leggono intere: il `</dev/null` può stare sulla continuazione.
    const righe = script.replace(/\\\n/g, ' ').split('\n').filter((r) => /^\s*(\$COMPOSE|docker run)\b/.test(r) || /\$\(\$COMPOSE exec/.test(r));
    expect(righe.length).toBeGreaterThan(5);
    for (const r of righe) expect(r, r).toContain('</dev/null');
  });

  it('con --applica si stacca dalla connessione e restituisce l esito vero', () => {
    // Il 27/11 ssh è caduto a metà della build delle immagini e lo script si è fermato, col
    // frontend nuovo già servito davanti al backend vecchio.
    expect(script).toMatch(/BLUMAN_STACCATO=1 setsid nohup bash "\$0" --applica > "\$LOG" 2>&1 <\/dev\/null &/);
    expect(posizione('wait "$FIGLIO"')).toBeLessThan(posizione('titolo "1. Copia di sicurezza"'));
  });

  it('la versione in servizio è quella registrata dallo script, non dedotta da git', () => {
    // Un git pull cambia i file su disco, non il sito: il 27/11 ORIG_HEAD indicava la versione sbagliata.
    expect(script).not.toContain('ORIG_HEAD');
  });

  it('si ferma se sul server ci sono file del repo modificati a mano', () => {
    expect(script).toContain('git status --porcelain --untracked-files=no');
  });

  it('sonda le pagine che sono state rotte, l indirizzo profondo dell Aiuto e il manuale contato dal repo', () => {
    expect(script).toMatch(/for PAGINA in [^\n]*\/portal\b/);
    expect(script).toMatch(/for PAGINA in [^\n]*\/aiuto\/[a-z0-9-]+/);
    expect(script).toContain('nginx -s reload');
    expect(script).toContain('ls docs/manuale | wc -l');
    // Il 20 fisso di distribuisci.sh oggi farebbe fallire un aggiornamento riuscito: le schede sono di più.
    expect(script).not.toMatch(/"\$TROVATI" = "20"/);
  });
});

describe('🔄 aggiornamento automatico — pubblicazione dal fork e cron di blusmart.eu (28/11)', () => {
  const auto = leggi('scripts', 'aggiorna-blusmart-auto.sh');
  const pubblica = leggi('scripts', 'pubblica.sh');
  const deploy = leggi('.github', 'workflows', 'deploy.yml');
  const installa = leggi('scripts', 'installa-aggiornamento-automatico.sh');

  it('con migrazioni --automatico non unisce: esce prima di gh pr merge', () => {
    // Railway applica le migrazioni all'avvio senza backup: quella pubblicazione aspetta Fabio.
    const fermo = pubblica.indexOf('if [[ "$AUTO" == si && -n "$migr" ]]; then');
    expect(fermo).toBeGreaterThan(-1);
    expect(pubblica.slice(fermo, fermo + 200)).toContain('exit 3');
    expect(fermo).toBeLessThan(pubblica.indexOf('gh pr merge "$pr"'));
    expect(pubblica).toContain('--match-head-commit');
  });

  it('deploy.yml pubblica solo nel fork, col suo token, e non scrive mai su upstream con git', () => {
    expect(deploy).toContain("if: github.repository == 'wolftradesystem-tech/bluman'");
    expect(deploy).toContain('bash scripts/pubblica.sh --automatico');
    expect(deploy).toContain('GH_TOKEN: ${{ secrets.PUBBLICA_TOKEN }}');
    expect(deploy).toContain('git remote set-url --push upstream NO_PUSH');
    expect(deploy).not.toMatch(/git push/);
  });

  it('il cron aggiorna con lo script che fa la copia prima, e senza staccarsi', () => {
    expect(auto).toContain('BLUMAN_STACCATO=1 bash ./scripts/aggiorna-blusmart.sh --applica');
    expect(auto).toContain('git merge --quiet --ff-only');
    expect(auto).toContain('flock -n 9');
    // Corpo in una funzione: il merge che sostituisce il file a metà giro non cambia il codice in corsa.
    expect(auto).toMatch(/^principale "\$@"$/m);
  });

  it('il cron si ferma da solo dove servono occhi: pausa, fuori da main, file toccati, storia riscritta', () => {
    const applica = auto.indexOf('BLUMAN_STACCATO=1 bash ./scripts/aggiorna-blusmart.sh --applica');
    for (const guardia of [
      'if [ -e "$FILE_PAUSA" ]; then',
      'if [ "$RAMO" != main ]; then',
      'git status --porcelain --untracked-files=no',
      'git merge-base --is-ancestor "$SU_DISCO" "$REMOTO"',
      'if [ -z "$IN_SERVIZIO" ]; then',
      '= "$REMOTO" ]; then',
    ]) {
      const i = auto.indexOf(guardia);
      expect(i, `manca «${guardia}»`).toBeGreaterThan(-1);
      expect(i, guardia).toBeLessThan(applica);
    }
  });

  it('niente segreti nei messaggi: stderr di curl soppresso, del log solo la riga ERRORE', () => {
    expect(auto).toMatch(/sendMessage" 2>\/dev\/null\)"/);
    expect(auto).toContain("grep -m1 '^ERRORE:'");
    expect(auto).not.toMatch(/tail[^\n]*\$LOG/);
  });

  it('l installatore non scrive sopra un cron che non è riuscito a leggere', () => {
    expect(installa).toContain("grep -qi 'no crontab'");
    expect(installa).toContain('le altre righe del cron sono cambiate');
  });
});

// Il passo di deploy.yml eseguito davvero, con `pubblica.sh` e `ci-notify.sh` finti: il 28/11 la
// prima pubblicazione con migrazioni (uscita 3, «aspetta il backup e Fabio») ha chiuso il job in
// rosso e senza avviso, perché il passo gira con `bash -e` e la pipe si fermava prima di leggere
// l'esito. Leggere il file non bastava a vederlo: si vede solo lanciandolo.
describe.skipIf(spawnSync('bash', ['-c', 'git --version']).status !== 0)('🔄 deploy.yml — il passo «Pubblica» letto dal suo esito', () => {
  const deploy = leggi('.github', 'workflows', 'deploy.yml');
  const inizio = deploy.indexOf('        run: |\n', deploy.indexOf('- name: Pubblica verso il repo del titolare'));
  const passo = deploy
    .slice(inizio + '        run: |\n'.length)
    .split('\n')
    .map((riga) => riga.replace(/^ {10}/, ''))
    .join('\n');

  function lancia(esitoPubblica: number, righe: string[]): { stato: number | null; avviso: string } {
    const dir = mkdtempSync(join(tmpdir(), 'bluman-deploy-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'pubblica.sh'), `${righe.map((r) => `echo '[pubblica] ${r}'`).join('\n')}\nexit ${esitoPubblica}\n`);
      writeFileSync(join(dir, 'scripts', 'ci-notify.sh'), 'printf "%s" "$1" > avviso.txt\n');
      writeFileSync(join(dir, 'passo.sh'), passo);
      spawnSync('git', ['init', '-q'], { cwd: dir });
      // Come lo lancia GitHub Actions quando il passo non dichiara una shell: `bash -e`.
      const esito = spawnSync('bash', ['-e', 'passo.sh'], { cwd: dir, env: { ...process.env, GH_TOKEN: 'finto', CI_TELEGRAM_TOKEN: '', CI_TELEGRAM_CHAT: '' }, encoding: 'utf8' });
      const fileAvviso = join(dir, 'avviso.txt');
      return { stato: esito.status, avviso: existsSync(fileAvviso) ? readFileSync(fileAvviso, 'utf8') : '' };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('il passo si trova nel file, ed è quello che lancia pubblica.sh', () => {
    expect(inizio).toBeGreaterThan(-1);
    expect(passo).toContain('bash scripts/pubblica.sh --automatico');
  });

  it('con migrazioni (uscita 3) il job resta verde e avvisa che aspetta il backup e «pubblica»', () => {
    const { stato, avviso } = lancia(3, ['PR aperta: https://example.org/pull/4', 'NON unita: porta migrazioni']);
    expect(stato).toBe(0);
    expect(avviso).toContain('porta migrazioni dello schema e NON è stata unita');
    expect(avviso).toContain('PR aperta: https://example.org/pull/4');
  });

  it('pubblicazione riuscita (uscita 0): verde, con le righe dello script', () => {
    const { stato, avviso } = lancia(0, ['PR unita']);
    expect(stato).toBe(0);
    expect(avviso).toContain('bluman pubblicato');
    expect(avviso).toContain('PR unita');
  });

  it('un guasto vero (uscita 1) resta rosso, e lo dice con il numero', () => {
    const { stato, avviso } = lancia(1, ['il titolare ha pubblicato altro']);
    expect(stato).not.toBe(0);
    expect(avviso).toContain('non riuscita (uscita 1)');
  });

  it('senza nessuna riga [pubblica] l’avviso parte lo stesso', () => {
    const { stato, avviso } = lancia(3, []);
    expect(stato).toBe(0);
    expect(avviso).toContain('porta migrazioni');
  });
});
