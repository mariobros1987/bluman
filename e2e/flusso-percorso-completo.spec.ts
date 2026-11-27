// Flusso 5: il percorso dei soldi, dall'inizio alla fine.
//
// È il test che mancava (analisi del 26/11, M10): ogni pezzo aveva le sue prove, ma nessuna
// seguiva un incarico da quando nasce a quando il denaro è in banca. I difetti trovati nel giro
// guidato stavano tutti nei passaggi fra una pagina e l'altra: il progetto senza valore in
// elenco, le voci senza importo in fattura, l'incasso senza conto, la Prima Nota con una cassa
// che non esisteva, il saldo fermo a zero.
//
// Copre, in fila:
//   1. un progetto nuovo per il cliente di prova, avviato come fa il wizard (preventivo accettato)
//      → il valore del progetto è la somma dei prezzi dei moduli, a database;
//      → la scheda progetto dice quale modulo attende quale («In attesa di: …»);
//   2. il compositore della fattura propone gli importi delle voci (non «importo mancante»);
//   3. la fattura emessa compare nello Scadenzario con la sua rata;
//   4. «Registra Incasso» chiede data e conto, e l'incasso va sul conto scelto;
//   5. la Prima Nota mostra l'incasso con quel conto e non lo lascia eliminare (lucchetto, e 409);
//   6. il saldo del conto sale esattamente dell'importo incassato.
//
// Il progetto si crea via API e non dal wizard: sono le stesse due chiamate che il wizard fa
// (POST /progetti, poi preventivo accettato), e così il test non dipende dall'impaginazione dei
// quattro passi. Ogni corsa crea un progetto suo: il test si può rilanciare senza `e2e:reset`.
import { test, expect } from '@playwright/test';
import { AMBIENTE_E2E, loginStaff } from './helpers';

const CONTO_DI_PROVA = 'Conto operativo (dati di prova)';

test('percorso completo: progetto → fattura → incasso → Prima Nota → saldo del conto', async ({ page, request }) => {
  const api = AMBIENTE_E2E.apiBase;
  const token = await loginStaff(request, AMBIENTE_E2E.advisorEmail, AMBIENTE_E2E.password);
  const headers = { Authorization: `Bearer ${token}` };

  // Il conto dei dati di prova (lo crea l'overlay) e il suo saldo di partenza.
  const contiPrima: Array<{ id: string; nomeConto: string; saldoAttuale: number }> = await (await request.get(`${api}/conti-bancari`, { headers })).json();
  const conto = contiPrima.find((c) => c.nomeConto === CONTO_DI_PROVA);
  expect(conto, 'il conto dei dati di prova deve esistere (overlay seed)').toBeTruthy();

  // ── 1. Progetto nuovo, avviato come fa il wizard ────────────────────────────────────────────
  const moduli: Array<{ id: string; versione: number }> = await (await request.get(`${api}/moduli`, { headers })).json();
  // Due moduli in catena: «Corporate structuring» (mod-m02) dipende da «Analisi patrimoniale» (mod-m01).
  const analisi = moduli.find((m) => m.id === 'mod-m01');
  const corporate = moduli.find((m) => m.id === 'mod-m02');
  expect(analisi && corporate, 'i moduli mod-m01 e mod-m02 devono essere in libreria (seed)').toBeTruthy();

  const nomeProgetto = `Percorso completo ${Math.random().toString(36).slice(2, 8)}`;
  const progetto = await (await request.post(`${api}/progetti`, { headers, data: { clienteId: AMBIENTE_E2E.clienteBelfort.id, nome: nomeProgetto } })).json();
  const preventivo = await (await request.post(`${api}/preventivi`, {
    headers,
    data: { clienteId: AMBIENTE_E2E.clienteBelfort.id, progettoId: progetto.id, righe: [corporate!, analisi!].map((m) => ({ moduloTemplateId: m.id, moduloTemplateVersione: m.versione })) },
  })).json();
  const accettazione = await request.post(`${api}/preventivi/${preventivo.id}/accetta`, { headers });
  expect(accettazione.ok(), await accettazione.text()).toBeTruthy();

  const dettaglio = await (await request.get(`${api}/progetti/${progetto.id}`, { headers })).json();
  const sommaModuli = dettaglio.moduli.reduce((tot: number, m: { prezzo: number }) => tot + m.prezzo, 0);
  expect(sommaModuli, 'i moduli di prova devono avere un prezzo').toBeGreaterThan(0);
  // Prima restava 0: elenco e Dashboard mostravano un progetto senza valore.
  expect(dettaglio.valoreTotale).toBe(sommaModuli);

  // ── 2. Fattura dal compositore: gli importi sono già proposti ───────────────────────────────
  await page.goto('/login');
  await page.getByPlaceholder('nome.cognome@studio.it').fill(AMBIENTE_E2E.advisorEmail);
  await page.locator('input[type="password"]').fill(AMBIENTE_E2E.password);
  await page.getByRole('button', { name: '🔒 Accedi alla Piattaforma' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto(`/projects/${progetto.id}`);
  // Le dipendenze si leggono: prima «attesa dipendenza» non diceva da quale modulo.
  const nomeAnalisi = dettaglio.moduli.find((m: { moduloTemplateId: string }) => m.moduloTemplateId === 'mod-m01').nome;
  await expect(page.getByText(`In attesa di: «${nomeAnalisi}»`)).toBeVisible();
  await page.getByRole('button', { name: '💶 Fatturazione & SDI' }).click();
  await page.getByRole('button', { name: '✨ Componi Fattura da Microvoci & Moduli' }).click();

  const importi = page.locator('input[aria-label^="Importo "]');
  await expect(importi.first()).toBeVisible();
  // Prima ogni voce era «importo mancante» (campo vuoto) anche su un modulo col suo prezzo.
  const proposti = await importi.evaluateAll((campi) => campi.map((c) => Number((c as HTMLInputElement).value)));
  expect(proposti.length).toBeGreaterThan(0);
  for (const importo of proposti) expect(importo).toBeGreaterThan(0);

  await page.getByRole('button', { name: '☑️ Tutte da Fatturare' }).click();
  await Promise.all([
    expect(page.getByRole('region', { name: 'Notifiche' }).getByText(/emesso con successo/)).toBeVisible(),
    page.getByRole('button', { name: '🚀 Emetti Fattura Fiscale (Serie FT)' }).click(),
  ]);

  // ── 3. La fattura è nel registro, con la sua rata nello Scadenzario ─────────────────────────
  const fatture = await (await request.get(`${api}/invoices`, { headers })).json();
  const fattura = (Array.isArray(fatture) ? fatture : fatture.fatture ?? fatture.data ?? []).find(
    (f: { progettoId?: string }) => f.progettoId === progetto.id,
  );
  expect(fattura?.numero, 'la fattura del progetto deve esistere').toMatch(/^FT-/);

  const scadenze: Array<{ id: string; importoCentesimi: number; fatturaId: string }> = await (await request.get(`${api}/invoices/scadenzario`, { headers })).json();
  const rata = scadenze.find((s) => s.fatturaId === fattura.id);
  expect(rata, 'la fattura deve avere una rata nello Scadenzario').toBeTruthy();

  // ── 4. Incasso: data e conto si scelgono ────────────────────────────────────────────────────
  await page.goto('/scadenzario');
  const rigaRata = page.locator('tr', { hasText: fattura.numero });
  await rigaRata.getByRole('button', { name: /Registra Incasso/ }).click();

  const campoData = page.getByLabel(/Data dell'incasso/);
  const campoConto = page.getByLabel(/Conto su cui è entrato il denaro/);
  await expect(campoData).toBeVisible();
  const dataIncasso = await campoData.inputValue(); // proposta: oggi
  expect(dataIncasso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await campoConto.selectOption({ label: await campoConto.locator('option', { hasText: CONTO_DI_PROVA }).innerText() });

  await Promise.all([
    expect(page.getByRole('region', { name: 'Notifiche' }).getByText(/Incasso registrato/)).toBeVisible(),
    page.getByRole('button', { name: /Conferma & Scrivi in Prima Nota/ }).click(),
  ]);

  // ── 5. Prima Nota: l'incasso c'è, col conto giusto, e non si elimina ────────────────────────
  await page.goto('/primanota');
  const rigaMovimento = page.locator('tr', { hasText: `fattura ${fattura.numero}` });
  await expect(rigaMovimento).toBeVisible();
  await expect(rigaMovimento).toContainText(CONTO_DI_PROVA);
  // Prima qui c'era «Cassa / Predefinito» anche senza nessun conto, e un cestino che lasciava la
  // rata «incassata» senza il suo denaro.
  await expect(rigaMovimento).not.toContainText('Cassa / Predefinito');
  await expect(rigaMovimento.getByLabel('Movimento non eliminabile')).toBeVisible();
  await expect(rigaMovimento.getByLabel('Elimina movimento')).toHaveCount(0);

  const primaNota = await (await request.get(`${api}/prima-nota?page=1&limit=200`, { headers })).json();
  const movimento = (primaNota.data ?? primaNota).find((m: { fatturaId?: string }) => m.fatturaId === fattura.id);
  expect(movimento, 'il movimento dell’incasso deve esistere').toBeTruthy();
  expect(movimento.contoBancarioId).toBe(conto!.id);
  expect(String(movimento.data).slice(0, 10)).toBe(dataIncasso);
  const rifiuto = await request.delete(`${api}/prima-nota/${movimento.id}`, { headers });
  expect(rifiuto.status()).toBe(409);

  // ── 6. Il saldo del conto è salito esattamente dell'importo incassato ───────────────────────
  const contiDopo: Array<{ id: string; saldoAttuale: number }> = await (await request.get(`${api}/conti-bancari`, { headers })).json();
  const saldoDopo = contiDopo.find((c) => c.id === conto!.id)!.saldoAttuale;
  expect(saldoDopo - conto!.saldoAttuale).toBe(rata!.importoCentesimi);
});
