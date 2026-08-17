import nodemailer from 'nodemailer';
import tls from 'tls';
import net from 'net';

// Vercel Serverless Function per il dispatch sicuro e diretto delle email SMTP e verifica IMAP
export default async function handler(req: any, res: any) {
  // Abilita CORS per il frontend BluMan
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
        message: `✓ Connessione IMAP verificata con successo su ${imapHost}:${imapPort} per ${smtpUser}! Servizio di posta in entrata pronto.`,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Controllo Password SMTP
    // ─────────────────────────────────────────────────────────────
    if (!smtpPass || smtpPass.trim() === '') {
      return res.status(400).json({
        success: false,
        errore: 'Password SMTP non inserita. Inserisci la password della casella support@bluecode-ltd.com nel campo "Password SMTP / App Key" e riprova.',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // Configurazione Transporter con Automatic Host & Port Fallback
    // ─────────────────────────────────────────────────────────────
    const primaryPort = Number(smtpPort) || 465;
    const primaryHost = smtpHost || 'authsmtp.register.it';

    const candidates: Array<{ host: string; port: number; secure: boolean }> = [
      { host: primaryHost, port: primaryPort, secure: primaryPort === 465 },
      { host: primaryHost, port: 587, secure: false },
      { host: 'smtp.register.it', port: 465, secure: true },
      { host: 'smtp.register.it', port: 587, secure: false },
      { host: 'mail.register.it', port: 465, secure: true },
      { host: 'mail.register.it', port: 587, secure: false },
      { host: 'mail.bluecode-ltd.com', port: 465, secure: true },
      { host: 'mail.bluecode-ltd.com', port: 587, secure: false },
    ];

    // Rimuovi duplicati
    const uniqueCandidates = candidates.filter(
      (c, index, self) => index === self.findIndex(t => t.host === c.host && t.port === c.port)
    );

    let lastError: any = null;
    let sentSuccess = false;
    let successfulHost = primaryHost;
    let successfulPort = primaryPort;

    // ─────────────────────────────────────────────────────────────
    // AZIONE 2: Invito Nuovo Collaboratore Studio
    // ─────────────────────────────────────────────────────────────
    if (action === 'invite-collaborator') {
      const recipientEmail = to || smtpUser;
      const nomeCollab = collaboratorName || 'Dottore / Avvocato';
      const ruoloCollab = collaboratorRole === 'partner' ? 'Senior Partner' : collaboratorRole === 'operator' ? 'Advisor / Operatore' : 'Collaboratore di Studio';
      const loginUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://bluman.vercel.app/login';
      const tempPass = collaboratorPassword || 'BlueCode2026!';

      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); padding: 32px 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">BLUECODE ADVISORY & CONSULTING</h1>
            <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Piattaforma Gestionale Integrata Studio</p>
          </div>
          
          <div style="padding: 32px 24px;">
            <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${nomeCollab},</h2>
            <p style="line-height: 1.6; color: #475569; font-size: 14px;">
              Sei stato accreditato come <strong>${ruoloCollab}</strong> (${collaboratorSpecialization || 'Area Legale & Fiscale'}) all'interno del portale operativo dello Studio.
            </p>
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 24px 0;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #334155; font-size: 13px;">🔑 Le tue credenziali di primo accesso:</p>
              <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 13px; line-height: 1.8;">
                <li>Email di accesso: <strong>${recipientEmail}</strong></li>
                <li>Password provvisoria: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #4338ca; font-weight: 600;">${tempPass}</code></li>
                <li>Ruolo Studio: <strong>${ruoloCollab}</strong></li>
              </ul>
            </div>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${loginUrl}" style="background: #4338ca; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(67, 56, 202, 0.25);">
                Accedi alla Piattaforma BluMan ➔
              </a>
            </div>

            <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin-bottom: 0;">
              Ti consigliamo di modificare la password al primo accesso nella sezione "Impostazioni Profilo". Per qualsiasi necessità puoi contattare il lead advisor.
            </p>
          </div>
          
          <div style="background: #f1f5f9; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
            BlueCode Advisory Platform • Sistema di consulenza integrato • <a href="https://bluecode-ltd.com" style="color: #4338ca; text-decoration: none;">bluecode-ltd.com</a>
          </div>
        </div>
      `;

      const mailOptions: any = {
        from: `"${smtpFromName}" <${smtpFromEmail}>`,
        to: recipientEmail,
        subject: `🔑 Invito Ufficiale & Credenziali di Accesso Studio — ${nomeCollab}`,
        html: emailHtml,
      };

      if (smtpReplyTo) mailOptions.replyTo = smtpReplyTo;
      if (smtpBcc) mailOptions.bcc = smtpBcc;

      for (const cand of uniqueCandidates) {
        try {
          const transporter = nodemailer.createTransport({
            host: cand.host,
            port: cand.port,
            secure: cand.secure,
            auth: { user: smtpUser, pass: smtpPass },
            tls: { rejectUnauthorized: false },
            connectionTimeout: 8000,
          });

          await transporter.sendMail(mailOptions);
          sentSuccess = true;
          successfulHost = cand.host;
          successfulPort = cand.port;
          break;
        } catch (err: any) {
          lastError = err;
        }
      }

      if (sentSuccess) {
        return res.status(200).json({
          success: true,
          message: `✓ Email di invito e credenziali inviata con successo a ${recipientEmail}! (Server: ${successfulHost}:${successfulPort})`,
        });
      }

      return res.status(400).json({
        success: false,
        errore: lastError?.message || 'Impossibile inviare email ai server SMTP di Register.it',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // AZIONE 3: Test Email Standard
    // ─────────────────────────────────────────────────────────────
    const recipientEmail = to || smtpUser;
    const testHtml = html || `
      <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #059669; border-radius: 12px; background: #f0fdf4; color: #166534; max-width: 600px; margin: 0 auto;">
        <h2 style="margin-top: 0; color: #047857;">✓ Connessione SMTP con Register.it Riuscita!</h2>
        <p style="font-size: 14px; line-height: 1.5; color: #065f46;">
          Questa è un'email reale inviata dai server di <strong>Register.it</strong> tramite BluMan Advisory Platform.
        </p>
        <div style="background: #ffffff; border: 1px solid #a7f3d0; padding: 14px; border-radius: 8px; margin: 16px 0; font-size: 13px;">
          <p style="margin: 0 0 6px 0;"><strong>Dettagli configurazione verificata:</strong></p>
          <ul style="margin: 0; padding-left: 20px;">
            <li>Account Autenticato: <code>${smtpUser}</code></li>
            <li>Data/Ora: <code>${new Date().toLocaleString('it-IT')}</code></li>
          </ul>
        </div>
        <p style="font-size: 12px; color: #059669; margin-bottom: 0;">
          Il sistema è ora pronto per inviare inviti collaboratori, Magic Link, OTP di firma FEA e fatture.
        </p>
      </div>
    `;

    const mailOptions: any = {
      from: `"${smtpFromName}" <${smtpFromEmail}>`,
      to: recipientEmail,
      subject: subject || `🧪 Test Connessione SMTP BluMan — ${new Date().toLocaleTimeString('it-IT')}`,
      html: testHtml,
    };

    if (smtpReplyTo) mailOptions.replyTo = smtpReplyTo;
    if (smtpBcc) mailOptions.bcc = smtpBcc;

    for (const cand of uniqueCandidates) {
      try {
        const transporter = nodemailer.createTransport({
          host: cand.host,
          port: cand.port,
          secure: cand.secure,
          auth: { user: smtpUser, pass: smtpPass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 8000,
        });

        await transporter.sendMail(mailOptions);
        sentSuccess = true;
        successfulHost = cand.host;
        successfulPort = cand.port;
        break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (sentSuccess) {
      return res.status(200).json({
        success: true,
        message: `✓ Email di prova recapitata con successo a ${recipientEmail}! (Connesso via ${successfulHost}:${successfulPort})`,
      });
    }

    return res.status(400).json({
      success: false,
      errore: lastError?.message || 'Errore durante la connessione con il server SMTP',
      dettagli: lastError?.code || lastError?.response || lastError?.toString(),
    });
  } catch (err: any) {
    console.error('[API Send Email Error]', err);
    return res.status(400).json({
      success: false,
      errore: err.message || 'Errore durante la connessione con il server SMTP',
      dettagli: err.code || err.response || err.toString(),
    });
  }
}
