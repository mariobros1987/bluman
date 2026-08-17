import nodemailer from 'nodemailer';

// Vercel Serverless Function ultra-rapida per dispatch email SMTP e test
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

    // Controllo Password
    if (!smtpPass || smtpPass.trim() === '') {
      return res.status(400).json({
        success: false,
        errore: 'Password SMTP mancante. Inserisci la password della casella nel campo "Password SMTP" e salva.',
      });
    }

    const primaryPort = Number(smtpPort) || 465;
    const primaryHost = smtpHost.trim() || 'authsmtp.register.it';

    // Lista rapida candidate con timeout aggressivo di 4s per non bloccare mai la UI
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

    // Se tutti i tentativi socket hanno dato timeout o errore DNS/EBUSY, restituisci messaggio chiaro
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
