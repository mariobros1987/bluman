// Flusso critico 4: il legame messaggio ↔ micro-voce, fatto **a mano dalla UI**.
//
// È il passo 3 del piano `starry-percolating-hearth.md`, eseguito dal browser invece che a occhio:
// abbinare un messaggio dalla scheda Comunicazioni → il messaggio compare nella scheda «💬 Messaggi»
// della micro-voce, con il motivo per cui è lì → togliere l'abbinamento → sparisce.
//
// Perché il messaggio lo crea l'API e non il compositore: la cosa che questo test deve provare è il
// **legame**, non la scrittura, che ha già i suoi presidi. Il canale è il **portale**, che non ha un
// passo di consegna dopo la scrittura (`senzaDispatch` in `src/routes/progetti.ts`): nessuna riga di
// questo test contatta Meta o un SMTP. Il nome della micro-voce si chiede all'API e non si cabla,
// perché viene dai template dei moduli e cambierebbe con loro.
//
// Le due verifiche passano da strade diverse di proposito: la UI dice che l'operatore **vede** la
// cosa giusta, l'API dice che è stata **scritta**. Un abbinamento disegnato e non salvato le
// supererebbe una per una.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E, loginStaff } from './helpers';

const TESTO = 'Ho caricato i documenti per la costituzione, li trovi nel fascicolo.';

/** Il `title` del badge nella chat: dice *perché* il messaggio è abbinato a quella voce. */
const BADGE_A_MANO = "Abbinata a mano dall'operatore";
const TITLE_SLEGA = "Togli l'abbinamento: il messaggio resta nel fascicolo, smette di essere collegato a questa voce";
const VUOTO = 'Nessun messaggio abbinato a questa voce, per ora.';

test('abbina un messaggio a una micro-voce, e poi lo slega', async ({ page, request }) => {
  // Login dalla UI (advisor attivo: nessun cambio password richiesto).
  await page.goto('/login');
  await page.getByPlaceholder('nome.cognome@studio.it').fill(AMBIENTE_E2E.advisorEmail);
  await page.locator('input[type="password"]').fill(AMBIENTE_E2E.password);
  await page.getByRole('button', { name: '🔒 Accedi alla Piattaforma' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const token = await loginStaff(request, AMBIENTE_E2E.advisorEmail, AMBIENTE_E2E.password);
  const headers = { Authorization: `Bearer ${token}` };

  const progetti = await (await request.get(`${AMBIENTE_E2E.apiBase}/progetti`, { headers })).json();
  const progetto = (Array.isArray(progetti) ? progetti : progetti.progetti ?? []).find(
    (p: { nome?: string }) => p.nome === AMBIENTE_E2E.progettoNome,
  );
  expect(progetto?.id, 'il progetto E2E deve esistere (overlay seed)').toBeTruthy();

  const rispostaVoci = await (await request.get(`${AMBIENTE_E2E.apiBase}/progetti/${progetto.id}/microvoci`, { headers })).json();
  const voci = Array.isArray(rispostaVoci) ? rispostaVoci : rispostaVoci.microvoci ?? [];
  const voce = voci[0];
  expect(voce?.nome, 'la pratica E2E deve avere micro-voci (overlay seed)').toBeTruthy();

  // Il messaggio da abbinare: in entrata, sul portale. Nasce **senza** abbinamento — è la
  // premessa del test, e se fosse già abbinato il resto non proverebbe niente.
  const crea = await request.post(`${AMBIENTE_E2E.apiBase}/progetti/${progetto.id}/comunicazioni`, {
    headers,
    data: {
      canale: 'portal',
      mittente: 'Belfort Industries (Cliente)',
      destinatario: 'Studio',
      direzione: 'entrata',
      testo: TESTO,
    },
  });
  expect(crea.ok(), `creazione del messaggio fallita: ${crea.status()} ${await crea.text()}`).toBeTruthy();

  await page.goto(`/projects/${progetto.id}`);
  await page.getByRole('button', { name: '💬 Comunicazioni & Ingestion' }).click();

  // La bolla del messaggio: il div più vicino che contiene sia il testo sia la casella di
  // selezione. Ancorarsi al testo e risalire evita di dipendere dall'ordine dei messaggi.
  const bolla = page
    .getByText(TESTO, { exact: true })
    .locator('xpath=ancestor::div[.//input[@type="checkbox"]][1]');
  await expect(bolla).toBeVisible();
  await expect(bolla.getByTitle(BADGE_A_MANO)).toHaveCount(0);

  // Selezione e abbinamento, dalla barra d'azione.
  await bolla.locator('input[type="checkbox"]').check();
  const barra = page.locator('div').filter({ hasText: 'messaggio selezionato' }).last();
  await barra.locator('select').selectOption(voce.id);
  await barra.getByRole('button', { name: '🔗 Abbina a micro-voce' }).click();

  // La UI: il badge con il motivo compare sulla bolla, con il nome della voce.
  await expect(bolla.getByTitle(BADGE_A_MANO)).toBeVisible();
  await expect(bolla.getByTitle(BADGE_A_MANO)).toContainText(voce.nome);

  // E il legame è **scritto**, non solo disegnato.
  const dopoAbbina = await (await request.get(`${AMBIENTE_E2E.apiBase}/progetti/${progetto.id}/comunicazioni`, { headers })).json();
  const messaggi = Array.isArray(dopoAbbina) ? dopoAbbina : dopoAbbina.comunicazioni ?? [];
  const messaggio = messaggi.find((m: { testo?: string }) => m.testo === TESTO);
  expect(messaggio?.microvoci, 'il messaggio appena abbinato deve dichiarare le sue micro-voci').toEqual([
    { microvoceId: voce.id, nome: voce.nome, origine: 'manuale' },
  ]);

  // L'altro lato: aprendo la micro-voce, il messaggio è nella sua scheda «💬 Messaggi», e dichiara
  // di essere lì per mano dell'operatore — il motivo è metà dell'informazione.
  await page.getByRole('button', { name: '🗂 Moduli & Microvoci' }).click();
  await page.getByText(voce.nome, { exact: true }).first().click();
  await page.getByRole('button', { name: /Messaggi \(/ }).click();
  await expect(page.getByText(TESTO)).toBeVisible();
  await expect(page.getByText('✋ a mano')).toBeVisible();

  // Si chiude il modal prima di tornare alla chat: la scheda Comunicazioni sta dietro l'overlay.
  await page.locator('#proc-ov').getByRole('button', { name: '✕' }).click();
  await expect(page.locator('#proc-ov')).toHaveCount(0);

  // Lo slegamento, dal «×» sul badge.
  await page.getByRole('button', { name: '💬 Comunicazioni & Ingestion' }).click();
  const bollaDopo = page
    .getByText(TESTO, { exact: true })
    .locator('xpath=ancestor::div[.//input[@type="checkbox"]][1]');
  await bollaDopo.getByTitle(TITLE_SLEGA).click();
  await expect(bollaDopo.getByTitle(BADGE_A_MANO)).toHaveCount(0);

  const dopoSlega = await (await request.get(`${AMBIENTE_E2E.apiBase}/progetti/${progetto.id}/comunicazioni`, { headers })).json();
  const messaggiDopo = Array.isArray(dopoSlega) ? dopoSlega : dopoSlega.comunicazioni ?? [];
  const messaggioDopo = messaggiDopo.find((m: { testo?: string }) => m.testo === TESTO);
  // Il messaggio **resta** nel fascicolo: si è tolta l'etichetta, non il messaggio.
  expect(messaggioDopo, 'slegare non deve far sparire il messaggio dal fascicolo').toBeTruthy();
  expect(messaggioDopo.microvoci).toEqual([]);

  // E dalla micro-voce il messaggio non c'è più: si torna alla frase di quando non ce n'era nessuno.
  await page.getByRole('button', { name: '🗂 Moduli & Microvoci' }).click();
  await page.getByText(voce.nome, { exact: true }).first().click();
  await page.getByRole('button', { name: /Messaggi \(/ }).click();
  await expect(page.getByText(VUOTO)).toBeVisible();
});
