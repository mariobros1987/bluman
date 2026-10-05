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
import { creaPayloadCollegamento, creaPayloadMicrovoce } from '../util/webhookSecurity.js';
import { elencaCollegamentiProgetto, scollegaPerId } from '../services/collegamentoChat.js';
import {
  armaContesto,
  disarmaContesto,
  elencaChatDelProgetto,
  elencaContestiProgetto,
  microvoceDiProgetto,
  type ChiArmaContesto,
} from '../services/comunicazioniMicrovoci.js';
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
  microvoceId?: string,
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

  // Con una micro-voce il payload è quello `z…`; senza, resta quello della pratica — e resta
  // **identico**: i link già spediti continuano a funzionare.
  let payload: string;
  if (microvoceId) {
    // La verifica sul progetto è necessaria anche qui e non solo al momento dell'abbinamento: un
    // link composto per una micro-voce di un'altra pratica sarebbe una capacità che apre un
    // fascicolo su una cosa che non gli appartiene.
    const mv = await microvoceDiProgetto(tenantId, microvoceId, progettoId);
    if (!mv) return { ok: false, stato: 404, errore: 'Micro-voce non trovata in questa pratica.' };
    payload = creaPayloadMicrovoce(tenantId, mv.id, masterSecret);
  } else {
    payload = creaPayloadCollegamento(tenantId, progettoId, masterSecret);
  }

  const url = urlCollegamentoTelegram(bot.username, payload);
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

function testoInvito(
  nomeStudio: string,
  nomeCliente: string,
  nomePratica: string,
  url: string,
  nomeMicrovoce?: string,
): string {
  // Con una micro-voce l'invito dice cosa cambia: non solo *dove* entrano i messaggi, ma *di cosa*
  // parlano. Sono due cose diverse, e un invito che promettesse solo la prima manderebbe al cliente
  // un link che si comporta in un modo che nessuno gli ha spiegato.
  const secondoCapoverso = nomeMicrovoce
    ? `Da quel momento i messaggi che scriverà a quel bot entreranno nella pratica e verranno `
      + `abbinati alla voce «${nomeMicrovoce}», senza che debba indicare ogni volta di cosa si tratta.`
    : `Da quel momento i messaggi che scriverà a quel bot entreranno nella pratica, senza che debba `
      + `indicare ogni volta di quale pratica si tratta.`;

  return `Gentile ${nomeCliente},

per far arrivare i suoi messaggi Telegram direttamente nel fascicolo della pratica «${nomePratica}», `
    + `apra questo collegamento e premi Avvio:

${url}

${secondoCapoverso}

${nomeStudio}`;
}

export async function registraRotteCollegamentoChat(server: FastifyInstance): Promise<void> {
  /**
   * Il link per collegare una chat alla pratica, da copiare e mandare al cliente.
   *
   * Apre il link solo chi ha già accesso alla pratica: è la stessa condizione con cui vede il
   * fascicolo, e non aggiunge una superficie di esposizione nuova.
   *
   * Con `?microvoceId=` il link è quello della **micro-voce**: chi lo tocca non solo collega la chat
   * alla pratica, ma dice anche di quale voce sta parlando — è il modo per cui il cliente sceglie la
   * micro-voce esatta senza che nessuno la indovini.
   */
  server.get<{ Params: { id: string }; Querystring: { microvoceId?: string } }>(
    '/progetti/:id/link-telegram',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { id } = req.params;

      const pratica = await praticaConCliente(tenantId, id);
      if (!pratica) return reply.code(404).send({ errore: 'Pratica non trovata in questo studio.' });

      const microvoceId = req.query?.microvoceId?.trim() || undefined;
      const esito = await componiLink(tenantId, id, microvoceId);
      if (!esito.ok) return reply.code(esito.stato).send({ errore: esito.errore });
      return reply.send({
        ok: true,
        url: esito.link.url,
        botUsername: esito.link.botUsername,
        tipo: microvoceId ? 'microvoce' : 'pratica',
      });
    },
  );

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
  server.post<{ Params: { id: string }; Body: { canale?: string; microvoceId?: string } }>(
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

      // `microvoceId` assente = invito alla pratica, come prima. Presente = invito alla voce, e
      // **lo stesso** link che la scheda mostra: se l'invio spedisse il link della pratica mentre
      // sullo schermo c'è quello della voce, il cliente atterrerebbe altrove senza che nessuno
      // se ne accorga — il tipo di divergenza silenziosa fra ciò che si vede e ciò che parte che
      // questa rotta non deve permettere.
      const microvoceId = req.body?.microvoceId?.trim() || undefined;
      const esitoLink = await componiLink(tenantId, id, microvoceId);
      if (!esitoLink.ok) return reply.code(esitoLink.stato).send({ errore: esitoLink.errore });

      // Il nome della voce serve al testo dell'invito, e a questo punto la pratica è già verificata:
      // `componiLink` ha appena rifiutato una voce che non fosse di questa pratica.
      const microvoce = microvoceId ? await microvoceDiProgetto(tenantId, microvoceId, id) : null;

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
        microvoce?.nome,
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
          subject: microvoce
            ? `Collega Telegram alla voce «${microvoce.nome}» della pratica «${pratica.nome}»`
            : `Collega Telegram alla pratica «${pratica.nome}»`,
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
        dettagli: `Invito a collegare la chat Telegram inviato via ${canale} a ${destinatario} per la pratica ${pratica.id}`
          + (microvoce ? ` — link della micro-voce «${microvoce.nome}» (${microvoce.id})` : ''),
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
   * Le chat da cui è arrivato qualcosa in questa pratica, su **tutti** i canali.
   *
   * Diverso da `/collegamenti`, che è solo Telegram: qui c'è qualunque conversazione che abbia
   * lasciato un messaggio nel fascicolo, WhatsApp e Signal compresi. È l'elenco da cui l'operatore
   * sceglie la chat su cui armare una micro-voce — perché per armarla deve poterla nominare, e su
   * WhatsApp e Signal non c'è nessun collegamento che la nomini.
   *
   * `microvoce` è il contesto già armato su quella chat, se c'è: una riga sola per l'interfaccia
   * invece di due elenchi da incrociare nel browser.
   */
  server.get<{ Params: { id: string } }>('/progetti/:id/chat', async (req, reply) => {
    const [chat, contesti] = await Promise.all([
      elencaChatDelProgetto(req.tenantId, req.params.id),
      elencaContestiProgetto(req.tenantId, req.params.id),
    ]);
    const armato = new Map(contesti.map(c => [`${c.canale}\0${c.chatId}`, c]));
    return reply.send({
      ok: true,
      chat: chat.map(c => ({ ...c, contesto: armato.get(`${c.canale}\0${c.chatId}`) ?? null })),
    });
  });

  /**
   * Arma il contesto di una chat dalla scheda: da qui in poi i suoi messaggi si abbinano a questa
   * micro-voce.
   *
   * È la stessa cosa che fa il cliente toccando il link della micro-voce — `armaContesto` è una sola
   * funzione e `armatoDa` dice chi l'ha fatta — ma su un canale dove il link non esiste: WhatsApp e
   * Signal non hanno un modo per il cliente di dire «sto parlando di questa voce», quindi l'unico che
   * può dirlo è l'operatore, guardando la conversazione.
   */
  server.post<{ Params: { id: string }; Body: { canale?: string; chatId?: string; microvoceId?: string } }>(
    '/progetti/:id/contesti-microvoce',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const canale = String(req.body?.canale ?? '').trim();
      const chatId = String(req.body?.chatId ?? '').trim();
      const microvoceId = String(req.body?.microvoceId ?? '').trim();
      if (!canale || !chatId || !microvoceId) {
        return reply.code(400).send({ errore: 'Canale, chat e micro-voce sono obbligatori.' });
      }

      // La micro-voce dev'essere **di questa pratica**: senza il controllo, l'identificativo di una
      // voce basterebbe ad armare un contesto che abbina messaggi a un modulo di un'altra pratica.
      const mv = await microvoceDiProgetto(tenantId, microvoceId, id);
      if (!mv) return reply.code(404).send({ errore: 'Micro-voce non trovata in questa pratica.' });

      const armatoDa: ChiArmaContesto = 'operatore';
      const esito = await armaContesto(tenantId, canale, chatId, microvoceId, armatoDa);
      if (!esito.ok) return reply.code(404).send({ errore: 'Micro-voce non trovata in questa pratica.' });

      await recordAudit({
        tenantId,
        userId: req.user?.userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo as string | undefined,
        azione: 'CONTESTO_MICROVOCE_ARMATO',
        entita: 'Progetto',
        dettagli: `Micro-voce «${esito.microvoce.nome}» armata sulla chat ${canale} ${chatId} `
          + `della pratica ${id}, fino al ${esito.scadeAt.toISOString()}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, microvoce: esito.microvoce, scadeAt: esito.scadeAt });
    },
  );

  /**
   * Disarma il contesto di una chat. Da quel momento i suoi messaggi entrano nel fascicolo come
   * sempre, ma senza abbinarsi a nessuna micro-voce.
   *
   * `false` non è un errore: disarmare una chat che non aveva niente armato è il risultato voluto,
   * e rispondere 404 a chi ricarica la pagina lo farebbe credere un guasto. L'audit si scrive solo
   * quando c'era davvero qualcosa da togliere.
   */
  server.delete<{ Params: { id: string }; Querystring: { canale?: string; chatId?: string } }>(
    '/progetti/:id/contesti-microvoce',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const canale = String(req.query?.canale ?? '').trim();
      const chatId = String(req.query?.chatId ?? '').trim();
      if (!canale || !chatId) {
        return reply.code(400).send({ errore: 'Canale e chat sono obbligatori.' });
      }

      // La pratica è nel percorso e va rispettata: il contesto è indicizzato sulla chat, e senza
      // questo controllo l'URL di una pratica permetterebbe di disarmare la chat di un'altra.
      const contesti = await elencaContestiProgetto(tenantId, req.params.id);
      if (!contesti.some(c => c.canale === canale && c.chatId === chatId)) {
        return reply.send({ ok: true, disarmato: false });
      }

      const disarmato = await disarmaContesto(tenantId, canale, chatId);
      if (disarmato) {
        await recordAudit({
          tenantId,
          userId: req.user?.userId,
          userEmail: req.user?.email,
          ruolo: req.ruolo as string | undefined,
          azione: 'CONTESTO_MICROVOCE_DISARMATO',
          entita: 'Progetto',
          dettagli: `Contesto micro-voce disarmato sulla chat ${canale} ${chatId} della pratica ${req.params.id}`,
          ipAddress: req.ip,
        });
      }
      return reply.send({ ok: true, disarmato });
    },
  );

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

      const esito = await scollegaPerId(req.tenantId, id, collegamentoId);
      if (!esito.rimosso) return reply.code(404).send({ errore: 'Collegamento non trovato per questa pratica.' });

      await recordAudit({
        tenantId: req.tenantId,
        userId: req.user?.userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo as string | undefined,
        azione: 'COLLEGAMENTO_CHAT_REVOCATO',
        entita: 'Progetto',
        // Il contesto micro-voce cade con il collegamento: se non lo si scrivesse, un contesto
        // sparito sarebbe indistinguibile da un contesto mai armato.
        dettagli: `Collegamento ${collegamentoId} revocato dalla pratica ${id}`
          + (esito.contestoDisarmato ? ' (contesto micro-voce disarmato)' : ''),
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, contestoDisarmato: esito.contestoDisarmato });
    },
  );
}
