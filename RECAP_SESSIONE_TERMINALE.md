# 📑 Report & Passaggio Consegne — Sessione Terminale Claude

> **Ultimo aggiornamento: 09/10/2026.** Il documento nasce come consegna della sessione del
> 22-23 settembre 2026 (oltre 26 ore, 79 interazioni, chiusa per saturazione della context
> window: `API Error: 400 Context window is full`). Da allora è tenuto aggiornato come
> **registro di cosa è stato fatto**, ricostruito dai commit e non dalla memoria.
> **Nessun dato o codice è andato perduto:** tutto il lavoro è consolidato nei commit Git.

---

## 🧭 Dove siamo — 09/10/2026

| | |
|---|---|
| Ultimo commit | `87a77482` — 08/10/2026 19:32 |
| Branch | `main`, **allineato a `origin/main`** (nessun commit da pushare) |
| Working tree | 17 file modificati + 2 nuovi, **non committati**: 9 di documentazione (questo file, `PIANO_DI_MIGLIORAMENTO.md`, `PIANO_MIGRAZIONE_VPS.md`, `.agents/AGENTS.md`, `docs/vps-primo-avvio.md`, `docs/manuale/19-infra-deploy.md`, `docs/manuale/README.md`, `docs/manuale/17-rbac.md`, `docs/manuale/15-comunicazioni.md`) e 8 di codice + 2 nuovi per le **voci 4 e 5** (vedi §«Deciso il 09/10/2026») |
| VPS | ✅ **Allineato e verificato il 09/10/2026** — `87a77482` è in esecuzione e la configurazione nginx combacia byte per byte (vedi §5.1) |
| Prossimo passo | **Voci 6 + 9(c)** (l'avviso «non instradabile» cliccabile + il filtro «senza fascicolo»), poi la **18** (secondo studio). La **voce 8-bis** è **sbloccata**: lo spike del 09/10 ha stabilito che non serve il dominio |

---

## 💾 File di backup della sessione storica (22-23/09)

Nella directory [`.terminal_backup/`](file:///c:/BluMan/.terminal_backup/), **gitignorata** — i link
funzionano solo sulla macchina che ha tenuto l'archivio:

1. **[CLAUDE_TERMINAL_COMPACT_SUMMARY.md](file:///c:/BluMan/.terminal_backup/CLAUDE_TERMINAL_COMPACT_SUMMARY.md)**
   (18 KB) — tabella cronologica turno per turno (1-79): timestamp, richiesta, tool invocati, esito.
2. **[CLAUDE_TERMINAL_FULL_TRANSCRIPT.md](file:///c:/BluMan/.terminal_backup/CLAUDE_TERMINAL_FULL_TRANSCRIPT.md)**
   (172 KB) — trascrizione integrale dei dialoghi e delle decisioni operative.
3. **[CLAUDE_SESSION_RAW.jsonl](file:///c:/BluMan/.terminal_backup/CLAUDE_SESSION_RAW.jsonl)**
   (7.1 MB) — copia fedele del log interno di Claude Code, riutilizzabile da qualsiasi script.

---

## 🚀 Cosa è stato fatto

### 1. KYC / AML Malta — il ciclo K0→K9 è completo e deployato (23-27/09/2026)

Il modulo antiriciclaggio è passato dalla specifica v0.1 alla **v0.2 FIAU-compliant** e da lì
all'implementazione integrale. Non è più una fondazione: è un modulo che gira.

- **K0 — fondazione compliance.** `TenantComplianceSettings` (modalità bozza/vigente) e
  `ComplianceEvent` con **catena di hash SHA-256** (merkle-chain) per l'inalterabilità delle
  verifiche. Rotte impostazioni compliance + modalità bozza + eventi a catena, e la loro
  scheda in Impostazioni → Compliance/AML.
- **K1 — la pratica KYC.** Modello soggetti/documenti/rappresentanza, **macchina a stati v0.2**
  in dominio puro con presidio, service transizioni + rotte `/kyc` che scrivono un
  `ComplianceEvent` a ogni cambio di stato, e la UI della pratica nella scheda cliente.
- **K2 — titolare effettivo.** Dominio di ricostruzione della **catena di controllo**, scadenza
  variazioni a 14 giorni, deposito del registro, configurazione del TE dalle Impostazioni e UI
  con i titolari effettivi nella scheda cliente.
- **K3 — valutazione del rischio a 4 pilastri** (modello + dominio worst-case + UI).
- **K4 — gate operativo.** Nessuna fattura e nessun avvio incarico senza KYC approvato;
  banner del gate nella scheda Fatturazione e **sblocco motivato** dall'admin (`OverrideKyc`).
- **K5 — screening** PEP/sanzioni/mezzi di informazione: modello, dominio, gate di
  approvazione (spec §8.4) e pannello UI.
- **K6 — documenti d'identità**: upload del soggetto con storage sicuro e hash, UI per il
  titolare effettivo e **upload dal Portale Cliente**.
- **K7 — monitoraggio continuo**: dominio delle revisioni, segnalazione dal cron delle
  revisioni dovute, badge nella scheda cliente, revisione KYC come **scadenza derivata nel
  calendario**, e il cron che rispetta il **modulo KYC spento** dallo studio.
- **K8a — anomalie** e decisione MLRO; **K8b — segnalazione FIAU/STR** con dossier PDF,
  rotte MLRO-gated e pannello nella scheda cliente.
- **K9 — il giro di compliance dello studio**: conservazione/retention (dominio, campi, cron
  che avvisa l'MLRO, pannello in scheda cliente), registro formazione AML con cadenza,
  questionario periodico FIAU (REQ), **business risk assessment** versionato, e i due report
  PDF — **per fascicolo** (per ispezione) e **di studio**.
- **Attivazione per studio (M1-M4)**: il modulo KYC si concede **per-studio** dalla console
  Super Admin, la UI rispetta l'attivazione e il backend risponde **403** dove il modulo è spento.
- **Document Studio**: aggiunte le schede **CDD/KYC Malta** (persona fisica e giuridica).

> **Resta aperto:** **K5** nella sua parte automatica (serve un **provider** di screening) e
> **K8b/XML goAML** (manca l'**XSD della FIAU**). Tutto il resto del ciclo è chiuso.

### 2. Audit di sicurezza del 27/09/2026 — remediation interamente deployata

Il materiale sta in **`AUDIT_2026-09-27/`** (versionato, commit `752e9c63`): sintesi
`00-AUDIT_COMPLETO.md`, le sette sezioni e la revisione avversariale `08`.

- **RBAC: enforcement lato server.** Fino al 27/09 la matrice `PermessoModulo` era
  *client-side only*: Sidebar e route guard nascondevano le pagine, ma con un JWT valido
  qualsiasi collaboratore poteva chiamare le API dei moduli «denied» con `curl`. Ora l'hook
  `onRequest` traduce il pattern di rotta in chiave modulo e consulta la matrice prima di
  lasciar passare. Le chiavi mappate sono salite a dodici con **`communications`**,
  **`documents`** e **`library`**.
- **Default per ruolo lato server** (`permessoDefaultPerRuolo`): una chiave senza riga in
  matrice non è più «accesso pieno». Era un buco **Alta**: un `collaboratore_esterno` senza
  matrice leggeva via API IBAN, codice fiscale e UBO dei clienti.
- **Bypass 2FA chiuso.** Il `preToken` emesso dopo la sola password porta `scopo: 'pre_totp'`
  e vale **solo** per `POST /auth/totp/verifica`: l'hook lo rifiuta come sessione. Prima aveva
  le stesse claim di un token pieno e veniva pure rinnovato.
- **`PATCH /tenant/info`** riservato ad advisor/super_admin, e i **campi di piattaforma**
  (`piano`, `stato`, `dataAttivazione`, `dataScadenza`) fuori dalle `allowedKeys`: li scrive
  solo il super_admin dalle rotte `/admin/tenants`.
- **Gate KYC sulla fatturazione**, `POST /progetti/:id/fatture` incluso.
- **IVA riepilogo SDI** con arrotondamento di gruppo, e `PUT /invoices` atomico.
- **Firma-studio**: sigillo in **HMAC** e impronta sul **contenuto del file** (evidenza legale).
- **Multi-firma**: stato `parzialmente_firmato`, anti-ri-firma per parte, cronologia firme sul
  documento finale.
- **Canali**: l'invio è governato dalla matrice (`communications`), relay **fail-closed**
  senza `EMAIL_RELAY_SECRET`, invii `/comunicazioni` riservati ad advisor/admin con audit.
- **Motore di stato §16**: `consuntivaMicrovoce` usa il dominio (`calcolaStatoModulo`, nessuna
  chiusura con voce bloccata); de-completamento micro-voce su stato `active`.
- **Accessibilità (X3)**: label ↔ input associati semanticamente in login, modale cambio
  password obbligatorio, form rapido nuovo cliente, anagrafica ERP, registro fatture e
  modali incasso/NC, gruppo «Tipo Cliente» e righe prestazioni fattura.

### 3. Firma legale SES / FEA / FEQ — le decisioni del 03/10/2026

Tutto in `piano-firma-legale-ses-fea-feq.md` **§8**, che è il posto dove le decisioni sono
scritte.

- **§8.2 — chi firma a nome dello studio**: **solo `advisor`/`super_admin`**. Prima bastava
  non essere `cliente`, quindi `documents:write` in matrice abilitava a firmare per lo studio.
- **§8.3 — le stesse guardie del percorso cliente** sul percorso studio: `bozza`/`in_revisione`
  → 409, `statoScansione` infetto → 400 / in corso → 409. Entrambi i percorsi chiamano
  `segnaDocumentoFirmato` + `generaVerbaleDiFirma` (estratti in `src/services/effettiFirma.ts`).
- **§8.1 — la controfirma si regge sul dato, non sulla stringa**: `FirmaElettronica` porta
  **`parte`** (`cliente`/`studio`) e **`sigilloDigest`** (migrazione `20261003120000_firma_parte_e_sigillo`),
  tutte le letture usano `parte`, il riquadro della controparte porta **il suo** sigillo (tolto
  il ripiego `|| sigilloDigest` che stampava l'impronta dell'evento in corso sotto il nome
  dell'altra parte) e l'anti-ri-firma legge `parte`.
- **§8.4 — l'impronta della lettera d'incarico la calcola il server** (`improntaLetteraIncarico`),
  su **entrambi** i canali. La premessa della voce («il server rilegge il file») era **falsa**:
  la lettera non è un file, il testo è un template del portale riempito dal browser. Il digest
  copre i **dati dell'incarico** + la **versione delle clausole**, e il verbale dichiara il
  perimetro con una riga «Cosa copre l'impronta».
- **La controfirma resta sui documenti del Vault** (aree a due colonne sui 22 template di
  riorganizzazione), **non sulla lettera**, che non è un documento: applicare la restrizione
  avrebbe voluto dire togliere `{{firma_studio}}` dai 22 modelli, cioè spegnere la firma dello
  studio nel prodotto. **Il verbale è uno per firma.**

### 4. Comunicazioni ⇄ micro-voci — il messaggio sa dove appartiene (05-07/10/2026)

- **Il messaggio sa a quale micro-voce appartiene**: il backend fa nascere l'abbinamento
  (`origine: 'microvoce'`) invece di lasciarlo dedurre al browser.
- **Il portale entra nell'abbinamento**: anche i messaggi che arrivano dal Portale Cliente
  si abbinano alle micro-voci.
- **`utils/origineAbbinamento.ts`** — **una tabella sola** per le quattro origini
  (`contesto`, `microvoce`, `manuale`, `eredita`): icona, etichetta, motivo esteso e colore.
  Il ternario era scritto **due volte per file** e con il quarto valore sarebbero diventati
  otto punti da toccare. Fino al 06/10 erano **verdi tutte e tre** — cioè «va tutto bene» su
  abbinamenti che nessuno aveva dichiarato.
- **Il compositore dentro la micro-voce**: la quarta scheda del `PassaggioModal` non è più in
  sola lettura, si risponde restando dove si sta leggendo (`passaggio/ComposerMicrovoce.tsx`).
  La consegna è salita in **`hooks/useInvioComunicazione.ts`**: i punti di montaggio sono due
  (la chat della pratica e la micro-voce) e due copie della stessa procedura sarebbero due
  verità sulla consegna — è il guasto che `SpunteStato.tsx` racconta.
- **La rilettura a 30 s sta nel padre**, non nella scheda: il conteggio sulla linguetta deve
  restare fresco quanto l'elenco, e la rilettura è **silenziosa** (non accende lo stato di
  caricamento). Prima si leggeva una volta sola al montaggio, e il sintomo era «il messaggio
  c'è nella chat ma non nella voce, e riappare riaprendo il modale».
- **E2E**: il legame messaggio ↔ micro-voce è provato **dal browser**, e l'ambiente di test si
  azzera davvero (il limitatore non falsa più la corsa).

### 5. Micro-voci — la scheda si aggiorna da sé (07/10/2026)

Le due schede **cancellate per sbaglio** dal commit `8b1d9e21` sono tornate vive: il commit
aveva portato via stato, handler e JSX lasciando i pulsanti a chiamare un setter il cui valore
nessuno leggeva — il sintomo era «il pulsante non fa niente». Ripristinate con **tre esclusioni
deliberate**, documentate in testa ai file: nessun documento inventato dal nome del cliente,
nessuna precompilazione con P.IVA/IBAN/CF falsi, nessuna scritta «✓ Dati verificati dal sistema
KYC» (in uno studio FIAU/MFSA una rassicurazione di conformità non guadagnata è peggio di
nessuna rassicurazione).

### 6. Produzione sul VPS — da Supabase/Railway al server co-locato (26/09 → 08/10/2026)

Il piano è `PIANO_MIGRAZIONE_VPS.md`; la checklist operativa è `docs/vps-primo-avvio.md`.
**Motivo misurato:** su Railway, `/health` — una `SELECT 1` pura — costava **~320 ms lato
server**: backend e database erano lontani in rete, e la RLS moltiplica quel costo per ~3
round-trip. Con app e Postgres sullo stesso VPS quei round-trip diventano **socket locale**.

- **Stack `docker-compose.prod.yml`**: Postgres 17 + **PgBouncer** (transaction mode) davanti
  al database, `migrate` → `rls` → `api`, nginx che serve la SPA e proxa le API.
- **Provisioning**: `bluman_app` **non è superuser** del DB — è il ruolo applicativo soggetto
  alla RLS (prima lo stack lo creava come superuser, cioè senza isolamento).
- **Frontend e API sulla stessa origine**: `VITE_API_BASE=/api`, prefisso che nginx toglie
  prima di consegnare la richiesta. Non è stile: senza, sette pagine (`/portal`, `/reports`,
  `/invoices`, `/fornitori`, `/timesheet`, `/liquidazione-iva`, `/admin/tenants`) si aprivano
  dalla navigazione interna e rispondevano **404/401** a chi le ricaricava.
- **`distribuisci.sh`** aggiorna anche il VPS (codice, frontend, database, backend). ⚠️ Mentre
  gira **non si modificano file tracciati**: al passo 2 lo script controlla
  `git status --porcelain --untracked-files=no` ed esce se trova modifiche non committate.
- **Backup e sorveglianza**: backup del VPS che copre anche documenti e segreti e vive **fuori
  dall'app**, cifrato; sette controlli sul VPS con avvisi Telegram.
- **Telegram**: un bot ammette **un solo webhook**, oggi occupato da Railway. Il 400 sul VPS
  **protegge la produzione**: se passasse, il webhook si sposterebbe via in silenzio. Il bot si
  sposta **solo** al cut-over, e mai su entrambi insieme.

#### 5.1 L'ultimo guasto, e perché è la cosa da verificare per prima

Sintomo riportato dal titolare: **«nel VPS non sono arrivate le modifiche fatte»** — con `git`
allineato, bundle nuovo realmente servito dalla porta 80 e nessun errore da nessuna parte.
**Due cause distinte, stessa faccia.**

1. **`e52acdc7` (08/10, 18:31) — la cache del browser.** `nginx/bluman_app.inc` non mandava
   **nessun `Cache-Control`** su `location /`, quindi il browser applicava la scadenza
   euristica (≈10% dell'età del file) e per ore serviva il **vecchio `index.html`** — che è il
   file che *nomina* gli asset. Su Vercel non capitava perché la piattaforma manda
   `max-age=0, must-revalidate`: **lo stesso codice arrivava là e non qui.** Rimedio:
   `expires -1` su `location /` (rivalida sempre, 304 finché non cambia) e `expires 1y` su
   `/assets/` (il nome porta l'hash del contenuto). `expires` e **non** `add_header`, perché
   un `add_header` in un `location` **annulla** quelli ereditati dal server — le tre
   intestazioni di sicurezza sarebbero sparite proprio dal frontend.
2. **`87a77482` (08/10, 19:32) — il primo deploy della correzione è FALLITO al passo 7, e la
   sonda ha fatto il suo mestiere.** `docker-compose.prod.yml` montava i tre file di nginx
   **uno per uno**, e un bind mount di un **file singolo** lega l'**inode**, non il percorso:
   `git` scrive a parte e **rinomina**, quindi cambia inode. Il container serviva il file del
   **02/10** (inode 840680) mentre sull'host c'era quello dell'**08/10** (inode 840706) — e
   `nginx -t` e `nginx -s reload` riuscivano, rileggendo però il file **vecchio**. Passi 1, 2 e
   6 tutti verdi, «nginx ricaricato» ✔, e la configurazione in produzione **ferma a sei giorni
   prima**. A bocciare il deploy è stata la **sonda della cache** (`trovato: «nessuno»`), e lo
   script è uscito con 1: il guasto l'ha visto la sonda, non il browser.
   **Rimedio strutturale:** i tre file stanno in `nginx/` e il compose monta la **cartella**
   (`./nginx:/etc/nginx/conf.d:ro`) — un mount di cartella risolve il percorso a ogni accesso.
   **Due presidi**, perché il presidio da solo non copre tutto:
   - `src/infrastrutturaDeploy.test.ts` vieta i montaggi di file singoli (provato
     avversarialmente: reintroducendoli, il test rosseggia);
   - il passo **6-d-ter** di `distribuisci.sh` confronta lo **sha256** del file nel repository
     con quello dentro il container e, se differiscono, ricrea nginx da sé. Copre la
     **transizione**, che il test non può coprire.

> ✅ **Verificato il 09/10/2026: il deploy di `87a77482` era arrivato — e il guasto dell'08/10 è
> guarito.** Il dubbio lasciato aperto dallo spegnimento del PC («il secondo tentativo è andato a
> termine?») è stato sciolto **interrogando il server**, non i documenti:
>
> | Prova | Atteso | Trovato sul VPS |
> |---|---|---|
> | `git rev-parse HEAD` in `/opt/bluman` | `87a77482…` | `87a77482969230c3c53031c95ae428979abd0d7d` ✅ |
> | sha256 di `nginx/bluman_app.inc` — repository vs. container | identici | `15d1bb90…4b5f85a` **=** `15d1bb90…4b5f85a` ✅ |
> | `nginx` e `api` | ricreati dopo il commit | Up, ricreati ~13 min dopo il commit ✅ |
> | `migrate` / `rls` | uscita pulita | **Exited (0)** nello stesso giro ✅ |
> | ultima migrazione applicata | `20261005120000_comunicazione_microvoce` | la stessa (e la più recente del repo) ✅ |
> | `Cache-Control` su `/` e `/assets/*.js` | `no-cache` / `max-age=31536000` | `no-cache` / `max-age=31536000` ✅ |
> | sette pagine SPA + `/api/health` | `200 text/html` / `200 JSON` | tutte `200` ✅ |
>
> Il confronto dello **sha256** è quello che conta: è esattamente il passo **6-d-ter**, ed è l'unica
> prova che la configurazione **in esecuzione** è quella del repository — il caso del 02/10 in cui
> `git` era allineato e il container serviva comunque il file vecchio. **La lezione che resta è che
> «il deploy è arrivato» va verificato sul server**, perché lo script che lo annuncia è lo stesso che
> può mentire. (Il TLS sulla 443 non risponde ancora: è la voce aperta 10, attesa finché il DNS non
> punta al server.)

### 7. Altre cose chiuse nel periodo

- **Filtri & Periodo globale** (27/09): selettore di **Periodo/Esercizio** nella barra in alto,
  filtro per intervallo di date su progetti, fatture, scadenzario e documenti, persistito
  per-tenant e **sempre azzerabile**. Non è uno «scatolone per anno»: i record restano
  continui, il periodo è una **lente**.
- **Manuale per modulo** (28-29/09): `docs/manuale/` completo, **00-19**, due livelli
  (operatore + tecnico).
- **Clienti** (02/10): due viste — **elenco** (predefinita) e **schede** — con filtro per tipo
  e per accesso al portale, e ordinamento dalle intestazioni.
- **Team** (01/10): **archiviazione** e riattivazione dell'operatore (§2bis). Non cancella
  nulla: gli archiviati stanno in una sezione a parte. E un collaboratore invitato **nasce in
  forza** (`apriPeriodoIniziale`), senza il quale «Archivia» non avrebbe mai funzionato sul
  caso più comune di tutti.
- **Uploads** (01/10): i nomi file lunghi tornano scaricabili (`414 URI Too Long`); il logo
  caricato si risolve sulla base delle API e non più su Railway (era corretto *per caso*).
- **L2 — bottoni inline → classi `.btn`** (25/09): conversione avviata e **in pausa**. La coda
  è estetica e in parte **non va convertita** (tab-bar, segmented control, icona, azioni-link,
  bottoni a colore dinamico): convertirli rompe l'evidenza dell'attivo.
- **Privacy** (25/09): rimosso un **numero di telefono reale** dalle schede/demo, sostituito
  con un esempio.
- **Repository** (05/10): riga 24 del piano **chiusa senza cancellare niente** — ogni file non
  versionato ha ora una sorte dichiarata (versionato o gitignorato). `graphify-out/cache/`
  non è più versionata.

---

## 📌 Stato del repository Git

```
main ... origin/main      (allineato, nessun commit da pushare)
 M RECAP_SESSIONE_TERMINALE.md       ← questo file
 M PIANO_DI_MIGLIORAMENTO.md         ← nota di verifica VPS + voce 8 (Dropbox) + voci 4 e 5 chiuse
 M PIANO_MIGRAZIONE_VPS.md           ← verifica on-server + copia off-site: provider deciso
 M .agents/AGENTS.md                 ← copia off-site: provider deciso
 M docs/vps-primo-avvio.md           ← copia off-site: provider deciso
 M docs/manuale/19-infra-deploy.md   ← le tre destinazioni di deploy (prima diceva due)
 M docs/manuale/README.md            ← indice: destinazione di produzione
 M docs/manuale/17-rbac.md           ← voci 4 e 5
 M docs/manuale/15-comunicazioni.md  ← voce 4
 M src/util/rbacModuli.ts            ← VOCE 4: la mappa copre la lettura, non solo l'invio
 M src/rbacModuli.test.ts            ← VOCE 4: i casi di confine nuovi
 M src/server.ts                     ← VOCE 5: il catch ricade sul default per ruolo
 M src/rbacServer.test.ts            ← VOCE 5: il test asseriva il contrario; + voce 4
 M src/routes/comunicazioni.ts       ← VOCE 4: il commento diceva «invio soltanto»
?? frontend/src/utils/comunicazioniAccesso.ts       (nuovo)
?? frontend/src/utils/comunicazioniAccesso.test.ts  (nuovo)
 M frontend/src/pages/ProjectDetail.tsx             ← la scheda non compare a chi è negata
 M frontend/src/components/PassaggioModal.tsx       ← la linguetta «Messaggi» idem
 M frontend/src/components/settings/OperatorDetailModal.tsx ← «Invio» → «Lettura e invio»
```

Ultimo commit: `87a77482` — *fix(nginx): i file si montano come cartella, o il deploy mente
sulla configurazione* (08/10/2026 19:32).

> Le modifiche **non sono ancora committate** — in attesa dell'ok del titolare. Nove file sono
> **solo documentazione** (registrano la verifica del VPS del 09/10, la decisione su Dropbox e la
> chiusura delle voci 4 e 5); gli altri otto più i due nuovi sono il **codice delle voci 4 e 5**,
> con i test: `npx vitest run` → **1584 passati** (backend) e **139 + 5 nuovi passati** (frontend),
> `tsc --noEmit` pulito su entrambi i lati.

---

## 🎯 Cosa resta da fare

Le voci aperte vivono in **`PIANO_DI_MIGLIORAMENTO.md` §1bis**, che è il posto dove si scrive
cosa **manca**. Qui la sintesi.

### Deciso il 09/10/2026 col titolare

| Voce | Decisione |
|---|---|
| **Backup off-site** (voce 8) | **Dropbox.** Il VPS ha un solo filesystem: un backup in un'altra directory protegge dagli errori applicativi, non dalla morte del disco. rclone + `BLUMAN_BACKUP_RCLONE_REMOTE`. ⚠️ Serve un **controllo di freschezza**: l'auth rclone può scadere in silenzio e la copia smette senza avvisare. |
| **Dove vive la credenziale rclone** (voce 8-bis) | **Nel form del superadmin**, non a mano sul server. Comporta tabella di piattaforma + cifratura a riposo con chiave **fuori** dal `.env` + rotta `/admin/*` + file di stato + **controllo di freschezza** sulla copia remota. **✅ Spike fatto il 09/10/2026: il dominio NON serve.** Il code flow Dropbox funziona **senza `redirect_uri`** (il codice si legge su dropbox.com e si incolla), PKCE è supportato, `token_access_type=offline` dà il **refresh token**, e **rclone non richiede un'app nostra** (`app_key`/`app_secret` si lasciano vuoti: usa la sua). Quindi la forma più semplice è «il superadmin incolla il **token rclone** generato con `rclone authorize dropbox` su una macchina con browser» — niente app Dropbox di BluMan, niente redirect URI, niente dominio |
| **Lettura posta in ingresso** (voce 4) | **Governata come l'invio**: `communications = denied` non legge la posta in arrivo. **✅ fatta il 09/10/2026** — vedi sotto. |
| **Errore di lettura matrice** (voce 5) | **Fail-closed sul default per ruolo**: si accetta che un guasto di lettura possa negare accessi legittimi, in cambio di non allargare mai i permessi per errore. **✅ fatta il 09/10/2026** — vedi sotto. |
| **Messaggio senza pratiche aperte** (voci 6 e 9(c)) | **Campanella cliccabile + filtro «senza fascicolo»**: il link apre l'anagrafica del cliente. **Niente fascicolo generico** — il messaggio resta visibile finché non c'è una pratica, senza archivi finti. |

### ✅ Voci 4 e 5 — fatte il 09/10/2026

| Voce | Cosa è cambiato |
|---|---|
| **4 — la lettura è governata come l'invio** | `ROTTE_MODULO` mappa ora l'intero prefisso `/comunicazioni` (non più le sole quattro rotte `/comunicazioni/invia-*`) più `/progetti/:id/comunicazioni` e `/microvoci/:id/comunicazioni`. **Eccezione**: `PATCH /progetti/:id/comunicazioni/segna-lette` resta su `projects` — con `communications: read` il livello `read` bloccherebbe ogni metodo non-GET e il contatore dei non letti non si spegnerebbe più. Frontend: nuovo `utils/comunicazioniAccesso.ts` (`haAccessoComunicazioni`) usato da `ProjectDetail` (la scheda «Comunicazioni & Ingestion») e `PassaggioModal` (la linguetta «Messaggi»), così chi è negato non vede una porta che risponde 403. |
| **5 — fail-closed sull'errore di lettura** | Il `catch` dell'hook in `server.ts` ricade su `permessoDefaultPerRuolo` e logga che il livello applicato è un **ripiego**. L'argomento del fail-open era vero, ma l'effetto era che **l'error-path risultava più permissivo del percorso normale**: il rilievo chiuso il 27/09 tornava vivo a ogni lettura fallita. Il test che asseriva 200 ora asserisce 403; un secondo test fissa che il ripiego è il default **del ruolo**, non un blocco totale. |
| **Presidi** | `npx vitest run` → **1584 passati** (backend, +3 nuovi: due sul fail-closed e uno sulla voce 4), **144 passati** (frontend, +5 nuovi su `comunicazioniAccesso`), `tsc --noEmit` pulito su entrambi i lati. Documentazione allineata: `docs/manuale/17-rbac.md` e `15-comunicazioni.md`. |

### Da affrontare per prime (scelte il 09/10/2026)

Le voci 4 e 5 sono **chiuse** (tabella sopra). Restano:

1. **Voce 6 + 9(c)** — l'avviso «messaggio non instradabile» ha `link` `null`
   (`src/services/ingressoSenzaFascicolo.ts:57`). **Deciso**: cliccabile + filtro «senza fascicolo».
   **Conseguenza attuale da sanare: `comunicazione_progetto` è vuota — nessun messaggio è mai stato
   archiviato da nessun canale d'ingresso.**
2. **Secondo studio reale** (voce 18) — è la prova end-to-end che manca ed è **sbloccata**: la
   voce 7 (tenant dinamico) è risolta. **Resta la sola domanda aperta: quanti studi e chi li crea.**
   È il presupposto di `PIANO_MULTITENANT.md`, che resta una **decisione** prima di essere codice.
3. ~~**Spike OAuth Dropbox** (voce 8-bis, ~15 minuti)~~ ✅ **Fatto il 09/10/2026: il dominio non
   serve.** Il code flow Dropbox accetta l'assenza di `redirect_uri` (il codice si legge su
   dropbox.com e si incolla nell'app), PKCE è supportato, `token_access_type=offline` restituisce il
   refresh token, e rclone non richiede un'app Dropbox nostra. La voce 8-bis si può fare subito,
   nella forma «il superadmin incolla il token rclone». Vedi la riga 8-bis di
   `PIANO_DI_MIGLIORAMENTO.md` §1bis.

### Configurazione esterna (non è codice, è lavoro sul pannello o sul server)

| Voce | Cosa manca |
|---|---|
| **TLS sul VPS** | Quando il DNS punterà al server (`docs/vps-primo-avvio.md` §6) |
| **Telegram sul VPS** | Secondo bot da BotFather; il bot di produzione si sposta **solo** al cut-over |
| **Custodia di `BACKUP_ENCRYPTION_KEY`** | La chiave sta dentro il `.env` che viene cifrato con sé stessa: se il server muore senza una copia **fuori dal server**, i backup non si aprono più. Va **verificata** riscrivendo la chiave dal foglio e aprendo un backup vero |
| **CI come cancello di deploy** | Meno urgente: `distribuisci.sh` valida (typecheck BE/FE, lint, build, suite intera) **prima** di pushare, ed è bloccante |
| **Il `telefono` dello studio è il Test Number di Meta** | `+1 555-181-9633` non squilla, e ogni documento che stampa il recapito dello studio stampa quel numero. **Da riconfermare** |
| **La ricezione WhatsApp non è mai stata dimostrata con un cliente vero** | La prova in un minuto: scrivere al numero e guardare i log. Non è stata rifatta dal 17/09 |

### Bloccate su una scelta o su un fornitore esterno

| Voce | Cosa manca |
|---|---|
| **D3 — marca temporale qualificata RFC 3161** sulle firme | La scelta di una **TSA**. Rinviata il 03/10 **con motivo**: in produzione c'è solo traffico di prova |
| **KYC K5 — screening** (parte automatica) | Un **provider** |
| **KYC K8b completo (XML goAML)** | L'**XSD della FIAU** |
| **Email maltese della GDPR** | L'unico residuo Gibilterra è `advisor@bluegib.com`; il titolare ha scelto «allinea Malta» → **serve l'indirizzo**, non inventarlo. Poi il consulente AML maltese e i parametri `[da verificare]` |

### Debito tecnico

| Voce | Nota |
|---|---|
| **L2 — bottoni inline → `.btn`** | In pausa dal 25/09. Ripresa: un file per commit + `npm --prefix frontend run typecheck`, e alla fine `distribuisci.sh --solo-push` |
| **Frontend: 17 file di test su 222 sorgenti (~7,7%)** | Era 6 su 176 al 03/10. Resta bassa: **ogni difetto di rendering va scoperto a occhio** |
| **Deriva fra `schema.prisma` e il database** | **Non è da «riconciliare»**: `migrate dev`/`db push` proverebbero a farlo in modo distruttivo (dropperebbe `idx_evento_titolo_trgm`). Regola: **su Supabase solo `migrate deploy`** |
| **Un documento cita un `.docx` che non esiste** (il PDF c'è) | `afffbee4-952e-4139-9c65-64029b0a3a41`. 404 se lo si scarica. Noto e innocuo |
| **Manuale per modulo** | Non è un lavoro con una fine: va aggiornato **quando cambia un modulo** (regola 4). Un documento stale inganna più di un documento assente |

---

## 🚦 Da dove ripartire — in ordine

1. ~~**Verificare il VPS**~~ ✅ **Fatto il 09/10/2026: il deploy di `87a77482` è arrivato** —
   `git rev-parse HEAD` in `/opt/bluman` = `87a77482…` e lo **sha256** di `nginx/bluman_app.inc`
   (repository vs. container, cioè il passo 6-d-ter di `distribuisci.sh`) combacia byte per byte.
   La configurazione **in esecuzione** è quella del repository. Vedi §5.1.
2. ~~**Voce 4**~~ ✅ **Fatta il 09/10/2026** — la matrice governa anche la lettura della casella e dei
   fascicoli; con `denied` risponde 403 e la scheda non compare (§«Voci 4 e 5»).
3. ~~**Voce 5**~~ ✅ **Fatta il 09/10/2026** — l'errore di lettura della matrice ricade sul default
   per ruolo invece di lasciar passare (§«Voci 4 e 5»).
4. **Voce 6 + 9(c)** — l'avviso «non instradabile» cliccabile e il filtro «senza fascicolo».
5. **Voce 18** — il secondo studio reale (resta la domanda: quanti e chi li crea).
6. **Voce 8-bis** — ✅ **sbloccata il 09/10/2026** (il dominio non serve): form del superadmin in cui
   si incolla il token rclone. Resta da implementare: tabella di piattaforma, cifratura a riposo con
   chiave **fuori** dal `.env`, rotta `/admin/*`, file di stato, controllo di freschezza.
7. **Attivare il backup off-site su Dropbox** con il controllo di freschezza.

### Prima di toccare qualsiasi cosa

```bash
npx prisma generate     # PRIMA: il client generato non è versionato e resta indietro
npx vitest run
npx tsc --noEmit                                    # radice
npm run typecheck                                   # in frontend/ (tsc -b --force)
```

`npx prisma generate` viene prima per un motivo concreto: con il client vecchio
`npx tsc --noEmit` fallisce con dieci errori su `src/server.ts` (*"'email' does not exist in
type ClienteWhereInput"*). **Non è codice rotto e non va «corretto» toccando `server.ts`:** è
il codegen da rifare. E se qualcosa è rosso **prima** delle modifiche, va detto, non aggiustato
di nascosto.
