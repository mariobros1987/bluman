import tls from 'tls';
import net from 'net';
import { inviaEmail, tlsRejectUnauthorized, type EsitoEmail } from './emailRelay.js';
import { spiegaErrorePosta } from './diagnosiPosta.js';
import {
  risolviEndpointPubblico,
  validaEmail,
  validaHost,
  validaPorta,
  validaServername,
  vietaControlli,
} from '../util/networkPolicy.js';

export type { EsitoEmail } from './emailRelay.js';
export { inviaEmail } from './emailRelay.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface EsitoProvaPosta {
  success: boolean;
  /** Frase pronta per l'interfaccia: cosa è successo e, se è andata male, cosa fare. */
  message: string;
  errore?: string;
  /** Strada che ha funzionato: `relay <url>` oppure `host:porta`. */
  via?: string;
}

/**
 * Prova reale della posta in uscita, sulla strada che percorrono gli invii veri.
 *
 * Questa funzione provava solo l'SMTP diretto: quattordici coppie host/porta aperte a mano,
 * cioè esattamente la strada che la rete in uscita di Railway non lascia percorrere (il
 * perché è documentato in `emailRelay.ts`). Da qui il sintomo riportato dallo studio — «dalle
 * impostazioni neanche il test passa» — su una casella che intanto spediva OTP e Magic Link
 * senza problemi: il test scadeva sulle porte chiuse, gli invii veri passavano dal relay.
 *
 * Cinque di quelle coppie erano poi host di altri: `authsmtp.register.it`,
 * `smtps.register.it`, `mail.register.it`, `mail.bluecode-ltd.com`. Le credenziali di uno
 * studio su Gmail o Microsoft 365 venivano offerte ai server di Register.it, cioè a un
 * provider che con quello studio non ha niente a che vedere: è la stessa correzione già
 * fatta in `api/send-email.ts` (regola 6).
 *
 * Ora la prova chiama `inviaEmail`, l'unico punto di uscita della posta: quello che passa qui
 * è l'invio reale, e quello che non passa dice da dove ha provato e cosa fare.
 */
export async function provaPostaInUscita(options: {
  host?: string;
  /** Nome che il certificato deve attestare, se lo studio lo ha dichiarato. */
  servername?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
  toEmail?: string;
}): Promise<EsitoProvaPosta> {
  const mancanti = [!options.host && 'il server SMTP', !options.user && "l'utenza", !options.pass && 'la password'].filter(Boolean);
  if (mancanti.length > 0) {
    const errore = `Posta in uscita non configurata: ${mancanti.join(', ')} nelle impostazioni dello studio ${mancanti.length > 1 ? 'sono vuoti' : 'è vuoto'}.`;
    return { success: false, message: `❌ ${errore}`, errore };
  }

  let host: string;
  let servername: string;
  let user: string;
  let pass: string;
  let destinatario: string;
  let porta: number;
  let nomeMittente: string;
  let fromEmail: string;
  try {
    host = validaHost(options.host || '', 'Host SMTP');
    servername = options.servername ? validaServername(options.servername) : '';
    user = vietaControlli(options.user || '', 'Utenza SMTP', 254).trim();
    pass = vietaControlli(options.pass || '', 'Password SMTP', 1024);
    porta = validaPorta(options.port ?? 465, 'Porta SMTP');
    destinatario = validaEmail(options.toEmail || user, 'Destinatario');
    fromEmail = validaEmail(options.fromEmail || user, 'Mittente');
    nomeMittente = vietaControlli(options.fromName || '', 'Nome mittente', 200).trim();
  } catch (err) {
    const errore = err instanceof Error ? err.message : 'Configurazione SMTP non valida.';
    return { success: false, message: `❌ ${errore}`, errore };
  }

  const h = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

  const esito = await inviaEmail({
    to: destinatario,
    subject: `Prova di configurazione della posta — ${new Date().toLocaleTimeString('it-IT')}`,
    // Nessun nome di provider e nessun nome di studio cablati nel modello: il messaggio
    // riporta la configurazione che è stata provata, che è l'unica cosa che serve a chi lo
    // riceve per capire se è quella giusta.
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
        <h2 style="margin-top: 0; font-size: 18px;">Prova di configurazione della posta in uscita</h2>
        <p style="line-height: 1.6; color: #475569;">
          Se stai leggendo questo messaggio, la posta in uscita configurata nelle impostazioni dello
          studio funziona: le comunicazioni ai clienti, i codici di firma e i link di accesso al
          portale partono da questa casella.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin: 20px 0; font-size: 13px; color: #475569;">
          <p style="margin: 0 0 6px 0;">Server: <code>${h(host)}:${porta}</code></p>
          ${servername ? `<p style="margin: 0 0 6px 0;">Nome verificato nel certificato: <code>${h(servername)}</code></p>` : ''}
          <p style="margin: 0 0 6px 0;">Utenza: <code>${h(user)}</code></p>
          <p style="margin: 0;">Data della prova: <code>${new Date().toLocaleString('it-IT')}</code></p>
        </div>
      </div>
    `,
    smtp: { host, servername: servername || undefined, port: porta, secure: options.secure ?? porta === 465, user, pass },
    fromEmail,
    fromName: nomeMittente || undefined,
    etichetta: 'prova configurazione',
  });

  if (esito.ok) {
    return {
      success: true,
      via: esito.via,
      message:
        `✓ Messaggio di prova recapitato a ${destinatario}${esito.via ? ` (${esito.via})` : ''}. ` +
        `La posta in uscita dello studio è funzionante.`,
    };
  }

  // `inviaEmail` alla stringa tecnica ha già aggiunto l'istruzione: qui non si riscrive, si
  // riporta. Riformularla significherebbe farne due versioni che divergono.
  const errore = esito.errore || 'invio non riuscito, motivo non riportato dal server';
  return { success: false, errore, message: `❌ Prova non riuscita: ${errore}` };
}

/**
 * Prova reale della casella in arrivo: LOGIN IMAP sul socket, niente di simulato.
 *
 * Due cose sono cambiate rispetto a `verifyRealImap`. La prima: host, utenza e password sono
 * obbligatori qui, perché la rotta non li completa più con `imap.register.it` e la casella
 * della piattaforma — con quel ripiego un tenant senza configurazione vedeva la prova
 * riuscire sulla casella di un altro. La seconda: l'errore del socket non è più solo il
 * messaggio di Node. «Hostname/IP does not match certificate's altnames» era la riga che
 * l'operatore vedeva, e non c'è nulla in quella riga che indichi cosa fare — la password
 * risulta sospettata, mentre il guasto sta nel nome del server (`diagnosiPosta.ts`).
 */
export async function provaPostaInArrivo(options: {
  host?: string;
  /** Nome che il certificato deve attestare, se lo studio lo ha dichiarato. */
  servername?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}): Promise<EsitoProvaPosta> {
  const mancanti = [!options.host && 'il server IMAP', !options.user && "l'utenza", !options.pass && 'la password'].filter(Boolean);
  if (mancanti.length > 0) {
    const errore = `Casella in arrivo non configurata: ${mancanti.join(', ')} nelle impostazioni dello studio ${mancanti.length > 1 ? 'sono vuoti' : 'è vuoto'}.`;
    return { success: false, message: `❌ ${errore}`, errore };
  }

  let host: string;
  let servername: string;
  let user: string;
  let pass: string;
  let port: number;
  try {
    host = validaHost(options.host || '', 'Host IMAP');
    servername = options.servername ? validaServername(options.servername) : '';
    user = vietaControlli(options.user || '', 'Utenza IMAP', 254).trim();
    pass = vietaControlli(options.pass || '', 'Password IMAP', 1024);
    port = validaPorta(options.port ?? 993, 'Porta IMAP');
  } catch (err) {
    const errore = err instanceof Error ? err.message : 'Configurazione IMAP non valida.';
    return { success: false, message: `❌ ${errore}`, errore };
  }
  const secure = process.env.NODE_ENV === 'production' ? true : (options.secure ?? port === 993);

  let endpoint;
  try {
    endpoint = await risolviEndpointPubblico(host, servername || undefined);
  } catch (err) {
    const errore = err instanceof Error ? err.message : 'Host IMAP non consentito.';
    return { success: false, message: `❌ ${errore}`, errore };
  }

  return new Promise(resolve => {
    const timeoutMs = 8000;
    let finished = false;

    const onDone = (res: EsitoProvaPosta) => {
      if (!finished) {
        finished = true;
        resolve(res);
      }
    };

    /** Ogni fallimento passa da qui: messaggio tecnico più istruzione, una volta sola. */
    const fallisci = (messaggio: string) => {
      const spiegato = spiegaErrorePosta({ protocollo: 'IMAP', host, porta: port, messaggio });
      onDone({ success: false, message: `❌ ${spiegato}`, errore: spiegato });
    };

    const timer = setTimeout(() => {
      fallisci(`ETIMEDOUT: nessuna risposta da ${host}:${port} entro ${timeoutMs / 1000} secondi`);
    }, timeoutMs);

    try {
      const socket = secure
        ? tls.connect(
            {
              host: endpoint.address,
              port,
              rejectUnauthorized: tlsRejectUnauthorized(),
              ...(endpoint.servername ? { servername: endpoint.servername } : {}),
            },
            () => {
              // Handshake TLS completato
            },
          )
        : net.connect({ host: endpoint.address, port }, () => {
            // Handshake senza cifratura: il provider non offre IMAPS su questa porta
          });

      socket.setTimeout(timeoutMs);

      socket.on('data', data => {
        const str = data.toString();
        if (str.includes('* OK')) {
          // Banner del server ricevuto: si autentica. Le virgolette nelle credenziali vanno
          // protette, altrimenti spezzano il comando.
          const esc = (v: string) => v.replace(/([\\"])/g, '\\$1');
          socket.write(`A01 LOGIN "${esc(user)}" "${esc(pass)}"\r\n`);
        } else if (str.includes('A01 OK')) {
          clearTimeout(timer);
          socket.end();
          onDone({
            success: true,
            via: `${host}:${port}`,
            message:
              `✓ Casella in arrivo raggiunta e credenziali accettate su ${host}:${port} per ${user}.` +
              (servername ? ` Certificato verificato per «${servername}».` : ''),
          });
        } else if (str.includes('A01 NO') || str.includes('A01 BAD')) {
          clearTimeout(timer);
          socket.end();
          fallisci(`A01 NO: ${host} ha rifiutato utenza o password (${str.trim()})`);
        }
      });

      socket.on('error', err => {
        clearTimeout(timer);
        fallisci(`${(err as any)?.code ? `${(err as any).code}: ` : ''}${err.message}`);
      });
    } catch (err: any) {
      clearTimeout(timer);
      fallisci(`${err?.code ? `${err.code}: ` : ''}${err?.message || 'socket non stabilito'}`);
    }
  });
}

export async function sendMagicLinkEmail(
  toEmail: string,
  clienteNome: string,
  magicUrl: string,
  customConfig?: {
    host?: string;
    servername?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
    fromName?: string;
  }
): Promise<EsitoEmail> {
  // Nessun host cablato. Il ripiego su `authsmtp.register.it` mandava le credenziali di questo
  // studio al server di un provider che potrebbe non essere il suo; e con l'host sbagliato
  // l'invio fallisce comunque, solo senza dire perché. Senza host `inviaEmail` risponde «SMTP
  // non configurato», che è l'informazione vera.
  const host = customConfig?.host || process.env.SMTP_HOST;
  const servername = customConfig?.servername || process.env.SMTP_SERVERNAME || undefined;
  const port = customConfig?.port || Number(process.env.SMTP_PORT ?? 465);
  const secure = customConfig?.secure !== undefined ? customConfig.secure : (port === 465);
  const user = customConfig?.user || process.env.SMTP_USER;
  const pass = customConfig?.pass || process.env.SMTP_PASS;
  const fromEmail = customConfig?.fromEmail || user || process.env.SMTP_FROM;
  const fromName = customConfig?.fromName || 'BluMan Advisory';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0; font-size: 24px; font-weight: 700;">${fromName}</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Portale Riservato — Accesso Diretto</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${clienteNome},</h2>
        <p style="line-height: 1.6; color: #475569;">È stato generato il tuo link di accesso sicuro e riservato al Portale Cliente di <strong>${fromName}</strong>.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${magicUrl}" style="background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Accedi al Portale Cliente ➔</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">Questo link d'accesso è personale ed ha una durata limitata. Se non hai richiesto tu questo link, puoi ignorare questa email.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        ${fromName} • Portale Riservato Clienti
      </div>
    </div>
  `;

  return inviaEmail({
    to: toEmail,
    subject: `🔑 Accesso al Portale Cliente — ${clienteNome}`,
    html,
    smtp: { host, servername, port, secure, user, pass },
    fromEmail,
    fromName,
    etichetta: 'Magic Link',
  });
}

export interface OpzioniEmailOtp {
  /** Credenziali SMTP dello studio: senza, l'OTP di ogni tenant partirebbe dal mittente di ambiente. */
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
  fromEmail?: string;
  fromName?: string;
  /** Validità dichiarata al destinatario: deve coincidere con la TTL vera, non essere un numero fisso nell'HTML. */
  minutiValidita?: number;
  /** Cosa si sta firmando. Il testo diceva sempre "Engagement Letter", anche per un addendum. */
  oggettoFirma?: string;
}

export interface EsitoEmailOtp {
  ok: boolean;
  /** Host e porta che hanno accettato l'invio: serve a capire quale ripiego ha funzionato. */
  via?: string;
  /** Motivo tecnico del fallimento, da mostrare a chi firma invece di un generico "controlla la configurazione". */
  errore?: string;
}

export async function sendOtpSecurityEmail(
  toEmail: string,
  clienteNome: string,
  otpCode: string,
  opzioni: OpzioniEmailOtp = {},
): Promise<EsitoEmailOtp> {
  const fromEmail = opzioni.fromEmail || process.env.SMTP_FROM;
  const fromName = opzioni.fromName || 'BluMan Security';
  const minuti = opzioni.minutiValidita ?? 5;
  const oggetto = opzioni.oggettoFirma || 'il documento in attesa di firma';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0; font-size: 24px; font-weight: 700;">BluMan Advisory</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Firma Elettronica Semplice (OTP) · art. 20 CAD</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${clienteNome},</h2>
        <p style="line-height: 1.6; color: #475569;">Ecco il tuo codice di sicurezza monouso (OTP) a 6 cifre per la firma di ${oggetto}:</p>
        <div style="margin: 28px 0; background: #f1f5f9; padding: 20px; border-radius: 12px; display: inline-block;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #4338ca; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="font-size: 13px; color: #64748b;">⏳ Questo codice ha una validità massima di <strong>${minuti} ${minuti === 1 ? 'minuto' : 'minuti'}</strong>.</p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; line-height: 1.5;">Non condividere questo codice con nessuno. Se non hai richiesto tu la firma, contatta immediatamente il tuo advisor.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        BluMan Advisory Platform • Firma Elettronica Semplice (OTP) · art. 20 CAD
      </div>
    </div>
  `;

  // Il codice non finisce nei log, né qui né in caso di successo: i log di Railway sono
  // leggibili da chiunque abbia accesso al progetto, e un OTP scritto lì è un secondo fattore
  // consegnato a tutti. Se l'invio non riesce l'esito è negativo con il motivo tecnico, e la
  // rotta lo dice a chi sta firmando — prima "simulazione" significava firma bloccata senza
  // nessuna spiegazione.
  return inviaEmail({
    to: toEmail,
    // Il codice NON va nell'oggetto: l'oggetto è la riga che le notifiche mostrano sulla
    // schermata bloccata del telefono e che i log dei server di posta conservano in chiaro.
    subject: '🔐 Codice di sicurezza per la firma — BluMan',
    html,
    smtp: opzioni.smtp,
    fromEmail,
    fromName,
    etichetta: 'OTP firma',
  });
}

export async function sendClientCredentialsEmail(
  toEmail: string,
  clienteNome: string,
  passwordChiaro: string,
  portalUrl?: string,
  customConfig?: {
    host?: string;
    servername?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
    fromName?: string;
  }
): Promise<EsitoEmail> {
  // Nessun host cablato, per lo stesso motivo di `sendMagicLinkEmail`: senza host questa
  // email non parte, e va detto invece di provare il server di un altro provider.
  const host = customConfig?.host || process.env.SMTP_HOST;
  const servername = customConfig?.servername || process.env.SMTP_SERVERNAME || undefined;
  const port = customConfig?.port || Number(process.env.SMTP_PORT ?? 465);
  const secure = customConfig?.secure !== undefined ? customConfig.secure : (port === 465);
  const user = customConfig?.user || process.env.SMTP_USER;
  const pass = customConfig?.pass || process.env.SMTP_PASS;
  const fromEmail = customConfig?.fromEmail || user || process.env.SMTP_FROM;
  const fromName = customConfig?.fromName || 'BluMan Advisory';
  const url = portalUrl || 'https://bluman.vercel.app/portal';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0; font-size: 24px; font-weight: 700;">${fromName}</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Credenziali Accesso Portale Cliente</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${clienteNome},</h2>
        <p style="line-height: 1.6; color: #475569;">Sono state generate le credenziali per il tuo accesso al Portale Riservato di <strong>${fromName}</strong>.</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 24px 0;">
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">Email (Username): <strong style="color: #0f172a;">${toEmail}</strong></p>
          <p style="margin: 0; font-size: 13px; color: #64748b;">Password: <strong style="color: #4338ca; font-family: monospace; font-size: 15px;">${passwordChiaro}</strong></p>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${url}" style="background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Accedi al Portale Cliente ➔</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">Ti consigliamo di conservare queste credenziali con cura e di non divulgarle.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        ${fromName} • Portale Riservato Clienti
      </div>
    </div>
  `;

  return inviaEmail({
    to: toEmail,
    subject: `🔑 Credenziali di Accesso al Portale — ${clienteNome}`,
    html,
    smtp: { host, servername, port, secure, user, pass },
    fromEmail,
    fromName,
    etichetta: 'credenziali portale',
  });
}

/**
 * Invito al nuovo collaboratore dello studio, con la password temporanea generata dal server.
 *
 * Prima questa email la faceva partire il browser: `creaUtenteTenantApi` riceveva
 * `passwordTemporanea` nella risposta di `POST /tenant/utenti` e la rispediva alla funzione
 * serverless `POST /api/send-email` con `action: 'invite-collaborator'`, insieme alla password
 * SMTP dello studio letta da `localStorage`. Quindi: una password appena creata faceva un giro
 * completo attraverso la pagina web e una funzione pubblica, e se l'operatore chiudeva la
 * schermata nel frattempo l'invito non partiva — con l'utente già creato e nessuno che sapesse
 * la password.
 *
 * Ora la spedisce la rotta che la genera, nella stessa richiesta. Nessun ripiego sulla
 * password: senza `passwordTemporanea` non c'è nulla da comunicare (regola 6, §23).
 */
export async function sendInvitoCollaboratoreEmail(opzioni: {
  toEmail: string;
  nome: string;
  ruolo?: string;
  specializzazione?: string;
  passwordTemporanea: string;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
  fromEmail?: string;
  fromName?: string;
  urlAccesso?: string;
}): Promise<EsitoEmail> {
  if (!opzioni.passwordTemporanea) {
    return { ok: false, errore: 'password temporanea assente: non c\'è nulla da comunicare al collaboratore' };
  }

  const nomeStudio = opzioni.fromName || 'BluMan Advisory';
  const url = opzioni.urlAccesso || `${(process.env.APP_BASE_URL || 'https://bluman.vercel.app').replace(/\/+$/, '')}/login`;
  const ruoloLeggibile =
    opzioni.ruolo === 'partner'
      ? 'Senior Partner'
      : opzioni.ruolo === 'advisor'
        ? 'Advisor'
        : opzioni.ruolo === 'super_admin'
          ? 'Amministratore di sistema'
          : 'Collaboratore';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #818cf8; margin: 0; font-size: 22px; font-weight: 700;">${nomeStudio}</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 12px;">Gestionale Studio &amp; Fascicoli</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${opzioni.nome},</h2>
        <p style="line-height: 1.6; color: #475569;">
          È stato attivato il tuo accesso come <strong>${ruoloLeggibile}</strong>${opzioni.specializzazione ? ` (${opzioni.specializzazione})` : ''}.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 24px 0;">
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b;">Email (username): <strong style="color: #0f172a;">${opzioni.toEmail}</strong></p>
          <p style="margin: 0; font-size: 13px; color: #64748b;">Password temporanea: <strong style="color: #4338ca; font-family: monospace; font-size: 15px;">${opzioni.passwordTemporanea}</strong></p>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${url}" style="background-color: #4338ca; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Accedi al gestionale ➔</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
          Cambia la password al primo accesso e non condividerla con nessuno.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        ${nomeStudio} • Accesso riservato al team
      </div>
    </div>
  `;

  return inviaEmail({
    to: opzioni.toEmail,
    subject: `🔑 Invito e credenziali di accesso — ${nomeStudio}`,
    html,
    smtp: opzioni.smtp,
    fromEmail: opzioni.fromEmail,
    fromName: opzioni.fromName,
    etichetta: 'invito collaboratore',
  });
}
