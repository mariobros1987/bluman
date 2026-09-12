/**
 * Consegna del codice OTP sul canale scelto dal firmatario (§1.1).
 *
 * Prima esisteva solo l'email. WhatsApp e Telegram erano voci nell'interfaccia: chi le
 * sceglieva otteneva un codice generato, un `console.log` sul server e nessun messaggio.
 * Il portale mostrava comunque "codice inviato", quindi il cliente restava ad aspettare
 * un SMS che non esisteva — e la firma non si poteva completare.
 *
 * Regola di questo file: se il canale non è configurato o la consegna fallisce, si
 * risponde `ok: false` con un motivo leggibile. La rotta lo riporta al cliente, che può
 * scegliere un altro canale. Nessuna forma di "spedito" quando non è vero.
 */
import { prisma } from '../util/prismaClient';
import { sendOtpSecurityEmail } from './emailService';
import type { CredenzialiSmtp } from './emailRelay';
import { chiamaGraphWhatsapp } from './whatsappService';
import type { CanaleOtp } from './otpService';
import { TTL_OTP_SECONDI } from './otpService';

export interface EsitoInvio {
  ok: boolean;
  errore?: string;
}

export interface CredenzialiCanali {
  waPhoneId: string | null;
  waAccessToken: string | null;
  tgBotToken: string | null;
  tgBotUsername: string | null;
  // Lo stesso tipo che `inviaEmail` riceve: `servername` compreso. Ricopiarne i campi a mano
  // significava che una colonna aggiunta qui non arrivava all'invio e nessun typecheck lo diceva.
  smtp: CredenzialiSmtp;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
}

/**
 * Credenziali dello studio, con l'ambiente come ripiego.
 *
 * L'ordine è questo e non l'inverso: i campi su `tenant` esistono da tempo e la schermata
 * impostazioni li scrive, ma nessun invio li leggeva — tutto partiva dalle variabili
 * d'ambiente, cioè dall'account di un solo studio per tutti i tenant. Su un'installazione
 * multi-studio è il messaggio di firma di un cliente spedito dal numero di un altro.
 */
export async function credenzialiCanali(tenantId: string): Promise<CredenzialiCanali> {
  let t: any = null;
  try {
    t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        waPhoneId: true,
        waAccessToken: true,
        tgBotToken: true,
        tgBotUsername: true,
        smtpHost: true,
        smtpServername: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        smtpFromEmail: true,
        smtpFromName: true,
      },
    });
  } catch {
    // Il tenant può non essere leggibile (contesto RLS assente in uno script): si ricade
    // sull'ambiente invece di far fallire la spedizione.
  }

  return {
    waPhoneId: t?.waPhoneId || process.env.WA_PHONE_ID || null,
    waAccessToken: t?.waAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || null,
    tgBotToken: t?.tgBotToken || process.env.TELEGRAM_BOT_TOKEN || null,
    tgBotUsername: t?.tgBotUsername || process.env.TELEGRAM_BOT_USERNAME || null,
    smtp: {
      host: t?.smtpHost || undefined,
      servername: t?.smtpServername || undefined,
      port: t?.smtpPort || undefined,
      secure: t?.smtpSecure ?? undefined,
      user: t?.smtpUser || undefined,
      pass: t?.smtpPass || undefined,
    },
    smtpFromEmail: t?.smtpFromEmail || null,
    smtpFromName: t?.smtpFromName || null,
  };
}

export interface RecapitiCliente {
  email: string | null;
  cellulare: string | null;
  telegramChatId: string | null;
}

/**
 * Recapiti su cui consegnare il codice: le colonne dell'anagrafica e, quando sono vuote, il
 * `referentiJson`.
 *
 * Il ripiego non è un vezzo, è il guasto per cui «il codice OTP non arriva via mail». L'indirizzo
 * del cliente sta scritto in due posti: la colonna `cliente.email` e la chiave `email` dentro
 * `referentiJson`, che è quella che la scheda cliente mostra. Le anagrafiche create dal seed o
 * dalle versioni precedenti hanno l'indirizzo solo nel JSON: chi apriva la scheda leggeva
 * l'email giusta, il portale rispondeva «Nessuna email in anagrafica» e non provava nemmeno a
 * spedire. Le impostazioni SMTP erano corrette, il test funzionava, e non c'era nulla da
 * correggere lì. Stessa storia per il cellulare, che le rotte `/clienti` non scrivevano affatto
 * nella colonna: WhatsApp risultava indisponibile per tutti.
 *
 * `telefono` non viene usato come numero WhatsApp: può essere un fisso, e tentare la consegna
 * verso un numero che non riceve messaggi è peggio che dire che il canale non è disponibile.
 */
export function recapitiCliente(cliente: {
  email?: string | null;
  cellulare?: string | null;
  telegramChatId?: string | null;
  referentiJson?: unknown;
}): RecapitiCliente {
  const ref: Record<string, any> =
    cliente.referentiJson && typeof cliente.referentiJson === 'object' && !Array.isArray(cliente.referentiJson)
      ? (cliente.referentiJson as Record<string, any>)
      : {};

  const valore = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 ? s : null;
  };

  return {
    email: valore(cliente.email) ?? valore(ref.email) ?? valore(ref.emailPrincipale),
    cellulare: valore(cliente.cellulare) ?? valore(ref.cellulare) ?? valore(ref.whatsapp),
    telegramChatId: valore(cliente.telegramChatId) ?? valore(ref.telegramChatId),
  };
}

/** Quali canali sono realmente utilizzabili per questo cliente, e perché no quando no. */
export function canaliDisponibili(
  cred: CredenzialiCanali,
  cliente: { cellulare?: string | null; email?: string | null; telegramChatId?: string | null },
): Array<{ canale: CanaleOtp; disponibile: boolean; motivo?: string }> {
  const smtpConfigurato = Boolean((cred.smtp.host || process.env.SMTP_HOST) && (cred.smtp.user || process.env.SMTP_USER));

  return [
    {
      canale: 'whatsapp',
      disponibile: Boolean(cred.waPhoneId && cred.waAccessToken && cliente.cellulare),
      motivo: !cred.waPhoneId || !cred.waAccessToken
        ? 'WhatsApp non configurato nelle impostazioni dello studio'
        : !cliente.cellulare
          ? 'Nessun cellulare in anagrafica'
          : undefined,
    },
    {
      canale: 'email',
      disponibile: Boolean(smtpConfigurato && cliente.email),
      motivo: !smtpConfigurato
        ? 'SMTP non configurato nelle impostazioni dello studio'
        : !cliente.email
          ? 'Nessuna email in anagrafica'
          : undefined,
    },
    {
      canale: 'telegram',
      disponibile: Boolean(cred.tgBotToken && cliente.telegramChatId),
      motivo: !cred.tgBotToken
        ? 'Bot Telegram non configurato nelle impostazioni dello studio'
        : !cliente.telegramChatId
          ? `Il cliente deve prima scrivere al bot${cred.tgBotUsername ? ` @${cred.tgBotUsername}` : ''} per attivare il canale`
          : undefined,
    },
  ];
}

function testoMessaggio(codice: string, oggettoFirma: string, minuti: number): string {
  return (
    `Codice di firma BluMan: ${codice}\n\n` +
    `Serve per firmare ${oggettoFirma}.\n` +
    `Valido ${minuti} ${minuti === 1 ? 'minuto' : 'minuti'}, utilizzabile una sola volta.\n\n` +
    `Non inoltrarlo a nessuno. Se non stai firmando tu, avvisa subito il tuo advisor.`
  );
}

/**
 * Il template di autenticazione approvato su Meta, con la lingua in cui è stato approvato.
 *
 * Serve perché WhatsApp non consegna testo libero a un numero che non ha scritto allo studio
 * nelle ultime 24 ore: Graph accetta la richiesta o la rifiuta con l'errore 131047, e in
 * entrambi i casi il codice non arriva. I template di categoria «Authentication» sono l'unica
 * forma che WhatsApp recapita sempre, e in più il destinatario vede un pulsante «Copia
 * codice» invece di dover selezionare sei cifre dentro un messaggio.
 */
function templateAutenticazione(): { nome: string; lingua: string } | null {
  const nome = process.env.WA_OTP_TEMPLATE?.trim();
  if (!nome) return null;
  return { nome, lingua: process.env.WA_OTP_TEMPLATE_LANG?.trim() || 'it' };
}

// `chiamaGraph` viveva qui: ora è `chiamaGraphWhatsapp` in `whatsappService.ts`, perché la
// stessa chiamata serve anche alle comunicazioni del fascicolo e alle credenziali del portale.
// Tre copie divergenti della stessa richiesta a Meta erano il motivo per cui l'OTP partiva col
// numero dello studio giusto e le comunicazioni con quello scritto nelle variabili d'ambiente.

async function inviaWhatsapp(
  cred: CredenzialiCanali,
  numero: string,
  codice: string,
  testo: string,
): Promise<EsitoInvio> {
  if (!cred.waPhoneId || !cred.waAccessToken) {
    return { ok: false, errore: 'WhatsApp non è configurato nelle impostazioni dello studio.' };
  }

  // Graph vuole il numero in cifre, senza + né spazi: la stessa normalizzazione della
  // rotta di invio messaggi già esistente.
  const destinatario = numero.replace(/[^\d]/g, '');
  if (destinatario.length < 8) {
    return { ok: false, errore: 'Il numero di cellulare in anagrafica non è utilizzabile.' };
  }

  const motivi: string[] = [];
  const template = templateAutenticazione();

  if (template) {
    try {
      // Il codice compare due volte per costruzione del formato: una nel corpo del messaggio
      // e una come valore del pulsante «Copia codice». È lo stesso codice, non due invii.
      const esito = await chiamaGraphWhatsapp(cred, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destinatario,
        type: 'template',
        template: {
          name: template.nome,
          language: { code: template.lingua },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: codice }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: codice }] },
          ],
        },
      });
      if (esito.ok) return { ok: true };
      motivi.push(`template «${template.nome}» (${template.lingua}): ${esito.motivo}`);

      // Un template di autenticazione senza pulsante rifiuta il componente `button`. Vale
      // un secondo tentativo con il solo corpo prima di ripiegare sul testo libero.
      const senzaBottone = await chiamaGraphWhatsapp(cred, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destinatario,
        type: 'template',
        template: {
          name: template.nome,
          language: { code: template.lingua },
          components: [{ type: 'body', parameters: [{ type: 'text', text: codice }] }],
        },
      });
      if (senzaBottone.ok) return { ok: true };
      motivi.push(`template senza pulsante: ${senzaBottone.motivo}`);
    } catch (err) {
      motivi.push(`template: ${err instanceof Error ? err.message : 'errore di rete'}`);
    }
  } else {
    motivi.push('nessun template di autenticazione configurato (WA_OTP_TEMPLATE)');
  }

  // Testo libero: funziona solo se il cliente ha scritto allo studio nelle ultime 24 ore.
  // Resta come ultima possibilità perché in quella finestra recapita, ed è meglio di niente
  // finché il template non è approvato.
  try {
    const esito = await chiamaGraphWhatsapp(cred, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: destinatario,
      type: 'text',
      text: { preview_url: false, body: testo },
    });
    if (esito.ok) return { ok: true };
    motivi.push(`testo libero: ${esito.motivo}`);
  } catch (err) {
    motivi.push(`testo libero: ${err instanceof Error ? err.message : 'errore di rete'}`);
  }

  return { ok: false, errore: `WhatsApp non ha accettato l'invio — ${motivi.join('; ')}.` };
}

async function inviaTelegram(cred: CredenzialiCanali, chatId: string, testo: string): Promise<EsitoInvio> {
  if (!cred.tgBotToken) {
    return { ok: false, errore: 'Il bot Telegram non è configurato nelle impostazioni dello studio.' };
  }

  try {
    const risposta = await fetch(`https://api.telegram.org/bot${cred.tgBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: testo, disable_web_page_preview: true }),
    });

    const dettaglio: any = await risposta.json().catch(() => null);
    if (!risposta.ok || dettaglio?.ok === false) {
      const motivo = dettaglio?.description || `HTTP ${risposta.status}`;
      return { ok: false, errore: `Telegram non ha accettato l'invio: ${motivo}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, errore: `Invio Telegram non riuscito: ${err instanceof Error ? err.message : 'errore di rete'}` };
  }
}

export interface RichiestaInvio {
  tenantId: string;
  canale: CanaleOtp;
  /** Recapito già risolto dalla rotta: numero, email o chat id secondo il canale. */
  target: string;
  codice: string;
  nomeFirmatario: string;
  oggettoFirma: string;
  /** Livello di firma (ses, fea, feq): adatta il testo e l'oggetto delle email. */
  livelloFirma?: 'ses' | 'fea' | 'feq';
  /** Credenziali già lette, per non interrogare `tenant` due volte nella stessa richiesta. */
  credenziali?: CredenzialiCanali;
}

export async function inviaCodiceOtp(richiesta: RichiestaInvio): Promise<EsitoInvio> {
  const cred = richiesta.credenziali ?? (await credenzialiCanali(richiesta.tenantId));
  const minuti = Math.round(TTL_OTP_SECONDI / 60);
  const testo = testoMessaggio(richiesta.codice, richiesta.oggettoFirma, minuti);

  switch (richiesta.canale) {
    case 'whatsapp':
      return inviaWhatsapp(cred, richiesta.target, richiesta.codice, testo);

    case 'telegram':
      return inviaTelegram(cred, richiesta.target, testo);

    case 'email': {
      const esito = await sendOtpSecurityEmail(richiesta.target, richiesta.nomeFirmatario, richiesta.codice, {
        smtp: cred.smtp,
        fromEmail: cred.smtpFromEmail ?? undefined,
        fromName: cred.smtpFromName ?? undefined,
        minutiValidita: minuti,
        oggettoFirma: richiesta.oggettoFirma,
        livelloFirma: richiesta.livelloFirma,
      });
      // Il motivo tecnico viene riportato invece del vecchio "controlla la configurazione
      // SMTP": le impostazioni possono essere giuste e l'invio fallire comunque perché
      // l'hosting blocca la porta in uscita, e mandare a rileggere impostazioni corrette
      // fa perdere ore. Qui non c'è nessun segreto: host, porta e codice dell'errore.
      return esito.ok
        ? { ok: true }
        : { ok: false, errore: `Invio email non riuscito — ${esito.errore ?? 'causa non riportata dal server di posta'}.` };
    }

    default:
      // Il tipo lo esclude, ma un body JSON arriva da fuori e può contenere qualunque cosa.
      return { ok: false, errore: 'Canale di invio non supportato.' };
  }
}
