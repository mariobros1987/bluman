import nodemailer from 'nodemailer';
import tls from 'tls';
import net from 'net';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export function createTransporter(customConfig?: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}) {
  const host = customConfig?.host || process.env.SMTP_HOST;
  const port = customConfig?.port || Number(process.env.SMTP_PORT ?? 465);
  const secure = customConfig?.secure !== undefined ? customConfig.secure : port === 465;
  const user = customConfig?.user || process.env.SMTP_USER;
  const pass = customConfig?.pass || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // Fallback modalità simulazione
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000,
  });
}

export async function verifyAndSendTestSmtp(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail?: string;
  fromName?: string;
  toEmail?: string;
}): Promise<{ success: boolean; message: string; errore?: string }> {
  const candidates: Array<{ host: string; port: number; secure: boolean }> = [
    { host: options.host, port: options.port, secure: options.secure },
    { host: options.host, port: 465, secure: true },
    { host: options.host, port: 587, secure: false },
    { host: 'authsmtp.register.it', port: 465, secure: true },
    { host: 'authsmtp.register.it', port: 587, secure: false },
    { host: 'authsmtp.register.it', port: 25, secure: false },
    { host: 'smtps.register.it', port: 465, secure: true },
    { host: 'smtps.register.it', port: 587, secure: false },
    { host: 'smtp.register.it', port: 465, secure: true },
    { host: 'smtp.register.it', port: 587, secure: false },
    { host: 'mail.register.it', port: 465, secure: true },
    { host: 'mail.register.it', port: 587, secure: false },
    { host: 'mail.bluecode-ltd.com', port: 465, secure: true },
    { host: 'mail.bluecode-ltd.com', port: 587, secure: false },
  ];

  const uniqueCandidates = candidates.filter(
    (c, index, self) => index === self.findIndex(t => t.host === c.host && t.port === c.port)
  );

  const targetEmail = options.toEmail || options.user;
  const from = options.fromEmail || options.user;
  const senderName = options.fromName || 'BlueCode Advisory';

  let lastError: any = null;

  for (const cand of uniqueCandidates) {
    try {
      const transporter = nodemailer.createTransport({
        host: cand.host,
        port: cand.port,
        secure: cand.secure,
        auth: {
          user: options.user,
          pass: options.pass,
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 8000,
      });

      await transporter.sendMail({
        from: `"${senderName}" <${from}>`,
        to: targetEmail,
        subject: `🧪 Test Connessione SMTP BluMan — ${new Date().toLocaleTimeString('it-IT')}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #059669; border-radius: 12px; background: #f0fdf4; color: #166534; max-width: 600px; margin: 0 auto;">
            <h2 style="margin-top: 0; color: #047857;">✓ Connessione SMTP con Register.it Riuscita!</h2>
            <p style="font-size: 14px; line-height: 1.5; color: #065f46;">
              Questa è un'email reale inviata dai server di <strong>Register.it</strong> tramite BluMan Advisory Platform.
            </p>
            <div style="background: #ffffff; border: 1px solid #a7f3d0; padding: 14px; border-radius: 8px; margin: 16px 0; font-size: 13px;">
              <p style="margin: 0 0 6px 0;"><strong>Dettagli configurazione verificata:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Account Autenticato: <code>${options.user}</code></li>
                <li>Data/Ora: <code>${new Date().toLocaleString('it-IT')}</code></li>
              </ul>
            </div>
            <p style="font-size: 12px; color: #059669; margin-bottom: 0;">
              Il sistema è ora pronto per inviare inviti collaboratori, Magic Link, OTP di firma FEA e fatture.
            </p>
          </div>
        `,
      });

      return {
        success: true,
        message: `✓ Connessione SMTP verificata ed email reale di test recapitata con successo a ${targetEmail}! (Host: ${cand.host}:${cand.port})`,
      };
    } catch (err: any) {
      lastError = err;
    }
  }

  console.error('[SMTP Real Test Error]', lastError);
  return {
    success: false,
    message: `❌ Errore SMTP: ${lastError?.message || 'Autenticazione o connessione fallita su Register.it'}`,
    errore: lastError?.message,
  };
}

export async function verifyRealImap(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}): Promise<{ success: boolean; message: string; errore?: string }> {
  return new Promise((resolve) => {
    const timeoutMs = 12000;
    let finished = false;

    const onDone = (res: { success: boolean; message: string; errore?: string }) => {
      if (!finished) {
        finished = true;
        resolve(res);
      }
    };

    const timer = setTimeout(() => {
      onDone({
        success: false,
        message: `❌ Timeout connessione IMAP a ${options.host}:${options.port} dopo 12s`,
        errore: 'Connection Timeout',
      });
    }, timeoutMs);

    try {
      const socket = options.secure
        ? tls.connect({ host: options.host, port: options.port, rejectUnauthorized: false }, () => {
            // Handshake TLS completato
          })
        : net.connect({ host: options.host, port: options.port }, () => {
            // Handshake Plain completato
          });

      socket.setTimeout(timeoutMs);

      socket.on('data', (data) => {
        const str = data.toString();
        if (str.includes('* OK')) {
          // Banner IMAP di Register.it ricevuto, inviamo comando di autenticazione LOGIN
          socket.write(`A01 LOGIN "${options.user}" "${options.pass}"\r\n`);
        } else if (str.includes('A01 OK')) {
          clearTimeout(timer);
          socket.end();
          onDone({
            success: true,
            message: `✓ Connessione IMAP e autenticazione RIUSCITE su ${options.host}:${options.port} per ${options.user}! Servizio posta in entrata attivo.`,
          });
        } else if (str.includes('A01 NO') || str.includes('A01 BAD')) {
          clearTimeout(timer);
          socket.end();
          onDone({
            success: false,
            message: `❌ Errore autenticazione IMAP da ${options.host}: Password o Username errati (${str.trim()})`,
            errore: str.trim(),
          });
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        onDone({
          success: false,
          message: `❌ Errore socket IMAP (${options.host}:${options.port}): ${err.message}`,
          errore: err.message,
        });
      });
    } catch (err: any) {
      clearTimeout(timer);
      onDone({
        success: false,
        message: `❌ Impossibile stabilire socket IMAP: ${err.message}`,
        errore: err.message,
      });
    }
  });
}

export async function sendMagicLinkEmail(
  toEmail: string,
  clienteNome: string,
  magicUrl: string,
  customConfig?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
    fromName?: string;
  }
): Promise<boolean> {
  const host = customConfig?.host || process.env.SMTP_HOST || 'authsmtp.register.it';
  const port = customConfig?.port || Number(process.env.SMTP_PORT ?? 465);
  const secure = customConfig?.secure !== undefined ? customConfig.secure : (port === 465);
  const user = customConfig?.user || process.env.SMTP_USER;
  const pass = customConfig?.pass || process.env.SMTP_PASS;
  const fromEmail = customConfig?.fromEmail || user || process.env.SMTP_FROM || 'support@bluecode-ltd.com';
  const fromName = customConfig?.fromName || 'BluMan Advisory';

  if (!user || !pass) {
    console.log(`[Email Simulation] Invio Magic Link a ${toEmail}: ${magicUrl}`);
    return false;
  }

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

  const candidates = [
    { host, port, secure },
    { host: 'authsmtp.register.it', port: 465, secure: true },
    { host: 'authsmtp.register.it', port: 587, secure: false },
    { host: 'authsmtp.register.it', port: 25, secure: false },
  ];

  const uniqueCandidates = candidates.filter(
    (c, idx, arr) => arr.findIndex(x => x.host === c.host && x.port === c.port) === idx
  );

  for (const cand of uniqueCandidates) {
    try {
      const transporter = nodemailer.createTransport({
        host: cand.host,
        port: cand.port,
        secure: cand.secure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000,
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: toEmail,
        subject: `🔑 Accesso al Portale Cliente — ${clienteNome}`,
        html,
      });
      console.log(`[SMTP] Email Magic Link inviata con successo a ${toEmail} via ${cand.host}:${cand.port}`);
      return true;
    } catch (err: any) {
      console.warn(`[SMTP Magic Link] Tentativo fallito su ${cand.host}:${cand.port}:`, err?.message);
    }
  }

  return false;
}

export async function sendOtpSecurityEmail(toEmail: string, clienteNome: string, otpCode: string): Promise<boolean> {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || 'support@bluecode-ltd.com';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0; font-size: 24px; font-weight: 700;">BluMan Advisory</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Firma Elettronica Avanzata (FEA) eIDAS</p>
      </div>
      <div style="padding: 32px 24px; text-align: center;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${clienteNome},</h2>
        <p style="line-height: 1.6; color: #475569;">Ecco il tuo codice di sicurezza monouso (OTP) a 6 cifre per la firma digitale dell'Engagement Letter:</p>
        <div style="margin: 28px 0; background: #f1f5f9; padding: 20px; border-radius: 12px; display: inline-block;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #4338ca; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="font-size: 13px; color: #64748b;">⏳ Questo codice ha una validità massima di <strong>5 minuti</strong>.</p>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; line-height: 1.5;">Non condividere questo codice con nessuno. Se non hai richiesto tu la firma, contatta immediatamente il tuo advisor.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        BluMan Advisory Platform • Sigillo Digitale Conforme eIDAS UE 910/2014
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`[Email Simulation] Invio Codice OTP ${otpCode} a ${toEmail}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"BluMan Security" <${fromEmail}>`,
      to: toEmail,
      subject: `🔐 Codice OTP di Sicurezza: ${otpCode} — Firma Incarico BluMan`,
      html,
    });
    console.log(`[SMTP] Email OTP ${otpCode} inviata a ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[SMTP Error] Errore invio email OTP:', err);
    return false;
  }
}

export async function sendClientCredentialsEmail(
  toEmail: string,
  clienteNome: string,
  passwordChiaro: string,
  portalUrl?: string,
  customConfig?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
    fromName?: string;
  }
): Promise<boolean> {
  const host = customConfig?.host || process.env.SMTP_HOST || 'authsmtp.register.it';
  const port = customConfig?.port || Number(process.env.SMTP_PORT ?? 465);
  const secure = customConfig?.secure !== undefined ? customConfig.secure : (port === 465);
  const user = customConfig?.user || process.env.SMTP_USER;
  const pass = customConfig?.pass || process.env.SMTP_PASS;
  const fromEmail = customConfig?.fromEmail || user || process.env.SMTP_FROM || 'support@bluecode-ltd.com';
  const fromName = customConfig?.fromName || 'BluMan Advisory';
  const url = portalUrl || 'https://bluman.vercel.app/portal';

  if (!user || !pass) {
    console.log(`[Email Simulation] Invio Credenziali a ${toEmail}: ${url} (Password: ${passwordChiaro})`);
    return false;
  }

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

  const candidates = [
    { host, port, secure },
    { host: 'authsmtp.register.it', port: 465, secure: true },
    { host: 'authsmtp.register.it', port: 587, secure: false },
    { host: 'authsmtp.register.it', port: 25, secure: false },
  ];

  const uniqueCandidates = candidates.filter(
    (c, idx, arr) => arr.findIndex(x => x.host === c.host && x.port === c.port) === idx
  );

  for (const cand of uniqueCandidates) {
    try {
      const transporter = nodemailer.createTransport({
        host: cand.host,
        port: cand.port,
        secure: cand.secure,
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000,
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: toEmail,
        subject: `🔑 Credenziali di Accesso al Portale — ${clienteNome}`,
        html,
      });
      console.log(`[SMTP] Email Credenziali inviata con successo a ${toEmail} via ${cand.host}:${cand.port}`);
      return true;
    } catch (err: any) {
      console.warn(`[SMTP Credentials] Tentativo fallito su ${cand.host}:${cand.port}:`, err?.message);
    }
  }

  return false;
}
