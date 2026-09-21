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
- **Performance — RISOLTO i più impattanti:** aggiunti `@@index` a `ComunicazioneProgetto` (migrazione `20260921120000_indici_comunicazione_progetto`); polling comunicazioni 5s→30s; anagrafica clienti caricata una volta per batch nel webhook WhatsApp (non più N full-scan). ⏳ Follow-up: N+1 nel cron, paginazione di `/fatture`, batch `createMany` nell'istanziazione progetto.

Restano aperti (media/bassa priorità, non toccati): SDI scartata senza rilavorazione; `statoSdi` non tracciato post-emissione; notifiche "documento da firmare" solo in-app; KYC/AML come gate; accessibilità (label/aria/Modal/focus); toast al posto degli `alert()`; arrotondamento IVA per-riga; irrigidimenti sicurezza (RBAC default-permissivo, file legacy cross-tenant, TTL URL firmati, CORS `*.vercel.app`).

---

## Sintesi — le 3 cose che contano di più

1. **Il ciclo Nota di Credito / fattura "annullata" è rotto su più livelli** (fiscale + processo). Tre audit indipendenti convergono qui: si versa IVA su fatture stornate, le annullate ricompaiono tra gli insoluti e possono ricevere diffide, e un incasso può "resuscitare" una fattura annullata. **È il problema più grave e va affrontato come un unico intervento.**
2. **Bug di leggibilità VISIBILI nel tema chiaro (quello di default)**: numeri e titoli in `#fff` su fondi pallidi → invisibili a chiunque, subito, anche nel portale cliente. Fix meccanico ma d'impatto immediato.
3. **Due bug frontend che "mentono" all'utente**: la creazione cliente conferma anche se il DB non ha ricevuto nulla; le notifiche live del portale cliente non arrivano mai (token sbagliato).

La **sicurezza è solida**: nessuna falla critica/alta sfruttabile, RLS e auth ben costruiti. I punti aperti sono irrigidimenti, non falle.

---

## 🔴 PRIORITÀ ALTA

### A. Ciclo Nota di Credito / fattura annullata (fiscale + processo)
Convergenza di 5 finding da 2 audit:
- **IVA a debito sovrastimata** — `src/routes/liquidazioneIva.ts:45-53,112-119` + `src/services/lipeEngine.ts:156-162`: la LIPE filtra `tipoDocumento:'fattura'` (esclude le NC) e non esclude lo stato `annullata`. Risultato: si calcola (e potenzialmente versa) IVA su operazioni stornate. Aggravante: **non esiste `lipeEngine.test.ts`**. Il percorso report (`reportsService.ts:288-294`) invece sottrae le NC — i due percorsi divergono.
- **Annullate tra gli insoluti** — `src/routes/solleciti.ts:23-38`: le query solleciti/insoluti non escludono `fattura.stato='annullata'` → una fattura stornata con residuo>0 può ricevere un sollecito o una diffida legale (231/2002).
- **Incasso "resuscita" l'annullata** — `src/routes/contabilitaScadenzario.ts:106-109`: dopo un incasso la fattura è forzata a `incassata`/`emessa` senza controllare lo stato corrente.
- **Scadenze stornate messe a `parziale`** — `src/routes/contabilitaFatture.ts:530-533`: stato ambiguo (parziale = incassata in parte), che alimenta i tre problemi sopra.
- **NC solo a storno totale** — la NC copia sempre tutte le righe ignorando `motivo` (sconto/abbuono/reso); NC parziali impossibili.

**Fix coordinato:** introdurre uno stato terminale dedicato per la scadenza stornata (`annullata`/`stornata`), escludere `fattura.stato in [bozza,annullata]` da LIPE/solleciti/insoluti, includere le NC nel calcolo IVA, aggiungere guardia sull'incasso di fatture annullate, e coprire tutto con test (a partire da `lipeEngine`).

### B. Leggibilità tema chiaro (testo bianco su fondo pallido) — bug live
Tutti fix meccanici (`color:'#fff'` → token tematizzato):
- Numeri KPI invisibili — `CartellaModelliPage.tsx:43`, `ArchivioDocumentiPage.tsx:37` (componente `Riquadro` duplicato → centralizzare).
- **Portale cliente**: titolo proposta invisibile — `portal/TabProposta.tsx:119`; nome progetto in top-nav — `portal/PortalTopNav.tsx:68`.
- Badge/bottoni fattura — `InvoicesPage.tsx:564,665`; bottone sollecita — `PaymentsPage.tsx:200`.
- Recapito destinatario — `ComunicazioniTab.tsx:1006-1007`; storico contratti — `StoricoContrattiTab.tsx:39`.
- (La "trappola della carta" in dark mode è invece **già risolta** correttamente.)

### C. Due bug frontend che ingannano l'utente
- **Creazione cliente conferma anche se il DB rifiuta** — `pages/ClientsPage.tsx:213-229`: la POST è in try/catch che fa solo console.error, poi salva in localStorage e chiude la modale come per un successo. Fix: errore bloccante, non chiudere la modale sul fallimento.
- **Notifiche live del portale non arrivano mai** — `api/notifiche.ts:52` legge `bluman_jwt_token` ma il cliente ha solo `bluman_portal_token` → lo stream non si connette mai (retry ogni 10s a vuoto). Fix: selezionare il token come `getAuthHeaders`.

### D. Compliance firma (studio trust/fiscale)
- **FEQ scritta senza validare il certificato** — `src/routes/firma.ts:1870,1895`: `valoreLegale='feq'` sulla sola dichiarazione dell'utente; un requisito FEQ si soddisfa caricando un PDF qualunque. Fix: validare la firma qualificata (PAdES/CAdES) o declassare a "file firmato non verificato".
- **Sigillo/verbale senza marca temporale qualificata né chiave** — `src/services/otpService.ts` `creaSigilloFea`: `new Date()` + sha256 in chiaro (non HMAC/firma, non TSA RFC 3161). Per FEA/FEQ mancano data certa opponibile e non ripudio. Fix: marca temporale qualificata + sigillo con chiave.

---

## 🟠 PRIORITÀ MEDIA

### Performance (aiutano ORA e dopo la migrazione VPS)
- **Polling 5s del fascicolo comunicazioni su tabella senza indici** — `components/ComunicazioniTab.tsx:333-336` + `routes/progetti.ts:42`. Esiste già l'SSE `/stream` ma il polling gira lo stesso; `ComunicazioneProgetto` (schema.prisma:1358) non ha nessun `@@index`. Fix: eliminare il polling + `@@index([tenantId,progettoId,createdAt])`. **Massimo rapporto beneficio/rischio.**
- **`GET /fatture` non paginato con include profondo** — `routes/contabilitaRegistro.ts:152-172` (cresce senza limite). + tutti i rami `if(!paginazione.paginata)` di progetti/clienti/audit-logs/scadenzario/prima nota.
- **N+1**: cron giornaliero (`cronService.ts:64-104`) e webhook WhatsApp che ricarica tutti i clienti per ogni messaggio (`webhooks.ts:442`). Ricorda: con la RLS ogni query è ~4 round-trip, quindi un N+1 è N transazioni.
- **Istanziazione progetto**: centinaia di INSERT sequenziali in una tx da 15s (`istanziaProgetto.ts:100-171`) → rischio timeout. Fix: `createMany`.

### Frontend / stato
- **Logout manuale non pulisce cache né tenant** — `App.tsx:86-94`: l'utente B (stesso tenant) può vedere per ~30s liste/notifiche in cache di A. Fix: dispatch `bluman_unauthorized`/invalidateCache + rimuovere `bluman_tenant_id`.
- **Portale: token scaduto a metà sessione non forza il re-login** — `http.ts:73` esclude `/portal` → il cliente resta su una UI che dà errori.
- **Race condition + JSON.parse non protetto** in `ClientsPage.tsx` (risposte fuori ordine; spinner bloccato se storage corrotto).
- **Mapping email→tenant hardcoded verso tenant ELIMINATI (002/003)** — `tenant.ts:100-110`: codice morto e pericoloso, da rimuovere.

### Workflow / procedure
- **SDI "scartata" è un vicolo cieco** — `contabilitaWebhookSdi.ts:60-62`: nessun percorso per correggere e ritrasmettere (per legge entro 5 gg). 
- **`statoSdi` non tracciato dopo l'emissione**: fatture emesse ma mai trasmesse passano inosservate.
- **Notifiche "documento da firmare" solo in-app**: il cliente che non apre il portale non sa di dover firmare → incarico fermo a tempo indefinito. Fix: fallback email/WhatsApp.
- **KYC/AML è solo un campo passivo**: nessun gate su KYC scaduto o `rischioAml='alto'`. Per uno studio soggetto al 231/2007 l'adeguata verifica è un dato editabile, non un processo.
- **Solleciti senza macchina a stati né storia**: si può inviare una diffida come primo contatto.

### Accessibilità (sistemica)
- Input di form senza `label` associata (solo ~6 `htmlFor` in tutto il frontend).
- Pulsanti chiudi ✕ senza `aria-label` (~11 modali); `div`/`span` cliccabili non attivabili da tastiera.
- Modali senza `role="dialog"`/focus-trap/Escape.
- Focus da tastiera non visibile (`tokens.css:228` outline:none, nessun `:focus-visible` globale).
- Token `--hint` (#949cb2 ≈2.6:1) usato per testo informativo reale (sotto il minimo WCAG 4.5:1).

---

## 🟡 PRIORITÀ BASSA
- **166 `alert()` nativi in 39 file** (nessun sistema di toast), incluso il portale cliente. Sostituire con un toast centralizzato dà un salto di qualità percepita.
- **Due sistemi di bottoni** (classi `.btn` complete ma la maggioranza è inline senza hover/disabled/focus).
- Tabelle senza wrapper scroll orizzontale → colonne tagliate su mobile.
- Arrotondamento IVA per riga poi sommato (`fatturaEngine.ts:142-159`): possibile scarto di 1 cent nei DatiRiepilogo SdI.
- Nessun tetto sull'importo incassato (`contabilita.schema.ts:44`).
- Idempotenza istanziazione progetto (`istanziaProgetto.ts:177`).
- Sicurezza (irrigidimenti, non falle): RBAC default-permissivo + fail-open; file legacy senza prefisso tenant scaricabili cross-tenant (`catalogo.ts:208-212`); URL di download firmati con TTL 7g in query string; `statoSdi` webhook non validato; CORS `*.vercel.app` in prod.

---

## Ordine d'attacco consigliato
1. **A** (ciclo NC/annullata) — impatto fiscale/legale reale, un intervento coordinato con test.
2. **B + C** (leggibilità tema chiaro + i due bug che ingannano l'utente) — fix rapidi, alto impatto percepito, portale cliente prima.
3. **Performance**: indici + stop al polling su `comunicazione_progetto`, poi paginazione di `/fatture` e rami non paginati. Aiuta subito e prepara il VPS.
4. **D** (compliance firma) — prima di usare BluMan per firme FEQ con valore legale verso terzi.
5. Media/bassa a seguire: logout/cache, SDI scartata, KYC gate, accessibilità (label + aria + Modal condiviso), toast.

---

## Sicurezza — nota positiva
Verificati corretti: JWT (no algorithm-confusion, riverifica sessione fail-closed ad ogni richiesta), isolamento header `x-tenant-id` solo per super_admin, RLS completa e forzata, `prismaAmministrativo` usato solo dove legittimo, IDOR portale chiuso, OTP/magic-link robusti, firme webhook verificate, nessuna SQL injection nei percorsi di richiesta, path traversal chiuso, segreti non esposti.
