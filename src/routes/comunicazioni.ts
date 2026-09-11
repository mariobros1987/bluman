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

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { inviaEmail } from '../services/emailRelay.js';
import { credenzialiCanali } from '../services/otpDispatch.js';
import { inviaTestoWhatsapp, inviaTemplateWhatsapp } from '../services/whatsappService.js';
import { leggiPostaInArrivo, type CredenzialiImap } from '../services/imapInbound.js';
import { leggiAllegatiImap } from '../services/imapflowAllegati.js';

/** Il testo battuto dall'operatore diventa HTML senza che `<` o `&` rompano il messaggio. */
function testoInHtml(testo: string): string {
  const protetto = testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;white-space:pre-wrap">${protetto}</div>`;
}

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

export async function registraRotteComunicazioni(server: FastifyInstance): Promise<void> {
  /**
   * Email al cliente con le credenziali dello studio.
   *
   * Il corpo non contiene più nulla di segreto: destinatario, oggetto e testo. Host, utenza e
   * password li mette il server leggendo il tenant della richiesta.
   */
  server.post<{
    Body: { to?: string; subject?: string; testo?: string; text?: string; html?: string; etichetta?: string };
  }>('/comunicazioni/invia-email', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const body = req.body || {};

    const destinatario = (body.to || '').trim();
    if (!destinatario || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      return reply.code(400).send({ ok: false, errore: 'Destinatario assente o non valido.' });
    }

    const oggetto = (body.subject || '').trim();
    if (!oggetto) {
      return reply.code(400).send({ ok: false, errore: "L'oggetto del messaggio è obbligatorio." });
    }

    const testo = (body.testo ?? body.text ?? '').toString();
    const html = (body.html || '').trim() || (testo.trim() ? testoInHtml(testo) : '');
    if (!html) {
      return reply.code(400).send({ ok: false, errore: 'Nessun contenuto da spedire.' });
    }

    const cred = await credenzialiCanali(tenantId);
    if (!cred.smtp.host || !cred.smtp.user) {
      return reply.code(400).send({
        ok: false,
        errore: 'Posta in uscita non configurata: mancano host o utenza SMTP nelle impostazioni dello studio.',
      });
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
      return reply.code(400).send({ ok: false, errore: esito.errore || 'Invio non riuscito.' });
    }
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
    Body: { to?: string; testo?: string; text?: string; template?: string; templateName?: string; lingua?: string; parametri?: string[] };
  }>('/comunicazioni/invia-whatsapp', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const body = req.body || {};

    const numero = (body.to || '').trim();
    if (!numero) {
      return reply.code(400).send({ ok: false, errore: 'Numero del destinatario assente.' });
    }

    const cred = await credenzialiCanali(tenantId);
    const template = (body.template || body.templateName || '').trim();
    const testo = (body.testo ?? body.text ?? '').toString();

    const esito = template
      ? await inviaTemplateWhatsapp(cred, numero, template, body.lingua || 'it', Array.isArray(body.parametri) ? body.parametri : [])
      : await inviaTestoWhatsapp(cred, numero, testo);

    if (!esito.ok) {
      return reply.code(400).send({ ok: false, errore: esito.errore || 'Invio WhatsApp non riuscito.' });
    }
    return reply.send({ ok: true, via: template ? `template ${template}` : 'testo' });
  });

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
      });

      if (!esito.ok) {
        return reply.code(400).send({ ok: false, email: [], errore: esito.errore });
      }
      return reply.send({ ok: true, email: esito.email });
    },
  );
}
