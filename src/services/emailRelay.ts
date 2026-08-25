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
  const host = smtp?.host || process.env.SMTP_HOST;
  if (!host) return [];

  const porta = smtp?.port || Number(process.env.SMTP_PORT ?? 465);

  return [
    { host, port: porta, secure: smtp?.secure ?? porta === 465 },
    { host, port: 465, secure: true },
    { host, port: 587, secure: false },
    { host, port: 25, secure: false },
  ].filter((c, i, arr) => arr.findIndex(x => x.host === c.host && x.port === c.port) === i);
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
  const scadenza = setTimeout(() => controller.abort(), 45000);

  try {
    const risposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        action: 'send-message',
        smtpHost: smtp.host,
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
    const motivo = err?.name === 'AbortError' ? 'nessuna risposta entro 45 secondi' : err?.message || 'errore di rete';
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
      const trasporto = nodemailer.createTransport({
        host: cand.host,
        port: cand.port,
        secure: cand.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        tls: { rejectUnauthorized: tlsRejectUnauthorized() },
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
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
  const smtp: CredenzialiSmtp = {
    host: messaggio.smtp?.host || process.env.SMTP_HOST,
    port: messaggio.smtp?.port || Number(process.env.SMTP_PORT ?? 465),
    secure: messaggio.smtp?.secure,
    user: messaggio.smtp?.user || process.env.SMTP_USER,
    pass: messaggio.smtp?.pass || process.env.SMTP_PASS,
  };

  const etichetta = messaggio.etichetta || 'email';

  if (!smtp.host || !smtp.user || !smtp.pass) {
    return {
      ok: false,
      errore: 'SMTP non configurato: host, utente o password mancanti nelle impostazioni dello studio.',
    };
  }

  const mittente = `"${messaggio.fromName || 'BluMan Advisory'}" <${messaggio.fromEmail || smtp.user}>`;
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
    // risolve nelle impostazioni della casella, le porte chiuse sull'hosting.
    const errore = `${esitoRelay.errore}; nessuna porta utilizzabile verso ${smtp.host} (${errori.join('; ')})`;
    console.error(`[Email ${etichetta}] invio non riuscito: ${errore}`);
    return { ok: false, errore };
  }

  const esitoSmtp = await inviaViaSmtp(messaggio, smtp, mittente, etichetta, errori, 10000);
  if (esitoSmtp) return esitoSmtp;

  const errore =
    `nessuna porta utilizzabile verso ${smtp.host} (${errori.join('; ')}); ` +
    'nessun relay configurato (EMAIL_RELAY_URL o APP_BASE_URL assenti)';
  console.error(`[Email ${etichetta}] invio non riuscito: ${errore}`);
  return { ok: false, errore };
}
