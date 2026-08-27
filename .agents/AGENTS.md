# BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo

Questo file serve come indice rapido per l'IA ed i collaboratori per identificare i file responsabili ed evitare scansioni complete dell'intera codebase.

---

## 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`)

### 📄 Pagine (`pages/`)

- **`pages/Dashboard.tsx`**: Dashboard principale con KPI portafoglio, avvisi ritardo e progetti in corso.
- **`pages/Projects.tsx`**: Gestione Avanzata Progetti & Fascicoli Operativi con 3 viste switchabili (Schede Operatore con consuntivazione ore & checklist microvoci, Tabella ERP Matrice ad alta densità, Kanban Pipeline a 4 fasi di workflow) e Executive KPI Strip.
- **`pages/ClientsPage.tsx`**: Anagrafica Clienti ERP con salvataggio bidirezionale completo, disimballo campi `referentiJson`, Magic Link passwordless e modal `AnagraficaErpModal` a 4 schede.
- **`pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Attività Studio (Vista Mese, Lista Scadenzario, Filtro Categorie e Modal Nuovo Evento).
- **`pages/ProjectDetail.tsx`**: Vista dettagliata del progetto con tab. Nell'intestazione, accanto a "👥 Accessi Progetto", il pulsante **"🔄 Ricalcola avanzamento"** (`ricalcolaProgettoApi`, visibile solo ad advisor e super_admin, con conferma: è una scrittura). La pagina **non fabbrica** moduli né micro-voci — vedi regola 7: se il progetto non ne ha a database, ogni tab lo dichiara. Tab:
  - `🗂 Moduli & Microvoci` (Checklist passaggi, note operative, consuntivazione ore e notifiche milestone automatiche via WhatsApp/Email)
  - `🕸 Grafo & Dipendenze Moduli` (`GrafoModuliProgettoView`)
  - `💬 Comunicazioni & Ingestion Hub` (`ComunicazioniTab` con sincronizzazione live, chat interattiva e binding recapiti WhatsApp, Email, Telegram, Signal dall'Anagrafica Cliente ERP)
  - `💶 Fatturazione & SDI` (Emissione FT/NC e tracciato XML)
  - `📊 Redditività & Margini` (Analisi Margine Lordo Commessa, Semaforo Budget Live, Resa Oraria Reale ed Export Rendiconto Economico CSV). Le ore reali sono quelle **consuntivate** (`m.a`), non interpolate dalla percentuale: senza consuntivazione la riga scrive `—` e "⚪ Nessuna ora consuntivata", non "🟡 In Target".
  - `📄 Documenti & Vault Legale` (Cloud Vault Google Drive Style ed Export Fascicolo Completo ZIP 1-Click)
- **`pages/InvoicesPage.tsx`**: Registro Fiscale Fatture, Note di Credito, Aliquote, Export XML SDI ed **Export Registro Fiscale per Commercialista (CSV / Excel)**.
- **`pages/PrimaNotaPage.tsx`**: Registro Prima Nota, Transazioni Cassa/Banca, CRO/TRN, Import & Riconciliazione Estratto Conto Bancario ed **Export Contabile Commercialista (CSV / Excel)** compatibile con Zucchetti, TeamSystem, Datev e Profis.
- **`pages/PaymentsPage.tsx`**: Registrazione Incassi & Scadenzario Pagamenti con filtri stato/cliente/ricerca, modal registrazione incasso in Prima Nota con collegamento a banca e fattura, e aggiornamento stato scadenza (pagata/parziale/insoluta).
- **`pages/ScadenzarioPage.tsx`**: Scadenzario Incassi, Partite Aperte & Solleciti Clienti con Link al Progetto.
- **`pages/BanksPage.tsx`**: Gestione Banche, Conti Correnti Studio, IBAN & Riconciliazione Liquidità.
- **`pages/RetainersPage.tsx`**: Contratti Ricorrenti & Retainer Studio per la fatturazione periodica pianificata, collegato ai Progetti specifici con filtraggio clienti a cascata e link 1-Click `📁 Nome Progetto ↗`.
- **`pages/DocumentEditorPage.tsx`**: Studio Document Studio & Contract Builder (Editor Word WYSIWYG, Smart Tags ERP, Intestazione/Piè di Pagina A4 ed Export PDF). Il selettore **micro-voce di destinazione** carica solo le micro-voci reali del progetto scelto (`fetchProgettoDettaglio`) e passa `microvoceProgettoId` a `salvaDocumentoApi`, con fascia informativa «Percorso del documento» che spiega dove finirà il documento; nessun id inventato lato client.
- **`pages/Library.tsx`**: Gestione Distinta Base, Costruttore Moduli Template, Catalogo Articoli e Modelli Documenti in Bianco.
- **`pages/ClientPortal.tsx`**: Portale Cliente a 6 schede (Proposta & Firma con OTP, Live Progress, Form Societari, Documenti, Live Chat & Comunicazioni con Advisor, **Profilo & Password**). `mapProjectToPortalModules()` mappa **solo** i moduli del progetto scelto e restituisce `[]` quando non ce ne sono: i moduli e le micro-voci cambiano dinamicamente in base al progetto selezionato dal menu a tendina. Stato di firma e dati del sigillo server-side si risolvono sul cliente **autenticato**, e il form societario si riempie dalla riga del cliente. La conferma di conclusione operazione è una **firma OTP vera** (flusso OTP con ambito `modulo_completato`, impronta server-side): le conclusioni si rileggono da `GET /firme`, niente `localStorage`. La Tab 6 permette al cliente di aggiornare anagrafica, telefono e password personale. §WF-DOC: i documenti con `versione > 1` espongono la **cronologia versioni a ritroso** (`versioniPrecedenti[]` ricostruita dal server via `documentoPadreId`) — pulsante 🕘 nella scheda documento con pannello espandibile che mostra caricamento e firma di ogni versione precedente fino a quella eventualmente firmata; richiami compatti nelle schede moduli e deliverable. A documento firmato i pulsanti di firma spariscono e restano visibili data/riferimento firma e ricevuta di firma semplice (OTP verificata · art. 20 CAD).
- **`pages/SettingsPage.tsx`**: Anagrafica Studio, Sede Legale/Operativa, Configuratore PDF Fatture con Logo, Gestione Team con 4 Professionisti Ufficiali, Matrice Permessi Granulari RBAC con pulsante **`🔄 Reset Pass`** per rigenerare password temporanee monouso per qualsiasi membro del team, ed **Email Suite Completa** (SMTP Outbound + Reply-To + BCC, IMAP/POP3 Inbound + Cartelle + Polling Live, Firma Automatica HTML con Smart Tags e Diagnostica DNS Register.it SPF/DMARC/MX con Test Socket TLS Reali).
- **`pages/SuperAdminPage.tsx`**: Dashboard Super Admin & Gestione Multi-Tenant Studi (`/admin/tenants`). La password del responsabile non è più un campo del form: la emette il server alla creazione dello studio e il modale la mostra **una volta sola**, tenendola in un `useState` che muore alla chiusura. Se va perduta, il pulsante `🔄 Rigenera Password di Accesso` chiama `POST /admin/tenants/:id/reset-password` e imposta `stato: 'invitato'`. L'invio delle credenziali per email si rifiuta di partire senza una password appena emessa, e riporta gli errori invece di dichiarare comunque il successo.
- **`pages/LoginPage.tsx`**: Pagina di accesso staff. Campi vuoti e nessuna scorciatoia. Il ruolo lo determina il backend leggendo la riga `user`. All'autenticazione, se `mustChangePassword === true` o `stato === 'invitato'`, l'applicazione blocca l'accesso e richiede obbligatoriamente l'impostazione di una nuova password permanente.
- **`pages/AuditLogPage.tsx`**: Registro Audit Super Dettagliato & Tracciamento Attività Operatori per Tenant (`/audit`).
- **`pages/Placeholders.tsx`**: Pagine placeholder (Clienti, Calendario, Impostazioni) per sezioni in corso di sviluppo — export nominati `Clients`, `Calendar`, `Settings`.

### 🧩 Componenti (`components/`)

- **`components/MustChangePasswordModal.tsx`**: Modale di blocco schermo per il primo accesso / password reset. Non chiudibile: obbliga l'utente a digitare la password provvisoria ricevuta e a impostare una nuova password personale sicura (con misuratore di robustezza live conforme ISO/IEC 27001). Al salvataggio aggiorna `stato: 'attivo'` e sblocca l'app.
- **`components/UserProfileModal.tsx`**: Modale profilo utente per collaboratori e advisor: modifica rapida di nome, titolo/specializzazione professionale e cambio password permanente cifrata con scrypt.
- **`components/QuickTimeTracker.tsx`**: Timer orario fluttuante (Stopwatch 1-Click) integrato nella topbar con selezione rapida commessa/microvoce, calcolo automatico tariffa oraria e consuntivazione immediata a database.
- **`components/NewProjectWizard.tsx`**: Wizard multi-step per la creazione di un nuovo progetto: selezione/creazione cliente, scelta giurisdizione, composizione preventivo da catalogo moduli template, accettazione e istanziazione progetto con API backend.
- **`components/PassaggioModal.tsx`**: Modal dettagliato per singolo passaggio/microvoce del progetto: checklist operativa, note operatore, consuntivazione ore, upload documenti, generazione PDF da template (precostruiti e riorganizzazione societaria), integrazione firma elettronica del cliente con scelta del tipo (`fea_otp` firma semplice con OTP, `manuale_scansionata`, `qualificata_esterna`). §WF-DOC: a documento **firmato** il pannello mostra data/riferimento della firma e nasconde i pulsanti Elimina e Nuova Versione; lo **sblocco** per ulteriori modifiche è riservato all'admin del tenant (pulsante visibile solo con `isAdminStudio()`), richiede una motivazione di almeno 10 caratteri e chiama `PATCH /documenti/:id/sblocca`.
- **`components/ComunicazioniTab.tsx`**: Tab comunicazioni omnichannel standalone: chat interattiva bidirezionale Advisor ⇄ Cliente, binding recapiti WhatsApp/Email/Telegram/Signal, invio messaggi via canali multipli con sincronizzazione live.
- **`components/AssignOperatorModal.tsx`**: Modal per assegnazione rapida di un operatore del team a un modulo/microvoce del progetto.
- **`components/CalendarPreviewModal.tsx`**: Modal anteprima calendario con dettaglio eventi e scadenze del progetto.
- **`components/ConfirmDeleteModal.tsx`**: Modal generico di conferma eliminazione con protezione da cancellazioni accidentali.
- **`components/DigitalSignatureModal.tsx`**: Modal Firma Elettronica Semplice (OTP verificata · art. 20 CAD) con pad firma; IP e timestamp ISO li registra il server nel sigillo, mai il browser.
- **`components/DocumentEditorModal.tsx`**: Modal wrapper per apertura rapida dell'editor documenti da contesti esterni.
- **`components/NotificationModal.tsx`**: Modal sistema notifiche e avvisi operatore.

### 🏗 Layout (`components/layout/`)

- **`components/layout/AppLayout.tsx`**: Layout principale dell'applicazione con topbar (logo, tenant switcher per super_admin, QuickTimeTracker, avatar utente), area contenuto e integrazione Sidebar.
- **`components/layout/Sidebar.tsx`**: Sidebar navigazione principale con voci dinamiche filtrate da RBAC (permessi modulo `denied` / `read` / `write`), badge contatori e indicatore sezione attiva.

### 🎨 Componenti UI (`components/ui/`)

- **`components/ui/Avatar.tsx`**: Componente avatar fluttuante con iniziali operatore e card di anteprima (nome completo, ruolo, punto di stato) al passaggio del mouse (hover).
- **`components/ui/Badge.tsx`**: Badge generico con stile e colore configurabili.
- **`components/ui/CatBadge.tsx`**: Badge colorato per categoria modulo (Analisi, Societario, Trust, Banking, Fiscale, Legale, IP, Compliance).
- **`components/ui/ProgressBar.tsx`**: Barra di progresso animata con percentuale.

### 🔧 Utilities Frontend (`utils/`)

- **`utils/index.ts`**: Utility helpers condivisi: formatter valuta (`fmt`), URL logo (`getFormattedLogoUrl`), colori categoria modulo (`catCls`), helpers modulo (`moduloH`, `moduloP`).
- **`utils/tenant.ts`**: Modulo di gestione e isolamento dati multi-tenant lato client. `StudioInfo`, `getCurrentTenantId()`, `getTenantStorageKey()`, `getStudioInfoForTenant()`, gestione localStorage isolata per tenant e costante `BLUECODE_TENANT_ID`.
- **`utils/rbac.ts`**: Motore di sicurezza e controllo accessi RBAC granulare a 12 moduli (filtra Sidebar e Route Guards per moduli `denied` / `read` / `write`).
- **`utils/pdfGenerator.ts`**: Generatore PDF client-side con jsPDF + html2canvas per documenti A4 conformi ISO 216 / DIN 5008, supporto firma elettronica, intestazione/piè di pagina e export da HTML.
- **`utils/documentTemplates.ts`**: Catalogo template documenti precostruiti (contratti, NDA, engagement letter, societario, deleghe, fiscale, trust, compliance) con risoluzione Smart Tags ERP e supporto template custom da database.
- **`utils/reorganizationTemplates.ts`**: Collezione di 22 modelli contrattuali e verbali Word per operazioni di riorganizzazione societaria (Cessioni quote, trasformazioni, holding, trust, conferimenti) integrati nativamente in Document Studio con Smart Tags ERP.
- **`utils/zipBuilder.ts`**: Modulo ZIP client-side autonomo a zero dipendenze per l'esportazione in 1-Click del fascicolo digitale completo in cartelle ordinate (`/01_Contratti`, `/02_Societario`, `/03_KYC`, `/04_Fatture`, `INDICE_FASCICOLO.txt`).

### 🪝 Hooks (`hooks/`)

- **`hooks/useTeamMembers.ts`**: Hook React centralizzato e performante per interrogare gli operatori live dal database via API `GET /tenant/utenti` con calcolo dinamico delle iniziali reali (`MD`, `JD`, `LM`, `ER`, `FD`) e supporto personalizzazione colori.

### 📦 Store (`store/`)

- **`store/mockData.ts`**: ✅ **RIMOSSO.** Il file di dati mock statici (giurisdizioni, team, articoli, moduli template, progetti) e l'intera cartella `store/` non esistono più: `NewProjectWizard` e `utils/index.ts` leggono dalle API live. I dati demo legittimi per il tenant demo Bluecode restano solo in `utils/tenant.ts`. Residuo storico del leak cross-tenant descritto in `PIANO_DI_MIGLIORAMENTO.md`.

### 🎨 Stili CSS Modulari

- `pages/Dashboard.module.css`, `pages/ClientsPage.module.css`, `pages/Library.module.css`, `pages/ProjectDetail.module.css`, `pages/Settings.module.css`: CSS Modules per le pagine principali.
- `components/layout/AppLayout.module.css`, `components/layout/Sidebar.module.css`: CSS Modules per layout e sidebar.

---

## 🔌 2. API Backend Fastify (`src/server.ts` + `src/routes/`) & API Client (`frontend/src/api/client.ts`)

- **Autenticazione & Permessi RBAC**: `POST /auth/login`, `POST /auth/magic-login`, `GET /auth/me`, `GET /tenant/utenti/:userId/permessi`, `PUT /tenant/utenti/:userId/permessi` (Token JWT 15 min + Magic Link + Matrice Permessi Sezioni).

### 🗂 Struttura del backend dopo lo split dei monoliti (27/08/2026)

`src/server.ts` (prima ~4.570 righe, ora ~510) tiene solo ciò che deve avvolgere TUTTE le rotte: i middleware Fastify, l'hook `onRequest` di autenticazione (§23), lo stream SSE `/stream`, health/refresh del token, l'error handler centrale che mappa le sei classi errore applicative agli status HTTP, e la chiusura del wrapper `server.register(...)` con rate-limit. Le rotte vivono in `src/routes/`, un modulo per dominio, ciascuna esportata come `registraRotte*(server)` (o `registraRotte*(server, app)` quando usa la porta `AppPort`):

- **`auth.ts`**: login, magic login, `GET /auth/me`, refresh.
- **`tenant.ts`**: team/utenti, ruoli, matrice permessi, audit, dati tenant.
- **`catalogo.ts`**: giurisdizioni, `/moduli`, articoli catalogo, listini.
- **`clienti.ts`**: anagrafica clienti, lead, accesso cliente.
- **`progetti.ts`**: progetti, preventivi, esecuzione (§17), timesheet, ricalcoli.
- **`contabilita.ts`**: fatture, incassi/scadenzario/prima nota, registro fatture, banche, reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti, cron scadenze, SDI manuale.
- **`documenti.ts`**: modelli studio (Document Studio) e fascicolo documentale del progetto (§2.9).
- **`portale.ts`**: portale cliente — contatti (§2.6), fatture (§2.11), dati fiscali (§2.3), addendum (§2.5).
- **`firma.ts`**: FEA (OTP, canali verificati, sigillo) e firma elettronica avanzata (sessione, grafometrica, verbale, esito).
- **`notifiche.ts`**: `/stream-notifications`, segna-letto, impostazioni.
- **`webhooks.ts`**: webhook di canale WhatsApp e Telegram.

Le `registraRotte*` sono chiamate SEMPRE dentro il wrapper `register` di `buildServer`, quindi hook auth e rate-limit si applicano esattamente come prima dello split (stesso contesto di incapsulamento, nessuna nuova barriera). Lo split è stato meccanico: stesse identiche implementazioni, zero cambi di comportamento; ogni modulo è un commit separato e revertibile (serie "Split monoliti 1/9…9/9").

### 🚧 Il guard di autenticazione: elenco di rotte pubbliche, non di rotte protette (§23)

L'hook `onRequest` di `src/server.ts` respinge con `401 { errore: 'Non autenticato' }`
qualunque richiesta senza un JWT verificabile. L'elenco codificato è quello delle rotte
**pubbliche** (`/health`, `/auth/login`, `/auth/magic-login`, i webhook di canale, il
portale cliente passwordless): tutto il resto è protetto per difetto. È deliberato ed è il
punto centrale della correzione — con l'elenco opposto, una rotta nuova sarebbe nata
aperta e nessuno se ne sarebbe accorto.

Il confronto avviene sul *pattern* di rotta (`req.routeOptions.url`), non sull'URL grezzo,
perché `onRequest` gira dopo il routing: `/progetti/abc-123` risulta `/progetti/:id`.

Attenzione a non confondere due controlli distinti:

- **RLS** protegge uno studio dall'altro. Non protegge da "non serve autenticarsi": una
  richiesta anonima che porta il tenant di default corrisponde legittimamente alle policy.
- **Il guard** decide *se* la richiesta esiste. Senza di lui RLS lavorava correttamente
  sul tenant sbagliato.

Un secondo controllo copre `/admin/tenants`: la funzione `soloSuperAdmin` risponde 403 a
chiunque non sia `super_admin` su tutti e quattro i verbi. Anche questo non è un compito
che RLS possa svolgere — `tenant` è la tabella che *contiene* gli studi, non una tabella
figlia filtrata per `tenant_id`, quindi le policy non le danno alcuna protezione. Prima del
guard un collaboratore interno poteva elencare ogni studio della piattaforma con ragione
sociale, P.IVA ed email del responsabile, registrarne di nuovi, sospenderli e cancellarli.

`src/server.test.ts` presidia entrambi: per ognuna delle dieci rotte di `ROTTE_PROTETTE`
verifica 401 senza token e **non** 401 con un token valido, controlla che le rotte
pubbliche restino raggiungibili e che il preflight CORS non venga respinto.

### 🔑 Accesso & Gerarchia dei Ruoli (§2bis, §23)

**Non esistono credenziali precaricate e non vanno reintrodotte.** Fino alla Fase 0
`src/server.ts` conteneva una tabella di sette utenti con password nel sorgente e accettava
qualunque password come jolly: chiunque leggesse il repository pubblico poteva autenticarsi
in produzione. La tabella che stava qui elencava proprio quelle coppie, in violazione della
regola 6 più in basso — motivo per cui non le si trascrive nemmeno per raccontare che sono
state rimosse: l'elenco esatto vive solo in `src/credenziali.test.ts`, che le cerca.
L'unica fonte di verità è ora la tabella `user` del database.

| Ruolo | Ambito | Accesso |
| :--- | :--- | :--- |
| 👑 `super_admin` | Gestisce tutto e vede tutti i tenant (`tenant_id` NULL); può cambiare studio corrente via header `x-tenant-id` | JWT |
| 👨‍💼 `advisor` | Responsabile del **solo proprio** tenant; crea e gestisce i collaboratori del proprio studio | JWT |
| 👷 `collaboratore_interno` / `collaboratore_esterno` | Appartengono al tenant da cui vengono creati e non ne escono | JWT |
| 🔑 `cliente` | Passwordless: solo Magic Link su `/portal`, mai `/auth/login` | Magic Link |

- Primo `super_admin` su database vuoto: `npm run bootstrap` (§27), stampa la password
  temporanea **una sola volta**.
- Utenti già in database senza `password_hash`: `npm run passwords:assign`.
- Nuovi collaboratori: `POST /tenant/utenti`, riservato a `super_admin` e `advisor`. Un
  `advisor` non può creare un `super_admin`; un'email registrata presso un altro studio
  viene rifiutata con 409 invece di cambiare tenant; la risposta non contiene mai
  `passwordHash`.

#### ⚠️ `super_admin` ha `tenant_id` NULL, e non è una finezza di modellazione

È l'invariante su cui si appoggia la policy RLS di `public."user"`:

```sql
USING (tenant_id = app_tenant_corrente()
       OR (tenant_id IS NULL AND app_ruolo_corrente() = 'super_admin'))
```

cioè la policy dà per assodato che i super_admin *siano* le righe senza tenant. Il database
non lo rispettava: `seedFull.ts` creava i due super_admin con `tenantId = TENANT_ID`, e
`prismaApp.listaUtenti()` li riassegnava al tenant che stava leggendo. Risultavano quindi
membri ordinari dello studio di default.

La conseguenza era concreta. Il controllo che impedisce di rubare un utente a un altro
studio confronta `esistente.tenant_id` col tenant corrente; per un super_admin finito nel
tenant dell'advisor quel confronto era vero, il 409 non scattava, e l'`update` successivo
riscriveva `ruolo` a `collaboratore_interno`. **Un advisor poteva declassare il super admin
della piattaforma** — e con due sole righe di quel tipo, lasciarla senza.

Le tre correzioni, in ordine di robustezza:

1. `prisma/migrations/20260819190000_super_admin_senza_tenant` rimette a NULL i `tenant_id`
   dei super_admin esistenti. Con NULL è **RLS** a nascondere la riga all'advisor: la
   difesa torna al motore, non a un confronto applicativo (regola 1).
2. `prismaApp.listaUtenti()` è ora di sola lettura. Prima riscriveva cinque utenti cablati
   a ogni chiamata: spostava righe altrui nel tenant che leggeva, riportava il super_admin
   dentro un tenant e creava utenti senza `password_hash` con email divergenti da quelle
   vere. Una GET che scrive è un effetto collaterale che nessun chiamante si aspetta.
3. `POST /tenant/utenti` respinge con 403 la modifica di una riga il cui ruolo *esistente*
   è `super_admin`, se chi chiede non è super_admin. Serve come difesa in profondità: regge
   anche se un domani una riga tornasse fuori invariante.

Presidio: `src/gerarchiaRuoli.test.ts` (8 test). Verifica il 403 **e** che l'`update` non
venga nemmeno tentato, che un super_admin creato nasca con `tenantId: null`, che un
collaboratore nasca nel tenant di chi lo crea, e che un errore di lettura su
`GET /tenant/utenti` produca 503 invece di un elenco vuoto.

- **La password la emette sempre il server, mai il client.** `POST /tenant/utenti`,
  `POST /admin/tenants` e `POST /admin/tenants/:id/reset-password` la generano con
  `generaPasswordTemporanea()`, ne salvano l'hash scrypt e la restituiscono in chiaro
  **una sola volta** nella risposta. Non è rileggibile dopo: se va perduta si rigenera.
  Il frontend non ne propone nessuna e non ne conserva nessuna; `api/send-email.ts` si
  rifiuta di spedire un invito privo di `collaboratorPassword` invece di annunciarne una
  di ripiego. Una password di default comunicata dall'API è comunque una password valida.
- `src/server.test.ts` ha un test di regressione che rifiuta ognuna delle otto vecchie
  coppie email/password: se torna verde per una di esse, la falla è stata reintrodotta.
- `src/credenziali.test.ts` è il presidio più ampio: scandisce `src/`, `frontend/src/` e
  `api/` e fallisce se una delle vecchie password, dei token finti o del ripiego
  `!password ||` ricompare su una riga non commentata. Copre anche i file `.tsx` del
  frontend e le funzioni serverless, che una ricerca sul solo backend non tocca.

- **Profilo & Gestione Password**:
  - `POST /auth/change-password`: Cambio password per utenti staff autenticati (imposta `stato: 'attivo'`).
  - `GET /auth/profilo`: Recupero nome, specializzazione e ruolo dell'utente connesso.
  - `PUT /auth/profilo`: Aggiornamento dati profilo operatore.
  - `POST /portal/change-password`: Cambio password per il cliente autenticato nel portale.
  - `POST /tenant/utenti/:id/reset-password`: Reset password collaboratore da parte di Super Admin / Advisor (imposta `stato: 'invitato'`, genera password temporanea e la restituisce una volta sola).
- **Progetti**: `GET /progetti`, `GET /progetti/:id`, `DELETE /progetti/:id`, `DELETE /progetti/:id/moduli/:moduloId` (Eliminazione sicura modulo persistita a DB con controllo ruoli; **409** se il modulo ha ore consuntivate o righe fattura collegate; transazione ordinata accessi → passaggi → microvoci → dipendenze → modulo; audit log), `PUT /progetti/:id/stato-completo` (Persistenza totale moduli, microvoci, checklist passaggi e note operative con audit log)
- **Clienti**: `GET /clienti`, `POST /clienti`, `PUT /clienti/:id` (Salvataggio e recupero completo di tutti i campi ERP, legali, SDI, IBAN, KYC e referentiJson con audit log)
- **Comunicazioni Omnichannel**: `GET /progetti/:id/comunicazioni`, `POST /progetti/:id/comunicazioni` (Messaggistica bidirezionale live Portale Cliente ⇄ Advisor Hub su tabella PostgreSQL `comunicazione_progetto`, con invio email reale Nodemailer SMTP Register.it e WhatsApp Cloud API)
- **Fatturazione & Incassi**: `POST /progetti/:id/fatture` (gestisce sia Fatture `FT` che Note di Credito `NC` con numerazione distinta), `GET /invoices/scadenzario`, `POST /invoices/scadenze/:id/incassi` (Prima Nota) e `GET /invoices/:id/sdi-xml` (Tracciato XML FatturaPA).
- **Contratti Retainer**: `GET /contratti-ricorrenti`, `POST /contratti-ricorrenti` (collegati sia al Cliente che al Progetto specifico).
- **Multi-Tenant Piattaforma (solo `super_admin`)**: `GET /admin/tenants`, `POST /admin/tenants` (registra lo studio **e** la riga `user` del responsabile con ruolo `advisor`, restituendo la password temporanea una volta sola), `PATCH /admin/tenants/:id`, `DELETE /admin/tenants/:id`, `POST /admin/tenants/:id/reset-password` (rigenera la password del responsabile: nuovo hash su `user.passwordHash`, chiaro nella sola risposta, imposta `stato: 'invitato'`). Tutti passano da `soloSuperAdmin` → 403 per gli altri ruoli.
- **Documenti & Workflow Bidirezionale Operatore ⇄ Cliente (§WF-DOC)**:
  - `GET /documenti`: Lettura fascicolo con stato workflow (`bozza` | `pubblicato` | `in_revisione` | `firmato`), versione, richieste di modifica associate e firma.
  - `POST /documenti`: Caricamento documento da computer/template nel fascicolo/microvoce (stato iniziale `bozza` con notifica condizionale).
  - `PATCH /documenti/:id/stato`: Transizione di stato (`bozza` ⇄ `pubblicato`) con notifica automatica al cliente. **Rifiutata con 409 su documento `firmato`**: la firma è uno stato terminale.
  - `POST /documenti/:id/nuova-versione`: Caricamento v2, v3... mantenendo il link `documentoPadreId` al documento padre e risolvendo le note aperte. **Rifiutata con 409 su documento `firmato`**.
  - `PATCH /documenti/:id/sblocca`: Riapertura in `bozza` di un documento firmato, **riservata all'admin del tenant** (`advisor` / `super_admin`) e solo con motivazione di almeno 10 caratteri che resta a audit log (`DOCUMENTO_SBLOCCATO`) + notifica `documento_sbloccato` al cliente. La riga `firmaElettronica` non viene cancellata: lo storico della sottoscrizione resta ripercorribile.
  - `GET /portal/documenti`: Documenti visibili al cliente (solo `pubblicato`, `in_revisione`, `firmato`; le bozze restano protette). Restituisce anche `documentoPadreId` e `versioniPrecedenti[]` (id, versione, caricatoIl, statoDoc, firmatoAt per ogni antenato, fino a 12 salti) perché il cliente possa sempre ripercorrere il documento all'indietro fino alla versione firmata.
  - `POST /portal/documenti/:id/richiesta-modifica`: Richiesta di rettifica inviata dal cliente con note e commenti prima della firma OTP.
  - `GET /documenti/:id/richieste-modifica` & `PATCH /documenti/richieste-modifica/:rid`: Gestione note di revisione e riscontri advisor.
  - `DELETE /documenti/:id`: Eliminazione documento con audit log. **Rifiutata con 409 su documento `firmato` per tutti, admin inclusi** (decisione del titolare 27/08/2026): un atto sottoscritto non si elimina mai, al più lo si archivia o — per correggerlo — lo si sblocca (admin) e lo si sostituisce con una nuova versione.
  - `PATCH /documenti/:id/archivia`: Archiviazione soft (`isArchiviato`, `archiviatoAt`, `archiviatoDaId`) con audit `DOCUMENTO_ARCHIVIATO` — il modo per togliere un documento firmato dalle liste operative, che lo escludono di default (`?includiArchiviati=true` per lo storico). Il file e la firma restano intatti e consultabili.
- **Upload Documenti**: `POST /upload` (riceve base64 e salva in `./uploads/`), `GET /uploads/:filename` — confinata sotto `uploads/` e non anonima: nome rifiutato con 400 se non è `[a-zA-Z0-9_.-]` senza `..`, poi verifica sul percorso *risolto*; serve il file solo con Bearer **oppure** firma HMAC `?firma=&scad=`, perché quegli URL finiscono in `<img src>` che non può inviare header.
### 🧠 Domain Layer (`src/domain/`)

Moduli di dominio **puri**: nessuna chiamata a DB/HTTP. Ricevono entità, restituiscono valori nuovi. Il service layer chiama queste funzioni e persiste il risultato.

- **`src/domain/types.ts`**: Tipi di dominio fondamentali: `StatoMicrovoce` (`pending` | `in_corso` | `completata` | `bloccata` | `attesa_dipendenza`), `StatoModulo`, `StatoProgetto`, `MicrovoceInput`.
- **`src/domain/stateEngine.ts`**: Motore di calcolo stati (§16). Funzioni pure per: segnale rischio ore (`valutaSegnaleRischio`), cascata stato micro-voce → modulo → progetto (`calcolaStatoModulo`, `calcolaStatoProgetto`), ritardo manuale (`marcaRitardoManuale`, `risolviRitardoManuale`), risoluzione dipendenze modulo (`risolviDipendenze`). Le funzioni ricalcolano **solo verso l'alto** — §16.6.

### 🔌 Porte & Interfacce (`src/services/`)

Separano l'orchestrazione dal driver DB — la logica si tipizza e si testa senza `PrismaClient`.

- **`src/services/appPort.ts`**: Interfaccia comune che `src/server.ts` usa per tutte le operazioni CRUD su clienti, progetti, preventivi, fatture e articoli. Non sa se sotto c'è `InMemoryApp` o `PrismaApp`. Definisce `Cliente`, `ProgettoBase`, `Preventivo`, `AppPort`.
- **`src/services/istanziazionePort.ts`**: Interfacce (porte) per la transazione di istanziazione (§15.3) e per le operazioni di esecuzione del progetto (§17): `IstanziazionePort`, `IstanziazioneTransazione`, `EsecuzionePort`, `NotificationPort`. Definisce anche i tipi di input per passaggi template, righe distinta e moduli template con distinta.
- **`src/services/fakeIstanziazionePort.ts`**: Implementazione in-memory delle porte di istanziazione, esecuzione e notifica — usata dall'adapter `InMemoryApp` e dai test.

### ⚙️ Servizi di Orchestrazione (`src/services/`)

- **`src/services/istanziaProgetto.ts`**: Orchestrazione §15.3 — cosa succede alla firma dell'engagement letter. Scrive il grafo di entità in una transazione atomica: crea moduli istanziati, micro-voci, passaggi template, calcola prezzo da distinta base.
- **`src/services/esecuzione.ts`**: Orchestrazione §17 — consuntivazione ore, ritardo/blocco, procedura guidata, completamento micro-voce e passaggio, sblocco dipendenze. Chiama le funzioni pure di `stateEngine.ts` e persiste via `EsecuzionePort`.
- **`src/services/calcoloService.ts`**: Orchestrazione §16 — unico punto che traduce le funzioni pure di `stateEngine.ts` in letture e scritture Prisma. `calcolaAvanzamento()` calcola stato, percentuale, segnale di rischio e ore extra di progetto e moduli **senza emettere query** (lavora su righe già caricate); `arricchisciProgetti()` allega l'avanzamento a un elenco; `ricalcolaProgetto()` persiste la cascata micro-voce → modulo → progetto. Due regole di scrittura non ovvie: **le percentuali non si persistono** (derivano da campi già in riga, una colonna in più potrebbe divergere dai propri ingredienti) e **un modulo senza micro-voci non si tocca** (`calcolaStatoModulo([])` risponde `pending`, che declasserebbe un modulo chiuso a mano — con zero micro-voci la riga è l'unica informazione esistente).
- **`src/services/pdfService.ts`**: Generazione PDF server-side nativi per fatture e documenti (Buffer PDF senza dipendenze browser).
- **`src/services/emailService.ts`**: Invio email transazionali SMTP Nodemailer (Magic Link, notifica scadenze e test socket Register.it).
- **`src/services/imapFetcher.ts`**: Fetcher email IMAP raw via TLS socket diretto — lettura posta in arrivo senza libreria IMAP esterna.
- **`src/services/otpService.ts`**: Gestione codice OTP a tempo (5 min), rate limiting e sigillo server-side della firma (OTP verificata · art. 20 CAD). `generateEidasSignatureSeal()` è **l'unica fonte legittima** di marca temporale, `signatureId`, impronta SHA-256 e indirizzo IP di una firma: l'IP arriva da `req.ip`, che solo il server conosce. Il frontend non li fabbrica (regola 7).
- **`src/services/cronService.ts`**: Worker automatico background scansione rinnovi UBO Malta, marchi EUIPO e solleciti fatture.
- **`src/services/sdiService.ts`**: Trasmissione diretta 1-Click della Fattura Elettronica XML a SdI Agenzia delle Entrate.
- **`src/services/securityScanner.ts`**: Validazione Magic-Bytes e sanitizzazione PDF nel Vault Documenti.
- **`src/services/storageService.ts`**: Archiviazione Cloud S3/Supabase Storage con Presigned URL. Contiene il punto di verità per i nomi file: `nomeFileSicuro()` sanifica in scrittura, `nomeFileValido()` rifiuta in lettura (la divergenza fra le due metà *era* il path traversal), `urlUploadFirmato()` e `rifirmaUrlUpload()` emettono e rinnovano la firma HMAC dei download.

### 🔩 Adapters (`src/adapters/`)

Implementazioni concrete delle porte di dominio.

- **`src/adapters/inMemoryApp.ts`**: App in-memory — quick start senza database. Usa la stessa logica di dominio testata (`istanziaProgetto`, `stateEngine`), con persistenza solo in RAM. Si azzera ad ogni riavvio del processo. Per la persistenza vera: `src/adapters/prisma/`.
- **`src/adapters/appErrors.ts`**: Errori applicativi condivisi (`ClienteNonTrovatoError`, `ProgettoNonTrovatoError`, `PreventivoNonTrovatoError`, `ModuloNonTrovatoError`, `TransizioneNonValidaError`). Sia `InMemoryApp` che `PrismaApp` li lanciano, `server.ts` li mappa agli status HTTP giusti.
- **`src/adapters/prisma/prismaApp.ts`**: Adapter Prisma completo per PostgreSQL/Supabase. Implementa `AppPort` con tutte le operazioni CRUD reali via Prisma, inclusa `listaUtenti()` (ora di sola lettura — prima riscriveva utenti cablati ad ogni chiamata).
- **`src/adapters/prisma/prismaIstanziazionePort.ts`**: Implementazione Prisma delle porte `IstanziazionePort` e `EsecuzionePort` — transazioni atomiche reali su PostgreSQL.
- **`src/adapters/prisma/bootstrap.ts`**: Bootstrap del sistema (§27). Crea il primo `super_admin` con `tenantId: null`. Va lanciato **una sola volta** con `npm run bootstrap`, mai come endpoint HTTP.
- **`src/adapters/prisma/seed.ts`**: Script di seed leggero esportato come modulo.
- **`src/adapters/prisma/seedFull.ts`**: Seed completo di produzione per popolare Supabase/PostgreSQL (utenti studio, giurisdizioni, articoli distinta base, moduli template e clienti ERP).
- **`src/adapters/prisma/applyRls.ts`**: ⚠️ **SUPERATO** — non applicare più da qui. Documentazione del perché il vecchio `20260815_enable_rls.sql` è stato sostituito. La migrazione nuova si applica solo con `psql` diretto.
- **`src/adapters/prisma/index.ts`**: Re-export del modulo adapter Prisma.

### 🔑 Utilities Backend (`src/util/`)

- **`src/util/prismaClient.ts`**: I tre client Prisma e il contesto tenant per richiesta (§14). `prisma` è il client applicativo: impone `app.current_tenant_id` a ogni query, così le policy RLS hanno qualcosa su cui filtrare. `prismaAmministrativo()` scavalca RLS e va usato **solo** per script, seed, bootstrap, backup, la ricerca dell'utente per email al login e la verifica del magic token (richieste anonime per definizione, dove il tenant si scopre dalla riga cercata). `conContestoInTransazione()` reimposta la variabile dentro una transazione interattiva, che gira su una connessione propria.
- **`src/util/password.ts`**: Hashing password con scrypt di `node:crypto` (§23) — nessuna dipendenza con binding nativi. `hashPassword()`, `verifyPassword()` con `timingSafeEqual`, `generaPasswordTemporanea()` con `randomBytes`.
- **`src/util/jwt.ts`**: Gestione token JWT (generazione, verifica, estrazione claims), firma HMAC per download (`firmaDownload`, `verificaFirmaDownload`), generazione e hash magic token (`generateMagicToken`, `hashMagicToken`).
- **`src/util/serverHelpers.ts`**: Costanti e helper condivisi estratti da `src/server.ts` (split dei monoliti): costanti tenant/sessione (`TENANT_DEFAULT`, `DURATA_SESSIONE_*`, `SOGLIA_RINNOVO`, `GIORNI_VALIDITA_MAGIC_LINK`, stati micro-voce/progetto), `ipReale()`, `recordAudit()`, `normalizzaGrafometrica()`, `nomeFileDaUrl()`, `clienteDellaRichiesta()`, `senzaHash()`, `baseUrlApplicazione()`, validazione recapiti OTP. Sono importati da `server.ts` e dai moduli `src/routes/` che ne hanno bisogno.

### 🛠 Script di Manutenzione (`src/scripts/`)

- **`src/scripts/backupDb.ts`**: Backup e snapshot JSON di tutte le tabelle del database BluMan multi-tenant.
- **`src/scripts/verifyAll.ts`**: Test runner completo per il collaudo automatico della test suite end-to-end.
- **`src/scripts/verificaAccessi.ts`**: Diagnostica read-only di chi può effettivamente autenticarsi, da lanciare **prima** di un rilascio che chiude l'autenticazione: elenca ruolo, tenant e presenza/assenza di `password_hash` (mai l'hash) e fallisce con exit 1 se non esiste un `super_admin` attivo con password.
- **`src/scripts/checkRls.ts`**: Diagnostica read-only dell'isolamento reale — ruolo di connessione, `bypassrls`, RLS attivo/forzato per tabella e prova pratica con un tenant inesistente (deve restituire 0 righe).
- **`src/scripts/probeAvanzamento.ts`**: Diagnostica read-only del motore di stato (§16) su tutti i tenant: per ogni progetto confronta lo stato in riga con quello calcolato e dice **quali righe un `POST /progetti/:id/ricalcola` cambierebbe, prima di eseguirlo**. Segnala a parte i moduli senza micro-voci, il cui stato non è verificabile né correggibile.
- **`src/scripts/assignPasswords.ts`**: Assegnazione password iniziali agli utenti senza `password_hash` (`npm run passwords:assign`). Complementare a bootstrap (§27). Le password sono stampate **una sola volta**, mai salvate né inviate.
- **`src/scripts/testTenantDb.ts`**: Verifica di andata e ritorno delle impostazioni studio su database. Pretende `TEST_TENANT_ID` e si rifiuta di girare senza (scriveva sul tenant di produzione), usa valori segnaposto `.invalid` e maschera i campi segreti (`smtpPass`, `imapPass`, `waAccessToken`, `waVerifyToken`, `tgBotToken`) invece di stamparli.
- **`src/scripts/cleanupTestData.ts`**: Rimozione artefatti lasciati nel database reale da run di vitest precedenti all'isolamento. Dry-run di default, `--conferma` per cancellare. Criteri di sicurezza: nome cablato nei test, UUID generato (non id parlanti del seed), nessun progetto/preventivo collegato.
- **`src/scripts/mapTenantTables.ts`**: Diagnostica read-only: classifica le tabelle di `public` in base a come si legano al tenant (colonna diretta `tenant_id` vs risalita al padre). Serve a scrivere le policy RLS corrette.
- **`src/scripts/inspectDb.ts`**: Ispezione rapida dello stato del database.
- **`src/scripts/seedData.ts`**: Seed dati di supporto.

### 🧪 Test Suite (`src/` — Vitest)

Configurazione: `vitest.config.ts` + `vitest.setup.ts` (isolamento dal DB reale).

- **`src/server.test.ts`**: Test end-to-end del server Fastify — guard di autenticazione (401 sulle rotte protette, raggiungibilità rotte pubbliche, preflight CORS), regressione sulle vecchie credenziali cablate.
- **`src/credenziali.test.ts`**: Presidio che scandisce `src/`, `frontend/src/` e `api/` alla ricerca delle vecchie password cablate, dei token finti e del ripiego `!password ||`. Non elenca le credenziali per documentarle: le cerca per impedirne il ritorno.
- **`src/accessoCliente.test.ts`**: Presidio dell'accesso del cliente al portale — magic token inventato, assente o scaduto → 401 con lo stesso messaggio; token valido → JWT col `tenantId` dalla riga; in tabella solo SHA-256; `..%2f` su `/uploads` → 400; `/uploads` senza Bearer né firma → 401; firma manomessa, di altro file o scaduta → 401.
- **`src/gerarchiaRuoli.test.ts`**: Presidio della gerarchia §2bis con client Prisma finto — copre il 403 sulla modifica riga `super_admin`, `tenantId: null` del super_admin, tenant di chi crea per i collaboratori, e 503 (non elenco vuoto) su errore lettura team.
- **`src/calcoloService.test.ts`**: Presidio del service layer del motore di stato §16 (22 test). Verifica le percentuali *mostrate* — compreso il tetto a 99 quando la media pesata arrotonderebbe a 100 su un progetto non chiuso — la media pesata sulle ore anziché sul numero di moduli, i segnali di rischio, e soprattutto **quali righe vengono scritte e quali no**: nessuna scrittura se lo stato calcolato coincide con quello in riga, nessuna scrittura sullo `stato` di una micro-voce (la cascata sale, non scende), nessun declassamento di un modulo senza micro-voci, `pre_project` mai promosso per calcolo. Copre anche la rotta via HTTP: 200 con avanzamento, 404 su id inesistente, 401 senza token, `avanzamento` presente in `GET /progetti`.
- **`src/util/password.test.ts`**: Test hashing/verifica password scrypt, salt casuale, e gestione valori malformati.
- **`src/util/prismaClient.test.ts`**: Test del client Prisma e contesto tenant.
- **`src/domain/stateEngine.test.ts`**: Test del motore di calcolo stati — cascata micro-voce → modulo → progetto, segnali rischio, ritardi, dipendenze.
- **`src/domain/giurisdizioni.test.ts`**: Test sulla coerenza dei dati giurisdizioni.
- **`src/services/istanziaProgetto.test.ts`**: Test orchestrazione istanziazione progetto §15.3.
- **`src/services/esecuzione.test.ts`**: Test orchestrazione consuntivazione ed esecuzione §17.
- **`src/services/antiDuplication.test.ts`**: Test anti-duplicazione entità.
- **`src/services/communications.test.ts`**: Test comunicazioni omnichannel.
- **`src/services/catalogDocumentLinkage.test.ts`**: Test collegamento catalogo-documenti.
- **`src/services/newFeatures.test.ts`**: Test funzionalità aggiunte di recente.
- **`src/services/pdfService.test.ts`**: Test generazione PDF server-side.
- **`src/services/auditAccounting.test.ts`**: Test audit contabile.
- **`src/services/teamAnalytics.test.ts`**: Test analytics team operatori.

### ☁️ Serverless Functions (`api/`)

- **`api/send-email.ts`**: Vercel Serverless Function con Nodemailer per invio test SMTP, inviti collaboratori con credenziali e comunicazioni live fascicolo a clienti.
- **`api/send-whatsapp.ts`**: Vercel Serverless Function per dispatch sicuro e senza CORS verso Meta WhatsApp Cloud API.
- **`api/webhooks/communications/`**: Webhook per ingestion messaggi da canali esterni (Telegram, WhatsApp).

### 📦 Migrazioni Database (`prisma/migrations/`)

- `0_init/`: Schema iniziale completo.
- `20260819120000_rimozione_password_chiaro_tenant/`: DROP della colonna `lead_advisor_password` da `Tenant`.
- `20260819190000_super_admin_senza_tenant/`: Rimette a NULL i `tenant_id` dei super_admin.
- `20260819210000_magic_link_persistito/`: Crea la tabella `MagicLink` con policy RLS incorporata.
- `20260827180000_archiviazione_documenti_firmati/`: Aggiunge `isArchiviato`, `archiviatoAt`, `archiviatoDaId` a `Documento` e `isArchiviato` a `EngagementLetter` (additiva: nessun dato toccato). I documenti firmati non si eliminano più: si archiviano.

### 🔒 Migrazioni RLS Supabase (`supabase/migrations/`)

- **`20260819_rls_effettiva.sql`**: Ruolo `bluman_app` (senza `BYPASSRLS`), policy `isolamento_tenant` su tutte le tabelle, `FORCE ROW LEVEL SECURITY`. Si applica con `psql` (usa `\gexec` per non stampare la password). Sostituisce `20260815_enable_rls.sql`.
- `20260815_enable_rls.sql`: ⚠️ **INERTE** — le sue policy PERMISSIVE si sommerebbero in OR a quelle nuove, vanificandole. Non riapplicare.

### 🏗 Infrastruttura & CI

- **`.github/workflows/ci.yml`**: Workflow di Continuous Integration GitHub Actions per build e test automatici ad ogni push.
- **`Dockerfile`** + **`docker-compose.yml`**: Containerizzazione backend.
- **`railway.json`**: Configurazione deployment Railway.
- **`vercel.json`**: Configurazione deployment Vercel (serverless functions + frontend).
- **`.agents/skills/meta-whatsapp-integration/SKILL.md`**: Skill e runbook per l'integrazione WhatsApp Business Cloud API & Remote MCP Meta DevTools.
- **`prisma/seed.ts`**: Script di seed master completo e idempotente per popolare Supabase/PostgreSQL (utenti studio, giurisdizioni, articoli distinta base, moduli template e clienti ERP).
- **Firma Elettronica Semplice & OTP**: `POST /portal/request-otp`, `POST /portal/verify-otp-and-sign` (Sigillo SHA-256 e Timestamp ISO), `POST /portal/firma-con-file` (firma a penna/qualificata ricaricata), `GET /firme` (il cliente vede solo le proprie). Ambiti OTP: `engagement_letter`, `documento_vault`, `modulo_completato` (conclusione di un'operazione: impronta calcolata dal server sui dati del modulo via `improntaModuloCompletato`, mai dal browser; 409 se il modulo non è `done` o è già firmato), `addendum`.
- **Cron Scadenze**: `POST /cron/esegui-notifiche-scadenze` (Scansione UBO, KYC, fatture e solleciti automatici).
- **Telegram Bot Webhook**: `POST /webhooks/communications/telegram`, `POST /tenant/telegram-webhook-setup` (Ingestion live nei progetti).
- **Trasmissione SDI 1-Click**: `POST /invoices/:id/trasmetti-sdi` (Invio diretto e tracciatura SdI).
- **Articoli & Listino**: `GET /articoli`, `POST /articoli`, `PATCH /articoli/:id` (Modifica Prezzo & Ore Admin)
- **Document Studio & Template Contratti**: `GET /documenti-template`, `POST /documenti-template`, `PUT /documenti-template/:id`, `DELETE /documenti-template/:id` (Salvataggio modelli con Smart Tags ERP)

---

## 🗄 3. Database Schema (`prisma/schema.prisma`)

- **`Tenant`**: Dati studio, Sede Legale, Sede Operativa, P.IVA, Logo URL, Colore Tema PDF, credenziali SMTP (`smtp_pass`) e IMAP (`imap_pass`) isolate per tenant.
  - ⚠️ La colonna `lead_advisor_password` **non esiste più**: rimossa dalla migrazione `prisma/migrations/20260819120000_rimozione_password_chiaro_tenant/`. Conteneva la password del responsabile in chiaro, era restituita da `GET /admin/tenants`, era scrivibile da qualunque utente del tenant via `PATCH /tenant/info` e finiva in ogni backup. Le password dello staff vivono solo come hash scrypt su `user.password_hash`. La DROP è volutamente irreversibile: non c'è nulla da recuperare, solo qualcosa da non ricreare.
- **`Cliente`**: Dati ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC, `referentiJson`.
- **`User`**: `tenantId` **nullable**, e la nullità è semantica: `NULL` significa `super_admin`, cioè un utente di piattaforma che non appartiene a nessuno studio (§2bis). La policy RLS di `public."user"` concede la visione delle righe senza tenant al solo `super_admin`, quindi un `super_admin` con `tenant_id` valorizzato diventa un utente ordinario di quello studio — modificabile dal suo advisor. Ripristinato da `prisma/migrations/20260819190000_super_admin_senza_tenant/`; dettagli e conseguenze nella sezione «Accesso & Gerarchia dei Ruoli» qui sopra. Password solo come hash scrypt su `password_hash`; `stato` è `StatoUtente` (`attivo` | `invitato` | `disattivato`), non un booleano.
- **`ComunicazioneProgetto`**: `progettoId`, `canale` (`email`, `whatsapp`, `telegram`, `signal`), `mittente`, `direzione` (`entrata`, `uscita`), `testo`, `allegatiJson`.
- **`ContrattoRicorrente`**: `clienteId`, `progettoId` (opzionale con FK), `frequenza`, `importoCentesimi`, `prossimaFatturazione`.
- **`ModelloDocumentoCustom`**: `tenantId`, `titolo`, `categoria`, `descrizione`, `contenutoHtml` (persistenza template Word-like studio).
- **`MagicLink`**: I token di accesso passwordless del cliente al portale (§23), aggiunta da `prisma/migrations/20260819210000_magic_link_persistito/`. `tenantId`, `clienteId` (FK `Cliente`, `ON DELETE CASCADE`), `tokenHash` **unique**, `scadenza`, `email` del destinatario, `usatoAt`.
  - In riga va lo **SHA-256** del token, mai il token: chi legge il database non deve poter entrare al posto del cliente. SHA-256 e non scrypt perché il token ha già 128 bit da `crypto.randomBytes` — scrypt difende dalle password indovinabili, e qui non c'è niente da indovinare.
  - `email` sta qui e non su `Cliente`, che non ha una colonna email: serve all'audit (una credenziale di accesso senza traccia di dove è finita non è verificabile) e dà un indirizzo al JWT di sessione, che prima era cablato nel sorgente.
  - Il link è **riutilizzabile** fino a scadenza — un cliente riapre il proprio link più di una volta, e invalidarlo al primo accesso lo chiuderebbe fuori. `usatoAt` registra il primo uso per l'audit; la revoca è la cancellazione della riga.
  - La migrazione porta **la propria policy RLS** (`ENABLE` + `FORCE` + `isolamento_tenant`), non solo il `CREATE TABLE`: `supabase/migrations/20260819_rls_effettiva.sql` lo applica una persona con `psql`, mentre `migrate deploy` gira senza nessuno davanti a ogni deploy. Se la policy vivesse solo là, la tabella nascerebbe scoperta su ogni database nuovo. I GRANT non servono: `ALTER DEFAULT PRIVILEGES` copre già le tabelle future.
- **`PermessoModulo`**: Matrice isolata per `tenantId`, `userId`, `moduloChiave` con livello (`denied` | `read` | `write`).
- **`Fattura`**: `tipoDocumento` (`fattura` | `nota_credito`), `serie` (`FT` | `NC`), `numeroProgressivoSerie`, `causaNotaCredito`.
- **`PassaggioProgetto`**: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.
- **`Documento`** (§WF-DOC): Vault documentale con `statoDoc` (`bozza` | `pubblicato` | `in_revisione` | `firmato`), `versione`, `documentoPadreId` (catena versioni), `firmatoAt`; archiviazione soft con `isArchiviato`, `archiviatoAt`, `archiviatoDaId`: i documenti firmati non si eliminano mai (409 anche per admin), si archiviano. Anche `EngagementLetter` ha `isArchiviato`.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY AGENT & DEV RULES)

1. **Isolamento Multi-Tenant Tassativo (`tenant_id`)**:
   - I dati tra i vari Tenant/Studi **NON SI DEVONO ASSOLUTAMENTE MISCHIARE**.
   - Ogni query, rotta API e tabella PostgreSQL **DEVE essere rigorosamente isolata** tramite `tenant_id` ed a livello database con PostgreSQL Row-Level Security (RLS).
   - Il filtro applicativo su `tenant_id` **non basta e non è la difesa**: è RLS che lo è. Il runtime si connette col ruolo `bluman_app`, che non può scavalcare le policy, e il contesto tenant viene impostato per ogni richiesta dall'hook `onRequest` di `src/server.ts`. Non usare `new PrismaClient()` in codice che serve una richiesta HTTP: usa `prisma` da `src/util/prismaClient.ts`, altrimenti la query parte senza contesto e non vede nulla.
   - `prismaAmministrativo()` scavalca RLS. È ammesso solo in script di manutenzione, seed, bootstrap, backup, nella ricerca dell'utente per email al login e nella verifica del magic token in `POST /auth/magic-login` (in entrambi i casi la richiesta è anonima per definizione: non porta un contesto tenant, e il tenant si scopre proprio dalla riga che si sta cercando — nel magic-login è il token da 128 bit a delimitare cosa la query può trovare, non il contesto). **Ogni altro uso riapre esattamente il buco che le policy chiudono.**
   - Verifica sul database reale: `npx tsx src/scripts/checkRls.ts`.

2. **Migrazioni Versionate, Mai `db push` su Dati Reali**:
   - Lo schema si cambia con `prisma migrate dev` in sviluppo e `prisma migrate deploy` in produzione, mai con `prisma db push --accept-data-loss`: quest'ultimo riallinea il database al file cancellando in silenzio colonne e tabelle non presenti. Era il comando di avvio del container su Railway.
   - Le migrazioni girano su `DIRECT_URL` (ruolo proprietario dello schema); il server usa `DATABASE_URL` (ruolo `bluman_app`, che non ha `CREATE` su `public` di proposito).
   - Vale anche per le correzioni di **dati**, non solo di schema: la riparazione dei `tenant_id` dei super_admin è la migrazione `20260819190000_super_admin_senza_tenant`, scritta idempotente (`WHERE tenant_id IS NOT NULL`), non una `UPDATE` lanciata a mano da una console. Una correzione fuori dalle migrazioni non arriva sugli altri ambienti e non lascia traccia del perché.

3. **Sincronizzazione Schema Database & Persistenza Cloud Obbligatoria (Prisma & Fastify DB)**:
   - **TUTTO QUELLO CHE VIENE AGGIUNTO O MODIFICATO NELL'INTERFACCIA E NEI MODULI (spunte, passaggi, microvoci, note, scadenze, assegnazioni operatori, clienti, comunicazioni) DEVE ESSERE TASSATIVAMENTE SALVABILE E COLLEGATO AL DATABASE POSTGRESQL/PRISMA VIA API FASTIFY.**
   - **NON POSSIAMO PERMETTERCI DI PERDERE DATI.** Ogni stato o azione deve persistere su Database Server in modo che, spegnendo il PC o collegandosi da qualsiasi altra postazione/dispositivo, lo storico rimanga al 100% integro ed accessibile.
   - Ogni nuova funzionalità o campo form aggiunto **DEVE essere istantaneamente mappato** in `prisma/schema.prisma` ed allineato al backend. NESSUN dato deve essere mantenuto solo in RAM o registrato solo temporaneamente.
   - Eseguire sempre `npx prisma generate` ad ogni variazione dello schema.

4. **Aggiornamento Documentazione Markdown (`.md`)**:
   - Dopo ogni modifica importante, refactoring o cambio codice, tutti i file di documentazione (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) **DEVONO essere tassativamente aggiornati ed allineati**.

5. **Aggiornamento Mappa Grafo (Graphify)**:
   - Dopo modifiche strutturali ai moduli o ai servizi, eseguire `python -m graphify extract . --code-only` e `python -m graphify cluster-only .` per mantenere la mappa delle dipendenze di codice e la documentazione architettonica sempre sincronizzate.
   - ✅ **Grafo AGGIORNATO (27 agosto 2026):** 1492 nodi, 3192 archi, 227 community. Include workflow approvazione/richiesta modifica documenti, generazione PDF binari A4 lato client/server, selettore canali OTP (Email/WhatsApp/SMS) e modal firma interattivo. Generati `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md` e `graphify-out/graph.html`.


6. **Divieto Assoluto di Esposizione Credenziali su GitHub & Persistenza Isolata su DB Tenant**:
   - **NESSUNA credenziale reale (password email SMTP/IMAP, token segreti, chiavi API o password di database) deve MAI essere scritta in chiaro nel codice versionato su GitHub o nei file `.md`**.
   - Tutte le password e credenziali dello studio DEVONO risiedere rigorosamente nel Database PostgreSQL collegate al singolo `Tenant` (`prisma.tenant.smtpPass`, `prisma.tenant.imapPass`, ecc.) e gestite in modo protetto via API (`PUT /tenant/settings`).
   - Le password **degli utenti** non risiedono nemmeno lì: solo come hash scrypt su `user.password_hash`. Nessuna colonna, nessuna risposta API e nessun `localStorage` conserva una password di persona in chiaro.
   - Il divieto vale anche per le credenziali *di ripiego*: un `|| 'password-qualunque'` e un campo password precompilato nella UI sono credenziali cablate a tutti gli effetti, perché il valore che l'API annuncia è il valore con cui si entra. Il presidio automatico è `src/credenziali.test.ts`, che scandisce `src/`, `frontend/src/`, `api/` ed i file `.md` — non solo il backend, perché il bundle frontend è pubblico esattamente come il repository.
   - Un segreto non va documentato nemmeno per spiegare che è stato rimosso: nei commenti si rimanda a `src/credenziali.test.ts`, che lo cerca, invece di trascriverlo.
   - L'isolamento multi-tenant garantisce che uno studio non possa in alcun modo visualizzare né accedere ai dati, alla posta o ai contratti di un altro studio.

7. **Il Frontend Non Inventa Dati che il Database Non Ha**:
   - Se un progetto non ha moduli, la pagina **dichiara il vuoto**. Non mostra un elenco di ripiego, non lo costruisce da una libreria di esempi e non lo deduce dal nome del cliente.
   - Vietati i ripieghi che riempiono un buco con un valore verosimile: `|| 75` su una percentuale, `|| 3500` su un prezzo, `|| 20` su delle ore, `|| 'Senior Advisor'` su un operatore, un elenco di micro-voci costruito a *render time*. Il danno non è estetico: rendono l'inventato indistinguibile dal reale, e così nessuno si accorge più che il dato manca. Un ripiego a render time è il peggiore, perché annulla in silenzio ogni correzione fatta a monte — ed erano righe **cliccabili**, che avrebbero chiamato `consuntivaMicrovoceApi` con l'id di una micro-voce inesistente.
   - **Le evidenze legali si prendono solo dal server**: marca temporale, numero di repertorio, impronta SHA-256 e indirizzo IP vengono dal sigillo emesso da `/portal/verify-otp-and-sign` (`generateEidasSignatureSeal()`), che l'IP lo legge dalla richiesta. Il browser **non conosce il proprio IP pubblico** e non può attestarlo. Senza sigillo il PDF esce senza pagina di evidenze: una firma che nessuno ha apposto non si disegna, e una controfirma dello studio che non esiste in nessun registro non si aggiunge "per completezza".
   - **Niente etichette che promettono più di quello che è accaduto**: un `alert` non annuncia un "Sigillo FEA eIDAS UE 910/2014" se non c'è stata nessuna chiamata al server; un `catch` non scrive "completata" su un'operazione fallita; un pulsante che scrive solo in `localStorage` non ha salvato niente (regola 3) e non dice "salvato".
   - **Nessun dato di un cliente reale come valore iniziale di un form**: i valori d'esempio nello `useState` di un form si vedono a *tutti* finché qualcosa non li sovrascrive — ed è successo con partita IVA, codice fiscale e IBAN di un cliente vero, che ogni altro cliente trovava nei propri campi pronti da salvare come propri. I campi si riempiono dalla riga del cliente autenticato, oppure restano vuoti.
   - Il presidio è la lettura: `grep -nE "\|\| *(75|100|3500|28500|20|15)\b"` sulle pagine toccate prima di chiudere una modifica.


