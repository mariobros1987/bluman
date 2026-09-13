import nodemailer from 'nodemailer';
import tls from 'tls';
import nodeCrypto from 'crypto';

function cleanRawEmailBody(raw: string): string {
  if (!raw) return '';
  let str = raw;

  // 1. Se è un MIME multipart, estrai solo la sezione Content-Type: text/plain
  if (str.includes('Content-Type: text/plain') || str.includes('Content-Type:text/plain')) {
    const plainSection = str.split(/Content-Type:\s*text\/plain[^\r\n]*/i)[1];
    if (plainSection) {
      const parts = plainSection.split(/\r?\n--/);
      const beforeBoundary = parts[0] || '';
      const bodyOnly = beforeBoundary.replace(/^[\s\S]*?\r?\n\r?\n/, '');
      str = bodyOnly;
    }
  } else if (str.includes('Content-Type: text/html') || str.includes('Content-Type:text/html')) {
    const htmlSection = str.split(/Content-Type:\s*text\/html[^\r\n]*/i)[1];
    if (htmlSection) {
      const parts = htmlSection.split(/\r?\n--/);
      const beforeBoundary = parts[0] || '';
      const bodyOnly = beforeBoundary.replace(/^[\s\S]*?\r?\n\r?\n/, '');
      str = bodyOnly.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }
  }

  // 2. Decode Quoted-Printable
  str = str
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=20/g, ' ')
    .replace(/=E2=80=99/g, "'")
    .replace(/=E2=80=94/g, "—")
    .replace(/=E2=80=A2/g, "•")
    .replace(/=C3=A0/g, "à")
    .replace(/=C3=A8/g, "è")
    .replace(/=C3=A9/g, "é")
    .replace(/=C3=AC/g, "ì")
    .replace(/=C3=B2/g, "ò")
    .replace(/=C3=B9/g, "ù");

  str = str.replace(/--[a-zA-Z0-9_-]{10,}/g, '');
  str = str.replace(/Content-Transfer-Encoding:[^\r\n]*/gi, '');
  str = str.replace(/Content-Type:[^\r\n]*/gi, '');

  // 3. Rimuovi le quote e lo storico delle risposte precedenti
  const lines = str.split(/\r?\n/);
  const cleanLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>') || trimmed.startsWith('&gt;')) continue;
    if (/^Il giorno .+ ha scritto:?$/i.test(trimmed)) break;
    if (/^On .+ wrote:?$/i.test(trimmed)) break;
    if (/^In data .+ ha scritto:?$/i.test(trimmed)) break;
    if (trimmed.includes('--- Messaggio Originale ---')) break;
    if (trimmed.includes('________________________________')) break;
    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

// Helper per scaricare le email reali dalla casella IMAP
async function fetchRecentImapEmails(options: {
  host?: string;
  /** Nome che il certificato deve attestare, quando è diverso dall'host. */
  servername?: string;
  port?: number;
  user: string;
  pass: string;
  folder?: string;
  limit?: number;
}): Promise<Array<{ id: string; from: string; subject: string; date: string; text: string }>> {
  return new Promise((resolve) => {
    // Nessun host cablato: il ripiego su imap.register.it faceva sì che una chiamata senza
    // host si collegasse al server di un provider qualunque con le credenziali di questo
    // studio. Il backend manda sempre l'host della casella, e la chiamata senza host viene
    // rifiutata prima di arrivare qui.
    // `host` è l'indirizzo a cui collegarsi, `servername` il nome che il certificato deve
    // attestare: sono due informazioni distinte perché l'indirizzo raggiungibile e il nome
    // coperto dal certificato possono non coincidere. Il certificato si verifica in ogni caso.
    const host = options.host || '';
    const servername = options.servername || '';
    const port = options.port || 993;
    const user = options.user;
    const pass = options.pass;
    const folder = options.folder || 'INBOX';
    const limit = options.limit || 10;

    if (!host || !user || !pass) {
      return resolve([]);
    }

    const socket = tls.connect(
      {
        host,
        port,
        ...(servername ? { servername } : {}),
        rejectUnauthorized: !tlsInsicuraAmmessa(),
        timeout: 5000,
      },
      () => {}
    );

    let buffer = '';
    let step = 0;
    const emails: Array<{ id: string; from: string; subject: string; date: string; text: string }> = [];
    let messageIds: string[] = [];

    const cleanup = () => {
      try {
        socket.end();
        socket.destroy();
      } catch {}
    };

    socket.setTimeout(5000, () => {
      cleanup();
      resolve(emails);
    });

    socket.on('error', () => {
      cleanup();
      resolve(emails);
    });

    socket.on('data', (data) => {
      buffer += data.toString();

      // Step 0: Server Greeting "* OK ..." -> Invia LOGIN
      if (step === 0 && buffer.includes('* OK')) {
        step = 1;
        buffer = '';
        socket.write(`A1 LOGIN "${user}" "${pass}"\r\n`);
        return;
      }

      // Step 1: Login Risposta
      if (step === 1) {
        if (buffer.includes('A1 OK')) {
          step = 2;
          buffer = '';
          socket.write(`A2 SELECT "${folder}"\r\n`);
          return;
        } else if (buffer.includes('A1 NO') || buffer.includes('A1 BAD')) {
          cleanup();
          return resolve([]);
        }
      }

      // Step 2: Select Risposta -> Invia SEARCH ALL
      if (step === 2) {
        if (buffer.includes('A2 OK')) {
          step = 3;
          buffer = '';
          socket.write(`A3 SEARCH ALL\r\n`);
          return;
        }
      }

      // Step 3: Search Risposta "* SEARCH 1 2 3..."
      if (step === 3) {
        if (buffer.includes('A3 OK')) {
          const searchMatch = buffer.match(/\* SEARCH ([\d\s]+)/);
          buffer = '';
          if (searchMatch && searchMatch[1]) {
            const allIds = searchMatch[1].trim().split(/\s+/).filter(Boolean);
            messageIds = allIds.slice(-limit); // Prendi gli ultimi N messaggi
            if (messageIds.length > 0) {
              step = 4;
              const seqSet = messageIds.join(',');
              socket.write(`A4 FETCH ${seqSet} (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] BODY[TEXT])\r\n`);
              return;
            }
          }
          socket.write(`A9 LOGOUT\r\n`);
          cleanup();
          return resolve([]);
        }
      }

      // Step 4: Fetch Risposta
      if (step === 4) {
        if (buffer.includes('A4 OK') || buffer.includes('A9 OK')) {
          const chunks = buffer.split(/\* \d+ FETCH/);
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const fromMatch = chunk.match(/From:\s*([^\r\n]+)/i);
            const subjectMatch = chunk.match(/Subject:\s*([^\r\n]+)/i);
            const dateMatch = chunk.match(/Date:\s*([^\r\n]+)/i);

            let rawBody = '';
            const textMatch = chunk.match(/BODY\[TEXT\]\s*\{(\d+)\}\r\n([\s\S]*)/i);
            if (textMatch && textMatch[2]) {
              const splitted = textMatch[2].split(/\r\n\)\r\n|\r\n\*\s*\d+\s*FETCH|\r\nA4 OK/);
              rawBody = (splitted[0] || '').trim();
            }

            const cleanText = cleanRawEmailBody(rawBody);

            if (fromMatch && fromMatch[1]) {
              const cleanFrom = fromMatch[1].trim();
              const cleanSubject = subjectMatch && subjectMatch[1] ? subjectMatch[1].trim() : 'Nessun Oggetto';
              const cleanDate = dateMatch && dateMatch[1] ? new Date(dateMatch[1].trim()).toLocaleString('it-IT') : new Date().toLocaleString('it-IT');

              emails.push({
                id: `imap-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                from: cleanFrom,
                subject: cleanSubject,
                date: cleanDate,
                text: cleanText || cleanSubject,
              });
            }
          }

          socket.write(`A9 LOGOUT\r\n`);
          cleanup();
          return resolve(emails);
        }
      }
    });
  });
}

/**
 * Segreto condiviso con il backend. Quando è impostato su Vercel (e nell'ambiente di
 * Railway) questa funzione accetta SOLO le chiamate che lo presentano.
 */
const SEGRETO_RELAY = process.env.EMAIL_RELAY_SECRET || '';

/**
 * Eccezione alla verifica dei certificati TLS, per chi ha un server di posta interno con
 * certificato self-signed. Il nome canonico è `SMTP_INSECURE_TLS`, lo stesso che usa
 * `src/services/emailRelay.ts`: due nomi diversi per la stessa eccezione significherebbero
 * impostarla su Railway e vederla ignorata qui. `SMTP_TLS_INSECURE` resta accettato perché
 * è il nome con cui è nata questa funzione e potrebbe essere già impostato su Vercel.
 */
function tlsInsicuraAmmessa(): boolean {
  const valori = [process.env.SMTP_INSECURE_TLS, process.env.SMTP_TLS_INSECURE];
  return valori.some(v => v === '1' || v === 'true');
}

function relayAutorizzato(req: any): boolean {
  if (!SEGRETO_RELAY) return false;
  const inviato = req.headers?.['x-bluman-relay'];
  const valore = Array.isArray(inviato) ? inviato[0] : inviato;
  if (typeof valore !== 'string' || valore.length === 0) return false;
  // Confronto timing-safe: si confrontano gli SHA-256 dei due valori (stessa lunghezza
  // per costruzione) invece delle stringhe, perché `===` si ferma al primo byte diverso
  // e il tempo di risposta diventa un oracolo su quanta parte del segreto è giusta.
  const hash = (s: string) => nodeCrypto.createHash('sha256').update(s, 'utf8').digest();
  return nodeCrypto.timingSafeEqual(hash(valore), hash(SEGRETO_RELAY));
}

/**
 * Relay SMTP/IMAP a uso del backend (§35): la rete di Railway non lascia passare le porte
 * SMTP verso il provider di posta, quindi il messaggio già composto viene affidato a questa
 * funzione, che gira su un'altra rete. NON è un endpoint per il browser.
 */
export default async function handler(req: any, res: any) {
  // Niente header CORS. Qui c'era `Access-Control-Allow-Origin: '*'`: qualunque sito aperto
  // nel browser di chiunque poteva chiamare questa funzione e — grazie al ripiego sulle
  // variabili d'ambiente — spedire email a nome dello studio senza conoscere una password.
  // Le chiamate legittime arrivano dal backend (server-to-server), che non ha bisogno di CORS.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, errore: 'Metodo non consentito' });
  }

  const autorizzato = relayAutorizzato(req);
  if (SEGRETO_RELAY && !autorizzato) {
    return res.status(401).json({
      success: false,
      errore: 'Relay non autorizzato: header x-bluman-relay assente o non corrispondente.',
    });
  }

  try {
    const {
      action = 'send-message',
      smtpHost = '',
      /**
       * Nome che il certificato SMTP deve attestare, quando è diverso dall'host. Il
       * certificato si verifica comunque: cambia solo il nome contro cui lo si confronta.
       */
      smtpServername = '',
      smtpPort = 465,
      smtpSecure,
      smtpUser = '',
      smtpPass = '',
      smtpFromEmail = '',
      smtpFromName = '',
      smtpReplyTo = '',
      smtpBcc = '',
      to = '',
      subject = '',
      html = '',
      imapHost = '',
      imapPort = 993,
      imapUser = '',
      imapPass = '',
      imapFolder = 'INBOX',
      /** Nome che il certificato IMAP deve attestare, quando è diverso dall'host. */
      imapServername = '',
      /**
       * Forma precedente della stessa richiesta: il backend risolveva l'IP e lo mandava qui
       * come host di rete, tenendo `imapHost` come nome da verificare. Resta accettata perché
       * questa funzione e il backend si distribuiscono separatamente — Vercel al push, Railway
       * con `railway up` — e per qualche minuto le due versioni convivono.
       */
      imapNetworkHost = '',
      clientEmail = '',
    } = req.body || {};

    // ─────────────────────────────────────────────────────────────
    // AZIONE 1: Lettura della posta in arrivo (IMAP) per conto del backend
    // ─────────────────────────────────────────────────────────────
    if (action === 'fetch-imap-inbound') {
      const nomeDichiarato = String(imapServername || '').trim();
      const hostVecchiaForma = String(imapNetworkHost || '').trim();
      // Nella forma nuova `imapHost` è l'indirizzo e `imapServername` il nome da verificare;
      // nella precedente era l'inverso, con l'IP in `imapNetworkHost`.
      const activeHost = (hostVecchiaForma && !nomeDichiarato ? hostVecchiaForma : String(imapHost || '')).trim();
      const activeServername = nomeDichiarato || (hostVecchiaForma ? String(imapHost || '').trim() : '');
      const activeUser = String(imapUser || smtpUser || '').trim();
      const activePass = String(imapPass || smtpPass || '').trim();
      // Prima qui si rispondeva `success: true, emails: []` senza credenziali: la casella
      // risultava «vuota» invece di «non configurata», e le risposte del cliente sembravano
      // non essere mai arrivate (regola 7).
      if (!activeHost || !activeUser || !activePass) {
        return res.status(400).json({
          success: false,
          emails: [],
          errore: 'Casella in arrivo non configurata: mancano host, utente o password IMAP.',
        });
      }

      const incomingEmails = await fetchRecentImapEmails({
        host: activeHost,
        servername: activeServername,
        port: Number(imapPort) || 993,
        user: activeUser,
        pass: activePass,
        folder: imapFolder || 'INBOX',
        limit: 15,
      });

      const targetFilter = (clientEmail || '').toLowerCase().trim();
      const filtered = targetFilter
        ? incomingEmails.filter(e => e.from.toLowerCase().includes(targetFilter) || targetFilter.includes(e.from.toLowerCase()))
        : incomingEmails;

      return res.status(200).json({
        success: true,
        emails: filtered,
      });
    }

    if (action !== 'send-message') {
      // `test-imap` e `invite-collaborator` non esistono più: il test IMAP reale è
      // `POST /tenant/test-imap` sul backend e l'email di invito la compone
      // `sendInvitoCollaboratoreEmail` in `src/services/emailService.ts`, che passa da qui
      // con `send-message`. Un'azione sconosciuta si rifiuta, non si tratta come un test.
      return res.status(400).json({
        success: false,
        errore: `Azione «${action}» non supportata: questa funzione inoltra solo messaggi già composti dal backend.`,
      });
    }

    // La password della casella arriva dalla richiesta. Il ripiego sulle variabili
    // d'ambiente resta solo per le chiamate autenticate dal segreto condiviso: senza quel
    // vincolo era un open proxy, perché consentiva di spedire come lo studio senza
    // conoscerne la password. Regola 6 di `.agents/AGENTS.md`.
    const effectivePass = String(smtpPass || '').trim() || (autorizzato ? process.env.SMTP_PASS : '');
    const effectiveUser = String(smtpUser || '').trim() || (autorizzato ? process.env.SMTP_USER : '');
    const effectiveHost = String(smtpHost || '').trim() || (autorizzato ? process.env.SMTP_HOST : '');

    if (!effectivePass || !effectiveUser || !effectiveHost) {
      return res.status(400).json({
        success: false,
        errore:
          'Credenziali SMTP mancanti: nessuna casella configurata nelle impostazioni dello studio ' +
          'e nessuna variabile SMTP_HOST/SMTP_USER/SMTP_PASS disponibile per questa chiamata.',
      });
    }

    const primaryPort = Number(smtpPort) || 465;
    const primaryHost = effectiveHost;
    // Vale per tutte le porte provate: è una proprietà della casella, non del tentativo.
    const nomeCertificato = String(smtpServername || '').trim();

    // Solo l'host dello studio, con le porte plausibili. Prima la lista conteneva
    // `authsmtp.register.it`, `smtps.register.it` e `mail.register.it`: le credenziali di uno
    // studio su Gmail o Microsoft 365 venivano offerte ai server di Register.it, cioè a un
    // provider terzo che con quello studio non ha niente a che vedere.
    const hostCandidates = [
      { host: primaryHost, port: primaryPort, secure: typeof smtpSecure === 'boolean' ? smtpSecure : primaryPort === 465 },
      { host: primaryHost, port: 465, secure: true },
      { host: primaryHost, port: 587, secure: false },
    ];

    const uniqueCandidates = hostCandidates.filter(
      (c, index, self) => index === self.findIndex(t => t.host === c.host && t.port === c.port)
    );

    // Il destinatario deve essere quello chiesto dal backend. Il ripiego era la casella
    // dello studio (`to || effectiveUser`): un `to` vuoto per un errore a monte spediva la
    // comunicazione del cliente allo studio stesso, e la risposta diceva «recapitata».
    const recipientEmail = String(to || '').trim();
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ success: false, errore: 'Destinatario assente o non valido.' });
    }
    if (!html) {
      return res.status(400).json({ success: false, errore: 'Corpo del messaggio assente: il backend lo compone.' });
    }

    // Il corpo HTML e l'oggetto arrivano già composti dal backend, che conosce lo studio,
    // il fascicolo e la firma. Qui non si aggiunge intestazione: i modelli cablati in questo
    // file mostravano «BLUECODE ADVISORY & CONSULTING» ai clienti di qualunque studio.
    const mittente = String(smtpFromName || '').trim()
      ? `"${String(smtpFromName).trim()}" <${String(smtpFromEmail || effectiveUser).trim()}>`
      : String(smtpFromEmail || effectiveUser).trim();

    const mailOptions: any = {
      from: mittente,
      to: recipientEmail,
      subject: String(subject || '').trim() || 'Comunicazione dallo studio',
      html,
    };

    if (smtpReplyTo) mailOptions.replyTo = smtpReplyTo;
    if (smtpBcc) mailOptions.bcc = smtpBcc;

    // Allegati inviati dal backend quando la rete di Railway non lascia passare l'SMTP: il
    // corpo è JSON, quindi il contenuto arriva in base64 e va riportato a byte prima di
    // consegnarlo a nodemailer. Senza questo, la fattura partiva senza il suo PDF.
    const allegatiRicevuti = Array.isArray(req.body?.allegati) ? req.body.allegati : [];
    if (allegatiRicevuti.length > 0) {
      mailOptions.attachments = allegatiRicevuti
        .filter((a: any) => a?.filename && a?.contentBase64)
        .map((a: any) => ({
          filename: String(a.filename),
          content: Buffer.from(a.contentBase64, 'base64'),
          contentType: a.contentType ? String(a.contentType) : undefined,
        }));
    }

    let lastErr: any = null;
    let success = false;
    let connectedHost = primaryHost;

    for (const cand of uniqueCandidates) {
      try {
        const transporter = nodemailer.createTransport({
          host: cand.host,
          port: cand.port,
          secure: cand.secure,
          auth: { user: effectiveUser, pass: effectivePass },
          // Il certificato si verifica. Qui c'era `rejectUnauthorized: false` fisso: la
          // password della casella viaggiava verso qualunque server sapesse rispondere
          // all'handshake, certificato sbagliato incluso. Chi ha un server di posta interno
          // con certificato self-signed lo dichiara con SMTP_INSECURE_TLS=1.
          // `servername`, quando lo studio lo ha dichiarato, sposta la verifica su quel nome:
          // il certificato deve comunque essere valido e coprirlo.
          tls: {
            rejectUnauthorized: !tlsInsicuraAmmessa(),
            ...(nomeCertificato ? { servername: nomeCertificato } : {}),
          },
          connectionTimeout: 8000,
          greetingTimeout: 7000,
          socketTimeout: 15000,
        });

        await transporter.sendMail(mailOptions);
        success = true;
        connectedHost = `${cand.host}:${cand.port}`;
        break;
      } catch (err: any) {
        lastErr = err;
      }
    }

    if (success) {
      return res.status(200).json({
        success: true,
        message: `✓ Email recapitata a ${recipientEmail} (server ${connectedHost})`,
      });
    }

    return res.status(400).json({
      success: false,
      errore: lastErr?.message || `Nessuna porta utilizzabile verso ${primaryHost}: verifica host, porta e password della casella.`,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      errore: err.message || 'Errore durante la trasmissione email',
    });
  }
}
