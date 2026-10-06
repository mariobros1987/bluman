// Flusso critico 4: il legame messaggio ↔ micro-voce, fatto **a mano dalla UI**.
//
// È il passo 3 del piano `starry-percolating-hearth.md`, eseguito dal browser invece che a occhio:
// abbinare un messaggio dalla scheda Comunicazioni → il messaggio compare nella scheda «💬 Messaggi»
// della micro-voce, con il motivo per cui è lì → togliere l'abbinamento → sparisce → **rispondere dal
// compositore della voce**, e il messaggio nasce abbinato (`origine: 'microvoce'`) e compare in
// entrambe le viste.
//
// Perché il primo messaggio lo crea l'API e non il compositore: la cosa che quel tratto deve provare
// è il **legame a mano**, non la scrittura. La scrittura dal compositore ha il suo tratto, in fondo,
// ed è lì che si verifica. Il canale è il **portale**, che non ha un passo di consegna dopo la
// scrittura (`senzaDispatch` in `src/routes/progetti.ts`): nessuna riga di questo test contatta Meta o
// un SMTP. Il nome della micro-voce si chiede all'API e non si cabla, perché viene dai template dei
// moduli e cambierebbe con loro.
//
// Le due verifiche passano da strade diverse di proposito: la UI dice che l'operatore **vede** la
// cosa giusta, l'API dice che è stata **scritta**. Un abbinamento disegnato e non salvato le
// supererebbe una per una.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E, loginStaff } from './helpers';

// Il testo è fisso — non serve una marca di corsa — perché l'overlay E2E azzera il fascicolo del
// progetto di test a ogni preparazione (`src/scripts/seedE2E.ts`), come già faceva con fatture e
// sessioni OTP: la suite si esegue con `npm run test:e2e`, che prepara l'ambiente prima di lanciare.
// Un messaggio lasciato dalla corsa precedente renderebbe ambigua la bolla da selezionare, e la
// prima asserzione di questo spec andrebbe in violazione di strict mode.
const TESTO = 'Ho caricato i documenti per la costituzione, li trovi nel fascicolo.';
/** La risposta scritta **dal compositore della voce**, non dall'API: è quella che deve nascere legata. */
const RISPOSTA = 'Le ho ricevute: procedo con la costituzione.';

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

  // ── Il compositore della voce: scrivere **da qui**, e nascere abbinati ────────────────────────
  //
  // È il pezzo che il piano aggiunge: prima, per rispondere bisognava uscire dalla voce, andare in
  // Comunicazioni, ritrovare la conversazione fra i messaggi di tutta la pratica e tornare indietro.
  //
  // Il canale lo sceglie il predefinito — la voce è vuota, quindi `portal`, che è l'unico canale
  // senza un passo di consegna (`senzaDispatch`): nessuna riga di questo test contatta Meta o un
  // SMTP. Che il predefinito sia `portal` quando la voce non ha ancora messaggi è metà di ciò che
  // si sta verificando: un ripiego su WhatsApp spedirebbe davvero, e sceglierlo al posto
  // dell'operatore sarebbe la cosa peggiore.
  const modale = page.locator('#proc-ov');
  await modale.getByRole('textbox').fill(RISPOSTA);
  await modale.getByRole('button', { name: 'Invia Ora →' }).click();

  // Nella voce: la card compare, e dichiara **perché** è lì. `✍ a mano` sarebbe la bugia da evitare
  // — nessuno ha abbinato niente, il messaggio è nato legato.
  await expect(modale.getByText(RISPOSTA)).toBeVisible();
  await expect(modale.getByText('✍ scritto da qui')).toBeVisible();

  // E il legame è **scritto**, con l'origine nuova: `microvoce`, non `manuale`. La distinzione conta
  // perché la metrica della Fase 3 legge `manuale` come «il residuo che l'operatore ha dovuto
  // sistemare a mano»: contarci un messaggio nato abbinato la falserebbe in su.
  const dopoInvio = await (await request.get(`${AMBIENTE_E2E.apiBase}/progetti/${progetto.id}/comunicazioni`, { headers })).json();
  const messaggiInvio = Array.isArray(dopoInvio) ? dopoInvio : dopoInvio.comunicazioni ?? [];
  const risposta = messaggiInvio.find((m: { testo?: string }) => m.testo === RISPOSTA);
  expect(risposta?.microvoci, 'il messaggio scritto dalla voce deve nascere abbinato').toEqual([
    { microvoceId: voce.id, nome: voce.nome, origine: 'microvoce' },
  ]);

  // L'altro lato: **una riga sola, in due posti**. Nella chat della pratica il messaggio c'è, ed è
  // la stessa riga — non una copia — con lo stesso motivo. Se le due viste divergessero, una delle
  // due starebbe raccontando una storia sua.
  await page.locator('#proc-ov').getByRole('button', { name: '✕' }).click();
  await expect(page.locator('#proc-ov')).toHaveCount(0);
  await page.getByRole('button', { name: '💬 Comunicazioni & Ingestion' }).click();
  const bollaRisposta = page
    .getByText(RISPOSTA, { exact: true })
    .locator('xpath=ancestor::div[.//input[@type="checkbox"]][1]');
  await expect(bollaRisposta).toBeVisible();
  await expect(bollaRisposta.getByTitle('Scritto da dentro questa micro-voce: nasce abbinato')).toContainText(voce.nome);
});
