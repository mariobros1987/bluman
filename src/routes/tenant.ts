// Rotte tenant e admin: impostazioni studio, gestione team, super admin — §2bis.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. `registraRotteTenant` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import { prisma, prismaAmministrativo } from '../util/prismaClient.js';
import { generaPasswordTemporanea, hashPassword } from '../util/password.js';
import { rifirmaUrlUpload } from '../services/storageService.js';
import { verifyAndSendTestSmtp, verifyRealImap, createTransporter } from '../services/emailService.js';
import { credenzialiCanali } from '../services/otpDispatch.js';
import { inMemoryTenantStore, recordAudit, senzaHash } from '../util/serverHelpers.js';

// ─── TENANT, TEAM & ADMIN (§2bis: impostazioni studio, team, super admin) ──
export async function registraRotteTenant(server: FastifyInstance): Promise<void> {
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
}
