// Rotte webhook comunicazioni: Meta WhatsApp Business (verifica token +
// ingestion eventi multicanale) e Telegram bot (ingestion progetti + setup
// webhook).
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite vivevano in DUE punti diversi
// (WhatsApp a metà file, Telegram in coda): qui sono riunite nell'ordine di
// registrazione originale. La rotta /tenant/telegram-webhook-setup resta qui
// pur avendo un path da sezione tenant: è parte integrante del blocco webhook
// telegram (configura il webhook del bot usando il token appena validato).
// `registraRotteWebhooks` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

/**
 * Webhook WhatsApp e Telegram: ingestion messaggi in ingresso dai canali di comunicazione.
 *
 * Entrambi i webhook sono pubblici (nessun JWT richiesto) perché i provider di messaggistica
 * non inviano un token Bearer: la verifica dell'autenticità usa invece il token di verifica
 * Meta (GET) e la signature HMAC-SHA256 del payload (POST, Telegram non usa firma ma è
 * identificato dall'URL segreto del bot).
 *
 * §WA-MEDIA — Allegati WhatsApp in ingresso:
 * Quando il cliente invia un documento o un'immagine, Meta consegna un `media_id` nel payload
 * webhook. Per ottenerlo si chiama GET /v21.0/{media_id} per avere l'URL temporaneo firmato
 * (valido ~5 min), poi si scarica il binario e lo si carica su storage tramite `uploadDocumento`
 * già esistente. Il risultato viene salvato in `allegatiJson` della riga comunicazione.
 * Se il download o l'upload falliscono, la comunicazione viene comunque registrata con
 * `textBody` che descrive il tipo di media — nessun messaggio viene perso.
 */

import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma, prismaAmministrativo, attivaContestoTenant, conContestoInTransazione } from '../util/prismaClient.js';
import { notificaStudio } from '../services/notificheService.js';
import { confrontoTokenCostante } from '../util/password.js';
import { uploadDocumento } from '../services/storageService.js';
import { credenzialiCanali } from '../services/otpDispatch.js';
import { vietaControlli } from '../util/networkPolicy.js';
import {
  creaSegretoTelegram,
  normalizzaTelefono,
  tenantIdDaSegretoTelegram,
  verificaFirmaWhatsapp,
  verificaSegretoTelegram,
} from '../util/webhookSecurity.js';

const ROTTA_WA = '/webhooks/communications/whatsapp';
const ROTTA_TG = '/webhooks/communications/telegram';
const rawBodyWhatsapp = new WeakMap<object, Buffer>();

function installaParserRawWhatsapp(server: FastifyInstance): void {
  const parsers = ['application/json', 'application/*+json'];
  for (const contentType of parsers) {
    if (server.hasContentTypeParser(contentType)) server.removeContentTypeParser(contentType);
    server.addContentTypeParser(contentType, { parseAs: 'buffer' }, (req, payload, done) => {
      try {
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        if (req.url.split('?')[0] === ROTTA_WA) rawBodyWhatsapp.set(req, raw);
        done(null, JSON.parse(raw.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
  }
}

function header(req: FastifyRequest, nome: string): string | string[] | undefined {
  const valore = req.headers[nome];
  return Array.isArray(valore) || typeof valore === 'string' ? valore : undefined;
}

function rawBodyOriginale(req: FastifyRequest): Buffer | null {
  return rawBodyWhatsapp.get(req) ?? null;
}

function idEsterno(provider: 'whatsapp' | 'telegram', id: string): string {
  return `${provider}:${id}`;
}

function isProgettoAttivo(stato: string): boolean {
  return stato === 'in_progress';
}

function isReplayWebhook(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  if (typeof err !== 'object' || err === null || !('code' in err)
      || (err as { code?: unknown }).code !== 'P2002') return false;

  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const campi = Array.isArray(target)
    ? target.filter((campo): campo is string => typeof campo === 'string')
    : typeof target === 'string' ? [target] : [];
  return campi.map(campo => campo.replaceAll('_', '').toLowerCase()).some(campo =>
    campo.includes('webhookinboxtenantidprovidereventidkey'),
  ) || ['tenantid', 'provider', 'eventid'].every(campo =>
    campi.some(targetCampo => targetCampo.replaceAll('_', '').toLowerCase() === campo),
  );
}

type TransazioneWebhook = {
  webhookInbox: {
    create: (args: { data: { tenantId: string; provider: string; eventId: string } }) => Promise<unknown>;
  };
  comunicazioneProgetto: {
    create: (args: Prisma.ComunicazioneProgettoCreateArgs) => Promise<unknown>;
    update: (args: Prisma.ComunicazioneProgettoUpdateArgs) => Promise<unknown>;
  };
};

async function transazioneWebhook<T>(
  operazione: (tx: TransazioneWebhook) => Promise<T>,
): Promise<T> {
  return prisma.$transaction((tx) =>
    conContestoInTransazione(tx, () => operazione(tx)),
  );
}

/**
 * Scarica un media WhatsApp (documento/immagine) dalla Meta Graph API e lo carica su storage.
 *
 * Restituisce `null` se il download fallisce: il chiamante registra ugualmente la
 * comunicazione con il testo descrittivo, senza che il guasto blocchi l'ingestion.
 */
async function scaricaMediaWhatsapp(
  mediaId: string,
  accessToken: string,
  tenantId: string,
  nomeFile?: string,
): Promise<{ url: string; nome: string; dimensione: string; mime: string } | null> {
  try {
    // Step 1: risolvi l'URL temporaneo firmato dal media_id
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.warn(`[WA Media] Meta ha risposto ${metaRes.status} per media_id=${mediaId}`);
      return null;
    }
    const metaJson: any = await metaRes.json();
    const mediaUrl: string | undefined = metaJson.url;
    const mimeType: string = metaJson.mime_type || 'application/octet-stream';
    if (!mediaUrl) return null;

    // Step 2: scarica il binario dall'URL firmato (valido ~5 min)
    const binRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!binRes.ok) {
      console.warn(`[WA Media] Download binario fallito (${binRes.status}) per ${mediaUrl}`);
      return null;
    }

    const MAX_BYTES = 15 * 1024 * 1024;
    const contentLength = Number(binRes.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) {
      console.warn(`[WA Media] File troppo grande (${contentLength} B > 15 MB): ignorato.`);
      return null;
    }

    const arrayBuf = await binRes.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BYTES) return null;

    // Step 3: carica su Supabase Storage / fallback locale
    const estensione = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const nome = nomeFile || `wa_${mediaId.slice(-8)}.${estensione}`;
    const base64 = `data:${mimeType};base64,${Buffer.from(arrayBuf).toString('base64')}`;
    const esito = await uploadDocumento(nome, base64, tenantId);

    if (!esito.ok) {
      console.warn(`[WA Media] uploadDocumento fallito per ${nome}`);
      return null;
    }

    return { url: esito.url, nome, dimensione: esito.size, mime: mimeType };
  } catch (err) {
    console.warn('[WA Media] Errore imprevisto nel download media:', err);
    return null;
  }
}

// ─── WEBHOOK COMUNICAZIONI: META WHATSAPP & TELEGRAM ────────────────
export async function registraRotteWebhooks(server: FastifyInstance): Promise<void> {
  installaParserRawWhatsapp(server);
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
    ROTTA_WA,
    async (req, reply) => {
      const rawBody = rawBodyOriginale(req);
      if (!rawBody) return reply.status(500).send({ errore: 'Raw body webhook non disponibile' });
      const autenticita = verificaFirmaWhatsapp(rawBody, header(req, 'x-hub-signature-256'), process.env.WA_APP_SECRET);
      if (autenticita === 'secret_missing') return reply.status(503).send({ errore: 'WA_APP_SECRET non configurato' });
      if (autenticita !== 'ok') return reply.status(401).send({ errore: 'Firma webhook non valida' });

      const body = req.body || {};
      const value = body.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = String(value?.metadata?.phone_number_id || '').trim();
      if (!phoneNumberId) return reply.status(400).send({ errore: 'metadata.phone_number_id mancante' });

      const tenantCandidati = await prismaAmministrativo().tenant.findMany({
        where: { waPhoneId: phoneNumberId },
        select: { id: true },
        take: 2,
      });
      if (tenantCandidati.length !== 1) return reply.status(404).send({ errore: 'Tenant webhook non identificabile univocamente' });
      const tenantId = tenantCandidati[0]?.id;
      if (!tenantId) return reply.status(404).send({ errore: 'Tenant webhook non identificabile univocamente' });
      attivaContestoTenant({ tenantId });

      try {
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

        for (const s of statuses) {
          const wamid = typeof s?.id === 'string' ? s.id : '';
          const waStatus = typeof s?.status === 'string' ? s.status : '';
          if (!wamid || !waStatus) continue;
          const trovato = await prisma.comunicazioneProgetto.findMany({
            where: { tenantId, canale: 'whatsapp', externalId: idEsterno('whatsapp', wamid) },
            take: 2,
          });
          const trovata = trovato[0];
          if (!trovata) continue;
          const statoNorm = waStatus === 'read' ? 'letto' : waStatus === 'delivered' ? 'consegnato' : 'inviato';
          const meta = JSON.stringify({ providerId: wamid, stato: statoNorm, ricevutaAt: new Date().toISOString() });
          try {
            await transazioneWebhook(async (tx) => {
              await tx.webhookInbox.create({
                data: { tenantId, provider: 'whatsapp_status', eventId: `${wamid}:${waStatus}` },
              });
              await tx.comunicazioneProgetto.update({
                where: { id: trovata.id },
                data: { allegatiJson: meta },
              });
            });
          } catch (err) {
            if (isReplayWebhook(err)) continue;
            throw err;
          }
        }

        for (const msg of messages) {
          const providerId = typeof msg?.id === 'string' ? msg.id : '';
          const fromNumber = normalizzaTelefono(msg?.from);
          if (!providerId || !fromNumber) continue;

          // Compatibilità con eventi già persistiti prima dell'introduzione della inbox.
          // La query evita il duplicato storico; il vincolo della inbox resta il controllo
          // atomico che chiude la race fra nuove richieste concorrenti.
          const comunicazionePreesistente = await prisma.comunicazioneProgetto.findMany({
            where: { tenantId, canale: 'whatsapp', externalId: idEsterno('whatsapp', providerId) },
            select: { id: true },
            take: 1,
          });
          if (comunicazionePreesistente.length) continue;

          const clienti = await prisma.cliente.findMany({
            where: { tenantId },
            select: { id: true, nome: true, cellulare: true, referentiJson: true },
          });
          const corrispondenze = clienti.filter(cliente => {
            const recapiti = [cliente.cellulare];
            if (cliente.referentiJson && typeof cliente.referentiJson === 'object') {
              const ref = cliente.referentiJson as Record<string, unknown>;
              recapiti.push(ref.cellulare as string, ref.whatsapp as string, ref.telefono as string);
            }
            return recapiti.some(recapito => normalizzaTelefono(recapito) === fromNumber);
          });
          if (corrispondenze.length !== 1) continue;
          const matchingClient = corrispondenze[0];
          if (!matchingClient) continue;

          const progetti = await prisma.progetto.findMany({
            where: { tenantId, clienteId: matchingClient.id, stato: 'in_progress' },
            select: { id: true, stato: true },
            take: 2,
          });
          const attivi = progetti.filter(p => isProgettoAttivo(p.stato));
          if (attivi.length !== 1) continue;
          const activeProj = attivi[0];
          if (!activeProj) continue;

          const isMedia = ['image', 'document', 'video', 'audio'].includes(msg.type);
          const textBody = msg.text?.body
            || (msg.type === 'image' ? '[Immagine ricevuta]'
              : msg.type === 'document' ? `[Documento: ${msg.document?.filename || 'file'}]`
              : msg.type === 'video' ? '[Video ricevuto]'
              : msg.type === 'audio' ? '[Messaggio vocale]'
              : '[Messaggio multimediale]');
          let allegatiJson: string | null = null;
          if (isMedia) {
            const mediaId: string | undefined = msg.document?.id || msg.image?.id || msg.video?.id || msg.audio?.id;
            if (mediaId) {
              const cred = await credenzialiCanali(tenantId).catch(() => null);
              const accessToken = cred?.waAccessToken || process.env.WA_ACCESS_TOKEN || undefined;
              if (accessToken) {
                const allegato = await scaricaMediaWhatsapp(mediaId, accessToken, tenantId, msg.document?.filename || undefined);
                if (allegato) allegatiJson = JSON.stringify([allegato]);
              }
            }
          }

          try {
            await transazioneWebhook(async (tx) => {
              await tx.webhookInbox.create({
                data: { tenantId, provider: 'whatsapp_message', eventId: providerId },
              });
              await tx.comunicazioneProgetto.create({
                data: {
                  tenantId,
                  progettoId: activeProj.id,
                  canale: 'whatsapp',
                  mittente: `+${fromNumber} (${matchingClient.nome})`,
                  destinatario: `WhatsApp Studio (${phoneNumberId})`,
                  direzione: 'entrata',
                  testo: textBody,
                  externalId: idEsterno('whatsapp', providerId),
                  ...(allegatiJson ? { allegatiJson } : {}),
                },
              });
            });
          } catch (err) {
            if (isReplayWebhook(err)) continue;
            throw err;
          }
          await notificaStudio(tenantId, {
            tipoEvento: 'messaggio_cliente',
            oggetto: 'Nuovo messaggio WhatsApp',
            corpo: `${matchingClient.nome} ha scritto su WhatsApp: ${(textBody || '').slice(0, 120)}`,
            link: `/projects/${activeProj.id}`,
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Errore elaborazione webhook WhatsApp:', err);
        return reply.status(500).send({ errore: 'Elaborazione webhook fallita' });
      }

      return reply.status(200).send({ status: 'EVENT_RECEIVED' });
    }
  );

  // ── WEBHOOK TELEGRAM BOT REALE & INGESTION PROGETTI ─────────────────
  server.post(ROTTA_TG, async (req, reply) => {
    const tenantId = tenantIdDaSegretoTelegram(header(req, 'x-telegram-bot-api-secret-token'));
    if (!tenantId) return reply.status(401).send({ errore: 'Secret webhook non valido' });

    const tenant = await prismaAmministrativo().tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, tgBotToken: true },
    });
    if (!tenant?.tgBotToken) return reply.status(404).send({ errore: 'Tenant Telegram non configurato' });
    const autenticita = verificaSegretoTelegram(
      header(req, 'x-telegram-bot-api-secret-token'),
      tenant.id,
      tenant.tgBotToken,
      process.env.TELEGRAM_WEBHOOK_SECRET,
    );
    if (autenticita === 'secret_missing') return reply.status(503).send({ errore: 'TELEGRAM_WEBHOOK_SECRET non configurato' });
    if (autenticita !== 'ok') return reply.status(401).send({ errore: 'Secret webhook non valido' });
    attivaContestoTenant({ tenantId: tenant.id });

    try {
      const body: any = req.body || {};
      const updateId = Number.isSafeInteger(body.update_id) ? String(body.update_id) : '';
      if (!updateId) return reply.status(400).send({ errore: 'update_id mancante' });
      const comunicazionePreesistente = await prisma.comunicazioneProgetto.findMany({
        where: { tenantId: tenant.id, canale: 'telegram', externalId: idEsterno('telegram', updateId) },
        select: { id: true },
        take: 1,
      });
      if (comunicazionePreesistente.length) return reply.send({ ok: true, duplicate: true });

      const msg = body.message || body.channel_post;
      if (!msg) return reply.send({ ok: true });
      const chatId = String(msg.chat?.id || '');
      if (!chatId) return reply.status(400).send({ errore: 'chat.id mancante' });

      const clienti = await prisma.cliente.findMany({
        where: { tenantId: tenant.id, telegramChatId: chatId },
        select: { id: true, nome: true },
        take: 2,
      });
      if (clienti.length !== 1) return reply.status(202).send({ ok: true, ignored: 'sender_not_unique' });
      const cliente = clienti[0];
      if (!cliente) return reply.status(202).send({ ok: true, ignored: 'sender_not_unique' });
      const progetti = await prisma.progetto.findMany({
        where: { tenantId: tenant.id, clienteId: cliente.id, stato: 'in_progress' },
        select: { id: true, stato: true },
        take: 2,
      });
      const attivi = progetti.filter(p => isProgettoAttivo(p.stato));
      if (attivi.length !== 1) return reply.status(202).send({ ok: true, ignored: 'project_not_unique' });

      const progetto = attivi[0];
      if (!progetto) return reply.status(202).send({ ok: true, ignored: 'project_not_unique' });

      const text = msg.text || (msg.caption ? `[Allegato]: ${msg.caption}` : '[Allegato / File Ricevuto]');
      try {
        await transazioneWebhook(async (tx) => {
          await tx.webhookInbox.create({
            data: { tenantId: tenant.id, provider: 'telegram_update', eventId: updateId },
          });
          await tx.comunicazioneProgetto.create({
            data: {
              tenantId: tenant.id,
              progettoId: progetto.id,
              canale: 'telegram',
              direzione: 'entrata',
              mittente: cliente.nome,
              destinatario: 'Studio',
              testo: text,
              externalId: idEsterno('telegram', updateId),
            },
          });
        });
      } catch (err) {
        if (isReplayWebhook(err)) return reply.send({ ok: true, duplicate: true });
        throw err;
      }
      await notificaStudio(tenant.id, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Nuovo messaggio Telegram',
        corpo: `${cliente.nome} ha scritto al bot Telegram: ${(text || '').slice(0, 120)}`,
        link: `/projects/${progetto.id}`,
      }).catch(() => {});
      return reply.send({ ok: true });
    } catch (err) {
      console.warn('[Telegram Webhook Error]', err);
      return reply.status(500).send({ errore: 'Elaborazione webhook fallita' });
    }
  });

  server.post<{ Body: { botToken: string; webhookUrl?: string } }>('/tenant/telegram-webhook-setup', async (req, reply) => {
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Configurazione webhook riservata al responsabile dello studio o al super admin.' });
    }
    try {
      const botToken = vietaControlli(req.body?.botToken || '', 'Bot Token', 256).trim();
      const webhookUrl = vietaControlli(
        req.body?.webhookUrl || 'https://bluman.vercel.app/api/webhooks/communications/telegram',
        'URL webhook',
        2048,
      );
      if (!botToken || !/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(botToken)) {
        return reply.code(400).send({ errore: 'Bot Token mancante o non valido' });
      }
      let webhook;
      try {
        webhook = new URL(webhookUrl);
      } catch {
        return reply.code(400).send({ errore: 'URL webhook non valido' });
      }
      if (webhook.protocol !== 'https:' || webhook.username || webhook.password) {
        return reply.code(400).send({ errore: 'Il webhook deve essere un URL HTTPS senza credenziali incorporate' });
      }

      const masterSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (!masterSecret) {
        return reply.code(503).send({ errore: 'TELEGRAM_WEBHOOK_SECRET non configurato' });
      }
      if (!req.tenantId) {
        return reply.code(400).send({ errore: 'Tenant autenticato mancante' });
      }
      const secretToken = creaSegretoTelegram(req.tenantId, botToken, masterSecret);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
        const tgRes = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: webhook.toString(), secret_token: secretToken }),
          signal: controller.signal,
        });
        const tgJson: any = await tgRes.json().catch(() => ({}));
        if (!tgRes.ok || !tgJson?.ok) {
          return reply.code(400).send({ errore: tgJson?.description || `Telegram ha risposto HTTP ${tgRes.status}` });
        }
        return reply.send({
          ok: true,
          telegramResponse: tgJson,
          message: 'Webhook Telegram configurato ed attivato con successo!',
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'AbortError';
      return reply.code(timeout ? 504 : 400).send({
        errore: timeout ? 'Telegram non ha risposto entro 8 secondi' : (err instanceof Error ? err.message : 'Errore configurazione Telegram'),
      });
    }
  });
}
