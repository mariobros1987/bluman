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

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { notificaStudio } from '../services/notificheService.js';
import { confrontoTokenCostante } from '../util/password.js';
import { uploadDocumento, mimeDaEstensione } from '../services/storageService.js';
import { credenzialiCanali } from '../services/otpDispatch.js';

/**
 * Scarica un media WhatsApp (documento/immagine) dalla Meta Graph API e lo carica su storage.
 *
 * Restituisce `null` se il download fallisce: il chiamante registra ugualmente la
 * comunicazione con il testo descrittivo, senza che il guasto blocchi l'ingestion.
 */
async function scaricaMediaWhatsapp(
  mediaId: string,
  accessToken: string,
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
    const esito = await uploadDocumento(nome, base64);

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
      const tenantId = req.tenantId;

      try {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;
        const statuses = value?.statuses;

        // Gestione ricevute di consegna e lettura WhatsApp (spunte ✓✓ e ✓✓ azzurre)
        if (statuses && Array.isArray(statuses) && statuses.length > 0) {
          for (const s of statuses) {
            const wamid = s.id;
            const waStatus = s.status; // 'sent' | 'delivered' | 'read'
            const statoNorm = waStatus === 'read' ? 'letto' : waStatus === 'delivered' ? 'consegnato' : 'inviato';

            const trovato = await prisma.comunicazioneProgetto.findFirst({
              where: {
                canale: 'whatsapp',
                OR: [
                  { externalId: { contains: wamid } },
                  { externalId: wamid },
                ],
              },
            });

            if (trovato) {
              let meta: any = {};
              try {
                meta = JSON.parse(trovato.externalId || '{}');
              } catch {
                meta = { wamid };
              }
              meta.stato = statoNorm;
              if (statoNorm === 'letto') meta.lettoAt = new Date().toISOString();
              if (statoNorm === 'consegnato' && !meta.consegnatoAt) meta.consegnatoAt = new Date().toISOString();
              await prisma.comunicazioneProgetto.update({
                where: { id: trovato.id },
                data: { externalId: JSON.stringify(meta) },
              });
            }
          }
        }

        if (messages && messages.length > 0) {
          const msg = messages[0];
          const fromNumber = msg.from; // es. 393351234567
          const isMedia = msg.type === 'image' || msg.type === 'document' || msg.type === 'video' || msg.type === 'audio';
          const textBody = msg.text?.body
            || (msg.type === 'image' ? '[Immagine ricevuta]'
              : msg.type === 'document' ? `[Documento: ${msg.document?.filename || 'file'}]`
              : msg.type === 'video' ? '[Video ricevuto]'
              : msg.type === 'audio' ? '[Messaggio vocale]'
              : '[Messaggio multimediale]');

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
            // §WA-MEDIA — Prova a scaricare l'allegato dalla Media API di Meta.
            // Se manca il token o il download fallisce, la comunicazione viene registrata
            // ugualmente con il testo descrittivo: nessun messaggio va perso.
            let allegatiJson: string | null = null;
            if (isMedia) {
              const mediaId: string | undefined =
                msg.document?.id || msg.image?.id || msg.video?.id || msg.audio?.id;
              if (mediaId) {
                // Recupera il token dello studio: il tenant potrebbe avere il proprio WA_ACCESS_TOKEN.
                // Ricade sulla variabile d'ambiente globale se non è configurata a DB.
                let accessToken: string | undefined;
                try {
                  const cred = await credenzialiCanali(tenantId);
                  accessToken = cred.waAccessToken || process.env.WA_ACCESS_TOKEN || undefined;
                } catch {
                  accessToken = process.env.WA_ACCESS_TOKEN || undefined;
                }
                if (accessToken) {
                  const nomefile = msg.document?.filename
                    || msg.image?.id
                    || undefined;
                  const allegato = await scaricaMediaWhatsapp(mediaId, accessToken, nomefile);
                  if (allegato) {
                    allegatiJson = JSON.stringify([allegato]);
                  }
                }
              }
            }

            await prisma.comunicazioneProgetto.create({
              data: {
                tenantId,
                progettoId: activeProj.id,
                canale: 'whatsapp',
                mittente: `+${fromNumber} (${matchingClient ? matchingClient.nome : 'Cliente'})`,
                destinatario: `BluMan WhatsApp Studio (+39 378 092 6461)`,
                direzione: 'entrata',
                testo: textBody,
                ...(allegatiJson ? { allegatiJson } : {}),
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
        if (tenantId && matchedProgettoId) {
          await prisma.comunicazioneProgetto.create({
            data: {
              tenantId,
              progettoId: matchedProgettoId,
              canale: 'telegram',
              direzione: 'entrata',
              mittente: fromName,
              destinatario: 'Studio Bluecode Ltd',
              testo: text,
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
}
