# Analisi approfondita BluMan — bug, imperfezioni e miglioramenti

_21/09/2026. Audit in sola lettura dell'intera app (nessun file modificato). Sei dimensioni analizzate in parallelo: sicurezza, bug logici backend, bug frontend, grafica/UX/accessibilità (doppia passata), performance, workflow/procedure._

> Metodo: agenti di analisi dedicati hanno letto il codice reale (non solo grep), verificando ogni finding e distinguendo i bug veri dai nit. Le righe indicate sono puntatori, da riverificare prima di intervenire.

---

## ✅ Stato interventi (aggiornato 21/09/2026) — CORRETTI in questa sessione

Tutti verificati: `tsc` backend + `tsc -b` frontend puliti, **1239 test backend passati**. Modifiche NON ancora deployate (fare `distribuisci.sh` quando si decide).

- **[A] Ciclo NC / fattura annullata — RISOLTO nel nocciolo:**
  - LIPE ora include le note di credito con segno **negativo** (`lipeEngine.ts` + query in `liquidazioneIva.ts` estesa a `tipoDocumento in [fattura, nota_credito]`). ⚠️ Scelta deliberata: la fattura `annullata` NON viene esclusa dalla LIPE (concorre nel suo periodo, lo storno lo fa la NC nel proprio periodo — escluderla sballerebbe il periodo della fattura quando la NC cade in un mese diverso). Aggiunto `lipeEngine.test.ts` (6 test).
  - Solleciti/insoluti (`solleciti.ts`) ora escludono `fattura.stato annullata` → niente più diffide su fatture stornate.
  - Incasso (`contabilitaScadenzario.ts`): guardia 409 se la fattura è `annullata` (niente "resurrezione") + tetto all'over-incasso (400 se importo > residuo rata).
- **[B] Leggibilità tema chiaro — RISOLTO:** 10 punti `#fff`→token corretti (incluso portale cliente). Vedi task fork.
- **[C] Bug frontend ingannevoli — RISOLTO:** stream SSE portale usa il token giusto; creazione cliente non conferma più su errore DB (errore bloccante in modale); JSON.parse protetti; race loadClienti con guardia annullamento; logout pulisce cache+`bluman_tenant_id`; rimosso mapping email→tenant eliminati.
- **[D] Firma — MITIGATO (parte code-side) + follow-up esterni:**
  - Sigillo (`otpService.ts creaSigilloFea`): l'impronta è ora un **HMAC-SHA256 con chiave del server** (`SIGILLO_HMAC_SECRET`, ripiego `JWT_SECRET`), non più un SHA-256 ricalcolabile → il sigillo prova che è stata la piattaforma a sigillare.
  - FEQ onesta: un file caricato come `qualificata_esterna` (sia lato **cliente** `firma.ts` sia lato **studio** `documentiFirmaStudio.ts`) ora DEVE contenere davvero una struttura di firma (PAdES o PKCS#7/CAdES) — `firmaFileValidazione.ts` + test — altrimenti 422. Chiude il buco "qualunque PDF = FEQ".
  - ⏳ **Restano follow-up che richiedono provider esterni** (NON fatti, servono decisioni): validazione completa del certificato (catena, revoca CRL/OCSP, stato "qualificato" via EU Trust List) e **marca temporale qualificata RFC 3161** (TSA). Vedi `piano-firma-legale-ses-fea-feq.md`.
- **Performance — RISOLTO i più impattanti:** aggiunti `@@index` a `ComunicazioneProgetto` (migrazione `20260921120000_indici_comunicazione_progetto`); polling comunicazioni 5s→30s; anagrafica clienti caricata una volta per batch nel webhook WhatsApp (non più N full-scan).
  - **🌍 LA MOSSA PIÙ IMPATTANTE (21/09/2026): backend spostato da `sfo` (San Francisco) a `eu-west` (Amsterdam)** con `railway service scale eu-west=1 sfo=0`. Ora è sullo stesso continente del DB Supabase (`eu-west-1`, Irlanda): RTT app↔DB da ~140ms → ~15ms. Con la RLS che fa 3-4 round-trip per query, questo è ~10× sulle pagine latency-bound — quello che indici e N+1 da soli non potevano dare. Verificato: `region: EU West`, connessione OK, migrazioni applicate, health 200. Il VPS resta la meta finale (azzera anche il costo RLS), ma questa è la vittoria immediata.
  - **N+1 cron RISOLTO** (`cronService.ts`): i corpi già notificati nelle ultime 20h si caricano UNA volta (findMany + Set in memoria), non più una findFirst per ogni cliente/rata. Test aggiornati.
  - **`GET /fatture` paginato + filtri ricerca** (`contabilitaRegistro.ts`): retrocompatibile (senza parametri torna l'array come prima; con `?page/?limit` torna `{data, meta}`, default limit 50); filtri `search` (numero o nome cliente), `stato`, `tipo`.
  - ⏳ Follow-up non fatto: batch `createMany` nell'istanziazione progetto. Motivo: gli ID servono a cascata (createMany non li ritorna), l'adapter non è type-checkabile in questo ambiente, e lo spostamento in EU ha già tolto il rischio timeout che lo motivava. Basso ritorno/rischio ora.

> **🔁 Ricontrollo 22/09/2026** (verifica read-only sul codice attuale, due audit paralleli). Dal 21/09 sono stati chiusi anche: **toast** al posto dei 166 `alert()` (`e34d6de`); **accessibilità Fasi 1-2** — Modal condiviso con `role="dialog"`/focus-trap/Escape + `ConfirmProvider` su tutti i `confirm()` (~30 modali, `c3eea01`/`bcc0653`), `:focus-visible` globale e token `--hint` portato ad AA (`tokens.css`); ulteriori correzioni di contrasto tema chiaro (`9d5143c`, `a7c0bad`). Lo stato per-finding è marcato inline qui sotto: ✅ risolto · 🟡 parziale · ⏳ aperto.

**Restano aperti** (aggiornato 22/09/2026): ⏳ ciclo NC — scadenza stornata resta `parziale` senza stato terminale (A4) e NC parziali per riga impossibili (A5); ⏳ SDI scartata senza rilavorazione (W1) e nessuna segnalazione proattiva di fatture emesse-mai-trasmesse (W2); ⏳ notifiche "documento da firmare" solo in-app, senza fallback email/WhatsApp (W3); ⏳ solleciti senza macchina a stati né storia (W4); ⏳ **KYC/AML come gate** — è il modulo §5.5 di `PIANO_DI_MIGLIORAMENTO.md`, spec in `bluman-kyc-aml-spec-tecnica.md`; 🟡 token portale scaduto non forza re-login (F2) e label/`htmlFor` sui form standalone da completare (X3); ⏳ arrotondamento IVA per-riga (B1); ⏳ `createMany`/idempotenza istanziazione progetto (P6/B3); ⏳ doppio sistema bottoni (L2) e scroll orizzontale tabelle mobile (L3); ⏳ marca temporale qualificata RFC 3161 + validazione catena/revoca certificato firma (D3, follow-up esterno); ⏳ irrigidimenti sicurezza deliberati (RBAC default-permissivo, file legacy senza prefisso tenant, TTL URL firmati 7g, CORS `*.vercel.app`).

---

## Sintesi — le 3 cose che contano di più

1. **Il ciclo Nota di Credito / fattura "annullata" è rotto su più livelli** (fiscale + processo). Tre audit indipendenti convergono qui: si versa IVA su fatture stornate, le annullate ricompaiono tra gli insoluti e possono ricevere diffide, e un incasso può "resuscitare" una fattura annullata. **È il problema più grave e va affrontato come un unico intervento.**
2. **Bug di leggibilità VISIBILI nel tema chiaro (quello di default)**: numeri e titoli in `#fff` su fondi pallidi → invisibili a chiunque, subito, anche nel portale cliente. Fix meccanico ma d'impatto immediato.
3. **Due bug frontend che "mentono" all'utente**: la creazione cliente conferma anche se il DB non ha ricevuto nulla; le notifiche live del portale cliente non arrivano mai (token sbagliato).

La **sicurezza è solida**: nessuna falla critica/alta sfruttabile, RLS e auth ben costruiti. I punti aperti sono irrigidimenti, non falle.

---

## 🔴 PRIORITÀ ALTA

### A. Ciclo Nota di Credito / fattura annullata (fiscale + processo) — ✅ nucleo RISOLTO · ⏳ A4/A5 aperti
Convergenza di 5 finding da 2 audit:
- ✅ **IVA a debito sovrastimata** — `src/routes/liquidazioneIva.ts:45-53,112-119` + `src/services/lipeEngine.ts:156-162`: la LIPE filtra `tipoDocumento:'fattura'` (esclude le NC) e non esclude lo stato `annullata`. → **RISOLTO**: query estesa a `tipoDocumento in [fattura, nota_credito]` (`liquidazioneIva.ts:54,122`), NC con `segno=-1` (`lipeEngine.ts:167`), `src/lipeEngine.test.ts` creato (`60f78e5`).
- ✅ **Annullate tra gli insoluti** — `src/routes/solleciti.ts:23-38`: le query non escludono `fattura.stato='annullata'` → possibile sollecito/diffida su fattura stornata. → **RISOLTO**: `solleciti.ts:30` esclude `stato notIn [bozza, annullata]`.
- ✅ **Incasso "resuscita" l'annullata** — `src/routes/contabilitaScadenzario.ts:106-109`: dopo un incasso la fattura è forzata a `incassata`/`emessa` senza controllare lo stato. → **RISOLTO**: guardia 409 su fattura annullata + tetto over-incasso (`contabilitaScadenzario.ts:81,91-92`).
- ⏳ **Scadenze stornate messe a `parziale`** — `src/routes/contabilitaFatture.ts:530-533`: stato ambiguo. → **APERTO**: `contabilitaFatture.ts:532` la scadenza stornata resta `parziale`, nessuno stato terminale dedicato (rischio mitigato da A3).
- ⏳ **NC solo a storno totale** — la NC copia sempre tutte le righe ignorando `motivo`. → **APERTO**: emissione NC copia l'intera fattura e forza l'origine a `annullata`; `motivo` registrato ma storno sempre totale, NC parziali per riga ancora impossibili.

**Fix coordinato:** introdurre uno stato terminale dedicato per la scadenza stornata (`annullata`/`stornata`), escludere `fattura.stato in [bozza,annullata]` da LIPE/solleciti/insoluti, includere le NC nel calcolo IVA, aggiungere guardia sull'incasso di fatture annullate, e coprire tutto con test (a partire da `lipeEngine`).

### B. Leggibilità tema chiaro (testo bianco su fondo pallido) — ✅ RISOLTO (`9d5143c`, `a7c0bad`, `60f78e5`)
Tutti fix meccanici (`color:'#fff'` → token tematizzato):
- Numeri KPI invisibili — `CartellaModelliPage.tsx:43`, `ArchivioDocumentiPage.tsx:37` (componente `Riquadro` duplicato → centralizzare).
- **Portale cliente**: titolo proposta invisibile — `portal/TabProposta.tsx:119`; nome progetto in top-nav — `portal/PortalTopNav.tsx:68`.
- Badge/bottoni fattura — `InvoicesPage.tsx:564,665`; bottone sollecita — `PaymentsPage.tsx:200`.
- Recapito destinatario — `ComunicazioniTab.tsx:1006-1007`; storico contratti — `StoricoContrattiTab.tsx:39`.
- (La "trappola della carta" in dark mode è invece **già risolta** correttamente.)

### C. Due bug frontend che ingannano l'utente — ✅ RISOLTO (C1 errore bloccante in ClientsPage; C2 stream portale usa `bluman_portal_token`)
- **Creazione cliente conferma anche se il DB rifiuta** — `pages/ClientsPage.tsx:213-229`: la POST è in try/catch che fa solo console.error, poi salva in localStorage e chiude la modale come per un successo. Fix: errore bloccante, non chiudere la modale sul fallimento.
- **Notifiche live del portale non arrivano mai** — `api/notifiche.ts:52` legge `bluman_jwt_token` ma il cliente ha solo `bluman_portal_token` → lo stream non si connette mai (retry ogni 10s a vuoto). Fix: selezionare il token come `getAuthHeaders`.

### D. Compliance firma (studio trust/fiscale) — 🟡 MITIGATO code-side (D1/D2 ✅) · ⏳ D3 aperto
- ✅ **FEQ scritta senza validare il certificato** — `src/routes/firma.ts:1870,1895`: `valoreLegale='feq'` sulla sola dichiarazione dell'utente. → **RISOLTO**: `firmaFileValidazione.ts` (`fileContieneFirmaDigitale`, PAdES/PKCS#7-CAdES) con 422 in `firma.ts:1785` e `documentiFirmaStudio.ts:205`.
- 🟡 **Sigillo/verbale senza marca temporale qualificata né chiave** — `src/services/otpService.ts` `creaSigilloFea`: `new Date()` + sha256 in chiaro. → chiave **RISOLTA** (HMAC-SHA256 con `SIGILLO_HMAC_SECRET`, `otpService.ts:322,452`); ⏳ **APERTO** la marca temporale qualificata RFC 3161 (TSA) e la validazione catena/revoca certificato (follow-up esterno).

---

## 🟠 PRIORITÀ MEDIA

### Performance (aiutano ORA e dopo la migrazione VPS) — ✅ P1/P3/P4/P5 · 🟡 P2 · ⏳ P6
- 🟡 **Polling 5s del fascicolo comunicazioni su tabella senza indici** — `components/ComunicazioniTab.tsx:333-336`; `ComunicazioneProgetto` senza `@@index`. → `@@index([tenantId,progettoId,createdAt])` **AGGIUNTO** (`schema.prisma:1377`, migrazione `20260921120000`) e polling portato a **30s**; ⏳ resta da eliminare il polling a favore dell'SSE (`ComunicazioniTab.tsx:339`).
- ✅ **`GET /fatture` non paginato con include profondo** — `routes/contabilitaRegistro.ts:152-172`. → **RISOLTO**: paginazione retrocompatibile con filtri `search/stato/tipo` (`contabilitaRegistro.ts:92,101,140`).
- ✅ **N+1**: cron giornaliero (`cronService.ts:64-104`) e webhook WhatsApp (`webhooks.ts:442`). → **RISOLTO**: `cronService.ts:34-40` `findMany`+`Set`; `webhooks.ts:432` clienti caricati una volta per batch.
- ⏳ **Istanziazione progetto**: centinaia di INSERT sequenziali (`istanziaProgetto.ts:100-171`). → **APERTO**: nessun `createMany` (follow-up non fatto; rischio timeout ridotto dallo spostamento in EU).

### Frontend / stato — ✅ F1/F3/F4 · 🟡 F2
- ✅ **Logout manuale non pulisce cache né tenant** — `App.tsx:86-94`. → **RISOLTO**: `App.tsx:90-99` rimuove `bluman_tenant_id` + `invalidateCache()`; `http.ts:74` dispatcha `bluman_unauthorized` sui 401.
- 🟡 **Portale: token scaduto a metà sessione non forza il re-login** — `http.ts:73` esclude `/portal`. → **PARZIALE**: token separati per `/portal` (`http.ts:68-69`), ma la riga 73 esclude ancora `/portal` dal dispatch → per il cliente il re-login pulito non scatta.
- ✅ **Race condition + JSON.parse non protetto** in `ClientsPage.tsx`. → **RISOLTO**: guardia `annullato` (208-213) e `JSON.parse` in try/catch (254-259).
- ✅ **Mapping email→tenant hardcoded verso tenant ELIMINATI (002/003)** — `tenant.ts:100-110`. → **RISOLTO**: euristica rimossa (`tenant.ts:100-101`, tenant mock eliminati il 20/09).

### Workflow / procedure — ✅ W1-W4 fatti (22-23/09) · ⏳ KYC gate = §5.5 (fondazione 5.5.1 fatta)
- ✅ **SDI "scartata" è un vicolo cieco** (W1) — `contabilitaWebhookSdi.ts:60-62`. → **RISOLTO** (22-23/09, `7da5311`): il webhook salva il motivo in `esitoSdiDettagli`, `POST /invoices/:id/ripresenta-sdi` riapre lo scarto tecnico, la UI guida tecnico→ripresenta / contenuto→NC+riemetti.
- ✅ **`statoSdi` non tracciato dopo l'emissione** (W2): fatture emesse ma mai trasmesse passavano inosservate. → **RISOLTO** (22/09, `ca23af9`): il cron segnala le fatture `emessa` con `statoSdi='n_a'` da oltre 3 giorni.
- ✅ **Notifiche "documento da firmare" solo in-app** (W3): il cliente che non apriva il portale non sapeva di dover firmare. → **RISOLTO** (22/09, `251aa0c`): fallback best-effort email/WhatsApp (`avvisaClienteViaCanali`).
- 🟡 **KYC/AML è solo un campo passivo**: nessun gate su KYC scaduto o `rischioAml='alto'`. → **FONDAZIONE FATTA** (22-23/09, §5.5.1): modello `FascicoloKyc` + motore di rischio puro + stati + badge in anagrafica + backfill. ⏳ restano le fasi successive del modulo §5.5 (integrazioni esterne, portale cliente, dashboard e **gate operativo** bloccante).
- ✅ **Solleciti senza macchina a stati né storia** (W4): si poteva inviare una diffida come primo contatto. → **RISOLTO** (22/09, `f162389`): modello `Sollecito` (storia) + escalation stretta `puoInviareSollecito`.

### Accessibilità (sistemica) — ✅ Fasi 1-2 fatte · 🟡 label form da completare
- 🟡 Input di form senza `label` associata (solo ~6 `htmlFor` in tutto il frontend). → **PARZIALE**: i modali migrati al Modal condiviso hanno aria/label; i form standalone restano da completare.
- ✅ Pulsanti chiudi ✕ senza `aria-label` (~11 modali); `div`/`span` cliccabili non attivabili da tastiera. → **RISOLTO** per i ~30 modali migrati a `components/ui/Modal.tsx` (`c3eea01`/`bcc0653`).
- ✅ Modali senza `role="dialog"`/focus-trap/Escape. → **RISOLTO**: `Modal.tsx` con `role`, aria-labelledby, Escape in cattura e focus-trap; `confirm()` nativi sostituiti da `ConfirmProvider`.
- ✅ Focus da tastiera non visibile (`tokens.css:228` outline:none, nessun `:focus-visible` globale). → **RISOLTO**: `:focus-visible` globale + `:focus:not(:focus-visible){outline:none}` (`tokens.css:243-248`).
- ✅ Token `--hint` (#949cb2 ≈2.6:1) usato per testo informativo reale (sotto il minimo WCAG 4.5:1). → **RISOLTO**: `--hint` → `#656d85` (AA su chiaro; `#8b96a8` in dark).

---

## 🟡 PRIORITÀ BASSA
- ✅ **166 `alert()` nativi in 39 file** (nessun sistema di toast), incluso il portale cliente. → **RISOLTO**: `ToastProvider` centralizzato, `alert()` nativi spariti dal codice app (`e34d6de`).
- ⏳ **Due sistemi di bottoni** (classi `.btn` complete ma la maggioranza è inline senza hover/disabled/focus). → **APERTO**: bottoni ancora in larga parte con stile inline.
- ⏳ Tabelle senza wrapper scroll orizzontale → colonne tagliate su mobile. → **APERTO** (non riscontrata soluzione).
- ⏳ Arrotondamento IVA per riga poi sommato (`fatturaEngine.ts:142-159`): possibile scarto di 1 cent nei DatiRiepilogo SdI. → **APERTO**: metodo invariato (`fatturaEngine.ts:98`).
- 🟡 Nessun tetto sull'importo incassato (`contabilita.schema.ts:44`). → **PARZIALE**: schema senza `max`, ma guardia runtime aggiunta (`contabilitaScadenzario.ts:92`, vedi A3).
- ⏳ Idempotenza istanziazione progetto (`istanziaProgetto.ts:177`). → **APERTO**.
- ⏳ Sicurezza (irrigidimenti, non falle): RBAC default-permissivo + fail-open; file legacy senza prefisso tenant scaricabili cross-tenant (`catalogo.ts:208-212`); URL di download firmati con TTL 7g in query string; `statoSdi` webhook non validato; CORS `*.vercel.app` in prod (`server.ts:246`). → **APERTO / deliberati**: invariati per scelta.

---

## Ordine d'attacco consigliato

> **Aggiornato 22/09/2026**: A / B / C / D e gran parte della performance sono chiusi (vedi marcatori sopra). L'ordine residuo è: **1)** chiudere A4/A5 (stato terminale scadenza stornata + NC parziali per riga); **2)** workflow — SDI scartata, notifiche firma via email/WhatsApp, solleciti a stati; **3)** **modulo KYC/AML §5.5** (`bluman-kyc-aml-spec-tecnica.md`); **4)** completare a11y (label form) + F2 (re-login portale); **5)** D3 marca temporale qualificata quando si sceglie la TSA. L'elenco numerato qui sotto è quello originale del 21/09, conservato per memoria.

1. **A** (ciclo NC/annullata) — impatto fiscale/legale reale, un intervento coordinato con test.
2. **B + C** (leggibilità tema chiaro + i due bug che ingannano l'utente) — fix rapidi, alto impatto percepito, portale cliente prima.
3. **Performance**: indici + stop al polling su `comunicazione_progetto`, poi paginazione di `/fatture` e rami non paginati. Aiuta subito e prepara il VPS.
4. **D** (compliance firma) — prima di usare BluMan per firme FEQ con valore legale verso terzi.
5. Media/bassa a seguire: logout/cache, SDI scartata, KYC gate, accessibilità (label + aria + Modal condiviso), toast.

---

## Sicurezza — nota positiva
Verificati corretti: JWT (no algorithm-confusion, riverifica sessione fail-closed ad ogni richiesta), isolamento header `x-tenant-id` solo per super_admin, RLS completa e forzata, `prismaAmministrativo` usato solo dove legittimo, IDOR portale chiuso, OTP/magic-link robusti, firme webhook verificate, nessuna SQL injection nei percorsi di richiesta, path traversal chiuso, segreti non esposti.
