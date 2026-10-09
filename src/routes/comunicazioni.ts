/**
 * Comunicazioni al cliente dal backend: email in uscita, WhatsApp, posta in arrivo.
 *
 * Prima queste tre cose le faceva il browser, chiamando direttamente le funzioni serverless
 * `POST /api/send-email` e `POST /api/send-whatsapp` con le credenziali dello studio lette da
 * `localStorage`. Il guasto non era teorico:
 *
 * - la password SMTP e quella IMAP stavano nello spazio di archiviazione del browser di ogni
 *   operatore, ed erano leggibili da qualunque script della pagina (regola 6);
 * - su un computer diverso, o dopo una pulizia del browser, `localStorage` era vuoto: l'invio
 *   partiva senza password e il messaggio non arrivava, mentre l'interfaccia diceva altro;
 * - le due funzioni serverless rispondono a chiunque (`Access-Control-Allow-Origin: *`) e
 *   ripiegano su `process.env.SMTP_PASS`: senza autenticazione, chiunque potesse spedire come
 *   lo studio;
 * - `POST /progetti/:id/comunicazioni` spediva già il messaggio WhatsApp per conto suo, con le
 *   variabili d'ambiente al posto delle credenziali del tenant, e il browser lo spediva una
 *   seconda volta: al cliente arrivavano due messaggi identici.
 *
 * Qui le credenziali si leggono dalla riga Tenant e non lasciano mai il server. Le rotte sono
 * registrate dentro il wrapper `server.register(...)` di `buildServer` e non compaiono in
 * `ROTTE_PUBBLICHE`, quindi richiedono un JWT valido come tutto il resto.
 *
 * Nessuna risposta inventa un successo: un canale non configurato o un invio rifiutato
 * risponde 400 con il motivo che ha dato il server di posta o Meta (regola 7).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { inviaEmail } from '../services/emailRelay.js';
import { credenzialiCanali } from '../services/otpDispatch.js';
import { inviaTestoWhatsapp, inviaTemplateWhatsapp } from '../services/whatsappService.js';
import { leggiPostaInArrivo, type CredenzialiImap } from '../services/imapInbound.js';
import { leggiAllegatiImap } from '../services/imapflowAllegati.js';
import { inviaSignal, inviaSignalConAllegati, numeroSignal } from '../services/signalService.js';
import { inviaTestoTelegram } from '../services/telegramService.js';
import { riceviMessaggiSignal } from '../services/signalInbound.js';
import { testoInHtml } from '../util/testoInHtml.js';
import { conStatoComunicazione } from '../util/statoComunicazione.js';

/**
 * Credenziali della casella in arrivo, dalla riga Tenant.
 *
 * `imapPass` ricade su `smtpPass` perché sulla stessa casella la password è una: le
 * impostazioni compilate solo nella sezione SMTP sono la normalità, e senza questo ripiego la
 * lettura risponderebbe «casella non configurata» con le credenziali giuste già salvate.
 * Nessun valore cablato: se il database non ha niente, la rotta lo dice.
 */
async function credenzialiImap(tenantId: string): Promise<CredenzialiImap> {
  let t: any = null;
  try {
    t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        imapHost: true,
        imapServername: true,
        imapPort: true,
        imapUser: true,
        imapPass: true,
        imapFolder: true,
        smtpUser: true,
        smtpPass: true,
      },
    });
  } catch {
    // Tenant non leggibile (contesto RLS assente): si risponde «non configurata», non un
    // elenco vuoto che sembrerebbe «il cliente non ha risposto».
  }

  return {
    host: t?.imapHost || undefined,
    servername: t?.imapServername || undefined,
    port: t?.imapPort || undefined,
    user: t?.imapUser || t?.smtpUser || undefined,
    pass: t?.imapPass || t?.smtpPass || undefined,
    folder: t?.imapFolder || undefined,
  };
}

/**
 * Scrive sul fascicolo l'esito di un invio appena tentato.
 *
 * La riga esiste già — l'ha creata `POST /progetti/:id/comunicazioni` con lo stato `da-inviare` —
 * e fino a oggi nessuno tornava a dirle com'era andata: restava «consegnato» anche quando Meta
 * aveva rifiutato. Qui l'esito vero prende il posto della previsione, e quando il canale rifiuta
 * ci finisce anche il motivo tecnico, che è quello che serve per capire cosa correggere.
 *
 * Non solleva: un esito non registrato non deve far sembrare fallito un invio riuscito. E non
 * tocca righe di un altro studio — la ricerca è filtrata per `tenantId`, quindi l'id di un altro
 * tenant semplicemente non trova niente e la funzione esce senza scrivere.
 */
async function registraEsitoInvio(
  tenantId: string,
  comunicazioneId: string | undefined,
  esito: { stato: 'inviato' | 'non-inviato'; errore?: string; providerId?: string },
): Promise<void> {
  if (!comunicazioneId) return;
  try {
    const riga = await prisma.comunicazioneProgetto.findFirst({
      where: { id: comunicazioneId, tenantId },
      select: { id: true, externalId: true },
    });
    if (!riga) return;
    await prisma.comunicazioneProgetto.update({
      where: { id: riga.id },
      data: {
        externalId: conStatoComunicazione(riga.externalId, {
          stato: esito.stato,
          // `errore: null` sul riuscito: se un primo tentativo era fallito e il secondo no, il
          // motivo vecchio non deve restare appeso a un messaggio che è partito.
          errore: esito.stato === 'inviato' ? null : esito.errore || 'motivo non riportato',
          ...(esito.stato === 'inviato' ? { inviatoAt: new Date().toISOString() } : {}),
          // Il `wamid` di Meta, quando il canale lo restituisce. Senza, la ricevuta di consegna
          // che arriverà dopo non ha una chiave con cui ritrovare questa riga.
          ...(esito.providerId ? { providerId: esito.providerId } : {}),
        }),
      },
    });
  } catch {
    // Fascicolo non aggiornabile (riga sparita, contesto assente): l'invio resta quello che è, e
    // l'operatore ha già davanti il riscontro. Non si trasforma in un errore di invio.
  }
}

/**
 * Rifiuta una richiesta di invio **e** lo annota sul fascicolo.
 *
 * Le tre rotte di dispatch rifiutano tutte nella stessa forma — 400 con `{ ok:false, errore }` —
 * e il motivo è già scritto per l'operatore: qui viaggia anche verso la riga, così la chat non
 * continua a mostrare un messaggio in attesa che non partirà mai. Il rifiuto per richiesta non
 * valida (destinatario vuoto, numero senza prefisso) conta quanto quello del canale: la riga è
 * già stata creata e va detto che è ferma.
 */
async function rifiutaInvio(
  tenantId: string,
  comunicazioneId: string | undefined,
  reply: FastifyReply,
  errore: string,
) {
  await registraEsitoInvio(tenantId, comunicazioneId, { stato: 'non-inviato', errore });
  return reply.code(400).send({ ok: false, errore });
}

export async function registraRotteComunicazioni(server: FastifyInstance): Promise<void> {
  // §06 (decisione titolare 27/09, estesa il 09/10/2026) — chi può usare i canali dello studio lo
  // decide l'admin del tenant tramite la Matrice Permessi (modulo `communications`): l'enforcement è
  // nell'hook onRequest (rbacModuli), non qui. Un collaboratore interno o esterno con `write` invia
  // e legge, `read` legge soltanto (l'invio è 403), `denied` non vede nient'altro, nessuna riga =
  // default per ruolo. Fino al 09/10/2026 la matrice copriva le sole rotte di INVIO: la lettura
  // della casella e dei fascicoli restava libera (voce 4 del piano di miglioramento), e un
  // collaboratore a cui era stata negata la scrittura leggeva comunque la corrispondenza dei
  // clienti. Qui resta l'AUDIT: ogni dispatch lascia traccia (mittente,
  // canale, destinatario), così un invio con `comunicazioneId` omesso non è senza traccia forense.
  const auditDispatch = async (req: FastifyRequest, canale: string, destinatario: string, esito: string) => {
    await recordAudit({
      tenantId: req.tenantId, userId: req.userId, ruolo: req.ruolo,
      azione: 'COMUNICAZIONE_INVIATA', entita: `Canale ${canale}`,
      dettagli: `${canale} → ${destinatario} · ${esito}`, ipAddress: req.ip,
    });
  };

  /**
   * Email al cliente con le credenziali dello studio.
   *
   * Il corpo non contiene più nulla di segreto: destinatario, oggetto e testo. Host, utenza e
   * password li mette il server leggendo il tenant della richiesta.
   */
  server.post<{
    Body: {
      to?: string;
      subject?: string;
      testo?: string;
      text?: string;
      html?: string;
      etichetta?: string;
      /** Riga del fascicolo a cui l'esito va riferito: la crea il fascicolo, prima di chiamare qui. */
      comunicazioneId?: string;
    };
  }>('/comunicazioni/invia-email', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const body = req.body || {};
    const comunicazioneId = body.comunicazioneId;

    const destinatario = (body.to || '').trim();
    if (!destinatario || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, 'Destinatario assente o non valido.');
    }

    const oggetto = (body.subject || '').trim();
    if (!oggetto) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, "L'oggetto del messaggio è obbligatorio.");
    }

    const testo = (body.testo ?? body.text ?? '').toString();
    const html = (body.html || '').trim() || (testo.trim() ? testoInHtml(testo) : '');
    if (!html) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, 'Nessun contenuto da spedire.');
    }

    const cred = await credenzialiCanali(tenantId);
    if (!cred.smtp.host || !cred.smtp.user) {
      return rifiutaInvio(
        tenantId,
        comunicazioneId,
        reply,
        'Posta in uscita non configurata: mancano host o utenza SMTP nelle impostazioni dello studio.',
      );
    }

    const esito = await inviaEmail({
      to: destinatario,
      subject: oggetto,
      html,
      smtp: cred.smtp,
      fromEmail: cred.smtpFromEmail ?? undefined,
      fromName: cred.smtpFromName ?? undefined,
      etichetta: body.etichetta || 'comunicazione',
    });

    if (!esito.ok) {
      // Il motivo tecnico va riportato: «porta bloccata dall'hosting» e «password sbagliata»
      // si correggono in due posti diversi, e un messaggio generico fa perdere ore.
      return rifiutaInvio(tenantId, comunicazioneId, reply, esito.errore || 'Invio non riuscito.');
    }
    await registraEsitoInvio(tenantId, comunicazioneId, { stato: 'inviato' });
    await auditDispatch(req, 'email', destinatario, `inviato (${esito.via})`);
    return reply.send({ ok: true, via: esito.via });
  });

  /**
   * Messaggio WhatsApp con il numero dello studio.
   *
   * `template` serve fuori dalla finestra di 24 ore di WhatsApp; il testo libero dentro. Non
   * c'è nessun ripiego automatico su `hello_world`: al cliente arriverebbe «Hello World» e
   * all'operatore un successo (era il comportamento di `api/send-whatsapp.ts`).
   */
  server.post<{
    Body: {
      to?: string;
      testo?: string;
      text?: string;
      template?: string;
      templateName?: string;
      lingua?: string;
      parametri?: string[];
      comunicazioneId?: string;
    };
  }>('/comunicazioni/invia-whatsapp', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const body = req.body || {};
    const comunicazioneId = body.comunicazioneId;

    const numero = (body.to || '').trim();
    if (!numero) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, 'Numero del destinatario assente.');
    }

    const cred = await credenzialiCanali(tenantId);
    const template = (body.template || body.templateName || '').trim();
    const testo = (body.testo ?? body.text ?? '').toString();

    const esito = template
      ? await inviaTemplateWhatsapp(cred, numero, template, body.lingua || 'it', Array.isArray(body.parametri) ? body.parametri : [])
      : await inviaTestoWhatsapp(cred, numero, testo);

    if (!esito.ok) {
      // Qui passa il rifiuto di Meta — numero non registrato, finestra di 24 ore chiusa, template
      // inesistente: è il motivo che finora non arrivava mai al fascicolo, che restava «consegnato».
      return rifiutaInvio(tenantId, comunicazioneId, reply, esito.errore || 'Invio WhatsApp non riuscito.');
    }
    // `inviato`, non `consegnato`: Meta ha accettato il messaggio, la consegna al telefono la
    // dichiara solo il webhook di stato, con il suo `consegnatoAt`. Sono due cose diverse.
    // Il `wamid` di Meta si deposita qui: è la chiave con cui quella ricevuta ritroverà la riga.
    await registraEsitoInvio(tenantId, comunicazioneId, { stato: 'inviato', providerId: esito.providerId });
    await auditDispatch(req, 'whatsapp', numero, 'inviato');
    return reply.send({ ok: true, via: template ? `template ${template}` : 'testo' });
  });

  /**
   * Messaggio Signal con il numero dello studio.
   *
   * Questa rotta mancava, e la sua assenza era il guasto più visibile di tutti: `ComunicazioniTab`
   * offre Signal fra i canali della chat, e scegliendolo il messaggio veniva registrato nel
   * fascicolo e poi il riscontro diceva «Messaggio registrato e notificato via SIGNAL al
   * cliente!» — mentre nessuna riga di codice contattava un demone. Il cliente non riceveva
   * nulla e l'operatore credeva di averglielo mandato (regola 7).
   *
   * Gli allegati viaggiano nel corpo, in base64, perché Signal li recapita: è l'unico dei tre
   * canali di messaggistica che accetta un documento senza template né finestre di 24 ore, ed è
   * il motivo per cui uno studio lo sceglie per un cliente riservato. Il tetto è quello del
   * Vault (15 MB per file) e viene controllato **prima** di contattare il demone: un 45 MiB di
   * `bodyLimit` non è una dimensione che si spedisce a un telefono.
   */
  server.post<{
    Body: {
      to?: string;
      testo?: string;
      text?: string;
      allegati?: Array<{ nome?: string; base64?: string }>;
      comunicazioneId?: string;
    };
  }>('/comunicazioni/invia-signal', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const body = req.body || {};
    const comunicazioneId = body.comunicazioneId;

    const destinatario = (body.to || '').trim();
    if (!destinatario) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, 'Numero Signal del destinatario assente.');
    }
    // Il numero si valida qui e non si normalizza in silenzio: `+3351234567` è un numero
    // francese, e un destinatario scritto senza prefisso diventerebbe quello di un estraneo.
    if (!numeroSignal(destinatario)) {
      return rifiutaInvio(
        tenantId,
        comunicazioneId,
        reply,
        'Il numero Signal del destinatario non è in forma internazionale: serve il prefisso, per esempio +393351234567.',
      );
    }

    const testo = (body.testo ?? body.text ?? '').toString();
    const allegati = (Array.isArray(body.allegati) ? body.allegati : [])
      .map(a => ({ nome: String(a?.nome ?? '').trim() || 'allegato', base64: String(a?.base64 ?? '') }))
      .filter(a => a.base64.length > 0);

    if (!testo.trim() && allegati.length === 0) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, 'Nessun contenuto da spedire.');
    }

    const MAX_BYTES = 15 * 1024 * 1024;
    // Il base64 gonfia di un terzo: si misura il peso decodificato, che è quello del file.
    const pesoStimato = allegati.reduce((somma, a) => somma + Math.floor((a.base64.length * 3) / 4), 0);
    if (pesoStimato > MAX_BYTES) {
      return rifiutaInvio(
        tenantId,
        comunicazioneId,
        reply,
        'Allegato troppo grande per Signal (oltre 15 MB): caricalo nel Vault del fascicolo e invia al cliente il collegamento.',
      );
    }

    const cred = await credenzialiCanali(tenantId);
    const esito = allegati.length > 0
      ? await inviaSignalConAllegati(cred, destinatario, testo, allegati)
      : await inviaSignal(cred, destinatario, testo);

    if (!esito.ok) {
      return rifiutaInvio(tenantId, comunicazioneId, reply, esito.errore || 'Invio Signal non riuscito.');
    }
    await registraEsitoInvio(tenantId, comunicazioneId, { stato: 'inviato' });
    await auditDispatch(req, 'signal', destinatario, 'inviato');
    return reply.send({ ok: true, via: allegati.length > 0 ? 'testo e allegati' : 'testo' });
  });

  /**
   * Messaggio Telegram con il bot dello studio.
   *
   * Mancava anche questa, e anche qui la chat del fascicolo ci suppliva con un riscontro verde:
   * «notificato via TELEGRAM al cliente» senza che partisse niente. La chiamata era privata
   * dentro `otpDispatch.ts`, quindi non raggiungibile da qui: ora sta in `telegramService.ts`.
   *
   * Il destinatario è l'identificativo numerico della chat, non un `@nomeutente`: Telegram
   * accetta il nome solo per i canali pubblici, e per un cliente il valore giusto è quello che
   * il bot riceve quando la persona gli scrive. Se in anagrafica c'è altro, si dice.
   */
  server.post<{ Body: { to?: string; testo?: string; text?: string; comunicazioneId?: string } }>(
    '/comunicazioni/invia-telegram',
    async (req, reply) => {
      const tenantId = req.tenantId as string;
      const body = req.body || {};
      const comunicazioneId = body.comunicazioneId;

      const chatId = (body.to || '').trim();
      if (!chatId) {
        return rifiutaInvio(tenantId, comunicazioneId, reply, 'Chat Telegram del destinatario assente.');
      }

      const testo = (body.testo ?? body.text ?? '').toString();
      if (!testo.trim()) {
        return rifiutaInvio(tenantId, comunicazioneId, reply, 'Nessun contenuto da spedire.');
      }

      const cred = await credenzialiCanali(tenantId);
      const esito = await inviaTestoTelegram(cred, chatId, testo);
      if (!esito.ok) {
        return rifiutaInvio(tenantId, comunicazioneId, reply, esito.errore || 'Invio Telegram non riuscito.');
      }
      await registraEsitoInvio(tenantId, comunicazioneId, { stato: 'inviato' });
      await auditDispatch(req, 'telegram', chatId, 'inviato');
      return reply.send({ ok: true, via: 'testo' });
    },
  );

  /**
   * Ultimi messaggi arrivati nella casella dello studio, filtrati sul mittente quando serve.
   *
   * È un POST e non un GET perché l'indirizzo del cliente sta nel corpo invece che nell'URL:
   * i percorsi finiscono nei log dei proxy, gli indirizzi dei clienti no.
   */
  server.post<{ Body: { clientEmail?: string; limite?: number } }>(
    '/comunicazioni/email-in-arrivo',
    async (req, reply) => {
      const tenantId = req.tenantId as string;
      const body = req.body || {};

      const imap = await credenzialiImap(tenantId);
      const esito = await leggiPostaInArrivo(imap, {
        clientEmail: (body.clientEmail || '').trim() || undefined,
        limite: Number(body.limite) || undefined,
      });

      if (!esito.ok) {
        // 400 e non 200 con lista vuota: «la casella non è configurata» e «il cliente non ha
        // risposto» sono due cose diverse, e il fascicolo mostrava la prima come la seconda.
        return reply.code(400).send({ ok: false, email: [], errore: esito.errore });
      }
      return reply.send({ ok: true, email: esito.email, via: esito.via });
    },
  );

  /**
   * Legge le ultime email con allegati via `imapflow` e li carica su storage.
   *
   * Rotta separata da `email-in-arrivo` perché il download allegati è pesante (fino a 15 MB
   * per file, fino a 5 email) e non deve rallentare il polling del testo semplice. Il
   * frontend la chiama solo quando l'operatore preme «Sincronizza allegati email»: non è
   * automatica ogni 60 secondi come il polling del testo.
   *
   * La risposta include gli URL firmati già pronti da mostrare in `ComunicazioniTab.tsx`
   * nel blocco allegati della timeline (righe 581-620): nessuna logica aggiuntiva lato
   * client necessaria.
   *
   * Il parser grezzo di `imapInbound.ts` non viene modificato: continua a gestire il
   * testo semplice senza regressioni.
   */
  server.post<{ Body: { clientEmail?: string; limite?: number } }>(
    '/comunicazioni/poll-imap-allegati',
    async (req, reply) => {
      const tenantId = req.tenantId as string;
      const body = req.body || {};

      const imap = await credenzialiImap(tenantId);
      const esito = await leggiAllegatiImap(imap, {
        clientEmail: (body.clientEmail || '').trim() || undefined,
        limite: Number(body.limite) || undefined,
        // Il tenant entra nel nome file caricato: è la chiave che `GET /uploads` usa per
        // non servire a uno studio gli allegati della casella di un altro.
        tenantId,
      });

      if (!esito.ok) {
        return reply.code(400).send({ ok: false, email: [], errore: esito.errore });
      }
      return reply.send({ ok: true, email: esito.email });
    },
  );

  /**
   * Preleva i messaggi Signal arrivati al demone dello studio e li registra nei fascicoli.
   *
   * Perché una rotta e non un webhook: Signal non ha un servizio centrale che chiami questa
   * piattaforma — il demone `signal-cli-rest-api` è dello studio e la coda resta dentro di lui.
   * Il cron notturno la preleva come rete di sicurezza, ma un giro al giorno è troppo lento per
   * una chat che l'operatore sta guardando: questa rotta è la stessa cosa su richiesta, come
   * `email-in-arrivo` per la posta, e il frontend la chiama quando l'operatore apre il fascicolo
   * o preme «Sincronizza».
   *
   * **La lettura è distruttiva** (`GET /v1/receive/{number}` toglie i messaggi dalla coda del
   * demone): chi legge ha una sola occasione, quindi la scrittura avviene subito e l'idempotenza
   * su `webhook_inbox` protegge dalle riletture — non dalla perdita. È detto qui perché è la
   * differenza vera rispetto a WhatsApp e Telegram, che ricevono una chiamata e vengono
   * ritentati finché non rispondono 200.
   *
   * 400 e non 200 quando il canale non è configurato: «Signal non è impostato» e «il cliente non
   * ha scritto» sono due cose diverse, e presentare la prima come la seconda è l'errore che
   * teneva nascosto il guasto del canale email.
   */
  server.post('/comunicazioni/signal-in-arrivo', async (req, reply) => {
    const tenantId = req.tenantId as string;

    const esito = await riceviMessaggiSignal(tenantId);
    if (esito.nonConfigurato) {
      return reply.code(400).send({
        ok: false,
        errore:
          'Signal non è configurato per questo studio: servono l\'indirizzo del demone e il numero registrato (Impostazioni → Canali).',
        letti: 0,
        registrati: 0,
        scartati: 0,
      });
    }
    if (esito.errore) {
      return reply.code(400).send({ ok: false, errore: esito.errore, letti: esito.letti, registrati: esito.registrati, scartati: esito.scartati });
    }
    return reply.send({ ok: true, ...esito });
  });
}
