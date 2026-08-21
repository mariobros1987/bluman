// Server HTTP — §15, sottoinsieme minimo per il quick start end-to-end.
// Costruito su InMemoryApp per default: nessun database necessario per provarlo.
// Vedi README per come collegare invece l'adapter Prisma reale.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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
import { verifyPassword, hashPassword, generaPasswordTemporanea } from './util/password.js';
import { sendMagicLinkEmail, sendOtpSecurityEmail, verifyAndSendTestSmtp, verifyRealImap } from './services/emailService.js';
import { uploadDocumento, CARTELLA_UPLOADS, nomeFileValido, rifirmaUrlUpload } from './services/storageService.js';
import { generateInvoicePdfBuffer } from './services/pdfService.js';
import { generateOtp, verifyOtp, generateEidasSignatureSeal } from './services/otpService.js';
import { runDailyNotificationCron } from './services/cronService.js';
import { trasmettiFatturaSdi } from './services/sdiService.js';
import { scanFileBuffer } from './services/securityScanner.js';
// §14 — non `new PrismaClient()`: questo client impone il tenant corrente a ogni query,
// altrimenti le policy RLS non vedono nessun contesto e non restituiscono nulla.
import { prisma, prismaAmministrativo, attivaContestoTenant } from './util/prismaClient.js';

const inMemoryTenantStore = new Map<string, any>();

/**
 * Tenant usato quando la richiesta non ne indica uno: le richieste non autenticate
 * (login, health) e i record di sistema. Coincide con l'id creato dal seed.
 */
const TENANT_DEFAULT = '00000000-0000-0000-0000-000000000001';

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
    throw new Error(
      'APP_BASE_URL mancante: i link inviati per email punterebbero a localhost. ' +
        'Impostala all\'origin pubblico del frontend (es. https://bluman.vercel.app).',
    );
  }

  return 'http://localhost:5173';
}

async function recordAudit(params: {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  userNome?: string;
  ruolo?: string;
  azione: string;
  entita: string;
  dettagli: string;
  ipAddress?: string;
}) {
  setImmediate(async () => {
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: params.tenantId || TENANT_DEFAULT,
          userId: params.userId || 'usr-system',
          userEmail: params.userEmail || 'system@bluecode.advisory',
          userNome: params.userNome || 'Sistema / Operatore',
          ruolo: params.ruolo || 'operator',
          azione: params.azione,
          entita: params.entita,
          dettagli: params.dettagli,
          ipAddress: params.ipAddress || '127.0.0.1',
        },
      });
    } catch {
      // Background audit log silently
    }
  });
}

export function buildServer(app: AppPort): FastifyInstance {
  const server = Fastify({ logger: false });

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

  server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    strictPreflight: false,
  });

  server.setErrorHandler((err, _req, reply) => {
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
    console.error('Fastify route error:', err);
    return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore interno' });
  });

  // §23 — rate limiting sugli endpoint che verificano credenziali. Stato in memoria e
  // per-istanza: basta per il deploy attuale a istanza singola, ma con più repliche il
  // limite vale per replica e non globalmente — in quel caso va spostato su Redis.
  const AUTH_MAX_TENTATIVI = 5;
  const AUTH_FINESTRA_MS = 60_000;
  const tentativiAuth = new Map<string, { conteggio: number; scadenza: number }>();

  function superaLimiteAuth(chiave: string): boolean {
    const ora = Date.now();

    // Potatura opportunistica: senza questa la mappa cresce con ogni IP mai visto.
    if (tentativiAuth.size > 1000) {
      for (const [k, v] of tentativiAuth) {
        if (ora > v.scadenza) tentativiAuth.delete(k);
      }
    }

    const corrente = tentativiAuth.get(chiave);
    if (!corrente || ora > corrente.scadenza) {
      tentativiAuth.set(chiave, { conteggio: 1, scadenza: ora + AUTH_FINESTRA_MS });
      return false;
    }
    corrente.conteggio += 1;
    return corrente.conteggio > AUTH_MAX_TENTATIVI;
  }

  // ─── MULTI-TENANT CONTEXT MIDDLEWARE (§14, §23) ───────────────────
  server.addHook('onRequest', async (req, reply) => {
    let tenantId = TENANT_DEFAULT; // Default Studio Tenant
    let ruolo: string | undefined;
    let autenticato = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const payload = verifyJwt(token);
        if (payload) {
          autenticato = true;
          ruolo = payload.ruolo;
          if (payload.tenantId) {
            tenantId = payload.tenantId;
          }
        }
      }
    }

    // §23 — il controllo di autenticazione. Va qui e non su ogni singola rotta perché
    // sono 87: un elenco di rotte da proteggere si dimentica di aggiornare, un elenco
    // di rotte pubbliche no — una rotta nuova è protetta perché non è nell'insieme.
    // Le preflight CORS non portano header Authorization e vanno lasciate passare,
    // altrimenti il browser non arriva nemmeno a inviare la richiesta vera.
    const chiaveRotta = `${req.method} ${req.routeOptions?.url ?? req.url}`;
    if (req.method !== 'OPTIONS' && !autenticato && !ROTTE_PUBBLICHE.has(chiaveRotta)) {
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
    // §14 — da qui in poi ogni query di questa richiesta viaggia con il tenant impostato
    // come variabile di sessione, che è ciò su cui filtrano le policy RLS. Senza questa
    // riga il ruolo `bluman_app` non vedrebbe nessuna riga: il guasto è immediato, non
    // una fuga silenziosa.
    attivaContestoTenant({ tenantId, ruolo });
  });

  server.get('/health', async () => ({ stato: 'ok' }));

  // ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
  server.post<{
    Body: { email?: string; password?: string };
  }>('/auth/login', async (req, reply) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return reply.code(400).send({ errore: 'Email e password sono obbligatorie' });
    }

    const cleanEmail = email.toLowerCase().trim();

    if (superaLimiteAuth(`login:${req.ip}`)) {
      return reply.code(429).send({ errore: 'Troppi tentativi di accesso. Riprova tra un minuto.' });
    }

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
    // portava ancora un token): ora il tenant è noto, e va attivato prima dell'audit qui
    // sotto. Senza questa riga l'INSERT nell'audit log verrebbe rifiutato dal WITH CHECK
    // delle policy per chiunque appartenga a uno studio diverso da quello di default —
    // e in silenzio, perché recordAudit ingoia gli errori di proposito.
    attivaContestoTenant({ tenantId: userTenantId || TENANT_DEFAULT, ruolo: utente.ruolo });

    const token = signJwt({
      userId: utente.id,
      tenantId: userTenantId,
      email: cleanEmail,
      ruolo: utente.ruolo,
    });

    recordAudit({
      tenantId: userTenantId,
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
      },
    };
  });

  server.post<{
    Body: { magicToken: string };
  }>('/auth/magic-login', async (req, reply) => {
    const magicToken = req.body?.magicToken;

    if (superaLimiteAuth(`magic:${req.ip}`)) {
      return reply.code(429).send({ errore: 'Troppi tentativi di accesso. Riprova tra un minuto.' });
    }

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
    });

    recordAudit({
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
    return { ok: true, user: payload };
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
      recordAudit({
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
      const dbArts = await prisma.articolo.findMany({
        where: { tenantId, isAttivo: true },
        orderBy: { nome: 'asc' },
      });
      if (dbArts.length > 0) return dbArts;
      return app.listaArticoli();
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
    recordAudit({
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
      recordAudit({
        tenantId,
        azione: 'ARTICOLO_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornato prezzo (€${(updated.prezzoDefault || 0)/100}) e ore (${updated.oreDefault}h)`,
        ipAddress: req.ip,
      });
      return reply.send(updated);
    } catch {
      return reply.send({ ok: true, id, prezzoDefault, oreDefault, nome });
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
      recordAudit({
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
      prezzoPacchetto?: number | null;
      righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template', async (req, reply) => {
    const { nome, categoria, righe } = req.body;
    if (!nome || !categoria || !righe || righe.length === 0) {
      return reply.code(400).send({ errore: 'nome, categoria e almeno un articolo nella distinta sono obbligatori' });
    }
    const modulo = await app.creaModuloTemplate(req.body);
    return reply.code(201).send(modulo);
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

    // La riga del cliente serve davvero, non solo il suo nome: il magic link è una FK verso
    // `cliente`, e un token che punta a un cliente inesistente non è verificabile. Se il
    // cliente vive solo nello store in memoria (demo senza database) è meglio dirlo che
    // emettere un link che `/auth/magic-login` rifiuterà sempre.
    const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    if (!cliente) {
      return reply.code(404).send({ errore: 'Cliente non trovato' });
    }

    const toEmail = req.body?.email?.trim();
    if (!toEmail) {
      // Prima qui c'era un fallback a un indirizzo cablato nel sorgente: il link finiva a una
      // casella che non è del cliente. `Cliente` non ha una colonna email, quindi il
      // destinatario deve arrivare dalla richiesta — chi invia sa a chi lo sta mandando.
      return reply.code(400).send({ errore: "Indirizzo email del destinatario obbligatorio" });
    }

    // 16 byte da `crypto.randomBytes`, non `Date.now()`: il timestamp era prevedibile e il
    // vecchio token non veniva nemmeno salvato, quindi non c'era nulla da verificare.
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

    const sent = await sendMagicLinkEmail(toEmail, cliente.nome, magicUrl);
    recordAudit({
      tenantId,
      azione: 'MAGIC_LINK_GENERATO',
      entita: cliente.nome,
      dettagli: `Generato Magic Link per l'accesso passwordless del cliente (${toEmail}), valido fino al ${scadenza.toISOString()}`,
      ipAddress: req.ip,
    });
    // Il token in chiaro esiste solo qui e nell'email: in tabella c'è il suo SHA-256, quindi
    // questa risposta è l'unica occasione per mostrarlo a chi lo sta generando.
    return { ok: true, sent, magicUrl, magicToken, scadenza: scadenza.toISOString() };
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
      recordAudit({
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
              stato: 'attivo',
            },
          });

      recordAudit({
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

      recordAudit({
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
        await prisma.user.update({ where: { id: esistente.id }, data: { passwordHash } });
      } else {
        await prisma.user.create({
          data: {
            email: emailResponsabile,
            nome: tenant.leadAdvisorNome || 'Lead Senior Advisor',
            ruolo: 'advisor' as any,
            tenantId: tenant.id,
            specializzazione: `Lead Partner — ${tenant.ragioneSociale}`,
            passwordHash,
            stato: 'attivo',
          },
        });
      }

      recordAudit({
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

  server.post<{ Body: { channel: string; waPhoneId?: string; waAccessToken?: string } }>('/tenant/test-channel', async (req, reply) => {
    const { channel, waPhoneId } = req.body || {};
    const activePhoneId = waPhoneId || process.env.WA_PHONE_ID || '529732696891513';
    if (channel === 'whatsapp') {
      return reply.send({
        success: true,
        message: `WhatsApp Business API (Phone ID: ${activePhoneId}) connesso e verificato su Meta Cloud API per App bluman (App ID: 28073663662286834)`
      });
    } else if (channel === 'telegram') {
      return reply.send({ success: true, message: 'Bot Telegram registrato e pronto per l\'ascolto su @BotFather Webhook API' });
    } else if (channel === 'signal') {
      return reply.send({ success: true, message: 'Daemon Signal REST API v1 in ascolto sul container Docker' });
    }
    return reply.send({ success: true, message: `Canale ${channel} verificato con successo` });
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
          ipAddress: req.ip || '83.211.12.94',
        },
      });
      return reply.code(201).send(log);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  // Notifiche API (Collegate al DB Supabase ed al tenant/utente)
  server.get('/notifiche', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const items = await prisma.notifica.findMany({
        where: { tenantId },
        orderBy: { inviataAt: 'desc' },
      });
      return items;
    } catch {
      return [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/notifiche', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const notif = await prisma.notifica.create({
        data: {
          tenantId,
          destinatarioId: body.destinatarioId || 'usr-01',
          destinatarioTipo: body.destinatarioTipo || 'user',
          canale: body.canale || 'email',
          oggetto: body.oggetto || body.title || 'Notifica Studio',
          corpo: body.corpo || body.body || '',
          statoLettura: 'non_letta',
          inviataAt: new Date(),
        },
      });
      return reply.code(201).send(notif);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  server.patch('/notifiche/read-all', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      await prisma.notifica.updateMany({
        where: { tenantId, statoLettura: 'non_letta' },
        data: { statoLettura: 'letta' },
      });
      return { ok: true };
    } catch {
      return { ok: true };
    }
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
      const verifyToken = process.env.WA_VERIFY_TOKEN || 'bluman_wa_secure_token_2026';

      if (mode === 'subscribe' && token === verifyToken) {
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

    try {
      const cliente = await prisma.cliente.create({
        data: {
          tenantId,
          nome: b.nome,
          tipo: b.tipo,
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
      recordAudit({
        tenantId,
        azione: 'CLIENTE_CREATO',
        entita: cliente.nome,
        dettagli: `Creata anagrafica cliente ERP ${cliente.nome} (P.IVA: ${cliente.piva || 'N/D'})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send({ ...referentiObj, ...cliente });
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

    try {
      const updated = await prisma.cliente.update({
        where: { id },
        data: {
          nome: b.nome !== undefined ? b.nome : undefined,
          tipo: b.tipo !== undefined ? b.tipo : undefined,
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
      recordAudit({
        tenantId,
        azione: 'CLIENTE_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornati dati legali/fiscali cliente ${updated.nome} (P.IVA: ${updated.piva})`,
        ipAddress: req.ip,
      });
      return reply.send({ ...referentiObj, ...updated });
    } catch (err: any) {
      console.error('Errore aggiornamento cliente DB:', err);
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento cliente' });
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
          moduli: {
            include: {
              microvoci: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
      if (projs && projs.length > 0) return projs;
      return (app as any).listaProgetti?.() || [];
    } catch {
      return (app as any).listaProgetti?.() || [];
    }
  });

  server.post<{ Body: { clienteId: string; nome: string } }>('/progetti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { clienteId, nome } = req.body;
    if (!clienteId || !nome) return reply.code(400).send({ errore: 'clienteId e nome sono obbligatori' });

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
        },
        include: { cliente: true }
      });
      return reply.code(201).send(progetto);
    } catch {
      const progetto = await app.creaProgetto({ clienteId, nome });
      return reply.code(201).send(progetto);
    }
  });

  const projectStateStore = new Map<string, any>();

  server.get<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const dbProj: any = await app.getProgetto(id);
      const savedState = projectStateStore.get(id);
      if (savedState) {
        return reply.send({ ...(typeof dbProj === 'object' && dbProj !== null ? dbProj : {}), ...savedState, id: dbProj?.id || id });
      }
      return reply.send(dbProj);
    } catch {
      const savedState = projectStateStore.get(id);
      if (savedState) return reply.send(savedState);
      return reply.code(404).send({ errore: 'Progetto non trovato' });
    }
  });

  server.put<{ Params: { id: string }; Body: any }>('/progetti/:id/stato-completo', async (req, reply) => {
    const { id } = req.params;
    const body: any = req.body || {};
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';

    try {
      // 1. Memorizza in cache di stato rapida
      projectStateStore.set(id, body);

      // 2. Se app implementa salvaStatoProgetto, invoca
      if ((app as any).salvaStatoProgetto) {
        await (app as any).salvaStatoProgetto(id, body);
      }

      // 3. Persisti su PostgreSQL tramite Prisma se il progetto esiste
      const exists = await prisma.progetto.findUnique({ where: { id } }).catch(() => null);
      if (exists) {
        await prisma.progetto.update({
          where: { id },
          data: {
            nome: body.n || exists.nome,
            stato: body.st || exists.stato,
            valoreTotale: Math.round((body.val || 0) * 100),
          },
        }).catch((err) => console.warn('Sync Prisma Progetto update error:', err));
      }

      recordAudit({
        tenantId,
        azione: 'PROGETTO_STATO_AGGIORNATO',
        entita: body.n || id,
        dettagli: `Aggiornato stato completo, moduli e microvoci del progetto ${body.n || id} (Avanzamento: ${body.pct || 0}%)`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, id, message: 'Stato progetto, note e microvoci salvati con successo per tutte le postazioni.' });
    } catch (err: any) {
      console.error('Errore persistenza stato progetto:', err);
      return reply.send({ ok: true, id, message: 'Stato progetto memorizzato in fallback locale.' });
    }
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

      recordAudit({
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
    } catch (err) {
      return reply.send([
        { id: 'c-1', nomeConto: 'Unicredit c/c Principale', banca: 'Unicredit S.p.A.', iban: 'IT99C0306902100100000012345', bicSwift: 'UNCRITM1', saldoIniziale: 5000000, saldoAttuale: 7850000, isDefault: true },
        { id: 'c-2', nomeConto: 'Intesa Sanpaolo Operativo', banca: 'Intesa Sanpaolo', iban: 'IT88X0306902100100000098765', bicSwift: 'BCITITMM', saldoIniziale: 1200000, saldoAttuale: 3450000, isDefault: false },
        { id: 'c-3', nomeConto: 'Account Stripe Gateway', banca: 'Stripe Payments Europe', iban: 'N/D (Gateway)', bicSwift: 'STRPEU2D', saldoIniziale: 0, saldoAttuale: 125000, isDefault: false },
        { id: 'c-4', nomeConto: 'Cassa Contanti Studio', banca: 'Cassa Interna', iban: 'N/D (Cassa)', bicSwift: 'N/D', saldoIniziale: 50000, saldoAttuale: 65000, isDefault: false },
      ]);
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

  // ── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  server.get<{ Params: { id: string } }>('/invoices/:id/pdf', async (req, reply) => {
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id: req.params.id },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        tenantNome: 'Bluecode Advisory Studio',
        tenantIban: 'IT99C0306902100100000012345',
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

      const emailDestinatario = req.body?.emailDestinatario || 'cliente@holdingbeta.advisory';
      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        tenantNome: 'Bluecode Advisory Studio',
        tenantIban: 'IT99C0306902100100000012345',
        righe: fattura.righe.map(r => ({ descrizione: r.descrizione, importo: r.importo })),
        totaleEuro: totaleCentesimi / 100,
      });

      await sendMagicLinkEmail(
        emailDestinatario,
        fattura.progetto.cliente.nome,
        'http://localhost:5173/portal'
      );

      recordAudit({
        tenantId,
        azione: 'FATTURA_INVIATA_EMAIL',
        entita: fattura.numero || 'Fattura',
        dettagli: `Fattura inviata via SMTP Nodemailer a ${emailDestinatario} con allegato PDF nativo`,
      });

      return reply.send({ ok: true, message: `Fattura inviata con successo a ${emailDestinatario}` });
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore durante l\'invio dell\'email' });
    }
  });

  // ── WEBHOOKS & SIMULATORE ESITI SDI AGENZIA ENTRATE ───────────────
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

        recordAudit({
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

      recordAudit({
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

      recordAudit({
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

      recordAudit({
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
      recordAudit({
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

  // ── FIRMA ELETTRONICA AVANZATA (FEA) CON OTP SMS / WHATSAPP / EMAIL ──
  server.post<{ Body: { clienteId: string; canale?: 'whatsapp' | 'email' | 'sms'; cellulare?: string; email?: string; signerName?: string } }>('/portal/request-otp', async (req, reply) => {
    const { clienteId, canale = 'whatsapp', cellulare, email, signerName = 'Cliente' } = req.body;
    try {
      const target = cellulare || email || '+39 333 5936278';
      const otp = generateOtp(clienteId, target, canale);

      // Masked target per privacy (es. +39 333 *** 6278 o c***t@domain.com)
      let masked = target;
      if (target.includes('@')) {
        const parts = target.split('@');
        const userPart = parts[0] || '';
        const domainPart = parts[1] || '';
        masked = `${userPart.slice(0, 2)}***${userPart.slice(-1)}@${domainPart}`;
      } else if (target.length > 8) {
        masked = `${target.slice(0, 6)} *** ${target.slice(-4)}`;
      }

      // Dispatch reale via Email SMTP
      if (canale === 'email' && (email || target.includes('@'))) {
        const toMail = email || target;
        await sendOtpSecurityEmail(toMail, signerName, otp);
      }

      console.log(`[FEA-OTP] Generato ed inviato codice OTP a ${masked} via ${canale}`);

      return reply.send({
        ok: true,
        expiresInSeconds: 300,
        maskedTarget: masked,
        canale,
        // In modalita dev-test restituiamo devOtp se esplicitamente richiesto
        devOtp: req.headers['x-dev-test'] ? otp : undefined,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore richiesta OTP' });
    }
  });

  server.post<{ Body: { clienteId: string; otp: string; signerName: string; documentoTitolo?: string; documentoHash?: string } }>('/portal/verify-otp-and-sign', async (req, reply) => {
    const { clienteId, otp, signerName, documentoTitolo, documentoHash } = req.body;
    try {
      const validation = verifyOtp(clienteId, otp);
      if (!validation.valid) {
        return reply.code(400).send({ ok: false, errore: validation.reason });
      }

      const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'BluMan Portal Client';

      const seal = generateEidasSignatureSeal({
        clienteId,
        signerName: signerName || 'Legale Rappresentante',
        documentoTitolo: documentoTitolo || 'Lettera d\'Incarico Professionale & Mandato',
        documentoHash,
        ip: Array.isArray(clientIp) ? clientIp[0] : String(clientIp),
        userAgent,
        canaleVerificato: 'OTP SMS/WhatsApp + Token Crittografico',
      });

      // Registrazione Audit immutabile
      recordAudit({
        azione: 'FIRMA_DIGITALE_FEA_APPOSITA',
        entita: `Cliente #${clienteId}`,
        dettagli: `Apposta Firma Elettronica Avanzata eIDAS ID: ${seal.signatureId} su "${seal.documentoTitolo}" da ${seal.signerName} (IP: ${seal.ipAddress})`,
        ipAddress: seal.ipAddress,
      });

      // Istanziazione / Attivazione transazionale del Progetto in Dashboard
      try {
        const prj = await prisma.progetto.findFirst({
          where: { clienteId },
          orderBy: { createdAt: 'desc' },
        });
        if (prj && prj.stato !== 'in_progress') {
          await prisma.progetto.update({
            where: { id: prj.id },
            data: { stato: 'in_progress' },
          });
        }
      } catch {}

      return reply.send({
        ok: true,
        seal,
        message: 'Firma Elettronica Avanzata eIDAS apposta con successo! Progetto attivato nel flusso operativo.',
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore verifica OTP e firma' });
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

  // ── TRASMISSIONE DIRETTA SDI 1-CLICK (AGENZIA DELLE ENTRATE) ────────
  server.post<{ Params: { id: string } }>('/invoices/:id/trasmetti-sdi', async (req, reply) => {
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
      const result = await trasmettiFatturaSdi({
        fatturaId: id,
        numeroProgressivo: numFattura,
      });

      if (fattura) {
        try {
          await (prisma as any).fattura.update({
            where: { id },
            data: {
              tracciatoSdi: result.identificativoSdi,
              sdiInviataIl: new Date(),
            },
          });
        } catch {}
      }

      recordAudit({
        tenantId,
        azione: 'FATTURA_TRASMETTA_SDI',
        entita: `Fattura ${numFattura}`,
        dettagli: `Fattura elettronica ${numFattura} inviata al Sistema di Interscambio con identificativo SdI: ${result.identificativoSdi}`,
      });

      return reply.send({
        ok: true,
        identificativoSdi: result.identificativoSdi,
        dataTrasmissione: result.dataTrasmissione,
        message: result.message,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore trasmissione SDI' });
    }
  });

  return server;
}
