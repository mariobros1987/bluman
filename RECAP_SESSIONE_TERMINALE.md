# 📑 Report & Passaggio Consegne — Sessione Terminale Claude

> **Ultimo aggiornamento: 10/10/2026.** Il documento nasce come consegna della sessione del
> 22-23 settembre 2026 (oltre 26 ore, 79 interazioni, chiusa per saturazione della context
> window: `API Error: 400 Context window is full`). Da allora è tenuto aggiornato come
> **registro di cosa è stato fatto**, ricostruito dai commit e non dalla memoria.
> **Nessun dato o codice è andato perduto:** tutto il lavoro è consolidato nei commit Git.

---

## 🧭 Dove siamo — 10/10/2026

| | |
|---|---|
| Ultimo commit | `755ba47f` — *docs(recap): la distribuzione di `41a9276c` è verificata, e i test frontend non sono nello script*, su `origin/main` |
| Branch | `main`, **allineato a `origin/main`** |
| Working tree | **Sporco, di proposito:** la **voce 8-bis** è implementata e **verificata** (backend 1638 passati / 129 file, frontend 192 / 22, `tsc` e build verdi, grafo aggiornato) ma **non ancora committata** — in attesa dell'ok del titolare |
| VPS | ✅ **Allineato a `41a9276c`** il 09/10/2026 — container ricreati, nginx ricaricato, tutte le sonde verdi (health, frontend 200, radice non cacheabile, SPA in HTML, sonda rotta 401, `checkRls` «RLS attivo su tutte le tabelle») |
| Prossimo passo | **Committare e distribuire la 8-bis**, poi la **18** (secondo studio reale). Prima della distribuzione restano i **prerequisiti che richiedono root sul VPS**: `rclone`, le due cartelle con i loro permessi, la destinazione nel `.env` |
| ℹ️ Non è una voce aperta | I **~2 s per query** nei test (`vitest.config.ts`, dal 19/08/2026) e la suite backend a ~6 minuti sono **una scelta deliberata**, non un difetto e **non** un effetto della voce 5. Vedi §«I 2 secondi per query nei test» |

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

── codice ──
 M docker-compose.prod.yml           ← VOCE 8-bis: i due montaggi (cartelle, non file singoli)
 M scripts/backup-vps.sh             ← VOCE 8-bis: `--config`, il controllo del remote, `backup.json`
 M scripts/monitor-vps.sh            ← VOCE 8-bis: l'ottavo controllo, `copia-remota`
 M src/routes/tenant.ts              ← VOCE 8-bis: `GET/PUT/DELETE /admin/backup` + `GET /tenant/backup`
 M frontend/src/api/client.ts        ← VOCE 8-bis: riesporta `api/backup.ts`
 M frontend/src/pages/SuperAdminPage.tsx        ← VOCE 8-bis: le due schede «Studi» | «Backup off-site»
 M frontend/src/components/settings/TabManutenzione.tsx ← VOCE 8-bis: il riquadro del titolare
?? src/services/backupOffSite.ts                    (nuovo — la logica pura)
?? src/backupOffSite.test.ts                        (nuovo — 29 test, 1 POSIX-only)
?? src/backupRotte.test.ts                          (nuovo — 23 test, 1 POSIX-only)
?? frontend/src/api/backup.ts                       (nuovo)
?? frontend/src/utils/backupStato.ts                (nuovo)
?? frontend/src/utils/backupStato.test.ts           (nuovo — 23 test)
?? frontend/src/components/admin/PannelloBackupOffSite.tsx  (nuovo)
?? frontend/src/components/admin/PannelloBackupOffSite.test.tsx (nuovo — 12 test)
?? frontend/src/components/settings/TabManutenzione.test.tsx    (nuovo — 5 test)

── documenti ──
 M .agents/AGENTS.md                 ← la riga sull'infrastruttura del backup + la sorveglianza
 M .env.prod.example                 ← `BLUMAN_BACKUP_RCLONE_REMOTE` e le due cartelle
 M PIANO_DI_MIGLIORAMENTO.md         ← la voce 8-bis chiusa, con le tre decisioni del 10/10
 M PIANO_MIGRAZIONE_VPS.md           ← la copia off-site: il codice c'è, non è attiva sul server
 M RECAP_SESSIONE_TERMINALE.md       ← questo file
 M docs/manuale/17-rbac.md           ← cosa *non* passa dalla matrice
 M docs/manuale/19-infra-deploy.md   ← backup e sorveglianza: otto controlli
 M docs/vps-primo-avvio.md           ← §7: i passi che richiedono root, e il caso storto
```

Ultimo commit: `755ba47f` — *docs(recap): la distribuzione di `41a9276c` è verificata, e i test
frontend non sono nello script* (09/10/2026).

> Le modifiche **non sono ancora committate** — in attesa dell'ok del titolare. Sono **tutte la
> voce 8-bis**: sette file di codice modificati e nove nuovi (fra sorgenti e test), più otto
> documenti. Le voci **4, 5, 6 e 9(c)** sono invece già in produzione dal 09/10 (`41a9276c`).
> Il piano della voce non entra nel repository: vive fuori, in `~/.claude/plans/`.

---

## 🎯 Cosa resta da fare

Le voci aperte vivono in **`PIANO_DI_MIGLIORAMENTO.md` §1bis**, che è il posto dove si scrive
cosa **manca**. Qui la sintesi.

### Deciso il 09-10/10/2026 col titolare

| Voce | Decisione |
|---|---|
| **Backup off-site** (voce 8) | **Dropbox.** Il VPS ha un solo filesystem: un backup in un'altra directory protegge dagli errori applicativi, non dalla morte del disco. rclone + `BLUMAN_BACKUP_RCLONE_REMOTE`. Il **controllo di freschezza** che serviva ora esiste: è l'**ottavo controllo** del monitor (`copia-remota`), con avviso Telegram e riepilogo alle 08:00 UTC. **✅ fatto il 10/10/2026** — vedi sotto. |
| **Dove vive la credenziale rclone** (voce 8-bis) | **Nel form del superadmin**, non a mano sul server. La previsione iniziale («tabella di piattaforma + cifratura a riposo con chiave fuori dal `.env`») era **sbagliata** e il 10/10/2026 è stata sostituita: la credenziale vive in un **file sul VPS** (`/var/lib/bluman-backup/config/rclone.conf`, `0640 1000:bluman`), scritto dall'API che gira sul VPS. Il motivo è che **il database *è* ciò che viene scaricato e spedito su Dropbox**, e il `.env` **è** una delle tre cose che lo script archivia: metterci dentro la chiave significa spedirla insieme alla cassaforte. Costo accettato e dichiarato: il form funziona **solo** dal backend che vede la cartella (il VPS); su Railway risponde **503**, mai un 200 fantasma. **✅ Spike del 09/10/2026: il dominio NON serve** — il code flow Dropbox funziona **senza `redirect_uri`**, PKCE è supportato, `token_access_type=offline` dà il **refresh token**, e **rclone usa la sua app** (`app_key`/`app_secret` vuoti), quindi niente app Dropbox di BluMan. **✅ Implementata il 10/10/2026** — vedi sotto. |
| **Lettura posta in ingresso** (voce 4) | **Governata come l'invio**: `communications = denied` non legge la posta in arrivo. **✅ fatta il 09/10/2026** — vedi sotto. |
| **Errore di lettura matrice** (voce 5) | **Fail-closed sul default per ruolo**: si accetta che un guasto di lettura possa negare accessi legittimi, in cambio di non allargare mai i permessi per errore. **✅ fatta il 09/10/2026** — vedi sotto. |
| **Messaggio senza pratiche aperte** (voci 6 e 9(c)) | **Campanella cliccabile + filtro «senza fascicolo»**: il link apre l'anagrafica del cliente. **Niente fascicolo generico** — il messaggio resta visibile finché non c'è una pratica, senza archivi finti. **✅ fatta il 09/10/2026** — vedi sotto. |

### ✅ Voci 4 e 5 — fatte il 09/10/2026

| Voce | Cosa è cambiato |
|---|---|
| **4 — la lettura è governata come l'invio** | `ROTTE_MODULO` mappa ora l'intero prefisso `/comunicazioni` (non più le sole quattro rotte `/comunicazioni/invia-*`) più `/progetti/:id/comunicazioni` e `/microvoci/:id/comunicazioni`. **Eccezione**: `PATCH /progetti/:id/comunicazioni/segna-lette` resta su `projects` — con `communications: read` il livello `read` bloccherebbe ogni metodo non-GET e il contatore dei non letti non si spegnerebbe più. Frontend: nuovo `utils/comunicazioniAccesso.ts` (`haAccessoComunicazioni`) usato da `ProjectDetail` (la scheda «Comunicazioni & Ingestion») e `PassaggioModal` (la linguetta «Messaggi»), così chi è negato non vede una porta che risponde 403. |
| **5 — fail-closed sull'errore di lettura** | Il `catch` dell'hook in `server.ts` ricade su `permessoDefaultPerRuolo` e logga che il livello applicato è un **ripiego**. L'argomento del fail-open era vero, ma l'effetto era che **l'error-path risultava più permissivo del percorso normale**: il rilievo chiuso il 27/09 tornava vivo a ogni lettura fallita. Il test che asseriva 200 ora asserisce 403; un secondo test fissa che il ripiego è il default **del ruolo**, non un blocco totale. |
| **Presidi** | `npx vitest run` → **1584 passati** (backend, +3 nuovi: due sul fail-closed e uno sulla voce 4), **144 passati** (frontend, +5 nuovi su `comunicazioniAccesso`), `tsc --noEmit` pulito su entrambi i lati. Documentazione allineata: `docs/manuale/17-rbac.md` e `15-comunicazioni.md`. |

### ✅ Voci 6 e 9(c) — fatte il 09/10/2026

| Voce | Cosa è cambiato |
|---|---|
| **6 — l'avviso porta da qualche parte** | La destinazione la compone `destinazione()` in `src/services/ingressoSenzaFascicolo.ts`, in un posto solo: i sette punti che chiamano il servizio dichiarano **cosa conoscono** — `clienteId`, `progettoId` — non come si scrive un URL. Priorità: la **pratica** quando è nota (`/projects/<id>`; è il caso della chat collegata a una pratica poi chiusa, `webhooks.ts:644`, dove il gesto richiesto è «ripristinala» e l'anagrafica sarebbe un giro a vuoto), altrimenti l'**anagrafica** (`/clients?client=<id>&azione=anagrafica` — i tre rami «cliente noto, fascicolo non scegliibile»: `webhooks.ts:507` WhatsApp, `webhooks.ts:706` Telegram, `signalInbound.ts:179` Signal). Quando il mittente **non è identificato** il link resta `null`: non c'è nessuna scheda da aprire, e il `motivo` già dice cosa cercare. |
| **6 — perché `azione=anagrafica`** | `?client=` da solo apre il modale del **Magic Link**, e ci arrivano `Dashboard.tsx:351` e `ProjectDetail.tsx:869` passando il **nome**. Ripuntarlo all'anagrafica avrebbe rotto quei due; un parametro in più no. |
| **6 — perché `fetchCliente` e non la lista** | La pagina legge **quel** cliente per id (`GET /clienti/:id`, già esistente) invece di cercarlo fra i clienti caricati: il cliente può stare in un'altra pagina o essere escluso dai filtri, e il modale non si aprirebbe — cioè il clic resterebbe un vicolo cieco, lo stesso difetto con un'altra faccia. Un `useRef` impedisce che il modale si riapra dopo che l'operatore l'ha chiuso. Se il cliente non c'è più (cancellato, o di un altro tenant e nascosto da RLS) si dice così, invece di aprire un modale vuoto. |
| **9(c) — il filtro «senza fascicolo»** | Nuovo `frontend/src/utils/notificheFiltro.ts` (helper puri, verificabili senza montare il pannello) + i chip in `NotificationModal`. **Filtra sul tipo d'evento, non sul tipo visivo**: `messaggio_non_instradabile` e l'euristica KYC condividono `type: 'blocked'`, quindi un filtro su `type` mostrerebbe anche i KYC. Per questo `NotificationItem` porta ora anche `tipoEvento`, riempito in `mapNotificaBackend`. Il chip **compare solo se c'è almeno un avviso da isolare** (un filtro che porta al vuoto è peggio di un filtro assente), il badge «N nuove» conta **dentro il filtro** (altrimenti direbbe «3 nuove» mostrandone 1) e il vuoto ha una frase sua. |
| **Presidi** | `npx vitest run` → **1588 passati** (backend, 127 file, +4 sul servizio: le quattro destinazioni), **152 passati** (frontend, 19 file, +8 su `notificheFiltro`), `tsc --noEmit` pulito su entrambi i lati, `npm run build` verde, grafo aggiornato (5143 nodi, 12161 archi). Documentazione allineata: `docs/manuale/15-comunicazioni.md`, `PIANO_DI_MIGLIORAMENTO.md` (voci 6 e 9(c)). |
| **Distribuzione** | ✅ **Commit `41a9276c`, distribuito il 09/10/2026** con `./scripts/distribuisci.sh` — `EXIT=0`: push su GitHub, Vercel `Ready` via CLI, `railway up` con health verde e sonda rotta 401, VPS allineato al commit con container ricreati, `migrate` + `rls` applicati, nginx ricaricato e tutte le sonde verdi. **Nota per la prossima volta:** il passo 1 dello script esegue **solo** la suite backend — i test frontend vanno lanciati a parte, e l'hook di pre-commit gira `oxlint --fix` *dopo* l'ultima esecuzione, quindi conviene rilanciarli sul codice committato. |

### ✅ Voci 8 e 8-bis — la copia off-site, la sua credenziale e chi se ne accorge (10/10/2026)

| Voce | Cosa è cambiato |
|---|---|
| **Dove sta il segreto, e perché non nel database** | `frontend` → il super admin incolla il token; l'API lo valida (`src/services/backupOffSite.ts`) e scrive `/var/lib/bluman-backup/config/rclone.conf` (`0640`, `1000:bluman`) con scrittura **temporaneo + rinomina**, così rclone alle 03:17 non trova mai un file a metà. **Non** in una tabella e **non** nel `.env`: il database *è* ciò che viene scaricato e spedito su Dropbox, e il `.env` *è* una delle tre cose che lo script archivia — metterci la credenziale della copia significa spedire la chiave insieme alla cassaforte. Nessuna migrazione, nessuna eccezione RLS, nessuna seconda chiave di cifratura da custodire. |
| **Il `refresh_token` è obbligatorio, e il rifiuto lo spiega** | `validaTokenRclone` respinge un token senza `refresh_token` **mentre l'operatore è ancora davanti al modulo**. L'access token di Dropbox dura poche ore, e senza refresh la copia funzionerebbe fino a sera e poi smetterebbe **senza avvisare**: è esattamente il guasto silenzioso da cui la voce esiste, quindi meglio un rifiuto ora che un verde falso domani. Rifiuta anche vuoto, JSON non valido, testo troppo lungo e una **config rclone intera incollata** (accettarla scriverebbe un file che rclone legge ma che non contiene nessuna credenziale). |
| **Il pannello dice quale backend sta guardando** | Su Railway la cartella non esiste: `leggiConfigurazione` risponde `cartellaDisponibile: false`, la schermata lo **dichiara** col percorso e **disabilita il salvataggio**, e la rotta `PUT` risponde **503**, non un 200 fantasma. Railway e il VPS hanno **database diversi**: una credenziale salvata dal backend sbagliato non arriverebbe mai al backup notturno, e il modo in cui ci si accorge dello sbaglio è vedere una freschezza vecchia mentre il form dice «configurato». Il campo del token è **write-only**: si incolla, si salva, non si rilegge **mai** — e viene svuotato anche se il salvataggio fallisce, perché un token lasciato a schermo è un token in una schermata condivisa. |
| **Il titolare vede la freschezza** | Un riquadro in sola lettura in cima a **Impostazioni → Manutenzione** (`TabManutenzione.tsx`): «Copia di sicurezza: ultima copia 6 ore fa», oppure in rosso «14 giorni fa ⚠». **Nessuna voce nuova nella matrice permessi**: le rotte `/tenant/*` e `/admin/*` stanno *fuori* da `ROTTE_MODULO` (`src/util/rbacModuli.ts:17-19`) e sono protette da un guard di **ruolo** — la matrice governa le rotte di *dominio*. Il riquadro distingue **403 da guasto**: 403 = questo ruolo non vede la freschezza, e allora non compare niente (nessuna spiegazione da leggere su una schermata che parla dei dati locali del browser); un guasto vero invece si dice. |
| **L'ottavo controllo del monitor** | `scripts/monitor-vps.sh` guadagna `copia-remota` in `CHIAVI`, cadenza **24 h**, soglia `BLUMAN_MONITOR_COPIA_MAX_ORE` (default **30**). Interroga il **remoto** con `rclone lsl` e prende il file più recente: oltre soglia → `fail` con avviso **Telegram** e voce nel riepilogo delle **08:00 UTC**; non configurata → `unknown` (un controllo che accusa l'assenza di una cosa mai chiesta insegna a ignorare il monitor); rclone assente o **autenticazione scaduta** → `unknown`, **mai** `ok`. Scrive il suo verdetto in `stato/verifica.json`. |
| **Due file di stato, non uno** | `backup.json` = cosa il backup **crede** di aver fatto (lo scrive `backup-vps.sh`); `verifica.json` = cosa il monitor ha **constatato** interrogando Dropbox. Sono due fatti distinti, ed è proprio la distinzione che serve quando l'autenticazione scade: il primo resta verde, il secondo no. Separarli evita anche due scrittori sullo stesso file. Il montaggio è di **cartelle, non di file singoli** — la lezione di nginx del 09/10. |
| **Regola del modulo** | Ciò che non si è potuto leggere vale `sconosciuto`, **mai** `ok`: file assente, illeggibile o malformato non è un backup riuscito, è un'informazione che manca. |
| **Presidi** | **Suite intere, rilanciate il 10/10/2026 sul codice finale**: backend `npx vitest run` → **1638 passati, 2 saltati, 129 file**, `EXIT=0` (365 s); frontend `npx vitest run` → **192 passati, 22 file** (37 s); `tsc --noEmit` pulito in radice, `npm run typecheck` (`tsc -b --force`) pulito nel frontend, `npm run build` verde (895 ms), `bash -n` verde su `backup-vps.sh` e `monitor-vps.sh`, grafo aggiornato (**5229 nodi, 12387 archi, 305 comunità**). I **92 test nuovi** sono: `src/backupOffSite.test.ts` (29, di cui 1 sui bit di modo — POSIX-only), `src/backupRotte.test.ts` (23, di cui 1 idem), `frontend/src/utils/backupStato.test.ts` (23), `frontend/src/components/admin/PannelloBackupOffSite.test.tsx` (12), `frontend/src/components/settings/TabManutenzione.test.tsx` (5). Il pannello presidia le tre promesse: il token non si rilegge **nemmeno se il server lo restituisse**, un backend che non vede la cartella lo dice e non fa credere di aver salvato, il campo si svuota anche sul fallimento. L'elenco dei file toccati è nello §«Stato del repository Git». |
| **Restano i passi che richiedono root** | (1) `rclone authorize dropbox` su una macchina **con browser** e incollare il token **nel form, non in chat**; (2) installare `rclone` sul VPS; (3) `BLUMAN_BACKUP_RCLONE_REMOTE=dropbox:bluman-backup` nel `.env` (la *destinazione* non è un segreto) — attenzione al **nome esatto** della variabile; (4) creare `/var/lib/bluman-backup/{config,stato}` con proprietari e permessi documentati **prima** del primo `docker compose up`. Poi la prova a mano: `bash ./scripts/backup-vps.sh`, `rclone lsl` per vedere i tre artefatti sul remoto, `bash ./scripts/monitor-vps.sh` e l'ottavo controllo `ok`. **Provare anche il caso storto**: rinominare `rclone.conf` e verificare che il controllo degradi a `unknown` senza rompere il backup. |

### ℹ️ I 2 secondi per query nei test — una scelta, non un difetto (chiarito il 09/10/2026)

**Questo non è una voce aperta e non c'è niente da correggere.** Va scritto perché il 09/10/2026 è
stato attribuito per errore alla voce 5, e l'errore è istruttivo.

I test **non usano un database, di proposito**: `vitest.setup.ts` neutralizza il `DATABASE_URL` di
`.env` puntandolo a un indirizzo irraggiungibile prima che `new PrismaClient()` lo legga, così
nessuna suite tocca mai dati veri. È la scelta del commit `c40b9a09` (**19/08/2026**, «rimozione
credenziali hardcoded, isolamento test dal DB reale»), ed è una buona scelta. La conseguenza è che
**ogni** query paga il tentativo di connessione prima di cadere sul ripiego in memoria, e
`vitest.config.ts` lo dice dal primo giorno:

```
// Ogni query verso il DATABASE_URL irraggiungibile costa ~2s di tentativo di
// connessione prima di cadere sul fallback in-memory: i 5s di default non bastano
// per i test che percorrono più rotte di fila.
testTimeout: 30_000,
```

**Misurato il 09/10/2026** su un database irraggiungibile: **2060 / 2038 / 2042 ms** su tre giri —
deterministico, non una raffica di tentativi. `src/server.test.ts` dura **327 s** per 91 test
(≈3,6 s l'uno, cioè più di una query per test), la suite backend intera **~6 minuti**.

**Perché la voce 5 non c'entra: la lettura c'era già.** Il blocco RBAC *prima* della voce 5 era
`try { await prisma.permessoModulo.findUnique(…) … } catch { /* fail-open, si lascia passare */ }`:
l'`await` e i suoi 2 secondi erano già sul percorso di **ogni** richiesta autenticata. La voce 5 ha
cambiato **solo il corpo del `catch`** — da «lascia passare» a «ricadi sul default di ruolo» — cioè
quattro righe che non toccano né il numero né la durata delle query. **La voce 5 non ha allungato la
suite.**

**L'errore da non rifare:** il numero grosso (`327 s`) è stato visto *dopo* aver scritto la voce 5 ed
è stato attribuito a essa senza misurare il *prima*. Era una correlazione nel tempo, non una causa.
La proposta che ne è uscita — «mockare `permessoModulo` in 19 suite» — è stata **ritirata**: riparava
un guasto inesistente, e avrebbe aggiunto 19 file di test finti a un impianto che è deliberatamente
senza database.

Se un giorno i ~6 minuti di suite daranno fastidio, la domanda vera è un'altra e va posta da capo
(es. un database usa-e-getta per le suite che oggi non ne hanno uno) — **non** è un seguito della
voce 5.


### Da affrontare per prime (scelte il 09-10/10/2026)

Le voci 4, 5, 6, 8, 8-bis e 9(c) sono **chiuse** (tabelle sopra). Restano:

1. **Secondo studio reale** (voce 18) — è la prova end-to-end che manca ed è **sbloccata**: la
   voce 7 (tenant dinamico) è risolta. **Resta la sola domanda aperta: quanti studi e chi li crea.**
   È il presupposto di `PIANO_MULTITENANT.md`, che resta una **decisione** prima di essere codice.
2. ~~**Spike OAuth Dropbox** (voce 8-bis)~~ ✅ **Fatto il 09/10/2026 e implementato il 10/10/2026:
   il dominio non serve.** Il code flow Dropbox accetta l'assenza di `redirect_uri`, PKCE è
   supportato, `token_access_type=offline` restituisce il refresh token, e rclone usa la sua app.
   La forma realizzata è «il superadmin incolla il token rclone», e il segreto sta in un **file sul
   VPS**. Vedi §«Voci 8 e 8-bis» e la riga 8-bis di `PIANO_DI_MIGLIORAMENTO.md` §1bis.
3. **Attivare davvero la copia off-site su Dropbox** — è **solo lavoro sul server**, non codice:
   i quattro passi che richiedono root sono in fondo a §«Voci 8 e 8-bis». Fino a che non sono
   fatti, il pannello mostra «copia off-site non configurata» e il monitor dice `unknown`: è il
   comportamento giusto, non un difetto.
4. **Nient'altro.** I ~2 s per query nei test **non** sono una voce da fare: sono la scelta
   deliberata del 19/08/2026 (§«I 2 secondi per query nei test»), e la voce 5 non li ha introdotti
   né allungati. Un'eventuale revisione dei tempi della suite è un discorso a sé, da aprire da capo.

### Configurazione esterna (non è codice, è lavoro sul pannello o sul server)

| Voce | Cosa manca |
|---|---|
| **TLS sul VPS** | Quando il DNS punterà al server (`docs/vps-primo-avvio.md` §6) |
| **Copia off-site su Dropbox (voce 8-bis)** | Il codice c'è; manca il **lavoro sul server**, che richiede root: installare `rclone`, creare `/var/lib/bluman-backup/{config,stato}` con i proprietari documentati, `BLUMAN_BACKUP_RCLONE_REMOTE` nel `.env`, e **incollare il token nel form** (non in chat) dopo `rclone authorize dropbox` su una macchina con browser. Vedi §«Voci 8 e 8-bis» |
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
4. ~~**Voce 6 + 9(c)**~~ ✅ **Fatte il 09/10/2026** — l'avviso «non instradabile» porta alla pratica o
   all'anagrafica, e la campanella ha il filtro «senza fascicolo» (§«Voci 6 e 9(c)»).
5. ~~**Voce 8 + 8-bis**~~ ✅ **Fatte il 10/10/2026** — la credenziale rclone si incolla dal pannello
   del super admin e vive in un **file sul VPS** (non nel database: il DB *è* ciò che viene spedito
   su Dropbox); il titolare vede la freschezza in Impostazioni → Manutenzione; il monitor ha
   l'**ottavo controllo** `copia-remota` con avviso Telegram (§«Voci 8 e 8-bis»). **Non ancora
   committata**: manca l'ok del titolare, e prima della distribuzione vanno fatti i quattro passi
   che richiedono root sul VPS.
6. **Voce 18** — il secondo studio reale (resta la domanda: quanti e chi li crea).
7. **Attivare il backup off-site su Dropbox** — ripetuto qui perché è l'unica cosa che resta sulla
   copia off-site: il codice c'è, il server no.

Nient'altro in coda. In particolare i **~2 s per query nei test** e la suite a ~6 minuti **non** sono
una voce aperta: sono la scelta deliberata del 19/08/2026 descritta in §«I 2 secondi per query nei
test», e la voce 5 non li ha né introdotti né allungati.

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
