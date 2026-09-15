// Helper condivisi dagli E2E. Deliberatamente autonomi: nessuna importazione
// dal codice dell'app, così Playwright li trascrive senza dipendere dai path
// alias o dai tsconfig del backend.
import type { APIRequestContext } from '@playwright/test';

export const AMBIENTE_E2E = {
  apiBase: 'http://localhost:3000',
  mailpit: 'http://localhost:8025',
  tenantId: '00000000-0000-0000-0000-000000000001',
  // Valori impostati dall'overlay (src/scripts/seedE2E.ts, lanciato da
  // scripts/e2e/prepara.mjs con la stessa variabile d'ambiente).
  password: process.env.E2E_PASSWORD || 'E2e-BluMan-2026',
  invitatoEmail: 'mario.dibenedetto@bluecode.advisory',
  advisorEmail: 'lorenzo.marino@bluecode.advisory',
  clienteBelfort: { id: 'cli-03', email: 'jp.belfort@belfort-sa.lu' },
  progettoNome: 'Incarico E2E — Belfort Industries',
} as const;

/** Login staff via API: restituisce il JWT (niente TOTP: gli utenti del seed non ce l'hanno). */
export async function loginStaff(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${AMBIENTE_E2E.apiBase}/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login di ${email} fallita: ${res.status()} ${await res.text()}`);
  }
  const corpo = await res.json();
  if (!corpo?.token) {
    throw new Error(`Risposta di login senza token per ${email}: ${JSON.stringify(corpo)}`);
  }
  return corpo.token as string;
}

/**
 * L'OTP di firma arrivato via email: legge Mailpit e cerca il codice a 6 cifre
 * nel corpo dell'ultima email. Svuota la coda prima di tornare, così una
 * chiamata successiva (reinvio) non rilegge il codice vecchio.
 *
 * L'email di firma (emailService.ts, sendOtpSecurityEmail) ha oggetto
 * «🔐 Codice di sicurezza per … — BluMan» e il codice sta in uno span
 * monospace dell'HTML — l'invio è solo HTML, quindi il campo Text di Mailpit
 * è vuoto e la riga «Codice di firma BluMan: 123456» esiste solo nel testo
 * WhatsApp (otpDispatch.ts), mai nell'email.
 */
export async function leggiOtpDaMailpit(request: APIRequestContext, timeoutMs = 20_000): Promise<string> {
  const inizio = Date.now();
  while (Date.now() - inizio < timeoutMs) {
    const res = await request.get(`${AMBIENTE_E2E.mailpit}/api/v1/messages`);
    if (res.ok()) {
      const { messages = [] } = await res.json();
      // Dalla più recente: l'OTP cercato è quasi sempre l'ultimo arrivato.
      for (const messaggio of messages.reverse()) {
        if (!/Codice di sicurezza/i.test(messaggio.Subject ?? '')) continue;
        const dettaglio = await request.get(`${AMBIENTE_E2E.mailpit}/api/v1/message/${messaggio.ID}`);
        if (!dettaglio.ok()) continue;
        const corpo = await dettaglio.json();
        // Lo span monospace del template è il marcatore più preciso; il ripiego
        // cerca il codice anche in un template futuro senza quello stile.
        const html = String(corpo.HTML ?? '');
        const otp = html.match(/monospace;">\s*(\d{6})\s*<\/span>/) ?? html.match(/(?:^|\D)(\d{6})(?:\D|$)/);
        if (otp) {
          await request.delete(`${AMBIENTE_E2E.mailpit}/api/v1/messages`);
          return otp[1];
        }
      }
    }
    await new Promise((risolvi) => setTimeout(risolvi, 500));
  }
  throw new Error(`Nessuna email con OTP trovata in Mailpit entro ${timeoutMs} ms`);
}
