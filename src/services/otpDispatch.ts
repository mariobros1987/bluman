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
  smtp: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
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
      port: t?.smtpPort || undefined,
      secure: t?.smtpSecure ?? undefined,
      user: t?.smtpUser || undefined,
      pass: t?.smtpPass || undefined,
    },
    smtpFromEmail: t?.smtpFromEmail || null,
    smtpFromName: t?.smtpFromName || null,
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

async function inviaWhatsapp(cred: CredenzialiCanali, numero: string, testo: string): Promise<EsitoInvio> {
  if (!cred.waPhoneId || !cred.waAccessToken) {
    return { ok: false, errore: 'WhatsApp non è configurato nelle impostazioni dello studio.' };
  }

  // Graph vuole il numero in cifre, senza + né spazi: la stessa normalizzazione della
  // rotta di invio messaggi già esistente.
  const destinatario = numero.replace(/[^\d]/g, '');
  if (destinatario.length < 8) {
    return { ok: false, errore: 'Il numero di cellulare in anagrafica non è utilizzabile.' };
  }

  try {
    const risposta = await fetch(`https://graph.facebook.com/v21.0/${cred.waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cred.waAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destinatario,
        type: 'text',
        text: { preview_url: false, body: testo },
      }),
    });

    if (!risposta.ok) {
      const dettaglio: any = await risposta.json().catch(() => null);
      // Il messaggio di Graph va riportato: "fuori dalla finestra di 24 ore" e "numero non
      // registrato su WhatsApp" sono due problemi diversi, e il cliente deve sapere quale.
      const motivo = dettaglio?.error?.message || `HTTP ${risposta.status}`;
      return { ok: false, errore: `WhatsApp non ha accettato l'invio: ${motivo}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, errore: `Invio WhatsApp non riuscito: ${err instanceof Error ? err.message : 'errore di rete'}` };
  }
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
  /** Credenziali già lette, per non interrogare `tenant` due volte nella stessa richiesta. */
  credenziali?: CredenzialiCanali;
}

export async function inviaCodiceOtp(richiesta: RichiestaInvio): Promise<EsitoInvio> {
  const cred = richiesta.credenziali ?? (await credenzialiCanali(richiesta.tenantId));
  const minuti = Math.round(TTL_OTP_SECONDI / 60);
  const testo = testoMessaggio(richiesta.codice, richiesta.oggettoFirma, minuti);

  switch (richiesta.canale) {
    case 'whatsapp':
      return inviaWhatsapp(cred, richiesta.target, testo);

    case 'telegram':
      return inviaTelegram(cred, richiesta.target, testo);

    case 'email': {
      const inviata = await sendOtpSecurityEmail(richiesta.target, richiesta.nomeFirmatario, richiesta.codice, {
        smtp: cred.smtp,
        fromEmail: cred.smtpFromEmail ?? undefined,
        fromName: cred.smtpFromName ?? undefined,
        minutiValidita: minuti,
        oggettoFirma: richiesta.oggettoFirma,
      });
      return inviata
        ? { ok: true }
        : { ok: false, errore: "Invio email non riuscito: controlla la configurazione SMTP dello studio." };
    }

    default:
      // Il tipo lo esclude, ma un body JSON arriva da fuori e può contenere qualunque cosa.
      return { ok: false, errore: 'Canale di invio non supportato.' };
  }
}
