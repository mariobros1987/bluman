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
import {
  prisma,
  prismaAmministrativo,
  attivaContestoTenant,
  conContestoInTransazione,
} from '../util/prismaClient.js';
import { clienteIdDalJwt } from '../util/authorization.js';
import { signJwt, verifyJwt, hashMagicToken } from '../util/jwt.js';
import {
  generaSegreto,
  verificaTotp,
  cifraSegretoTotp,
  decifraSegretoTotp,
  generaQrPayload,
  generaBackupCodes,
  hashBackupCode,
  verificaBackupCode,
} from '../util/totp.js';
import { verifyPassword, hashPassword } from '../util/password.js';
import {
  TENANT_DEFAULT,
  DURATA_SESSIONE_OPERATORE_MINUTI,
  DURATA_SESSIONE_CLIENTE_MINUTI,
  recordAudit,
  senzaHash,
} from '../util/serverHelpers.js';
import { LoginSchema, MagicLoginSchema, ChangePasswordSchema } from '../schemas/auth.schema.js';

// ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
export async function registraRotteAuth(server: FastifyInstance): Promise<void> {
  server.post<{
    Body: { email?: string; password?: string };
  }>('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const result = LoginSchema.safeParse(req.body || {});
    if (!result.success) {
      return reply.code(400).send({ ok: false, errore: result.error.issues.map(i => i.message).join('; ') });
    }
    const { email: cleanEmail, password } = result.data;

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
      req.log.error({ err: err instanceof Error ? err.message : err }, 'Login — database non raggiungibile');
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

    // §6.1 — 2FA TOTP: se il super_admin ha il TOTP abilitato, non rilasciamo ancora
    // il JWT definitivo. Emettiamo un preToken a vita breve (2 minuti) con il claim
    // `totpPending: true` e restituiamo { totpRequired: true, preToken }.
    // Il frontend mostra il campo per il codice e chiama POST /auth/totp/verifica.
    // Advisor, collaboratori e clienti non sono toccati da questo ramo.
    if (utente.ruolo === 'super_admin' && (utente as any).totpAbilitato === true) {
      const preToken = signJwt({
        userId: utente.id,
        tenantId: userTenantId,
        email: cleanEmail,
        ruolo: utente.ruolo,
        sessionVersion: utente.sessionVersion,
      }, 2); // 2 minuti — solo per la fase TOTP

      await recordAudit({
        tenantId: userTenantId || TENANT_DEFAULT,
        userId: utente.id,
        userEmail: cleanEmail,
        userNome: utente.nome,
        ruolo: utente.ruolo,
        azione: 'TOTP_RICHIESTO',
        entita: 'Sessione Studio',
        dettagli: 'Login password verificata, in attesa del codice TOTP per il super_admin',
        ipAddress: req.ip || '127.0.0.1',
      });

      return reply.send({ ok: true, totpRequired: true, preToken });
    }

    const token = signJwt({
      userId: utente.id,
      tenantId: userTenantId,
      email: cleanEmail,
      ruolo: utente.ruolo,
      sessionVersion: utente.sessionVersion,
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
    const mlResult = MagicLoginSchema.safeParse(req.body || {});
    if (!mlResult.success) {
      return reply.code(401).send(rifiuto);
    }
    const { magicToken } = mlResult.data;

    const db = prismaAmministrativo();
    const tokenHash = hashMagicToken(magicToken);
    const link = await db.magicLink.findUnique({
      where: { tokenHash },
      include: { cliente: true },
    });

    // Un unico messaggio per token inesistente, scaduto, già usato o cliente cancellato.
    if (!link || !link.cliente || link.usatoAt || link.scadenza.getTime() < Date.now()) {
      return reply.code(401).send(rifiuto);
    }

    // Consumo atomico: solo una richiesta concorrente può cambiare usatoAt da NULL.
    const consumato = await db.magicLink.updateMany({
      where: { id: link.id, usatoAt: null, scadenza: { gt: new Date() } },
      data: { usatoAt: new Date() },
    });
    if (consumato.count !== 1) return reply.code(401).send(rifiuto);

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
      sessionVersion: link.cliente.sessionVersion,
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
      req.log.warn({ err: err instanceof Error ? err.message : err }, 'Client login — errore ricerca DB');
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
      sessionVersion: cliente.sessionVersion,
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
    const authUser = req.user;
    if (!authUser) return reply.code(401).send({ errore: 'Non autenticato' });

    if (authUser.ruolo === 'cliente') {
      const clienteId = clienteIdDalJwt(authUser);
      if (!clienteId) return reply.code(401).send({ errore: 'Sessione cliente non valida' });
      try {
        const cliente = await prisma.cliente.findFirst({
          where: { id: clienteId, tenantId: req.tenantId },
          select: { id: true, sessionVersion: true },
        });
        if (!cliente || cliente.sessionVersion !== authUser.sessionVersion) {
          return reply.code(401).send({ errore: 'Sessione revocata' });
        }
        return reply.send({ ok: true, user: { ...authUser, clienteId, stato: 'attivo', mustChangePassword: false } });
      } catch {
        return reply.code(503).send({ errore: 'Servizio di autenticazione non disponibile. Riprova tra poco.' });
      }
    }

    try {
      const utente = await prisma.user.findFirst({
        where: { id: authUser.userId, ...(authUser.ruolo === 'super_admin' ? {} : { tenantId: req.tenantId }) },
        select: { stato: true, sessionVersion: true },
      });
      if (!utente || utente.stato === 'disattivato' || utente.sessionVersion !== authUser.sessionVersion) {
        return reply.code(401).send({ errore: 'Sessione revocata o utenza disattivata' });
      }
      return reply.send({
        ok: true,
        user: { ...authUser, stato: utente.stato, mustChangePassword: utente.stato === 'invitato' },
      });
    } catch {
      return reply.code(503).send({ errore: 'Servizio di autenticazione non disponibile. Riprova tra poco.' });
    }
  });

  server.post<{
    Body: { currentPassword?: string; newPassword?: string };
  }>('/auth/change-password', async (req, reply) => {
    const cpResult = ChangePasswordSchema.safeParse(req.body || {});
    if (!cpResult.success) {
      return reply.code(400).send({ ok: false, errore: cpResult.error.issues.map(i => i.message).join('; ') });
    }
    const { currentPassword, newPassword } = cpResult.data;
    const authUser = req.user;
    const userId = authUser?.userId;

    if (!authUser || authUser.ruolo === 'cliente' || !userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }

    try {
      const utente = await prisma.user.findFirst({
        where: {
          id: userId,
          ...(authUser.ruolo === 'super_admin' ? {} : { tenantId: req.tenantId }),
        },
      });
      if (!utente || utente.stato === 'disattivato') {
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
      const aggiornato = await prisma.user.update({
        where: { id: utente.id },
        data: {
          passwordHash: newHash,
          stato: 'attivo',
          sessionVersion: { increment: 1 },
        },
      });
      const token = signJwt({
        userId: aggiornato.id,
        tenantId: aggiornato.tenantId || '',
        email: aggiornato.email,
        ruolo: aggiornato.ruolo,
        sessionVersion: aggiornato.sessionVersion,
      }, DURATA_SESSIONE_OPERATORE_MINUTI);

      await recordAudit({
        tenantId: utente.tenantId || TENANT_DEFAULT,
        userId: utente.id,
        userEmail: utente.email,
        azione: 'PASSWORD_MODIFICATA',
        entita: utente.nome,
        dettagli: `Password aggiornata autonomamente dall'utente ${utente.email}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, token, messaggio: 'Password aggiornata con successo!' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento password' });
    }
  });

  server.get('/auth/profilo', async (req, reply) => {
    const authUser = req.user;
    const userId = authUser?.userId;
    if (!userId) return reply.code(401).send({ errore: 'Non autenticato' });

    try {
      const utente = await prisma.user.findFirst({
        where: {
          id: userId,
          ...(authUser.ruolo === 'super_admin' ? {} : { tenantId: req.tenantId }),
        },
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
      const updated = await prisma.user.update({
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
    Body: { currentPassword?: string; newPassword?: string };
  }>('/portal/change-password', async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const authUser = req.user;
    const targetClienteId = clienteIdDalJwt(authUser);

    if (!authUser || authUser.ruolo !== 'cliente' || !targetClienteId) {
      return reply.code(401).send({ errore: 'Sessione cliente non valida.' });
    }
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({ errore: 'La nuova password deve contenere almeno 8 caratteri.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: targetClienteId, tenantId: req.tenantId },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });

      if (cliente.passwordHash) {
        if (!currentPassword) {
          return reply.code(400).send({ errore: 'Inserisci la password attuale per confermare la modifica.' });
        }
        if (!verifyPassword(currentPassword, cliente.passwordHash)) {
          return reply.code(401).send({ errore: 'La password attuale inserita non è corretta.' });
        }
      }

      const newHash = hashPassword(newPassword);
      const aggiornato = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const clienteAggiornato = await tx.cliente.update({
            where: { id: cliente.id },
            data: {
              passwordHash: newHash,
              sessionVersion: { increment: 1 },
            },
          });
          await tx.magicLink.updateMany({
            where: { clienteId: cliente.id, usatoAt: null },
            data: { usatoAt: new Date() },
          });
          return clienteAggiornato;
        }),
      );
      const token = signJwt({
        userId: `client-${aggiornato.id}`,
        tenantId: aggiornato.tenantId,
        email: aggiornato.email || authUser.email,
        ruolo: 'cliente',
        sessionVersion: aggiornato.sessionVersion,
        sid: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
      }, DURATA_SESSIONE_CLIENTE_MINUTI);

      await recordAudit({
        tenantId: aggiornato.tenantId,
        azione: 'CLIENTE_PASSWORD_MODIFICATA',
        entita: aggiornato.nome,
        dettagli: `Password del portale cliente aggiornata con successo per ${aggiornato.nome}`,
        ipAddress: req.ip || '127.0.0.1',
      });

      return reply.send({
        ok: true,
        token,
        messaggio: 'Password del portale impostata con successo!',
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento password portale' });
    }
  });

  // ─── §6.1 TOTP — Endpoint 2FA per super_admin ────────────────────────────────

  /**
   * POST /auth/totp/attiva
   * Riservato al super_admin autenticato. Genera il segreto TOTP, lo cifra e lo
   * salva nel DB con totpAbilitato=false (non ancora confermato dall'app authenticator).
   * Restituisce il QR URI e i backup codes — UNA SOLA VOLTA.
   */
  server.post('/auth/totp/attiva', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Solo il super_admin può attivare il 2FA TOTP.' });
    }

    const db = prismaAmministrativo();
    const utente = await db.user.findUnique({ where: { id: req.userId } });
    if (!utente) return reply.code(404).send({ errore: 'Utente non trovato.' });

    if ((utente as any).totpAbilitato === true) {
      return reply.code(409).send({ errore: 'Il 2FA TOTP è già attivo. Disattivalo prima di rigenerarlo.' });
    }

    const segretoBase32 = generaSegreto();
    const secretoCifrato = cifraSegretoTotp(segretoBase32);
    const backupCodes = generaBackupCodes();
    const backupHashes = backupCodes.map(hashBackupCode);

    await db.user.update({
      where: { id: req.userId },
      data: ({
        totpSecret: secretoCifrato,
        totpAbilitato: false,
        totpBackupCodes: backupHashes,
      }) as any,
    });

    const qr = generaQrPayload(segretoBase32, utente.email, 'BluMan');

    await recordAudit({
      tenantId: req.tenantId || TENANT_DEFAULT,
      userId: req.userId,
      userEmail: utente.email,
      userNome: utente.nome,
      ruolo: 'super_admin',
      azione: 'TOTP_ATTIVAZIONE_INIZIATA',
      entita: 'Sicurezza Account',
      dettagli: 'Generazione segreto TOTP — in attesa della conferma con il primo codice.',
      ipAddress: req.ip,
    });

    return reply.send({
      ok: true,
      qrUri: qr.uri,
      qrUrl: qr.qrUrl,
      segreto: segretoBase32, // Solo per inserimento manuale nell'app authenticator
      backupCodes,            // Mostrare UNA SOLA VOLTA, poi l'utente deve salvarli
      hint: qr.svgHint,
    });
  });

  /**
   * POST /auth/totp/conferma
   * Verifica il primo codice a 6 cifre dall'app authenticator.
   * Se corretto imposta totpAbilitato=true.
   */
  server.post<{ Body: { codiceTotp?: string } }>('/auth/totp/conferma', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Solo il super_admin può confermare il 2FA TOTP.' });
    }

    const { codiceTotp } = req.body ?? {};
    if (!codiceTotp) return reply.code(400).send({ errore: 'Il campo codiceTotp è obbligatorio.' });

    const db = prismaAmministrativo();
    const utente = await db.user.findUnique({ where: { id: req.userId } });
    if (!utente || !utente.totpSecret) {
      return reply.code(400).send({ errore: 'Nessun segreto TOTP in sospeso. Prima chiama POST /auth/totp/attiva.' });
    }
    if ((utente as any).totpAbilitato === true) {
      return reply.code(409).send({ errore: 'Il 2FA è già confermato e attivo.' });
    }

    let segretoBase32: string;
    try {
      segretoBase32 = decifraSegretoTotp(utente.totpSecret);
    } catch {
      return reply.code(500).send({ errore: 'Errore interno nella lettura del segreto TOTP.' });
    }

    if (!verificaTotp(segretoBase32, codiceTotp)) {
      return reply.code(400).send({ errore: 'Codice TOTP non valido. Riprova o rigenera il segreto.' });
    }

    await db.user.update({
      where: { id: req.userId },
      data: ({ totpAbilitato: true }) as any,
    });

    await recordAudit({
      tenantId: req.tenantId || TENANT_DEFAULT,
      userId: req.userId,
      userEmail: utente.email,
      userNome: utente.nome,
      ruolo: 'super_admin',
      azione: 'TOTP_ATTIVATO',
      entita: 'Sicurezza Account',
      dettagli: 'Autenticazione a due fattori TOTP attivata con successo.',
      ipAddress: req.ip,
    });

    return reply.send({ ok: true, messaggio: 'Autenticazione a due fattori attivata con successo.' });
  });

  /**
   * POST /auth/totp/disabilita
   * Riservato al super_admin autenticato. Richiede la password corrente come
   * secondo fattore di sicurezza. Rimuove totpSecret, totpAbilitato e i backup codes.
   */
  server.post<{ Body: { password?: string } }>('/auth/totp/disabilita', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Solo il super_admin può disabilitare il 2FA TOTP.' });
    }

    const { password } = req.body ?? {};
    if (!password) return reply.code(400).send({ errore: 'La password corrente è obbligatoria per disabilitare il 2FA.' });

    const db = prismaAmministrativo();
    const utente = await db.user.findUnique({ where: { id: req.userId } });
    if (!utente) return reply.code(404).send({ errore: 'Utente non trovato.' });

    if (!(utente as any).totpAbilitato) {
      return reply.code(409).send({ errore: 'Il 2FA TOTP non è attualmente abilitato.' });
    }

    if (!verifyPassword(password, utente.passwordHash)) {
      return reply.code(401).send({ errore: 'Password corrente non corretta.' });
    }

    await db.user.update({
      where: { id: req.userId },
      data: ({
        totpSecret: null,
        totpAbilitato: false,
        totpBackupCodes: [],
      }) as any,
    });

    await recordAudit({
      tenantId: req.tenantId || TENANT_DEFAULT,
      userId: req.userId,
      userEmail: utente.email,
      userNome: utente.nome,
      ruolo: 'super_admin',
      azione: 'TOTP_DISABILITATO',
      entita: 'Sicurezza Account',
      dettagli: 'Autenticazione a due fattori TOTP disabilitata. Segreto e codici di backup eliminati.',
      ipAddress: req.ip || '127.0.0.1',
    });

    return reply.send({ ok: true, messaggio: 'Autenticazione a due fattori disabilitata con successo.' });
  });

  /**
   * GET /auth/totp/stato
   * Restituisce se il 2FA TOTP è attivo sull'account del super_admin corrente.
   * Usato dal frontend per mostrare lo stato nel pannello sicurezza.
   */
  server.get('/auth/totp/stato', async (req, reply) => {
    if (req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Riservato al super_admin.' });
    }
    const db = prismaAmministrativo();
    const utente = await db.user.findUnique({
      where: { id: req.userId },
      select: { id: true } as any,
    });
    if (!utente) return reply.code(404).send({ errore: 'Utente non trovato.' });

    const totpAbilitato = Boolean((utente as any).totpAbilitato);
    return reply.send({ ok: true, totpAbilitato });
  });

  /**
   * POST /auth/totp/verifica
   * Endpoint pubblico (rate-limit aggressivo). Riceve preToken (2min) + codiceTotp.
   * Se il codice è valido (TOTP o backup code), emette il JWT definitivo.
   */
  server.post<{ Body: { preToken?: string; codiceTotp?: string } }>('/auth/totp/verifica', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { preToken, codiceTotp } = req.body ?? {};
    const erroreGenerico = { errore: 'Codice non valido o sessione scaduta.' };

    if (!preToken || !codiceTotp) return reply.code(400).send(erroreGenerico);

    // Verifica il preToken (2 min, stesso meccanismo del JWT normale)
    const payload = verifyJwt(preToken);
    if (!payload || payload.ruolo !== 'super_admin') {
      return reply.code(401).send(erroreGenerico);
    }

    const db = prismaAmministrativo();
    const utente = await db.user.findUnique({ where: { id: payload.userId } });
    if (!utente || !utente.totpSecret || !(utente as any).totpAbilitato) {
      return reply.code(401).send(erroreGenerico);
    }
    if (utente.sessionVersion !== payload.sessionVersion) {
      return reply.code(401).send(erroreGenerico);
    }

    let segretoBase32: string;
    try {
      segretoBase32 = decifraSegretoTotp(utente.totpSecret);
    } catch {
      return reply.code(500).send({ errore: 'Errore interno nella lettura del segreto TOTP.' });
    }

    let autenticatoConBackup = false;

    if (verificaTotp(segretoBase32, codiceTotp)) {
      // Codice TOTP corrente — OK
    } else {
      // Tenta come backup code
      const backupHashes: string[] = (utente as any).totpBackupCodes ?? [];
      const indice = verificaBackupCode(codiceTotp, backupHashes);
      if (indice === -1) {
        return reply.code(401).send(erroreGenerico);
      }
      // Invalida il backup code usato (rimuove dall'array)
      const nuoviHashes = backupHashes.filter((_, i) => i !== indice);
      await db.user.update({
        where: { id: utente.id },
        data: ({ totpBackupCodes: nuoviHashes }) as any,
      });
      autenticatoConBackup = true;
    }

    const userTenantId = utente.tenantId || '';
    const token = signJwt({
      userId: utente.id,
      tenantId: userTenantId,
      email: utente.email,
      ruolo: utente.ruolo,
      sessionVersion: utente.sessionVersion,
    }, DURATA_SESSIONE_OPERATORE_MINUTI);

    await recordAudit({
      tenantId: userTenantId || TENANT_DEFAULT,
      userId: utente.id,
      userEmail: utente.email,
      userNome: utente.nome,
      ruolo: 'super_admin',
      azione: 'AUTENTICAZIONE_LOGIN',
      entita: 'Sessione Studio',
      dettagli: autenticatoConBackup
        ? 'Login 2FA completato con codice di recupero monouso.'
        : 'Login 2FA completato con codice TOTP.',
      ipAddress: req.ip || '127.0.0.1',
    });

    return reply.send({
      ok: true,
      token,
      user: {
        id: utente.id,
        nome: utente.nome,
        email: utente.email,
        ruolo: utente.ruolo,
        tenantId: userTenantId,
        stato: utente.stato,
        mustChangePassword: utente.stato === 'invitato',
      },
    });
  });
}
