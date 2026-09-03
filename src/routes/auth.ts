// Rotte di autenticazione e gestione password — §2bis, §23.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. `registraRotteAuth` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit dedicato dei login
// e l'hook auth onRequest continuano ad applicarsi esattamente come prima
// (stesso contesto di incapsulamento, nessuna nuova barriera).

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma, prismaAmministrativo, attivaContestoTenant } from '../util/prismaClient.js';
import { signJwt, verifyJwt, hashMagicToken } from '../util/jwt.js';
import { verifyPassword, hashPassword } from '../util/password.js';
import {
  TENANT_DEFAULT,
  DURATA_SESSIONE_OPERATORE_MINUTI,
  DURATA_SESSIONE_CLIENTE_MINUTI,
  recordAudit,
  senzaHash,
} from '../util/serverHelpers.js';

// ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
export async function registraRotteAuth(server: FastifyInstance): Promise<void> {
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
    // Fase 3 FEA (misura 3) — certificato di sessione. Ogni login del cliente genera un
    // session id univoco e registra il momento dell'accesso (`iat`): entrambi finiscono
    // nel digest del sigillo FEA, a dimostrare che firma e login appartengono alla
    // stessa sessione verificata. Il login operatore non li porta.
    const token = signJwt({
      userId: identitaPortale,
      tenantId: link.cliente.tenantId,
      email: emailCliente,
      ruolo: 'cliente',
      sid: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
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
    // Fase 3 FEA (misura 3) — sid/iat come nel magic-login: stesso certificato di sessione.
    const token = signJwt({
      userId: identitaPortale,
      tenantId: cliente.tenantId,
      email: emailCliente,
      ruolo: 'cliente',
      sid: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
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
    const authUser = req.user;
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
    const authUser = req.user;
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
    const authUser = req.user;
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
    const authUser = req.user;

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
}
