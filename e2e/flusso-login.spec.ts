// Flusso critico 1: login di un utente invitato con cambio password obbligatorio.
//
// Copre: LoginPage → JWT in localStorage → modale «Primo Accesso» (l'utente
// con stato «invitato» non vede l'app finché non cambia password) →
// POST /auth/change-password → il nuovo token tornato dal server sostituisce
// il vecchio (la sessionVersion è incrementata) → la nuova password sopravvive
// a un logout/login senza riaprire il modale.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E } from './helpers';

const NUOVA_PASSWORD = 'BluMan-Robusta-2026';

test('login utente invitato → cambio password obbligatorio → accesso con la nuova password', async ({ page }) => {
  await page.goto('/login');

  await page.getByPlaceholder('nome.cognome@studio.it').fill(AMBIENTE_E2E.invitatoEmail);
  await page.locator('input[type="password"]').fill(AMBIENTE_E2E.password);
  await page.getByRole('button', { name: '🔒 Accedi alla Piattaforma' }).click();

  // Il modale del primo accesso compare sopra l'app: nessun contenuto
  // riservato è raggiungibile prima del cambio password.
  const titoloModale = page.getByText('Primo Accesso: Imposta Nuova Password');
  await expect(titoloModale).toBeVisible();

  await page.getByPlaceholder('Inserisci la password provvisoria').fill(AMBIENTE_E2E.password);
  await page.getByPlaceholder('Scegli una nuova password robusta').fill(NUOVA_PASSWORD);
  await page.getByPlaceholder('Ripeti la nuova password').fill(NUOVA_PASSWORD);
  await page.getByRole('button', { name: '🔒 Conferma & Accedi alla Piattaforma' }).click();

  // Il modale si chiude e il JWT nuovo (restituito da change-password) resta
  // in localStorage: l'app è navigabile senza 401.
  await expect(titoloModale).not.toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  // Logout e secondo login con la nuova password: nessun modale, accesso diretto.
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByPlaceholder('nome.cognome@studio.it').fill(AMBIENTE_E2E.invitatoEmail);
  await page.locator('input[type="password"]').fill(NUOVA_PASSWORD);
  await page.getByRole('button', { name: '🔒 Accedi alla Piattaforma' }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText('Primo Accesso: Imposta Nuova Password')).not.toBeVisible();
});
