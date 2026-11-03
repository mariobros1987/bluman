# Piano: Debiti Noti, modulo fiscale e split dei file grandi

*Redatto a settembre 2026, dopo verifica incrociata voce per voce con il codice reale — non con i soli documenti di piano. Per ogni voce: come sta oggi, cosa va fatto, sforzo stimato e chi decide.*

## 0. Dove siamo davvero

La riforma fatture/contabilità è **molto più avanti** di quanto i piani dichiarano. Il piano sotto non ripete cose fatte: parte da ciò che manca davvero.

**Già fatto e funzionante (verificato nel codice):**

- **Schema contabile completo** — `prisma/schema.prisma`: `Fattura` (serie FT/NC, numerazione per serie unica vincolata, totali in centesimi, bollo virtuale, cassa previdenziale e ritenuta, campi SDI, campi di conservazione), `ScadenzaIncasso`, `RegistrazioneIncasso`, `MovimentoPrimaNota`, `Fornitore`, `FatturaRicevuta`, `LiquidazioneIva`, `AuditLogFattura`; indici su tenant/cliente e tenant/progetto già presenti.
- **Ciclo attivo intero** — `src/routes/contabilita.ts` (33 rotte): emissione, scadenzario, incassi, prima nota, note di credito, fatture da preventivo/timesheet/contratti ricorrenti.
- **Ciclo passivo** — `src/routes/fornitori.ts` + `src/services/fatturaPassivaParser.ts`.
- **LIPE** — `src/services/lipeEngine.ts` + `src/routes/liquidazioneIva.ts`, con marcatura del versamento.
- **Solleciti manuali** — `src/services/sollecitiEngine.ts` + rotte + modale nel frontend.
- **XML SDI FatturaPA 1.2** — `src/services/sdiXmlGenerator.ts`: TD01/TD04, ritenute RT01/RT02, cassa TC*, bollo, FPR12/FPA12.
- **Invio SDI in «modalità onesta manuale»** — `src/services/sdiService.ts` genera l'XML e dice la verità: nulla viene trasmesso, l'invio è a carico dello studio (portale «Fatture & Corrispettivi» o intermediario esterno); gli esiti veri (consegnata/scartata/mancata_consegna) entrano dal webhook autenticato (commit `df2c183`).
- **Fascicolo commercialista ZIP, PDF fattura, invio email.**
- **Cron notifiche** — `src/services/cronService.ts` esiste e funziona, ma si innesca solo a mano.

**Mancante (verificato):** conservazione sostitutiva, file F24 telematico, Certificazione Unica, scheduler reale (`node-cron` non è tra le dipendenze), blocchi cron su marchi e micro-voci in ritardo; più le voci aperte di `PIANO_DI_MIGLIORAMENTO.md` (2.2-2.4, 3.1-3.3, 4.1-4.3, 5.2-5.4, 6.2-6.3).

---

## 1. I Debiti Noti (8 voci)

Sono quasi tutti **decisioni più che codice**: le scritture su dati di produzione restano al titolare; io implemento le parti di sviluppo appena deciso.

1. **Mappa Graphify stantia** (ultima estrazione 17 agosto; mancano Fase 0 e Fase 1).
   *Azione:* rigenerare con `graphify extract . --code-only` + `graphify cluster-only .` dove la CLI esiste (su questa postazione non c'è). *Chi:* titolare, pochi minuti. Priorità bassa: è solo documentazione interna.

2. **Due righe `user` residue senza password** (`francesca@bluecode.advisory` e `lorenzo@bluecode.advisory`, duplicati di quelle reali, nati da seed e vecchio auto-seed). Inerti, ma sporcano l'anagrafica.
   *Azione:* prima `npx tsx src/scripts/verificaAccessi.ts` per vedere cosa le referenzia (audit, timesheet, accessi progetto), poi rimozione consapevole dalla dashboard super admin. *Chi:* titolare (scrittura di produzione). *Sforzo:* 30 minuti più la decisione.

3. **Due moduli con stato non verificabile** su «Struttura Holding — Famiglia Ricci» (`Analisi patrimoniale iniziale` a `done`, `Corporate structuring Malta` a `in_progress`, zero micro-voci a DB; stato messo a mano, il service lo preserva).
   *Azione:* diagnosi con `npx tsx src/scripts/probeAvanzamento.ts`, poi decidere: istanziare le micro-voci vere o azzerare lo stato a `pending`. *Chi:* decisione e scrittura del titolare.

4. **Riga di stato da riallineare**: su «holding dibenedetto» il modulo `Analisi patrimoniale iniziale` è `pending` nella riga ma ha 5 micro-voci con ore consuntivate (17% calcolato).
   *Azione:* premere **Ricalcola** nell'intestazione del Dettaglio Progetto (`POST /progetti/:id/ricalcola`). *Chi:* titolare, un minuto.

5. **Omonimi**: `Holding Beta S.r.l.` presente due volte in anagrafica; «Struttura Holding — Famiglia Ricci» due volte fra i progetti. Nessuna scrittura di consolidamento fatta.
   *Azione:* decidere se consolidare (riassegnando i riferimenti: fatture, documenti, timesheet) o archiviare il doppione. *Chi:* titolare. Se si decide, io preparo la mappa dei riferimenti prima di toccare.

6. **La «conferma conclusione operazione» nel portale non è una firma**: vive solo nel `localStorage` del dispositivo del cliente, non passa da `/portal/verify-otp-and-sign`, non produce sigillo FEA, lo studio non la vede a DB.
   *Azione:* due strade — (a) farla passare dall'endpoint OTP che emette il sigillo, oppure (b) togliere il pulsante. *Chi:* scelta di prodotto del titolare; *sviluppo* 0,5-1 giorno dopo la scelta.

7. **Evidenze forensi da registrare lato server**: gli IP cablati sono stati rimossi dal Vault e dagli allegati; l'evidenza va scritta al momento della firma, dove l'IP è noto — come fa `generateEidasSignatureSeal()` in `src/services/otpService.ts`.
   *Azione:* estendere lo stesso schema agli altri eventi documentali. Nessuna decisione da prendere: è una precisione legale. *Sviluppo:* 1-2 giorni.

8. **Elenco documenti del portale ancora seed cablato**: `portalDocs` in `frontend/src/pages/ClientPortal.tsx` con quattro documenti inventati (NDA, statuto, UBO, trust), dimensioni e date fisse, NDA marcato firmato con data cablata. Il frontend non inventa dati (regola 7).
   *Azione:* collegarlo al Vault reale o dichiararlo vuoto. *Chi:* scelta di prodotto; *sviluppo* 0,5-1 giorno.

---

## 2. Le cinque voci fiscali

### 2.1 Intermediario SDI — prima di tutto una decisione

**Oggi:** modalità onesta manuale. L'XML si genera e si scarica; l'invio è manuale (portale AdE o intermediario esterno); gli esiti si registrano a mano tramite webhook autenticato. Nessun provider collegato.

- **Strada A — resto manuale:** zero costi e zero integrazioni, già funziona. Contro: tempo operativo per fattura, nessuna notifica automatica RC/NS/MC/NE/DT, rischio di dimenticare di registrare l'esito.
- **Strada B — intermediario (Aruba e simili):** trasmissione e notifiche automatiche. Serve: account e API key in variabili Railway (mai nel repo — regola 6), riscrittura di `sdiService.ts`, webhook adattato al formato notifiche del provider con mappatura su `statoSdi`, test con payload reali.

**Sforzo:** B = 3-5 giorni di sviluppo + canone del provider.
**Decisione:** dipende dal volume mensile di fatture. Con poche fatture resto su A e riprendo B quando il volume cresce o gli scarti iniziano a pesare.

### 2.2 Conservazione sostitutiva — da costruire

**Oggi:** solo i due campi `conservazioneRiferimento` / `conservazioneDataInvio` nello schema, mai valorizzati da codice. Nessun servizio, nessuna rotta, nessun provider.

**Da fare, in due passi:**

1. **Passo minimale (onesto, come SDI manuale):** rotta per annotare riferimento e data di invio quando l'operatore carica la fattura nel provider esterno, vista nella pagina fattura, riga in `AuditLogFattura`. 1 giorno.
2. **Integrazione API:** invio automatico all'emissione e ricevute del provider (Aruba, InfoCert…). 3-5 giorni + account e canone.

**Nota legale:** obbligo decennale (art. 2220 c.c.; il piano interno parla di 10 anni) — da confermare col commercialista per le fatture elettroniche.
**Decisione:** quale provider, e se/quando fare il passo 2.

### 2.3 F24 telematico — da costruire (piccolo)

**Oggi:** F24 esiste solo come prospetto testuale dentro il fascicolo ZIP per il commercialista (`src/services/fascicoloFiscaleZipEngine.ts`, con codice tributo e importo da versare già calcolati) e come marcatura del versamento (`POST /liquidazione-iva/:periodo/marca-versata` in `src/routes/liquidazioneIva.ts`). Nessun file telematico.

**Da fare:** generatore del file F24 telematico (tracciato a posizioni fisse dell'Agenzia: testata, righe tributo, coda) partendo dalla LIPE già calcolata, rotta di download, test con esempi. Il calcolo del codice tributo e dell'importo si ri usa dal prospetto esistente.
**Sforzo:** 2-3 giorni. Nessuna decisione esterna.

### 2.4 Certificazione Unica — da costruire (scadenza annuale)

**Oggi:** solo un commento aspirazionale in `src/services/lipeEngine.ts`. Zero implementazione.

**Da fare:** engine che raccoglie le fatture dell'anno con ritenuta (già tracciate: `aliquotaRitenuta`, RT01/RT02 nell'XML) ed eventuali collaboratori, genera il tracciato CU ufficiale, anteprima + export, controllo con il commercialista. L'invio passa da intermediario/Entratel con la stessa logica onesta-manuale dell'SDI.
**Sforzo:** 3-5 giorni. Scadenza annuale a marzo: per l'anno 2026 c'è tempo, conviene farla in inverno.

### 2.5 Cron — metà costruito

**Oggi:** `runDailyNotificationCron` esiste e funziona (promemoria KYC/UBO annuale; scadenze di incasso a −7/0/+3 giorni; dedup 20 ore; audit), ma si innesca SOLO manualmente (`POST /cron/esegui-notifiche-scadenze` o `verifyAll.ts`). Nessuno scheduler reale. Inoltre `scadenzeMarchiTrovate` e `microvociInRitardoTrovate` sono dichiarate nel report ma mai calcolate: i blocchi di scansione non esistono.

**Da fare:**

1. Dipendenza `node-cron` + scheduler al bootstrap del server (notte, ogni tenant con `attivaContestoTenant`) — chiude la voce 5.1 di `PIANO_DI_MIGLIORAMENTO.md`. La rotta POST resta come innesco manuale; la dedup 20 ore protegge già dalle doppie esecuzioni.
2. I due blocchi mancanti: scadenze dei rinnovi dei marchi e micro-voci in ritardo.
3. (Opzionale, da decidere) solleciti email automatici al cliente dopo N giorni di ritardo: oggi il cron notifica solo lo studio in-app, i solleciti al cliente partono a mano.

**Sforzo:** 2-3 giorni per i punti 1-2, nessuna decisione esterna. Il punto 3 è una scelta di tono/automatismo.

### 2.6 Il resto del piano di miglioramento (voci aperte)

Da infilare lungo la strada, non in blocco: **2.2** Zod (la libreria è già installata: estenderla alle rotte che si toccano), **2.3** tipizzare `FastifyRequest`, **2.4** eliminare i `(prisma as any)`; **3.1** Pino, **3.2** E2E, **3.3** OpenAPI; **4.1** paginazione, **4.2** rate limit su Redis (libreria già installata; Redis serve solo con più istanze), **4.3** indici mancanti (quelli su fattura esistono già: verificare cliente, progetto, microvoce, magic_link); **5.2** coda notifiche con retry (BullMQ), **5.3** TOTP per super_admin (campo `totpSecret` già in schema, manca `otplib`), **5.4** backup notturno (lo script esiste, manca lo scheduler — stesso meccanismo del cron di 2.5); **6.2** Sentry + uptime, **6.3** `.env.example`.

---

## 3. Split dei file grandi

**Metodo collaudato in Fase 2.1:** split puramente meccanico, zero cambi di comportamento, nessun rename, un file per volta, `vitest` + `tsc` a ogni estrazione, commit separati e revertibili (regola 8). Sforzo 0,5-1 giorno per file.

**Ordine consigliato (con motivazione):**

1. `src/routes/contabilita.ts` (1922 righe) — **prima di ogni lavoro fiscale**: le nuove rotte F24/CU/cron atterrano nei moduli nuovi, non in un file da duemila righe. Giunti naturali: fatture attive, scadenzario+incassi, prima nota, SDI, contratti ricorrenti, cron, conti bancari/report.
2. `frontend/src/pages/ClientPortal.tsx` (2009) — prima dei cambi dei Debiti 6 e 8.
3. `src/routes/firma.ts` (1859).
4. `frontend/src/pages/InvoicesPage.tsx` (1102) — poi, in commit separato, la rimozione del `localStorage` (obiettivo ① del piano riforma).
5. `src/routes/progetti.ts` (1108), `frontend/src/pages/DocumentEditorPage.tsx` (1071), `src/routes/documenti.ts` (999), `src/routes/tenant.ts` (947), `frontend/src/components/projectDetail/FatturazioneTab.tsx` (891), `frontend/src/pages/ProjectDetail.tsx` (883) — e a seguire gli altri sotto le 800 righe.

**Regola:** ogni split in commit proprio, revertibile da solo; mai mischiare split meccanico e cambi semantici nello stesso commit.

---

## 4. Sequenza di lavoro consigliata

| Blocco | Contenuto | Stima | Aspetta decisioni? |
|---|---|---|---|
| 1 | Split `contabilita.ts` + `ClientPortal.tsx` | 2 giorni | No |
| 2 | Cron reale (scheduler + blocchi marchi/microvoci) | 2-3 giorni | No |
| 3 | F24 telematico | 2-3 giorni | No |
| 4 | Conservazione minimale (annotazione) | 1 giorno | No (il passo 2 sì) |
| 5 | Debiti Noti 6, 7, 8 (sviluppo) | 2-3 giorni | Sì (6 e 8) |
| 6 | Certificazione Unica | 3-5 giorni | Conferma col commercialista |
| 7 | Conservazione API + intermediario SDI | 3-5 giorni ciascuno | Sì (provider e volume) |
| 8 | Resto piano miglioramento (2.x, 3.x, 4.x, 5.x, 6.x) | intercalato | No |

I Debiti Noti 1-5 sono decisioni e scritture del titolare: possono partire in qualunque momento, in parallelo; il loro sviluppo residuo è tutto nei blocchi 5-7.

## 5. Le decisioni che restano al titolare

1. Intermediario SDI: resto manuale o integro (quale provider)?
2. Conservazione: quale provider, e quando il passo 2 (API)?
3. CU: conferma delle sezioni necessarie col commercialista.
4. Debito 2: rimuovere le due user residue (dopo `verificaAccessi`)?
5. Debito 3: istanziare le micro-voci o azzerare i due moduli Ricci?
6. Debito 4: premere Ricalcola su «holding dibenedetto».
7. Debito 5: consolidare o archiviare gli omonimi (e quale tenere)?
8. Debito 6: la conferma nel portale passa dall'OTP con sigillo o si toglie?
9. Debito 8: `portalDocs` collegato al Vault o dichiarato vuoto?
10. Mappa Graphify: dove rigenerarla (la CLI non c'è su questa postazione)?
