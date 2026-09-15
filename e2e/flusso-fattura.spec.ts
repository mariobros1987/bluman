// Flusso critico 3: ciclo fattura dal compositore di microvoci.
//
// Copre: login advisor attivo → scheda progetto → tab Fatturazione & SDI →
// «Componi Fattura da Microvoci & Moduli» → selezione di tutte le voci non
// ancora fatturate → POST /progetti/:id/fatture → la fattura appare nel
// registro dello studio (GET /invoices).
//
// Le microvoci nascono dall'overlay seed, che istanzia il progetto Belfort
// con la stessa orchestrazione della produzione (istanziaProgetto): nessuna
// riga creata a mano.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E, loginStaff } from './helpers';

test('compositore fatture: microvoci del progetto Belfort → fattura nel registro', async ({ page, request }) => {
  // Login advisor via UI (utente attivo: nessun cambio password richiesto).
  await page.goto('/login');
  await page.getByPlaceholder('nome.cognome@studio.it').fill(AMBIENTE_E2E.advisorEmail);
  await page.locator('input[type="password"]').fill(AMBIENTE_E2E.password);
  await page.getByRole('button', { name: '🔒 Accedi alla Piattaforma' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // L'id del progetto di test si chiede all'API: navigating per nome nella
  // griglia renderebbe il test fragile a ogni modifica di layout.
  const token = await loginStaff(request, AMBIENTE_E2E.advisorEmail, AMBIENTE_E2E.password);
  const headers = { Authorization: `Bearer ${token}` };
  const resProgetti = await request.get(`${AMBIENTE_E2E.apiBase}/progetti`, { headers });
  const progetti = await resProgetti.json();
  const progetto = (Array.isArray(progetti) ? progetti : progetti.progetti ?? []).find(
    (p: { nome?: string }) => p.nome === AMBIENTE_E2E.progettoNome,
  );
  expect(progetto?.id, 'il progetto E2E deve esistere (overlay seed)').toBeTruthy();

  // Quante fatture ci sono prima dell'emissione: serve per il confronto finale.
  const resPrima = await request.get(`${AMBIENTE_E2E.apiBase}/invoices`, { headers });
  const fatturePrima = await resPrima.json();
  const numeroPrima = (Array.isArray(fatturePrima) ? fatturePrima : fatturePrima.fatture ?? []).filter(
    (f: { progettoId?: string }) => f.progettoId === progetto.id,
  ).length;

  await page.goto(`/projects/${progetto.id}`);
  await page.getByRole('button', { name: '💶 Fatturazione & SDI' }).click();
  await page.getByRole('button', { name: '✨ Componi Fattura da Microvoci & Moduli' }).click();

  // Tutte le microvoci non ancora fatturate, poi emissione della fattura
  // fiscale in serie FT.
  await page.getByRole('button', { name: '☑️ Tutte da Fatturare' }).click();

  // Il successo arriva via window.alert: senza handler Playwright chiuderebbe
  // il dialogo di default senza farci leggere il messaggio.
  const dialogo = page.waitForEvent('dialog');
  await page.getByRole('button', { name: '🚀 Emetti Fattura Fiscale (Serie FT)' }).click();
  const alert = await dialogo;
  expect(alert.message()).toContain('emesso con successo');
  await alert.accept();

  // Verifica dal registro dello studio: la fattura del progetto E2E esiste.
  const resDopo = await request.get(`${AMBIENTE_E2E.apiBase}/invoices`, { headers });
  const fattureDopo = await resDopo.json();
  const delProgetto = (Array.isArray(fattureDopo) ? fattureDopo : fattureDopo.fatture ?? []).filter(
    (f: { progettoId?: string }) => f.progettoId === progetto.id,
  );
  expect(delProgetto.length).toBe(numeroPrima + 1);
  expect(delProgetto[delProgetto.length - 1].numero).toMatch(/FT/);
});
