import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // Fallback modalità simulazione
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendMagicLinkEmail(toEmail: string, clienteNome: string, magicUrl: string): Promise<boolean> {
  const transporter = createTransporter();
  const fromEmail = process.env.SMTP_FROM || 'noreply@blumanadvisory.com';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background-color: #0f172a; padding: 24px; text-align: center;">
        <h1 style="color: #6366f1; margin: 0; font-size: 24px; font-weight: 700;">BluMan Advisory</h1>
        <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">Portale Cliente Riservato</p>
      </div>
      <div style="padding: 32px 24px;">
        <h2 style="margin-top: 0; font-size: 18px; color: #0f172a;">Gentile ${clienteNome},</h2>
        <p style="line-height: 1.6; color: #475569;">È pronto il tuo accesso riservato per la firma della proposta d'ordine e la consultazione live dello stato di avanzamento dei lavori.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${magicUrl}" style="background-color: #6366f1; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Accedi al Portale Cliente ➔</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">Questo link d'accesso è personale ed ha una durata limitata. Se non hai richiesto tu questo link, puoi ignorare questa email.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
        BluMan Advisory Platform • Sistema di consulenza integrato
      </div>
    </div>
  `;

  if (!transporter) {
    console.log(`[Email Simulation] Invio Magic Link a ${toEmail}: ${magicUrl}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"BluMan Advisory" <${fromEmail}>`,
      to: toEmail,
      subject: `🔑 Accesso al Portale Cliente — ${clienteNome}`,
      html,
    });
    console.log(`[SMTP] Email Magic Link inviata con successo a ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[SMTP Error] Errore invio email:', err);
    return false;
  }
}
