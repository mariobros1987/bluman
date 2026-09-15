// Flusso critico 2: magic link → portale cliente passwordless → firma SES
// dell'engagement letter con OTP via email.
//
// Copre: POST /clienti/:id/magic-link (advisor) → apertura del magic token in
// /portal (sessione cliente, JWT ruolo 'cliente') → scelta della firma OTP →
// canale email verso Mailpit → POST /portal/request-otp → il codice letto
// dalla casella di test → POST /portal/conferma-firma in modalità SES (senza
// firma grafica) → sigillo di firma con Signature ID.
//
// Se l'invio dell'email fallisse il backend annulerebbe l'OTP e risponderebbe
// 502 (src/routes/firma.ts): per questo il flusso passa da un SMTP vero, per
// quanto di test — Mailpit — e non da un mock della chiamata.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E, loginStaff, leggiOtpDaMailpit } from './helpers';

test('magic link → firma SES della lettera d\'incarico con OTP email', async ({ page, request }) => {
  // Lo studio emette il magic link per Belfort dalla propria sessione advisor.
  const tokenAdvisor = await loginStaff(request, AMBIENTE_E2E.advisorEmail, AMBIENTE_E2E.password);
  const resLink = await request.post(
    `${AMBIENTE_E2E.apiBase}/clienti/${AMBIENTE_E2E.clienteBelfort.id}/magic-link`,
    {
      headers: { Authorization: `Bearer ${tokenAdvisor}` },
      data: { email: AMBIENTE_E2E.clienteBelfort.email },
    },
  );
  expect(resLink.ok()).toBeTruthy();
  const { magicUrl } = await resLink.json();
  expect(magicUrl).toContain('/portal?magic_token=');

  // Il cliente apre il link: il token viene consumato e la sessione portale parte
  // sulla tab di default (la proposta).
  await page.goto(magicUrl);
  await expect(page.getByRole('button', { name: "✍️ 1. Proposta d'Ordine & Firma" })).toBeVisible();

  // Scelta della modalità di firma: online con codice OTP.
  await page.getByText('Firma online con codice OTP').first().click();

  // Canale email (l'unico disponibile nell'ambiente E2E: WhatsApp e Telegram
  // non hanno credenziali sulla riga tenant).
  await expect(page.getByText('Dove vuoi ricevere il codice di firma?')).toBeVisible();
  await page.getByText('Email', { exact: true }).first().click();
  await page.getByRole('button', { name: '📲 Invia il codice via Email e firma' }).click();

  // Il codice arriva nella casella di test: lo si legge dall'API di Mailpit.
  const otp = await leggiOtpDaMailpit(request);

  const inputOtp = page.getByPlaceholder('• • • • • •');
  await expect(inputOtp).toBeVisible();
  await inputOtp.fill(otp);

  // Percorso SES: firma senza apporre la firma grafica (ammessa per la lettera
  // d'incarico; la FEA la esigerebbe).
  await page.getByRole('button', { name: 'Firma senza apporre la firma grafica' }).click();

  // Il sigillo di successo con lo Signature ID chiude il flusso.
  await expect(page.getByText('Sigillo Univoco:')).toBeVisible();
});
