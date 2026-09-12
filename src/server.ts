// Server HTTP — §15, sottoinsieme minimo per il quick start end-to-end.
// Costruito su InMemoryApp per default: nessun database necessario per provarlo.
// Vedi README per come collegare invece l'adapter Prisma reale.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppPort } from './services/appPort.js';
import { ProceduraIncompletaError } from './services/esecuzione.js';
import {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
  DipendenzaCiclicaError,
} from './adapters/appErrors.js';

import { signJwt, verifyJwt } from './util/jwt.js';
import { apriStreamSse } from './services/notificheService.js';
// §14 — non `new PrismaClient()`: questo client impone il tenant corrente a ogni query,
// altrimenti le policy RLS non vedono nessun contesto e non restituiscono nulla.
import { prisma, attivaContestoTenant } from './util/prismaClient.js';
import { getRedisClient } from './util/redis.js';
import {
  clienteIdDalJwt,
  ruoloValido,
  rottaConsentitaAlCliente,
  type Ruolo,
} from './util/authorization.js';

// Helper condivisi (costanti di sessione, audit, recapiti, IP reale): estratti in
// src/util/serverHelpers.ts dallo split dei monoliti — stesse identiche implementazioni.
import {
  TENANT_DEFAULT,
  DURATA_SESSIONE_OPERATORE_MINUTI,
  DURATA_SESSIONE_CLIENTE_MINUTI,
  SOGLIA_RINNOVO,
} from './util/serverHelpers.js';
// Rotte auth (split dei monoliti): la registrazione avviene dentro il wrapper
// register di buildServer, nello stesso punto di prima.
import { registraRotteAuth } from './routes/auth.js';
// Rotte tenant e admin (split dei monoliti): la registrazione avviene dentro il
// wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteTenant } from './routes/tenant.js';
// Rotte catalogo e anagrafica clienti (split dei monoliti): la registrazione
// avviene dentro il wrapper register di buildServer, negli stessi punti di prima.
import { registraRotteCatalogo } from './routes/catalogo.js';
import { registraRotteClienti } from './routes/clienti.js';
// Rotte progetti ed esecuzione (split dei monoliti): la registrazione avviene
// dentro il wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteProgetti } from './routes/progetti.js';
// Rotte contabilità (split dei monoliti): la registrazione avviene dentro il
// wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteContabilita } from './routes/contabilita.js';
// Rotte documenti (split dei monoliti): la registrazione avviene dentro il
// wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteDocumenti } from './routes/documenti.js';
// Archivio documentale dello studio (§37): albero Cliente → Progetto in sola
// lettura, file a parte perché routes/documenti.ts è già oltre le 1000 righe.
import { registraRotteArchivioDocumenti } from './routes/archivioDocumenti.js';
// §40 — Collocazione di un documento nell'archivio: collegarlo al progetto e alla
// micro-voce, e l'elenco di quelli rimasti senza cartella. Sposta le carte, quindi
// sta fuori dall'archivio in sola lettura.
import { registraRotteCollegamentoDocumenti } from './routes/collegamentoDocumenti.js';
// §41 — Cartella dei modelli dello studio: le quattro rotte `/documenti-template` (spostate
// da routes/documenti.ts, che era oltre le 1000 righe) più lo stato di revisione,
// l'archiviazione a database e l'adozione dei modelli di serie.
import { registraRotteModelliDocumento } from './routes/modelliDocumento.js';
import { registraRotteFornitori } from './routes/fornitori.js';
import { registraRotteLiquidazioneIva } from './routes/liquidazioneIva.js';
import { registraRotteSolleciti } from './routes/solleciti.js';
import { registraRotteFascicoloFiscale } from './routes/fascicoloFiscale.js';
// Rotte portale cliente (split dei monoliti): la registrazione avviene dentro
// il wrapper register di buildServer, nello stesso punto di prima.
import { registraRottePortale } from './routes/portale.js';
// Rotte firma FEA+OTP (split dei monoliti): la registrazione avviene dentro il
// wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteFirma } from './routes/firma.js';
// Rotte notifiche (split dei monoliti): la registrazione avviene dentro il
// wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteNotifiche } from './routes/notifiche.js';
// Rotte webhook comunicazioni (split dei monoliti): la registrazione avviene
// dentro il wrapper register di buildServer, nello stesso punto di prima.
import { registraRotteWebhooks } from './routes/webhooks.js';
// Invio email/WhatsApp e lettura della posta in arrivo, con le credenziali dello
// studio lette dal database: prima le faceva il browser chiamando le funzioni
// serverless con la password SMTP presa da localStorage.
import { registraRotteComunicazioni } from './routes/comunicazioni.js';
import { registraSwagger } from './plugins/swagger.js';

const isTestEnv = process.env.NODE_ENV === 'test';
const isProdEnv = process.env.NODE_ENV === 'production';

export function ottieniConfigurazioneLogger() {
  if (isTestEnv && !process.env.TEST_LOG) {
    return false;
  }
  return {
    level: process.env.LOG_LEVEL || (isProdEnv ? 'info' : 'debug'),
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-bluman-token"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.jwt',
      '*.codiceOtp',
      '*.waAccessToken',
      '*.smtpPass',
      '*.secret',
    ],
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          path: req.routeOptions?.url || req.routerPath,
          ip: req.ip,
          tenantId: req.tenantId,
          userId: req.userId,
          ruolo: req.ruolo,
        };
      },
    },
  };
}

export function buildServer(app: AppPort): FastifyInstance {
  const server = Fastify({
    logger: ottieniConfigurazioneLogger() as any,
    // Dietro il proxy di Railway (NODE_ENV=production) `req.ip` senza questa opzione è
    // l'indirizzo interno del load balancer, che cambia da connessione a connessione.
    // @fastify/rate-limit tiene i contatori per-IP usando proprio `req.ip`: con IP
    // sempre diversi il contatore non si accumula mai e il limite è di fatto disattivato
    // (verificato in produzione: 401 anche al 6° tentativo di login). Fidandosi del proxy,
    // Fastify risolve `req.ip` dal primo salto di `x-forwarded-for`, cioè il client reale.
    trustProxy: process.env.NODE_ENV === 'production',
    // §21 — il default di Fastify è 1 MiB: ogni corpo più grande viene rifiutato con 413
    // PRIMA di raggiungere la rotta (vale anche per il parser JSON personalizzato qui
    // sotto, che eredita il limite dell'istanza). Gli upload dei documenti viaggiano come
    // JSON con il file in base64: un allegato di 1 MB diventa ~1,4 MB di corpo e veniva
    // respinto — il frontend incassava il 413 senza dirlo e il documento risultava
    // «collegato» senza nessun file dietro. Il tetto dello scanner (§28) è 30 MB di file,
    // che in base64 diventano ~40 MB di corpo: 45 MiB lascia margine per l'involucro
    // JSON restando la scansione il vero limite ai file.
    bodyLimit: 45 * 1024 * 1024,
  });

  // Supporta body vuoti con Content-Type: application/json (es. richieste DELETE, POST senza payload)
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    // `parseAs: 'string'` garantisce a runtime una stringa, ma la firma di Fastify resta
    // `string | Buffer`: la normalizziamo invece di forzarla con un cast, così il parser
    // regge anche se un domani il body arrivasse come Buffer.
    const testo = typeof body === 'string' ? body : body.toString('utf8');
    if (!testo || testo.trim() === '') {
      done(null, {});
      return;
    }
    try {
      const json = JSON.parse(testo);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  /**
   * §23 — le sole rotte raggiungibili senza un token valido. Tutto il resto risponde 401.
   *
   * Fino a questa modifica l'elenco era implicitamente "tutte": l'hook `onRequest`
   * ricavava il tenant dal token quando c'era, e senza token proseguiva col tenant di
   * default. Siccome tutti i dati di produzione stanno in quel tenant, `GET /clienti`
   * su un URL pubblico restituiva anagrafiche complete — P.IVA, codice fiscale, IBAN —
   * a chiunque, e le POST erano altrettanto aperte. RLS non difende da questo: la
   * richiesta porta un tenant legittimo, e le policy restituiscono giustamente le sue
   * righe. L'isolamento fra studi e l'autenticazione sono due controlli distinti.
   *
   * La chiave è il pattern di rotta (`/uploads/:filename`), non l'URL della richiesta:
   * confrontare l'URL grezzo lascerebbe passare varianti con query string o
   * codifiche diverse.
   */
  const ROTTE_PUBBLICHE = new Set<string>([
    'GET /health',
    // Sono le rotte che emettono un token: per definizione non possono richiederne uno.
    'POST /auth/login',
    'POST /auth/magic-login',
    'POST /auth/client-login',
    // Chiamate da Meta, Telegram e SdI, che non possono portare un nostro JWT. Si
    // autenticano col proprio meccanismo: hub.verify_token (WhatsApp), il segreto
    // del bot (Telegram) e il secret condiviso WEBHOOK_SECRET_SDI confrontato
    // col timing-safe comparison nel handler (SdI).
    'GET /webhooks/communications/whatsapp',
    'POST /webhooks/communications/whatsapp',
    'POST /webhooks/communications/telegram',
    'POST /webhooks/sdi',
    // Qui "pubblica" significa "il guard non la controlla, la controlla il handler": i file
    // finiscono in `<img src>` e in link diretti, che non possono inviare l'header
    // Authorization. Il handler pretende il Bearer *oppure* la firma HMAC in query string
    // (`?firma=&scad=`), che il guard non saprebbe leggere. Senza una delle due: 401.
    'GET /uploads/:filename',
  ]);

  // §3.1 — CORS con whitelist esplicita: `origin: true` rifletteva qualunque Origin,
  // quindi qualsiasi sito poteva chiamare l'API dal browser di un operatore loggato.
  // Le origini ammesse si elencano in CORS_ORIGINS (separate da virgola; una voce che
  // inizia con `*.` fa suffix-match sull'hostname, utile per i deploy Vercel).
  // In sviluppo la whitelist di default è localhost; in produzione senza CORS_ORIGINS
  // nessuna origine browser è ammessa (fail-closed) e resta solo l'accesso senza Origin.
  const originiDaEnv = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const DEFAULT_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'https://bluman.vercel.app',
    '*.vercel.app',
  ];
  const originiConsentite = Array.from(new Set([...DEFAULT_ORIGINS, ...originiDaEnv]));

  function origineInWhitelist(origine: string): boolean {
    return originiConsentite.some(voce => {
      if (voce.startsWith('*.')) {
        try {
          return new URL(origine).hostname.endsWith(voce.slice(1));
        } catch {
          return false;
        }
      }
      return origine === voce;
    });
  }

  server.register(cors, {
    origin: (origine: string | undefined, callback) => {
      // Senza header Origin non è una chiamata cross-origin del browser (curl,
      // server-to-server, app mobile): passa. Idem l'origine letterale 'null'
      // (client che non dichiarano un'origine, es. alcuni tool HTTP).
      if (!origine || origine === 'null') return callback(null, true);
      if (origineInWhitelist(origine)) return callback(null, true);
      console.warn(`CORS bloccata per origine non in whitelist: ${origine}`);
      return callback(new Error(`Origine non consentita dalla CORS policy: ${origine}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    strictPreflight: false,
  });

  // Fase 1 — da qui in poi (rate-limit, error handler, hook di autenticazione e
  // tutte le rotte) vive dentro un plugin registrato sulla root. Il motivo è
  // @fastify/rate-limit: applica i limiti con un hook `onRoute`, che vede solo le
  // rotte registrate DOPO il suo caricamento. In un buildServer sincrono le rotte
  // esisterebbero già quando il plugin viene caricato (al primo ready) e
  // resterebbero tutte senza protezione. Dentro il plugin, invece,
  // `await server.register(rateLimit, ...)` carica il limiter prima che le rotte
  // vengano definite, e sia il limite globale sia quelli per-route si agganciano.
  // Il parametro `server` ombra volutamente l'istanza esterna: tutto il codice che
  // segue registra sul contesto del plugin senza dover essere riscritto.
  // La condizione sul rate-limit va letta QUI, nella parte sincrona di buildServer:
  // il corpo del plugin viene eseguito solo al primo ready(), quando NODE_ENV
  // potrebbe essere già cambiato (i test lo ripristinano dopo la costruzione).
  const abilitaRateLimit = process.env.NODE_ENV !== 'test';
  server.register(async (server) => {
  // Fase 1 — rate limiting. Protezione contro brute-force sulle tre rotte che
  // verificano credenziali (/auth/login, /auth/magic-login, /auth/client-login:
  // config per-route dedicata, più stretta) e contro abusi generici (limite globale).
  // Onestà sui limiti: lo store è in-memory per istanza. Railway oggi serve una
  // sola replica, quindi il limite è effettivo; con più repliche ogni istanza
  // conterebbe per sé e il limite reale sarebbe max × repliche — in quel caso
  // va collegato uno store condiviso (es. Redis).
  // In NODE_ENV=test il plugin non viene registrato: la suite esegue centinaia
  // di inject dalla stessa 'IP' e il limite falserebbe i test.
  if (abilitaRateLimit) {
    const redisClient = getRedisClient();
    await server.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      ...(redisClient ? { redis: redisClient } : {}),
      // I probe dell'orchestratore su /health non devono mai consumare budget.
      allowList: (req) => req.url === '/health',
      errorResponseBuilder: (_req, context) => {
        const messaggio = `Troppe richieste. Riprova tra ${Math.ceil(Number(context.ttl) / 1000)} secondi.`;
        // Deve essere un Error con statusCode: il plugin lo lancia nell'hook e il
        // setErrorHandler lo riemette col suo codice (429, o 403 in caso di ban).
        return Object.assign(new Error(messaggio), { statusCode: context.statusCode, errore: messaggio });
      },
    });
  }

  server.setErrorHandler((err: any, _req, reply) => {
    if (
      err instanceof ClienteNonTrovatoError ||
      err instanceof ProgettoNonTrovatoError ||
      err instanceof PreventivoNonTrovatoError ||
      err instanceof ModuloNonTrovatoError
    ) {
      return reply.code(404).send({ errore: err.message });
    }
    if (err instanceof TransizioneNonValidaError || err instanceof ProceduraIncompletaError) {
      return reply.code(409).send({ errore: err.message });
    }
    // §7ter — ciclo nelle dipendenze: la modifica chiesta non è valida, è lo
    // stesso 400 che dà la rotta PUT quando lo rileva prima della transazione.
    // Qui arriva il lancio dalla porta applicativa (script, uso programmatico).
    if (err instanceof DipendenzaCiclicaError) {
      return reply.code(400).send({ errore: `Ciclo nelle dipendenze (§7ter): ${err.message}` });
    }
    // Errori che nascono già con un codice HTTP (il 429 di @fastify/rate-limit,
    // i 4xx standard di Fastify): il codice va rispettato, non sepolto in un 500.
    if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ errore: err.errore || err.message });
    }
    console.error('Fastify route error:', err);
    return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore interno' });
  });

  server.setNotFoundHandler((req, reply) => {
    console.warn(`[404 NOT FOUND] ${req.method} ${req.url} (ip: ${req.ip}, auth: ${Boolean(req.headers.authorization)})`);
    return reply.code(404).send({ message: `Route ${req.method}:${req.url} not found`, error: 'Not Found', statusCode: 404 });
  });

  // ─── OPENAPI & SWAGGER UI (§6.2) ───────────────────────────────────
  await registraSwagger(server);

  // §23 — la protezione brute-force sugli endpoint che verificano credenziali è
  // demandata a @fastify/rate-limit (config per-route: 5 richieste/min per IP,
  // registrata sopra insieme al limite globale). Un solo meccanismo, header
  // Retry-After corretti, e il passaggio a store condiviso (Redis) per più
  // repliche diventa una riga di configurazione invece di codice ad hoc.

  // ─── MULTI-TENANT CONTEXT MIDDLEWARE (§14, §23) ───────────────────
  server.addHook('onRequest', async (req, reply) => {
    let tenantId = TENANT_DEFAULT; // Default Studio Tenant
    let ruolo: Ruolo | undefined;
    let autenticato = false;
    let payload = null as ReturnType<typeof verifyJwt>;
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

    // Per la documentazione Swagger UI (/docs) permettiamo anche l'autenticazione tramite query string ?token=
    const patternRotta = req.routeOptions?.url;
    const urlSenzaQuery = (req.url || '').split('?')[0] || '';
    const isDocsRoute = (patternRotta?.startsWith('/docs') || urlSenzaQuery.startsWith('/docs')) ?? false;
    if (!token && isDocsRoute) {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        token = parsedUrl.searchParams.get('token') || undefined;
      } catch {
        // query non standard
      }
    }

    if (token) {
      const verificato = verifyJwt(token);
      if (verificato && ruoloValido(verificato.ruolo) && Number.isInteger(verificato.sessionVersion)) {
        payload = verificato;
        ruolo = verificato.ruolo;
        if (verificato.tenantId) tenantId = verificato.tenantId;

        // Un JWT firmato non basta per rinnovare o accedere: l'identità deve ancora esistere,
        // essere attiva (o invitata nei flussi staff) e avere la stessa versione di sessione.
        try {
          if (ruolo === 'cliente') {
            const clienteId = clienteIdDalJwt(verificato);
            if (clienteId) {
              attivaContestoTenant({ tenantId, ruolo });
              const cliente = await prisma.cliente.findFirst({
                where: { id: clienteId, tenantId },
                select: { sessionVersion: true },
              });
              autenticato = Boolean(cliente && cliente.sessionVersion === verificato.sessionVersion);
            }
          } else {
            attivaContestoTenant({ tenantId, ruolo });
            const utente = await prisma.user.findFirst({
              where: { id: verificato.userId, ...(ruolo === 'super_admin' ? {} : { tenantId }) },
              select: { ruolo: true, stato: true, sessionVersion: true },
            });
            autenticato = Boolean(
              utente &&
              utente.ruolo === ruolo &&
              utente.stato !== 'disattivato' &&
              utente.sessionVersion === verificato.sessionVersion,
            );
          }
        } catch (err) {
          // Verifica identità fail-closed: un DB irraggiungibile non trasforma un token
          // non verificabile in una sessione valida e non produce rinnovi.
          console.error('Verifica sessione JWT fallita:', err instanceof Error ? err.message : err);
          autenticato = false;
        }

        if (autenticato) {
          const durataMinuti =
            ruolo === 'cliente' ? DURATA_SESSIONE_CLIENTE_MINUTI : DURATA_SESSIONE_OPERATORE_MINUTI;
          const adesso = Math.floor(Date.now() / 1000);
          const rimanenti = (verificato.exp ?? 0) - adesso;
          if (rimanenti > 0 && rimanenti < durataMinuti * 60 * SOGLIA_RINNOVO) {
            const { exp: _scaduto, ...contenuto } = verificato;
            reply.header('X-Bluman-Token', signJwt(contenuto, durataMinuti));
            reply.header('Access-Control-Expose-Headers', 'X-Bluman-Token');
          }
        }
      }
    }

    if (isDocsRoute) {
      if (process.env.NODE_ENV === 'production') {
        if (!autenticato) {
          return reply.code(401).send({ errore: 'Accesso alla documentazione API riservato agli operatori autenticati.' });
        }
        if (ruolo !== 'advisor' && ruolo !== 'super_admin') {
          return reply.code(403).send({ errore: 'Accesso alla documentazione API riservato ad advisor e super_admin.' });
        }
      }
      return;
    }

    const chiaveRotta = `${req.method} ${patternRotta ?? req.url}`;
    const rottaEsistente = patternRotta !== undefined;
    if (req.method !== 'OPTIONS' && rottaEsistente && !autenticato && !ROTTE_PUBBLICHE.has(chiaveRotta)) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    if (
      req.method !== 'OPTIONS' &&
      rottaEsistente &&
      autenticato &&
      ruolo === 'cliente' &&
      !rottaConsentitaAlCliente(req.method, patternRotta)
    ) {
      return reply.code(403).send({ errore: 'Non autorizzato per il portale cliente.' });
    }

    // §2bis — solo il super_admin può spostarsi tra tenant. Onorare questo header per
    // chiunque rendeva l'isolamento multi-tenant aggirabile con una riga di curl: per
    // tutti gli altri ruoli il tenant del token è vincolante.
    const tenantRichiesto = req.headers['x-tenant-id'];
    if (tenantRichiesto && ruolo === 'super_admin') {
      tenantId = tenantRichiesto as string;
    }
    req.tenantId = tenantId;
    req.ruolo = ruolo;
    req.user = payload;
    req.userId = payload?.userId;
    // §14 — da qui in poi ogni query di questa richiesta viaggia con il tenant impostato
    // come variabile di sessione, che è ciò su cui filtrano le policy RLS. Senza questa
    // riga il ruolo `bluman_app` non vedrebbe nessuna riga: il guasto è immediato, non
    // una fuga silenziosa.
    attivaContestoTenant({ tenantId, ruolo });
  });

  // Fase 1 — /health verifica anche che il database sia raggiungibile, non solo
  // che il processo Node sia vivo: se il DB è down l'istanza risponde 503 e
  // l'orchestratore (Railway) può riavviarla, invece di servire errori su ogni
  // rotta. Il ping ha un timeout corto per non trascinare la risposta.
  server.get('/health', async (_req, reply) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout ping DB')), 2500);
        }),
      ]);
      return { stato: 'ok', db: 'ok' };
    } catch {
      return reply.code(503).send({ stato: 'degradato', db: 'irraggiungibile' });
    } finally {
      clearTimeout(timer);
    }
  });

  // ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
  // Rotte estratte in src/routes/auth.ts (split dei monoliti): stessa identica
  // registrazione, sempre dentro questo wrapper.
  await registraRotteAuth(server);
  // ─── GIURISDIZIONI API (§8 Estensione) & ELENCO MODULI ────────────
  // Rotte estratte in src/routes/catalogo.ts, registrate in testa alla sezione catalogo.

  // ─── ARTICOLI & PRESTAZIONI API (§Prisma Persistenza Cloud) ───────
  // Rotte catalogo (articoli, upload, moduli-template) estratte in
  // src/routes/catalogo.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteCatalogo(server, app);

  // Le rotte GET /clienti/:id e POST /clienti/:id/magic-link vivono ora in
  // src/routes/clienti.ts, registrata più sotto nella sezione anagrafica.

  // ─── TENANT, TEAM & ADMIN (§2bis: impostazioni studio, team, super admin) ──
  // Rotte estratte in src/routes/tenant.ts (split dei monoliti): stessa identica
  // registrazione, sempre dentro questo wrapper.
  await registraRotteTenant(server);

  // Audit Logs API (Isolato per Tenant): rotte GET/POST /audit-logs estratte in
  // src/routes/tenant.ts, registrate in coda alla sezione tenant.

  // ─── NOTIFICHE (Blocco 3) ─────────────────────────────────────────
  // Rotte notifiche (lista per destinatario, creazione, read-all) estratte in
  // src/routes/notifiche.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteNotifiche(server);

  // ─── STREAM SSE (Blocco 3) ────────────────────────────────────────
  // Server-Sent Events: il client apre lo stream con il proprio JWT (header
  // Authorization, per questo non usiamo EventSource lato browser ma fetch +
  // ReadableStream) e riceve un frame `event: notifica` per ogni evento del
  // suo tenant/identità. Ping ogni 25 s per tenere vivo il collegamento
  // attraverso i proxy (Railway in testa).
  server.get('/stream', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId;
    const isCliente = req.ruolo === 'cliente' || (userId || '').startsWith('client-');

    const requestOrigin = (req.headers.origin as string) || '';
    const allowOrigin = requestOrigin && origineInWhitelist(requestOrigin) ? requestOrigin : (requestOrigin || 'https://bluman.vercel.app');

    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Access-Control-Allow-Origin', allowOrigin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, Accept, Origin, X-Requested-With');
    reply.raw.writeHead(200);
    reply.raw.write(': connesso\n\n');

    const chiudi = apriStreamSse(reply, {
      tenantId,
      destinatarioId: isCliente ? null : userId ?? null,
      destinatarioClienteId: isCliente && userId ? userId.replace(/^client-/, '') : null,
    });

    const ping = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        // socket già chiuso: la pulizia avviene sul listener 'close'
      }
    }, 25_000);

    req.raw.on('close', () => {
      clearInterval(ping);
      chiudi();
    });
  });

  // Comunicazioni Progetto API (Multicanale Ingestion): le rotte
  // GET/POST /progetti/:id/comunicazioni vivono ora in src/routes/progetti.ts,
  // registrata più sotto nella sezione progetti.

  // ─── COMUNICAZIONI: INVIO EMAIL/WHATSAPP E POSTA IN ARRIVO ────────
  // Rotte in src/routes/comunicazioni.ts: sostituiscono le chiamate che il
  // browser faceva alle funzioni serverless `/api/send-email` e
  // `/api/send-whatsapp` con le credenziali dello studio prese da
  // `localStorage`. Registrate dentro questo wrapper e assenti da
  // ROTTE_PUBBLICHE: richiedono un JWT come tutto il resto.
  await registraRotteComunicazioni(server);

  // ─── WEBHOOK COMUNICAZIONI: META WHATSAPP & TELEGRAM ──────────────
  // Rotte webhook (Meta WhatsApp verify+ingestion eventi, Telegram bot
  // ingestion progetti + setup webhook) estratte in src/routes/webhooks.ts:
  // stessa registrazione, sempre dentro questo wrapper.
  await registraRotteWebhooks(server);

  // Le rotte GET/POST /tenant/utenti vivono nel blocco "GESTIONE UTENTI TEAM TENANT"
  // più sopra: erano dichiarate due volte e Fastify rifiutava di avviare il server.

  // ─── ANAGRAFICA CLIENTI ERP API (§2, §14) ─────────────────────────
  // Rotte clienti (anagrafica completa + dettaglio e magic-link) estratte in
  // src/routes/clienti.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteClienti(server, app);

  // ─── PROGETTI, COMUNICAZIONI, TIMESHEET, CHECKLIST & ESECUZIONE ───
  // Rotte progetti ed esecuzione (anagrafica progetti, comunicazioni, timesheet,
  // operatori suggeriti, ricerca globale, checklist+preventivi, §17 esecuzione)
  // estratte in src/routes/progetti.ts: stessa registrazione, sempre dentro
  // questo wrapper.
  await registraRotteProgetti(server, app);

  // ─── FATTURE & CONTABILITÀ (ex blocchi F1-F10) ────────────────────
  // Rotte contabilità (emissione fatture, incassi/scadenzario/prima nota,
  // registro fatture, banche, reportistica, generatore PDF+email, webhook
  // esiti SDI, contratti ricorrenti, cron scadenze, SDI manuale) estratte in
  // src/routes/contabilita.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteContabilita(server, app);
  await registraRotteFornitori(server);
  await registraRotteLiquidazioneIva(server);
  await registraRotteSolleciti(server);
  await registraRotteFascicoloFiscale(server);

  // ── INCASSI, SCADENZARIO & PRIMA NOTA (STYLE OPENSTAMANAGER) ──────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── REGISTRO FATTURE STUDIO (STYLE OPENSTAMANAGER) ────────────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── REPORTISTICA DIREZIONALE (BLOCCO 5) ───────────────────────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── TIMESHEET (BLOCCO 6.1), OPERATORI SUGGERITI (BLOCCO 6.2), RICERCA ──
  // Rotte estratte in src/routes/progetti.ts, registrata nella sezione progetti.

  // ── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ─────────────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── WEBHOOK ESITI SDI — registrazione dell'esito reale di una fattura ──
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── CONTRATTI RICORRENTI & RETAINER (STYLE OPENSTAMANAGER) ────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── GESTIONE PERMESSI GRANULARI MODULI & SEZIONI (STYLE OPENSTAMANAGER) ─
  // Rotte estratte in src/routes/tenant.ts, registrata in coda alla sezione tenant.

  // ── CHECKLIST SOP COMPLIANCE (STYLE OPENSTAMANAGER) & PREVENTIVI ──
  // Rotte estratte in src/routes/progetti.ts, registrata nella sezione progetti.

  // ── §17 — Esecuzione (microvoci, ritardi, passaggi) ───────────────
  // Rotte estratte in src/routes/progetti.ts, registrata nella sezione progetti.

  // ─── DOCUMENTI: FASCICOLO DOCUMENTALE DEL PROGETTO (§2.9) ─────────
  // Rotte documenti (fascicolo documentale del progetto: upload, generazione,
  // versioni, richieste modifica, sblocco, stato, eliminazione, archiviazione)
  // estratte in src/routes/documenti.ts: stessa registrazione, sempre dentro
  // questo wrapper.
  await registraRotteDocumenti(server);

  // ─── CARTELLA MODELLI DELLO STUDIO (§41) ───────────────────────────
  // Le rotte `/documenti-template` da cui pesca il Document Studio, con lo stato
  // di revisione di ogni modello. Stesso wrapper delle altre, quindi stesso hook
  // di autenticazione e stesso rate-limit: i percorsi non sono cambiati, sono
  // soltanto usciti da routes/documenti.ts (regola 8).
  await registraRotteModelliDocumento(server);

  // ─── ARCHIVIO DOCUMENTALE DELLO STUDIO (§37) ───────────────────────
  // Sola lettura, in aggregato: l'albero Cliente → Progetto con i conteggi
  // delle carte. Il contenuto delle cartelle resta a `GET /documenti`.
  await registraRotteArchivioDocumenti(server);

  // §40 — Le scritture dell'archivio: collegare un documento al progetto e alla
  // micro-voce, e ritrovare quelli rimasti senza cartella. Stesso wrapper, quindi
  // stesso hook di autenticazione e stesso rate-limit.
  await registraRotteCollegamentoDocumenti(server);

  // ─── FIRMA ELETTRONICA SEMPLICE (SES · art. 20 CAD) & FIRMA DOCUMENTI ───────────
  // Rotte firma (SES con OTP whatsapp/email/telegram: documenti firmabili,
  // download, richieste modifica; poi canali-firma, richiesta/verifica OTP,
  // firma con file, elenco firme, firma grafometrica) estratte in
  // src/routes/firma.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteFirma(server);

  // ─── PORTALE CLIENTE (§2.6 contatti, §2.11 fatture, §2.3 dati fiscali, §2.5 addendum) ─
  // Rotte portale cliente estratte in src/routes/portale.ts: stessa
  // registrazione, sempre dentro questo wrapper.
  await registraRottePortale(server);

  // ── FIRMA: CANALI, RICHIESTA/VERIFICA OTP, FIRMA CON FILE, ELENCO, GRAFOMETRICA ──
  // Rotte estratte in src/routes/firma.ts, registrata nella sezione FEA/firma (più sopra).


  // ── WORKER CRON SCADENZE & RINNOVI AUTOMATICI UBO/MFSA/SDI ────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.

  // ── WEBHOOK TELEGRAM BOT REALE & INGESTION PROGETTI ─────────────────
  // Rotte estratte in src/routes/webhooks.ts, registrata nella sezione webhook (ex WhatsApp).

  // ── §3.5 — PREPARAZIONE INVIO MANUALE SDI ─────────────────────────
  // Rotte estratte in src/routes/contabilita.ts, registrata nella sezione contabilità.
  });

  return server;
}
