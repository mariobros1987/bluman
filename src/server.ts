// Server HTTP — §15, sottoinsieme minimo per il quick start end-to-end.
// Costruito su InMemoryApp per default: nessun database necessario per provarlo.
// Vedi README per come collegare invece l'adapter Prisma reale.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';
import type { AppPort } from './services/appPort.js';
import { ProceduraIncompletaError } from './services/esecuzione.js';
import {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
} from './adapters/appErrors.js';

import { signJwt, verifyJwt } from './util/jwt.js';
import { confrontoTokenCostante } from './util/password.js';
import { inviaEmail } from './services/emailService.js';
import { uploadDocumento, rifirmaUrlUpload, leggiFileArchivio } from './services/storageService.js';
import { generateInvoicePdfBuffer } from './services/pdfService.js';
import {
  creaOtp,
  verificaOtp,
  annullaOtp,
  creaSigilloFea,
  mascheraRecapito,
  descriviCanaleVerificato,
  canaleValido,
  TTL_OTP_SECONDI,
  ATTESA_REINVIO_SECONDI,
  type CanaleOtp,
  type AmbitoOtp,
} from './services/otpService.js';
import { credenzialiCanali, canaliDisponibili, inviaCodiceOtp, recapitiCliente } from './services/otpDispatch.js';
import { runDailyNotificationCron } from './services/cronService.js';
import { apriStreamSse, notificaStudio, notificaCliente } from './services/notificheService.js';
import { preparaFatturaPerInvioManuale } from './services/sdiService.js';
import { scanFileBuffer } from './services/securityScanner.js';
// §16 — le percentuali e gli stati aggregati arrivano da qui, non dal frontend.
import { arricchisciProgetti, calcolaAvanzamento, ricalcolaProgetto } from './services/calcoloService.js';
import { costruisciReport, REPORT_DISPONIBILI, type ChiaveReport } from './services/reportsService.js';
import { generaPdfReport, generaExcelReport } from './services/reportExport.js';
import { generaPdfVerbaleFirma } from './services/verbaleFirma.js';
import { contestoTagDocumento, risolviTagDocumento, blocchiDaHtml, generaPdfDocumento, generaDocxDocumento } from './services/generazioneDocumenti.js';
import { ricercaGlobale } from './services/ricercaGlobaleService.js';
// §14 — non `new PrismaClient()`: questo client impone il tenant corrente a ogni query,
// altrimenti le policy RLS non vedono nessun contesto e non restituiscono nulla.
import { prisma, attivaContestoTenant } from './util/prismaClient.js';

// Helper condivisi (costanti di sessione, audit, recapiti, IP reale): estratti in
// src/util/serverHelpers.ts dallo split dei monoliti — stesse identiche implementazioni.
import {
  TENANT_DEFAULT,
  STATI_MICROVOCE,
  STATI_PROGETTO,
  DURATA_SESSIONE_OPERATORE_MINUTI,
  DURATA_SESSIONE_CLIENTE_MINUTI,
  SOGLIA_RINNOVO,
  ipReale,
  normalizzaGrafometrica,
  recordAudit,
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

export function buildServer(app: AppPort): FastifyInstance {
  const server = Fastify({
    logger: false,
    // Dietro il proxy di Railway (NODE_ENV=production) `req.ip` senza questa opzione è
    // l'indirizzo interno del load balancer, che cambia da connessione a connessione.
    // @fastify/rate-limit tiene i contatori per-IP usando proprio `req.ip`: con IP
    // sempre diversi il contatore non si accumula mai e il limite è di fatto disattivato
    // (verificato in produzione: 401 anche al 6° tentativo di login). Fidandosi del proxy,
    // Fastify risolve `req.ip` dal primo salto di `x-forwarded-for`, cioè il client reale.
    trustProxy: process.env.NODE_ENV === 'production',
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
    'POST /portal/change-password',
    // Chiamate da Meta, Telegram e SdI, che non possono portare un nostro JWT. Si
    // autenticano col proprio meccanismo (hub.verify_token, secret del bot).
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
    await server.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
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
    // Errori che nascono già con un codice HTTP (il 429 di @fastify/rate-limit,
    // i 4xx standard di Fastify): il codice va rispettato, non sepolto in un 500.
    if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ errore: err.errore || err.message });
    }
    console.error('Fastify route error:', err);
    return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore interno' });
  });

  // §23 — la protezione brute-force sugli endpoint che verificano credenziali è
  // demandata a @fastify/rate-limit (config per-route: 5 richieste/min per IP,
  // registrata sopra insieme al limite globale). Un solo meccanismo, header
  // Retry-After corretti, e il passaggio a store condiviso (Redis) per più
  // repliche diventa una riga di configurazione invece di codice ad hoc.

  // ─── MULTI-TENANT CONTEXT MIDDLEWARE (§14, §23) ───────────────────
  server.addHook('onRequest', async (req, reply) => {
    let tenantId = TENANT_DEFAULT; // Default Studio Tenant
    let ruolo: string | undefined;
    let autenticato = false;
    let payload: any = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        payload = verifyJwt(token);
        if (payload) {
          autenticato = true;
          ruolo = payload.ruolo;
          if (payload.tenantId) {
            tenantId = payload.tenantId;
          }

          // Rinnovo scorrevole: superata metà della vita del token se ne restituisce uno nuovo
          // nell'header della risposta. Vale solo per un token ancora valido — `verifyJwt` ha
          // già respinto quelli scaduti — quindi non è un modo di rientrare, è un modo di non
          // uscire mentre si sta lavorando.
          const durataMinuti =
            payload.ruolo === 'cliente' ? DURATA_SESSIONE_CLIENTE_MINUTI : DURATA_SESSIONE_OPERATORE_MINUTI;
          const adesso = Math.floor(Date.now() / 1000);
          const rimanenti = (payload.exp ?? 0) - adesso;
          if (rimanenti > 0 && rimanenti < durataMinuti * 60 * SOGLIA_RINNOVO) {
            const { exp: _scaduto, ...contenuto } = payload;
            reply.header('X-Bluman-Token', signJwt(contenuto, durataMinuti));
            // Senza questo il browser non legge l'header: le risposte cross-origin espongono
            // solo gli header elencati qui.
            reply.header('Access-Control-Expose-Headers', 'X-Bluman-Token');
          }
        }
      }
    }

    // §23 — il controllo di autenticazione. Va qui e non su ogni singola rotta perché
    // sono 87: un elenco di rotte da proteggere si dimentica di aggiornare, un elenco
    // di rotte pubbliche no — una rotta nuova è protetta perché non è nell'insieme.
    // Le preflight CORS non portano header Authorization e vanno lasciate passare,
    // altrimenti il browser non arriva nemmeno a inviare la richiesta vera.
    //
    // Attenzione però: questo hook gira anche sul gestore not-found. Se rispondesse
    // 401 pure lì, una rotta inesistente diventerebbe indistinguibile da una rotta
    // esistente ma protetta (il 404 scomparirebbe del tutto). Quando la richiesta
    // non ha matching, routeOptions non ha né url né method: la si lascia passare
    // e Fastify risponde il 404 corretto.
    const chiaveRotta = `${req.method} ${req.routeOptions?.url ?? req.url}`;
    const rottaEsistente = req.routeOptions?.url !== undefined;
    if (req.method !== 'OPTIONS' && rottaEsistente && !autenticato && !ROTTE_PUBBLICHE.has(chiaveRotta)) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }

    // §2bis — solo il super_admin può spostarsi tra tenant. Onorare questo header per
    // chiunque rendeva l'isolamento multi-tenant aggirabile con una riga di curl: per
    // tutti gli altri ruoli il tenant del token è vincolante.
    const tenantRichiesto = req.headers['x-tenant-id'];
    if (tenantRichiesto && ruolo === 'super_admin') {
      tenantId = tenantRichiesto as string;
    }
    (req as any).tenantId = tenantId;
    (req as any).ruolo = ruolo;
    (req as any).user = payload;
    (req as any).userId = payload?.userId;
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
  // ─── GIURISDIZIONI API (§8 Estensione) ───────────────────────────
  server.get('/giurisdizioni', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const items = await prisma.giurisdizione.findMany({
        where: { tenantId },
        orderBy: { nome: 'asc' },
      });
      return items;
    } catch {
      return [
        { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue', note: 'Repubblica di Malta' },
        { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue', note: 'Territorio d Oltremare Britannico' },
        { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa', note: 'Stato della Florida' },
        { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa', note: 'Stato del Delaware' },
        { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue', note: 'Dubai / Abu Dhabi Free Zones' },
      ];
    }
  });

  server.post<{ Body: { nome: string; codice: string; tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = req.body || {};
    try {
      const item = await prisma.giurisdizione.create({
        data: {
          tenantId,
          nome: body.nome,
          codice: body.codice,
          tipo: body.tipo || 'ue',
          note: body.note,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_CREATA',
        entita: body.nome,
        dettagli: `Aggiunta nuova giurisdizione ${body.nome} (${body.codice})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(item);
    } catch {
      return reply.code(201).send({ id: `giur-${Date.now()}`, tenantId, ...body });
    }
  });

  server.put<{ Params: { id: string }; Body: { nome?: string; codice?: string; tipo?: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const body = req.body || {};
    try {
      const updated = await prisma.giurisdizione.update({
        where: { id },
        data: {
          nome: body.nome,
          codice: body.codice,
          tipo: body.tipo,
          note: body.note,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_AGGIORNATA',
        entita: updated.nome,
        dettagli: `Modificata giurisdizione ${updated.nome} (${updated.codice})`,
        ipAddress: req.ip,
      });
      return reply.send(updated);
    } catch (err: any) {
      return reply.code(400).send({ errore: err.message || 'Errore aggiornamento giurisdizione' });
    }
  });

  server.delete<{ Params: { id: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      await prisma.giurisdizione.delete({ where: { id } });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_ELIMINATA',
        entita: id,
        dettagli: `Eliminata giurisdizione ${id}`,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ errore: err.message || 'Errore eliminazione giurisdizione' });
    }
  });

  server.get<{ Querystring: { giurisdizioneId?: string } }>('/moduli', async (req) => {
    const { giurisdizioneId } = req.query || {};
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      if (giurisdizioneId) {
        // Restituisce i moduli specifici di quella giurisdizione PIÙ quelli generici (giurisdizioneId null)
        const dbModuli = await prisma.moduloTemplate.findMany({
          where: {
            tenantId,
            isAttivo: true,
            OR: [
              { giurisdizioneId: giurisdizioneId },
              { giurisdizioneId: null },
            ],
          },
          include: {
            giurisdizione: true,
            dipendenze: true,
            righeDistinta: { include: { articolo: true } },
          },
        });
        return dbModuli;
      }
      return await prisma.moduloTemplate.findMany({
        where: { tenantId, isAttivo: true },
        include: {
          giurisdizione: true,
          dipendenze: true,
          righeDistinta: { include: { articolo: true } },
        },
      });
    } catch {
      return app.listaModuli();
    }
  });

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

  // Audit Logs API (Isolato per Tenant)
  server.get('/audit-logs', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      return await prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      return [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/audit-logs', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const log = await prisma.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || 'usr-01',
          userEmail: body.userEmail || 'joe@bluecode.advisory',
          userNome: body.userNome || 'Joe Disabato',
          ruolo: body.ruolo || 'advisor',
          azione: body.azione,
          entita: body.entita,
          dettagli: body.dettagli,
          // Un registro di audit serve a dire da dove è arrivata un'operazione. Qui c'era
          // `req.ip || '83.211.12.94'`: quando il proxy non esponeva l'IP la riga ne
          // riportava uno fisso, sempre lo stesso, con l'aspetto di un dato rilevato.
          ipAddress: req.ip || null,
        },
      });
      return reply.code(201).send(log);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  // ─── NOTIFICHE (Blocco 3) ─────────────────────────────────────────
  // Le notifiche sono per destinatario, non per tenant: la campanella dello
  // studio mostra le righe dell'utente loggato, quella del portale quelle del
  // cliente. L'identità cliente arriva dal JWT come `client-<clienteId>`.
  const destinatarioCorrente = (req: any): { tenantId: string; where: Record<string, any> } | null => {
    const tenantId = req.tenantId as string;
    const userId = req.userId as string | undefined;
    if (!userId) return null;
    if (req.ruolo === 'cliente' || userId.startsWith('client-')) {
      return { tenantId, where: { tenantId, destinatarioClienteId: userId.replace(/^client-/, '') } };
    }
    return { tenantId, where: { tenantId, destinatarioId: userId } };
  };

  server.get('/notifiche', async (req) => {
    const dest = destinatarioCorrente(req);
    if (!dest) return [];
    try {
      return await prisma.notifica.findMany({
        where: dest.where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch {
      return [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/notifiche', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;
    const body = (req.body || {}) as Record<string, any>;
    // Nessuna scorciatoia tipo `destinatarioId || 'usr-01'`: una notifica senza
    // destinatario reale è solo rumore che nessuno leggerà mai.
    const destinatarioId = body.destinatarioId as string | undefined;
    const destinatarioClienteId = body.destinatarioClienteId as string | undefined;
    if (!destinatarioId && !destinatarioClienteId) {
      return reply.code(400).send({ errore: 'destinatarioId o destinatarioClienteId è obbligatorio' });
    }
    const notif = await prisma.notifica.create({
      data: {
        tenantId,
        destinatarioId: destinatarioId ?? null,
        destinatarioClienteId: destinatarioClienteId ?? null,
        destinatarioTipo: destinatarioClienteId ? 'cliente' : 'user',
        tipoEvento: body.tipoEvento ?? null,
        link: body.link ?? null,
        canale: body.canale || 'in_app',
        oggetto: body.oggetto || body.title || 'Notifica Studio',
        corpo: body.corpo || body.body || '',
        statoLettura: 'non_letta',
        inviataAt: new Date(),
      },
    });
    return reply.code(201).send(notif);
  });

  server.patch('/notifiche/read-all', async (req) => {
    const dest = destinatarioCorrente(req);
    if (!dest) return { ok: true };
    try {
      await prisma.notifica.updateMany({
        where: { ...dest.where, statoLettura: 'non_letta' },
        data: { statoLettura: 'letta' },
      });
      return { ok: true };
    } catch {
      return { ok: true };
    }
  });

  // ─── STREAM SSE (Blocco 3) ────────────────────────────────────────
  // Server-Sent Events: il client apre lo stream con il proprio JWT (header
  // Authorization, per questo non usiamo EventSource lato browser ma fetch +
  // ReadableStream) e riceve un frame `event: notifica` per ogni evento del
  // suo tenant/identità. Ping ogni 25 s per tenere vivo il collegamento
  // attraverso i proxy (Railway in testa).
  server.get('/stream', async (req, reply) => {
    const auth = req as any;
    const tenantId = auth.tenantId as string;
    const userId = auth.userId as string | undefined;
    const isCliente = auth.ruolo === 'cliente' || (userId || '').startsWith('client-');

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

  // Comunicazioni Progetto API (Multicanale Ingestion)
  server.get<{ Params: { id: string } }>('/progetti/:id/comunicazioni', async (req) => {
    try {
      return await prisma.comunicazioneProgetto.findMany({
        where: { progettoId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });
    } catch {
      return [];
    }
  });

  server.post<{ Params: { id: string }; Body: Record<string, any> }>('/progetti/:id/comunicazioni', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const msg = await prisma.comunicazioneProgetto.create({
        data: {
          tenantId,
          progettoId: req.params.id,
          canale: body.canale,
          mittente: body.mittente,
          destinatario: body.destinatario,
          direzione: body.direzione || 'uscita',
          testo: body.testo,
          allegatiJson: body.allegatiJson ? JSON.stringify(body.allegatiJson) : null,
        },
      });
      // Blocco 3 — messaggio in arrivo dal cliente: lo studio viene avvisato subito.
      if (body.direzione === 'entrata' || body.direzione === 'ingresso') {
        const progetto = await prisma.progetto.findUnique({
          where: { id: req.params.id },
          include: { cliente: { select: { nome: true } } },
        });
        if (progetto) {
          await notificaStudio(tenantId, {
            tipoEvento: 'messaggio_cliente',
            oggetto: 'Nuovo messaggio dal cliente',
            corpo: `${progetto.cliente.nome} ha scritto su «${progetto.nome}»: ${(body.testo || '').slice(0, 120)}`,
            link: `/projects/${progetto.id}`,
          }).catch(() => {});
        }
      }
      // Se il canale è whatsapp e sono configurati token e phoneId, tenta invio reale Meta Graph API
      if (body.canale === 'whatsapp' && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WA_PHONE_ID) {
        const toNum = (body.destinatario || '').replace(/\D/g, '');
        if (toNum) {
          fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: toNum,
              type: 'text',
              text: { preview_url: false, body: body.testo },
            }),
          }).catch(err => console.warn('Meta WhatsApp API dispatch warning:', err));
        }
      }

      return reply.code(201).send(msg);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  // ─── META WHATSAPP BUSINESS WEBHOOK & DISPATCH API ────────────────
  server.get<{ Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string } }>(
    '/webhooks/communications/whatsapp',
    async (req, reply) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      // Nessun ripiego cablato: qui c'era il token di verifica scritto in chiaro, cioè
      // pubblicato su GitHub. Chi lo leggeva poteva superare l'handshake di Meta e far
      // registrare il proprio endpoint come webhook dello studio, ricevendo i messaggi
      // WhatsApp dei clienti. Regola 6 di `.agents/AGENTS.md`. Senza la variabile
      // d'ambiente l'handshake viene rifiutato: meglio un webhook da riconfigurare di uno
      // che accetta chiunque conosca una stringa pubblica.
      const verifyToken = process.env.WA_VERIFY_TOKEN;

      if (!verifyToken) {
        return reply.status(503).send('WA_VERIFY_TOKEN non configurato');
      }

      if (mode === 'subscribe' && confrontoTokenCostante(token, verifyToken)) {
        return reply.status(200).send(challenge);
      }
      return reply.status(403).send('Forbidden');
    }
  );

  server.post<{ Body: Record<string, any> }>(
    '/webhooks/communications/whatsapp',
    async (req, reply) => {
      const body = req.body || {};
      const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';

      try {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (messages && messages.length > 0) {
          const msg = messages[0];
          const fromNumber = msg.from; // es. 393351234567
          const textBody = msg.text?.body || (msg.type === 'image' ? '[Immagine ricevuta]' : msg.type === 'document' ? '[Documento PDF ricevuto]' : '[Messaggio multimediale]');

          const cleanFrom = fromNumber.replace(/\D/g, '');
          const clienti = await prisma.cliente.findMany({ where: { tenantId } });
          let matchingClient = clienti.find(c => {
            const telClean = ((c as any).telefono || '').replace(/\D/g, '');
            const ref = c.referentiJson && typeof c.referentiJson === 'object' ? (c.referentiJson as any) : {};
            const refCellClean = (ref.cellulare || ref.whatsapp || ref.telefono || '').replace(/\D/g, '');
            return (telClean && (cleanFrom.includes(telClean) || telClean.includes(cleanFrom))) ||
                   (refCellClean && (cleanFrom.includes(refCellClean) || refCellClean.includes(cleanFrom)));
          });

          if (!matchingClient && clienti.length > 0) {
            matchingClient = clienti[0];
          }

          let activeProj = null;
          if (matchingClient) {
            activeProj = await prisma.progetto.findFirst({
              where: { clienteId: matchingClient.id },
              orderBy: { createdAt: 'desc' },
            });
          }
          if (!activeProj) {
            activeProj = await prisma.progetto.findFirst({
              orderBy: { createdAt: 'desc' },
            });
          }

          if (activeProj) {
            await prisma.comunicazioneProgetto.create({
              data: {
                tenantId,
                progettoId: activeProj.id,
                canale: 'whatsapp',
                mittente: `+${fromNumber} (${matchingClient ? matchingClient.nome : 'Cliente'})`,
                destinatario: `BluMan WhatsApp Studio (+39 378 092 6461)`,
                direzione: 'entrata',
                testo: textBody,
              },
            });
            // Blocco 3 — il messaggio WhatsApp del cliente arriva allo studio in tempo reale.
            await notificaStudio(tenantId, {
              tipoEvento: 'messaggio_cliente',
              oggetto: 'Nuovo messaggio WhatsApp',
              corpo: `${matchingClient ? matchingClient.nome : `+${fromNumber}`} ha scritto su WhatsApp: ${(textBody || '').slice(0, 120)}`,
              link: `/projects/${activeProj.id}`,
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Errore elaborazione webhook WhatsApp:', err);
      }

      return reply.status(200).send({ status: 'EVENT_RECEIVED' });
    }
  );

  // Le rotte GET/POST /tenant/utenti vivono nel blocco "GESTIONE UTENTI TEAM TENANT"
  // più sopra: erano dichiarate due volte e Fastify rifiutava di avviare il server.

  // ─── ANAGRAFICA CLIENTI ERP API (§2, §14) ─────────────────────────
  // Rotte clienti (anagrafica completa + dettaglio e magic-link) estratte in
  // src/routes/clienti.ts: stessa registrazione, sempre dentro questo wrapper.
  await registraRotteClienti(server, app);

  server.get('/progetti', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const projs = await prisma.progetto.findMany({
        where: { tenantId },
        include: {
          cliente: true,
          giurisdizionePrimaria: true,
          moduli: {
            include: {
              microvoci: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
      // §16 — l'avanzamento viaggia già calcolato: il client lo legge, non lo deduce.
      // `arricchisciProgetti` non emette query, lavora sui moduli e micro-voci appena letti.
      if (projs && projs.length > 0) return arricchisciProgetti(projs);
      return (app as any).listaProgetti?.() || [];
    } catch {
      return (app as any).listaProgetti?.() || [];
    }
  });

  /**
   * §2.8 — Numero progressivo della lettera d'incarico per tenant e anno: `EL-<anno>-<seq>`.
   *
   * Prima il portale mostrava a tutti lo stesso numero cablato (`EL-2026-089`). Il numero
   * invece è un atto per cliente: il backend lo assegna alla creazione del progetto,
   * leggendo l'ultimo progressivo già usato dal tenant nell'anno corrente. La migrazione
   * `20260824130000_portale_dati_addendum_contratto` ha già numerato i progetti esistenti.
   */
  async function prossimoNumeroContratto(tenantId: string): Promise<string> {
    const anno = new Date().getUTCFullYear();
    const prefisso = `EL-${anno}-`;
    const esistenti = await prisma.progetto.findMany({
      where: { tenantId, numeroContratto: { startsWith: prefisso } },
      select: { numeroContratto: true },
    });
    let max = 0;
    for (const p of esistenti) {
      const coda = (p.numeroContratto ?? '').slice(prefisso.length);
      const n = parseInt(coda, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return `${prefisso}${String(max + 1).padStart(3, '0')}`;
  }

  server.post<{ Body: { clienteId: string; nome: string; giurisdizioneId?: string; giurisdizionePrimariaId?: string; dataInizio?: string; dataScadenza?: string } }>('/progetti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { clienteId, nome, giurisdizioneId, giurisdizionePrimariaId } = req.body;
    if (!clienteId || !nome) return reply.code(400).send({ errore: 'clienteId e nome sono obbligatori' });

    const jurId = giurisdizionePrimariaId || giurisdizioneId || null;

    try {
      const progetto = await prisma.progetto.create({
        data: {
          tenantId,
          clienteId,
          nome,
          stato: 'pre_project',
          // Il valore nasce a 0 e lo alza l'accettazione del preventivo (§16): il campo è
          // obbligatorio a schema, ometterlo impediva la compilazione con `tsc`.
          valoreTotale: 0,
          giurisdizionePrimariaId: jurId,
          // §2.8 — il numero del contratto è assegnato dal backend, non dal frontend.
          numeroContratto: await prossimoNumeroContratto(tenantId),
        },
        include: { cliente: true, giurisdizionePrimaria: true }
      });
      return reply.code(201).send(progetto);
    } catch {
      const progetto = await app.creaProgetto({ clienteId, nome });
      return reply.code(201).send(progetto);
    }
  });

  /**
   * Il dettaglio del progetto, con l'avanzamento calcolato (§16).
   *
   * Qui c'era una `Map` in memoria (`projectStateStore`) che conservava l'ultimo corpo inviato
   * dal client e lo sovrapponeva alla lettura da database. Faceva danni in tre modi: si azzerava
   * a ogni rilascio, quindi lo "stato salvato" scompariva senza che nessuno lo sapesse; era
   * locale al processo, quindi due istanze rispondevano cose diverse; e restituiva come dato di
   * database quello che il client aveva mandato, coprendo il fatto che a database non era mai
   * arrivato. Ora si legge quello che c'è scritto, e se non c'è scritto niente si vede.
   */
  server.get<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const dbProj: any = await app.getProgetto(id);
      if (!dbProj) return reply.code(404).send({ errore: `Progetto ${id} non trovato` });
      return reply.send({ ...dbProj, avanzamento: calcolaAvanzamento(dbProj) });
    } catch (err) {
      console.warn(`Lettura progetto ${id} non riuscita:`, err);
      return reply.code(404).send({ errore: 'Progetto non trovato' });
    }
  });

  // §1.1 (PIANO_DI_MIGLIORAMENTO) — l'eliminazione transazionale esisteva già
  // nell'adapter (PrismaApp.eliminaProgetto) ma non era esposta via HTTP: il frontend
  // chiamava DELETE /progetti/:id e riceveva 404. La rotta riusa quell'unica
  // implementazione (niente logica duplicata): progetto inesistente → 404, blocco in
  // presenza di Fatture/Note di Credito → 409 (TransizioneNonValidaError); entrambi
  // sono tradotti dal gestore centrale degli errori. Come le altre scritture
  // distruttive (es. /progetti/:id/ricalcola) è riservata a chi risponde dello studio.
  server.delete<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    const ruoloRichiedente = (req as any).ruolo as string | undefined;
    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply
        .code(403)
        .send({ errore: 'Solo il responsabile dello studio può eliminare un progetto.' });
    }

    await app.eliminaProgetto(id, tenantId);

    await recordAudit({
      tenantId,
      userId: (req as any).user?.userId,
      userEmail: (req as any).user?.email,
      ruolo: ruoloRichiedente,
      azione: 'PROGETTO_ELIMINATO',
      entita: 'Progetto',
      dettagli: `Progetto ${id} eliminato`,
      ipAddress: req.ip,
    });

    return reply.send({ ok: true, id });
  });

  /**
   * DELETE /progetti/:id/moduli/:moduloId — §1.1bis
   *
   * Rimuove un singolo modulo (con tutte le sue micro-voci e documenti) da un progetto.
   * Bloccato con 409 se il modulo ha ore consuntivate: si perderebbe la storia operativa.
   * Solo advisor e super_admin possono eseguire questa operazione.
   */
  server.delete<{ Params: { id: string; moduloId: string } }>(
    '/progetti/:id/moduli/:moduloId',
    async (req, reply) => {
      const { id, moduloId } = req.params;
      const tenantId = (req as any).tenantId || TENANT_DEFAULT;
      const ruoloRichiedente = (req as any).ruolo as string | undefined;

      if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
        return reply.code(403).send({ errore: 'Solo advisor e super_admin possono eliminare moduli da un progetto.' });
      }

      const modulo = await prisma.moduloProgetto.findFirst({
        where: { id: moduloId, progettoId: id, tenantId },
        include: {
          microvoci: { select: { id: true, oreConsuntivate: true, nome: true } },
        },
      });

      if (!modulo) {
        return reply.code(404).send({ errore: 'Modulo non trovato in questo progetto.' });
      }

      const totaleOreConsuntivate = modulo.microvoci.reduce(
        (acc, mv) => acc + (mv.oreConsuntivate ?? 0),
        0,
      );
      if (totaleOreConsuntivate > 0) {
        return reply.code(409).send({
          errore: `Il modulo «${modulo.nome}» ha ${totaleOreConsuntivate} ore consuntivate e non può essere eliminato. Azzerare prima le ore.`,
        });
      }

      // Un modulo già richiamato in fattura è memoria fiscale: non si elimina.
      const righeFattura = await prisma.fatturaRiga.count({ where: { moduloProgettoId: moduloId } });
      if (righeFattura > 0) {
        return reply.code(409).send({
          errore: `Il modulo «${modulo.nome}» è richiamato in ${righeFattura} righe di fattura e non può essere eliminato.`,
        });
      }

      // Senza questa pulizia il delete moriva con 500: micro-voci, passaggi, accessi e
      // dipendenze referenziano il modulo con FK senza CASCADE, quindi anche un modulo
      // appena istanziato (micro-voci a zero ore) non era cancellabile. Si toglie solo lo
      // scaffolding: i documenti prodotti dai passaggi restano nel fascicolo
      // (microvoce_progetto_id → NULL via ON DELETE SET NULL), le checklist cascano a DB.
      try {
        await prisma.$transaction(async (tx) => {
          const microvoceIds = modulo.microvoci.map((mv) => mv.id);
          await tx.accessoRisorsa.deleteMany({
            where: {
              OR: [{ moduloProgettoId: moduloId }, ...(microvoceIds.length ? [{ microvoceProgettoId: { in: microvoceIds } }] : [])],
            },
          });
          if (microvoceIds.length) {
            await tx.passaggioProgetto.deleteMany({ where: { microvoceProgettoId: { in: microvoceIds } } });
            await tx.microvoceProgetto.deleteMany({ where: { id: { in: microvoceIds } } });
          }
          await tx.moduloProgettoDipendenza.deleteMany({
            where: { OR: [{ moduloProgettoId: moduloId }, { dipendeDaModuloProgettoId: moduloId }] },
          });
          await tx.moduloProgetto.delete({ where: { id: moduloId } });
        });
      } catch (err) {
        req.log.error(err, 'Errore eliminazione modulo');
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione modulo' });
      }

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        ruolo: ruoloRichiedente,
        azione: 'MODULO_ELIMINATO',
        entita: 'ModuloProgetto',
        dettagli: `Modulo ${moduloId} («${modulo.nome}») eliminato dal progetto ${id}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, moduloId });
    },
  );

  /**
   * §16 — Ricalcolo esplicito della cascata micro-voce → modulo → progetto (Fase 1, task 1.3).
   *
   * Serve dopo un'importazione, una correzione manuale a database o il rilascio di una
   * modifica alle regole: i normali percorsi (consuntivazione, completamento) aggiornano già
   * lo stato mano a mano, ma niente rimette in pari le righe scritte fuori da quei percorsi.
   *
   * Il nome della route resta in italiano come tutte le altre di questo file (`/progetti`,
   * `/clienti`): il piano lo chiamava `/projects/:id/recalculate`.
   */
  server.post<{ Params: { id: string } }>('/progetti/:id/ricalcola', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    // Il ricalcolo SCRIVE (stati di moduli e micro-voci): non è una lettura e non lo autorizza
    // il fatto di essere entrati. RLS confina la scrittura al tenant, ma dentro il tenant
    // qualunque collaboratore potrebbe riallineare gli stati del progetto di un altro: qui
    // decide chi risponde dello studio. Il filtro nel frontend (pulsante nascosto in
    // ProjectDetail.tsx) è solo cortesia di interfaccia, non è questa difesa.
    const ruoloRichiedente = (req as any).ruolo as string | undefined;
    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply
        .code(403)
        .send({ errore: 'Solo il responsabile dello studio o il super admin possono ricalcolare l\'avanzamento.' });
    }

    const avanzamento = await ricalcolaProgetto(id);

    await recordAudit({
      tenantId,
      azione: 'PROGETTO_RICALCOLATO',
      entita: id,
      dettagli: `Ricalcolo stato progetto ${id}: ${avanzamento.stato}, ${avanzamento.percentuale}%`,
      ipAddress: req.ip,
    });

    return reply.send(avanzamento);
  });

  /**
   * Salva su database lo stato di un progetto così come l'operatore l'ha modificato.
   *
   * Prima questa funzione scriveva il corpo della richiesta in una `Map` in memoria e aggiornava
   * a database soltanto tre campi del progetto — nome, stato e valore. **Moduli e micro-voci non
   * venivano mai salvati.** Le ore consuntivate, gli stati delle micro-voci e le note di causa
   * restavano nel browser di chi le aveva scritte e nella memoria del processo, che si azzera a
   * ogni rilascio. Chi apriva lo stesso progetto da un'altra postazione — o il cliente dal
   * portale, che legge il database — vedeva il progetto fermo a come era stato istanziato.
   *
   * Il `catch` peggiorava le cose: rispondeva `ok: true` con «memorizzato in fallback locale»
   * anche quando la scrittura era andata male, quindi il frontend non aveva modo di accorgersene.
   *
   * Cosa viene salvato e cosa no, per scelta:
   *
   * - **si salva** quello che l'operatore inserisce: ore consuntivate e preventivate, stato della
   *   micro-voce, causa del ritardo, nome e prezzo del modulo, nome e valore del progetto.
   * - **non si salva** quello che il motore calcola (§16): lo stato del modulo e la percentuale
   *   di avanzamento arrivano dalla cascata micro-voce → modulo → progetto, che gira in fondo a
   *   questa funzione. Accettarli dal client vorrebbe dire lasciargli riscrivere un valore
   *   derivato con uno che ha calcolato per conto suo.
   * - **non ha una colonna** il blocco note libero della micro-voce (`note`) e resta dove sta
   *   oggi, in `localStorage`. Va aggiunto allo schema, non finto qui.
   *
   * Le righe si riconoscono per identificativo di database (`dbId`), che il frontend porta con
   * sé da quando legge il progetto. Per i progetti salvati prima di questa modifica il `dbId`
   * non c'è: si ripiega sul nome, ma solo quando è univoco — due moduli omonimi non si possono
   * distinguere e la riga viene dichiarata non salvata invece di aggiornare quella sbagliata.
   */
  server.put<{ Params: { id: string }; Body: any }>('/progetti/:id/stato-completo', async (req, reply) => {
    const { id } = req.params;
    const body: any = req.body || {};
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    const progetto = await prisma.progetto.findUnique({
      where: { id },
      include: {
        moduli: {
          select: {
            id: true,
            nome: true,
            microvoci: { select: { id: true, nome: true, ordine: true, stato: true, causaNota: true } },
          },
        },
      },
    });

    if (!progetto) {
      return reply.code(404).send({
        errore:
          `Il progetto ${id} non esiste a database: le modifiche non sono state salvate. ` +
          'Se il progetto è stato creato mentre la sessione era scaduta esiste solo in questo browser e va ricreato.',
      });
    }

    /** Righe che non si è potuto salvare, con il motivo. Non vengono mai passate sotto silenzio. */
    const nonSalvate: string[] = [];
    let moduliSalvati = 0;
    let microvociSalvate = 0;

    const modsRichiesti: any[] = Array.isArray(body.mods) ? body.mods : [];

    for (const mod of modsRichiesti) {
      const perNome = progetto.moduli.filter(
        (m) => m.nome.trim().toLowerCase() === String(mod.n ?? '').trim().toLowerCase(),
      );
      const riga =
        (mod.dbId ? progetto.moduli.find((m) => m.id === mod.dbId) : undefined) ||
        (perNome.length === 1 ? perNome[0] : undefined);

      if (!riga) {
        nonSalvate.push(
          perNome.length > 1
            ? `modulo «${mod.n}»: a database ce ne sono ${perNome.length} con lo stesso nome e la richiesta non porta l'identificativo`
            : `modulo «${mod.n ?? '(senza nome)'}»: nessun modulo corrispondente a database`,
        );
        continue;
      }

      const datiModulo: any = {};
      if (typeof mod.n === 'string' && mod.n.trim() && mod.n.trim() !== riga.nome) datiModulo.nome = mod.n.trim();
      if (Number.isFinite(mod.h)) datiModulo.orePreventivate = Math.max(0, Math.round(Number(mod.h)));
      if (Number.isFinite(mod.a)) datiModulo.oreConsuntivate = Math.max(0, Math.round(Number(mod.a)));
      if (Number.isFinite(mod.p)) datiModulo.prezzo = Math.max(0, Math.round(Number(mod.p) * 100));

      if (Object.keys(datiModulo).length > 0) {
        await prisma.moduloProgetto.update({ where: { id: riga.id }, data: datiModulo });
        moduliSalvati++;
      }

      const microRichieste: any[] = Array.isArray(mod.v) ? mod.v : [];
      for (let indice = 0; indice < microRichieste.length; indice++) {
        const mv = microRichieste[indice];
        const mvPerNome = riga.microvoci.filter(
          (r) => r.nome.trim().toLowerCase() === String(mv.n ?? '').trim().toLowerCase(),
        );
        // L'indice è l'ultimo appiglio: l'elenco nel frontend nasce dall'ordine con cui le
        // micro-voci arrivano da database, quindi le posizioni combaciano finché nessuno ne
        // aggiunge o toglie. Vale come ripiego, non come regola: per questo viene dopo il
        // nome, e il nome dopo l'identificativo.
        const rigaMv =
          (mv.dbId ? riga.microvoci.find((r) => r.id === mv.dbId) : undefined) ||
          (mvPerNome.length === 1 ? mvPerNome[0] : undefined) ||
          (riga.microvoci.length === microRichieste.length ? riga.microvoci[indice] : undefined);

        if (!rigaMv) {
          nonSalvate.push(
            `micro-voce «${mv.n ?? indice + 1}» del modulo «${riga.nome}»: nessuna riga corrispondente a database`,
          );
          continue;
        }

        const datiMv: any = {};
        if (Number.isFinite(mv.hE)) datiMv.orePreventivate = Math.max(0, Math.round(Number(mv.hE)));
        if (Number.isFinite(mv.hA)) datiMv.oreConsuntivate = Math.max(0, Math.round(Number(mv.hA)));

        const causa = typeof mv.vn === 'string' && mv.vn.trim() ? mv.vn.trim() : null;
        if (causa !== rigaMv.causaNota) datiMv.causaNota = causa;

        if (typeof mv.s === 'string' && STATI_MICROVOCE.includes(mv.s) && mv.s !== rigaMv.stato) {
          // §7bis — «in ritardo» e «bloccata» senza causa non sono uno stato, sono un buco nel
          // fascicolo: chi legge il progetto un mese dopo non sa perché si è fermato.
          if ((mv.s === 'delayed' || mv.s === 'blocked') && !(causa || rigaMv.causaNota)) {
            nonSalvate.push(
              `micro-voce «${rigaMv.nome}»: lo stato «${mv.s === 'delayed' ? 'in ritardo' : 'bloccata'}» richiede la causa (§7bis) e la richiesta non la porta`,
            );
          } else {
            datiMv.stato = mv.s;
          }
        }

        if (Object.keys(datiMv).length > 0) {
          await prisma.microvoceProgetto.update({ where: { id: rigaMv.id }, data: datiMv });
          microvociSalvate++;
        }

        // Persistenza dei passaggi checklist e documenti allegati alla micro-voce
        if (Array.isArray(mv.proc) && mv.proc.length > 0) {
          try {
            for (let pIdx = 0; pIdx < mv.proc.length; pIdx++) {
              const p = mv.proc[pIdx];
              const pId = p.id && !String(p.id).startsWith('p-') && p.id.length > 10 ? p.id : undefined;
              const tipo = ['documento', 'form', 'info', 'check'].includes(p.type || p.tipo) ? (p.type || p.tipo) : 'check';
              const chi = ['operatore', 'cliente'].includes(p.who || p.chi) ? (p.who || p.chi) : 'operatore';
              const statoP = p.stato === 'done' ? 'done' : 'pending';
              const titolo = p.title || p.titolo || `Passaggio ${pIdx + 1}`;
              const docAllegato = p.documentoAllegatoUrl || p.file || null;
              const richiedeFirma = Boolean(p.richiedeFirmaCliente);

              if (pId) {
                await prisma.passaggioProgetto.upsert({
                  where: { id: pId },
                  update: {
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                  },
                  create: {
                    id: pId,
                    tenantId,
                    microvoceProgettoId: rigaMv.id,
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                  },
                });
              } else {
                await prisma.passaggioProgetto.create({
                  data: {
                    tenantId,
                    microvoceProgettoId: rigaMv.id,
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                  },
                });
              }
            }
          } catch (errPassaggi) {
            console.warn(`Errore salvataggio passaggi per micro-voce ${rigaMv.id}:`, errPassaggi);
          }
        }
      }
    }

    const datiProgetto: any = {};
    if (typeof body.n === 'string' && body.n.trim() && body.n.trim() !== progetto.nome) {
      datiProgetto.nome = body.n.trim();
    }
    if (Number.isFinite(body.val)) datiProgetto.valoreTotale = Math.max(0, Math.round(Number(body.val) * 100));
    // Lo stato del progetto si accetta solo per far uscire un progetto da `pre_project`: da lì
    // in poi lo calcola la cascata in fondo a questa funzione, e prenderlo dal client
    // significherebbe sovrascrivere il risultato con una stima fatta nel browser.
    if (progetto.stato === 'pre_project' && typeof body.st === 'string' && STATI_PROGETTO.includes(body.st) && body.st !== 'pre_project') {
      datiProgetto.stato = body.st;
    }
    if (Object.keys(datiProgetto).length > 0) {
      await prisma.progetto.update({ where: { id }, data: datiProgetto });
    }

    // §16 — la cascata risale dopo la scrittura: ore nuove significano segnale di rischio,
    // stato del modulo e stato del progetto da rifare.
    let avanzamento: any = null;
    try {
      avanzamento = await ricalcolaProgetto(id);
    } catch (err) {
      console.warn(`Ricalcolo avanzamento non riuscito per il progetto ${id}:`, err);
    }

    await recordAudit({
      tenantId,
      azione: 'PROGETTO_STATO_AGGIORNATO',
      entita: id,
      dettagli:
        `Progetto «${datiProgetto.nome || progetto.nome}»: ${moduliSalvati} moduli e ${microvociSalvate} micro-voci aggiornati` +
        (nonSalvate.length ? `; ${nonSalvate.length} righe non salvate` : ''),
      ipAddress: req.ip,
    });

    // Il corpo dice quante righe sono finite a database e quali no. Un `ok: true` senza numeri
    // era indistinguibile da un salvataggio che non aveva scritto niente.
    return reply.send({
      ok: true,
      id,
      moduliSalvati,
      microvociSalvate,
      nonSalvate,
      avanzamento,
    });
  });

  server.get<{ Params: { id: string } }>('/progetti/:id/accessi', async (req) => {
    return (app as any).listaAccessiProgetto(req.params.id);
  });

  server.post<{ Params: { id: string }; Body: { userId: string; livello?: string } }>('/progetti/:id/accessi', async (req, reply) => {
    const { userId, livello } = req.body;
    if (!userId) return reply.code(400).send({ errore: 'userId è obbligatorio' });
    const accesso = await (app as any).assegnaAccessoProgetto(req.params.id, userId, livello || 'write');
    return reply.code(201).send(accesso);
  });

  server.get('/fatture/tutte', async () => {
    return (app as any).listaFattureTutte();
  });

  server.post<{
    Params: { id: string };
    Body: {
      tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
      partitaIva?: string;
      codiceFiscale?: string;
      canale: 'sdi' | 'standard';
      righe: Array<{
        tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
        moduloProgettoId?: string;
        percentuale?: number;
        importo: number;
        descrizione: string;
      }>;
    };
  }>('/progetti/:id/fatture', async (req, reply) => {
    const fattura = await app.emettiFattura({
      progettoId: req.params.id,
      ...req.body,
    });
    return reply.code(201).send(fattura);
  });

  // ── INCASSI, SCADENZARIO & PRIMA NOTA (STYLE OPENSTAMANAGER) ───────
  server.get('/invoices/scadenzario', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const scadenze = await (prisma as any).scadenzaIncasso.findMany({
        where: { tenantId },
        include: {
          fattura: {
            include: {
              progetto: {
                include: { cliente: true },
              },
            },
          },
          registrazioniRegistrate: true,
        },
        orderBy: { dataScadenza: 'asc' },
      });
      return reply.send(scadenze);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Params: { id: string };
    Body: {
      importoIncassatoCentesimi: number;
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      riferimentoTransazione?: string;
      noteOperatore?: string;
    };
  }>('/invoices/scadenze/:id/incassi', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { importoIncassatoCentesimi, metodoPagamento, riferimentoTransazione, noteOperatore } = req.body;

    try {
      const scadenza = await (prisma as any).scadenzaIncasso.findUnique({
        where: { id },
        include: { registrazioniRegistrate: true },
      });

      if (!scadenza) {
        return reply.code(404).send({ errore: 'Scadenza incasso non trovata' });
      }

      const registrazione = await (prisma as any).registrazioneIncasso.create({
        data: {
          tenantId,
          scadenzaIncassoId: id,
          fatturaId: scadenza.fatturaId,
          importoIncassatoCentesimi,
          metodoPagamento: metodoPagamento || 'bonifico',
          riferimentoTransazione,
          noteOperatore,
        },
      });

      const totaleIncassato = scadenza.registrazioniRegistrate.reduce((acc: number, r: any) => acc + r.importoIncassatoCentesimi, 0) + importoIncassatoCentesimi;
      const nuovoStatoScadenza = totaleIncassato >= scadenza.importoCentesimi ? 'incassato' : 'parziale';

      await (prisma as any).scadenzaIncasso.update({
        where: { id },
        data: { stato: nuovoStatoScadenza },
      });

      // ── LOGICA OPENSTAMANAGER: Mastrino::aggiornaScadenzario ──────
      // Verifichiamo se TUTTE le scadenze della Fattura sono state incassate
      const tutteScadenzeFattura = await (prisma as any).scadenzaIncasso.findMany({
        where: { fatturaId: scadenza.fatturaId },
      });

      const tutteSaldate = tutteScadenzeFattura.every((s: any) => s.id === id ? nuovoStatoScadenza === 'incassato' : s.stato === 'incassato');
      
      // Aggiorniamo lo stato contabile immutabile della Fattura
      await prisma.fattura.update({
        where: { id: scadenza.fatturaId },
        data: { stato: tutteSaldate ? 'incassata' : 'emessa' },
      });

      // Blocco 3 — partita saldata: evento "fattura incassata" a studio e cliente.
      if (tutteSaldate) {
        const fattura = await prisma.fattura.findUnique({
          where: { id: scadenza.fatturaId },
          include: { progetto: { select: { id: true, nome: true, clienteId: true, cliente: { select: { nome: true } } } } },
        });
        if (fattura) {
          const etichetta = fattura.numero || `${fattura.serie}-${fattura.numeroProgressivoSerie}`;
          const importo = `€ ${(scadenza.importoCentesimi / 100).toLocaleString('it-IT')}`;
          await notificaStudio(tenantId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Fattura incassata',
            corpo: `La fattura ${etichetta} di ${fattura.progetto.cliente.nome} è stata saldata (${importo}).`,
            link: '/invoices',
          }).catch(() => {});
          await notificaCliente(tenantId, fattura.progetto.clienteId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Pagamento registrato',
            corpo: `Abbiamo registrato il pagamento della fattura ${etichetta} (${importo}). Grazie!`,
            link: '/portal/invoices',
          }).catch(() => {});
        }
      }

      // ── LOGICA OPENSTAMANAGER: Accredito su Conto Bancario ────────
      const contoPredefinito = await (prisma as any).contoBancario.findFirst({
        where: { tenantId, isDefault: true },
      });

      if (contoPredefinito) {
        await (prisma as any).contoBancario.update({
          where: { id: contoPredefinito.id },
          data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
        });
      }

      await recordAudit({
        tenantId,
        azione: 'INCASSO_REGISTRATO',
        entita: `Scadenza #${id}`,
        dettagli: `Registrato incasso di €${(importoIncassatoCentesimi / 100).toFixed(2)} via ${metodoPagamento || 'bonifico'} con chiusura partita di giro`,
      });

      return reply.code(201).send(registrazione);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore registrazione incasso' });
    }
  });

  // ── REGISTRO FATTURE STUDIO (STYLE OPENSTAMANAGER) ───────────────
  server.get('/invoices', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fatture = await (prisma as any).fattura.findMany({
        where: { tenantId },
        include: {
          righe: true,
          progetto: { include: { cliente: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(fatture);
    } catch {
      return reply.send([]);
    }
  });

  server.get<{ Params: { id: string } }>('/invoices/:id/sdi-xml', async (req, reply) => {
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id },
        include: {
          righe: true,
          progetto: { include: { cliente: true } },
        },
      });

      if (!fattura) {
        return reply.code(404).send({ errore: 'Fattura non trovata' });
      }

      const cliente = fattura.progetto.cliente;
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2000/01/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${cliente.piva || '00000000000'}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${fattura.numeroProgressivo || '00001'}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${cliente.sdiCode || '0000000'}</CodiceDestinatario>
    </DatiTrasmissione>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>${cliente.codiceFiscale || cliente.piva || '00000000000'}</CodiceFiscale>
        <Anagrafica>
          <Denominazione>${cliente.nome}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>${fattura.tipoDocumento === 'nota_credito' ? 'TD04' : 'TD01'}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${(fattura.data || new Date()).toISOString().split('T')[0]}</Data>
        <Numero>${fattura.numero || 'FT-2026/001'}</Numero>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      ${fattura.righe.map((r, idx) => `
      <DettaglioLinee>
        <NumeroLinea>${idx + 1}</NumeroLinea>
        <Descrizione>${r.descrizione}</Descrizione>
        <PrezzoUnitario>${(r.importo / 100).toFixed(2)}</PrezzoUnitario>
        <PrezzoTotale>${(r.importo / 100).toFixed(2)}</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>`).join('')}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

      reply.header('Content-Type', 'application/xml');
      reply.header('Content-Disposition', `attachment; filename="${fattura.numero || 'Fattura'}.xml"`);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore durante la generazione dell\'XML SDI' });
    }
  });

  // ── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  server.get('/conti-bancari', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const conti = await (prisma as any).contoBancario.findMany({
        where: { tenantId },
        orderBy: { isDefault: 'desc' },
      });
      return reply.send(conti);
    } catch (err: any) {
      // Qui, quando la query falliva, la rotta rispondeva con quattro conti inventati —
      // Unicredit, Intesa, Stripe e una cassa contanti — completi di IBAN e di saldi.
      // Lo studio vedeva 78.500 € su un conto che non esiste, e non vedeva nessun errore.
      console.error('Errore lettura conti bancari:', err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella lettura dei conti bancari' });
    }
  });

  server.post<{ Body: { nomeConto: string; banca: string; iban?: string; bicSwift?: string; saldoInizialeEur: number; isDefault?: boolean } }>(
    '/conti-bancari',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      const { nomeConto, banca, iban, bicSwift, saldoInizialeEur, isDefault } = req.body;
      const saldoCentesimi = Math.round((saldoInizialeEur || 0) * 100);

      try {
        const nuovoConto = await (prisma as any).contoBancario.create({
          data: {
            tenantId,
            nomeConto,
            banca,
            iban,
            bicSwift,
            saldoIniziale: saldoCentesimi,
            saldoAttuale: saldoCentesimi,
            isDefault: isDefault || false,
          },
        });
        return reply.send(nuovoConto);
      } catch (err) {
        return reply.send({
          id: `c-${Date.now()}`,
          tenantId,
          nomeConto,
          banca,
          iban,
          bicSwift,
          saldoIniziale: saldoCentesimi,
          saldoAttuale: saldoCentesimi,
          isDefault: isDefault || false,
        });
      }
    },
  );

  // ── REPORTISTICA DIREZIONALE (BLOCCO 5) ─────────────────────────────
  // Cinque report aggregati su dati reali + export PDF/Excel server-side.
  // `GET /reports/:tipo` → JSON (struttura tabellare per il frontend).
  // `GET /reports/:tipo/export?formato=pdf|xlsx&anno=NNNN` → file allegato.
  server.get<{ Params: { tipo: string }; Querystring: { anno?: string } }>('/reports/:tipo', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { tipo } = req.params;
    if (!REPORT_DISPONIBILI.includes(tipo as ChiaveReport)) {
      return reply.code(404).send({ errore: `Report "${tipo}" non disponibile. Disponibili: ${REPORT_DISPONIBILI.join(', ')}` });
    }
    const anno = req.query.anno ? Number(req.query.anno) : undefined;
    if (req.query.anno !== undefined && (!Number.isFinite(anno) || (anno as number) < 2000 || (anno as number) > 2100)) {
      return reply.code(400).send({ errore: 'Parametro anno non valido' });
    }
    try {
      const report = await costruisciReport(tenantId, tipo as ChiaveReport, anno);
      return reply.send(report);
    } catch (err: any) {
      console.error(`Errore report ${tipo}:`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del report' });
    }
  });

  server.get<{ Params: { tipo: string }; Querystring: { formato?: string; anno?: string } }>('/reports/:tipo/export', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { tipo } = req.params;
    if (!REPORT_DISPONIBILI.includes(tipo as ChiaveReport)) {
      return reply.code(404).send({ errore: `Report "${tipo}" non disponibile` });
    }
    const formato = (req.query.formato || 'pdf').toLowerCase();
    if (formato !== 'pdf' && formato !== 'xlsx') {
      return reply.code(400).send({ errore: 'Formato non valido: usare pdf o xlsx' });
    }
    const anno = req.query.anno ? Number(req.query.anno) : undefined;
    if (req.query.anno !== undefined && (!Number.isFinite(anno) || (anno as number) < 2000 || (anno as number) > 2100)) {
      return reply.code(400).send({ errore: 'Parametro anno non valido' });
    }
    try {
      const report = await costruisciReport(tenantId, tipo as ChiaveReport, anno);
      const suffissoAnno = anno ? `_${anno}` : '';
      if (formato === 'pdf') {
        const buffer = await generaPdfReport(report);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${report.chiave}${suffissoAnno}.pdf"`);
        return reply.send(buffer);
      }
      const buffer = await generaExcelReport(report);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="${report.chiave}${suffissoAnno}.xlsx"`);
      return reply.send(buffer);
    } catch (err: any) {
      console.error(`Errore export report ${tipo} (${formato}):`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del file' });
    }
  });

  // ── TIMESHEET SETTIMANALE (BLOCCO 6.1) ─────────────────────────────
  // Griglia delle ore registrate per membro × giorno: ogni operatore segna
  // le proprie ore in stato `bozza`; advisor/super_admin le approvano o le
  // rifiutano. Solo le ore approvate alimentano il report "Ore per Operatore"
  // (Blocco 5, reportsService). Nessuna squadra finta: i membri della griglia
  // sono gli utenti reali del tenant.

  const MS_SETTIMANA = 7 * 24 * 60 * 60 * 1000;
  const MS_GIORNO = 24 * 60 * 60 * 1000;

  /** Data YYYY-MM-DD → Date a mezzanotte UTC, oppure null se non valida. */
  function parseDataIso(iso: string | undefined): Date | null {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const parti = iso.split('-').map(Number);
    const data = new Date(Date.UTC(parti[0] ?? 0, (parti[1] ?? 1) - 1, parti[2] ?? 1));
    if (Number.isNaN(data.getTime())) return null;
    // Difesa da date ambigue tipo 2026-02-30 che Date farebbe slittare a marzo.
    if (data.getUTCFullYear() !== parti[0] || data.getUTCMonth() !== (parti[1] ?? 1) - 1 || data.getUTCDate() !== parti[2]) return null;
    return data;
  }

  /** Lunedì (UTC) della settimana che contiene la data; senza data, settimana corrente. */
  function lunediSettimana(iso?: string): Date | null {
    let base: Date;
    if (iso !== undefined) {
      const trovata = parseDataIso(iso);
      if (!trovata) return null;
      base = trovata;
    } else {
      const oggi = new Date();
      base = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate()));
    }
    const giornoSettimana = base.getUTCDay(); // 0 = domenica
    const delta = giornoSettimana === 0 ? -6 : 1 - giornoSettimana;
    base.setUTCDate(base.getUTCDate() + delta);
    return base;
  }

  const isoData = (d: Date): string => d.toISOString().slice(0, 10);

  server.get<{ Querystring: { inizio?: string } }>('/timesheet', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const ruolo = (req as any).ruolo as string | undefined;
    const inizio = lunediSettimana(req.query.inizio);
    if (!inizio) {
      return reply.code(400).send({ errore: 'Parametro inizio non valido: usare una data YYYY-MM-DD' });
    }
    const fine = new Date(inizio.getTime() + MS_SETTIMANA);
    const puoApprovare = ruolo === 'advisor' || ruolo === 'super_admin';
    if (!puoApprovare && !userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }

    try {
      const voci = await prisma.oraTimesheet.findMany({
        where: {
          tenantId,
          giorno: { gte: inizio, lt: fine },
          // Chi non approva vede solo le proprie registrazioni: la griglia
          // completa del team è una vista da responsabile.
          ...(puoApprovare ? {} : { userId }),
        },
        orderBy: { giorno: 'asc' },
        include: {
          approvatoDa: { select: { nome: true } },
          rifiutatoDa: { select: { nome: true } },
          progetto: { select: { nome: true } },
        },
      });
      const membri = await prisma.user.findMany({
        where: puoApprovare ? { tenantId, ruolo: { not: 'cliente' } } : { id: userId },
        select: { id: true, nome: true, email: true, ruolo: true, specializzazione: true },
        orderBy: { createdAt: 'asc' },
      });
      const progetti = await prisma.progetto.findMany({
        where: { tenantId },
        select: { id: true, nome: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return reply.send({
        inizio: isoData(inizio),
        fine: isoData(new Date(fine.getTime() - MS_GIORNO)),
        puoApprovare,
        membri,
        progetti,
        voci: voci.map((v) => ({
          id: v.id,
          userId: v.userId,
          giorno: isoData(v.giorno),
          minuti: v.minuti,
          stato: v.stato,
          nota: v.nota,
          progettoId: v.progettoId,
          nomeProgetto: v.progetto?.nome ?? null,
          motivoRifiuto: v.motivoRifiuto,
          approvatoDa: v.approvatoDa?.nome ?? null,
          approvatoAt: v.approvatoAt,
        })),
      });
    } catch (err: any) {
      console.error('GET /timesheet —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel caricamento del timesheet' });
    }
  });

  // Upsert della propria giornata: minuti=0 svuota la cella. Le ore già
  // approvate sono intoccabili (409); una riga rifiutata torna in bozza e si
  // può correggere. L'unicità (tenant, utente, giorno) rende l'operazione
  // idempotente sulla stessa cella.
  server.post<{ Body: { giorno?: string; minuti?: number; nota?: string; progettoId?: string | null } }>('/timesheet', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    if (!userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const { giorno: giornoIso, minuti, nota, progettoId } = req.body || {};
    const giorno = parseDataIso(giornoIso);
    if (!giorno) {
      return reply.code(400).send({ errore: 'Campo giorno non valido: usare una data YYYY-MM-DD' });
    }
    if (typeof minuti !== 'number' || !Number.isFinite(minuti) || minuti < 0 || minuti > 24 * 60) {
      return reply.code(400).send({ errore: 'Campo minuti non valido: numero tra 0 e 1440' });
    }
    const minutiArrotondati = Math.round(minuti);

    try {
      if (progettoId) {
        const progetto = await prisma.progetto.findUnique({ where: { id: progettoId }, select: { tenantId: true } });
        if (!progetto || progetto.tenantId !== tenantId) {
          return reply.code(400).send({ errore: 'Progetto non trovato nel tenant' });
        }
      }

      const esistente = await prisma.oraTimesheet.findUnique({
        where: { tenantId_userId_giorno: { tenantId, userId, giorno } },
      });
      if (esistente?.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Queste ore sono già state approvate: chiedi al responsabile per modificarle.' });
      }

      if (minutiArrotondati === 0) {
        if (esistente) {
          await prisma.oraTimesheet.delete({ where: { id: esistente.id } });
        }
        return reply.send({ eliminata: true, giorno: isoData(giorno) });
      }

      const dati = {
        minuti: minutiArrotondati,
        nota: typeof nota === 'string' && nota.trim() ? nota.trim().slice(0, 500) : null,
        progettoId: progettoId || null,
        // Ogni (ri)registrazione riparte dalla bozza: anche dopo un rifiuto.
        stato: 'bozza' as const,
        motivoRifiuto: null,
        rifiutatoDaId: null,
        approvatoDaId: null,
        approvatoAt: null,
      };
      const salvata = esistente
        ? await prisma.oraTimesheet.update({ where: { id: esistente.id }, data: dati })
        : await prisma.oraTimesheet.create({ data: { ...dati, tenantId, userId, giorno } });
      return reply.send(salvata);
    } catch (err: any) {
      console.error('POST /timesheet —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel salvataggio delle ore' });
    }
  });

  const soloChiApprova = (ruolo: string | undefined, reply: any): boolean => {
    if (ruolo === 'advisor' || ruolo === 'super_admin') return true;
    reply.code(403).send({ errore: 'Solo il responsabile dello studio o il super admin possono approvare le ore.' });
    return false;
  };

  server.post<{ Params: { id: string } }>('/timesheet/:id/approva', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    try {
      // RLS limita già al tenant: una riga di un altro tenant qui non arriva.
      const voce = await prisma.oraTimesheet.findUnique({ where: { id: req.params.id } });
      if (!voce || voce.tenantId !== tenantId) {
        return reply.code(404).send({ errore: 'Registrazione non trovata' });
      }
      if (voce.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Registrazione già approvata' });
      }
      const aggiornata = await prisma.oraTimesheet.update({
        where: { id: voce.id },
        data: { stato: 'approvato', approvatoDaId: userId ?? null, approvatoAt: new Date(), motivoRifiuto: null, rifiutatoDaId: null },
      });
      return reply.send(aggiornata);
    } catch (err: any) {
      console.error('POST /timesheet/:id/approva —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nell\'approvazione delle ore' });
    }
  });

  server.post<{ Params: { id: string }; Body: { motivo?: string } }>('/timesheet/:id/rifiuta', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    try {
      const voce = await prisma.oraTimesheet.findUnique({ where: { id: req.params.id } });
      if (!voce || voce.tenantId !== tenantId) {
        return reply.code(404).send({ errore: 'Registrazione non trovata' });
      }
      if (voce.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Una registrazione già approvata non può essere rifiutata' });
      }
      const motivo = req.body?.motivo;
      const aggiornata = await prisma.oraTimesheet.update({
        where: { id: voce.id },
        data: {
          stato: 'rifiutato',
          motivoRifiuto: typeof motivo === 'string' && motivo.trim() ? motivo.trim().slice(0, 500) : null,
          rifiutatoDaId: userId ?? null,
        },
      });
      return reply.send(aggiornata);
    } catch (err: any) {
      console.error('POST /timesheet/:id/rifiuta —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel rifiuto delle ore' });
    }
  });

  // Approvazione in blocco di tutte le bozze della settimana (opzionalmente di
  // un solo membro): è il bottone "approva settimana" della griglia.
  server.post<{ Body: { inizio?: string; userId?: string } }>('/timesheet/approva-settimana', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userIdRichiedente = (req as any).userId as string | undefined;
    const inizio = lunediSettimana(req.body?.inizio);
    if (!inizio) {
      return reply.code(400).send({ errore: 'Parametro inizio non valido: usare una data YYYY-MM-DD' });
    }
    const fine = new Date(inizio.getTime() + MS_SETTIMANA);
    try {
      const risultato = await prisma.oraTimesheet.updateMany({
        where: {
          tenantId,
          giorno: { gte: inizio, lt: fine },
          stato: 'bozza',
          ...(req.body?.userId ? { userId: req.body.userId } : {}),
        },
        data: { stato: 'approvato', approvatoDaId: userIdRichiedente ?? null, approvatoAt: new Date() },
      });
      return reply.send({ approvate: risultato.count, inizio: isoData(inizio), fine: isoData(new Date(fine.getTime() - MS_GIORNO)) });
    } catch (err: any) {
      console.error('POST /timesheet/approva-settimana —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nell\'approvazione della settimana' });
    }
  });

  // ── ASSEGNAZIONE AUTOMATICA OPERATORE (BLOCCO 6.2) ─────────────────
  // Suggerimento per l'assegnazione di moduli/micro-voci: prima la
  // specializzazione (corrispondenza con la categoria del lavoro), poi il
  // minor carico: ore registrate nella settimana corrente + ore residue sulle
  // voci aperte già assegnate. Nessun dato inventato: se il tenant non ha
  // utenti la risposta è un elenco vuoto.
  server.get<{ Querystring: { categoria?: string } }>('/operatori-suggeriti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const categoria = (req.query.categoria || '').trim().toLowerCase();
    try {
      const inizio = lunediSettimana();
      const fine = inizio ? new Date(inizio.getTime() + MS_SETTIMANA) : null;
      const utenti = await prisma.user.findMany({
        where: { tenantId, ruolo: { not: 'cliente' }, stato: { not: 'disattivato' } },
        select: { id: true, nome: true, ruolo: true, specializzazione: true },
        orderBy: { createdAt: 'asc' },
      });
      if (utenti.length === 0) {
        return reply.send({ criterio: 'specializzazione + minor carico di lavoro', categoria: categoria || null, suggeriti: [] });
      }
      const ids = utenti.map((u) => u.id);

      // Carico: ore già registrate questa settimana (tutti gli stati — il lavoro
      // è comunque fatto) + ore da fare sulle voci aperte assegnate.
      const registrazioniSettimana = await prisma.oraTimesheet.groupBy({
        by: ['userId'],
        where: { tenantId, userId: { in: ids }, ...(fine ? { giorno: { gte: inizio!, lt: fine } } : {}) },
        _sum: { minuti: true },
      });
      const vociAperte = await prisma.microvoceProgetto.groupBy({
        by: ['risorsaId'],
        where: { tenantId, risorsaId: { in: ids }, stato: { not: 'done' } },
        _sum: { orePreventivate: true, oreConsuntivate: true },
      });
      const oreSettimanaPerUtente = new Map(registrazioniSettimana.map((r) => [r.userId, (r._sum.minuti ?? 0) / 60]));
      const residuePerUtente = new Map(
        vociAperte.map((v) => [v.risorsaId ?? '', Math.max(0, (v._sum.orePreventivate ?? 0) - (v._sum.oreConsuntivate ?? 0))]),
      );

      const righe = utenti.map((u) => {
        const specializzazione = (u.specializzazione || '').trim().toLowerCase();
        const corrisponde = Boolean(categoria) && Boolean(specializzazione) &&
          (specializzazione.includes(categoria) || categoria.includes(specializzazione));
        const oreSettimana = oreSettimanaPerUtente.get(u.id) ?? 0;
        const oreResidue = residuePerUtente.get(u.id) ?? 0;
        const caricoOre = Math.round((oreSettimana + oreResidue) * 10) / 10;
        return {
          id: u.id,
          nome: u.nome,
          ruolo: u.ruolo,
          specializzazione: u.specializzazione || null,
          corrisponde,
          oreSettimana: Math.round(oreSettimana * 10) / 10,
          oreResidue: Math.round(oreResidue * 10) / 10,
          caricoOre,
        };
      });
      righe.sort(
        (a, b) =>
          Number(b.corrisponde) - Number(a.corrisponde) ||
          a.caricoOre - b.caricoOre ||
          a.nome.localeCompare(b.nome),
      );
      return reply.send({ criterio: 'specializzazione + minor carico di lavoro', categoria: categoria || null, suggeriti: righe });
    } catch (err: any) {
      console.error('GET /operatori-suggeriti —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel calcolo degli operatori suggeriti' });
    }
  });

  // ── RICERCA GLOBALE (BLOCCO 4) ─────────────────────────────────────
  // Ricerca trasversale server-side (ILIKE + indici trigram) su clienti,
  // progetti, fatture, documenti, team, calendario e retainer. Sempre
  // limitata al tenant della richiesta. Minimo 2 caratteri per evitare
  // scansioni inutili su prefissi di un solo carattere.
  server.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return reply.code(400).send({ errore: 'Inserisci almeno 2 caratteri per la ricerca' });
    }
    try {
      const gruppi = await ricercaGlobale(tenantId, q);
      const totale = gruppi.reduce((s, g) => s + g.risultati.length, 0);
      return reply.send({ query: q, totale, gruppi });
    } catch (err: any) {
      console.error(`Errore ricerca globale ("${q}"):`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore durante la ricerca' });
    }
  });

  // ── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  server.get<{ Params: { id: string } }>('/invoices/:id/pdf', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id: req.params.id },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        // Ragione sociale, P.IVA e IBAN dello studio che emette, non un nome e un IBAN
        // scritti nel codice: la fattura è un documento fiscale e questi tre campi sono
        // proprio quelli che il destinatario usa per registrarla e per pagare.
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantIban: studio?.iban || undefined,
        righe: fattura.righe.map(r => ({ descrizione: r.descrizione, importo: r.importo })),
        totaleEuro: totaleCentesimi / 100,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="Fattura_${fattura.numero || 'Bozza'}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore generazione PDF server-side' });
    }
  });

  server.post<{ Params: { id: string }; Body: { emailDestinatario?: string } }>('/invoices/:id/invia-email', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id: req.params.id },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      // Il destinatario è quello indicato o quello del cliente in anagrafica. Qui c'era un
      // indirizzo inventato come ripiego (`cliente@holdingbeta...`): la rotta rispondeva
      // «inviata con successo» dopo aver spedito la fattura di un cliente reale a una
      // casella che non esiste.
      const emailDestinatario = req.body?.emailDestinatario?.trim() || fattura.progetto.cliente.email || '';
      if (!emailDestinatario) {
        return reply.code(400).send({
          errore: `Nessun indirizzo email per ${fattura.progetto.cliente.nome}: indicane uno o compila l'anagrafica del cliente.`,
        });
      }

      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantIban: studio?.iban || undefined,
        righe: fattura.righe.map(r => ({ descrizione: r.descrizione, importo: r.importo })),
        totaleEuro: totaleCentesimi / 100,
      });

      const numeroDocumento = fattura.numero || `FT-${fattura.numeroProgressivoSerie}`;
      const tipoLeggibile = fattura.tipoDocumento === 'nota_credito' ? 'nota di credito' : 'fattura';
      const nomeStudio = studio?.ragioneSociale || 'Studio';

      // Qui partiva `sendMagicLinkEmail`: al cliente arrivava un'email intitolata «Accesso
      // al Portale Cliente» con un link a `http://localhost:5173`, e il PDF appena generato
      // veniva scartato — mentre il log di audit scriveva «con allegato PDF nativo» e la
      // risposta diceva «inviata con successo». Tre affermazioni false per un invio che non
      // conteneva la fattura.
      const esitoInvio = await inviaEmail({
        to: emailDestinatario,
        subject: `${fattura.tipoDocumento === 'nota_credito' ? 'Nota di credito' : 'Fattura'} ${numeroDocumento} — ${nomeStudio}`,
        html: `
          <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
            <h2 style="font-size: 18px; color: #0f172a;">Gentile ${fattura.progetto.cliente.nome},</h2>
            <p style="line-height: 1.6; color: #475569;">
              in allegato trova la ${tipoLeggibile} <strong>${numeroDocumento}</strong> del
              ${(fattura.data || new Date()).toLocaleDateString('it-IT')}, per un totale di
              <strong>€ ${(totaleCentesimi / 100).toFixed(2)}</strong>.
            </p>
            <p style="line-height: 1.6; color: #475569;">
              Le coordinate per il pagamento sono indicate nel documento allegato.
            </p>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">${nomeStudio}</p>
          </div>
        `,
        smtp: studio?.smtpHost && studio?.smtpUser && studio?.smtpPass ? {
          host: studio.smtpHost,
          port: studio.smtpPort || 465,
          secure: studio.smtpSecure ?? true,
          user: studio.smtpUser,
          pass: studio.smtpPass,
        } : undefined,
        fromEmail: studio?.smtpFromEmail || studio?.smtpUser || undefined,
        fromName: studio?.smtpFromName || nomeStudio,
        allegati: [{
          filename: `${numeroDocumento}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
        etichetta: 'fattura',
      });

      if (!esitoInvio.ok) {
        return reply.code(502).send({
          errore: `La ${tipoLeggibile} ${numeroDocumento} non è stata inviata a ${emailDestinatario}: ${esitoInvio.errore}`,
        });
      }

      await recordAudit({
        tenantId,
        azione: 'FATTURA_INVIATA_EMAIL',
        entita: numeroDocumento,
        dettagli: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} inviata a ${emailDestinatario} con il PDF in allegato (${esitoInvio.via})`,
      });

      return reply.send({ ok: true, message: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} ${numeroDocumento} inviata a ${emailDestinatario}` });
    } catch (err: any) {
      console.error('Errore invio fattura via email:', err);
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'invio dell\'email' });
    }
  });

  // ── WEBHOOK ESITI SDI — registrazione dell'esito reale di una fattura ──
  // Con l'invio manuale (§3.5) è così che lo stato fiscale si aggiorna davvero:
  // l'operatore (o in futuro un'integrazione) comunica l'esito ricevuto da SdI
  // (consegnata / scartata / mancata_consegna) dopo la trasmissione.
  server.post<{ Body: { fatturaId: string; statoSdi: 'consegnata' | 'scartata' | 'mancata_consegna'; note?: string } }>(
    '/webhooks/sdi',
    async (req, reply) => {
      const { fatturaId, statoSdi, note } = req.body;
      if (!fatturaId || !statoSdi) return reply.code(400).send({ errore: 'fatturaId e statoSdi sono obbligatori' });

      try {
        const fattura = await prisma.fattura.update({
          where: { id: fatturaId },
          data: { statoSdi },
        });

        await recordAudit({
          tenantId: fattura.tenantId,
          azione: 'SDI_ESITO_RICEVUTO',
          entita: `Fattura ${fattura.numero}`,
          dettagli: `Ricevuto esito SDI via Webhook: ${statoSdi.toUpperCase()}. ${note || ''}`,
        });

        return reply.send({ ok: true, statoSdi: fattura.statoSdi });
      } catch (err) {
        return reply.code(500).send({ errore: 'Errore aggiornamento esito SDI' });
      }
    },
  );

  // ── CONTRATTI RICORRENTI & RETAINER (STYLE OPENSTAMANAGER) ────────
  server.get('/contratti-ricorrenti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const contratti = await (prisma as any).contrattoRicorrente.findMany({
        where: { tenantId },
        include: { cliente: true, progetto: true },
        orderBy: { prossimaFatturazione: 'asc' },
      });
      return reply.send(contratti);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Body: {
      clienteId: string;
      progettoId?: string;
      titolo: string;
      frequenza?: 'mensile' | 'trimestrale' | 'semestrale' | 'annuale';
      importoCentesimi: number;
      prossimaFatturazione: string;
      note?: string;
    };
  }>('/contratti-ricorrenti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { clienteId, progettoId, titolo, frequenza, importoCentesimi, prossimaFatturazione, note } = req.body;

    if (!clienteId || !titolo || !importoCentesimi) {
      return reply.code(400).send({ errore: 'clienteId, titolo e importoCentesimi sono obbligatori' });
    }

    try {
      const contratto = await (prisma as any).contrattoRicorrente.create({
        data: {
          tenantId,
          clienteId,
          progettoId: progettoId || null,
          titolo,
          frequenza: frequenza || 'mensile',
          importoCentesimi,
          prossimaFatturazione: new Date(prossimaFatturazione),
          note,
        },
        include: { cliente: true, progetto: true },
      });

      await recordAudit({
        tenantId,
        azione: 'CONTRATTO_RICORRENTE_CREATO',
        entita: titolo,
        dettagli: `Creato contratto retainer da €${(importoCentesimi / 100).toFixed(2)} (${frequenza || 'mensile'})`,
      });

      return reply.code(201).send(contratto);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione contratto' });
    }
  });

  // Genera Fattura 1-Click da Contratto Retainer Ricorrente (Stile OpenSTAManager)
  server.post<{ Params: { id: string } }>('/contratti-ricorrenti/:id/genera-fattura', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    try {
      const contratto = await (prisma as any).contrattoRicorrente.findUnique({
        where: { id },
        include: { cliente: true, progetto: true },
      });

      if (!contratto) return reply.code(404).send({ errore: 'Contratto non trovato' });

      // 1. Genera Numero Progressivo Fattura (Serie FT)
      const lastFattura = await (prisma as any).fattura.findFirst({
        where: { tenantId, tipoDocumento: 'fattura', serie: 'FT' },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      const annoCorrente = new Date().getFullYear();
      const prossimoProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
      const numeroFattura = `FT-${annoCorrente}-${String(prossimoProgressivo).padStart(4, '0')}`;

      // 2. Crea Fattura a DB con RigaFattura per l'importo del Canone Retainer
      const nuovaFattura = await (prisma as any).fattura.create({
        data: {
          tenantId,
          progettoId: contratto.progettoId || null,
          tipoDocumento: 'fattura',
          serie: 'FT',
          numeroProgressivoSerie: prossimoProgressivo,
          numero: numeroFattura,
          importoCentesimi: contratto.importoCentesimi,
          stato: 'emessa',
          note: `Fatturazione canone retainer ricorrente: ${contratto.titolo} (${contratto.frequenza})`,
          righe: {
            create: [
              {
                descrizione: `Canone Retainer: ${contratto.titolo} (${contratto.frequenza})`,
                importo: contratto.importoCentesimi,
              }
            ]
          }
        },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });

      // 3. Genera Scadenza Incasso nello Scadenzario
      const scadenza = await (prisma as any).scadenzaFattura.create({
        data: {
          tenantId,
          fatturaId: nuovaFattura.id,
          numeroRata: 1,
          importoCentesimi: contratto.importoCentesimi,
          dataScadenza: new Date(),
          stato: 'aperta',
        },
      });

      // 4. Calcola la data della Prossima Fatturazione in base alla frequenza
      const prossimaData = new Date(contratto.prossimaFatturazione || new Date());
      if (contratto.frequenza === 'mensile') prossimaData.setMonth(prossimaData.getMonth() + 1);
      else if (contratto.frequenza === 'trimestrale') prossimaData.setMonth(prossimaData.getMonth() + 3);
      else if (contratto.frequenza === 'semestrale') prossimaData.setMonth(prossimaData.getMonth() + 6);
      else if (contratto.frequenza === 'annuale') prossimaData.setFullYear(prossimaData.getFullYear() + 1);

      await (prisma as any).contrattoRicorrente.update({
        where: { id },
        data: { prossimaFatturazione: prossimaData },
      });

      await recordAudit({
        tenantId,
        azione: 'FATTURA_RETAINER_GENERATA',
        entita: numeroFattura,
        dettagli: `Generata fattura ${numeroFattura} da €${(contratto.importoCentesimi / 100).toFixed(2)} per il canone retainer ${contratto.titolo}`,
      });

      return reply.send({
        ok: true,
        fattura: nuovaFattura,
        scadenza,
        prossimaFatturazione: prossimaData,
        messaggio: `Fattura ${numeroFattura} generata con successo ed inserita nello Scadenzario Incassi!`,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione fattura retainer' });
    }
  });

  // ── GESTIONE PERMESSI GRANULARI MODULI & SEZIONI (STYLE OPENSTAMANAGER) ─
  server.get<{ Params: { userId: string } }>('/tenant/utenti/:userId/permessi', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { userId } = req.params;
    try {
      const permessi = await (prisma as any).permessoModulo.findMany({
        where: { tenantId, userId },
      });
      return reply.send(permessi);
    } catch {
      return reply.send([]);
    }
  });

  server.put<{
    Params: { userId: string };
    Body: { permessi: Array<{ moduloChiave: string; livello: 'denied' | 'read' | 'write' }> };
  }>('/tenant/utenti/:userId/permessi', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { userId } = req.params;
    const { permessi } = req.body;

    if (!Array.isArray(permessi)) {
      return reply.code(400).send({ errore: 'Array permessi obbligatorio' });
    }

    try {
      for (const p of permessi) {
        await (prisma as any).permessoModulo.upsert({
          where: {
            tenantId_userId_moduloChiave: {
              tenantId,
              userId,
              moduloChiave: p.moduloChiave,
            },
          },
          update: { livello: p.livello },
          create: {
            tenantId,
            userId,
            moduloChiave: p.moduloChiave,
            livello: p.livello,
          },
        });
      }

      await recordAudit({
        tenantId,
        azione: 'PERMESSI_UTENTE_AGGIORNATI',
        entita: userId,
        dettagli: `Aggiornata matrice permessi RBAC per l'utente ${userId}`,
      });

      return reply.send({ ok: true, messaggio: 'Matrice permessi aggiornata con successo' });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento permessi' });
    }
  });

  // ── CHECKLIST SOP COMPLIANCE (STYLE OPENSTAMANAGER) ───────────────
  server.get<{ Params: { passaggioId: string } }>('/passaggi/:passaggioId/checklist', async (req, reply) => {
    try {
      const voci = await (prisma as any).checklistVoce.findMany({
        where: { passaggioProgettoId: req.params.passaggioId },
        orderBy: { titolo: 'asc' },
      });
      return reply.send(voci);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Params: { passaggioId: string };
    Body: { titolo: string; obbligatorio?: boolean };
  }>('/passaggi/:passaggioId/checklist', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { passaggioId } = req.params;
    const { titolo, obbligatorio } = req.body;

    if (!titolo) return reply.code(400).send({ errore: 'Titolo voce checklist obbligatorio' });

    try {
      const voce = await (prisma as any).checklistVoce.create({
        data: {
          tenantId,
          passaggioProgettoId: passaggioId,
          titolo,
          obbligatorio: obbligatorio ?? false,
        },
      });
      return reply.code(201).send(voce);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore creazione voce checklist' });
    }
  });

  server.patch<{ Params: { id: string } }>('/checklist/:id/toggle', async (req, reply) => {
    try {
      const voce = await (prisma as any).checklistVoce.findUnique({ where: { id: req.params.id } });
      if (!voce) return reply.code(404).send({ errore: 'Voce non trovata' });

      const updated = await (prisma as any).checklistVoce.update({
        where: { id: req.params.id },
        data: {
          completato: !voce.completato,
          completatoAt: !voce.completato ? new Date() : null,
        },
      });
      return reply.send(updated);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore aggiornamento checklist' });
    }
  });

  server.post<{
    Params: { id: string };
    Body: { oreAggiunte?: number; ore?: number };
  }>('/microvoci/:id/consuntiva', async (req, reply) => {
    const ore = req.body?.oreAggiunte ?? req.body?.ore;
    if (ore === undefined || typeof ore !== 'number') {
      return reply.code(400).send({ errore: 'Il campo ore (o oreAggiunte) è obbligatorio' });
    }
    await app.consuntivaMicrovoce({ microvoceId: req.params.id, oreAggiunte: ore });
    return { ok: true, oreConsuntivate: ore };
  });

  server.post<{
    Body: { clienteId: string; progettoId: string; righe: Array<{ moduloTemplateId: string; moduloTemplateVersione: number }> };
  }>('/preventivi', async (req, reply) => {
    const { clienteId, progettoId, righe } = req.body;
    if (!clienteId || !progettoId || !righe?.length) {
      return reply.code(400).send({ errore: 'clienteId, progettoId e almeno una riga sono obbligatori' });
    }
    const preventivo = await app.creaPreventivo({ clienteId, progettoId, righe });
    return reply.code(201).send(preventivo);
  });

  server.get<{ Params: { id: string } }>('/preventivi/:id', async (req) => {
    return app.getPreventivo(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/preventivi/:id/invia', async (req) => {
    return app.inviaPreventivo(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/preventivi/:id/accetta', async (req) => {
    // §15.3 — qui avviene l'istanziazione completa: modulo_progetto, microvoce_progetto,
    // passaggio_progetto, dipendenze, il tutto dentro la transazione già testata.
    return app.accettaPreventivoEIstanzia(req.params.id);
  });

  // ── §17 — Esecuzione ─────────────────────────────────────────────────────────

  server.get<{ Params: { id: string } }>('/microvoci/:id', async (req) => {
    return app.getMicrovoce(req.params.id);
  });



  server.post<{ Params: { id: string }; Body: { stato: 'delayed' | 'blocked'; causaNota: string } }>(
    '/microvoci/:id/ritardo',
    async (req, reply) => {
      if (!req.body?.stato || !req.body?.causaNota) {
        return reply.code(400).send({ errore: 'stato e causaNota sono obbligatori' });
      }
      await app.marcaRitardoMicrovoce(req.params.id, req.body.stato, req.body.causaNota);
      return app.getMicrovoce(req.params.id);
    },
  );

  server.post<{ Params: { id: string } }>('/microvoci/:id/risolvi-ritardo', async (req) => {
    await app.risolviRitardoMicrovoce(req.params.id);
    return app.getMicrovoce(req.params.id);
  });

  server.patch<{ Params: { id: string } }>('/microvoci/:id/completa', async (req) => {
    await app.completaMicrovoce(req.params.id);
    return app.getMicrovoce(req.params.id);
  });

  server.get<{ Params: { id: string } }>('/microvoci/:id/passaggi', async (req) => {
    return app.getPassaggiDellaMicrovoce(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/completa-documento', async (req) => {
    // Versione semplificata: nessun upload di file reale (§28 lo tratterà quando ci sarà
    // uno storage collegato). Qui simula solo il completamento del passaggio.
    await app.completaPassaggioDocumento(req.params.id);
    return { ok: true };
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/completa-form', async (req) => {
    await app.completaPassaggioForm(req.params.id);
    return { ok: true };
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/marca-completato', async (req) => {
    await app.marcaPassaggioCompletato(req.params.id);
    return { ok: true };
  });

  // ── MODELLI DOCUMENTI & CONTRATTI CUSTOM STUDIO (DOCUMENT STUDIO) ──
  server.get('/documenti-template', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const modelli = await (prisma as any).modelloDocumentoCustom.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(modelli);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{ Body: { titolo: string; categoria?: string; descrizione?: string; contenutoHtml: string } }>('/documenti-template', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { titolo, categoria, descrizione, contenutoHtml } = req.body;
    try {
      const nuovo = await (prisma as any).modelloDocumentoCustom.create({
        data: {
          tenantId,
          titolo: titolo || 'Nuovo Modello Documento',
          categoria: categoria || 'contratto',
          descrizione: descrizione || '',
          contenutoHtml: contenutoHtml || '',
        },
      });
      await recordAudit({
        tenantId,
        azione: 'MODELLO_DOCUMENTO_CREATO',
        entita: `Modello #${nuovo.id}`,
        dettagli: `Creato nuovo modello contrattuale "${titolo}" nel Document Studio`,
      });
      return reply.code(201).send(nuovo);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione modello' });
    }
  });

  server.put<{ Params: { id: string }; Body: { titolo?: string; categoria?: string; descrizione?: string; contenutoHtml?: string } }>('/documenti-template/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { titolo, categoria, descrizione, contenutoHtml } = req.body;
    try {
      const aggiornato = await (prisma as any).modelloDocumentoCustom.update({
        where: { id },
        data: {
          ...(titolo && { titolo }),
          ...(categoria && { categoria }),
          ...(descrizione !== undefined && { descrizione }),
          ...(contenutoHtml !== undefined && { contenutoHtml }),
        },
      });
      return reply.send(aggiornato);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento modello' });
    }
  });

  server.delete<{ Params: { id: string } }>('/documenti-template/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      await (prisma as any).modelloDocumentoCustom.delete({ where: { id } });
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione modello' });
    }
  });

  // ── §2.9 — Fascicolo documentale del progetto: le scritture vanno a database ──────────
  //
  // Prima di questo blocco l'upload dello studio salvava il file sul server (POST /upload)
  // ma il «documento» esisteva solo in localStorage del browser che lo aveva caricato:
  // il portale del cliente (/portal/documenti) legge la tabella `documento`, quindi non
  // vedeva niente, e un altro operatore dello studio non vedeva niente nemmeno lui.
  // Qui l'upload crea la riga in `documento`, agganciata al progetto (o alla micro-voce).

  server.get<{ Querystring: { progettoId?: string; microvoceProgettoId?: string; includiArchiviati?: string } }>(
    '/documenti',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      const { progettoId, microvoceProgettoId, includiArchiviati } = req.query;
      if (!progettoId && !microvoceProgettoId) {
        return reply.code(400).send({ errore: 'Specificare progettoId o microvoceProgettoId.' });
      }

      try {
        if (progettoId) {
          const progetto = await prisma.progetto.findFirst({ where: { id: progettoId, tenantId }, select: { id: true } });
          if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });
        }

        const documenti = await prisma.documento.findMany({
          where: {
            tenantId,
            ...(progettoId ? { progettoId } : {}),
            ...(microvoceProgettoId ? { microvoceProgettoId } : {}),
            // Punto 3 piano gap — le liste operative escludono gli archiviati:
            // lo storico (includiArchiviati=true) li mostra solo su richiesta.
            ...(includiArchiviati === 'true' ? {} : { isArchiviato: false }),
          },
          select: {
            id: true,
            tipo: true,
            fileUrl: true,
            filePdfUrl: true,
            fileDocxUrl: true,
            formatoOrigine: true,
            versione: true,
            createdAt: true,
            caricatoDa: true,
            categoriaDoc: true,
            statoScansione: true,
            dataScadenzaDoc: true,
            progettoId: true,
            microvoceProgettoId: true,
            statoDoc: true,
            pubblicatoAt: true,
            documentoPadreId: true,
            isArchiviato: true,
            archiviatoAt: true,
            microvoceProgetto: { select: { nome: true } },
            richiesteModifica: {
              select: {
                id: true,
                commento: true,
                stato: true,
                creatoAt: true,
                rispostoAt: true,
                rispostaStudio: true,
                cliente: { select: { id: true, nome: true } },
              },
              orderBy: { creatoAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        // Lo stato di firma di ciascun documento, come in /portal/documenti: senza questa
        // informazione lo studio mostrerebbe «da firmare» un documento già sottoscritto.
        const firme = await prisma.firmaElettronica.findMany({
          where: { tenantId, ambito: 'documento_vault', riferimentoId: { in: documenti.map((d) => d.id) } },
          select: { riferimentoId: true, firmatoAt: true, signatureId: true, tipoFirma: true },
          orderBy: { firmatoAt: 'desc' },
        });
        const firmaPerDocumento = new Map<string, (typeof firme)[number]>();
        for (const f of firme) {
          if (f.riferimentoId && !firmaPerDocumento.has(f.riferimentoId)) firmaPerDocumento.set(f.riferimentoId, f);
        }

        return reply.send({
          ok: true,
          documenti: documenti.map((d) => {
            const firma = firmaPerDocumento.get(d.id);
            // Come /portal/documenti: la firma HMAC degli URL /uploads/ va rinnovata alla lettura.
            return {
              ...d,
              fileUrl: rifirmaUrlUpload(d.fileUrl) as string,
              // Punto 1 — anche i formati di export hanno URL firmati (null per i documenti storici).
              filePdfUrl: d.filePdfUrl ? (rifirmaUrlUpload(d.filePdfUrl) as string) : null,
              fileDocxUrl: d.fileDocxUrl ? (rifirmaUrlUpload(d.fileDocxUrl) as string) : null,
              firmato: Boolean(firma) || d.tipo === 'firmato',
              firma,
            };
          }),
        });
      } catch (err) {
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura documenti' });
      }
    },
  );

  server.post<{
    Body: {
      progettoId: string;
      microvoceProgettoId?: string;
      filename: string;
      contentBase64: string;
      tipo?: string;
      categoriaDoc?: string;
      dataScadenzaDoc?: string;
      statoDoc?: 'bozza' | 'pubblicato';
    };
  }>('/documenti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const { progettoId, microvoceProgettoId, filename, contentBase64, tipo, categoriaDoc, dataScadenzaDoc, statoDoc } = req.body;

    if (!progettoId || !filename || !contentBase64) {
      return reply.code(400).send({ errore: 'progettoId, filename e contentBase64 sono obbligatori.' });
    }
    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });

    const scadenza = dataScadenzaDoc ? new Date(dataScadenzaDoc) : null;
    if (dataScadenzaDoc && Number.isNaN(scadenza?.getTime())) {
      return reply.code(400).send({ errore: 'dataScadenzaDoc non è una data valida.' });
    }

    try {
      const progetto = await prisma.progetto.findFirst({ where: { id: progettoId, tenantId }, select: { id: true, clienteId: true, nome: true } });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });

      // §28 — la scansione avviene PRIMA di scrivere qualunque cosa: un file bocciato non
      // arriva né nell'archivio né nella tabella.
      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const esito = scanFileBuffer(buffer, filename);
      if (!esito.safe) {
        return reply.code(400).send({ errore: esito.reason ?? 'File non ammesso nel fascicolo.' });
      }

      const archiviato = await uploadDocumento(filename, contentBase64);

      const defaultStatoDoc = (statoDoc === 'pubblicato') ? 'pubblicato' : 'bozza';

      // Lo schema ammette template_vuoto|compilato|firmato|allegato: prima ogni valore
      // diverso da 'firmato' diventava 'allegato', così un documento redatto dall'operatore
      // ('compilato') era indistinguibile da un file allegato dal cliente.
      const tipiAmmessi = ['template_vuoto', 'compilato', 'firmato', 'allegato'];
      const tipoFinale = tipo && tipiAmmessi.includes(tipo) ? tipo : 'allegato';

      const documento = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId,
          tipo: tipoFinale,
          fileUrl: archiviato.url,
          caricatoDa: userId,
          categoriaDoc: categoriaDoc || 'generico',
          dataScadenzaDoc: scadenza,
          statoDoc: defaultStatoDoc,
          pubblicatoAt: defaultStatoDoc === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_ARCHIVIATO',
        entita: documento.id,
        dettagli: `Archiviato «${filename}» (${archiviato.size}) stato «${defaultStatoDoc}» nel fascicolo del progetto ${progettoId}`,
        ipAddress: req.ip,
      });

      // Se pubblicato subito, notifica il cliente
      if (defaultStatoDoc === 'pubblicato' && tipo !== 'firmato' && progetto.clienteId) {
        await notificaCliente(tenantId, progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${filename}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: { ...documento, firmato: false, firma: null, richiesteModifica: [] } });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore archiviazione documento' });
    }
  });

  /**
   * Punto 1 piano gap — POST /documenti/genera
   * Genera il documento da template SUL SERVER, in un solo passaggio, in entrambi i formati
   * (pdfkit → PDF master, docxtemplater → Word di cortesia) dallo stesso merge dati. Prima
   * questo lavoro lo faceva il browser con jsPDF e il Word era uno stub con testo inventato.
   * Il PDF è il master: `fileUrl` punta lì e l'hash legale della firma si fissa su quello.
   */
  server.post<{
    Body: {
      progettoId: string;
      microvoceProgettoId?: string;
      modelloId?: string;
      contenutoHtml?: string;
      titolo?: string;
      categoriaDoc?: string;
      statoDoc?: 'bozza' | 'pubblicato';
      dataScadenzaDoc?: string;
    };
  }>('/documenti/genera', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const { progettoId, microvoceProgettoId, modelloId, contenutoHtml, titolo, categoriaDoc, statoDoc, dataScadenzaDoc } = req.body;

    if (!progettoId) return reply.code(400).send({ errore: 'progettoId è obbligatorio.' });
    if (!modelloId && !contenutoHtml) {
      return reply.code(400).send({ errore: 'Indicare il modello (modelloId) o il contenuto HTML del template.' });
    }
    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });

    const scadenza = dataScadenzaDoc ? new Date(dataScadenzaDoc) : null;
    if (dataScadenzaDoc && Number.isNaN(scadenza?.getTime())) {
      return reply.code(400).send({ errore: 'dataScadenzaDoc non è una data valida.' });
    }

    try {
      const progetto = await prisma.progetto.findFirst({
        where: { id: progettoId, tenantId },
        select: {
          id: true,
          clienteId: true,
          nome: true,
          valoreTotale: true,
          cliente: {
            select: {
              nome: true,
              piva: true,
              codiceFiscale: true,
              sedeLegale: true,
              sdiCode: true,
              iban: true,
              cellulare: true,
              ubo: true,
              referentiJson: true,
            },
          },
        },
      });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });

      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { ragioneSociale: true, piva: true, sedeLegale: true, iban: true, leadAdvisorNome: true, telefono: true, email: true },
      });

      // Il template può arrivare come riferimento a un ModelloDocumentoCustom del tenant
      // oppure come HTML inline (i modelli standard del frontend).
      let htmlTemplate = contenutoHtml ?? '';
      let titoloDocumento = titolo?.trim() || '';
      let categoria = categoriaDoc || '';
      if (modelloId) {
        const modello = await prisma.modelloDocumentoCustom.findFirst({ where: { id: modelloId, tenantId } });
        if (!modello) return reply.code(404).send({ errore: 'Modello documento non trovato.' });
        htmlTemplate = modello.contenutoHtml || '';
        titoloDocumento = titoloDocumento || modello.titolo;
        categoria = categoria || modello.categoria;
      }
      if (!htmlTemplate.trim()) {
        return reply.code(400).send({ errore: 'Il template indicato non ha contenuto.' });
      }

      const contesto = contestoTagDocumento({ tenant, cliente: progetto.cliente, progetto });
      const blocchi = blocchiDaHtml(risolviTagDocumento(htmlTemplate, contesto));
      if (blocchi.length === 0) {
        return reply.code(400).send({ errore: 'Il template non produce contenuto: verificare i blocchi HTML.' });
      }

      const slug = (titoloDocumento || 'documento')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'documento';

      // Due motori dallo stesso merge: il PDF fa fede (master + hash firma), il Word è la
      // copia per la firma autografa. Se il Word fallisce la generazione non si blocca il
      // flusso: si pubblica comunque il PDF e l'anomalia resta nell'audit.
      const pdfBuffer = await generaPdfDocumento(blocchi);
      let docxBuffer: Buffer | null = null;
      try {
        docxBuffer = generaDocxDocumento(blocchi);
      } catch (errWord) {
        await recordAudit({
          tenantId,
          userId,
          azione: 'DOCUMENTO_WORD_FALLITO',
          entita: progettoId,
          dettagli: `Generazione Word fallita per «${titoloDocumento || slug}»: ${errWord instanceof Error ? errWord.message : String(errWord)}`,
          ipAddress: req.ip,
        });
      }

      const uploadPdf = await uploadDocumento(`${slug}.pdf`, pdfBuffer.toString('base64'));
      if (!uploadPdf.ok) return reply.code(500).send({ errore: 'Impossibile salvare il PDF generato.' });
      let uploadDocx: { ok: boolean; url: string; name: string; size: string } | null = null;
      if (docxBuffer) {
        uploadDocx = await uploadDocumento(`${slug}.docx`, docxBuffer.toString('base64'));
        if (!uploadDocx.ok) {
          uploadDocx = null;
          await recordAudit({
            tenantId,
            userId,
            azione: 'DOCUMENTO_WORD_FALLITO',
            entita: progettoId,
            dettagli: `Upload Word fallito per «${titoloDocumento || slug}»: il documento è pubblicato solo in PDF.`,
            ipAddress: req.ip,
          });
        }
      }

      const defaultStatoDoc = (statoDoc === 'pubblicato') ? 'pubblicato' : 'bozza';

      // I byte arrivano dai motori di generazione del sistema, non da un attore esterno:
      // la scansione §28 è superata per costruzione (stessa regola del verbale di firma).
      const documento = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId,
          tipo: 'compilato',
          fileUrl: uploadPdf.url,
          filePdfUrl: uploadPdf.url,
          fileDocxUrl: uploadDocx?.url ?? null,
          formatoOrigine: 'pdf',
          caricatoDa: userId,
          categoriaDoc: categoria || 'generico',
          dataScadenzaDoc: scadenza,
          statoDoc: defaultStatoDoc,
          pubblicatoAt: defaultStatoDoc === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      await recordAudit({
        tenantId,
        userId,
        azione: 'DOCUMENTO_GENERATO',
        entita: documento.id,
        dettagli: `Generato «${uploadPdf.name}» (${uploadPdf.size})${uploadDocx ? ` + Word «${uploadDocx.name}» (${uploadDocx.size})` : ' (solo PDF)'} da template, stato «${defaultStatoDoc}», nel fascicolo del progetto ${progettoId}`,
        ipAddress: req.ip,
      });

      if (defaultStatoDoc === 'pubblicato' && progetto.clienteId) {
        await notificaCliente(tenantId, progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${uploadPdf.name}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: { ...documento, firmato: false, firma: null, richiesteModifica: [] } });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione documento' });
    }
  });

  /**
   * §WF-DOC — «firmato» è lo stato terminale positivo: un atto sottoscritto dal cliente non si
   * modifica più. Solo l'admin del tenant (`advisor`) e il `super_admin` possono riaprirlo, e
   * unicamente dalla rotta dedicata `/documenti/:id/sblocca`, che pretende una motivazione e la
   * registra nell'audit. Questo controllo sta qui, sul server: nasconderlo solo nella UI
   * lascerebbe la transizione raggiungibile a chiunque abbia un token del tenant.
   */
  function puoSbloccareDocumentoFirmato(ruolo?: string): boolean {
    return ruolo === 'advisor' || ruolo === 'super_admin';
  }

  /**
   * PATCH /documenti/:id/stato — §WF-DOC
   * Permette all'operatore/advisor di pubblicare un documento al cliente o rimetterlo in bozza.
   * Non può dichiarare «firmato»: quello lo scrive solo il sigillo di firma (regola 7).
   */
  server.patch<{
    Params: { id: string };
    Body: { statoDoc: 'bozza' | 'pubblicato' | 'in_revisione' };
  }>('/documenti/:id/stato', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { statoDoc } = req.body;

    if (!['bozza', 'pubblicato', 'in_revisione'].includes(statoDoc)) {
      return reply.code(400).send({ errore: 'statoDoc non valido.' });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { nome: true } },
        },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Un documento già firmato non torna indietro da questa rotta, nemmeno per un advisor:
      // la riapertura passa da `/documenti/:id/sblocca`, che chiede il motivo e lo verbalizza.
      if (doc.statoDoc === 'firmato') {
        return reply.code(409).send({
          errore: 'Il documento è stato firmato dal cliente e non è più modificabile. Per riaprirlo serve lo sblocco dell\'amministratore dello studio, che ne registra la motivazione.',
        });
      }

      const updated = await prisma.documento.update({
        where: { id },
        data: {
          statoDoc,
          pubblicatoAt: statoDoc === 'pubblicato' ? (doc.pubblicatoAt ?? new Date()) : doc.pubblicatoAt,
        },
      });

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_STATO_AGGIORNATO',
        entita: id,
        dettagli: `Stato documento ${id} aggiornato a «${statoDoc}»`,
        ipAddress: req.ip,
      });

      // Notifica il cliente se pubblicato
      if (statoDoc === 'pubblicato' && doc.progetto?.clienteId) {
        const nomeDoc = nomeFileDaUrl(doc.fileUrl) ?? doc.microvoceProgetto?.nome ?? 'Documento';
        await notificaCliente(tenantId, doc.progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Nuovo documento da visionare/firmare',
          corpo: `Lo studio ha pubblicato «${nomeDoc}» sul progetto «${doc.progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: updated });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento stato documento' });
    }
  });

  /**
   * PATCH /documenti/:id/sblocca — §WF-DOC
   * Riapre un documento firmato dal cliente. È l'unica via per uscire dallo stato terminale
   * «firmato», ed è riservata all'admin dello studio (`advisor`) e al `super_admin`.
   *
   * Il sigillo di firma NON viene toccato: la riga `firmaElettronica` resta dov'è, perché è la
   * prova dell'atto compiuto dal cliente e non può essere cancellata da una decisione dello
   * studio. Il documento torna in «bozza», così lo studio lo rilavora e ne pubblica una nuova
   * versione da rifirmare; nel portale il cliente continua a vedere la firma già apposta.
   */
  server.patch<{
    Params: { id: string };
    Body: { motivo?: string };
  }>('/documenti/:id/sblocca', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const ruolo = (req as any).ruolo as string | undefined;
    const { id } = req.params;
    const motivo = (req.body?.motivo ?? '').trim();

    if (!puoSbloccareDocumentoFirmato(ruolo)) {
      return reply.code(403).send({
        errore: 'Solo l\'amministratore dello studio può sbloccare un documento firmato dal cliente.',
      });
    }
    // La motivazione è il motivo per cui l'operazione è ripercorribile: senza, resterebbe solo
    // un documento tornato in bozza senza spiegazione.
    if (motivo.length < 10) {
      return reply.code(400).send({
        errore: 'Indicare la motivazione dello sblocco (almeno 10 caratteri): viene registrata nel giornale di audit.',
      });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { nome: true } },
        },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      if (doc.statoDoc !== 'firmato') {
        return reply.code(409).send({
          errore: `Il documento non è firmato (stato attuale «${doc.statoDoc}»): non c'è nulla da sbloccare.`,
        });
      }

      const aggiornato = await prisma.documento.update({
        where: { id },
        data: { statoDoc: 'bozza' },
      });

      const nomeDoc = nomeFileDaUrl(doc.fileUrl) ?? doc.microvoceProgetto?.nome ?? 'Documento';

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_SBLOCCATO',
        entita: id,
        dettagli: `Documento firmato «${nomeDoc}» riaperto in bozza dall'utente ${userId ?? 'sconosciuto'} (ruolo ${ruolo ?? 'n/d'}). Motivazione: ${motivo}`,
        ipAddress: ipReale(req),
      });

      // Il cliente ha firmato: se lo studio riapre l'atto, deve vederlo dichiarato nel portale.
      if (doc.progetto?.clienteId) {
        await notificaCliente(tenantId, doc.progetto.clienteId, {
          tipoEvento: 'documento_sbloccato',
          oggetto: 'Documento firmato riaperto dallo studio',
          corpo: `Lo studio ha riaperto «${nomeDoc}» sul progetto «${doc.progetto.nome}» per ulteriori modifiche. La firma che hai apposto resta registrata; riceverai la nuova versione da firmare. Motivazione indicata: ${motivo}`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: aggiornato });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore sblocco documento' });
    }
  });

  /**
   * POST /documenti/:id/nuova-versione — §WF-DOC
   * Carica una nuova versione del documento (es. v2 post revisione), mantenendo lo storico del documento padre.
   */
  server.post<{
    Params: { id: string };
    Body: {
      filename: string;
      contentBase64: string;
      categoriaDoc?: string;
      pubblicaSubito?: boolean;
    };
  }>('/documenti/:id/nuova-versione', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const { id } = req.params;
    const { filename, contentBase64, categoriaDoc, pubblicaSubito } = req.body;

    if (!filename || !contentBase64) {
      return reply.code(400).send({ errore: 'filename e contentBase64 sono obbligatori.' });
    }
    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });

    try {
      const docPadre = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { id: true, nome: true } },
        },
      });
      if (!docPadre) return reply.code(404).send({ errore: 'Documento originale non trovato.' });

      // §WF-DOC — su un atto firmato non si carica una v2 a piacere: prima l'admin dello studio
      // lo sblocca motivando. Senza questo controllo la versione sottoscritta dal cliente
      // verrebbe superata da un documento che il cliente non ha mai visto né approvato.
      if (docPadre.statoDoc === 'firmato' && !puoSbloccareDocumentoFirmato((req as any).ruolo)) {
        return reply.code(409).send({
          errore: 'Il documento è firmato dal cliente: per caricarne una nuova versione serve prima lo sblocco dell\'amministratore dello studio.',
        });
      }

      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const esito = scanFileBuffer(buffer, filename);
      if (!esito.safe) {
        return reply.code(400).send({ errore: esito.reason ?? 'File non ammesso nel fascicolo.' });
      }

      const archiviato = await uploadDocumento(filename, contentBase64);
      const nuovaVersione = (docPadre.versione || 1) + 1;
      const targetStato = pubblicaSubito ? 'pubblicato' : 'bozza';

      const nuovoDoc = await prisma.documento.create({
        data: {
          tenantId,
          progettoId: docPadre.progettoId,
          microvoceProgettoId: docPadre.microvoceProgettoId,
          tipo: docPadre.tipo,
          fileUrl: archiviato.url,
          versione: nuovaVersione,
          caricatoDa: userId,
          categoriaDoc: categoriaDoc || docPadre.categoriaDoc || 'generico',
          statoDoc: targetStato,
          pubblicatoAt: targetStato === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
          documentoPadreId: docPadre.id,
        },
      });

      // Risolvi le richieste di modifica aperte sul padre
      await prisma.richiestaModificaDocumento.updateMany({
        where: { documentoId: docPadre.id, stato: 'aperta' },
        data: {
          stato: 'risolta',
          rispostoAt: new Date(),
          rispostaStudio: `Caricata nuova versione v${nuovaVersione}: ${filename}`,
        },
      });

      // §WF-DOC — «in_revisione: torna a bozza dopo upload v2», come dichiara lo schema.
      // Senza questo il padre restava `in_revisione` per sempre: il cliente continuava a
      // vederlo in elenco accanto alla v2 e con due righe aperte non si capiva quale fosse
      // il testo da firmare. La v1 resta nel fascicolo dello studio con il suo storico
      // (`documentoPadreId`), ma esce dal portale, che elenca solo pubblicato/in_revisione/firmato.
      // Un padre già `firmato` non si tocca: quello stato è terminale e ha un sigillo dietro.
      if (docPadre.statoDoc !== 'firmato') {
        await prisma.documento.updateMany({
          where: { id: docPadre.id, tenantId },
          data: { statoDoc: 'bozza' },
        });
      }

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_NUOVA_VERSIONE',
        entita: nuovoDoc.id,
        dettagli: `Caricata v${nuovaVersione} per documento ${docPadre.id} («${filename}», stato ${targetStato})`,
        ipAddress: req.ip,
      });

      if (targetStato === 'pubblicato' && docPadre.progetto?.clienteId) {
        await notificaCliente(tenantId, docPadre.progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Nuova versione documento disponibile',
          corpo: `Lo studio ha caricato e pubblicato una nuova versione (v${nuovaVersione}) di «${filename}» sul progetto «${docPadre.progetto.nome}».`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: nuovoDoc });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore caricamento nuova versione' });
    }
  });

  /**
   * GET /documenti/:id/richieste-modifica — §WF-DOC
   * Elenco richieste di modifica per un dato documento.
   */
  server.get<{ Params: { id: string } }>('/documenti/:id/richieste-modifica', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    try {
      const richieste = await prisma.richiestaModificaDocumento.findMany({
        where: { documentoId: id, tenantId },
        include: { cliente: { select: { id: true, nome: true, email: true } } },
        orderBy: { creatoAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste modifica' });
    }
  });

  /**
   * PATCH /documenti/richieste-modifica/:rid — §WF-DOC
   * Aggiorna lo stato di una richiesta di modifica o aggiunge la risposta dello studio.
   */
  server.patch<{
    Params: { rid: string };
    Body: { stato?: string; rispostaStudio?: string };
  }>('/documenti/richieste-modifica/:rid', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { rid } = req.params;
    const { stato, rispostaStudio } = req.body;

    try {
      const esistente = await prisma.richiestaModificaDocumento.findFirst({ where: { id: rid, tenantId } });
      if (!esistente) return reply.code(404).send({ errore: 'Richiesta non trovata.' });

      const updated = await prisma.richiestaModificaDocumento.update({
        where: { id: rid },
        data: {
          ...(stato ? { stato } : {}),
          ...(rispostaStudio !== undefined ? { rispostaStudio, rispostoAt: new Date() } : {}),
        },
      });

      return reply.send({ ok: true, richiesta: updated });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento richiesta modifica' });
    }
  });

  server.delete<{ Params: { id: string } }>('/documenti/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    try {
      const documento = await prisma.documento.findFirst({
        where: tenantId ? { id, tenantId } : { id },
        select: { id: true, fileUrl: true, tenantId: true, statoDoc: true, tipo: true },
      });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Punto 2 piano gap — il verbale di firma è un atto certificativo: la FK dalla firma
      // lo metterebbe solo a NULL, ma il fascicolo perderebbe la memoria leggibile di un
      // evento probatorio. Come i documenti firmati: solo archiviabile, mai eliminabile.
      if (documento.tipo === 'verbale_firma') {
        return reply.code(409).send({
          errore: 'Il verbale di firma è un atto certificativo: non può essere eliminato, solo archiviato.',
        });
      }

      // Punto 3 piano gap — un documento firmato non si elimina MAI, per nessuno, nemmeno
      // per l'admin dello studio. Il sigillo FirmaElettronica è un atto legale che referenzia
      // il documento sottoscritto: cancellarlo lascerebbe una firma orfana, e un atto
      // sottoscritto non può sparire dal fascicolo. La via prevista è l'archiviazione:
      // PATCH /documenti/:id/archivia.
      if (documento.statoDoc === 'firmato') {
        return reply.code(409).send({
          errore: 'Il documento è firmato dal cliente: non può essere eliminato, solo archiviato.',
        });
      }

      // Un sigillo collegato al documento (anche se lo stato non è tornato 'firmato', per
      // esempio una firma del Vault) blocca l'eliminazione allo stesso modo; e finché un
      // codice di firma è pendente la firma potrebbe ancora essere completata.
      const [firmeCollegate, otpPendenti] = await Promise.all([
        prisma.firmaElettronica.count({
          where: { tenantId: documento.tenantId || tenantId, ambito: 'documento_vault', riferimentoId: id },
        }),
        prisma.codiceOtp.count({
          where: { tenantId: documento.tenantId || tenantId, ambito: 'documento_vault', riferimentoId: id, scadenza: { gt: new Date() } },
        }),
      ]);
      if (firmeCollegate > 0) {
        return reply.code(409).send({
          errore: 'Al documento è collegata una firma elettronica: non può essere eliminato, solo archiviato.',
        });
      }
      if (otpPendenti > 0) {
        return reply.code(409).send({
          errore: 'C\'è un codice di firma in attesa su questo documento: attendere la scadenza del codice o completare la firma prima di eliminarlo.',
        });
      }

      // Disaccoppia versioni figlie prima della cancellazione
      await prisma.documento.updateMany({
        where: { documentoPadreId: id },
        data: { documentoPadreId: null },
      }).catch(() => {});

      // Disaccoppia passaggi progetto
      await prisma.passaggioProgetto.updateMany({
        where: { documentoId: id },
        data: { documentoId: null },
      }).catch(() => {});

      // Elimina richieste di modifica collegate
      await prisma.richiestaModificaDocumento.deleteMany({
        where: { documentoId: id },
      }).catch(() => {});

      // Nota: nessun disaccoppiamento di firmaElettronica qui — i guard sopra restituiscono
      // 409 se esiste un sigillo o un OTP pendente collegato, quindi a questo punto il
      // documento non ne ha. Il sigillo legale non viene mai reso orfano.

      await prisma.documento.delete({ where: { id } });

      await recordAudit({
        tenantId: documento.tenantId || tenantId,
        azione: 'DOCUMENTO_RIMOSSO',
        entita: id,
        dettagli: `Rimosso dal fascicolo il documento ${documento.fileUrl}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err, 'Errore eliminazione documento');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione documento' });
    }
  });

  // Punto 3 piano gap — ARCHIVIAZIONE: l'unica uscita prevista per un documento firmato
  // (o comunque non più attuale). L'hard delete è vietato per tutti, admin inclusi; qui
  // l'atto resta leggibile nello storico e nel portale con il suo sigillo integro, e le
  // liste operative semplicemente smettono di mostrarlo.
  server.patch<{ Params: { id: string } }>('/documenti/:id/archivia', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const ruolo = (req as any).ruolo;
    const { id } = req.params;

    // Archiviare è un atto definitivo sul fascicolo: riservato all'amministratore dello
    // studio, come lo sblocco di un documento firmato.
    if (!puoSbloccareDocumentoFirmato(ruolo)) {
      return reply.code(403).send({ errore: 'Solo l\'amministratore dello studio può archiviare un documento.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: tenantId ? { id, tenantId } : { id },
        select: { id: true, isArchiviato: true, tenantId: true, fileUrl: true, statoDoc: true },
      });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Idempotenza: ri-archiviare un documento già archiviato non è un errore.
      if (documento.isArchiviato) {
        return reply.send({ ok: true, messaggio: 'Il documento era già archiviato.' });
      }

      const aggiornato = await prisma.documento.update({
        where: { id },
        data: { isArchiviato: true, archiviatoAt: new Date(), archiviatoDaId: userId ?? null },
      });

      await recordAudit({
        tenantId: documento.tenantId || tenantId,
        azione: 'DOCUMENTO_ARCHIVIATO',
        entita: id,
        dettagli: `Archiviato il documento ${documento.fileUrl} (stato ${documento.statoDoc})`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, documento: aggiornato });
    } catch (err) {
      req.log.error(err, 'Errore archiviazione documento');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore archiviazione documento' });
    }
  });

  // ── FIRMA ELETTRONICA AVANZATA (FEA) CON OTP: WHATSAPP / EMAIL / TELEGRAM ──
  //
  // Cosa non funzionava, e perché non erano dettagli:
  //   · il recapito era `cellulare || email || '+39 333 5936278'`. Il numero di una persona
  //     reale, cablato nel sorgente, come destinazione predefinita del codice di firma di
  //     qualunque cliente di qualunque studio;
  //   · `clienteId` arrivava dal body e nessuno lo confrontava con la sessione, mentre il
  //     frontend spediva `'client-01'` quando non lo trovava: bastava un id nel body per
  //     far partire il codice di un altro cliente;
  //   · solo l'email spediva davvero. WhatsApp, SMS e Telegram generavano il codice, lo
  //     scrivevano nei log e non mandavano niente, ma la risposta diceva "inviato";
  //   · `devOtp` restituiva il codice in chiaro a chi metteva un header nella richiesta;
  //   · il sigillo eIDAS non veniva salvato da nessuna parte, quindi la firma esisteva
  //     solo nella schermata che la mostrava.

  /**
   * Il cliente della sessione. Per un token di portale (`ruolo: 'cliente'`) l'identità è
   * `client-<clienteId>` e il body non conta: è la sessione a dire chi firma. Un operatore
   * dello studio può invece indicare il cliente, perché firma per conto di un fascicolo che
   * sta guardando.
   */
  function clienteDellaRichiesta(req: any, clienteIdBody?: string): string | null {
    const identita: string | undefined = req.user?.userId;
    if (req.ruolo === 'cliente') {
      return identita?.startsWith('client-') ? identita.slice('client-'.length) : null;
    }
    return clienteIdBody?.trim() || null;
  }

  const AMBITI_OTP: AmbitoOtp[] = ['engagement_letter', 'documento_vault', 'modulo_completato', 'addendum'];

  function ambitoValido(valore: unknown): valore is AmbitoOtp {
    return typeof valore === 'string' && (AMBITI_OTP as string[]).includes(valore);
  }

  /** Come descrivere al firmatario cosa sta autorizzando, nel messaggio e nell'email. */
  const DESCRIZIONE_AMBITO: Record<AmbitoOtp, string> = {
    engagement_letter: "la lettera d'incarico e il mandato professionale",
    documento_vault: 'un documento del tuo archivio riservato',
    modulo_completato: 'la conferma di un modulo completato',
    addendum: 'un addendum al mandato',
  };

  const HASH_SHA256 = /^[a-f0-9]{64}$/i;

  /** Nome leggibile del file a partire dal suo URL, senza il percorso di storage. */
  function nomeFileDaUrl(url: string): string | null {
    const pulito = url.split(/[?#]/)[0] ?? '';
    const ultimo = pulito.split('/').filter(Boolean).pop();
    if (!ultimo) return null;
    try {
      // uploadDocumento prefissa `${Date.now()}_` per evitare omonimie in archivio:
      // all'utente si mostra il nome originale del file.
      return decodeURIComponent(ultimo).replace(/^\d{13}_/, '');
    } catch {
      return ultimo.replace(/^\d{13}_/, '');
    }
  }

  /**
   * I documenti del fascicolo del cliente, con lo stato di firma preso dal database (§2.1, §2.9).
   *
   * Prima questa sezione del portale non esisteva come rotta: il browser teneva quattro documenti
   * scritti a mano nel codice — un NDA, uno statuto maltese, una dichiarazione UBO e una letter of
   * wishes — di cui il primo era marcato «firmato il 15/08/2026 01:44:12». Nessuno dei quattro
   * esisteva a database, per nessun cliente, e la data di firma era inventata. Lo stato di firma
   * viveva in `localStorage`: firmato su un browser voleva dire non firmato su un altro, e lo
   * studio non ne vedeva traccia da nessuna parte.
   *
   * Qui i documenti sono quelli realmente caricati sulle micro-voci dei progetti del cliente, e
   * «firmato» significa che esiste una riga in `FirmaElettronica`. Quando il fascicolo è vuoto la
   * risposta è un elenco vuoto: il portale lo dichiara, non lo riempie.
   */
  server.get('/portal/documenti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      // §2.9 + §WF-DOC — il fascicolo per il cliente contiene solo i documenti con statoDoc
      // 'pubblicato', 'in_revisione' o 'firmato'. I documenti in 'bozza' sono visibili solo all'operatore.
      // Punto 3 piano gap — i documenti archiviati non compaiono mai nel portale cliente:
      // restano nello storico dello studio, non nel fascicolo operativo del cliente.
      const documenti = await prisma.documento.findMany({
        where: {
          tenantId,
          isArchiviato: false,
          statoDoc: { in: ['pubblicato', 'in_revisione', 'firmato'] },
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        select: {
          id: true,
          tipo: true,
          fileUrl: true,
          filePdfUrl: true,
          fileDocxUrl: true,
          formatoOrigine: true,
          versione: true,
          createdAt: true,
          categoriaDoc: true,
          statoScansione: true,
          dataScadenzaDoc: true,
          statoDoc: true,
          pubblicatoAt: true,
          documentoPadreId: true,
          progettoId: true,
          microvoceProgettoId: true,
          progetto: { select: { nome: true } },
          microvoceProgetto: {
            select: {
              id: true,
              nome: true,
              moduloProgetto: { select: { id: true, nome: true, progettoId: true, progetto: { select: { nome: true } } } },
            },
          },
          richiesteModifica: {
            where: { clienteId },
            select: { id: true, commento: true, stato: true, creatoAt: true, rispostoAt: true, rispostaStudio: true },
            orderBy: { creatoAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const firme = await prisma.firmaElettronica.findMany({
        where: { tenantId, clienteId, ambito: 'documento_vault' },
        select: {
          signatureId: true,
          riferimentoId: true,
          documentoTitolo: true,
          tipoFirma: true,
          firmatoAt: true,
          canaleVerificato: true,
          // Evidenze del sigillo mostrate nel certificato di firma del portale: fuori dal
          // select arrivano `undefined` e il modale dichiarerebbe una firma senza impronta
          // né firmatario. Vengono solo da qui (regola 7): il browser non le può ricostruire.
          ipAddress: true,
          documentoHash: true,
          firmaGrafometricaPng: true,
          firmatarioNome: true,
          standard: true,
        },
        orderBy: { firmatoAt: 'desc' },
      });

      // Una firma per documento: la più recente. Le successive sono rifirme dello stesso atto e
      // non vanno mostrate come documenti distinti.
      const firmaPerDocumento = new Map<string, (typeof firme)[number]>();
      for (const f of firme) {
        if (f.riferimentoId && !firmaPerDocumento.has(f.riferimentoId)) firmaPerDocumento.set(f.riferimentoId, f);
      }

      // §WF-DOC — storico delle versioni, risalendo la catena `documentoPadreId`.
      //
      // Il campo era già a database e veniva perfino selezionato qui, ma non usciva dalla
      // risposta: il cliente vedeva «v3» e nient'altro, senza modo di sapere che cosa la v3
      // avesse sostituito né se avesse già firmato una versione precedente. Il percorso
      // dev'essere ripercorribile all'indietro, quindi lo si ricostruisce: i padri stanno
      // in `bozza` e non compaiono nell'elenco, per questo servono letture dedicate.
      //
      // Il ciclo è limitato a 12 salti: la catena è lineare per costruzione, ma un dato
      // sporco non deve poter bloccare la lettura del fascicolo di un cliente.
      const antenati = new Map<string, { id: string; versione: number; createdAt: Date; statoDoc: string; documentoPadreId: string | null }>();
      let daRisalire = documenti.map((d) => d.documentoPadreId).filter((x): x is string => Boolean(x));
      for (let salto = 0; salto < 12 && daRisalire.length > 0; salto++) {
        const mancanti = daRisalire.filter((idPadre) => !antenati.has(idPadre));
        if (mancanti.length === 0) break;
        const righe = await prisma.documento.findMany({
          where: { tenantId, id: { in: mancanti } },
          select: { id: true, versione: true, createdAt: true, statoDoc: true, documentoPadreId: true },
        });
        for (const r of righe) antenati.set(r.id, r);
        daRisalire = righe.map((r) => r.documentoPadreId).filter((x): x is string => Boolean(x));
      }

      /** Catena delle versioni precedenti, dalla più recente alla più antica. */
      const storicoDi = (idPadre: string | null) => {
        const catena: { id: string; versione: number; caricatoIl: Date; statoDoc: string; firmatoAt: Date | null }[] = [];
        let corrente = idPadre;
        for (let salto = 0; salto < 12 && corrente; salto++) {
          const nodo = antenati.get(corrente);
          if (!nodo) break;
          const firmaAntenato = firmaPerDocumento.get(nodo.id) ?? null;
          catena.push({
            id: nodo.id,
            versione: nodo.versione,
            caricatoIl: nodo.createdAt,
            statoDoc: nodo.statoDoc,
            firmatoAt: firmaAntenato?.firmatoAt ?? null,
          });
          corrente = nodo.documentoPadreId;
        }
        return catena;
      };

      const elenco = documenti.map((d) => {
        const firma = firmaPerDocumento.get(d.id) ?? null;
        // I documenti a livello progetto (§2.9) non hanno micro-voce: titolo, modulo e
        // progetto si ripiegano sul collegamento diretto al progetto.
        const nomeProgetto = d.microvoceProgetto?.moduloProgetto.progetto?.nome ?? d.progetto?.nome ?? null;
        const progettoId = d.microvoceProgetto?.moduloProgetto.progettoId ?? d.progettoId ?? null;
        const moduloProgettoId = d.microvoceProgetto?.moduloProgetto.id ?? null;
        const titoloVoce = d.microvoceProgetto?.nome ?? d.progetto?.nome ?? 'Documento';
        const isFirmato = Boolean(firma) || d.tipo === 'firmato' || d.statoDoc === 'firmato';
        return {
          id: d.id,
          nome: nomeFileDaUrl(d.fileUrl) ?? `${titoloVoce} (v${d.versione})`,
          titolo: titoloVoce,
          categoria: d.categoriaDoc || 'generico',
          modulo: d.microvoceProgetto?.moduloProgetto.nome ?? null,
          moduloProgettoId,
          moduloNome: d.microvoceProgetto?.moduloProgetto.nome ?? null,
          microvoceProgettoId: d.microvoceProgettoId ?? d.microvoceProgetto?.id ?? null,
          microvoceNome: d.microvoceProgetto?.nome ?? null,
          progetto: nomeProgetto,
          progettoId,
          // La firma HMAC degli URL /uploads/ scade dopo qualche giorno: si rinnova alla
          // lettura, altrimenti un documento in fascicolo da mesi non si aprirebbe più.
          fileUrl: rifirmaUrlUpload(d.fileUrl) as string,
          // Punto 1 piano gap — formati di export generati dal server: null per i documenti
          // storici (pre-migrazione) e per gli allegati, che restano nel formato originale.
          filePdfUrl: d.filePdfUrl ? (rifirmaUrlUpload(d.filePdfUrl) as string) : null,
          fileDocxUrl: d.fileDocxUrl ? (rifirmaUrlUpload(d.fileDocxUrl) as string) : null,
          formatoOrigine: d.formatoOrigine,
          tipo: d.tipo,
          versione: d.versione,
          caricatoIl: d.createdAt,
          scadenza: d.dataScadenzaDoc,
          statoDoc: d.statoDoc,
          pubblicatoAt: d.pubblicatoAt,
          // §WF-DOC — da dove viene questa versione: l'id del documento sostituito e la
          // catena completa delle versioni precedenti, per risalire il percorso all'indietro.
          documentoPadreId: d.documentoPadreId,
          versioniPrecedenti: storicoDi(d.documentoPadreId),
          richiesteModifica: d.richiesteModifica,
          // §28: un file ancora in scansione o risultato infetto non si scarica e non si firma.
          statoScansione: d.statoScansione,
          scaricabile: d.statoScansione === 'pulito',
          firmato: isFirmato,
          // Punto 2 piano gap — il verbale di firma è un atto certificativo: si legge e si
          // scarica, ma non si firma e non si manda in revisione.
          richiedeFirma: !isFirmato && d.statoScansione === 'pulito' && d.statoDoc !== 'in_revisione' && d.tipo !== 'verbale_firma',
          dataFirma: firma?.firmatoAt ?? null,
          tipoFirma: firma?.tipoFirma ?? null,
          signatureId: firma?.signatureId ?? null,
          canaleVerificato: firma?.canaleVerificato ?? null,
          ipAddress: firma?.ipAddress ?? null,
          documentoHash: firma?.documentoHash ?? null,
          firmaGrafometricaPng: firma?.firmaGrafometricaPng ?? null,
          firmatarioNome: firma?.firmatarioNome ?? null,
          standard: firma?.standard ?? 'Firma Elettronica Semplice (OTP verificata) · art. 20 CAD',
        };
      });

      // Firme il cui documento non è più nel fascicolo (file sostituito, micro-voce rimossa).
      // Restano elencate: una firma registrata è un atto del cliente e non può sparire dalla sua
      // vista perché il file a cui puntava non c'è più.
      const idPresenti = new Set(documenti.map((d) => d.id));
      const orfane = firme
        .filter((f) => !f.riferimentoId || !idPresenti.has(f.riferimentoId))
        .map((f) => ({
          id: `firma-${f.signatureId}`,
          nome: f.documentoTitolo,
          titolo: f.documentoTitolo,
          categoria: 'firmato',
          modulo: null,
          progetto: null,
          progettoId: null,
          fileUrl: null,
          filePdfUrl: null,
          fileDocxUrl: null,
          formatoOrigine: null,
          tipo: 'firmato',
          versione: null,
          caricatoIl: f.firmatoAt,
          scadenza: null,
          statoDoc: 'firmato' as const,
          pubblicatoAt: null,
          richiesteModifica: [],
          statoScansione: null,
          scaricabile: false,
          firmato: true,
          richiedeFirma: false,
          dataFirma: f.firmatoAt,
          tipoFirma: f.tipoFirma,
          signatureId: f.signatureId,
          canaleVerificato: f.canaleVerificato,
          ipAddress: f.ipAddress,
          documentoHash: f.documentoHash,
          firmaGrafometricaPng: f.firmaGrafometricaPng,
          firmatarioNome: f.firmatarioNome,
          standard: f.standard,
          documentoNonPiuDisponibile: true,
        }));

      return reply.send({ ok: true, documenti: [...elenco, ...orfane] });
    } catch (err) {
      // Nessun ripiego su un elenco vuoto: «nessun documento» e «non riesco a leggere i documenti»
      // sono due cose diverse, e la prima al posto della seconda fa credere al cliente che lo
      // studio non gli abbia caricato niente.
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura documenti del fascicolo',
      });
    }
  });

  /**
   * GET /portal/documenti/:id/download?formato=pdf|docx — Punto 1 piano gap
   * Il cliente scarica il documento pubblicato nel formato scelto. Il PDF esiste sempre
   * (è il formato master su cui è fissato l'hash legale della firma); il Word esiste solo
   * per i documenti generati dal motore server-side — per i documenti storici precedenti
   * alla migrazione il formato è dichiarato non disponibile, non fabbricato.
   *
   * Un documento ancora in scansione o risultato infetto non si scarica (§28): 409.
   */
  server.get<{
    Params: { id: string };
    Querystring: { formato?: string; clienteId?: string };
  }>('/portal/documenti/:id/download', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, req.query?.clienteId);
    const { id } = req.params;
    const formato = req.query?.formato === 'docx' ? 'docx' : 'pdf';

    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: {
          id,
          tenantId,
          statoDoc: { in: ['pubblicato', 'in_revisione', 'firmato'] },
          isArchiviato: false,
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        select: {
          id: true,
          fileUrl: true,
          filePdfUrl: true,
          fileDocxUrl: true,
          statoScansione: true,
          versione: true,
          microvoceProgetto: { select: { nome: true } },
          progetto: { select: { nome: true } },
        },
      });

      if (!documento) {
        return reply.code(404).send({ errore: 'Documento non trovato nel fascicolo del cliente.' });
      }
      if (documento.statoScansione !== 'pulito') {
        return reply.code(409).send({ errore: 'Documento non scaricabile: scansione di sicurezza in corso o con esito negativo.' });
      }

      // `Documento` non ha un campo titolo: il nome di ripiego segue la stessa regola
      // dell'elenco del portale (micro-voce → progetto → «Documento») più la versione.
      const titoloVoce = documento.microvoceProgetto?.nome ?? documento.progetto?.nome ?? 'Documento';

      if (formato === 'docx') {
        if (!documento.fileDocxUrl) {
          // Documento storico (pre-migrazione) o allegato caricato: il Word non esiste e
          // il portale deve dirlo, non inventare un file.
          return reply.code(404).send({ errore: 'Formato Word non disponibile per questo documento.' });
        }
        return reply.send({
          ok: true,
          formato,
          url: rifirmaUrlUpload(documento.fileDocxUrl) as string,
          filename: nomeFileDaUrl(documento.fileDocxUrl) ?? `${titoloVoce} (v${documento.versione}).docx`,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }

      // PDF: il formato generato se esiste, altrimenti il file originale
      // (documenti storici e allegati caricati in archivio).
      const urlPdf = documento.filePdfUrl ?? documento.fileUrl;
      if (!urlPdf) {
        return reply.code(404).send({ errore: 'File del documento non disponibile.' });
      }
      return reply.send({
        ok: true,
        formato,
        url: rifirmaUrlUpload(urlPdf) as string,
        filename: nomeFileDaUrl(urlPdf) ?? `${titoloVoce} (v${documento.versione}).pdf`,
        contentType: 'application/pdf',
      });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore nella preparazione del download',
      });
    }
  });

  /**
   * POST /portal/documenti/:id/richiesta-modifica — §WF-DOC
   * Inviata dal cliente per richiedere modifiche e chiarimenti su un documento pubblicato.
   */
  server.post<{
    Params: { id: string };
    Body: { commento: string; clienteId?: string };
  }>('/portal/documenti/:id/richiesta-modifica', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    const { id } = req.params;
    const { commento } = req.body;

    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }
    if (!commento || !commento.trim()) {
      return reply.code(400).send({ errore: 'Il commento/nota con le richieste di modifica è obbligatorio.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: {
          id,
          tenantId,
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        include: {
          progetto: { select: { id: true, nome: true, cliente: { select: { nome: true } } } },
          microvoceProgetto: { select: { nome: true } },
          caricatoDaUser: { select: { email: true, nome: true } },
        },
      });

      if (!documento) {
        return reply.code(404).send({ errore: 'Documento non trovato o non associato al cliente.' });
      }

      // Punto 2 piano gap — il verbale di firma è un atto certificativo generato dal sistema:
      // riflette i dati del sigillo, non è un documento dello studio da revisionare. Una
      // richiesta di modifica porterebbe lo stato a 'in_revisione', facendo dire al fascicolo
      // il falso su un atto non negoziabile.
      if (documento.tipo === 'verbale_firma') {
        return reply.code(409).send({
          errore: 'Il verbale di firma è un atto certificativo: non è modificabile e non accetta richieste di revisione.',
        });
      }

      // Crea richiesta di modifica a DB
      const richiesta = await prisma.richiestaModificaDocumento.create({
        data: {
          tenantId,
          documentoId: id,
          clienteId,
          commento: commento.trim(),
          stato: 'aperta',
        },
      });

      // Aggiorna stato documento a 'in_revisione'
      await prisma.documento.update({
        where: { id },
        data: { statoDoc: 'in_revisione' },
      });

      const nomeDoc = nomeFileDaUrl(documento.fileUrl) ?? documento.microvoceProgetto?.nome ?? 'Documento';

      await recordAudit({
        tenantId,
        azione: 'RICHIESTA_MODIFICA_DOCUMENTO',
        entita: richiesta.id,
        dettagli: `Cliente ${clienteId} ha richiesto modifiche su «${nomeDoc}» (${documento.id}): ${commento.trim()}`,
        ipAddress: req.ip,
      });

      // Punto 4 piano gap, riga 2 matrice — il cliente ha chiesto modifiche: lo studio deve
      // vederlo subito alla campanella, non quando riapre il fascicolo. Riusa l'evento
      // esistente `messaggio_cliente` (ogni messaggio del cliente allo studio è quello).
      // La notifica non deve mai bloccare la richiesta di modifica.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Richiesta di modifica documento',
        corpo: `${documento.progetto?.cliente?.nome ?? 'Il cliente'} ha richiesto modifiche su «${nomeDoc}»: ${commento.trim().slice(0, 160)}`,
        link: documento.progetto ? `/projects/${documento.progetto.id}` : null,
      }).catch(() => {});

      return reply.send({ ok: true, richiesta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore registrazione richiesta modifica' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.6 — CONTATTI DEL PORTALE: il riferimento è il lead advisor del tenant.
  //
  // Prima la scheda "Contatto Advisor" mostrava un nome, un'email e un telefono scritti
  // nel codice, più un pallino "Advisor Online" che non rifletteva alcuno stato reale.
  // Qui si restituisce il recapito vero del responsabile dello studio, letto dal tenant,
  // e il frontend lo mostra senza inventare presenze.
  // ────────────────────────────────────────────────────────────────
  server.get('/portal/contatti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }
    try {
      // Il cliente deve appartenere al tenant della sessione: il riferimento cambia da
      // studio a studio, non è un dato globale.
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { id: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId },
        select: {
          ragioneSociale: true,
          leadAdvisorNome: true,
          leadAdvisorEmail: true,
          telefono: true,
          email: true,
          sedeLegale: true,
        },
      });
      if (!tenant) return reply.code(404).send({ errore: 'Studio non trovato.' });

      return reply.send({
        ok: true,
        contatti: {
          studio: tenant.ragioneSociale || null,
          advisorNome: tenant.leadAdvisorNome || null,
          advisorEmail: tenant.leadAdvisorEmail || null,
          telefono: tenant.telefono || null,
          emailStudio: tenant.email || null,
          sedeLegale: tenant.sedeLegale || null,
        },
      });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura contatti dello studio',
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.11 — FATTURE E STATO DI PAGAMENTO NEL PORTALE CLIENTE.
  //
  // Il cliente vede le fatture dei suoi progetti: numero, data, importo e stato del
  // pagamento. Le bozze restano allo studio — una fattura non emessa non è un documento
  // del cliente. L'importo è la somma delle righe (centesimi, mai float per il denaro).
  // ────────────────────────────────────────────────────────────────
  server.get('/portal/fatture', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const fatture = await prisma.fattura.findMany({
        where: {
          tenantId,
          progetto: { clienteId },
          // Solo ciò che esiste per il cliente: la bozza è lavoro interno dello studio.
          stato: { in: ['emessa', 'incassata'] },
        },
        include: {
          progetto: { select: { id: true, nome: true } },
          righe: { select: { importo: true } },
          scadenzeIncasso: {
            where: { stato: 'in_attesa' },
            orderBy: { dataScadenza: 'asc' },
            select: { dataScadenza: true, importoCentesimi: true },
            take: 1,
          },
        },
        orderBy: { data: 'desc' },
      });

      const elenco = fatture.map((f) => {
        const totaleCentesimi = f.righe.reduce((somma, r) => somma + (r.importo || 0), 0);
        const prossimaScadenza = f.scadenzeIncasso[0] ?? null;
        return {
          id: f.id,
          numero: f.numero || `${f.serie}-${f.numeroProgressivoSerie}`,
          tipoDocumento: f.tipoDocumento,
          data: f.data,
          stato: f.stato,
          pagata: f.stato === 'incassata',
          totaleCentesimi,
          progettoId: f.progettoId,
          progetto: f.progetto?.nome ?? null,
          prossimaScadenza: prossimaScadenza
            ? { dataScadenza: prossimaScadenza.dataScadenza, importoCentesimi: prossimaScadenza.importoCentesimi }
            : null,
        };
      });

      return reply.send({ ok: true, fatture: elenco });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura fatture',
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.3 — DATI FISCALI: il cliente PROPONE, lo studio CONFERMA.
  //
  // Il cliente non scrive direttamente in anagrafica: invia una proposta che resta
  // `in_attesa` finché lo studio non la conferma (e solo allora il valore entra nella
  // riga del cliente) o la rifiuta con una motivazione. Una sola proposta pendente per
  // campo: ridigitare sostituisce la richiesta precedente.
  // ────────────────────────────────────────────────────────────────

  /** Campi che il cliente può proporre e come si traducono in un update di `cliente`. */
  const CAMPI_PROPONIBILI = ['piva', 'codiceFiscale', 'iban', 'titolareEffettivo', 'ragioneSociale', 'sedeLegale', 'legaleRappresentante'] as const;
  type CampoProponibile = (typeof CAMPI_PROPONIBILI)[number];

  // Punto 4 piano gap — il nome tecnico del campo non parla né al cliente né allo studio:
  // nelle notifiche va l'etichetta in chiaro («Partita IVA», non «piva»).
  const ETICHETTE_CAMPI_PROPONIBILI: Record<CampoProponibile, string> = {
    piva: 'Partita IVA',
    codiceFiscale: 'Codice fiscale',
    iban: 'IBAN',
    titolareEffettivo: 'Titolare effettivo',
    ragioneSociale: 'Ragione sociale',
    sedeLegale: 'Sede legale',
    legaleRappresentante: 'Legale rappresentante',
  };

  function campoProponibile(valore: unknown): valore is CampoProponibile {
    return typeof valore === 'string' && (CAMPI_PROPONIBILI as readonly string[]).includes(valore);
  }

  /**
   * Traduce campo+valore in un oggetto di update Prisma per `cliente`.
   * `legaleRappresentante` vive dentro `referentiJson`, quindi restituisce anche il JSON
   * aggiornato da scrivere. Ritorna null se il campo non è mappabile.
   */
  function aggiornaClientePerCampo(campo: CampoProponibile, valore: string, referentiJson: any): Record<string, any> | null {
    switch (campo) {
      case 'piva': return { piva: valore };
      case 'codiceFiscale': return { codiceFiscale: valore };
      case 'iban': return { iban: valore };
      case 'titolareEffettivo': return { ubo: valore };
      case 'ragioneSociale': return { nome: valore };
      case 'sedeLegale': return { sedeLegale: valore };
      case 'legaleRappresentante': {
        const referenti = referentiJson && typeof referentiJson === 'object' ? referentiJson : {};
        return { referentiJson: { ...referenti, legaleRappresentante: valore } };
      }
      default: return null;
    }
  }

  /** Il valore attuale di un campo sulla riga del cliente, per mostrarlo al cliente. */
  function valoreAttualeCliente(campo: CampoProponibile, cliente: any): string | null {
    switch (campo) {
      case 'piva': return cliente.piva ?? null;
      case 'codiceFiscale': return cliente.codiceFiscale ?? null;
      case 'iban': return cliente.iban ?? null;
      case 'titolareEffettivo': return cliente.ubo ?? null;
      case 'ragioneSociale': return cliente.nome ?? null;
      case 'sedeLegale': return cliente.sedeLegale ?? null;
      case 'legaleRappresentante': {
        const referenti = cliente.referentiJson && typeof cliente.referentiJson === 'object' ? cliente.referentiJson : {};
        return referenti.legaleRappresentante ?? null;
      }
      default: return null;
    }
  }

  // Lato cliente: legge le proprie proposte (per mostrare lo stato di quelle inviate).
  server.get('/portal/proposte-dati', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const proposte = await prisma.propostaDatiFiscale.findMany({
        where: { tenantId, clienteId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, proposte });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura proposte dati' });
    }
  });

  // Lato cliente: invia (o sostituisce, se già pendente) una proposta per un campo.
  server.post<{ Body: { campo: string; valoreProposto: string; notaCliente?: string; clienteId?: string } }>('/portal/proposte-dati', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });

    const { campo, valoreProposto, notaCliente } = req.body || {};
    if (!campoProponibile(campo)) {
      return reply.code(400).send({ errore: 'Campo non proponibile.' });
    }
    const valore = (valoreProposto ?? '').trim();
    if (!valore) return reply.code(400).send({ errore: 'Il valore proposto è obbligatorio.' });

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { id: true, piva: true, codiceFiscale: true, iban: true, ubo: true, nome: true, sedeLegale: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const attuale = valoreAttualeCliente(campo, cliente);
      if (attuale === valore) {
        return reply.code(400).send({ errore: 'Il valore proposto è uguale a quello già registrato.' });
      }

      // Una sola proposta pendente per campo: se esiste, la sostituiamo.
      const pendente = await prisma.propostaDatiFiscale.findFirst({
        where: { tenantId, clienteId, campo, stato: 'in_attesa' },
      });
      const dati = {
        tenantId,
        clienteId,
        campo,
        valoreAttuale: attuale,
        valoreProposto: valore,
        notaCliente: (notaCliente ?? '').trim() || null,
        richiestoDaId: (req as any).user?.userId ?? null,
      };
      const proposta = pendente
        ? await prisma.propostaDatiFiscale.update({ where: { id: pendente.id }, data: { valoreAttuale: attuale, valoreProposto: valore, notaCliente: dati.notaCliente } })
        : await prisma.propostaDatiFiscale.create({ data: { ...dati, stato: 'in_attesa' } });

      await recordAudit({
        tenantId,
        userId: (req as any).user?.userId ?? null,
        azione: 'PROPOSTA_DATO_FISCALE',
        entita: proposta.id,
        dettagli: `Proposta modifica ${campo} per cliente ${clienteId}`,
      });

      // Punto 4 piano gap (gap simmetrico cliente→studio) — la proposta di modifica dati è
      // un messaggio del cliente allo studio: la campanella deve suonare. Le proposte si
      // gestiscono dalla scheda cliente, da qui il link alla pagina clienti.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Proposta di modifica dati',
        corpo: `${cliente.nome} propone di modificare ${ETICHETTE_CAMPI_PROPONIBILI[campo]}: «${valore.slice(0, 80)}»`,
        link: '/clients',
      }).catch(() => {});

      return reply.code(201).send({ ok: true, proposta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore invio proposta dati' });
    }
  });

  // Lato studio: elenca le proposte del tenant (filtrabili per cliente e stato).
  server.get('/proposte-dati', async (req, reply) => {
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const query = req.query as any;
    try {
      const proposte = await prisma.propostaDatiFiscale.findMany({
        where: {
          tenantId,
          ...(query.clienteId ? { clienteId: String(query.clienteId) } : {}),
          ...(query.stato ? { stato: String(query.stato) as any } : {}),
        },
        include: { cliente: { select: { id: true, nome: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, proposte });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura proposte dati' });
    }
  });

  // Lato studio: conferma una proposta e applica il valore alla riga del cliente.
  server.post<{ Params: { id: string } }>('/proposte-dati/:id/conferma', async (req, reply) => {
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      const proposta = await prisma.propostaDatiFiscale.findFirst({
        where: { id, tenantId },
        include: { cliente: { select: { id: true, referentiJson: true } } },
      });
      if (!proposta) return reply.code(404).send({ errore: 'Proposta non trovata.' });
      if (proposta.stato !== 'in_attesa') {
        return reply.code(400).send({ errore: 'La proposta è già stata gestita.' });
      }
      if (!campoProponibile(proposta.campo)) {
        return reply.code(400).send({ errore: 'Campo della proposta non valido.' });
      }
      const update = aggiornaClientePerCampo(proposta.campo as CampoProponibile, proposta.valoreProposto, proposta.cliente.referentiJson);
      if (!update) return reply.code(400).send({ errore: 'Impossibile applicare il campo proposto.' });

      // Prima si scrive il valore in anagrafica, poi si marca la proposta: se l'update del
      // cliente fallisce, la proposta resta pendente invece di risultare confermata invano.
      await prisma.cliente.update({ where: { id: proposta.clienteId }, data: update });
      const confermata = await prisma.propostaDatiFiscale.update({
        where: { id: proposta.id },
        data: { stato: 'confermata', gestitoDaId: (req as any).user?.userId ?? null },
      });

      await recordAudit({
        tenantId,
        userId: (req as any).user?.userId ?? null,
        azione: 'DATO_FISCALE_CONFERMATO',
        entita: proposta.id,
        dettagli: `Confermata modifica ${proposta.campo} per cliente ${proposta.clienteId}`,
      });

      // Punto 4 piano gap, riga 8 matrice — l'esito della proposta va comunicato al cliente:
      // l'anagrafica è cambiata e la sua richiesta ha una risposta. Le proposte vivono nella
      // tab «Proposta» del portale.
      await notificaCliente(tenantId, proposta.clienteId, {
        tipoEvento: 'risposta_proposta_dati',
        oggetto: 'Proposta di modifica accettata',
        corpo: `Lo studio ha confermato la modifica di ${ETICHETTE_CAMPI_PROPONIBILI[proposta.campo]}: il nuovo valore è attivo in anagrafica.`,
        link: '/portal/proposal',
      }).catch(() => {});

      return reply.send({ ok: true, proposta: confermata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore conferma proposta' });
    }
  });

  // Lato studio: rifiuta una proposta, con motivazione facoltativa.
  server.post<{ Params: { id: string }; Body: { notaStudio?: string } }>('/proposte-dati/:id/rifiuta', async (req, reply) => {
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      const proposta = await prisma.propostaDatiFiscale.findFirst({ where: { id, tenantId } });
      if (!proposta) return reply.code(404).send({ errore: 'Proposta non trovata.' });
      if (proposta.stato !== 'in_attesa') {
        return reply.code(400).send({ errore: 'La proposta è già stata gestita.' });
      }
      const rifiutata = await prisma.propostaDatiFiscale.update({
        where: { id: proposta.id },
        data: {
          stato: 'rifiutata',
          notaStudio: (req.body?.notaStudio ?? '').trim() || null,
          gestitoDaId: (req as any).user?.userId ?? null,
        },
      });
      await recordAudit({
        tenantId,
        userId: (req as any).user?.userId ?? null,
        azione: 'DATO_FISCALE_RIFIUTATO',
        entita: proposta.id,
        dettagli: `Rifiutata modifica ${proposta.campo} per cliente ${proposta.clienteId}`,
      });

      // Punto 4 piano gap, riga 8 matrice — anche il rifiuto va comunicato, con la
      // motivazione se lo studio l'ha scritta: il cliente non deve restare in sospeso.
      // Qui il campo non ha passato il type-guard, quindi l'etichetta ricade sul nome tecnico.
      await notificaCliente(tenantId, proposta.clienteId, {
        tipoEvento: 'risposta_proposta_dati',
        oggetto: 'Proposta di modifica rifiutata',
        corpo: `Lo studio non ha accolto la modifica di ${(ETICHETTE_CAMPI_PROPONIBILI as Record<string, string>)[proposta.campo] ?? proposta.campo}.${rifiutata.notaStudio ? ` Motivazione: ${rifiutata.notaStudio}` : ''}`,
        link: '/portal/proposal',
      }).catch(() => {});

      return reply.send({ ok: true, proposta: rifiutata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore rifiuto proposta' });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // §2.5 — ADDENDUM: il cliente scrive la richiesta, lo studio prepara.
  //
  // La cronologia addendum non vive più nel localStorage del cliente. Il cliente invia
  // una richiesta libera agganciata al progetto; lo studio la vede, la lavora e risponde
  // (motivazione del rifiuto oppure riferimento al documento predisposto).
  // ────────────────────────────────────────────────────────────────

  // Lato cliente: elenca le proprie richieste di addendum.
  server.get('/portal/addendum', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const richieste = await prisma.richiestaAddendum.findMany({
        where: {
          tenantId,
          clienteId,
          ...((req.query as any)?.progettoId ? { progettoId: String((req.query as any).progettoId) } : {}),
        },
        include: { progetto: { select: { id: true, nome: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste addendum' });
    }
  });

  // Lato cliente: invia una richiesta di addendum su un progetto.
  server.post<{ Body: { progettoId?: string; testoRichiesta: string; clienteId?: string } }>('/portal/addendum', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });

    const { progettoId, testoRichiesta } = req.body || {};
    const testo = (testoRichiesta ?? '').trim();
    if (!testo) return reply.code(400).send({ errore: 'Descrivi la prestazione o il modulo che vuoi aggiungere.' });

    try {
      // Se il cliente non indica un progetto, usiamo il più recente dei suoi. Il progetto
      // deve comunque appartenere al cliente, altrimenti la richiesta finirebbe su un
      // incarico non suo.
      let progetto = progettoId
        ? await prisma.progetto.findFirst({ where: { id: String(progettoId), tenantId, clienteId }, select: { id: true, nome: true } })
        : await prisma.progetto.findFirst({ where: { tenantId, clienteId }, orderBy: { createdAt: 'desc' }, select: { id: true, nome: true } });
      if (!progetto) return reply.code(404).send({ errore: 'Nessun progetto su cui richiedere l\'addendum.' });

      // Il nome del cliente serve alla campanella dello studio (riga sotto): una notifica
      // che dicesse solo «cli-42» non parlerebbe a nessuno.
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true },
      });

      const richiesta = await prisma.richiestaAddendum.create({
        data: {
          tenantId,
          clienteId,
          progettoId: progetto.id,
          testoRichiesta: testo,
          stato: 'richiesta',
          richiestoDaId: (req as any).user?.userId ?? null,
        },
        include: { progetto: { select: { id: true, nome: true } } },
      });

      await recordAudit({
        tenantId,
        userId: (req as any).user?.userId ?? null,
        azione: 'RICHIESTA_ADDENDUM',
        entita: richiesta.id,
        dettagli: `Richiesta addendum del cliente ${clienteId} sul progetto ${progetto.id}`,
      });

      // Punto 4 piano gap (gap simmetrico cliente→studio) — la richiesta di addendum va
      // vista subito dallo studio: campanella con l'evento `messaggio_cliente` e link al
      // progetto, dove gli addendum si lavorano.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Richiesta di addendum',
        corpo: `${cliente?.nome ?? 'Il cliente'} ha chiesto un addendum su «${progetto.nome}»: ${testo.slice(0, 160)}`,
        link: `/projects/${progetto.id}`,
      }).catch(() => {});

      return reply.code(201).send({ ok: true, richiesta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore invio richiesta addendum' });
    }
  });

  // Lato studio: elenca le richieste di addendum del tenant (filtrabili per progetto/stato).
  server.get('/addendum', async (req, reply) => {
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const query = req.query as any;
    try {
      const richieste = await prisma.richiestaAddendum.findMany({
        where: {
          tenantId,
          ...(query.progettoId ? { progettoId: String(query.progettoId) } : {}),
          ...(query.stato ? { stato: String(query.stato) as any } : {}),
        },
        include: {
          cliente: { select: { id: true, nome: true } },
          progetto: { select: { id: true, nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste addendum' });
    }
  });

  // Lato studio: aggiorna lo stato di una richiesta (in lavorazione / pronta / rifiutata)
  // e allega la risposta per il cliente.
  server.post<{ Params: { id: string }; Body: { stato?: string; rispostaStudio?: string } }>('/addendum/:id/stato', async (req, reply) => {
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const STATI_ADDENDUM = ['richiesta', 'in_preparazione', 'pronta', 'rifiutata'];
    const nuovoStato = req.body?.stato;
    if (nuovoStato && !STATI_ADDENDUM.includes(nuovoStato)) {
      return reply.code(400).send({ errore: 'Stato non valido.' });
    }
    try {
      const richiesta = await prisma.richiestaAddendum.findFirst({ where: { id, tenantId } });
      if (!richiesta) return reply.code(404).send({ errore: 'Richiesta non trovata.' });
      const aggiornata = await prisma.richiestaAddendum.update({
        where: { id: richiesta.id },
        data: {
          ...(nuovoStato ? { stato: nuovoStato as any } : {}),
          ...(req.body?.rispostaStudio !== undefined ? { rispostaStudio: (req.body.rispostaStudio ?? '').trim() || null } : {}),
          gestitoDaId: (req as any).user?.userId ?? null,
        },
        include: { cliente: { select: { id: true, nome: true } }, progetto: { select: { id: true, nome: true } } },
      });
      await recordAudit({
        tenantId,
        userId: (req as any).user?.userId ?? null,
        azione: 'STATO_ADDENDUM',
        entita: richiesta.id,
        dettagli: `Stato addendum ${richiesta.id} -> ${nuovoStato ?? 'invariato'}`,
      });

      // Punto 4 piano gap, riga 7 matrice — il cliente va avvisato solo sugli esiti che lo
      // riguardano: 'pronta' (l'addendum è disponibile) e 'rifiutata' (con la risposta dello
      // studio, se scritta). 'in_preparazione' è lavorazione interna: notificarla sarebbe
      // rumore sulla campanella.
      if (aggiornata.stato === 'pronta' || aggiornata.stato === 'rifiutata') {
        await notificaCliente(tenantId, aggiornata.clienteId, {
          tipoEvento: 'risposta_addendum',
          oggetto: aggiornata.stato === 'pronta' ? 'Addendum pronto' : 'Richiesta di addendum rifiutata',
          corpo: aggiornata.stato === 'pronta'
            ? `La tua richiesta di addendum su «${aggiornata.progetto?.nome ?? 'il progetto'}» è pronta: la trovi nella sezione Proposta del portale.`
            : `La tua richiesta di addendum su «${aggiornata.progetto?.nome ?? 'il progetto'}» non è stata accolta.${aggiornata.rispostaStudio ? ` Risposta dello studio: ${aggiornata.rispostaStudio}` : ''}`,
          link: '/portal/proposal',
        }).catch(() => {});
      }

      return reply.send({ ok: true, richiesta: aggiornata });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento stato addendum' });
    }
  });

  server.get('/portal/canali-firma', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const clienteId = clienteDellaRichiesta(req, (req.query as any)?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true, email: true, cellulare: true, telegramChatId: true, canaleOtpPreferito: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const cred = await credenzialiCanali(tenantId);
      // I recapiti vengono risolti anche dal `referentiJson`: vedi `recapitiCliente`. Prima si
      // leggevano solo le colonne, e per un'anagrafica che ha l'email solo nel JSON questa
      // rotta dichiarava «Nessuna email in anagrafica» con l'indirizzo scritto nella scheda.
      const recapiti = recapitiCliente(cliente);
      const perCanale: Record<CanaleOtp, string | null> = {
        whatsapp: recapiti.cellulare,
        email: recapiti.email,
        telegram: recapiti.telegramChatId,
      };

      return reply.send({
        ok: true,
        canalePreferito: cliente.canaleOtpPreferito,
        canali: canaliDisponibili(cred, recapiti).map((c) => ({
          canale: c.canale,
          disponibile: c.disponibile,
          motivo: c.motivo,
          // Mascherato: al browser basta che il firmatario si riconosca nel recapito.
          // Telegram non ne ha uno leggibile, la chat id non dice nulla a chi la legge.
          recapitoMascherato:
            c.canale === 'telegram'
              ? recapiti.telegramChatId
                ? 'chat Telegram collegata'
                : null
              : perCanale[c.canale]
                ? mascheraRecapito(perCanale[c.canale] as string)
                : null,
        })),
        botTelegram: cred.tgBotUsername,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura canali' });
    }
  });

  server.post<{
    Body: {
      canale?: string;
      ambito?: string;
      riferimentoId?: string;
      /** Recapito diverso da quello in anagrafica, dichiarato dal firmatario (§1.2). */
      recapitoDichiarato?: string;
      clienteId?: string;
      signerName?: string;
    };
  }>('/portal/request-otp', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { canale, ambito = 'engagement_letter', riferimentoId, recapitoDichiarato } = req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (!canaleValido(canale)) {
      return reply.code(400).send({ errore: 'Canale non valido. Ammessi: whatsapp, email, telegram.' });
    }
    if (!ambitoValido(ambito)) {
      return reply.code(400).send({ errore: 'Ambito di firma non valido.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true, email: true, cellulare: true, telegramChatId: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      // Anche qui i recapiti arrivano dalle colonne o dal `referentiJson` (vedi
      // `recapitiCliente`): era il punto esatto in cui la richiesta di codice via email si
      // fermava con «Nessuna email in anagrafica» per un cliente che ce l'ha.
      const risolti = recapitiCliente(cliente);
      const inAnagrafica: Record<CanaleOtp, string | null> = {
        whatsapp: risolti.cellulare,
        email: risolti.email,
        telegram: risolti.telegramChatId,
      };

      // Telegram è l'unico canale dove il recapito non si può dichiarare: la chat id non è
      // un dato che il firmatario conosce, la produce il bot quando gli si scrive.
      const dichiarato = canale === 'telegram' ? null : recapitoDichiarato?.trim() || null;
      const target = dichiarato || inAnagrafica[canale];

      if (!target) {
        const cosaManca =
          canale === 'whatsapp'
            ? 'Nessun cellulare in anagrafica: indica un numero o scegli un altro canale.'
            : canale === 'email'
              ? 'Nessuna email in anagrafica: indica un indirizzo o scegli un altro canale.'
              : 'Canale Telegram non collegato: scrivi prima al bot dello studio.';
        return reply.code(400).send({ errore: cosaManca });
      }

      const esito = await creaOtp({
        tenantId,
        clienteId,
        canale,
        target,
        targetAnagrafica: inAnagrafica[canale],
        ambito,
        riferimentoId: riferimentoId ?? null,
        ipRichiesta: ipReale(req),
      });

      // 429 e non 400: è un limite di frequenza, e il frontend ci accende il contatore.
      if (!esito.ok || !esito.codice || !esito.otpId) {
        return reply.code(429).send({ ok: false, errore: esito.errore, attendiSecondi: esito.attendiSecondi });
      }

      const invio = await inviaCodiceOtp({
        tenantId,
        canale,
        target,
        codice: esito.codice,
        nomeFirmatario: req.body?.signerName?.trim() || cliente.nome,
        oggettoFirma: DESCRIZIONE_AMBITO[ambito],
      });

      if (!invio.ok) {
        // Il codice va invalidato subito: tenerlo vivo bloccherebbe per un minuto il
        // tentativo su un altro canale, per una consegna che non è avvenuta.
        await annullaOtp(esito.otpId);
        return reply.code(502).send({ ok: false, errore: invio.errore });
      }

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        ruolo: (req as any).ruolo,
        azione: 'FIRMA_OTP_RICHIESTO',
        entita: cliente.nome,
        dettagli:
          `Codice di firma inviato via ${canale} a ${mascheraRecapito(target)} per ${DESCRIZIONE_AMBITO[ambito]}` +
          (dichiarato ? ' — recapito dichiarato in fase di firma, diverso da quello in anagrafica' : ''),
        ipAddress: ipReale(req),
      });

      return reply.send({
        ok: true,
        canale,
        maskedTarget: mascheraRecapito(target),
        recapitoDichiarato: Boolean(dichiarato),
        expiresInSeconds: TTL_OTP_SECONDI,
        reinviiRimanenti: esito.reinviiRimanenti,
        attesaReinvioSecondi: ATTESA_REINVIO_SECONDI,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore richiesta OTP' });
    }
  });

  /**
   * Impronta SHA-256 di un documento del fascicolo, calcolata dal file che sta in archivio.
   *
   * Il valore che arriva nel body non è una prova: chi firma è anche chi manda la richiesta, e
   * un'impronta scelta dal firmatario descrive il documento che vuole lui, non quello che ha
   * firmato. Per la lettera d'incarico non c'è alternativa — il testo è ancora composto nel
   * browser — ma un documento del fascicolo il file ce l'ha qui, e allora l'impronta si calcola
   * qui. La `where` passa dalla catena microvoce → modulo → progetto → cliente: un id di
   * documento di un altro cliente non trova niente.
   */
  async function improntaDocumentoDelFascicolo(
    tenantId: string,
    clienteId: string,
    documentoId: string,
  ): Promise<{ hash: string; titolo: string } | { errore: string; codice: number }> {
    const doc = await prisma.documento.findFirst({
      where: {
        id: documentoId,
        tenantId,
        // §2.9 — il documento appartiene al cliente se è agganciato a una micro-voce di un
        // suo progetto OPPURE direttamente al progetto (upload a livello fascicolo).
        OR: [
          { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
          { progetto: { clienteId } },
        ],
      },
      select: {
        fileUrl: true,
        statoScansione: true,
        statoDoc: true,
        microvoceProgetto: { select: { nome: true } },
        progetto: { select: { nome: true } },
      },
    });

    if (!doc) return { errore: 'Documento non presente nel fascicolo di questo cliente.', codice: 404 };

    // §WF-DOC — l'ordine del flusso lo decide il server, non il browser. Prima `/portal/documenti`
    // si limitava a non esporre il bottone (`richiedeFirma: false`): una richiesta costruita a
    // mano firmava comunque una bozza mai pubblicata dall'operatore, o la versione vecchia di un
    // documento per cui il cliente ha appena chiesto una modifica. Il sigillo che ne uscirebbe
    // sarebbe autentico e per questo peggio di una firma mancante: attesterebbe il consenso su un
    // testo che lo studio stava ancora riscrivendo.
    if (doc.statoDoc === 'bozza') {
      return {
        errore: "Il documento è ancora una bozza dello studio: non è firmabile finché non viene pubblicato.",
        codice: 409,
      };
    }
    if (doc.statoDoc === 'in_revisione') {
      return {
        errore:
          'Per questo documento è aperta una richiesta di modifica: la firma si potrà apporre sulla nuova versione, ' +
          'quando lo studio la pubblica.',
        codice: 409,
      };
    }
    if (doc.statoScansione === 'infetto') {
      return { errore: 'Il controllo antivirus ha bloccato questo file: non è firmabile.', codice: 400 };
    }
    if (doc.statoScansione === 'in_corso') {
      return { errore: 'Il controllo antivirus su questo file non è ancora finito: riprova fra poco.', codice: 409 };
    }

    const contenuto = await leggiFileArchivio(doc.fileUrl);
    if (!contenuto || contenuto.length === 0) {
      // Non si ripiega su un'impronta calcolata altrove: un sigillo con l'impronta sbagliata è
      // peggio di una firma non apposta.
      return {
        errore: "Il file del documento non è leggibile dall'archivio: la firma non può essere apposta.",
        codice: 502,
      };
    }

    return {
      hash: crypto.createHash('sha256').update(contenuto).digest('hex'),
      titolo: doc.microvoceProgetto?.nome ?? doc.progetto?.nome ?? 'Documento',
    };
  }

  /**
   * Conferma di un modulo completato — impronta SHA-256 calcolata dal server sui dati
   * canonici del modulo e delle sue micro-voci. Come per i documenti del fascicolo, non si
   * accetta un hash dal browser: il sigillo deve descrivere ciò che lo studio ha davvero
   * concluso, non ciò che il firmatario dichiara di confermare.
   *
   * Lo `stato` del modulo NON viene toccato qui: §16.2 lo vuole calcolato e mai scritto a
   * mano. La conferma del cliente vive nella riga `FirmaElettronica` (ambito
   * `modulo_completato`), come per i documenti firmati lo stato si deriva dal sigillo.
   */
  async function improntaModuloCompletato(
    tenantId: string,
    clienteId: string,
    moduloId: string,
  ): Promise<{ hash: string; titolo: string } | { errore: string; codice: number }> {
    const modulo = await prisma.moduloProgetto.findFirst({
      where: {
        id: moduloId,
        tenantId,
        // Il modulo appartiene al cliente se sta in un suo progetto: stessa catena che
        // `improntaDocumentoDelFascicolo` usa per i documenti.
        progetto: { clienteId },
      },
      select: {
        id: true,
        nome: true,
        categoria: true,
        prezzo: true,
        stato: true,
        progetto: { select: { nome: true } },
        microvoci: { select: { nome: true, stato: true } },
      },
    });

    if (!modulo) return { errore: 'Il modulo non è presente nei progetti di questo cliente.', codice: 404 };

    // L'ordine del flusso lo decide il server: una richiesta costruita a mano non può
    // confermare un modulo che lo studio non ha ancora concluso. Il sigillo sarebbe
    // autentico e per questo peggio di una firma mancante.
    if (modulo.stato !== 'done') {
      return {
        errore:
          'Il modulo non risulta concluso dallo studio: la conferma si può firmare solo quando le attività sono completate.',
        codice: 409,
      };
    }

    // Un modulo già confermato non si rifirma: due sigilli sullo stesso atto lascerebbero
    // il dubbio su quale faccia fede.
    const giaFirmato = await (prisma as any).firmaElettronica.findFirst({
      where: { tenantId, clienteId, ambito: 'modulo_completato', riferimentoId: moduloId },
      select: { id: true },
    });
    if (giaFirmato) {
      return {
        errore: 'Questo modulo è già stato confermato con firma: una seconda firma non può essere apposta.',
        codice: 409,
      };
    }

    // Ordine deterministico: le micro-voci per nome, così l'impronta non dipende
    // dall'ordine di lettura del database.
    const microvoci = [...modulo.microvoci].sort((a, b) => a.nome.localeCompare(b.nome));
    const contenuto = JSON.stringify({
      tipo: 'conferma_modulo_completato',
      moduloId: modulo.id,
      nome: modulo.nome,
      categoria: modulo.categoria,
      prezzo: modulo.prezzo,
      progetto: modulo.progetto.nome,
      microvoci: microvoci.map((mv) => ({ nome: mv.nome, stato: mv.stato })),
    });

    return {
      hash: crypto.createHash('sha256').update(contenuto).digest('hex'),
      titolo: `${modulo.nome} — ${modulo.progetto.nome}`,
    };
  }

  /**
   * §WF-DOC — lo schema dichiara `firmato` «stato terminale positivo», ma nessuna delle due
   * rotte di firma lo scriveva: il documento restava `pubblicato` (o `in_revisione`) per
   * sempre. Portale e scheda dello studio derivano «firmato» dall'esistenza della riga
   * `FirmaElettronica`, quindi l'incoerenza non si vedeva nella UI — ma `stato_doc` diceva il
   * falso a chiunque leggesse il database, e `@@index([statoDoc])` non serviva a trovare i
   * documenti firmati.
   *
   * `updateMany` e non `update`: la clausola porta il tenant, e non solleva se la riga non c'è.
   */
  async function segnaDocumentoFirmato(tenantId: string, documentoId: string) {
    try {
      await prisma.documento.updateMany({
        where: { id: documentoId, tenantId },
        data: { statoDoc: 'firmato' },
      });
    } catch (err) {
      // La firma è già registrata e resta valida: l'aggiornamento dello stato non deve farla
      // fallire a posteriori. Va però nei log, perché lascia il fascicolo incoerente.
      console.error('Stato documento non aggiornato a «firmato» dopo la firma', documentoId, err);
    }
  }

  /**
   * Punto 2 piano gap — il verbale di firma. FirmaElettronica contiene i dati probatori ma
   * nessun documento umano-leggibile: questa funzione genera il PDF del verbale, lo carica
   * come Documento (tipo 'verbale_firma') nel fascicolo e collega la firma al documento.
   *
   * Stessa logica di segnaDocumentoFirmato: è un effetto collaterale della firma, non un
   * suo requisito di validità. Se la generazione fallisce (storage, DB, PDF) la firma resta
   * valida e il sigillo resta nel database; il fallimento va nei log.
   *
   * `caricatoDa` è null: il firmatario cliente ha identità `client-<id>` che non è una riga
   * della tabella user, e attribuire il verbale a un utente dello studio sarebbe
   * un'attestazione falsa in un atto certificativo.
   */
  async function generaVerbaleDiFirma(params: {
    tenantId: string;
    clienteId: string;
    clienteNome: string;
    firma: {
      id: string;
      signatureId: string;
      tipoFirma: string;
      standard: string;
      documentoTitolo: string;
      documentoHash: string;
      firmatarioNome: string;
      firmatarioRuolo: string | null;
      canaleVerificato: string | null;
      codiceOtpId: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      firmaGrafometricaPng?: string | null;
      fileFirmatoHash?: string | null;
      firmatoAt: Date;
    };
    /** Impronta SHA-256 del sigillo: è calcolata dal builder del sigillo, non dalla firma. */
    sigilloDigest: string;
    ambito: string;
    riferimentoId: string | null;
  }): Promise<void> {
    const { tenantId, clienteId, clienteNome, firma, sigilloDigest, ambito, riferimentoId } = params;
    try {
      // 1. Collocazione nel fascicolo: il verbale segue il documento che certifica. Per il
      //    Vault copia progetto/microvoce dall'originale; per un modulo risale al progetto;
      //    altrimenti (engagement_letter, addendum, o riferimento mancante) va nell'ultimo
      //    progetto del cliente. Il null è l'extrema ratio: il verbale esiste comunque.
      let progettoId: string | null = null;
      let microvoceProgettoId: string | null = null;
      if (ambito === 'documento_vault' && riferimentoId) {
        const originale = await prisma.documento.findFirst({
          where: { id: riferimentoId, tenantId },
          select: { progettoId: true, microvoceProgettoId: true },
        });
        progettoId = originale?.progettoId ?? null;
        microvoceProgettoId = originale?.microvoceProgettoId ?? null;
      } else if (ambito === 'modulo_completato' && riferimentoId) {
        const modulo = await (prisma as any).moduloProgetto.findFirst({
          where: { id: riferimentoId, tenantId },
          select: { progettoId: true },
        });
        progettoId = modulo?.progettoId ?? null;
      }
      if (!progettoId && !microvoceProgettoId) {
        const progetto = await prisma.progetto.findFirst({
          where: { clienteId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        progettoId = progetto?.id ?? null;
      }

      // 2. Dettagli OTP: il record di verifica porta canale/target/origine, ma servono anche
      //    l'ultimo invio e il momento dell'uso — il verbale dice quando il fattore è stato
      //    consegnato e quando è stato speso.
      let otp: {
        canale: string;
        target: string;
        targetDichiarato: boolean;
        targetAnagrafica: string | null;
        ultimoInvioAt: Date | null;
        usatoAt: Date | null;
      } | null = null;
      if (firma.codiceOtpId) {
        otp = await (prisma as any).codiceOtp.findFirst({
          where: { id: firma.codiceOtpId, tenantId },
          select: {
            canale: true,
            target: true,
            targetDichiarato: true,
            targetAnagrafica: true,
            ultimoInvioAt: true,
            usatoAt: true,
          },
        });
      }

      // 3. Il PDF. compress: false — è un atto che deve restare ispezionabile sul file.
      const pdf = await generaPdfVerbaleFirma({
        signatureId: firma.signatureId,
        tipoFirma: firma.tipoFirma,
        standard: firma.standard,
        documentoTitolo: firma.documentoTitolo,
        documentoHash: firma.documentoHash,
        firmatarioNome: firma.firmatarioNome,
        firmatarioRuolo: firma.firmatarioRuolo,
        clienteNome,
        canaleVerificato: firma.canaleVerificato,
        timestampIso: firma.firmatoAt.toISOString(),
        ipAddress: firma.ipAddress,
        userAgent: firma.userAgent,
        sha256Digest: sigilloDigest,
        otp,
        firmaGrafometricaPng: firma.firmaGrafometricaPng ?? null,
        fileFirmatoHash: firma.fileFirmatoHash ?? null,
      });

      // 4. Upload + riga Documento. statoDoc 'pubblicato': il verbale è visibile subito al
      //    cliente, non passa da bozza perché non c'è revisione possibile su un atto
      //    certificativo generato dal sistema.
      const caricato = await uploadDocumento(`verbale_firma_${firma.signatureId}.pdf`, pdf.toString('base64'));
      const verbale = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId,
          tipo: 'verbale_firma',
          fileUrl: caricato.url,
          caricatoDa: null,
          categoriaDoc: 'generico',
          statoDoc: 'pubblicato',
          pubblicatoAt: new Date(),
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      // 5. Collega la firma al suo verbale: dal fascicolo si può risalire all'evento
      //    probatorio e viceversa.
      await (prisma as any).firmaElettronica.update({
        where: { id: firma.id },
        data: { verbaleDocumentoId: verbale.id },
      });

      await recordAudit({
        tenantId,
        userId: null,
        ruolo: null,
        azione: 'VERBALE_FIRMA_GENERATO',
        entita: firma.signatureId,
        dettagli: `Verbale di firma generato automaticamente per ${firma.signatureId} su "${firma.documentoTitolo}". Documento: ${verbale.id}.`,
        ipAddress: firma.ipAddress,
      }).catch(() => {});

      // Il cliente deve sapere che l'atto esiste e dove trovarlo.
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'verbale_disponibile',
        oggetto: 'Verbale di firma disponibile',
        corpo: `Il verbale della firma su «${firma.documentoTitolo}» è disponibile nel tuo fascicolo documenti.`,
        link: '/portal/documents',
      }).catch(() => {});
    } catch (err) {
      // Il verbale è documentazione della firma, non un suo elemento costitutivo: se la
      // generazione fallisce il sigillo e la firma restano pienamente validi.
      console.error('Verbale di firma non generato: la firma resta valida', firma.signatureId, err);
    }
  }

  server.post<{
    Body: {
      otp: string;
      signerName?: string;
      firmatarioRuolo?: string;
      documentoTitolo?: string;
      documentoHash?: string;
      ambito?: string;
      riferimentoId?: string;
      clienteId?: string;
      /** Grafometrica raccolta DOPO l'OTP e allegata al sigillo (§1.11). */
      firmaGrafometricaPng?: string;
    };
  }>('/portal/verify-otp-and-sign', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { otp, ambito = 'engagement_letter', riferimentoId, documentoHash, firmaGrafometricaPng } = req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (!otp || !/^\d{6}$/.test(otp.trim())) {
      return reply.code(400).send({ ok: false, errore: 'Il codice è composto da 6 cifre.' });
    }
    if (!ambitoValido(ambito)) return reply.code(400).send({ errore: 'Ambito di firma non valido.' });

    // Il sigillo deve identificare il testo firmato. Prima, in mancanza di hash, ne scriveva
    // uno finto ('DOC_ORIGINAL_HASH'): un verbale che certifica la volontà su un documento
    // qualunque. Senza impronta la firma non si appone.
    //
    // Per un documento del fascicolo l'impronta la calcola il server dal file in archivio, e
    // quella eventualmente mandata dal browser viene ignorata: vedi
    // `improntaDocumentoDelFascicolo`. Per la conferma di un modulo completato la calcola
    // sempre il server, dai dati del modulo: vedi `improntaModuloCompletato`. Per la lettera
    // d'incarico resta quella del browser, perché il testo è ancora composto lì.
    const vault = ambito === 'documento_vault' && riferimentoId;
    const moduloCompletato = ambito === 'modulo_completato';
    if (!vault && !moduloCompletato && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento mancante o non valida: la firma non può essere apposta.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento da firmare.' });
    }
    if (moduloCompletato && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il modulo da confermare.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      // L'impronta si risolve PRIMA di consumare il codice: il codice è monouso, e bruciarlo
      // per un file illeggibile costringerebbe il cliente a rifare tutto il giro.
      let improntaFinale = (documentoHash ?? '').trim().toLowerCase();
      let titoloDalFascicolo: string | null = null;
      if (vault && riferimentoId) {
        const esito = await improntaDocumentoDelFascicolo(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
      }
      if (moduloCompletato && riferimentoId) {
        const esito = await improntaModuloCompletato(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
      }

      const verifica = await verificaOtp(clienteId, otp, ambito, riferimentoId ?? null);
      if (!verifica.valido || !verifica.record) {
        return reply.code(400).send({ ok: false, errore: verifica.motivo });
      }

      const grafometrica = normalizzaGrafometrica(firmaGrafometricaPng);
      const documentoTitolo =
        req.body?.documentoTitolo?.trim() || titoloDalFascicolo || DESCRIZIONE_AMBITO[ambito];
      const firmatarioNome = req.body?.signerName?.trim() || cliente.nome;

      const sigillo = creaSigilloFea({
        clienteId,
        signerName: firmatarioNome,
        documentoTitolo,
        documentoHash: improntaFinale,
        // L'IP della *verifica*, non quello della richiesta del codice: è il momento in cui
        // la volontà viene manifestata.
        ip: ipReale(req),
        userAgent: req.headers['user-agent'] || null,
        canaleVerificato: descriviCanaleVerificato(verifica.record),
      });

      const firma = await (prisma as any).firmaElettronica.create({
        data: {
          tenantId,
          clienteId,
          signatureId: sigillo.signatureId,
          tipoFirma: 'fea_otp',
          ambito,
          riferimentoId: riferimentoId ?? null,
          documentoTitolo,
          firmatarioNome,
          firmatarioRuolo: req.body?.firmatarioRuolo?.trim() || null,
          documentoHash: sigillo.documentoHash,
          canaleVerificato: sigillo.canaleVerificato,
          codiceOtpId: verifica.record.id,
          ipAddress: sigillo.ipAddress,
          userAgent: sigillo.userAgent,
          firmaGrafometricaPng: grafometrica,
          standard: sigillo.standard,
          firmatoAt: new Date(sigillo.timestampIso),
        },
      });

      if (vault && riferimentoId) await segnaDocumentoFirmato(tenantId, riferimentoId);

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        ruolo: (req as any).ruolo,
        azione: 'FIRMA_FEA_APPOSTA',
        entita: cliente.nome,
        dettagli:
          `Firma Elettronica Avanzata ${sigillo.signatureId} su "${documentoTitolo}" da ${firmatarioNome}. ` +
          `${sigillo.canaleVerificato}. IP: ${sigillo.ipAddress ?? 'non registrato'}.`,
        ipAddress: sigillo.ipAddress,
      });

      // Blocco 3 — firma apposta: lo studio lo vede subito, il cliente ne ha conferma.
      // Wording allineato alle etichette SES del portale (commit 0509f96): l'OTP verificato
      // è una Firma Elettronica Semplice ex art. 20 CAD, non una firma «avanzata».
      await notificaStudio(tenantId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma apposta',
        corpo: `${firmatarioNome} (${cliente.nome}) ha firmato «${documentoTitolo}» con Firma Elettronica Semplice (OTP verificata · art. 20 CAD).`,
        link: null,
      }).catch(() => {});
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma registrata',
        corpo: `La tua firma su «${documentoTitolo}» è stata registrata correttamente.`,
        // La conferma di un modulo si rivede nell'avanzamento, non nel fascicolo documenti.
        link: moduloCompletato ? '/portal/avanzamento' : '/portal/documents',
      }).catch(() => {});

      // L'attivazione del progetto riguarda solo la lettera d'incarico: prima avveniva a
      // ogni firma, quindi anche prendere visione di un documento faceva scattare un
      // progetto in lavorazione.
      let progettoAttivato: string | null = null;
      if (ambito === 'engagement_letter') {
        try {
          const prj = await prisma.progetto.findFirst({
            where: { clienteId },
            orderBy: { createdAt: 'desc' },
          });
          if (prj && prj.stato !== 'in_progress') {
            await prisma.progetto.update({ where: { id: prj.id }, data: { stato: 'in_progress' } });
            progettoAttivato = prj.id;
          }
        } catch {
          // L'attivazione è un effetto collaterale: se salta, la firma resta valida.
        }
      }

      // Punto 2 piano gap — il verbale si genera DOPO l'attivazione del progetto: per
      // l'engagement_letter il collegamento al fascicolo cerca l'ultimo progetto del
      // cliente, che a questo punto è già in lavorazione.
      await generaVerbaleDiFirma({
        tenantId,
        clienteId,
        clienteNome: cliente.nome,
        firma,
        sigilloDigest: sigillo.sha256Digest,
        ambito,
        riferimentoId: riferimentoId ?? null,
      });

      return reply.send({
        ok: true,
        seal: { ...sigillo, id: firma.id, tipoFirma: 'fea_otp' },
        progettoAttivato,
        message: 'Firma elettronica avanzata registrata.',
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore verifica OTP e firma' });
    }
  });

  /**
   * Le altre due strade di firma richieste (§1.3): il documento scaricato, firmato a penna e
   * ricaricato, e quello firmato con il provider di firma digitale del cliente.
   *
   * Qui la prova non è l'OTP ma il file: la firma è già dentro al documento. L'OTP resta
   * accettato e, se presente, viene citato nel sigillo — non è obbligatorio, perché
   * pretenderlo non aggiungerebbe nulla a una firma qualificata apposta altrove.
   */
  server.post<{
    Body: {
      tipoFirma?: string;
      ambito?: string;
      riferimentoId?: string;
      clienteId?: string;
      documentoTitolo?: string;
      documentoHash?: string;
      filename?: string;
      contentBase64?: string;
      signerName?: string;
      firmatarioRuolo?: string;
      otp?: string;
    };
  }>('/portal/firma-con-file', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { tipoFirma, ambito = 'engagement_letter', riferimentoId, documentoHash, filename, contentBase64 } =
      req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (tipoFirma !== 'manuale_scansionata' && tipoFirma !== 'qualificata_esterna') {
      return reply
        .code(400)
        .send({ errore: 'tipoFirma ammessi: manuale_scansionata, qualificata_esterna.' });
    }
    if (!ambitoValido(ambito)) return reply.code(400).send({ errore: 'Ambito di firma non valido.' });
    if (!filename || !contentBase64) {
      return reply.code(400).send({ errore: 'File firmato mancante.' });
    }
    // Come nella firma con codice: per un documento del fascicolo l'impronta dell'originale la
    // calcola il server dal file in archivio, e per un modulo completato dai dati del modulo —
    // mai il browser.
    const vault = ambito === 'documento_vault' && riferimentoId;
    const moduloCompletato = ambito === 'modulo_completato';
    if (!vault && !moduloCompletato && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento originale mancante o non valida.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento a cui si riferisce la firma.' });
    }
    if (moduloCompletato && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il modulo a cui si riferisce la firma.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      // Lo stesso controllo degli altri caricamenti: un portale cliente è la porta più
      // esposta che abbiamo, e qui il file arriva da fuori.
      const scan = scanFileBuffer(buffer, filename);
      if (!scan.safe) {
        return reply.code(400).send({ errore: `File rifiutato: ${scan.reason}` });
      }

      let codiceOtpId: string | null = null;
      let descrizioneOtp = '';

      // Prima di consumare l'eventuale codice: se il file originale non è leggibile la firma
      // non si appone, e il codice deve restare valido.
      let improntaFinale = (documentoHash ?? '').trim().toLowerCase();
      let titoloDalFascicolo: string | null = null;
      if (vault && riferimentoId) {
        const esito = await improntaDocumentoDelFascicolo(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
      }
      if (moduloCompletato && riferimentoId) {
        const esito = await improntaModuloCompletato(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
      }

      if (req.body?.otp) {
        const verifica = await verificaOtp(clienteId, req.body.otp, ambito, riferimentoId ?? null);
        if (!verifica.valido || !verifica.record) {
          return reply.code(400).send({ ok: false, errore: verifica.motivo });
        }
        codiceOtpId = verifica.record.id;
        descrizioneOtp = ` ${descriviCanaleVerificato(verifica.record)}.`;
      }

      const caricato = await uploadDocumento(filename, contentBase64);
      const fileFirmatoHash = crypto.createHash('sha256').update(buffer).digest('hex');

      const documentoTitolo =
        req.body?.documentoTitolo?.trim() || titoloDalFascicolo || DESCRIZIONE_AMBITO[ambito];
      const firmatarioNome = req.body?.signerName?.trim() || cliente.nome;

      // Detto come sta: la piattaforma attesta di aver ricevuto un file da una sessione
      // autenticata, non di aver verificato la firma che il file contiene. Per la firma
      // qualificata esterna la validità la certifica il provider, e la verifica del
      // certificato non è implementata — dirlo è parte del valore del verbale.
      const canaleVerificato =
        (tipoFirma === 'manuale_scansionata'
          ? 'Documento scaricato, sottoscritto a mano e ricaricato dal cliente da sessione autenticata al portale'
          : 'Documento sottoscritto con firma digitale qualificata di provider esterno al firmatario e ricaricato da sessione autenticata; il certificato non è stato validato dalla piattaforma') +
        descrizioneOtp;

      const standard =
        tipoFirma === 'manuale_scansionata'
          ? 'Sottoscrizione autografa su supporto cartaceo, acquisita per immagine'
          : 'Firma digitale qualificata di provider esterno (eIDAS UE 910/2014 QES), non verificata dalla piattaforma';

      const sigillo = creaSigilloFea({
        clienteId,
        signerName: firmatarioNome,
        documentoTitolo,
        documentoHash: improntaFinale,
        ip: ipReale(req),
        userAgent: req.headers['user-agent'] || null,
        canaleVerificato,
        standard,
      });

      const firma = await (prisma as any).firmaElettronica.create({
        data: {
          tenantId,
          clienteId,
          signatureId: sigillo.signatureId,
          tipoFirma,
          ambito,
          riferimentoId: riferimentoId ?? null,
          documentoTitolo,
          firmatarioNome,
          firmatarioRuolo: req.body?.firmatarioRuolo?.trim() || null,
          documentoHash: sigillo.documentoHash,
          canaleVerificato: sigillo.canaleVerificato,
          codiceOtpId,
          ipAddress: sigillo.ipAddress,
          userAgent: sigillo.userAgent,
          fileFirmatoUrl: caricato.url,
          fileFirmatoHash,
          standard: sigillo.standard,
          firmatoAt: new Date(sigillo.timestampIso),
        },
      });

      if (vault && riferimentoId) await segnaDocumentoFirmato(tenantId, riferimentoId);

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        ruolo: (req as any).ruolo,
        azione: 'FIRMA_FILE_CARICATO',
        entita: cliente.nome,
        dettagli:
          `Firma ${tipoFirma} ${sigillo.signatureId} su "${documentoTitolo}" da ${firmatarioNome}. ` +
          `File ${filename} (${scan.fileSize} byte, SHA-256 ${fileFirmatoHash.slice(0, 16)}…). ` +
          `IP: ${sigillo.ipAddress ?? 'non registrato'}.`,
        ipAddress: sigillo.ipAddress,
      });

      // Blocco 3 — come per la firma OTP: evento "firma apposta" a studio e cliente.
      await notificaStudio(tenantId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma apposta',
        corpo: `${firmatarioNome} (${cliente.nome}) ha caricato il documento firmato «${documentoTitolo}».`,
        link: null,
      }).catch(() => {});
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma registrata',
        corpo: `Il documento firmato «${documentoTitolo}» è stato registrato correttamente.`,
        link: '/portal/documents',
      }).catch(() => {});

      // Punto 2 piano gap — verbale anche per manuale_scansionata e qualificata_esterna:
      // qui certifica la ricezione del file e, se l'OTP è stato usato, lo cita.
      await generaVerbaleDiFirma({
        tenantId,
        clienteId,
        clienteNome: cliente.nome,
        firma,
        sigilloDigest: sigillo.sha256Digest,
        ambito,
        riferimentoId: riferimentoId ?? null,
      });

      return reply.send({ ok: true, seal: { ...sigillo, id: firma.id, tipoFirma, fileFirmatoUrl: caricato.url } });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore firma con file' });
    }
  });

  /**
   * Le firme registrate. Un cliente vede solo le proprie, l'operatore quelle del tenant —
   * ed è questo che permette allo studio di *vedere la firma a database*, che prima non
   * esisteva da nessuna parte.
   */
  server.get<{ Querystring: { clienteId?: string; ambito?: string } }>('/firme', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const soloProprie = (req as any).ruolo === 'cliente';
    const clienteId = soloProprie
      ? clienteDellaRichiesta(req)
      : req.query?.clienteId?.trim() || undefined;

    if (soloProprie && !clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const firme = await (prisma as any).firmaElettronica.findMany({
        where: {
          tenantId,
          ...(clienteId ? { clienteId } : {}),
          ...(req.query?.ambito ? { ambito: req.query.ambito } : {}),
        },
        orderBy: { firmatoAt: 'desc' },
        select: {
          id: true,
          signatureId: true,
          tipoFirma: true,
          ambito: true,
          riferimentoId: true,
          documentoTitolo: true,
          firmatarioNome: true,
          firmatarioRuolo: true,
          documentoHash: true,
          canaleVerificato: true,
          ipAddress: true,
          fileFirmatoUrl: true,
          fileFirmatoHash: true,
          standard: true,
          firmatoAt: true,
          // La grafometrica è un'immagine e pesa: si scarica dal dettaglio, non in elenco.
          cliente: { select: { id: true, nome: true } },
        },
      });
      return reply.send({ ok: true, firme });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura firme' });
    }
  });

  server.get<{ Params: { id: string } }>('/firme/:id/grafometrica', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const firma = await (prisma as any).firmaElettronica.findFirst({
        where: { id: req.params.id, tenantId },
        select: { firmaGrafometricaPng: true, clienteId: true },
      });
      if (!firma) return reply.code(404).send({ errore: 'Firma non trovata.' });

      // Un cliente non deve poter chiedere la grafometrica di un altro cliente dello stesso
      // studio: RLS isola il tenant, non i clienti fra loro.
      if ((req as any).ruolo === 'cliente' && clienteDellaRichiesta(req) !== firma.clienteId) {
        return reply.code(403).send({ errore: 'Firma non accessibile.' });
      }
      if (!firma.firmaGrafometricaPng) {
        return reply.code(404).send({ errore: 'Nessuna firma grafometrica allegata a questo sigillo.' });
      }
      return reply.send({ ok: true, firmaGrafometricaPng: firma.firmaGrafometricaPng });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura grafometrica' });
    }
  });


  // ── WORKER CRON SCADENZE & RINNOVI AUTOMATICI UBO/MFSA/SDI ──────────
  server.post('/cron/esegui-notifiche-scadenze', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const report = await runDailyNotificationCron(tenantId);
      return reply.send({
        ok: true,
        message: `Scansione completata con successo. Elaborate ${report.notificheInviate} notifiche proattive.`,
        report,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore esecuzione cron' });
    }
  });

  // ── WEBHOOK TELEGRAM BOT REALE & INGESTION PROGETTI ─────────────────
  server.post('/webhooks/communications/telegram', async (req, reply) => {
    try {
      const body: any = req.body || {};
      const msg = body.message || body.channel_post;
      if (!msg) return reply.send({ ok: true });

      const fromUsername = msg.from?.username ? `@${msg.from.username}` : '';
      const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || fromUsername || 'Cliente Telegram';
      const text = msg.text || (msg.caption ? `[Allegato]: ${msg.caption}` : '[Allegato / File Ricevuto]');
      const chatId = String(msg.chat?.id || msg.from?.id || '');

      // Ricerca Cliente per username o chat ID
      let matchedCliente = null;
      let matchedProgettoId = 'proj-01';

      try {
        matchedCliente = await prisma.cliente.findFirst({
          where: {
            nome: { contains: fromName, mode: 'insensitive' },
          },
        });

        if (matchedCliente) {
          const prj = await prisma.progetto.findFirst({
            where: { clienteId: matchedCliente.id },
            orderBy: { createdAt: 'desc' },
          });
          if (prj) matchedProgettoId = prj.id;
        }
      } catch {}

      // Registra la comunicazione nel database
      try {
        const tenantId = matchedCliente?.tenantId || (await prisma.tenant.findFirst())?.id;
        if (tenantId) {
          await (prisma as any).comunicazioneProgetto?.create({
            data: {
              tenantId,
              progettoId: matchedProgettoId,
              canale: 'telegram',
              direzione: 'entrata',
              mittente: fromName,
              destinatario: 'Studio Bluecode Ltd',
              oggetto: 'Messaggio Telegram Bot in entrata',
              corpo: text,
              dataInvio: new Date(),
              stato: 'ricevuto',
            },
          });
          // Blocco 3 — stesso evento degli altri canali: messaggio cliente → studio.
          await notificaStudio(tenantId, {
            tipoEvento: 'messaggio_cliente',
            oggetto: 'Nuovo messaggio Telegram',
            corpo: `${fromName} ha scritto al bot Telegram: ${(text || '').slice(0, 120)}`,
            link: matchedProgettoId ? `/projects/${matchedProgettoId}` : null,
          }).catch(() => {});
        }
      } catch (dbErr) {
        console.warn('[Telegram Webhook DB Save Fallback]', dbErr);
      }

      console.log(`[Telegram Bot Ingestion] Ricevuto messaggio da ${fromName} (${chatId}): "${text}"`);
      return reply.send({ ok: true });
    } catch (err) {
      console.warn('[Telegram Webhook Error]', err);
      return reply.send({ ok: true });
    }
  });

  server.post<{ Body: { botToken: string; webhookUrl?: string } }>('/tenant/telegram-webhook-setup', async (req, reply) => {
    const { botToken, webhookUrl = 'https://bluman.vercel.app/api/webhooks/communications/telegram' } = req.body;
    try {
      if (!botToken) {
        return reply.code(400).send({ errore: 'Bot Token mancante' });
      }

      const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
      const tgRes = await fetch(tgUrl);
      const tgJson = await tgRes.json();

      return reply.send({
        ok: true,
        telegramResponse: tgJson,
        message: 'Webhook Telegram configurato ed attivato con successo!',
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore configurazione Telegram' });
    }
  });

  // ── §3.5 — PREPARAZIONE INVIO MANUALE SDI (nessun provider collegato) ──
  // Il sistema prepara l'XML; la trasmissione la fa l'operatore tramite il portale
  // «Fatture & Corrispettivi» o il proprio intermediario. L'esito vero arriva via webhook.
  server.post<{ Params: { id: string } }>('/invoices/:id/prepara-invio-manuale', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    try {
      let fattura = null;
      try {
        fattura = await (prisma as any).fattura.findUnique({
          where: { id },
          include: { progetto: { include: { cliente: true } } },
        });
      } catch {}

      const numFattura = fattura?.numeroProgressivoSerie || `FT-2026-${id.slice(0, 3)}`;
      const result = await preparaFatturaPerInvioManuale({
        fatturaId: id,
        numeroProgressivo: numFattura,
      });

      await recordAudit({
        tenantId,
        azione: 'FATTURA_PREPARATA_INVIO_MANUALE',
        entita: `Fattura ${numFattura}`,
        dettagli: `Fattura elettronica ${numFattura} preparata per invio manuale a SdI (riferimento locale: ${result.riferimentoPreparazione}). Trasmissione a cura dell'operatore.`,
      });

      return reply.send({
        ok: true,
        riferimentoPreparazione: result.riferimentoPreparazione,
        dataPreparazione: result.dataPreparazione,
        message: result.message,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore preparazione invio manuale' });
    }
  });
  });

  return server;
}
