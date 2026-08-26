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

import { signJwt, verifyJwt, generateMagicToken, hashMagicToken, verificaFirmaDownload } from './util/jwt.js';
import { verifyPassword, hashPassword, generaPasswordTemporanea, confrontoTokenCostante } from './util/password.js';
import { sendMagicLinkEmail, sendOtpSecurityEmail, sendClientCredentialsEmail, verifyAndSendTestSmtp, verifyRealImap, createTransporter, inviaEmail } from './services/emailService.js';
import { uploadDocumento, CARTELLA_UPLOADS, nomeFileValido, rifirmaUrlUpload, leggiFileArchivio } from './services/storageService.js';
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
import { ricercaGlobale } from './services/ricercaGlobaleService.js';
// §14 — non `new PrismaClient()`: questo client impone il tenant corrente a ogni query,
// altrimenti le policy RLS non vedono nessun contesto e non restituiscono nulla.
import { prisma, prismaAmministrativo, attivaContestoTenant, conContestoInTransazione } from './util/prismaClient.js';

const inMemoryTenantStore = new Map<string, any>();

/**
 * Tenant usato quando la richiesta non ne indica uno: le richieste non autenticate
 * (login, health) e i record di sistema. Coincide con l'id creato dal seed.
 */
const TENANT_DEFAULT = '00000000-0000-0000-0000-000000000001';

/** Recapito ripulito, oppure `null` se dopo il taglio degli spazi non rimane niente. */
function pulisciRecapito(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/** I tre canali su cui può viaggiare il codice di firma; qualunque altra cosa non è una scelta. */
function canaleOtpValido(v: unknown): v is 'whatsapp' | 'email' | 'telegram' {
  return v === 'whatsapp' || v === 'email' || v === 'telegram';
}

/**
 * Gli stati ammessi, per validare quello che arriva dal client prima di scriverlo.
 *
 * Sono le stesse voci degli `enum` in `prisma/schema.prisma`: qui servono come elenco a runtime,
 * perché un valore fuori elenco farebbe fallire l'`update` di Prisma con un errore che non dice
 * niente a chi lo legge dal frontend, invece di essere respinto con il motivo.
 */
const STATI_MICROVOCE = ['pending', 'attesa_dipendenza', 'active', 'delayed', 'blocked', 'done'];
const STATI_PROGETTO = ['pre_project', 'in_progress', 'completed', 'archived'];

/**
 * Durata della sessione di un operatore dello studio, in minuti.
 *
 * Era un'ora, senza rinnovo. Una giornata di lavoro su un progetto dura più di un'ora, quindi il
 * token scadeva **durante** il lavoro: da quel momento ogni salvataggio tornava 401, e siccome
 * quasi nessuna chiamata del frontend distingueva il 401 dal successo, le modifiche continuavano
 * a comparire sullo schermo — arrivavano da `localStorage` — senza mai raggiungere il database.
 * È la causa a monte del guasto segnalato, «il cliente non vede i moduli inseriti
 * dall'operatore»: il portale legge il database.
 *
 * Dodici ore coprono una giornata; il rinnovo scorrevole qui sotto copre chi lavora oltre.
 */
const DURATA_SESSIONE_OPERATORE_MINUTI = 12 * 60;

/**
 * Durata della sessione di un cliente nel portale, in minuti.
 *
 * Più corta di quella dell'operatore: il portale si apre da un link ricevuto via email, che può
 * finire su un dispositivo condiviso o restare in una cronologia. Quattro ore bastano a leggere
 * i documenti, ricevere il codice e firmare; scaduta, il Magic Link (valido sette giorni) ne
 * produce una nuova senza passare dallo studio.
 */
const DURATA_SESSIONE_CLIENTE_MINUTI = 4 * 60;

/**
 * Quando rinnovare un token ancora valido: a metà della sua vita.
 *
 * Il rinnovo viaggia nell'header `X-Bluman-Token` della risposta e il frontend lo sostituisce a
 * quello che ha in memoria. Così chi sta lavorando non viene mai buttato fuori a metà di una
 * modifica, e chi ha chiuso il portatile venerdì sera rientra lunedì con le credenziali, che è la
 * differenza fra una sessione lunga e una sessione eterna. Non serve nessuna tabella di refresh
 * token: il token nuovo è firmato con lo stesso segreto e porta lo stesso contenuto.
 */
const SOGLIA_RINNOVO = 0.5;

/**
 * Validità di un Magic Link. Sette giorni perché il destinatario è un cliente che legge la
 * posta quando può, non un operatore davanti alla console. La revoca non aspetta la
 * scadenza: è la cancellazione della riga in `magic_link`.
 */
const GIORNI_VALIDITA_MAGIC_LINK = 7;

/**
 * Base pubblica del frontend, per i link che finiscono nelle email.
 *
 * Era cablata a `http://localhost:5173`, quindi ogni Magic Link inviato dalla produzione
 * portava alla macchina di chi apriva l'email. In produzione l'assenza della variabile è un
 * errore: un link rotto verso localhost è peggio di un errore visibile.
 */
function baseUrlApplicazione(): string {
  const daEnv = process.env.APP_BASE_URL?.replace(/\/+$/, '');
  if (daEnv) return daEnv;

  if (process.env.NODE_ENV === 'production') {
    return 'https://bluman.vercel.app';
  }

  return 'http://localhost:5173';
}

/**
 * IP reale del chiamante, `null` quando non è determinabile.
 *
 * Dietro il proxy di Railway `req.ip` è l'indirizzo del proxy: quello del client sta nel
 * primo salto di `x-forwarded-for`. Il valore serve a due cose che non tollerano un
 * segnaposto — il registro di audit e il verbale di firma — e prima entrambi ricadevano
 * su `127.0.0.1`, che è l'unico indirizzo da cui un firmatario sicuramente non arriva.
 * Meglio l'assenza registrata come assenza.
 */
function ipReale(req: { ip?: string; headers: Record<string, unknown> }): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const grezzo = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof grezzo === 'string' && grezzo.trim()) {
    const primo = grezzo.split(',')[0]?.trim();
    if (primo) return primo;
  }

  const diretto = req.ip?.trim();
  if (!diretto) return null;
  // Loopback: è il server che parla con se stesso, non un firmatario.
  if (diretto === '127.0.0.1' || diretto === '::1' || diretto === '::ffff:127.0.0.1') return null;
  return diretto;
}

/**
 * La firma grafometrica, ripulita prima di salvarla.
 *
 * Arriva dal browser come data URL prodotta da `canvas.toDataURL()`, quindi è un dato che
 * il client controlla: si accetta solo un PNG in base64 e sotto il mezzo megabyte. Senza
 * questi due controlli il campo diventerebbe un posto dove scrivere qualunque cosa, di
 * qualunque dimensione, dentro il verbale di firma.
 */
function normalizzaGrafometrica(valore?: string | null): string | null {
  if (!valore) return null;
  const pulito = valore.trim();
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(pulito)) return null;
  if (pulito.length > 512 * 1024) return null;
  return pulito;
}

// Audit log — §0.6: il tenant è OBBLIGATORIO (ogni chiamata lo riceve dal payload
// JWT o dal contesto della richiesta: nessun ripiego silenzioso su TENANT_DEFAULT)
// e la scrittura passa dal client amministrativo, perché l'audit è un'operazione di
// sistema non soggetta a RLS. Niente setImmediate: il fire-and-forget perdeva gli
// audit se il processo moriva e rendeva impossibile il debug (il catch vuoto
// ingoiava ogni errore). Gli errori di scrittura vengono loggati, non ingoiati.
async function recordAudit(params: {
  tenantId: string; // OBBLIGATORIO: l'audit va sempre attribuito al tenant giusto
  userId?: string | null;
  userEmail?: string | null;
  userNome?: string | null;
  ruolo?: string | null;
  azione: string;
  entita: string;
  dettagli: string;
  ipAddress?: string | null;
}) {
  try {
    await prismaAmministrativo().auditLog.create({
      data: {
        tenantId: params.tenantId,
        // I ripieghi qui sotto identificano operazioni di sistema senza utente
        // (avvio, seed, processi automatici), non utenti reali.
        userId: params.userId ?? 'usr-system',
        userEmail: params.userEmail ?? 'system@bluecode.advisory',
        userNome: params.userNome ?? 'Sistema / Operatore',
        ruolo: params.ruolo ?? 'operator',
        azione: params.azione,
        entita: params.entita,
        dettagli: params.dettagli,
        // `ip_address` è nullable: un indirizzo inventato in un registro immutabile è
        // peggio di un campo vuoto, perché sembra una prova.
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    // La richiesta non deve fallire per un errore di audit, ma l'errore va
    // tracciato: prima veniva ingoiato in silenzio (vedi §0.6 del piano).
    console.error('[AUDIT] Impossibile registrare audit log:', err);
  }
}

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
  server.post<{
    Body: { email?: string; password?: string };
  }>('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return reply.code(400).send({ errore: 'Email e password sono obbligatorie' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // §23 — l'unica fonte di verità per le credenziali è la tabella user: nessun utente
    // hardcoded, nessuna password accettata come jolly. Il primo super_admin nasce da
    // `npm run bootstrap` (§27), le password del team esistente da `npm run passwords:assign`.
    //
    // Unico punto dell'applicazione che usa il client amministrativo: qui il tenant non è
    // ancora noto — si scopre proprio dalla riga che stiamo cercando — quindi non può
    // essere un vincolo della query che la trova. La ricerca è per email esatta, non
    // restituisce niente di più della riga a cui l'utente sta provando ad accedere.
    let utente: Awaited<ReturnType<typeof prisma.user.findFirst>> = null;
    try {
      utente = await prismaAmministrativo().user.findFirst({ where: { email: cleanEmail } });
    } catch (err) {
      console.error('Login: database non raggiungibile —', err instanceof Error ? err.message : err);
      return reply.code(503).send({ errore: 'Servizio di autenticazione non disponibile. Riprova tra poco.' });
    }

    // Stesso messaggio per utente inesistente, password errata e cliente passwordless:
    // distinguerli permetterebbe di enumerare le email registrate nello studio.
    const nonValide = { errore: 'Credenziali non valide.' };

    // Il cliente è passwordless (§23): accede solo via magic link, mai da questo endpoint.
    if (!utente || !utente.passwordHash || utente.ruolo === 'cliente') {
      return reply.code(401).send(nonValide);
    }
    if (!verifyPassword(password, utente.passwordHash)) {
      return reply.code(401).send(nonValide);
    }
    if (utente.stato === 'disattivato') {
      return reply.code(403).send({ errore: 'Utenza disattivata. Contatta il super admin dello studio.' });
    }

    // §2bis — il tenant è quello registrato sull'utente, non dedotto dal dominio dell'email.
    // Per il super_admin è null: sceglie il tenant corrente via header x-tenant-id.
    const userTenantId = utente.tenantId || '';

    // §14 — l'hook onRequest ha impostato il tenant di default (questa richiesta non
    // portava ancora un token): ora il tenant è noto, e va attivato prima delle query
    // di questa richiesta. Senza questa riga le letture vincolate a RLS verrebbero
    // rifiutate dal WITH CHECK delle policy per chiunque appartenga a uno studio
    // diverso da quello di default. (§0.6: l'audit vero e proprio ora passa dal
    // client amministrativo e logga gli errori invece di ingoiarli.)
    attivaContestoTenant({ tenantId: userTenantId || TENANT_DEFAULT, ruolo: utente.ruolo });

    const token = signJwt({
      userId: utente.id,
      tenantId: userTenantId,
      email: cleanEmail,
      ruolo: utente.ruolo,
    }, DURATA_SESSIONE_OPERATORE_MINUTI);

    // Per il super_admin `utente.tenantId` è null (→ userTenantId ''): l'audit di
    // login va comunque attribuito al tenant di default, non a una stringa vuota.
    await recordAudit({
      tenantId: userTenantId || TENANT_DEFAULT,
      userId: utente.id,
      userEmail: cleanEmail,
      userNome: utente.nome,
      ruolo: utente.ruolo,
      azione: 'AUTENTICAZIONE_LOGIN',
      entita: 'Sessione Studio',
      dettagli: `Login effettuato con successo per il ruolo ${utente.ruolo}`,
      ipAddress: req.ip || '127.0.0.1',
    });

    return {
      ok: true,
      token,
      user: {
        id: utente.id,
        nome: utente.nome,
        email: cleanEmail,
        ruolo: utente.ruolo,
        tenantId: userTenantId,
        stato: utente.stato,
        mustChangePassword: utente.stato === 'invitato',
      },
    };
  });

  server.post<{
    Body: { magicToken: string };
  }>('/auth/magic-login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const magicToken = req.body?.magicToken;

    // §23 — il token si confronta con uno che abbiamo emesso e che non è scaduto.
    //
    // Prima della tabella `magic_link` qui bastava una stringa che iniziasse per `client_`,
    // e il JWT restituito portava tenant ed email cablati nel sorgente: un curl con
    // {"magicToken":"client_x"} otteneva una sessione valida di ruolo `cliente` sul tenant
    // che contiene i dati. Non era un controllo debole da irrobustire, era assente — e il
    // rate limiting qui sopra non lo sostituiva, perché non c'era niente da indovinare.
    //
    // Il lookup usa `prismaAmministrativo()` perché la richiesta è anonima per definizione:
    // non porta un contesto tenant, e il tenant si scopre proprio dalla riga che stiamo
    // cercando. È il caso ammesso dalla regola 1, lo stesso della ricerca utente per email
    // al login, non una scorciatoia per aggirare le policy.
    const rifiuto = { errore: 'Magic Token non valido o scaduto' };
    if (!magicToken || typeof magicToken !== 'string') {
      return reply.code(401).send(rifiuto);
    }

    const db = prismaAmministrativo();
    const link = await db.magicLink.findUnique({
      where: { tokenHash: hashMagicToken(magicToken) },
      include: { cliente: true },
    });

    // Un unico messaggio per token inesistente, scaduto o cliente cancellato: distinguerli
    // direbbe a chi prova se un token è mai esistito.
    if (!link || !link.cliente || link.scadenza.getTime() < Date.now()) {
      return reply.code(401).send(rifiuto);
    }

    // Primo utilizzo registrato per l'audit; il link resta valido fino a scadenza perché un
    // cliente riapre il proprio link più di una volta.
    if (!link.usatoAt) {
      await db.magicLink.update({ where: { id: link.id }, data: { usatoAt: new Date() } });
    }

    const emailCliente = link.email ?? '';
    // Il tenant viene dalla riga del cliente, non da una costante: era il secondo guasto di
    // questo endpoint, che firmava sempre il tenant di default qualunque cliente fosse.
    const identitaPortale = `client-${link.clienteId}`;
    const token = signJwt({
      userId: identitaPortale,
      tenantId: link.cliente.tenantId,
      email: emailCliente,
      ruolo: 'cliente',
    }, DURATA_SESSIONE_CLIENTE_MINUTI);

    await recordAudit({
      tenantId: link.cliente.tenantId,
      azione: 'MAGIC_LINK_USATO',
      entita: link.cliente.nome,
      dettagli: `Accesso al portale cliente tramite Magic Link (${emailCliente || 'destinatario non registrato'})`,
      ipAddress: req.ip,
    });

    return {
      ok: true,
      token,
      user: {
        id: identitaPortale,
        clienteId: link.clienteId,
        nome: link.cliente.nome,
        email: emailCliente,
        ruolo: 'cliente',
      },
    };
  });

  server.post<{
    Body: { email?: string; password?: string };
  }>('/auth/client-login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const rawEmail = req.body?.email;
    const password = req.body?.password;

    const cleanEmail = (rawEmail || '').trim().toLowerCase();
    const nonValide = { errore: 'Credenziali non valide.' };

    if (!cleanEmail || !password) {
      return reply.code(400).send({ errore: 'Email e password sono obbligatorie.' });
    }

    let cliente: any = null;
    try {
      cliente = await prismaAmministrativo().cliente.findFirst({
        where: {
          OR: [
            { email: { equals: cleanEmail, mode: 'insensitive' } },
            { referentiJson: { path: ['email'], equals: cleanEmail } },
          ],
        },
      });
    } catch (err) {
      console.error('Client login DB lookup error:', err);
    }

    // Qui c'era un ripiego su `app.getClienti()`: un metodo che AppPort non dichiara e che nessuna
    // implementazione definisce, quindi `'getClienti' in app` era sempre falso e il ramo non è mai
    // stato eseguito. Rimosso senza cambiare comportamento (era anche l'unico errore di `tsc` in
    // radice: TS restringe la proprietà a `unknown` e non la si può chiamare). Se serve un ripiego
    // in memoria, il metodo del port è `listaClienti()` — ma attivarlo cambia l'autenticazione.

    if (!cliente || !cliente.passwordHash) {
      return reply.code(401).send(nonValide);
    }

    if (!verifyPassword(password, cliente.passwordHash)) {
      return reply.code(401).send(nonValide);
    }

    const emailCliente = cliente.email || cleanEmail;
    const identitaPortale = `client-${cliente.id}`;
    const token = signJwt({
      userId: identitaPortale,
      tenantId: cliente.tenantId,
      email: emailCliente,
      ruolo: 'cliente',
    }, DURATA_SESSIONE_CLIENTE_MINUTI);

    await recordAudit({
      tenantId: cliente.tenantId,
      azione: 'CLIENTE_LOGIN',
      entita: cliente.nome,
      dettagli: `Login al portale cliente effettuato con successo da ${emailCliente}`,
      ipAddress: req.ip || '127.0.0.1',
    });

    return {
      ok: true,
      token,
      user: {
        id: identitaPortale,
        clienteId: cliente.id,
        nome: cliente.nome,
        email: emailCliente,
        ruolo: 'cliente',
        tenantId: cliente.tenantId,
      },
    };
  });

  server.get('/auth/me', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const payload = verifyJwt(token);
    if (!payload) {
      return reply.code(401).send({ errore: 'Token non valido o scaduto' });
    }

    let stato = 'attivo';
    try {
      if (payload.userId && !payload.userId.startsWith('client-')) {
        const u = await prismaAmministrativo().user.findUnique({ where: { id: payload.userId } });
        if (u) {
          stato = u.stato;
        }
      }
    } catch {}

    return {
      ok: true,
      user: {
        ...payload,
        stato,
        mustChangePassword: stato === 'invitato',
      },
    };
  });

  server.post<{
    Body: { currentPassword?: string; newPassword?: string };
  }>('/auth/change-password', async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const authUser = (req as any).user;
    const userId = authUser?.userId;

    if (!userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({ errore: 'La nuova password deve contenere almeno 8 caratteri.' });
    }

    try {
      const utente = await prismaAmministrativo().user.findUnique({ where: { id: userId } });
      if (!utente) {
        return reply.code(404).send({ errore: 'Utente non trovato' });
      }

      // Se l'utente ha già una password, verifica quella attuale
      if (utente.passwordHash) {
        if (!currentPassword) {
          return reply.code(400).send({ errore: 'Inserisci la password attuale per confermare la modifica.' });
        }
        if (!verifyPassword(currentPassword, utente.passwordHash)) {
          return reply.code(401).send({ errore: 'La password attuale non è corretta.' });
        }
      }

      const newHash = hashPassword(newPassword);
      await prismaAmministrativo().user.update({
        where: { id: utente.id },
        data: {
          passwordHash: newHash,
          stato: 'attivo',
        },
      });

      await recordAudit({
        tenantId: utente.tenantId || TENANT_DEFAULT,
        userId: utente.id,
        userEmail: utente.email,
        azione: 'PASSWORD_MODIFICATA',
        entita: utente.nome,
        dettagli: `Password aggiornata autonomamente dall'utente ${utente.email}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, messaggio: 'Password aggiornata con successo!' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento password' });
    }
  });

  server.get('/auth/profilo', async (req, reply) => {
    const authUser = (req as any).user;
    const userId = authUser?.userId;
    if (!userId) return reply.code(401).send({ errore: 'Non autenticato' });

    try {
      const utente = await prismaAmministrativo().user.findUnique({
        where: { id: userId },
        include: { tenant: true },
      });
      if (!utente) return reply.code(404).send({ errore: 'Utente non trovato' });
      return reply.send(senzaHash(utente));
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore recupero profilo' });
    }
  });

  server.put<{
    Body: { nome?: string; specializzazione?: string };
  }>('/auth/profilo', async (req, reply) => {
    const authUser = (req as any).user;
    const userId = authUser?.userId;
    if (!userId) return reply.code(401).send({ errore: 'Non autenticato' });

    const { nome, specializzazione } = req.body || {};
    try {
      const updated = await prismaAmministrativo().user.update({
        where: { id: userId },
        data: {
          ...(nome ? { nome: nome.trim() } : {}),
          ...(specializzazione !== undefined ? { specializzazione: specializzazione.trim() } : {}),
        },
      });
      return reply.send(senzaHash(updated));
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore salvataggio profilo' });
    }
  });

  server.post<{
    Body: { currentPassword?: string; newPassword?: string; clienteId?: string; email?: string };
  }>('/portal/change-password', async (req, reply) => {
    const { currentPassword, newPassword, clienteId, email } = req.body || {};
    const authUser = (req as any).user;

    if (!newPassword || newPassword.length < 6) {
      return reply.code(400).send({ errore: 'La nuova password deve contenere almeno 6 caratteri.' });
    }

    const cleanEmail = (email || authUser?.email || '').trim().toLowerCase();
    const targetClienteId = clienteId || (authUser?.userId?.startsWith('client-') ? authUser.userId.replace('client-', '') : null);

    try {
      let cliente: any = null;
      if (targetClienteId) {
        cliente = await prismaAmministrativo().cliente.findUnique({ where: { id: targetClienteId } });
      }
      if (!cliente && cleanEmail) {
        cliente = await prismaAmministrativo().cliente.findFirst({
          where: {
            OR: [
              { email: { equals: cleanEmail, mode: 'insensitive' } },
              { referentiJson: { path: ['email'], equals: cleanEmail } },
            ],
          },
        });
      }

      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      // Se il cliente ha già una password attiva e la sta cambiando, verifica quella attuale
      if (cliente.passwordHash && currentPassword) {
        if (!verifyPassword(currentPassword, cliente.passwordHash)) {
          return reply.code(401).send({ errore: 'La password attuale inserita non è corretta.' });
        }
      }

      const newHash = hashPassword(newPassword);
      await prismaAmministrativo().cliente.update({
        where: { id: cliente.id },
        data: { passwordHash: newHash },
      });

      await recordAudit({
        tenantId: cliente.tenantId,
        azione: 'CLIENTE_PASSWORD_MODIFICATA',
        entita: cliente.nome,
        dettagli: `Password del portale cliente aggiornata con successo per ${cliente.nome}`,
        ipAddress: req.ip || '127.0.0.1',
      });

      return reply.send({ ok: true, messaggio: 'Password del portale impostata con successo!' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento password portale' });
    }
  });

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
  server.get('/articoli', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      // Una lista vuota è una risposta legittima (studio appena iscritto senza
      // catalogo): prima veniva scambiata per un errore e sostituita coi dati
      // dell'adapter in-memory. Il ripiego resta solo se il DB non risponde.
      return await prisma.articolo.findMany({
        where: { tenantId, isAttivo: true },
        orderBy: { nome: 'asc' },
      });
    } catch {
      return app.listaArticoli();
    }
  });

  // Upload Documento Endpoint (Base64 file upload & static download)
  server.post<{
    Body: { filename: string; contentBase64: string };
  }>('/upload', async (req) => {
    const { filename, contentBase64 } = req.body;
    const res = await uploadDocumento(filename, contentBase64);
    await recordAudit({
      tenantId: (req as any).tenantId,
      azione: 'DOCUMENTO_CARICATO',
      entita: filename,
      dettagli: `Caricato nuovo file (${res.size}) con URL ${res.url}`,
      ipAddress: req.ip,
    });
    return res;
  });

  server.get<{ Params: { filename: string }; Querystring: { firma?: string; scad?: string } }>(
    '/uploads/:filename',
    async (req, reply) => {
      const fs = await import('fs');
      const path = await import('path');
      const filename = req.params.filename;

      // 1. Il nome file. Prima il parametro veniva concatenato così com'era, e Fastify
      // decodifica i parametri di rotta: `..%2f..%2f.env` arrivava qui come `../../.env` e
      // `path.join` usciva dalla cartella. Si rifiuta invece di sanificare, perché un nome
      // riscritto in silenzio darebbe 404 e nasconderebbe il tentativo.
      if (!nomeFileValido(filename)) {
        return reply.code(400).send({ errore: 'Nome file non valido' });
      }

      // 2. Il titolo per leggerlo. Due prove alternative, e non solo il Bearer, perché
      // questi URL finiscono in `<img src>` (logo dello studio nella sidebar, nelle fatture,
      // dentro l'HTML delle stampe PDF) e in href diretti: nessuno dei due può inviare un
      // header Authorization. La firma in query string è HMAC sullo stesso segreto dei JWT.
      const autenticato = Boolean((req as any).ruolo);
      const firmato = verificaFirmaDownload(filename, req.query?.firma, req.query?.scad);
      if (!autenticato && !firmato) {
        return reply.code(401).send({ errore: 'Accesso al file non autorizzato' });
      }

      const filePath = path.join(CARTELLA_UPLOADS, filename);
      // Terza rete: si verifica sul percorso risolto che il file stia davvero sotto
      // `uploads/`. Il controllo sul nome dovrebbe già bastare, ma questo regge anche alle
      // codifiche che quello non prevede — ed è l'unico che non dipende da una regex.
      const radice = path.resolve(CARTELLA_UPLOADS);
      if (!path.resolve(filePath).startsWith(radice + path.sep)) {
        return reply.code(400).send({ errore: 'Nome file non valido' });
      }

      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ errore: 'File non trovato' });
      }
      const ext = path.extname(filename).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else if (ext === '.pdf') mimeType = 'application/pdf';

      const fileStream = fs.createReadStream(filePath);
      return reply.type(mimeType).send(fileStream);
    },
  );

  // Aggiornamento Prezzo & Ore Articolo (§Admin)
  server.patch<{
    Params: { id: string };
    Body: { prezzoDefault?: number; oreDefault?: number; nome?: string };
  }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const { prezzoDefault, oreDefault, nome } = req.body;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const updated = await prisma.articolo.update({
        where: { id },
        data: {
          prezzoDefault: prezzoDefault !== undefined ? prezzoDefault : undefined,
          oreDefault: oreDefault !== undefined ? oreDefault : undefined,
          nome: nome !== undefined ? nome : undefined,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornato prezzo (€${(updated.prezzoDefault || 0)/100}) e ore (${updated.oreDefault}h)`,
        ipAddress: req.ip,
      });
      return reply.send(updated);
    } catch (err: any) {
      // §3.3 — il catch rispondeva { ok: true } anche quando l'aggiornamento non
      // aveva toccato nessuna riga (id sbagliato, articolo di un altro tenant
      // invisibile per RLS): la UI ringraziava e il dato restava com'era.
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      return reply.code(500).send({ errore: err?.message || 'Errore aggiornamento articolo' });
    }
  });

  server.post<{
    Body: {
      nome: string;
      categoria: string;
      oreDefault: number;
      prezzoDefault: number;
      passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
    };
  }>('/articoli', async (req, reply) => {
    const { nome, categoria, oreDefault, prezzoDefault, passaggi } = req.body;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    if (!nome || !categoria) {
      return reply.code(400).send({ errore: 'nome e categoria sono obbligatori' });
    }
    try {
      const art = await prisma.articolo.create({
        data: {
          tenantId,
          nome,
          categoria,
          oreDefault: oreDefault || 1,
          prezzoDefault: prezzoDefault || 0,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_CREATO',
        entita: art.nome,
        dettagli: `Creato articolo prestazione ${art.nome} (${art.categoria}) - €${art.prezzoDefault/100}`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(art);
    } catch {
      const articolo = await app.creaArticolo(req.body);
      return reply.code(201).send(articolo);
    }
  });

  server.post<{
    Body: {
      nome: string;
      categoria: string;
      giurisdizioneId?: string | null;
      prezzoPacchetto?: number | null;
      righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template', async (req, reply) => {
    const { nome, categoria, giurisdizioneId, prezzoPacchetto, righe, dipendenzeDaIds } = req.body;
    // §14 — il tenant è quello della richiesta (JWT), NON un valore fisso: prima la
    // creazione passava da app.creaModuloTemplate() che è legato al tenant Bluecode,
    // quindi per ogni altro studio l'inserimento veniva rifiutato dalle policy RLS.
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    if (!nome || !categoria || !righe || righe.length === 0) {
      return reply.code(400).send({ errore: 'nome, categoria e almeno un articolo nella distinta sono obbligatori' });
    }
    try {
      // Validazioni lette fuori dalla transazione: le risposte 400 devono uscire
      // pulite senza essere scambiate per guasti del DB dal catch qui sotto.
      if (giurisdizioneId) {
        const giur = await prisma.giurisdizione.findUnique({ where: { id: giurisdizioneId } });
        if (!giur) {
          return reply.code(400).send({ errore: 'La giurisdizione selezionata non esiste' });
        }
      }
      for (const r of righe) {
        const art = await prisma.articolo.findUnique({ where: { id: r.articoloId } });
        if (!art) {
          return reply.code(400).send({ errore: `Articolo non trovato nella distinta: ${r.articoloId}` });
        }
      }

      const modulo = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const creato = await tx.moduloTemplate.create({
            data: {
              tenantId,
              nome,
              categoria,
              // Prima andava perso: il body lo portava ma la vecchia creazione non lo
              // raccoglieva, e ogni modulo nuovo risultava «generico».
              giurisdizioneId: giurisdizioneId || null,
              prezzoPacchetto: prezzoPacchetto ?? null,
              versione: 1,
            },
          });

          for (const [idx, r] of righe.entries()) {
            // §3bis — la riga pinna la versione corrente dell'articolo: i progetti
            // già istanziati non devono cambiare quando il catalogo si aggiorna.
            const art = await tx.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
            await tx.rigaDistinta.create({
              data: {
                tenantId,
                moduloTemplateId: creato.id,
                articoloId: r.articoloId,
                articoloVersione: art.versione,
                ordine: idx + 1,
                quantita: r.quantita || 1,
                overrideOre: r.overrideOre || null,
                overridePrezzo: r.overridePrezzo || null,
              },
            });
          }

          for (const depId of dipendenzeDaIds || []) {
            await tx.moduloDipendenzaTemplate.create({
              data: {
                tenantId,
                moduloTemplateId: creato.id,
                dipendeDaModuloTemplateId: depId,
              },
            });
          }

          return tx.moduloTemplate.findUnique({
            where: { id: creato.id },
            include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
          });
        }),
      );

      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_CREATO',
        entita: nome,
        dettagli: `Creato modulo libreria ${nome} (${categoria}) con ${righe.length} articoli in distinta`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(modulo);
    } catch (err: any) {
      // Errori di vincolo (articolo/giurisdizione spariti fra validazione e
      // inserimento): messaggio pulito, non un 500 generico.
      if (err?.code === 'P2025' || err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento della distinta non è più valido' });
      }
      // Modalità test/demo senza DB raggiungibile: stesso ripiego in-memory di POST /articoli.
      const modulo = await app.creaModuloTemplate(req.body);
      return reply.code(201).send(modulo);
    }
  });

  // §36 — modifica di un modulo della libreria. Campi intestazione sempre; distinta
  // e dipendenze solo se presenti nel body, con sostituzione completa (deleteMany +
  // ricreazione). Tutto in una transazione: un errore a metà non deve lasciare il
  // modulo con una distinta parziale.
  server.put<{
    Params: { id: string };
    Body: {
      nome?: string;
      categoria?: string;
      giurisdizioneId?: string | null;
      prezzoPacchetto?: number | null;
      righe?: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template/:id', async (req, reply) => {
    const { id } = req.params;
    const body = req.body || {};
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.moduloTemplate.findUnique({ where: { id } });
      // RLS rende invisibili i moduli degli altri tenant: chi prova a modificarne
      // uno altrui riceve 404, come se non esistesse.
      if (!esistente) {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      if (body.giurisdizioneId) {
        const giur = await prisma.giurisdizione.findUnique({ where: { id: body.giurisdizioneId } });
        if (!giur) {
          return reply.code(400).send({ errore: 'La giurisdizione selezionata non esiste' });
        }
      }
      if (body.righe && body.righe.length === 0) {
        return reply.code(400).send({ errore: 'La distinta non può essere vuota' });
      }

      // §14 — come per la creazione: prisma diretto col tenant della richiesta,
      // non app.aggiornaModuloTemplate() che è legato a un tenant fisso.
      const aggiornato = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const data: Record<string, unknown> = {};
          if (body.nome !== undefined) data.nome = body.nome;
          if (body.categoria !== undefined) data.categoria = body.categoria;
          if (body.giurisdizioneId !== undefined) data.giurisdizioneId = body.giurisdizioneId;
          if (body.prezzoPacchetto !== undefined) data.prezzoPacchetto = body.prezzoPacchetto;
          await tx.moduloTemplate.update({ where: { id }, data });

          if (body.righe) {
            await tx.rigaDistinta.deleteMany({ where: { tenantId, moduloTemplateId: id } });
            for (const [idx, r] of body.righe.entries()) {
              const art = await tx.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
              await tx.rigaDistinta.create({
                data: {
                  tenantId,
                  moduloTemplateId: id,
                  articoloId: r.articoloId,
                  articoloVersione: art.versione,
                  ordine: idx + 1,
                  quantita: r.quantita || 1,
                  overrideOre: r.overrideOre || null,
                  overridePrezzo: r.overridePrezzo || null,
                },
              });
            }
          }

          if (body.dipendenzeDaIds) {
            await tx.moduloDipendenzaTemplate.deleteMany({ where: { tenantId, moduloTemplateId: id } });
            for (const depId of body.dipendenzeDaIds) {
              await tx.moduloDipendenzaTemplate.create({
                data: { tenantId, moduloTemplateId: id, dipendeDaModuloTemplateId: depId },
              });
            }
          }

          return tx.moduloTemplate.findUnique({
            where: { id },
            include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
          });
        }),
      );

      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_AGGIORNATO',
        entita: esistente.nome,
        dettagli: `Aggiornato modulo libreria ${id}` + (body.righe ? ` con nuova distinta di ${body.righe.length} articoli` : ''),
        ipAddress: req.ip,
      });
      return reply.send(aggiornato);
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(400).send({ errore: 'Un articolo della nuova distinta non esiste' });
      }
      if (err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento di distinta o dipendenza non è valido' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(await app.aggiornaModuloTemplate(id, body));
    }
  });

  // §36 / §30 — «eliminazione» = disattivazione: i progetti e i preventivi già
  // creati referenziano ancora il template, che quindi non può essere cancellato
  // davvero. Smettere di mostrarlo in libreria (isAttivo=false) ottiene lo scopo
  // senza rompere lo storico.
  server.delete<{ Params: { id: string } }>('/moduli-template/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.moduloTemplate.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      await prisma.moduloTemplate.update({ where: { id }, data: { isAttivo: false } });
      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_DISATTIVATO',
        entita: esistente.nome,
        dettagli: `Disattivato modulo libreria ${esistente.nome} (${id}): non compare più nella libreria, restano attivi i progetti esistenti`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, id, isAttivo: false });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(app.disattivaModuloTemplate(id));
    }
  });

  // §36 / §30 — stessa regola dei moduli: l'articolo sparisce dal catalogo ma le
  // distinte e le microvoci dei progetti continuano a referenziarlo.
  server.delete<{ Params: { id: string } }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.articolo.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      await prisma.articolo.update({ where: { id }, data: { isAttivo: false } });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_DISATTIVATO',
        entita: esistente.nome,
        dettagli: `Disattivato articolo ${esistente.nome} (${id}): non compare più nel catalogo`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, id, isAttivo: false });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(app.disattivaArticolo(id));
    }
  });

  server.get<{ Params: { id: string } }>('/clienti/:id', async (req, reply) => {
    try {
      const c = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (c) return reply.send(c);
      return app.getCliente(req.params.id);
    } catch {
      return app.getCliente(req.params.id);
    }
  });

  server.post<{ Params: { id: string }; Body: { email?: string } }>('/clienti/:id/magic-link', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;

    try {
      const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      const toEmail = req.body?.email?.trim();
      if (!toEmail) {
        return reply.code(400).send({ errore: "Indirizzo email del destinatario obbligatorio" });
      }

      const magicToken = generateMagicToken(cliente.id);
      const scadenza = new Date(Date.now() + GIORNI_VALIDITA_MAGIC_LINK * 24 * 60 * 60 * 1000);

      await prisma.magicLink.create({
        data: {
          tenantId,
          clienteId: cliente.id,
          tokenHash: hashMagicToken(magicToken),
          scadenza,
          email: toEmail,
        },
      });

      const magicUrl = `${baseUrlApplicazione()}/portal?magic_token=${magicToken}`;

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const customSmtp = tenant?.smtpHost && tenant?.smtpUser && tenant?.smtpPass ? {
        host: tenant.smtpHost,
        port: tenant.smtpPort || 465,
        secure: tenant.smtpSecure ?? true,
        user: tenant.smtpUser,
        pass: tenant.smtpPass,
        fromEmail: tenant.smtpFromEmail || tenant.smtpUser,
        fromName: tenant.smtpFromName || tenant.ragioneSociale || 'BluMan Advisory',
      } : undefined;

      const esitoInvio = await sendMagicLinkEmail(toEmail, cliente.nome, magicUrl, customSmtp);
      await recordAudit({
        tenantId,
        azione: 'MAGIC_LINK_GENERATO',
        entita: cliente.nome,
        dettagli: `Generato Magic Link per l'accesso passwordless del cliente (${toEmail}), valido fino al ${scadenza.toISOString()}`,
        ipAddress: req.ip,
      });

      // `sent: false` da solo non dice niente a chi sta guardando lo schermo: il motivo
      // dell'invio mancato arriva insieme, così l'operatore sa se deve correggere le
      // impostazioni della casella o mandare il link a mano.
      return {
        ok: true,
        sent: esitoInvio.ok,
        erroreInvio: esitoInvio.ok ? undefined : esitoInvio.errore,
        magicUrl,
        magicToken,
        scadenza: scadenza.toISOString(),
      };
    } catch (err: any) {
      console.error('Errore generazione magic link:', err);
      return reply.code(500).send({ errore: err.message || 'Errore generazione Magic Link' });
    }
  });

  /**
   * Rinnova la firma del `logoUrl` a ogni lettura, quando è un file servito da noi.
   *
   * La firma scade dopo sette giorni mentre il valore in tabella resta: senza questo, il
   * logo dello studio si romperebbe da solo dopo una settimana — anche nelle PDF, dove
   * finisce dentro un `<img src>` generato lato server.
   */
  function conFirmaLogo<T>(tenant: T): T {
    if (!tenant || typeof tenant !== 'object') return tenant;
    const logoUrl = (tenant as any).logoUrl;
    if (typeof logoUrl !== 'string') return tenant;
    return { ...(tenant as any), logoUrl: rifirmaUrlUpload(logoUrl) };
  }

  server.get('/tenant/info', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const defaultNames: Record<string, string> = {
      '00000000-0000-0000-0000-000000000001': 'Studio Advisory & Legal Partners',
      '00000000-0000-0000-0000-000000000002': 'Advisory Italia S.r.l. (Milano)',
      '00000000-0000-0000-0000-000000000003': 'Swiss Wealth Management SA (Lugano)',
    };
    const defaultName = defaultNames[tenantId] || 'Studio Professionale';

    try {
      let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: {
            id: tenantId,
            ragioneSociale: defaultName,
            piano: 'enterprise',
            stato: 'attivo',
          },
        });
      }
      return conFirmaLogo(tenant);
    } catch {
      if (!inMemoryTenantStore.has(tenantId)) {
        inMemoryTenantStore.set(tenantId, {
          id: tenantId,
          ragioneSociale: defaultName,
          piano: 'enterprise',
          stato: 'attivo',
        });
      }
      return conFirmaLogo(inMemoryTenantStore.get(tenantId));
    }
  });

  server.patch<{ Body: Record<string, any> }>('/tenant/info', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const rawBody = (req.body || {}) as Record<string, any>;

    const allowedKeys = [
      'ragioneSociale', 'piva', 'codiceFiscale', 'sedeLegale', 'sedeOperativa',
      'logoUrl', 'coloreTemaFattura', 'notePieFattura', 'titoloIntestazione',
      'iban', 'email', 'pec', 'telefono',
      'waPhoneId', 'waAccessToken', 'waVerifyToken', 'tgBotToken', 'tgBotUsername',
      'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass',
      'smtpFromEmail', 'smtpFromName', 'smtpReplyTo', 'smtpBcc',
      'imapHost', 'imapPort', 'imapSecure', 'imapUser', 'imapPass',
      'imapFolder', 'imapPollInterval', 'imapProtocol', 'emailSignatureHtml',
      'regimeFiscale', 'capitaleSociale', 'regImprese', 'mostraSdi', 'mostraIva',
      'emailInboundParseUrl', 'signalCliEndpoint',
      // `leadAdvisorPassword` è stato rimosso: era una password in chiaro sulla riga
      // Tenant, scrivibile da qualunque utente del tenant via questa rotta. Le password
      // vivono solo come hash scrypt su `user.passwordHash` (§23).
      'leadAdvisorNome', 'leadAdvisorEmail', 'giurisdizione',
      'durataMesi', 'dataAttivazione', 'dataScadenza',
      'piano', 'stato'
    ];

    const sanitizedData: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (rawBody[key] !== undefined) {
        if (key === 'smtpPort' || key === 'imapPort' || key === 'durataMesi') {
          sanitizedData[key] = rawBody[key] ? Number(rawBody[key]) : null;
        } else if (key === 'smtpSecure' || key === 'imapSecure' || key === 'mostraSdi' || key === 'mostraIva') {
          sanitizedData[key] = Boolean(rawBody[key]);
        } else {
          sanitizedData[key] = rawBody[key];
        }
      }
    }

    try {
      const updated = await prisma.tenant.upsert({
        where: { id: tenantId },
        update: sanitizedData,
        create: {
          id: tenantId,
          ragioneSociale: sanitizedData.ragioneSociale || 'Studio Professionale',
          piano: 'enterprise',
          stato: 'attivo',
          ...sanitizedData,
        },
      });
      inMemoryTenantStore.set(tenantId, { ...inMemoryTenantStore.get(tenantId), ...sanitizedData, id: tenantId });
      await recordAudit({
        tenantId,
        azione: 'IMPOSTAZIONI_TENANT_SALVATE',
        entita: 'Anagrafica Studio & Impostazioni',
        dettagli: `Aggiornati e sincronizzati su DB Supabase tutti i parametri dello studio: ${sanitizedData.ragioneSociale || tenantId}`,
      });
      return reply.send(conFirmaLogo(updated));
    } catch (err) {
      console.warn('Prisma tenant upsert fallback to inMemory store:', err);
      const current = inMemoryTenantStore.get(tenantId) || { id: tenantId };
      const updated = { ...current, ...sanitizedData, id: tenantId };
      inMemoryTenantStore.set(tenantId, updated);
      return reply.send(conFirmaLogo(updated));
    }
  });

  // ── GESTIONE UTENTI TEAM TENANT ───────────────────────────────────
  // §2bis — gerarchia: il super_admin sovrintende tutti i tenant (tenantId null);
  // l'advisor è il responsabile del proprio tenant e ne gestisce il team; i
  // collaboratori appartengono al tenant da cui sono stati creati e non creano utenti.

  /** L'hash della password non esce mai dal server, nemmeno verso il frontend dello studio. */
  function senzaHash<T extends { passwordHash?: string | null }>(utente: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _ignorato, ...resto } = utente;
    return resto;
  }

  server.get('/tenant/utenti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const ruoloRichiedente = (req as any).ruolo as string | undefined;

    try {
      const utenti = await prisma.user.findMany({
        // Il super_admin vede anche gli utenti senza tenant (gli altri super_admin);
        // per ogni altro ruolo la lista è strettamente limitata al proprio tenant.
        where: ruoloRichiedente === 'super_admin' ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send(utenti.map(senzaHash));
    } catch (err) {
      // Il ripiego di prima chiamava `app.listaUtenti()`, che era un secondo percorso di
      // scrittura sullo stesso database appena fallito — e riassegnava utenti al tenant
      // corrente. Se la lettura non riesce (database irraggiungibile, o policy RLS che
      // nega perché manca il contesto) la risposta onesta è un errore: un elenco vuoto
      // farebbe sembrare lo studio senza collaboratori.
      console.error('GET /tenant/utenti —', err instanceof Error ? err.message : err);
      return reply.code(503).send({ errore: 'Elenco team non disponibile. Riprova tra poco.' });
    }
  });

  server.post<{
    Body: { nome?: string; email?: string; ruolo?: string; specializzazione?: string; costoOrarioCentesimi?: number };
  }>('/tenant/utenti', async (req, reply) => {
    const tenantCorrente = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const ruoloRichiedente = (req as any).ruolo as string | undefined;

    // Solo super_admin (qualunque tenant) e advisor (il proprio) ampliano il team.
    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply
        .code(403)
        .send({ errore: 'Solo il responsabile dello studio o il super admin possono creare utenti.' });
    }

    const { nome, email, ruolo, specializzazione, costoOrarioCentesimi } = req.body || {};
    if (!nome || !email) {
      return reply.code(400).send({ errore: 'Nome ed email sono obbligatori' });
    }
    const emailPulita = email.trim().toLowerCase();

    // Il ruolo `cliente` non si crea da qui: il cliente è un'anagrafica separata (§3) e
    // accede passwordless via magic link (§23).
    const RUOLI_DELEGABILI = ['advisor', 'collaboratore_interno', 'collaboratore_esterno'];
    let ruoloFinale = RUOLI_DELEGABILI.includes(ruolo || '') ? (ruolo as string) : 'collaboratore_interno';

    // Senza questo vincolo un advisor si promuoverebbe a livello piattaforma creando
    // un secondo super_admin con un'email che controlla.
    if (ruolo === 'super_admin') {
      if (ruoloRichiedente !== 'super_admin') {
        return reply.code(403).send({ errore: 'Solo il super admin può creare un altro super admin.' });
      }
      ruoloFinale = 'super_admin';
    }

    // Il nuovo utente appartiene al tenant da cui viene creato. Il super_admin è l'unico
    // senza tenant, perché li sovrintende tutti (§2bis).
    const tenantAssegnato = ruoloFinale === 'super_admin' ? null : tenantCorrente;

    try {
      const esistente = await prisma.user.findUnique({ where: { email: emailPulita } });

      // L'upsert su email, da solo, permetteva di sottrarre un utente al suo tenant:
      // reinserendo la sua email lo si riassegnava al proprio studio.
      if (esistente && ruoloRichiedente !== 'super_admin' && esistente.tenantId !== tenantCorrente) {
        return reply.code(409).send({ errore: 'Questa email è già registrata in un altro studio.' });
      }

      // Una riga che è già super_admin la tocca solo un super_admin, e il controllo guarda
      // il ruolo *esistente*, non quello richiesto. Il vincolo qui sopra sul tenant non
      // basta: un super_admin con `tenant_id` valorizzato per errore — condizione che il
      // database aveva davvero, dal vecchio auto-seed di `listaUtenti` — appartiene allo
      // stesso tenant dell'advisor, quindi supera il 409. L'advisor arrivava all'update e
      // riscriveva `ruolo` a `collaboratore_interno`: il super admin della piattaforma
      // declassato dal responsabile di un singolo studio.
      if (esistente?.ruolo === 'super_admin' && ruoloRichiedente !== 'super_admin') {
        return reply.code(403).send({ errore: 'Solo il super admin può modificare un super admin.' });
      }

      // Password iniziale generata dal server e mostrata una sola volta nella risposta,
      // così il responsabile può consegnarla. Nessuna password di default (§23).
      const passwordTemporanea = esistente?.passwordHash ? null : generaPasswordTemporanea();

      const datiComuni = {
        nome,
        ruolo: ruoloFinale as any,
        specializzazione: specializzazione || undefined,
        costoOrarioCentesimi: costoOrarioCentesimi || undefined,
        tenantId: tenantAssegnato,
        ...(passwordTemporanea ? { passwordHash: hashPassword(passwordTemporanea) } : {}),
      };

      const utente = esistente
        ? await prisma.user.update({ where: { id: esistente.id }, data: datiComuni })
        : await prisma.user.create({
            data: {
              ...datiComuni,
              email: emailPulita,
              specializzazione: specializzazione || 'Collaboratore di Studio',
              costoOrarioCentesimi: costoOrarioCentesimi || 3000,
              stato: 'invitato', // Obbligo cambio password al primo accesso
            },
          });

      await recordAudit({
        tenantId: tenantCorrente,
        ruolo: ruoloRichiedente,
        azione: esistente ? 'UTENTE_AGGIORNATO' : 'UTENTE_CREATO',
        entita: utente.nome,
        dettagli: `${esistente ? 'Aggiornato' : 'Creato'} ${utente.nome} (${utente.email}) con ruolo ${utente.ruolo} nel tenant ${tenantAssegnato ?? 'piattaforma'}`,
        ipAddress: req.ip,
      });

      // passwordTemporanea è l'unico momento in cui la password è leggibile: non viene
      // salvata in chiaro né rispedita da nessun altro endpoint.
      return reply.code(201).send({ ...senzaHash(utente), passwordTemporanea });
    } catch (err: any) {
      // P2002 = vincolo di unicità sull'email. Ci si arriva quando la riga esiste ma RLS
      // l'ha nascosta alla `findUnique` qui sopra, perché appartiene a un altro studio o
      // è un super_admin senza tenant: la create tenta l'inserimento e il database la
      // respinge. È lo stesso caso del 409, quindi merita lo stesso messaggio invece di
      // un 500 con il testo dell'errore Prisma addosso.
      if (err?.code === 'P2002') {
        return reply.code(409).send({ errore: 'Questa email è già registrata in un altro studio.' });
      }
      return reply.code(500).send({ errore: err.message || 'Errore creazione collaboratore' });
    }
  });

  /**
   * Reset Password Utente / Collaboratore dello Studio
   * Riservato a Super Admin e Lead Advisor dello Studio.
   */
  server.post<{ Params: { id: string } }>('/tenant/utenti/:id/reset-password', async (req, reply) => {
    const ruoloRichiedente = (req as any).ruolo as string | undefined;
    const tenantCorrente = (req as any).tenantId as string;
    const { id } = req.params;

    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply.code(403).send({ errore: 'Solo il Super Admin o il Lead Advisor possono resettare le password degli utenti.' });
    }

    try {
      const utente = await prisma.user.findUnique({ where: { id } });
      if (!utente) {
        return reply.code(404).send({ errore: 'Utente non trovato' });
      }

      // Un advisor può resettare solo utenti del proprio studio
      if (ruoloRichiedente === 'advisor' && utente.tenantId !== tenantCorrente) {
        return reply.code(403).send({ errore: 'Non puoi resettare password di utenti appartenenti ad altri studi.' });
      }

      // Non permettere a un advisor di resettare la password di un super_admin
      if (ruoloRichiedente !== 'super_admin' && utente.ruolo === 'super_admin') {
        return reply.code(403).send({ errore: 'Non autorizzato a resettare la password del Super Admin.' });
      }

      const passwordTemporanea = generaPasswordTemporanea();
      const passwordHash = hashPassword(passwordTemporanea);

      await prismaAmministrativo().user.update({
        where: { id: utente.id },
        data: {
          passwordHash,
          stato: 'invitato', // Imposta 'invitato' per obbligare il cambio password al primo accesso
        },
      });

      await recordAudit({
        tenantId: utente.tenantId || tenantCorrente,
        ruolo: ruoloRichiedente,
        azione: 'PASSWORD_UTENTE_RESETTATA',
        entita: utente.nome,
        dettagli: `Password temporanea rigenerata per ${utente.email} da ${ruoloRichiedente}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        id: utente.id,
        nome: utente.nome,
        email: utente.email,
        passwordTemporanea,
        messaggio: 'Password temporanea generata con successo. L\'utente dovrà cambiarla al primo accesso.',
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore reset password utente' });
    }
  });

  // ── GESTIONE MULTI-TENANT SUPER ADMIN ─────────────────────────────
  /**
   * §2bis — l'intero blocco `/admin/tenants` è riservato al super_admin.
   *
   * Prima di questo controllo le quattro rotte erano raggiungibili da qualunque utente
   * autenticato: un collaboratore interno poteva elencare tutti gli studi della
   * piattaforma con ragione sociale, P.IVA ed email del responsabile, registrarne di
   * nuovi, sospenderli e cancellarli. RLS non c'entra: `Tenant` è la tabella che
   * *contiene* i tenant, non una tabella figlia filtrata per `tenant_id`.
   */
  function soloSuperAdmin(req: any, reply: any): boolean {
    if (req.ruolo !== 'super_admin') {
      reply.code(403).send({ errore: 'Riservato al super admin della piattaforma.' });
      return false;
    }
    return true;
  }

  server.get('/admin/tenants', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    try {
      const tenants = await prisma.tenant.findMany({
        include: {
          _count: {
            select: { users: true, clienti: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return reply.send(tenants.map(t => ({
        id: t.id,
        ragioneSociale: t.ragioneSociale,
        giurisdizione: t.giurisdizione || 'Italia',
        pIva: t.piva || '',
        leadAdvisorNome: t.leadAdvisorNome || 'Lead Senior Advisor',
        leadAdvisorEmail: t.leadAdvisorEmail || t.email || '',
        // `leadAdvisorPassword` non viene più restituito: era la password in chiaro del
        // responsabile dello studio, con `'Studio2026!'` come ripiego quando la colonna
        // era vuota — cioè una password valida annunciata dall'API. La password iniziale
        // si vede una volta sola, nella risposta alla creazione.
        piano: t.piano || 'enterprise',
        stato: t.stato || 'attivo',
        durataMesi: t.durataMesi || 12,
        dataAttivazione: t.dataAttivazione || new Date(t.createdAt).toLocaleDateString('it-IT'),
        dataScadenza: t.dataScadenza || '',
        utentiCount: (t as any)._count?.users || 1,
        progettiCount: (t as any)._count?.clienti || 0,
        fatturatoMensile: 0,
      })));
    } catch {
      return reply.send([]);
    }
  });

  /**
   * Crea lo studio e, insieme, l'utente `advisor` che ne è il responsabile: erano due
   * passaggi separati, e il secondo non avveniva mai — il tenant nasceva senza nessun
   * utente e la password del responsabile viveva in chiaro nella colonna
   * `lead_advisor_password`. Ora la password è generata dal server, salvata solo come
   * hash scrypt e restituita una volta sola in `passwordTemporanea`.
   */
  server.post<{ Body: Record<string, any> }>('/admin/tenants', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    const b = req.body || {};
    const emailResponsabile = (b.leadAdvisorEmail || b.email || '').trim().toLowerCase();
    try {
      const tenant = await prisma.tenant.create({
        data: {
          id: b.id || undefined,
          ragioneSociale: b.ragioneSociale || 'Nuovo Studio',
          giurisdizione: b.giurisdizione,
          piva: b.pIva || b.piva,
          email: emailResponsabile || undefined,
          leadAdvisorNome: b.leadAdvisorNome,
          leadAdvisorEmail: emailResponsabile || undefined,
          piano: b.piano || 'enterprise',
          stato: b.stato || 'attivo',
          durataMesi: Number(b.durataMesi) || 12,
          dataAttivazione: b.dataAttivazione,
          dataScadenza: b.dataScadenza,
        }
      });

      // Senza responsabile lo studio non è utilizzabile: nessuno potrebbe accedervi.
      let passwordTemporanea: string | null = null;
      if (emailResponsabile) {
        const esistente = await prisma.user.findUnique({ where: { email: emailResponsabile } });
        if (!esistente) {
          passwordTemporanea = generaPasswordTemporanea();
          await prisma.user.create({
            data: {
              email: emailResponsabile,
              nome: b.leadAdvisorNome || 'Lead Senior Advisor',
              ruolo: 'advisor' as any,
              tenantId: tenant.id,
              specializzazione: `Lead Partner — ${tenant.ragioneSociale}`,
              passwordHash: hashPassword(passwordTemporanea),
              stato: 'attivo',
            },
          });
        }
      }

      await recordAudit({
        tenantId: tenant.id,
        ruolo: 'super_admin',
        azione: 'TENANT_CREATO',
        entita: tenant.ragioneSociale,
        dettagli: `Studio registrato con responsabile ${emailResponsabile || '(nessuno)'}`,
        ipAddress: req.ip,
      });

      return reply.code(201).send({ ...tenant, passwordTemporanea });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore creazione tenant' });
    }
  });

  server.patch<{ Params: { id: string }; Body: Record<string, any> }>('/admin/tenants/:id', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    const { id } = req.params;
    const b = req.body || {};
    try {
      const updated = await prisma.tenant.update({
        where: { id },
        data: {
          ...(b.ragioneSociale && { ragioneSociale: b.ragioneSociale }),
          ...(b.stato && { stato: b.stato }),
          ...(b.piano && { piano: b.piano }),
          ...(b.dataScadenza && { dataScadenza: b.dataScadenza }),
          ...(b.durataMesi !== undefined && { durataMesi: Number(b.durataMesi) }),
          ...(b.leadAdvisorNome && { leadAdvisorNome: b.leadAdvisorNome }),
          ...(b.leadAdvisorEmail && { leadAdvisorEmail: b.leadAdvisorEmail }),
          // Nessuna scrittura di password qui: per rigenerarla c'è
          // POST /admin/tenants/:id/reset-password, che ne salva solo l'hash.
        }
      });
      return reply.send(updated);
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento tenant' });
    }
  });

  /**
   * Rigenera la password del responsabile dello studio e la restituisce una volta sola,
   * perché il super admin possa consegnarla. Sostituisce la vecchia pratica di rileggere
   * `leadAdvisorPassword` dal database, che presupponeva di averla conservata in chiaro.
   */
  server.post<{ Params: { id: string } }>('/admin/tenants/:id/reset-password', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    const { id } = req.params;
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) return reply.code(404).send({ errore: 'Studio non trovato' });

      const emailResponsabile = (tenant.leadAdvisorEmail || tenant.email || '').trim().toLowerCase();
      if (!emailResponsabile) {
        return reply.code(400).send({ errore: 'Lo studio non ha un responsabile con email.' });
      }

      const passwordTemporanea = generaPasswordTemporanea();
      const passwordHash = hashPassword(passwordTemporanea);
      const esistente = await prisma.user.findUnique({ where: { email: emailResponsabile } });

      if (esistente) {
        await prisma.user.update({ where: { id: esistente.id }, data: { passwordHash, stato: 'invitato' } });
      } else {
        await prisma.user.create({
          data: {
            email: emailResponsabile,
            nome: tenant.leadAdvisorNome || 'Lead Senior Advisor',
            ruolo: 'advisor' as any,
            tenantId: tenant.id,
            specializzazione: `Lead Partner — ${tenant.ragioneSociale}`,
            passwordHash,
            stato: 'invitato',
          },
        });
      }

      await recordAudit({
        tenantId: id,
        ruolo: 'super_admin',
        azione: 'PASSWORD_RESPONSABILE_RIGENERATA',
        entita: tenant.ragioneSociale,
        dettagli: `Nuova password temporanea emessa per ${emailResponsabile}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, email: emailResponsabile, passwordTemporanea });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore reset password' });
    }
  });

  server.delete<{ Params: { id: string } }>('/admin/tenants/:id', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    const { id } = req.params;
    try {
      await prisma.tenant.delete({ where: { id } });
      return reply.send({ ok: true, id });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore eliminazione tenant' });
    }
  });

  server.post<{ Body: { smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPass?: string; smtpFromEmail?: string; smtpFromName?: string; emailDestinatario?: string } }>('/tenant/test-email', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    let dbTenant: any = null;
    try {
      dbTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    } catch {}

    const body = req.body || {};
    const host = body.smtpHost || dbTenant?.smtpHost || process.env.SMTP_HOST || 'authsmtp.register.it';
    const port = Number(body.smtpPort) || Number(dbTenant?.smtpPort) || Number(process.env.SMTP_PORT) || 465;
    const secure = body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : (dbTenant?.smtpSecure !== undefined ? Boolean(dbTenant.smtpSecure) : port === 465);
    const user = body.smtpUser || dbTenant?.smtpUser || process.env.SMTP_USER || 'info@bluecode.advisory';
    const pass = body.smtpPass || dbTenant?.smtpPass || process.env.SMTP_PASS || '';
    const fromEmail = body.smtpFromEmail || dbTenant?.smtpFromEmail || user;
    const fromName = body.smtpFromName || dbTenant?.smtpFromName || 'BlueCode Advisory';
    const toEmail = body.emailDestinatario || user;

    const res = await verifyAndSendTestSmtp({
      host,
      port,
      secure,
      user,
      pass,
      fromEmail,
      fromName,
      toEmail,
    });

    if (!res.success) {
      return reply.code(400).send(res);
    }
    return reply.send(res);
  });

  server.post<{ Body: { imapHost?: string; imapPort?: number; imapUser?: string; imapPass?: string; imapSecure?: boolean } }>('/tenant/test-imap', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    let dbTenant: any = null;
    try {
      dbTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    } catch {}

    const body = req.body || {};
    const host = body.imapHost || dbTenant?.imapHost || 'imap.register.it';
    const port = Number(body.imapPort) || Number(dbTenant?.imapPort) || 993;
    const secure = body.imapSecure !== undefined ? Boolean(body.imapSecure) : (dbTenant?.imapSecure !== undefined ? Boolean(dbTenant.imapSecure) : port === 993);
    const user = body.imapUser || dbTenant?.imapUser || 'info@bluecode.advisory';
    const pass = body.imapPass || dbTenant?.imapPass || dbTenant?.smtpPass || '';

    const res = await verifyRealImap({
      host,
      port,
      secure,
      user,
      pass,
    });

    if (!res.success) {
      return reply.code(400).send(res);
    }
    return reply.send(res);
  });

  /**
   * Prova reale del canale.
   *
   * Prima questa rotta rispondeva `success: true` a qualunque cosa, senza contattare nessuno,
   * e stampava un Phone ID e un App ID scritti nel codice. Chi premeva «Testa connessione»
   * leggeva «connesso e verificato su Meta Cloud API» anche con le credenziali assenti o
   * sbagliate, e scopriva il guasto il giorno in cui a un cliente non arrivava il codice di
   * firma. Ora ogni canale viene interrogato per davvero e l'esito è quello che rispondono
   * Meta, Telegram o il server SMTP: un canale rotto risponde 400.
   */
  server.post<{ Body: { channel?: string; waPhoneId?: string; waAccessToken?: string } }>('/tenant/test-channel', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const canale = (req.body?.channel || '').toLowerCase();
    const cred = await credenzialiCanali(tenantId);

    // Le credenziali nel corpo servono a provarle prima di salvarle: se non ci sono si usano
    // quelle già registrate per lo studio.
    const waPhoneId = req.body?.waPhoneId || cred.waPhoneId;
    const waAccessToken = req.body?.waAccessToken || cred.waAccessToken;

    const esito = (success: boolean, message: string) =>
      success ? reply.send({ success, message }) : reply.code(400).send({ success, message });

    try {
      if (canale === 'whatsapp') {
        if (!waPhoneId || !waAccessToken) {
          return esito(false, 'Phone Number ID o Access Token di WhatsApp non impostati.');
        }
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(waPhoneId)}?fields=display_phone_number,verified_name,quality_rating`,
          { headers: { Authorization: `Bearer ${waAccessToken}` } },
        );
        const dati: any = await r.json().catch(() => ({}));
        if (!r.ok) {
          return esito(false, `Meta ha rifiutato le credenziali (HTTP ${r.status}): ${dati?.error?.message || 'errore non specificato'}`);
        }
        return esito(
          true,
          `WhatsApp attivo sul numero ${dati.display_phone_number || waPhoneId}` +
            `${dati.verified_name ? ` — ${dati.verified_name}` : ''}` +
            `${dati.quality_rating ? ` (qualità: ${dati.quality_rating})` : ''}.`,
        );
      }

      if (canale === 'telegram') {
        if (!cred.tgBotToken) return esito(false, 'Token del bot Telegram non impostato.');
        const r = await fetch(`https://api.telegram.org/bot${cred.tgBotToken}/getMe`);
        const dati: any = await r.json().catch(() => ({}));
        if (!r.ok || !dati?.ok) {
          return esito(false, `Telegram ha rifiutato il token: ${dati?.description || `HTTP ${r.status}`}`);
        }
        return esito(
          true,
          `Bot raggiungibile: @${dati.result?.username}. Perché il canale sia utilizzabile ogni ` +
            `cliente deve scrivere al bot almeno una volta: è Telegram a non permettere il ` +
            `contrario, e finché non lo fa non esiste una chat su cui spedire.`,
        );
      }

      if (canale === 'email' || canale === 'smtp') {
        const trasporto = createTransporter(cred.smtp);
        if (!trasporto) return esito(false, 'SMTP non impostato: mancano host, utenza o password.');
        await trasporto.verify();
        return esito(
          true,
          `Server SMTP raggiungibile e credenziali accettate${cred.smtpFromEmail ? ` (mittente ${cred.smtpFromEmail})` : ''}.`,
        );
      }

      // A «signal» rispondeva «Daemon Signal REST API v1 in ascolto sul container Docker»:
      // quel demone non esiste in questo progetto e non c'è una riga di codice che lo
      // contatti. Dichiararlo in ascolto era inventare un'infrastruttura.
      return esito(
        false,
        `Canale «${canale || 'non indicato'}» non gestito: la piattaforma non ha un invio da provare per questo canale.`,
      );
    } catch (err: any) {
      return esito(false, `Prova non riuscita: ${err?.message || 'errore di rete'}`);
    }
  });

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
    const allowOrigin = requestOrigin && origineInWhitelist(requestOrigin) ? requestOrigin : (requestOrigin || '*');

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // i proxy non devono bufferizzare lo stream
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-tenant-id, Accept, Origin, X-Requested-With',
    });
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
  server.get('/clienti', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const clienti = await prisma.cliente.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return clienti.map(c => {
        const ref = c.referentiJson && typeof c.referentiJson === 'object' ? (c.referentiJson as any) : {};
        return {
          ...ref,
          ...c,
          email: c.email || ref.email || '',
          hasPassword: Boolean(c.passwordHash),
          codiceFiscale: c.codiceFiscale || ref.codiceFiscale || ref.codFisc,
          codFisc: c.codiceFiscale || ref.codiceFiscale || ref.codFisc,
          sdiCode: c.sdiCode || ref.sdiCode || ref.codiceSdi || 'SUBM70N',
          codiceSdi: c.sdiCode || ref.sdiCode || ref.codiceSdi || 'SUBM70N',
          iban: c.iban || ref.iban,
          piva: c.piva || ref.piva,
          sedeLegale: c.sedeLegale || ref.sedeLegale,
          giurisdizione: c.giurisdizione || ref.giurisdizione,
          rischioAml: c.rischioAml || ref.rischioAml || 'medio',
          ubo: c.ubo || ref.ubo,
          fontePatrimonio: c.fontePatrimonio || ref.fontePatrimonio,
          dataKyc: c.dataKyc || ref.dataKyc,
        };
      });
    } catch {
      // Database non raggiungibile: si serve la porta applicativa, come fanno già
      // /progetti e /preventivi. Restituire [] silenziosamente nascondeva il guasto.
      return (await app.listaClienti()) || [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/clienti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const b = (req.body || {}) as Record<string, any>;
    if (!b.nome) return reply.code(400).send({ errore: 'Il nome del cliente è obbligatorio' });

    // `tipo` non ha un default: da persona fisica o società dipendono AML, regime
    // fiscale e fatturazione. Cadere silenziosamente su 'company' significava
    // classificare male il cliente senza che nessuno se ne accorgesse.
    if (b.tipo !== 'individual' && b.tipo !== 'company') {
      return reply.code(400).send({ errore: "Il tipo cliente è obbligatorio: 'individual' o 'company'" });
    }

    const referentiObj = b.referentiJson
      ? (typeof b.referentiJson === 'string' ? JSON.parse(b.referentiJson) : b.referentiJson)
      : {
          capitale: b.capitale,
          regImprese: b.regImprese,
          indirizzo: b.indirizzo,
          citta: b.citta,
          cap: b.cap,
          nazione: b.nazione,
          pec: b.pec,
          telefono: b.telefono,
          email: b.email,
          regimeFiscale: b.regimeFiscale,
        };

    const clientEmail = b.email ? b.email.trim().toLowerCase() : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : null);
    // Il cellulare non veniva scritto in colonna da nessuna delle due rotte: la scheda cliente
    // lo inviava, finiva solo dentro `referentiJson`, e `cliente.cellulare` restava NULL per
    // tutti. Conseguenza: il canale WhatsApp del portale risultava indisponibile con il motivo
    // «Nessun cellulare in anagrafica» anche per chi il numero ce l'aveva.
    // `telegram` NON diventa `telegramChatId`: quello del form è lo @username, la chat id la
    // produce il bot quando il cliente gli scrive.
    const clientCellulare = pulisciRecapito(b.cellulare) ?? pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp);
    const passwordHash = b.password ? hashPassword(b.password) : null;

    try {
      const cliente = await prisma.cliente.create({
        data: {
          tenantId,
          nome: b.nome,
          tipo: b.tipo,
          email: clientEmail,
          cellulare: clientCellulare,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : null,
          passwordHash,
          piva: b.piva || null,
          codiceFiscale: b.codiceFiscale || b.codFisc || null,
          giurisdizione: b.giurisdizione || null,
          sedeLegale: b.sedeLegale || b.sede || null,
          sdiCode: b.sdiCode || b.codiceSdi || 'SUBM70N',
          iban: b.iban || null,
          rischioAml: b.rischioAml || 'medio',
          ubo: b.ubo || null,
          fontePatrimonio: b.fontePatrimonio || null,
          dataKyc: b.dataKyc || null,
          referentiJson: referentiObj,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'CLIENTE_CREATO',
        entita: cliente.nome,
        dettagli: `Creata anagrafica cliente ERP ${cliente.nome} (P.IVA: ${cliente.piva || 'N/D'})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send({ ...referentiObj, ...cliente, hasPassword: Boolean(cliente.passwordHash) });
    } catch (err: any) {
      // Database non raggiungibile: si crea il cliente sulla porta applicativa, così il
      // resto del flusso (progetto → preventivo → esecuzione) resta percorribile.
      try {
        const cliente = await app.creaCliente({ nome: b.nome, tipo: b.tipo });
        return reply.code(201).send({ ...referentiObj, ...cliente });
      } catch {
        console.error('Errore creazione cliente DB:', err);
        return reply.code(500).send({ errore: err.message || 'Errore salvataggio cliente' });
      }
    }
  });

  server.put<{ Params: { id: string }; Body: Record<string, any> }>('/clienti/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const b = (req.body || {}) as Record<string, any>;

    const referentiObj = b.referentiJson !== undefined
      ? (typeof b.referentiJson === 'string' ? JSON.parse(b.referentiJson) : b.referentiJson)
      : {
          capitale: b.capitale,
          regImprese: b.regImprese,
          indirizzo: b.indirizzo,
          citta: b.citta,
          cap: b.cap,
          nazione: b.nazione,
          pec: b.pec,
          telefono: b.telefono,
          email: b.email,
          regimeFiscale: b.regimeFiscale,
        };

    const clientEmail = b.email !== undefined
      ? (b.email ? b.email.trim().toLowerCase() : null)
      : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : undefined);

    // Stesso ragionamento della creazione: il numero arriva in colonna, non solo nel JSON.
    // `undefined` quando la richiesta non parla di cellulare, così una modifica parziale non
    // cancella un numero già registrato.
    const clientCellulare = b.cellulare !== undefined
      ? pulisciRecapito(b.cellulare)
      : (pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp) ?? undefined);

    const passwordHash = b.password ? hashPassword(b.password) : undefined;

    try {
      const updated = await prisma.cliente.update({
        where: { id },
        data: {
          nome: b.nome !== undefined ? b.nome : undefined,
          tipo: b.tipo !== undefined ? b.tipo : undefined,
          email: clientEmail,
          cellulare: clientCellulare,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : undefined,
          passwordHash: passwordHash,
          piva: b.piva !== undefined ? b.piva : undefined,
          codiceFiscale: b.codiceFiscale !== undefined ? b.codiceFiscale : (b.codFisc !== undefined ? b.codFisc : undefined),
          giurisdizione: b.giurisdizione !== undefined ? b.giurisdizione : undefined,
          sedeLegale: b.sedeLegale !== undefined ? b.sedeLegale : (b.sede !== undefined ? b.sede : undefined),
          sdiCode: b.sdiCode !== undefined ? b.sdiCode : (b.codiceSdi !== undefined ? b.codiceSdi : undefined),
          iban: b.iban !== undefined ? b.iban : undefined,
          rischioAml: b.rischioAml !== undefined ? b.rischioAml : undefined,
          ubo: b.ubo !== undefined ? b.ubo : undefined,
          fontePatrimonio: b.fontePatrimonio !== undefined ? b.fontePatrimonio : undefined,
          dataKyc: b.dataKyc !== undefined ? b.dataKyc : undefined,
          referentiJson: referentiObj,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'CLIENTE_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornati dati legali/fiscali cliente ${updated.nome} (P.IVA: ${updated.piva})`,
        ipAddress: req.ip,
      });
      return reply.send({ ...referentiObj, ...updated, hasPassword: Boolean(updated.passwordHash) });
    } catch (err: any) {
      console.error('Errore aggiornamento cliente DB:', err);
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento cliente' });
    }
  });

  server.post<{ Params: { id: string } }>('/clienti/:id/reset-password', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;

    try {
      const cliente = await prisma.cliente.findUnique({ where: { id } });
      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      const nuovaPassword = generaPasswordTemporanea();
      const nuovoHash = hashPassword(nuovaPassword);

      await prisma.cliente.update({
        where: { id },
        data: {
          passwordHash: nuovoHash,
        },
      });

      const ref = cliente.referentiJson && typeof cliente.referentiJson === 'object' ? (cliente.referentiJson as any) : {};
      const destEmail = cliente.email || ref.email;

      let emailInviata = false;
      let erroreInvioEmail: string | undefined;
      if (destEmail) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          const customSmtp = tenant?.smtpHost && tenant?.smtpUser && tenant?.smtpPass ? {
            host: tenant.smtpHost,
            port: tenant.smtpPort || 465,
            secure: tenant.smtpSecure ?? true,
            user: tenant.smtpUser,
            pass: tenant.smtpPass,
            fromEmail: tenant.smtpFromEmail || tenant.smtpUser,
            fromName: tenant.smtpFromName || tenant.ragioneSociale || 'BluMan Advisory',
          } : undefined;
          const portalUrl = `${baseUrlApplicazione()}/portal`;
          const esitoCredenziali = await sendClientCredentialsEmail(destEmail, cliente.nome, nuovaPassword, portalUrl, customSmtp);
          emailInviata = esitoCredenziali.ok;
          erroreInvioEmail = esitoCredenziali.errore;
        } catch (err: any) {
          console.warn('Invio email credenziali fallito:', err);
          erroreInvioEmail = err?.message || 'errore inatteso durante l\'invio';
        }
      }

      await recordAudit({
        tenantId,
        azione: 'CLIENTE_PASSWORD_RIGENERATA',
        entita: cliente.nome,
        dettagli: `Rigenerata password di accesso per il cliente ${cliente.nome} (${destEmail || 'nessuna email'})`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        passwordChiaro: nuovaPassword,
        emailInviata,
        erroreInvioEmail,
        email: destEmail || '',
      });
    } catch (err: any) {
      console.error('Errore reset password cliente:', err);
      return reply.code(500).send({ errore: err.message || 'Errore generazione credenziali cliente' });
    }
  });

  server.delete<{ Params: { id: string } }>('/clienti/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      await prisma.cliente.delete({ where: { id } });
      return reply.send({ ok: true, id });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore eliminazione cliente' });
    }
  });

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
          errore: `Il modulo «${modulo.nome}» ha ${totaleOreConsuntivate} ore consuntivate e non può essere eliminato. Azzerare prima le ore o archiviare il modulo.`,
        });
      }

      await prisma.moduloProgetto.delete({ where: { id: moduloId } });

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

  server.get<{ Querystring: { progettoId?: string; microvoceProgettoId?: string } }>(
    '/documenti',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      const { progettoId, microvoceProgettoId } = req.query;
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
          },
          select: {
            id: true,
            tipo: true,
            fileUrl: true,
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
            return { ...d, fileUrl: rifirmaUrlUpload(d.fileUrl) as string, firmato: Boolean(firma) || d.tipo === 'firmato', firma };
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

      const documento = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId,
          tipo: tipo === 'firmato' ? 'firmato' : 'allegato',
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
   * PATCH /documenti/:id/stato — §WF-DOC
   * Permette all'operatore/advisor di pubblicare un documento al cliente o rimetterlo in bozza.
   */
  server.patch<{
    Params: { id: string };
    Body: { statoDoc: 'bozza' | 'pubblicato' | 'in_revisione' | 'firmato' };
  }>('/documenti/:id/stato', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { statoDoc } = req.body;

    if (!['bozza', 'pubblicato', 'in_revisione', 'firmato'].includes(statoDoc)) {
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
      const documento = await prisma.documento.findFirst({ where: { id, tenantId }, select: { id: true, fileUrl: true } });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      await prisma.documento.delete({ where: { id } });

      // Il file fisico resta in archivio: la riga è il riferimento legale, e lo storage può
      // essere condiviso con altri riferimenti (firme, versioni precedenti). La pulizia dei
      // file orfani è un lavoro di manutenzione separato.
      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_RIMOSSO',
        entita: id,
        dettagli: `Rimosso dal fascicolo il documento ${documento.fileUrl}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione documento' });
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
      const documenti = await prisma.documento.findMany({
        where: {
          tenantId,
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
          versione: true,
          createdAt: true,
          categoriaDoc: true,
          statoScansione: true,
          dataScadenzaDoc: true,
          statoDoc: true,
          pubblicatoAt: true,
          documentoPadreId: true,
          progettoId: true,
          progetto: { select: { nome: true } },
          microvoceProgetto: {
            select: {
              nome: true,
              moduloProgetto: { select: { nome: true, progettoId: true, progetto: { select: { nome: true } } } },
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
        },
        orderBy: { firmatoAt: 'desc' },
      });

      // Una firma per documento: la più recente. Le successive sono rifirme dello stesso atto e
      // non vanno mostrate come documenti distinti.
      const firmaPerDocumento = new Map<string, (typeof firme)[number]>();
      for (const f of firme) {
        if (f.riferimentoId && !firmaPerDocumento.has(f.riferimentoId)) firmaPerDocumento.set(f.riferimentoId, f);
      }

      const elenco = documenti.map((d) => {
        const firma = firmaPerDocumento.get(d.id) ?? null;
        // I documenti a livello progetto (§2.9) non hanno micro-voce: titolo, modulo e
        // progetto si ripiegano sul collegamento diretto al progetto.
        const nomeProgetto = d.microvoceProgetto?.moduloProgetto.progetto?.nome ?? d.progetto?.nome ?? null;
        const progettoId = d.microvoceProgetto?.moduloProgetto.progettoId ?? d.progettoId ?? null;
        const titoloVoce = d.microvoceProgetto?.nome ?? d.progetto?.nome ?? 'Documento';
        const isFirmato = Boolean(firma) || d.tipo === 'firmato' || d.statoDoc === 'firmato';
        return {
          id: d.id,
          nome: nomeFileDaUrl(d.fileUrl) ?? `${titoloVoce} (v${d.versione})`,
          titolo: titoloVoce,
          categoria: d.categoriaDoc || 'generico',
          modulo: d.microvoceProgetto?.moduloProgetto.nome ?? null,
          progetto: nomeProgetto,
          progettoId,
          // La firma HMAC degli URL /uploads/ scade dopo qualche giorno: si rinnova alla
          // lettura, altrimenti un documento in fascicolo da mesi non si aprirebbe più.
          fileUrl: rifirmaUrlUpload(d.fileUrl) as string,
          tipo: d.tipo,
          versione: d.versione,
          caricatoIl: d.createdAt,
          scadenza: d.dataScadenzaDoc,
          statoDoc: d.statoDoc,
          pubblicatoAt: d.pubblicatoAt,
          richiesteModifica: d.richiesteModifica,
          // §28: un file ancora in scansione o risultato infetto non si scarica e non si firma.
          statoScansione: d.statoScansione,
          scaricabile: d.statoScansione === 'pulito',
          firmato: isFirmato,
          richiedeFirma: !isFirmato && d.statoScansione === 'pulito' && d.statoDoc !== 'in_revisione',
          dataFirma: firma?.firmatoAt ?? null,
          tipoFirma: firma?.tipoFirma ?? null,
          signatureId: firma?.signatureId ?? null,
          canaleVerificato: firma?.canaleVerificato ?? null,
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
          progetto: { select: { id: true, nome: true } },
          microvoceProgetto: { select: { nome: true } },
          caricatoDaUser: { select: { email: true, nome: true } },
        },
      });

      if (!documento) {
        return reply.code(404).send({ errore: 'Documento non trovato o non associato al cliente.' });
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
        microvoceProgetto: { select: { nome: true } },
        progetto: { select: { nome: true } },
      },
    });

    if (!doc) return { errore: 'Documento non presente nel fascicolo di questo cliente.', codice: 404 };
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
    // `improntaDocumentoDelFascicolo`. Per la lettera d'incarico resta quella del browser,
    // perché il testo è ancora composto lì.
    const vault = ambito === 'documento_vault' && riferimentoId;
    if (!vault && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento mancante o non valida: la firma non può essere apposta.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento da firmare.' });
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
      await notificaStudio(tenantId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma apposta',
        corpo: `${firmatarioNome} (${cliente.nome}) ha firmato «${documentoTitolo}» con firma elettronica avanzata.`,
        link: null,
      }).catch(() => {});
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma registrata',
        corpo: `La tua firma su «${documentoTitolo}» è stata registrata correttamente.`,
        link: '/portal/documents',
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
    // calcola il server dal file in archivio, non il browser.
    const vault = ambito === 'documento_vault' && riferimentoId;
    if (!vault && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento originale mancante o non valida.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento a cui si riferisce la firma.' });
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
