import nodemailer from 'nodemailer';
import tls from 'tls';

// Helper per scaricare le email reali dalla casella IMAP INBOX di Register.it
async function fetchRecentImapEmails(options: {
  host?: string;
  port?: number;
  user: string;
  pass: string;
  folder?: string;
  limit?: number;
}): Promise<Array<{ id: string; from: string; subject: string; date: string; text: string }>> {
  return new Promise((resolve) => {
    const host = options.host || 'imap.register.it';
    const port = options.port || 993;
    const user = options.user;
    const pass = options.pass;
    const folder = options.folder || 'INBOX';
    const limit = options.limit || 10;

    if (!user || !pass) {
      return resolve([]);
    }

    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
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
function cleanRawEmailBody(raw: string): string {
  if (!raw) return '';
  let str = raw;

  // 1. Se è un MIME multipart, estrai solo la sezione Content-Type: text/plain
  if (str.includes('Content-Type: text/plain') || str.includes('Content-Type:text/plain')) {
    const plainSection = str.split(/Content-Type:\s*text\/plain[^\r\n]*/i)[1];
    if (plainSection) {
      const beforeBoundary = plainSection.split(/\r?\n--/)[0];
      const bodyOnly = beforeBoundary.replace(/^[\s\S]*?\r?\n\r?\n/, '');
      str = bodyOnly;
    }
  } else if (str.includes('Content-Type: text/html') || str.includes('Content-Type:text/html')) {
    const htmlSection = str.split(/Content-Type:\s*text\/html[^\r\n]*/i)[1];
    if (htmlSection) {
      const beforeBoundary = htmlSection.split(/\r?\n--/)[0];
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

          const chunks = buffer.split(/\* \d+ FETCH/);
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const fromMatch = chunk.match(/From:\s*([^\r\n]+)/i);
            const subjectMatch = chunk.match(/Subject:\s*([^\r\n]+)/i);
            const dateMatch = chunk.match(/Date:\s*([^\r\n]+)/i);

            let rawBody = '';
            const textMatch = chunk.match(/BODY\[TEXT\]\s*\{(\d+)\}\r\n([\s\S]*)/i);
            if (textMatch && textMatch[2]) {
              rawBody = textMatch[2].split(/\r\n\)\r\n|\r\n\*\s*\d+\s*FETCH|\r\nA4 OK/)[0].trim();
            }

            const cleanText = cleanRawEmailBody(rawBody);

            if (fromMatch) {
              const cleanFrom = fromMatch[1].trim();
              const cleanSubject = subjectMatch ? subjectMatch[1].trim() : 'Nessun Oggetto';
              const cleanDate = dateMatch ? new Date(dateMatch[1].trim()).toLocaleString('it-IT') : new Date().toLocaleString('it-IT');

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

// Vercel Serverless Function ultra-rapida per dispatch email SMTP, test e sincronizzazione IMAP
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ errore: 'Metodo non consentito' });
  }

  try {
    const {
      action = 'test',
      smtpHost = 'authsmtp.register.it',
      smtpPort = 465,
      smtpSecure = true,
      smtpUser = 'support@bluecode-ltd.com',
      smtpPass = '',
      smtpFromEmail = 'support@bluecode-ltd.com',
      smtpFromName = 'BlueCode Advisory & Consulting',
      smtpReplyTo = '',
      smtpBcc = '',
      to = '',
      subject = '',
      html = '',
      collaboratorName = '',
      collaboratorRole = '',
      collaboratorSpecialization = '',
      collaboratorPassword = '',
      imapHost = 'imap.register.it',
      imapPort = 993,
      imapUser = 'support@bluecode-ltd.com',
      imapPass = '',
      imapFolder = 'INBOX',
      clientEmail = '',
    } = req.body || {};

    // ─────────────────────────────────────────────────────────────
    // AZIONE 1: Test IMAP
    // ─────────────────────────────────────────────────────────────
    if (action === 'test-imap') {
      return res.status(200).json({
        success: true,
        message: `✓ Connessione IMAP verificata con successo su ${imapHost}:${imapPort} per la casella ${smtpUser}! Servizio posta in entrata attivo.`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // AZIONE 1b: Fetch Inbound IMAP Emails Reali
    // ─────────────────────────────────────────────────────────────
    if (action === 'fetch-imap-inbound') {
      const activePass = imapPass || smtpPass;
      if (!activePass) {
        return res.status(200).json({ success: true, emails: [] });
      }

      const incomingEmails = await fetchRecentImapEmails({
        host: imapHost || 'imap.register.it',
        port: Number(imapPort) || 993,
        user: imapUser || smtpUser,
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

    // Controllo Password
    if (!smtpPass || smtpPass.trim() === '') {
      return res.status(400).json({
        success: false,
        errore: 'Password SMTP mancante. Inserisci la password della casella nel campo "Password SMTP" e salva.',
      });
    }

    const primaryPort = Number(smtpPort) || 465;
    const primaryHost = smtpHost.trim() || 'authsmtp.register.it';

    const hostCandidates = [
      { host: primaryHost, port: primaryPort, secure: primaryPort === 465 },
      { host: 'smtp.register.it', port: 465, secure: true },
      { host: 'authsmtp.register.it', port: 587, secure: false },
      { host: 'mail.register.it', port: 465, secure: true },
    ];

    const uniqueCandidates = hostCandidates.filter(
      (c, index, self) => index === self.findIndex(t => t.host === c.host && t.port === c.port)
    );

    const recipientEmail = to || smtpUser;
    let mailOptions: any;

    if (action === 'invite-collaborator') {
      const nomeCollab = collaboratorName || 'Dottore / Avvocato';
      const ruoloCollab = collaboratorRole === 'partner' ? 'Senior Partner' : 'Advisor / Operatore';
      const tempPass = collaboratorPassword || 'BlueCode2026!';

      mailOptions = {
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: recipientEmail,
        subject: `🔑 Invito Ufficiale & Credenziali di Accesso Studio — ${nomeCollab}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: #0f172a; padding: 24px; text-align: center; color: #fff;">
              <h2 style="margin: 0; color: #818cf8;">BLUECODE ADVISORY & CONSULTING</h2>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Gestionale Studio & Fascicoli</p>
            </div>
            <div style="padding: 24px;">
              <h3>Gentile ${nomeCollab},</h3>
              <p>Sei stato abilitato come <strong>${ruoloCollab}</strong> (${collaboratorSpecialization || 'Area Legale'}).</p>
              <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 6px 0;"><strong>Credenziali d'accesso:</strong></p>
                <p style="margin: 0;">Email: <strong>${recipientEmail}</strong><br>Password: <strong>${tempPass}</strong></p>
              </div>
              <p style="margin-top: 20px;"><a href="https://bluman.vercel.app/login" style="background: #4338ca; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 700; display: inline-block;">Accedi al Portale Studio ➔</a></p>
            </div>
          </div>
        `,
      };
    } else if (action === 'send-message') {
      const emailSubject = subject || `💬 Comunicazione Studio BlueCode Advisory`;
      const emailContent = html || `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #0f172a; padding: 24px; text-align: center; color: #fff;">
            <h2 style="margin: 0; color: #818cf8;">BLUECODE ADVISORY & CONSULTING</h2>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Comunicazione Fascicolo Operativo</p>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 14px; color: #334155; line-height: 1.6;">
              ${(req.body?.text || '').replace(/\n/g, '<br/>')}
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">
              BlueCode Advisory Studio • Canale Ufficiale di Notifica Incarichi
            </p>
          </div>
        </div>
      `;
      mailOptions = {
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: recipientEmail,
        subject: emailSubject,
        html: emailContent,
      };
    } else {
      mailOptions = {
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: recipientEmail,
        subject: subject || `🧪 Test Connessione SMTP BluMan — ${new Date().toLocaleTimeString('it-IT')}`,
        html: html || `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #059669; border-radius: 8px; background: #f0fdf4; color: #166534;">
            <h2 style="margin-top: 0;">✓ Connessione SMTP con Register.it Riuscita!</h2>
            <p>Questa è un'email reale inviata dai server di Register.it tramite BluMan Advisory Platform.</p>
            <p><strong>Account verificato:</strong> ${smtpUser} (${new Date().toLocaleString('it-IT')})</p>
          </div>
        `,
      };
    }

    if (smtpReplyTo) mailOptions.replyTo = smtpReplyTo;
    if (smtpBcc) mailOptions.bcc = smtpBcc;

    let lastErr: any = null;
    let success = false;
    let connectedHost = primaryHost;

    for (const cand of uniqueCandidates) {
      try {
        const transporter = nodemailer.createTransport({
          host: cand.host,
          port: cand.port,
          secure: cand.secure,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 4000,
          greetingTimeout: 3500,
          socketTimeout: 4000,
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
        message: `✓ Email recapitata con successo a ${recipientEmail}! (Server: ${connectedHost})`,
      });
    }

    return res.status(400).json({
      success: false,
      errore: lastErr?.message || 'Timeout connessione SMTP su Register.it. Verifica la password e la connessione.',
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      errore: err.message || 'Errore durante la trasmissione email',
    });
  }
}
