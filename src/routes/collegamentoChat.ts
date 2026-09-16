/**
 * Il link con cui un cliente collega la propria chat Telegram a una pratica.
 *
 * Perché esiste. L'instradamento dei messaggi in ingresso è un'euristica: il `chat_id` dev'essere in
 * una sola scheda cliente **e** quel cliente deve avere un solo progetto aperto. Quando una delle
 * due condizioni cade — un cliente con due pratiche aperte, una persona che scrive per due clienti —
 * il messaggio non può entrare in nessun fascicolo. Non è un difetto della prudenza: mancava il modo
 * per cui il cliente **dice lui** a quale pratica si riferisce. Questo è quel modo.
 *
 * Il link si compone qui e non nel browser per una ragione sola, che è la regola 6: il payload è
 * firmato con `TELEGRAM_WEBHOOK_SECRET`, e quel segreto non esce dal backend. Al browser torna il
 * link già composto — che è una capacità, non un segreto: chi ce l'ha può agganciare una chat a
 * quella pratica, e la revoca è lo scollegamento (`DELETE /progetti/:id/collegamenti/:id`).
 *
 * Il link si può copiare e spedire, oppure far spedire allo studio via email o WhatsApp. Le
 * credenziali sono quelle dello studio (`credenzialiCanali`), mai quelle della piattaforma: uno
 * studio senza posta configurata riceve «non configurata», non un invio a nome di un altro.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { credenzialiCanali, recapitiCliente } from '../services/otpDispatch.js';
import { inviaEmail } from '../services/emailRelay.js';
import { inviaTestoWhatsapp } from '../services/whatsappService.js';
import { urlCollegamentoTelegram, usernameBotUsabile } from '../services/telegramService.js';
import { creaPayloadCollegamento } from '../util/webhookSecurity.js';
import { elencaCollegamentiProgetto, scollegaPerId } from '../services/collegamentoChat.js';
import { recordAudit } from '../util/serverHelpers.js';
import { testoInHtml } from '../util/testoInHtml.js';

/** I canali su cui l'invito può partire. Il link si copia sempre, qualunque sia il canale. */
const CANALI_INVIO = ['email', 'whatsapp'] as const;
type CanaleInvio = (typeof CANALI_INVIO)[number];

interface LinkPronto {
  url: string;
  botUsername: string;
}

/**
 * Il link per una pratica, o il motivo per cui non si compone.
 *
 * Tre modi distinti di non farcela, e vanno tenuti distinti perché i rimedi sono diversi: il bot
 * dello studio non è configurato (Impostazioni → Canali), lo `@username` non è ancora noto perché
 * `setWebhook` non è mai stato eseguito, oppure il campo contiene un valore che non è uno username —
 * l'id numerico del bot, tipicamente. Il secondo si risolve premendo «Registra webhook» nella scheda
 * Telegram; il terzo pure, perché quella rotta rilegge lo username da Telegram e corregge il campo.
 * Dirgli quale dei tre è più utile che rispondere «non configurato» a tutti e tre.
 *
 * L'ultimo caso non è teorico: il campo `tgBotUsername` dello studio conteneva l'id numerico del
 * bot — non lo username — e il link composto apriva «questo utente non esiste» sul telefono del
 * cliente. Prima di questa distinzione la rotta avrebbe detto «manca lo @username»: falso, il campo
 * era pieno, e il rimedio indicato sarebbe stato inutile.
 */
async function componiLink(
  tenantId: string,
  progettoId: string,
): Promise<{ ok: true; link: LinkPronto } | { ok: false; stato: number; errore: string }> {
  const masterSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!masterSecret) {
    return {
      ok: false,
      stato: 503,
      errore: 'TELEGRAM_WEBHOOK_SECRET non configurato: il link si firma con quel segreto.',
    };
  }

  const cred = await credenzialiCanali(tenantId);
  if (!cred.tgBotToken?.trim()) {
    return {
      ok: false,
      stato: 400,
      errore: 'Il bot Telegram dello studio non è configurato: salva il Bot Token in Impostazioni → Canali.',
    };
  }

  // `usernameBotUsabile` e non un semplice `if (!username)`: il valore presente ma sbagliato (l'id
  // del bot) e il valore assente hanno rimedi diversi, e solo la funzione li sa distinguere.
  const bot = usernameBotUsabile(cred.tgBotUsername);
  if (!bot.ok) return { ok: false, stato: 400, errore: bot.errore };

  const url = urlCollegamentoTelegram(
    bot.username,
    creaPayloadCollegamento(tenantId, progettoId, masterSecret),
  );
  if (!url) {
    return {
      ok: false,
      stato: 400,
      errore: 'Il link non si compone: lo username del bot non è utilizzabile in un indirizzo.',
    };
  }
  return { ok: true, link: { url, botUsername: bot.username } };
}

/**
 * La pratica con il suo cliente, o `null` se non è di questo studio.
 *
 * Il filtro sul tenant è applicativo **e** RLS lo impone; qui serve anche al messaggio d'errore, che
 * deve poter dire «non trovata» senza distinguere fra «non esiste» e «è di un altro studio».
 *
 * `referentiJson` è nel `select` perché il recapito del cliente può stare **solo** lì: le anagrafiche
 * create dal seed e dalle versioni precedenti hanno l'indirizzo dentro il JSON e la colonna vuota, ed
 * è il guasto per cui «il codice OTP non arriva via mail» (vedi `recapitiCliente`). Leggendo la sola
 * colonna, l'invito direbbe «il cliente non ha email in anagrafica» a un cliente che ce l'ha.
 */
async function praticaConCliente(tenantId: string, progettoId: string) {
  return prisma.progetto.findFirst({
    where: { id: progettoId, tenantId },
    select: {
      id: true,
      nome: true,
      cliente: {
        select: { id: true, nome: true, email: true, cellulare: true, referentiJson: true },
      },
    },
  });
}

function testoInvito(nomeStudio: string, nomeCliente: string, nomePratica: string, url: string): string {
  return `Gentile ${nomeCliente},

per far arrivare i suoi messaggi Telegram direttamente nel fascicolo della pratica «${nomePratica}», `
    + `apra questo collegamento e premi Avvio:

${url}

Da quel momento i messaggi che scriverà a quel bot entreranno nella pratica, senza che debba `
    + `indicare ogni volta di quale pratica si tratta.

${nomeStudio}`;
}

export async function registraRotteCollegamentoChat(server: FastifyInstance): Promise<void> {
  /**
   * Il link per collegare una chat alla pratica, da copiare e mandare al cliente.
   *
   * Apre il link solo chi ha già accesso alla pratica: è la stessa condizione con cui vede il
   * fascicolo, e non aggiunge una superficie di esposizione nuova.
   */
  server.get<{ Params: { id: string } }>('/progetti/:id/link-telegram', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const pratica = await praticaConCliente(tenantId, id);
    if (!pratica) return reply.code(404).send({ errore: 'Pratica non trovata in questo studio.' });

    const esito = await componiLink(tenantId, id);
    if (!esito.ok) return reply.code(esito.stato).send({ errore: esito.errore });
    return reply.send({ ok: true, url: esito.link.url, botUsername: esito.link.botUsername });
  });

  /**
   * Spedisce l'invito al cliente, via email o WhatsApp.
   *
   * La spedizione **rientra nel fascicolo**: si scrive la riga in `comunicazione_progetto` con
   * `direzione: 'uscita'`. Un invito mandato a un cliente è una comunicazione con quel cliente, e la
   * regola 3 non ammette che viva solo nella testata dell'interfaccia: chi apre la pratica domani
   * deve poter vedere che quel link è stato mandato, a chi e quando.
   *
   * Un invio non riuscito risponde 400 con il motivo tecnico di Meta o dell'SMTP e **non** scrive
   * niente nel fascicolo: registrare una comunicazione che non è partita renderebbe il fascicolo una
   * fonte che mente (regola 7).
   */
  server.post<{ Params: { id: string }; Body: { canale?: string } }>(
    '/progetti/:id/link-telegram/invia',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { id } = req.params;

      const canale = String(req.body?.canale ?? '').trim() as CanaleInvio;
      if (!CANALI_INVIO.includes(canale)) {
        return reply.code(400).send({ errore: 'Canale non previsto: si può spedire via email o via WhatsApp.' });
      }

      const pratica = await praticaConCliente(tenantId, id);
      if (!pratica) return reply.code(404).send({ errore: 'Pratica non trovata in questo studio.' });

      const esitoLink = await componiLink(tenantId, id);
      if (!esitoLink.ok) return reply.code(esitoLink.stato).send({ errore: esitoLink.errore });

      const recapiti = recapitiCliente(pratica.cliente);
      const destinatario = canale === 'email' ? recapiti.email : recapiti.cellulare;
      if (!destinatario || (canale === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario))) {
        return reply.code(400).send({
          errore: canale === 'email'
            ? 'Il cliente non ha un indirizzo email utilizzabile in anagrafica: aggiungilo, oppure copia il link e mandaglielo tu.'
            : 'Il cliente non ha un cellulare in anagrafica: aggiungilo, oppure copia il link e mandaglielo tu.',
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { ragioneSociale: true },
      });
      const testo = testoInvito(
        tenant?.ragioneSociale?.trim() || 'Lo studio',
        pratica.cliente.nome,
        pratica.nome,
        esitoLink.link.url,
      );

      const cred = await credenzialiCanali(tenantId);
      let via: string;
      if (canale === 'email') {
        if (!cred.smtp.host || !cred.smtp.user) {
          return reply.code(400).send({
            errore: 'Posta in uscita non configurata: mancano host o utenza SMTP in Impostazioni → Canali.',
          });
        }
        const invio = await inviaEmail({
          to: destinatario,
          subject: `Collega Telegram alla pratica «${pratica.nome}»`,
          html: testoInHtml(testo),
          smtp: cred.smtp,
          fromEmail: cred.smtpFromEmail ?? undefined,
          fromName: cred.smtpFromName ?? undefined,
          etichetta: 'invito-telegram',
        });
        if (!invio.ok) return reply.code(400).send({ errore: invio.errore || 'Invio email non riuscito.' });
        via = invio.via ?? 'smtp';
      } else {
        // WhatsApp recapita il testo libero solo dentro la finestra di 24 ore: a un cliente che non
        // ha mai scritto allo studio, Meta rifiuta e quel rifiuto va riportato com'è. Il link resta
        // copiabile, e per email non c'è questo limite.
        const invio = await inviaTestoWhatsapp(cred, destinatario, testo);
        if (!invio.ok) return reply.code(400).send({ errore: invio.errore || 'Invio WhatsApp non riuscito.' });
        via = 'whatsapp';
      }

      await prisma.comunicazioneProgetto.create({
        data: {
          tenantId,
          progettoId: pratica.id,
          canale,
          direzione: 'uscita',
          mittente: tenant?.ragioneSociale?.trim() || 'Studio',
          destinatario,
          testo,
        },
      });

      await recordAudit({
        tenantId,
        userId: req.user?.userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo as string | undefined,
        azione: 'LINK_TELEGRAM_INVIATO',
        entita: 'Progetto',
        dettagli: `Invito a collegare la chat Telegram inviato via ${canale} a ${destinatario} per la pratica ${pratica.id}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, via, destinatario });
    },
  );

  /** Le chat collegate alla pratica: chi scrive lì dentro finisce in questo fascicolo. */
  server.get<{ Params: { id: string } }>('/progetti/:id/collegamenti', async (req, reply) => {
    const collegamenti = await elencaCollegamentiProgetto(req.tenantId, req.params.id);
    return reply.send({ ok: true, collegamenti });
  });

  /**
   * Scollega una chat: da quel momento i suoi messaggi non entrano più in questa pratica.
   *
   * È la revoca, e serve davvero. Il link è una capacità senza scadenza — chi lo riceve può
   * agganciare la propria chat a questa pratica — e senza questo tasto lo studio non avrebbe alcun
   * modo di fermare una chat che scrive dove non deve. Il link resta valido, quindi la stessa chat
   * può rientrare toccandolo di nuovo: è voluto, perché il cliente che si è scollegato per sbaglio
   * deve poter rientrare da solo.
   */
  server.delete<{ Params: { id: string; collegamentoId: string } }>(
    '/progetti/:id/collegamenti/:collegamentoId',
    async (req, reply) => {
      const { id, collegamentoId } = req.params;

      const rimosso = await scollegaPerId(req.tenantId, id, collegamentoId);
      if (!rimosso) return reply.code(404).send({ errore: 'Collegamento non trovato per questa pratica.' });

      await recordAudit({
        tenantId: req.tenantId,
        userId: req.user?.userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo as string | undefined,
        azione: 'COLLEGAMENTO_CHAT_REVOCATO',
        entita: 'Progetto',
        dettagli: `Collegamento ${collegamentoId} revocato dalla pratica ${id}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true });
    },
  );
}
