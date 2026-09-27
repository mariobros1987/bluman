// Rotte tenant e admin: impostazioni studio, gestione team, super admin — §2bis.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. `registraRotteTenant` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { RuoloUtente } from '@prisma/client';
import { prisma, prismaAmministrativo, contestoTenant } from '../util/prismaClient.js';
import { generaPasswordTemporanea, hashPassword } from '../util/password.js';
import { rifirmaUrlUpload } from '../services/storageService.js';
import { provaPostaInUscita, provaPostaInArrivo, sendInvitoCollaboratoreEmail } from '../services/emailService.js';
import { credenzialiCanali } from '../services/otpDispatch.js';
import { numeroSignal, statoSignal } from '../services/signalService.js';
import { usernameBotTelegram } from '../services/telegramService.js';
import { inMemoryTenantStore, recordAudit, senzaHash, TENANT_DEFAULT } from '../util/serverHelpers.js';
import { moduloConcessoAlTenant } from '../util/moduliTenant.js';
import { eliminaTenantCompleto } from '../services/eliminazioneTenant.js';
import { urlWebhookWhatsapp } from '../util/urlPubblica.js';
import { campoOrdinamento, creaMetaPaginazione, leggiPaginazione } from '../util/paginazione.js';
import {
  validaCartellaImap,
  validaEmail,
  validaHost,
  validaPorta,
  validaServername,
  vietaControlli,
} from '../util/networkPolicy.js';

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
    const record = tenant as Record<string, unknown>;
    const logoUrl = record.logoUrl;
    if (typeof logoUrl !== 'string') return tenant;
    return { ...record, logoUrl: rifirmaUrlUpload(logoUrl) } as T;
  }

  /**
   * Le credenziali dello studio che il browser non deve ricevere.
   *
   * `GET /tenant/info` restituiva la riga Tenant intera, quindi la password SMTP, la password
   * IMAP, l'access token di Meta e il token del bot Telegram arrivavano in chiaro nella
   * risposta — e `SettingsPage` li salvava in `localStorage`. Chiunque potesse leggere quella
   * risposta o quello spazio di archiviazione (un'estensione del browser, un computer condiviso,
   * un XSS) poteva spedire come lo studio (regola 6).
   */
  const CHIAVI_SEGRETE = ['smtpPass', 'imapPass', 'waAccessToken', 'waVerifyToken', 'waAppSecret', 'tgBotToken', 'signalToken'] as const;

  /**
   * Sostituisce i segreti con la stringa vuota e aggiunge `<chiave>Impostata: boolean`.
   *
   * Il flag serve all'interfaccia: senza di esso il campo password vuoto sarebbe
   * indistinguibile da «nessuna password salvata», e l'operatore la reinserirebbe ogni volta
   * temendo di averla perduta.
   */
  function senzaSegreti<T>(tenant: T): T {
    if (!tenant || typeof tenant !== 'object') return tenant;
    const copia: Record<string, unknown> = { ...(tenant as Record<string, unknown>) };
    for (const chiave of CHIAVI_SEGRETE) {
      if (chiave in copia) {
        copia[`${chiave}Impostata`] = Boolean(copia[chiave]);
        copia[chiave] = '';
      }
    }
    return copia as T;
  }

  /**
   * Quello che esce verso il browser: logo rifirmato, credenziali mascherate e la Callback URL
   * di WhatsApp **calcolata**, non memorizzata.
   *
   * La Callback URL non è un dato dello studio ma una conseguenza del suo slug e dell'indirizzo
   * di questo backend: derivarla qui significa che non può divergere. Se fosse un campo salvato,
   * uno studio che cambia slug continuerebbe a leggere nell'interfaccia l'indirizzo vecchio e lo
   * incollerebbe in Meta, dove risponderebbe 404 — un guasto silenzioso che si scopre solo
   * quando un cliente scrive e nessuno riceve (regola 7).
   */
  function tenantPubblico<T>(tenant: T): T {
    const pulito = senzaSegreti(conFirmaLogo(tenant)) as Record<string, unknown>;
    if (pulito && typeof pulito === 'object') {
      pulito.waCallbackUrl = urlWebhookWhatsapp(pulito.waWebhookSlug);
    }
    return pulito as T;
  }

  /**
   * Un discriminante nuovo per il path di callback: 32 caratteri da 16 byte casuali.
   *
   * `randomBytes` e non `Math.random()`: questo valore è l'unica cosa che separa l'endpoint di
   * uno studio da quello di un altro, e chi lo indovinasse potrebbe far passare un proprio
   * payload come se fosse di quello studio. La collisione è impossibile in pratica (2^128), ma
   * l'indice unico sul database è comunque l'arbitro: se scattasse, si rigenera invece di
   * scrivere due studi sullo stesso path.
   */
  function generaSlugWhatsapp(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Se la metà **in ingresso** del canale WhatsApp è configurata, e cosa manca quando non lo è.
   *
   * Non si prova con una chiamata: Meta non offre un endpoint che dica «il tuo webhook è
   * registrato e risponde». Si legge la configurazione dello studio, che è ciò da cui dipende
   * l'ingresso, e si nominano i pezzi mancanti — un «ingresso non configurato» senza motivo
   * costringerebbe l'operatore a indovinare quale dei tre campi manca.
   *
   * Il **Phone Number ID** non è fra i campi che bloccano l'ingresso, e infatti non finisce in
   * `mancanti`. Ma è la condizione da cui `webhooks.ts` fa dipendere la guardia sul numero: se è
   * vuoto, il controllo non scatta e l'ingresso accetta i messaggi di **qualunque** numero
   * dell'app, registrandoli su questo studio. Perciò va detto sempre — che ci sia o che manchi —
   * perché è la differenza fra un ingresso che sa di chi è il messaggio e uno che non lo sa.
   */
  async function statoIngressoWhatsapp(tenantId: string): Promise<string> {
    let t: {
      waAppId?: string | null;
      waAppSecret?: string | null;
      waVerifyToken?: string | null;
      waWebhookSlug?: string | null;
      waPhoneId?: string | null;
    } | null = null;
    try {
      t = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { waAppId: true, waAppSecret: true, waVerifyToken: true, waWebhookSlug: true, waPhoneId: true },
      });
    } catch {
      t = null;
    }

    const mancanti: string[] = [];
    if (!t?.waAppSecret) mancanti.push('App Secret');
    if (!t?.waVerifyToken) mancanti.push('Verify Token');
    if (!t?.waWebhookSlug) mancanti.push('Callback URL');
    if (mancanti.length) return `non configurato — mancano ${mancanti.join(', ')}`;

    // L'App ID non serve a nessuna chiamata: è il riferimento con cui l'operatore ritrova la sua
    // app nella dashboard Meta. Mancante non blocca l'ingresso, quindi si segnala e basta.
    const note: string[] = [];
    if (!t?.waAppId) note.push('App ID non indicato: serve solo per la guida Meta');
    note.push(
      t?.waPhoneId
        ? `ingresso limitato al Phone Number ID ${t.waPhoneId}`
        : "Phone Number ID assente: la guardia sul numero è spenta, l'ingresso accetta i messaggi di qualunque numero dell'app",
    );

    return `configurato (${note.join('; ')})`;
  }

  server.get('/tenant/info', async (req) => {
    const tenantId = req.tenantId;
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
      return tenantPubblico(tenant);
    } catch {
      if (!inMemoryTenantStore.has(tenantId)) {
        inMemoryTenantStore.set(tenantId, {
          id: tenantId,
          ragioneSociale: defaultName,
          piano: 'enterprise',
          stato: 'attivo',
        });
      }
      return tenantPubblico(inMemoryTenantStore.get(tenantId));
    }
  });

  // ── Attivazione moduli per-studio (solo KYC per ora) ──────────────────────────────────
  // Livello studio: l'admin (advisor/super_admin) accende/spegne i moduli CONCESSI dalla piattaforma.
  const chiaviModulo = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  server.get('/tenant/moduli', async (req) => {
    const t = await prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { moduliConcessi: true, moduliDisattivati: true } }).catch(() => null);
    const concessi = chiaviModulo(t?.moduliConcessi);
    const disattivati = chiaviModulo(t?.moduliDisattivati);
    return { concessi, disattivati, attivi: concessi.filter((k) => !disattivati.includes(k)) };
  });

  server.patch<{ Body: { chiave?: string; attivo?: boolean } }>('/tenant/moduli', async (req, reply) => {
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'L’attivazione dei moduli è riservata al responsabile dello studio.' });
    }
    const { chiave, attivo } = req.body || {};
    if (chiave !== 'kyc') return reply.code(400).send({ errore: 'Modulo non riconosciuto.' });
    const t = await prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { moduliConcessi: true, moduliDisattivati: true } });
    if (!moduloConcessoAlTenant(t?.moduliConcessi, chiave)) {
      return reply.code(403).send({ errore: 'Questo modulo non è incluso nel piano dello studio: contatta l’amministratore della piattaforma.' });
    }
    const disattivati = new Set(chiaviModulo(t?.moduliDisattivati));
    if (attivo) disattivati.delete(chiave); else disattivati.add(chiave);
    const updated = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { moduliDisattivati: [...disattivati] },
      select: { moduliConcessi: true, moduliDisattivati: true },
    });
    await recordAudit({
      tenantId: req.tenantId, userId: req.userId, ruolo: req.ruolo,
      azione: attivo ? 'MODULO_ATTIVATO' : 'MODULO_DISATTIVATO', entita: `Modulo ${chiave}`,
      dettagli: `${chiave} → ${attivo ? 'attivo' : 'disattivato'}`, ipAddress: req.ip,
    });
    const concessi = chiaviModulo(updated.moduliConcessi);
    const dis = chiaviModulo(updated.moduliDisattivati);
    return reply.send({ ok: true, concessi, disattivati: dis, attivi: concessi.filter((k) => !dis.includes(k)) });
  });

  function soloGestoriCanali(req: any, reply: any): boolean {
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      reply.code(403).send({ errore: 'Configurazione e prove dei canali riservate al responsabile dello studio o al super admin.' });
      return false;
    }
    return true;
  }

  /**
   * Forma dell'indirizzo del demone Signal, controllata al salvataggio.
   *
   * Non è `validaUrlServizio` e non la sostituisce: quella risolve il nome, rifiuta gli indirizzi
   * privati ed è asincrona, e viene applicata quando si contatta davvero il demone
   * (`signalService.prepara()`). Qui si rifiuta solo ciò che è evidentemente sbagliato — schema
   * assente, credenziali dentro l'URL, parametri o frammenti — perché l'operatore lo sappia
   * mentre scrive, invece di scoprirlo dal primo invio fallito.
   */
  function formaIndirizzoDemone(valore: unknown): string {
    const grezzo = vietaControlli(valore, 'signalEndpoint', 2048).trim();
    let url: URL;
    try {
      url = new URL(grezzo);
    } catch {
      throw new Error('signalEndpoint non valido: serve un indirizzo completo, per esempio https://signal.studio.it.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('signalEndpoint non valido: sono ammessi solo indirizzi http o https.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('signalEndpoint non valido: niente credenziali, parametri o frammenti nell\'indirizzo (il token ha un campo suo).');
    }
    // La barra finale è superflua: `signalService` compone i percorsi da sé.
    return grezzo.replace(/\/+$/, '');
  }

  // `waWebhookSlug` non è qui di proposito: non si scrive dal browser. Lo genera il server
  // (bootstrap dello studio, o rotazione esplicita via `POST /tenant/whatsapp-slug`), perché è
  // il discriminante che separa i webhook di uno studio da quelli di un altro: lasciarlo
  // digitare significherebbe ammettere «scegli il path di un altro studio».
  const CHIAVI_CANALI = new Set([
    'waPhoneId', 'waAccessToken', 'waVerifyToken', 'waAppId', 'waAppSecret',
    'waOtpTemplate', 'waOtpTemplateLang', 'tgBotToken', 'tgBotUsername',
    'smtpHost', 'smtpServername', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass',
    'smtpFromEmail', 'smtpFromName', 'smtpReplyTo', 'smtpBcc',
    'imapHost', 'imapServername', 'imapPort', 'imapSecure', 'imapUser', 'imapPass',
    'imapFolder', 'imapPollInterval', 'imapProtocol', 'emailSignatureHtml',
    // Signal è per studio come gli altri: il demone `signal-cli-rest-api` con il numero
    // registrato sopra è infrastruttura dello studio, non della piattaforma.
    'signalEndpoint', 'signalToken', 'signalNumber',
    // `emailInboundParseUrl` è sparito: puntava a `api/webhooks/inbound-email`, una rotta che in
    // questo progetto non esiste, e nessuna riga di codice l'ha mai letta. Un campo che si salva
    // e non fa niente è peggio di un campo assente — l'operatore crede di aver configurato
    // qualcosa (regola 7).
  ]);

  server.patch<{ Body: Record<string, any> }>('/tenant/info', async (req, reply) => {
    const tenantId = req.tenantId;
    // Le impostazioni dello studio (IBAN, dati fiscali, credenziali canali, stato, logo, standby
    // moduli) sono riservate all'amministratore dello studio. Senza questa guardia un qualunque
    // collaboratore poteva cambiare l'IBAN (frode incassi), i dati fiscali o sospendere lo studio
    // (DoS). I controlli specifici più sotto (canali, moduli) restano come difesa in profondità.
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Le impostazioni dello studio sono riservate al responsabile (advisor/super_admin).' });
    }
    const rawBody = (req.body || {}) as Record<string, any>;
    if (Object.keys(rawBody).some(key => CHIAVI_CANALI.has(key)) && !soloGestoriCanali(req, reply)) return reply;

    // Lo standby dei moduli lo decide l'admin dello studio (advisor/super_admin), come i canali.
    if (rawBody.moduliDisattivati !== undefined && req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Lo standby dei moduli è riservato al responsabile dello studio.' });
    }

    // `logoUrl` finisce in un `<img src>` generato lato server: un valore che non punta
    // a niente svuota la fascia dell'intestazione invece di lasciar vedere il marchio.
    // Le uniche forme ammesse sono quelle che l'app produce davvero: percorso relativo
    // (`/logo.png` del seed, `/uploads/…?firma=…` del ripiego locale di uploadDocumento),
    // `data:image…` (SettingsPage quando l'upload restituisce solo il base64) e https
    // sull'host del project Supabase — l'host di `SUPABASE_URL`, letto qui dentro e non
    // a livello di modulo. Tutto il resto, incluso `https://supabase.co/…` senza il
    // sottodominio del project (il valore con cui la suite di test, girata senza
    // isolamento, ha sovrascritto il logo in produzione), è respinto prima di toccare
    // il database. `null` e stringa vuota restano ammessi: sono il reset del logo.
    const logoUrlBody = rawBody.logoUrl;
    if (logoUrlBody !== undefined && logoUrlBody !== null && logoUrlBody !== '') {
      let logoValido = false;
      if (typeof logoUrlBody === 'string') {
        // Metacaratteri HTML, sulla stringa grezza e prima di ogni altro controllo: il
        // valore finisce non escapato in `<img src="${dati.logo}">` (intestazioneStudio.ts),
        // quindi una virgoletta chiuderebbe l'attributo e inietterebbe markup nella fascia
        // di ogni documento — pure partendo da un percorso relativo o da un URL https
        // legittimo, perché `new URL` percent-encoda virgolette e spazi nel path senza
        // lanciare e il controllo sull'host qui sotto non se ne accorgerebbe. Nessun
        // valore legittimo contiene questi caratteri: né il base64 dei data: URL, né i
        // safeFilename dei percorsi /uploads/, né i percorsi relativi.
        const conMetacaratteri = /["'<>\s]/.test(logoUrlBody);
        if (!conMetacaratteri) {
          if (logoUrlBody.startsWith('/') || logoUrlBody.startsWith('data:image')) {
            logoValido = true;
          } else if (logoUrlBody.startsWith('https://')) {
            try {
              const supabaseUrl = process.env.SUPABASE_URL;
              // SUPABASE_URL assente o non parsabile: nessun https è legittimo.
              if (supabaseUrl && new URL(logoUrlBody).host === new URL(supabaseUrl).host) {
                logoValido = true;
              }
            } catch {
              // logoUrl o SUPABASE_URL non si lasciano parsare: non è legittimo.
            }
          }
        }
      }
      if (!logoValido) {
        return reply.code(400).send({
          errore: 'logoUrl non valido: ammessi un percorso relativo (/…), un data:image…, oppure un URL https dello storage del progetto',
        });
      }
    }

    const allowedKeys = [
      'ragioneSociale', 'piva', 'codiceFiscale', 'sedeLegale', 'sedeOperativa',
      'logoUrl', 'coloreTemaFattura', 'notePieFattura', 'titoloIntestazione',
      'iban', 'email', 'pec', 'telefono',
      'waPhoneId', 'waAccessToken', 'waVerifyToken', 'waAppId', 'waAppSecret',
      'waOtpTemplate', 'waOtpTemplateLang', 'tgBotToken', 'tgBotUsername',
      'smtpHost', 'smtpServername', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass',
      'smtpFromEmail', 'smtpFromName', 'smtpReplyTo', 'smtpBcc',
      'imapHost', 'imapServername', 'imapPort', 'imapSecure', 'imapUser', 'imapPass',
      'imapFolder', 'imapPollInterval', 'imapProtocol', 'emailSignatureHtml',
      'signalEndpoint', 'signalToken', 'signalNumber',
      'regimeFiscale', 'capitaleSociale', 'regImprese', 'mostraSdi', 'mostraIva',
      // `leadAdvisorPassword` è stato rimosso: era una password in chiaro sulla riga
      // Tenant, scrivibile da qualunque utente del tenant via questa rotta. Le password
      // vivono solo come hash scrypt su `user.passwordHash` (§23).
      'leadAdvisorNome', 'leadAdvisorEmail', 'giurisdizione',
      'durataMesi', 'dataAttivazione', 'dataScadenza',
      'piano', 'stato', 'moduliDisattivati'
    ];

    const sanitizedData: Record<string, any> = {};
    try {
      for (const key of allowedKeys) {
        if (rawBody[key] === undefined) continue;
        if (key === 'moduliDisattivati') {
          sanitizedData[key] = Array.isArray(rawBody[key])
            ? rawBody[key].filter((m: unknown): m is string => typeof m === 'string').slice(0, 50)
            : [];
        } else if (key === 'smtpPort' || key === 'imapPort') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaPorta(rawBody[key], key);
        } else if (key === 'durataMesi') {
          sanitizedData[key] = rawBody[key] ? Number(rawBody[key]) : null;
        } else if (key === 'smtpHost' || key === 'imapHost') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaHost(rawBody[key], key);
        } else if (key === 'smtpServername' || key === 'imapServername') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaServername(rawBody[key]);
        } else if (['smtpFromEmail', 'smtpReplyTo', 'smtpBcc'].includes(key)) {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaEmail(rawBody[key], key);
        } else if (key === 'imapUser') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaEmail(rawBody[key], key);
        } else if (key === 'imapFolder') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : validaCartellaImap(rawBody[key]);
        } else if (key === 'smtpUser') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : vietaControlli(rawBody[key], key, 254).trim();
        } else if (key === 'signalEndpoint') {
          sanitizedData[key] = rawBody[key] === null || rawBody[key] === '' ? null : formaIndirizzoDemone(rawBody[key]);
        } else if (key === 'signalNumber') {
          if (rawBody[key] === null || rawBody[key] === '') {
            sanitizedData[key] = null;
          } else {
            const numero = numeroSignal(vietaControlli(rawBody[key], key, 32).trim());
            if (!numero) {
              throw new Error(
                'signalNumber non valido: serve il numero in forma internazionale, con il prefisso (es. +393351234567).',
              );
            }
            // Si salva la forma normalizzata: è quella che il demone pretende, e averla già in
            // tabella significa che un numero scritto «0039 335 1234567» non fa fallire l'invio.
            sanitizedData[key] = numero;
          }
        } else if (key === 'smtpSecure' || key === 'imapSecure' || key === 'mostraSdi' || key === 'mostraIva') {
          sanitizedData[key] = Boolean(rawBody[key]);
        } else if ((CHIAVI_SEGRETE as readonly string[]).includes(key)) {
          if (rawBody[key] === null) {
            sanitizedData[key] = null;
          } else if (typeof rawBody[key] !== 'string' || rawBody[key].trim() !== '') {
            sanitizedData[key] = vietaControlli(rawBody[key], key, 2048);
          }
        } else {
          sanitizedData[key] = rawBody[key];
        }
      }
    } catch (err) {
      return reply.code(400).send({ errore: err instanceof Error ? err.message : 'Configurazione canali non valida.' });
    }

    // Primo salvataggio della configurazione WhatsApp: allo studio serve il suo discriminante.
    // Lo slug non si scrive dal browser (vedi `CHIAVI_CANALI`), nasce qui una volta sola e da
    // quel momento è il path che lo studio incolla in Meta. Toccare un campo `wa*` è la
    // definizione di «questo studio usa WhatsApp», quindi è il momento giusto per crearlo: senza
    // slug l'interfaccia non avrebbe nessuna Callback URL da mostrare e la guida Meta resterebbe
    // un'istruzione incompleta.
    if (Object.keys(sanitizedData).some(chiave => chiave.startsWith('wa'))) {
      let slugEsistente: string | null = null;
      try {
        const corrente = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { waWebhookSlug: true } });
        slugEsistente = corrente?.waWebhookSlug ?? null;
      } catch {
        slugEsistente = (inMemoryTenantStore.get(tenantId) as { waWebhookSlug?: string } | undefined)?.waWebhookSlug ?? null;
      }
      // Una lettura fallita non deve far fallire il salvataggio: le credenziali sono quello che
      // l'operatore ha chiesto di scrivere, e lo slug si crea al salvataggio successivo.
      if (!slugEsistente) sanitizedData.waWebhookSlug = generaSlugWhatsapp();
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
      return reply.send(tenantPubblico(updated));
    } catch (err) {
      console.warn('Prisma tenant upsert fallback to inMemory store:', err);
      const current = inMemoryTenantStore.get(tenantId) || { id: tenantId };
      const updated = { ...current, ...sanitizedData, id: tenantId };
      inMemoryTenantStore.set(tenantId, updated);
      return reply.send(tenantPubblico(updated));
    }
  });

  /**
   * Rotazione del discriminante del path di callback WhatsApp.
   *
   * Serve perché lo slug è l'unica cosa che separa il webhook di uno studio da quello di un
   * altro: se finisce in un log, in uno screenshot o in una pagina condivisa, lo studio deve
   * poterlo cambiare senza aspettare che qualcuno tocchi il database.
   *
   * `conferma: true` è obbligatorio, e non è una formalità: cambiare lo slug **smette di
   * ricevere** i messaggi finché la Callback URL in Meta non viene aggiornata, perché Meta
   * continua a chiamare il path vecchio e quel path ora risponde 404. È un'interruzione
   * voluta, quindi va chiesta due volte invece che una.
   */
  server.post<{ Body: { conferma?: boolean } }>('/tenant/whatsapp-slug', async (req, reply) => {
    if (!soloGestoriCanali(req, reply)) return reply;
    if (req.body?.conferma !== true) {
      return reply.code(400).send({
        errore: 'Rotazione non confermata. Cambiare lo slug interrompe la ricezione dei messaggi WhatsApp finché la Callback URL non viene aggiornata in Meta.',
      });
    }

    const tenantId = req.tenantId;
    // Un secondo tentativo sull'indice unico: la collisione è praticamente impossibile
    // (2^128), ma se accadesse il vincolo la segnala e rigenerare costa nulla.
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      const slug = generaSlugWhatsapp();
      try {
        const aggiornato = await prisma.tenant.update({
          where: { id: tenantId },
          data: { waWebhookSlug: slug },
        });
        await recordAudit({
          tenantId,
          azione: 'WHATSAPP_SLUG_RUOTATO',
          entita: 'Canali di comunicazione',
          dettagli: 'Nuovo path di callback WhatsApp generato: la Callback URL in Meta va aggiornata.',
        });
        return reply.send(tenantPubblico(aggiornato));
      } catch (err) {
        const codice = (err as { code?: string }).code;
        if (codice === 'P2002' && tentativo === 0) continue;
        console.error('POST /tenant/whatsapp-slug —', err instanceof Error ? err.message : err);
        return reply.code(503).send({ errore: 'Rotazione non riuscita. Riprova tra poco.' });
      }
    }
    return reply.code(503).send({ errore: 'Rotazione non riuscita. Riprova tra poco.' });
  });

  // ── GESTIONE UTENTI TEAM TENANT ───────────────────────────────────
  // §2bis — gerarchia: il super_admin sovrintende tutti i tenant (tenantId null);
  // l'advisor è il responsabile del proprio tenant e ne gestisce il team; i
  // collaboratori appartengono al tenant da cui sono stati creati e non creano utenti.

  server.get('/tenant/utenti', async (req, reply) => {
    const tenantId = req.tenantId;
    const ruoloRichiedente = req.ruolo as string | undefined;

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
    const tenantCorrente = req.tenantId;
    const ruoloRichiedente = req.ruolo as string | undefined;

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
        ruolo: ruoloFinale as RuoloUtente,
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

      // L'invito con la password temporanea parte da qui, nella stessa richiesta che l'ha
      // generata. Prima lo spediva il browser: la risposta tornava alla pagina, che rigirava
      // la password appena creata alla funzione serverless pubblica insieme alla password SMTP
      // dello studio letta da `localStorage`. Se l'operatore chiudeva la schermata nel
      // frattempo, l'utente restava creato e nessuno conosceva la sua password.
      let invitoInviato = false;
      let invitoErrore: string | null = null;
      if (passwordTemporanea) {
        const cred = await credenzialiCanali(tenantCorrente);
        if (!cred.smtp.host || !cred.smtp.user) {
          invitoErrore =
            'Posta in uscita non configurata nelle impostazioni dello studio: la password temporanea va consegnata a mano.';
        } else {
          const esito = await sendInvitoCollaboratoreEmail({
            toEmail: emailPulita,
            nome,
            ruolo: ruoloFinale,
            specializzazione: specializzazione || undefined,
            passwordTemporanea,
            smtp: cred.smtp,
            fromEmail: cred.smtpFromEmail ?? undefined,
            fromName: cred.smtpFromName ?? undefined,
          });
          invitoInviato = esito.ok;
          // Nessun «invito inviato» quando non è partito: la password resta nella risposta,
          // così il responsabile la può consegnare comunque (regola 7).
          invitoErrore = esito.ok ? null : esito.errore || 'Invio non riuscito.';
        }
      }

      // passwordTemporanea è l'unico momento in cui la password è leggibile: non viene
      // salvata in chiaro né rispedita da nessun altro endpoint.
      return reply.code(201).send({ ...senzaHash(utente), passwordTemporanea, invitoInviato, invitoErrore });
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
    const ruoloRichiedente = req.ruolo as string | undefined;
    const tenantCorrente = req.tenantId as string;
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

      await prisma.user.update({
        where: { id: utente.id },
        data: {
          passwordHash,
          stato: 'invitato', // Imposta 'invitato' per obbligare il cambio password al primo accesso
          sessionVersion: { increment: 1 },
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
        utentiCount: t._count?.users || 1,
        progettiCount: t._count?.clienti || 0,
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
          // Default richiesto: i nuovi studi nascono SENZA moduli opzionali (KYC spento finché il
          // super_admin non lo concede). Gli studi esistenti li ha già valorizzati la migrazione.
          moduliConcessi: Array.isArray(b.moduliConcessi) ? b.moduliConcessi.filter((k: unknown) => k === 'kyc') : [],
        }
      });

      // Senza responsabile lo studio non è utilizzabile: nessuno potrebbe accedervi.
      let passwordTemporanea: string | null = null;
      if (emailResponsabile) {
        const esistente = await prisma.user.findUnique({ where: { email: emailResponsabile } });
        if (!esistente) {
          const pwd = generaPasswordTemporanea();
          passwordTemporanea = pwd;
          // La `user.create` va eseguita nel contesto del tenant appena creato, non in quello
          // della richiesta (il super_admin opera dal tenant di default). La policy RLS su `user`
          // ammette una riga solo se `tenant_id = app.current_tenant_id` — oppure `NULL` per un
          // super_admin. Il responsabile del nuovo studio non è né l'uno né l'altro finché il
          // contesto resta sul default: la `WITH CHECK` respinge l'insert e lo studio nasce orfano,
          // senza nessun utente che possa accedervi (era il "errore" alla creazione di un secondo
          // studio). `run` (non `enterWith`) apre il contesto solo per questa scrittura e lo richiude
          // subito dopo, senza sporcare il resto della richiesta.
          await contestoTenant.run({ tenantId: tenant.id, ruolo: 'super_admin' }, async () => {
            await prisma.user.create({
              data: {
                email: emailResponsabile,
                nome: b.leadAdvisorNome || 'Lead Senior Advisor',
                ruolo: 'advisor',
                tenantId: tenant.id,
                specializzazione: `Lead Partner — ${tenant.ragioneSociale}`,
                passwordHash: hashPassword(pwd),
                // 'invitato' come ogni altro utente creato con password temporanea (POST /tenant/utenti,
                // reset-password): il login accetta questo stato, ma `mustChangePassword` diventa vero e
                // al primo accesso il responsabile del nuovo studio DEVE cambiare la password. Con 'attivo'
                // entrava senza obbligo di cambiarla.
                stato: 'invitato',
              },
            });
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

      return reply.code(201).send({ ...senzaSegreti(tenant), passwordTemporanea });
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
          // Concessione moduli per-studio (super_admin): solo la chiave 'kyc' è ammessa per ora.
          ...(Array.isArray(b.moduliConcessi) && { moduliConcessi: b.moduliConcessi.filter((k: unknown) => k === 'kyc') }),
          // Nessuna scrittura di password qui: per rigenerarla c'è
          // POST /admin/tenants/:id/reset-password, che ne salva solo l'hash.
        }
      });
      return reply.send(senzaSegreti(updated));
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento tenant' });
    }
  });

  /**
   * Rigenera la password del responsabile dello studio e la restituisce una volta sola,
   * perché il super admin possa consegnarla. Sostituisce la vecchia pratica di rileggere
   * `leadAdvisorPassword` dal database, che presupponeva di averla conservata in chiaro.
   *
   * Con `invia: true` la spedisce anche per email, da qui. Prima l'invio lo faceva la pagina
   * super admin chiamando `POST /api/send-email` senza nessuna credenziale nel corpo: la
   * funzione serverless ripiegava su `process.env.SMTP_PASS`, cioè su un unico account valido
   * per qualunque chiamante — e chiunque, non solo il super admin, poteva chiamarla.
   */
  server.post<{ Params: { id: string }; Body?: { invia?: boolean } }>('/admin/tenants/:id/reset-password', async (req, reply) => {
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

      // Lettura E scrittura dell'utente responsabile vanno fatte nel contesto del tenant
      // dello studio, non in quello della richiesta (il super_admin opera dal tenant di
      // default). Altrimenti, per uno studio diverso da quello di default, la policy RLS su
      // `user` — che filtra `tenant_id = app.current_tenant_id` — nasconde il responsabile
      // alla `findUnique` (`esistente` diventa `null`) e poi respinge la `create` con la sua
      // `WITH CHECK`: la rigenerazione falliva con un 500 su ogni studio nuovo, ed era il
      // motivo per cui non si riusciva a emettere la password. `run` apre il contesto solo
      // per queste operazioni e lo richiude subito. Stessa correzione della creazione tenant.
      await contestoTenant.run({ tenantId: tenant.id, ruolo: 'super_admin' }, async () => {
        const esistente = await prisma.user.findUnique({ where: { email: emailResponsabile } });
        if (esistente) {
          await prisma.user.update({
            where: { id: esistente.id },
            data: { passwordHash, stato: 'invitato', sessionVersion: { increment: 1 } },
          });
        } else {
          await prisma.user.create({
            data: {
              email: emailResponsabile,
              nome: tenant.leadAdvisorNome || 'Lead Senior Advisor',
              ruolo: 'advisor',
              tenantId: tenant.id,
              specializzazione: `Lead Partner — ${tenant.ragioneSociale}`,
              passwordHash,
              stato: 'invitato',
            },
          });
        }
      });

      await recordAudit({
        tenantId: id,
        ruolo: 'super_admin',
        azione: 'PASSWORD_RESPONSABILE_RIGENERATA',
        entita: tenant.ragioneSociale,
        dettagli: `Nuova password temporanea emessa per ${emailResponsabile}`,
        ipAddress: req.ip,
      });

      // Le credenziali di posta sono quelle dello studio destinatario: `credenzialiCanali` legge
      // solo la sua riga e non ripiega su nessun account di piattaforma, quindi uno studio senza
      // casella configurata non spedisce l'invito — e lo dice, invece di spedirlo a nome di un
      // altro studio.
      let invitoInviato = false;
      let invitoErrore: string | null = null;
      if (req.body?.invia) {
        const cred = await credenzialiCanali(id);
        if (!cred.smtp.host || !cred.smtp.user) {
          invitoErrore = 'Posta in uscita non configurata: consegna la password a mano.';
        } else {
          const esito = await sendInvitoCollaboratoreEmail({
            toEmail: emailResponsabile,
            nome: tenant.leadAdvisorNome || 'Gestore Studio',
            ruolo: 'partner',
            specializzazione: `Lead Senior Advisor — ${tenant.ragioneSociale}`,
            passwordTemporanea,
            smtp: cred.smtp,
            fromEmail: cred.smtpFromEmail ?? undefined,
            fromName: cred.smtpFromName ?? tenant.ragioneSociale ?? undefined,
          });
          invitoInviato = esito.ok;
          invitoErrore = esito.ok ? null : esito.errore || 'Invio non riuscito.';
        }
      }

      return reply.send({ ok: true, email: emailResponsabile, passwordTemporanea, invitoInviato, invitoErrore });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore reset password' });
    }
  });

  server.delete<{ Params: { id: string } }>('/admin/tenants/:id', async (req, reply) => {
    if (!soloSuperAdmin(req, reply)) return reply;
    const { id } = req.params;
    try {
      // L'eliminazione è irreversibile e cancella TUTTI i dati dello studio: è ammessa solo
      // dopo l'archiviazione, che è il passaggio reversibile e la doppia sicurezza contro la
      // cancellazione accidentale di uno studio ancora attivo (scelta 19/09/2026).
      const tenant = await prisma.tenant.findUnique({ where: { id } });
      if (!tenant) return reply.code(404).send({ errore: 'Studio non trovato' });
      if (tenant.stato !== 'archiviato') {
        return reply.code(409).send({
          errore: "Lo studio va prima archiviato: l'eliminazione definitiva è ammessa solo su uno studio archiviato.",
        });
      }

      const conteggi = await eliminaTenantCompleto(id);

      // L'audit dell'eliminazione NON può restare nel tenant appena cancellato: lo si registra
      // a livello di piattaforma (tenant di default), come atto del super_admin.
      await recordAudit({
        tenantId: TENANT_DEFAULT,
        ruolo: 'super_admin',
        azione: 'TENANT_ELIMINATO',
        entita: tenant.ragioneSociale,
        dettagli: `Studio "${tenant.ragioneSociale}" (${id}) eliminato definitivamente. Righe rimosse: ${JSON.stringify(conteggi)}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, id, conteggi });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore eliminazione tenant' });
    }
  });

  /**
   * §35 — la prova della posta in uscita usa la strada della posta vera.
   *
   * Prima questa rotta completava la configurazione mancante con `process.env.SMTP_*` e, in
   * ultima istanza, con un host e un'utenza scritti nel codice. Due conseguenze: uno studio
   * senza posta configurata vedeva la prova riuscire (con la casella della piattaforma), e
   * uno studio con l'host sbagliato vedeva l'errore di un server che non aveva mai indicato.
   * Ora si prova esattamente quello che c'è: corpo della richiesta, altrimenti riga Tenant.
   */
  server.post<{ Body: { smtpHost?: string; smtpServername?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPass?: string; smtpFromEmail?: string; smtpFromName?: string; emailDestinatario?: string } }>('/tenant/test-email', async (req, reply) => {
    if (!soloGestoriCanali(req, reply)) return reply;
    const tenantId = req.tenantId;
    let dbTenant: any = null;
    try {
      dbTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    } catch {}

    const body = req.body || {};
    const host = body.smtpHost || dbTenant?.smtpHost || '';
    // Il nome del certificato fa parte della configurazione da provare: se la prova lo
    // ignorasse, passerebbe (o fallirebbe) su una connessione diversa da quella degli invii.
    const servername = body.smtpServername ?? dbTenant?.smtpServername ?? '';
    const port = body.smtpPort !== undefined
      ? body.smtpPort
      : (dbTenant?.smtpPort !== undefined && dbTenant?.smtpPort !== null ? dbTenant.smtpPort : 465);
    const secure = body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : (dbTenant?.smtpSecure !== undefined ? Boolean(dbTenant.smtpSecure) : port === 465);
    const user = body.smtpUser || dbTenant?.smtpUser || '';
    // La password può arrivare vuota dal modulo perché `GET /tenant/info` la maschera: in quel
    // caso si prova quella salvata, che è quella con cui la posta parte davvero.
    const pass = body.smtpPass || dbTenant?.smtpPass || '';
    const fromEmail = body.smtpFromEmail || dbTenant?.smtpFromEmail || user;
    const fromName = body.smtpFromName || dbTenant?.smtpFromName || dbTenant?.ragioneSociale || '';
    const toEmail = body.emailDestinatario || user;

    const res = await provaPostaInUscita({ host, servername, port, secure, user, pass, fromEmail, fromName, toEmail });

    if (!res.success) {
      return reply.code(400).send(res);
    }
    return reply.send(res);
  });

  server.post<{ Body: { imapHost?: string; imapServername?: string; imapPort?: number; imapUser?: string; imapPass?: string; imapSecure?: boolean } }>('/tenant/test-imap', async (req, reply) => {
    if (!soloGestoriCanali(req, reply)) return reply;
    const tenantId = req.tenantId;
    let dbTenant: any = null;
    try {
      dbTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    } catch {}

    const body = req.body || {};
    const host = body.imapHost || dbTenant?.imapHost || '';
    // Qui il nome dichiarato è il punto della questione: è il caso in cui l'indirizzo a cui si
    // collega e il nome che il certificato attesta non coincidono, e senza provarlo la prova
    // fallirebbe con «Hostname/IP does not match certificate's altnames» pur essendo la
    // configurazione corretta.
    const servername = body.imapServername ?? dbTenant?.imapServername ?? '';
    const port = body.imapPort !== undefined
      ? body.imapPort
      : (dbTenant?.imapPort !== undefined && dbTenant?.imapPort !== null ? dbTenant.imapPort : 993);
    const secure = body.imapSecure !== undefined ? Boolean(body.imapSecure) : (dbTenant?.imapSecure !== undefined ? Boolean(dbTenant.imapSecure) : port === 993);
    const user = body.imapUser || dbTenant?.imapUser || '';
    // La password IMAP ricade su quella SMTP perché su molti provider la casella è la stessa;
    // se non c'è nemmeno quella, la prova lo dice invece di collegarsi a una casella altrui.
    const pass = body.imapPass || dbTenant?.imapPass || dbTenant?.smtpPass || '';

    const res = await provaPostaInArrivo({ host, servername, port, secure, user, pass });

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
  server.post<{
    Body: {
      channel?: string;
      waPhoneId?: string;
      waAccessToken?: string;
      signalEndpoint?: string;
      signalToken?: string;
      signalNumber?: string;
    };
  }>('/tenant/test-channel', async (req, reply) => {
    if (!soloGestoriCanali(req, reply)) return reply;
    const tenantId = req.tenantId;
    const canale = (req.body?.channel || '').toLowerCase();
    const cred = await credenzialiCanali(tenantId);

    // Le credenziali nel corpo servono a provarle prima di salvarle: se non ci sono si usano
    // quelle già registrate per lo studio.
    const waPhoneId = req.body?.waPhoneId || cred.waPhoneId;
    const waAccessToken = req.body?.waAccessToken || cred.waAccessToken;

    const esito = (success: boolean, message: string) =>
      success ? reply.send({ success, message }) : reply.code(400).send({ success, message });

    try {
      const fetchConTimeout = async (url: string, init: RequestInit = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          return await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      };

      if (canale === 'whatsapp') {
        if (!waPhoneId || !waAccessToken) {
          return esito(
            false,
            'Phone Number ID o Access Token di WhatsApp non impostati. ' +
              `Ingresso (messaggi dai clienti): ${await statoIngressoWhatsapp(tenantId)}.`,
          );
        }
        const r = await fetchConTimeout(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(waPhoneId)}?fields=display_phone_number,verified_name,quality_rating`,
          { headers: { Authorization: `Bearer ${waAccessToken}` } },
        );
        const dati: any = await r.json().catch(() => ({}));
        if (!r.ok) {
          // Il rifiuto di Graph riguarda la metà in uscita, ma chi legge sta guardando lo stato
          // del canale: tacere sull'ingresso qui lascerebbe credere che il canale sia rotto
          // tutto intero quando magari è rotta solo una delle due metà — o viceversa.
          return esito(
            false,
            `Meta ha rifiutato le credenziali (HTTP ${r.status}): ${dati?.error?.message || 'errore non specificato'}. ` +
              `Ingresso (messaggi dai clienti): ${await statoIngressoWhatsapp(tenantId)}.`,
          );
        }
        // La prova di Graph copre solo la metà in uscita. Dire «WhatsApp attivo» dopo aver
        // verificato solo quella era la bugia che ha lasciato credere per mesi che i messaggi
        // dei clienti arrivassero: l'ingresso dipende da App Secret, Verify Token e Callback
        // URL, che Graph non conferma e che si leggono dalla configurazione dello studio.
        //
        // Le credenziali nel corpo servono a provarle **prima** di salvarle, quindi la prova può
        // riguardare un numero diverso da quello in colonna. Vale la pena dirlo: fino al salvataggio
        // le due metà del canale guardano due numeri diversi, e l'ingresso resta quello salvato.
        const numeroProvatoDiverso = Boolean(cred.waPhoneId && waPhoneId && cred.waPhoneId !== waPhoneId);
        return esito(
          true,
          `Invio attivo sul numero ${dati.display_phone_number || waPhoneId}` +
            `${dati.verified_name ? ` — ${dati.verified_name}` : ''}` +
            `${dati.quality_rating ? ` (qualità: ${dati.quality_rating})` : ''}. ` +
            (numeroProvatoDiverso
              ? `Attenzione: la prova ha usato il Phone Number ID ${waPhoneId}, mentre lo studio ne ha salvato un altro (${cred.waPhoneId}): gli invii e l'ingresso usano quello salvato finché non salvi. `
              : '') +
            `Ingresso (messaggi dai clienti): ${await statoIngressoWhatsapp(tenantId)}.`,
        );
      }

      if (canale === 'telegram') {
        if (!cred.tgBotToken) return esito(false, 'Token del bot Telegram non impostato.');
        const r = await fetchConTimeout(`https://api.telegram.org/bot${cred.tgBotToken}/getMe`);
        const dati: any = await r.json().catch(() => ({}));
        if (!r.ok || !dati?.ok) {
          return esito(false, `Telegram ha rifiutato il token: ${dati?.description || `HTTP ${r.status}`}`);
        }
        // Questa rotta è l'unico posto in cui lo studio vede lo username **vero** del proprio bot:
        // `getMe` risponde con quello che Telegram conosce. Se in colonna ce n'è un altro, il link
        // per collegare la chat di un cliente a una pratica punta a un utente inesistente — ed è il
        // guasto vero del 16/09/2026, con l'id numerico del bot finito nel campo «Bot Username».
        // Dirlo qui costa una riga e lo rende visibile nel momento in cui lo si sta guardando.
        const usernameVero = String(dati.result?.username ?? '').trim();
        const salvato = usernameBotTelegram(cred.tgBotUsername);
        const discordante = Boolean(usernameVero) && salvato?.toLowerCase() !== usernameVero.toLowerCase();
        return esito(
          true,
          `Bot raggiungibile: @${usernameVero}. ` +
            (discordante
              ? 'Attenzione: lo username salvato in Impostazioni → Canali non è questo, quindi il link '
                + 'per collegare la chat di un cliente a una pratica punterebbe a un utente '
                + 'inesistente. Premi «Registra webhook»: lo rilegge da Telegram e corregge il campo. '
              : '') +
            `Perché il canale sia utilizzabile ogni ` +
            `cliente deve scrivere al bot almeno una volta: è Telegram a non permettere il ` +
            `contrario, e finché non lo fa non esiste una chat su cui spedire.`,
        );
      }

      if (canale === 'email' || canale === 'smtp') {
        // `createTransporter(...).verify()` apriva una connessione SMTP diretta: sulla rete di
        // Railway quella connessione scade sempre, quindi il pulsante rispondeva «non
        // raggiungibile» su configurazioni perfettamente funzionanti. La prova è la stessa di
        // `/tenant/test-email` — relay compreso — perché è quella la strada degli invii veri.
        const prova = await provaPostaInUscita({
          ...cred.smtp,
          fromEmail: cred.smtpFromEmail ?? undefined,
          fromName: cred.smtpFromName ?? undefined,
        });
        return esito(prova.success, prova.message);
      }

      // A «signal» rispondeva «Daemon Signal REST API v1 in ascolto sul container Docker»:
      // quel demone non esiste in questo progetto e nessuna riga di codice lo contattava.
      // Dichiararlo in ascolto era inventare un'infrastruttura. Ora il demone è quello dello
      // studio e si interroga per davvero: `statoSignal` chiede versione e modalità a
      // `/v1/about` e verifica che il numero dello studio sia fra quelli registrati su
      // `/v1/accounts` — un demone raggiungibile senza quel numero risponde alla sonda e poi
      // rifiuta ogni invio, ed è esattamente il guasto che si vuole far emergere qui.
      if (canale === 'signal') {
        const signalEndpoint = req.body?.signalEndpoint || cred.signalEndpoint;
        const signalToken = req.body?.signalToken || cred.signalToken;
        const signalNumber = req.body?.signalNumber || cred.signalNumber;

        if (!signalEndpoint) {
          return esito(
            false,
            'Indirizzo del demone Signal non impostato: serve l\'URL del `signal-cli-rest-api` ' +
              'dello studio, raggiungibile in https.',
          );
        }
        if (!signalNumber) {
          return esito(false, 'Numero Signal dello studio non impostato: è il mittente, e senza non si può spedire.');
        }

        const stato = await statoSignal({ signalEndpoint, signalToken, signalNumber });
        return esito(stato.ok, stato.messaggio);
      }

      return esito(
        false,
        `Canale «${canale || 'non indicato'}» non gestito: la piattaforma non ha un invio da provare per questo canale.`,
      );
    } catch (err: any) {
      return esito(false, `Prova non riuscita: ${err?.message || 'errore di rete'}`);
    }
  });

  // Audit Logs API (Isolato per Tenant)
  server.get('/audit-logs', async (req, reply) => {
    const tenantId = req.tenantId;
    const paginazione = leggiPaginazione(req.query);
    if (paginazione.paginata && 'errore' in paginazione) {
      return reply.code(400).send({ errore: paginazione.errore });
    }

    try {
      if (!paginazione.paginata) {
        return await prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      }
      const { page, limit, search, sortBy, sortOrder, skip } = paginazione.parametri;
      const campo = campoOrdinamento(sortBy, ['createdAt', 'azione', 'ruolo', 'userNome'] as const, 'createdAt');
      if (!campo) return reply.code(400).send({ errore: 'Campo di ordinamento audit non valido' });
      const where = {
        tenantId,
        ...(search ? {
          OR: [
            { userNome: { contains: search, mode: 'insensitive' as const } },
            { userEmail: { contains: search, mode: 'insensitive' as const } },
            { azione: { contains: search, mode: 'insensitive' as const } },
            { entita: { contains: search, mode: 'insensitive' as const } },
            { dettagli: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {}),
      };
      const [logs, totale] = await Promise.all([
        prisma.auditLog.findMany({ where, skip, take: limit, orderBy: { [campo]: sortOrder } }),
        prisma.auditLog.count({ where }),
      ]);
      return reply.send({ data: logs, meta: creaMetaPaginazione(page, limit, totale) });
    } catch (err: any) {
      return reply.code(503).send({ errore: err?.message || 'Registro audit non disponibile' });
    }
  });

  server.post<{ Body: Record<string, any> }>('/audit-logs', async (req, reply) => {
    const tenantId = req.tenantId;
    const body = (req.body || {}) as Record<string, any>;
    // Chi ha fatto l'operazione lo dice il token, non il corpo della richiesta: qui c'erano
    // `body.userEmail || 'joe@…'` e `body.userNome || 'Joe Disabato'`, cioè il nome di una
    // persona reale attribuito a chiunque chiamasse la rotta senza indicarsi. In un registro
    // immutabile un attore inventato è peggio di un attore ignoto (regola 7), e il corpo della
    // richiesta non è una prova di identità: prevale sempre l'utenza autenticata. Le colonne
    // sono NOT NULL, quindi in mancanza di token — che il guard non consente su questa rotta —
    // resta un segnaposto che si dichiara tale.
    const autenticato = req.user || null;
    const IGNOTO = 'utenza-non-identificata';
    try {
      const log = await prisma.auditLog.create({
        data: {
          tenantId,
          userId: autenticato?.userId || body.userId || IGNOTO,
          userEmail: autenticato?.email || body.userEmail || IGNOTO,
          userNome: body.userNome || autenticato?.email || 'Utenza non identificata',
          ruolo: req.ruolo || body.ruolo || IGNOTO,
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

  // ── GESTIONE PERMESSI GRANULARI MODULI & SEZIONI (STYLE OPENSTAMANAGER) ─
  server.get<{ Params: { userId: string } }>('/tenant/utenti/:userId/permessi', async (req, reply) => {
    const tenantId = req.tenantId;
    const { userId } = req.params;
    try {
      const permessi = await prisma.permessoModulo.findMany({
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
    const tenantId = req.tenantId;
    const { userId } = req.params;
    const { permessi } = req.body;

    if (!Array.isArray(permessi)) {
      return reply.code(400).send({ errore: 'Array permessi obbligatorio' });
    }

    try {
      for (const p of permessi) {
        await prisma.permessoModulo.upsert({
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
}
