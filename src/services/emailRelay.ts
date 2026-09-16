/**
 * Consegna di una email dal backend, con ripiego sulla funzione serverless quando l'hosting
 * non lascia uscire l'SMTP.
 *
 * Il problema è misurato, non ipotizzato: dai log di Railway ogni tentativo verso
 * `authsmtp.register.it` finisce in `ETIMEDOUT` sulla porta 465, sulla 587 e sulla 25 —
 * cioè su tutte le porte che register.it espone (la 2525 non risponde). Le impostazioni
 * dello studio sono corrette, la casella funziona, la stessa credenziale spedisce senza
 * problemi da una macchina qualunque: è la rete in uscita del contenitore che blocca.
 * Conseguenza pratica, prima di questo file: nessun codice OTP, nessun Magic Link e nessuna
 * credenziale di portale partiva dalla produzione, quindi nessun cliente poteva né entrare
 * nel portale né firmare.
 *
 * La stessa email spedita dalla funzione serverless su Vercel arriva. Quindi in produzione il
 * messaggio viene affidato a `POST /api/send-email`, che gira su un'altra rete e usa le stesse
 * credenziali dello studio; l'SMTP diretto resta come ripiego. L'ordine è quello e non
 * l'inverso perché le porte bloccate non rifiutano, scadono: provarle per prime aggiungerebbe
 * decine di secondi a ogni invio (il dettaglio è sopra `inviaEmail`).
 *
 * Due cose che questo file NON fa, per scelta:
 *
 * - non cambia mittente. Le credenziali sono sempre quelle configurate dallo studio: un
 *   ripiego che spedisse da un'altra casella farebbe arrivare al cliente un messaggio da un
 *   mittente che non riconosce, e su un'installazione multi-studio dal mittente di un altro
 *   studio.
 * - non finge. Se anche il relay fallisce, la funzione risponde `ok: false` con il motivo
 *   tecnico di entrambe le strade, e chi ha chiamato lo riporta a chi sta firmando.
 */
import nodemailer from 'nodemailer';
import { spiegaErrorePosta } from './diagnosiPosta.js';
import {
  risolviEndpointPubblico,
  validaEmail,
  validaHost,
  validaPorta,
  validaServername,
  vietaControlli,
} from '../util/networkPolicy.js';

/**
 * §3.4 — verifica dei certificati TLS per SMTP/IMAP. Prima era disattivata ovunque
 * (`rejectUnauthorized: false`): le credenziali SMTP potevano finire a chiunque fosse in
 * grado di fare man-in-the-middle. La verifica è la regola; se un provider ha la catena
 * di certificazione rotta si può TEMPORANEAMENTE tornare al comportamento insicuro con
 * SMTP_INSECURE_TLS=1 — il warn allo startup lascia l'eccezione visibile nei log.
 */
const TLS_INSICURA_ATTIVA = process.env.SMTP_INSECURE_TLS === '1' || process.env.SMTP_INSECURE_TLS === 'true';
if (TLS_INSICURA_ATTIVA) {
  console.warn('⚠️ SMTP_INSECURE_TLS attivo: i certificati TLS di SMTP/IMAP NON vengono verificati. Rimuovere l\'eccezione appena il provider è a posto.');
}

export function tlsRejectUnauthorized(): boolean {
  return !TLS_INSICURA_ATTIVA;
}

export interface CredenzialiSmtp {
  host?: string;
  /**
   * Nome che il certificato deve attestare, quando è diverso dall'host a cui si collega.
   *
   * Non è un'eccezione alla verifica (§3.4): il certificato viene verificato, e lo si verifica
   * contro questo nome invece che contro l'host. Serve dove il nome coperto dal certificato non
   * ha record DNS e l'indirizzo raggiungibile ne ha un altro — la coppia misurata sulla casella
   * dello studio è nella migrazione `20260830120000_nome_certificato_posta`. Vuoto, cioè il caso
   * normale, la verifica avviene contro l'host.
   */
  servername?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}

export interface EsitoEmail {
  ok: boolean;
  /** Da dove è partita: `host:porta` per l'SMTP diretto, `relay <url>` per la funzione. */
  via?: string;
  /** Motivo tecnico del fallimento, senza segreti: host, porta e codice dell'errore. */
  errore?: string;
}

export interface AllegatoEmail {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MessaggioEmail {
  to: string;
  subject: string;
  html: string;
  smtp?: CredenzialiSmtp;
  fromEmail?: string;
  fromName?: string;
  allegati?: AllegatoEmail[];
  /** Compare nei log per distinguere OTP, Magic Link e credenziali. Mai il contenuto. */
  etichetta?: string;
}

/**
 * Indirizzo della funzione che spedisce al posto nostro.
 *
 * `EMAIL_RELAY_URL` per puntarla altrove; in mancanza si usa la funzione dello stesso
 * progetto, ricavata da `APP_BASE_URL`. In sviluppo non c'è nessun relay: un'email che non
 * parte sulla macchina di chi sviluppa deve restare un errore visibile.
 */
function urlRelay(): string | null {
  const esplicito = process.env.EMAIL_RELAY_URL?.trim();
  if (esplicito) return esplicito;

  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (base) return `${base}/api/send-email`;

  if (process.env.NODE_ENV === 'production') return 'https://bluman.vercel.app/api/send-email';

  return null;
}

/**
 * La stessa casella su porte diverse, non un'altra casella.
 *
 * Prima ogni funzione di invio si costruiva la propria lista, con quattro copie divergenti
 * nello stesso file: una provava tre host, un'altra uno solo, e il codice OTP era quella che
 * ne provava uno.
 */
function candidatiSmtp(smtp?: CredenzialiSmtp): Array<{ host: string; port: number; secure: boolean }> {
  // Solo l'host dello studio, nessun ripiego sull'ambiente: per lo stesso motivo di `inviaEmail`.
  const host = smtp?.host;
  if (!host) return [];

  const porta = validaPorta(smtp?.port ?? 465, 'Porta SMTP');
  const produzione = process.env.NODE_ENV === 'production';

  return [
    { host, port: porta, secure: smtp?.secure ?? porta === 465 },
    { host, port: 465, secure: true },
    // In produzione niente connessioni SMTP in chiaro: il relay HTTPS o SMTPS sono gli unici
    // percorsi ammessi. In sviluppo restano disponibili le porte STARTTLS storiche.
    ...(!produzione ? [
      { host, port: 587, secure: false },
      { host, port: 25, secure: false },
    ] : []),
  ].filter((c, i, arr) => (!produzione || c.secure) && arr.findIndex(x => x.host === c.host && x.port === c.port) === i);
}

async function inviaViaRelay(messaggio: MessaggioEmail, smtp: CredenzialiSmtp): Promise<EsitoEmail> {
  const url = urlRelay();
  if (!url) {
    return { ok: false, errore: 'nessun relay configurato (EMAIL_RELAY_URL o APP_BASE_URL assenti)' };
  }

  // La password dello studio viaggia nel corpo della richiesta: accettabile solo su TLS, e
  // non c'è motivo di accettare altro. La funzione non conserva nulla.
  if (!url.startsWith('https://')) {
    return { ok: false, errore: `relay rifiutato: ${url} non è HTTPS e trasporterebbe la password in chiaro` };
  }

  const controller = new AbortController();
  const timeoutMs = 10000;
  const scadenza = setTimeout(() => controller.abort(), timeoutMs);

  // §35 — la funzione di relay ora rifiuta le chiamate senza questo header quando
  // `EMAIL_RELAY_SECRET` è impostato su Vercel: serve a distinguere il backend da un browser
  // qualunque, dato che prima l'endpoint era aperto a tutti (CORS `*`).
  const intestazioni: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.EMAIL_RELAY_SECRET) {
    intestazioni['x-bluman-relay'] = process.env.EMAIL_RELAY_SECRET;
  }

  try {
    const risposta = await fetch(url, {
      method: 'POST',
      headers: intestazioni,
      signal: controller.signal,
      body: JSON.stringify({
        action: 'send-message',
        smtpHost: smtp.host,
        smtpServername: smtp.servername,
        smtpPort: smtp.port,
        smtpSecure: smtp.secure,
        smtpUser: smtp.user,
        smtpPass: smtp.pass,
        smtpFromEmail: messaggio.fromEmail || smtp.user,
        smtpFromName: messaggio.fromName || 'BluMan Advisory',
        to: messaggio.to,
        subject: messaggio.subject,
        html: messaggio.html,
        // Gli allegati passano in base64 perché il corpo è JSON. La funzione accetta corpi
        // molto più grandi di un PDF di fattura, quindi non c'è un limite pratico da temere
        // qui, ma il base64 gonfia del 33% quello che si spedisce.
        allegati: (messaggio.allegati || []).map(a => ({
          filename: a.filename,
          contentBase64: a.content.toString('base64'),
          contentType: a.contentType,
        })),
      }),
    });

    const dettaglio: any = await risposta.json().catch(() => null);

    if (!risposta.ok || dettaglio?.success === false) {
      const motivo = dettaglio?.errore || dettaglio?.error || `HTTP ${risposta.status}`;
      return { ok: false, errore: `relay: ${motivo}` };
    }

    return { ok: true, via: `relay ${url}` };
  } catch (err: any) {
    const motivo = err?.name === 'AbortError' ? `nessuna risposta entro ${timeoutMs / 1000} secondi` : err?.message || 'errore di rete';
    return { ok: false, errore: `relay: ${motivo}` };
  } finally {
    clearTimeout(scadenza);
  }
}

/** Un tentativo SMTP diretto su tutte le porte plausibili. Vuoto se nessuna ha risposto. */
async function inviaViaSmtp(
  messaggio: MessaggioEmail,
  smtp: CredenzialiSmtp,
  mittente: string,
  etichetta: string,
  errori: string[],
  timeoutMs: number,
): Promise<EsitoEmail | null> {
  for (const cand of candidatiSmtp(smtp)) {
    const iniziato = Date.now();
    try {
      // Si connette all'IP appena validato, non risolve una seconda volta il nome: così un cambio
      // DNS fra controllo e socket non può spostare la connessione verso una rete interna.
      const endpoint = await risolviEndpointPubblico(cand.host, smtp.servername);
      const trasporto = nodemailer.createTransport({
        host: endpoint.address,
        port: cand.port,
        secure: cand.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        tls: {
          rejectUnauthorized: tlsRejectUnauthorized(),
          ...(endpoint.servername ? { servername: endpoint.servername } : {}),
        },
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
        dnsTimeout: timeoutMs,
      });

      await trasporto.sendMail({
        from: mittente,
        to: messaggio.to,
        subject: messaggio.subject,
        html: messaggio.html,
        attachments: messaggio.allegati,
      });
      console.log(`[Email ${etichetta}] inviata a ${messaggio.to} via ${cand.host}:${cand.port} in ${Date.now() - iniziato}ms`);
      return { ok: true, via: `${cand.host}:${cand.port}` };
    } catch (err: any) {
      errori.push(`${cand.port}: ${err?.code ? `${err.code} — ` : ''}${err?.message || 'errore sconosciuto'}`);
    }
  }
  return null;
}

/**
 * Spedisce. Unico punto di uscita della posta dal backend.
 *
 * L'ordine dipende da dove sta girando il codice, e la differenza si misura in secondi che
 * qualcuno passa a guardare una rotella:
 *
 * - **con relay configurato** (la produzione) si prova prima il relay. Le quattro porte SMTP
 *   qui non sono chiuse con un rifiuto immediato ma con un timeout: provarle per prime
 *   costerebbe fino a quaranta secondi di attesa a ogni codice OTP, ogni volta, per poi
 *   ripiegare comunque sul relay che risponde in circa due secondi. Peggio: qualche proxy
 *   chiude la richiesta prima dei quaranta secondi, e il cliente vede un errore di rete su
 *   un invio che stava per riuscire. L'SMTP diretto resta come ripiego, così se un giorno
 *   l'hosting sbloccasse le porte o il relay si fermasse, la posta continua a partire.
 * - **senza relay** (la macchina di chi sviluppa) c'è solo l'SMTP diretto, che lì funziona.
 */
export async function inviaEmail(messaggio: MessaggioEmail): Promise<EsitoEmail> {
  // Le credenziali sono SOLO quelle dello studio, quelle che `credenzialiCanali` ha letto
  // dalla sua riga. Il ripiego sulle variabili `SMTP_*` faceva partire la posta di uno studio
  // che non ne aveva, dall'account di piattaforma: il controllo qui sotto lo intercettava, ma
  // solo quando la piattaforma non aveva a sua volta una casella configurata. Un canale non
  // configurato deve fermarsi con un motivo, non funzionare per conto di qualcun altro.
  const smtp: CredenzialiSmtp = {
    host: messaggio.smtp?.host,
    servername: messaggio.smtp?.servername || undefined,
    port: messaggio.smtp?.port || 465,
    secure: messaggio.smtp?.secure,
    user: messaggio.smtp?.user,
    pass: messaggio.smtp?.pass,
  };

  const etichetta = messaggio.etichetta || 'email';

  if (!smtp.host || !smtp.user || !smtp.pass) {
    return {
      ok: false,
      errore: 'SMTP non configurato: host, utente o password mancanti nelle impostazioni dello studio.',
    };
  }

  try {
    smtp.host = validaHost(smtp.host, 'Host SMTP');
    smtp.servername = smtp.servername ? validaServername(smtp.servername) : undefined;
    smtp.port = validaPorta(smtp.port ?? 465, 'Porta SMTP');
    smtp.user = vietaControlli(smtp.user, 'Utenza SMTP', 254).trim();
    smtp.pass = vietaControlli(smtp.pass, 'Password SMTP', 1024);
    messaggio.to = validaEmail(messaggio.to, 'Destinatario');
    messaggio.fromEmail = validaEmail(messaggio.fromEmail || smtp.user, 'Mittente');
    vietaControlli(messaggio.subject, 'Oggetto email', 998);
  } catch (err) {
    return { ok: false, errore: err instanceof Error ? err.message : 'Configurazione SMTP non valida.' };
  }

  const mittente = `"${vietaControlli(messaggio.fromName || 'BluMan Advisory', 'Nome mittente', 200)}" <${messaggio.fromEmail}>`;
  const errori: string[] = [];
  const relayDisponibile = Boolean(urlRelay());

  if (relayDisponibile) {
    const esitoRelay = await inviaViaRelay(messaggio, smtp);
    if (esitoRelay.ok) {
      console.log(`[Email ${etichetta}] inviata a ${messaggio.to} ${esitoRelay.via}`);
      return esitoRelay;
    }

    console.warn(`[Email ${etichetta}] relay non disponibile (${esitoRelay.errore}); tentativo SMTP diretto`);

    // Timeout più corto del solito: qui l'SMTP è già il secondo tentativo e chi ha chiesto
    // il codice sta aspettando da qualche secondo.
    const esitoSmtp = await inviaViaSmtp(messaggio, smtp, mittente, etichetta, errori, 7000);
    if (esitoSmtp) return esitoSmtp;

    // Entrambi i motivi, perché richiedono interventi diversi: un rifiuto del relay si
    // risolve nelle impostazioni della casella, le porte chiuse sull'hosting. In coda
    // l'istruzione: «ENOTFOUND» e «altnames» sono due guasti distinti che il titolare dello
    // studio non può distinguere da sé, e per uno dei due la password non c'entra (§35).
    const tecnico = `${esitoRelay.errore}; nessuna porta utilizzabile verso ${smtp.host} (${errori.join('; ')})`;
    const errore = spiegaErrorePosta({ protocollo: 'SMTP', host: smtp.host, porta: smtp.port, messaggio: tecnico });
    console.error(`[Email ${etichetta}] invio non riuscito: ${errore}`);
    return { ok: false, errore };
  }

  const esitoSmtp = await inviaViaSmtp(messaggio, smtp, mittente, etichetta, errori, 10000);
  if (esitoSmtp) return esitoSmtp;

  const tecnico =
    `nessuna porta utilizzabile verso ${smtp.host} (${errori.join('; ')}); ` +
    'nessun relay configurato (EMAIL_RELAY_URL o APP_BASE_URL assenti)';
  const errore = spiegaErrorePosta({ protocollo: 'SMTP', host: smtp.host, porta: smtp.port, messaggio: tecnico });
  console.error(`[Email ${etichetta}] invio non riuscito: ${errore}`);
  return { ok: false, errore };
}
