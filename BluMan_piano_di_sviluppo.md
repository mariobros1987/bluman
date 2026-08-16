# BluMan — Piano di Sviluppo & Stato Avanzamento Produzione

**Fonte:** `BluMan_specifica_di_sviluppo_v2.3.docx` (34 sezioni).

---

## 🎯 Stato di Avanzamento Fasi (Aggiornato)

### FASE 0 — Setup e Fondamenta Progetto
- [x] Repository Git locale e remoto GitHub (`mariobros1987/bluman`).
- [x] Backend Fastify + TypeScript + Prisma ORM.
- [x] Frontend React 19 + Vite.
- [x] Mappa architetturale ed indicizzazione per ottimizzazione token (`.agents/AGENTS.md`).
- [x] **Audit Produzione Enterprise**: Documento analitico completo di Go-Live readiness (`production_readiness_audit.md`).

### FASE 1 — Schema Database PostgreSQL & Prisma (`prisma/schema.prisma`)
- [x] `Tenant`: Dati fiscali studio, sedi legali/operative distinte, logo URL, colore tema PDF, note legali.
- [x] `Cliente`: Dati anagrafici ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC.
- [x] Libreria a distinta base: `articolo`, `modulo_template`, `riga_distinta`, `passaggio_template`, `modulo_dipendenza_template`.
- [x] `ModelloDocumentoInBianco` e `FormMaster`: Libreria contratti PDF e moduli master dati.
- [x] `Fattura`: Gestione distinta per `tipoDocumento` (`fattura` | `nota_credito`), serie autonoma (`FT` vs `NC`), `numeroProgressivoSerie` e campi tracciato SDI Comped.
- [x] `PassaggioProgetto`: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.

### FASE 2 — Frontend UI & Portale Cliente Passwordless
- [x] **Dashboard (`/`)**: KPI portafoglio, avvisi ritardo, navigazione deep-link ai clienti ed ai progetti.
- [x] **Anagrafica Clienti ERP (`/clients`)**: Modal `AnagraficaErpModal` a 4 schede per dati legali, sedi, fatturazione SDI e fascicolo KYC/AML.
- [x] **Dettagli Progetto (`/projects/:id`)**:
  - `🗂 Moduli & Microvoci` (Consuntivazione ore e diario note operatore).
  - `🕸 Grafo & Dipendenze Moduli` (Workflow visivo con **🔒 Lucchetti Topologici Dinamici**, frecce `➔`, pulsante `+ Aggiungi Modulo da Libreria` e **`✉️ Notifica Sblocco al Cliente`**).
  - `💶 Fatturazione & SDI` (Emissione sia di Fatture `FT` che Note di Credito `NC` con serie distinte ed anteprima PDF).
  - `📊 Redditività & Margini` (Dashboard analitica con Margine Lordo Studio, Resa Oraria Effettiva €/ora, Ore Stimate vs Reali ed export **📄 Dossier Trasparenza PDF**).
  - `📄 Documenti & Vault Legale` (Archivio contratti, certificati MFSA, fascicolo KYC ed **📤 Upload File PDF**).
  - `📅 Calendario & Scadenzario` (Scadenzario cronologico del progetto, promemoria ed inserimento 1-click **`+ Programma Nuova Scadenza`**).
  - `💬 Comunicazioni & Ingestion` (Timeline messaggi omnichannel WhatsApp, Telegram, Email, Signal con binding automatico e dinamico dei recapiti dall'Anagrafica Master Cliente ERP).
  - `📜 Storico Contratti & Addendum` (Registro immutabile delle versioni contrattuali firmate e marca temporale eIDAS).
  - **Archiviazione & Eliminazione Sicura**: Blocco fiscale anti-cancellazione se presenti fatture.
- [x] **Registro Fatture & Note di Credito (`/invoices`)**:
  - Dashboard globale per tutte le fatture e note di credito dello studio.
  - KPI (Fatturato Emesso, Incassato Saldate, In Sospeso, Note Credito).
  - Generazione ed esportazione 1-Click **📥 XML SDI (FatturaPA v1.2.2)** per l'Agenzia delle Entrate.
- [x] **Scadenzario Incassi & Prima Nota Studio (`/payments`)**:
  - Sezione dedicata alle partite aperte, rateizzazioni ed incassi in scadenza.
  - Modal **💰 Registra Incasso** per saldare acconti/rate con tracciamento CRO/TRN e note operatore.
  - Azione **✉️ Sollecita Pagamento** con invio notifiche ed IBAN del Tenant.
- [x] **Contratti Ricorrenti & Retainer Studio (`/retainers`) — *Ispirato ad OpenSTAManager***:
  - Gestione contratti continuativi di Advisory, Corporate Governance e Compliance AML.
  - Pianificazione frequenza canone (mensile, trimestrale, semestrale, annuale) e data prossima fatturazione.
  - Modal 1-Click **`➕ Nuovo Contratto Retainer`** collegato all'Anagrafica Clienti ERP.
- [x] **Checklist & SOP Compliance di Progetto — *Ispirato ad OpenSTAManager***:
  - Voci di controllo e spunte obbligatorie per ciascun passaggio operativo di progetto.
  - Persistenza dello stato completato ed audit operatore.
- [x] **Libreria Moduli & Distinta Base (`/library`)**:
  - Split-screen builder con **editing prezzo unitario (€)** in distinta base.
  - Catalogo articoli con modal di modifica prezzo, ore listino, **📄 Modelli Documenti in Bianco Collegati (PDF)** e **📋 Form Master Dinamici** per Admin.
  - Tab **🌍 Giurisdizioni Studio**: Gestione giurisdizioni (Malta 🇲🇹, Gibilterra 🇬🇮, Florida 🇺🇸, Delaware 🇺🇸, EAU 🇦🇪) e menu 1-click **`➕ Associa Modello`** e **`✕ Scollega`**.
  - Tab **🕸 Grafo Topologico Moduli**: Layout topologico a 3 colonne (*Punto di partenza*, *Sbloccati a cascata*, *Dipendenti*) con **Filtro Live per Giurisdizione Target (`selectedGiurId`)**, frecce connettori SVG viola illuminated (`#arrow-active`) e badge **🔒 Dipende da**.
  - **Costruttore Moduli & Articoli**: menu a tendina **`🌍 Giurisdizione Target *`** per associare ciascun modulo o prestazione ad una giurisdizione specifica.
  - **Assegnazione 1-Click a Cliente & Anti-Duplicazione**: Modal **`🚀 Assegna Modulo a Cliente`** con scansione live degli articoli già svolti per evitare lavoro doppio ed addebiti duplicati (0h addebitate per doppioni).
  - Tab 5: Modelli contratti PDF in bianco e Form Master con azionatori 1-Click **`📥 Scarica PDF`** per generare PDF reali e **`🔗 Collega a Cliente`**.
- [x] **Wizard Nuovo Progetto con Filtro Giurisdizioni a Cascata (`NewProjectWizard.tsx`)**:
  - **Step 0**: Selezione Giurisdizione/Piazza Finanziaria target.
  - **Step 1**: Selezione Cliente e Nome Progetto.
  - **Step 2**: Filtro libreria a cascata (1. Moduli specifici in evidenza, 2. Moduli generici, 3. Altre giurisdizioni).
- [x] **Portale Cliente Passwordless (`/portal`)**:
  - Scheda 1: ✍️ Proposta d'Ordine & Firma Engagement Letter 1-Click.
  - Scheda 2: 📊 Avanzamento Live Lavori (progress bar 65% e timeline).
  - Scheda 3: 📋 Form Dati Societari con salvataggio diretto.
  - Scheda 4: 📎 Vault Documenti Legali.
  - Scheda 5: 💬 Contatti Advisor.
- [x] **Impostazioni Studio, Gestione Team & Matrice Permessi RBAC (`/settings`)**:
  - Sede Legale e Sede Operativa disaccoppiate.
  - Configuratore Layout Fattura PDF (Logo studio, colore tema, note legali ed anteprima live).
  - **📧 Server Email SMTP Transazionale & Omnichannel**: Form configurazione SMTP + 4 Pulsanti di Test per WhatsApp, Telegram Bot, Signal Daemon ed Email.
  - **👥 Gestione Team & Performance Operatori**: Card interattive con **Francesca Disabato**, **Joe Disabato**, **Avv. Lorenzo Marino**, **Elena Rossi** e **Super Admin**.
  - **📊 Scheda Dettagliata Operatore & Timesheet Live**: Modal 1-Click con consuntivo ore lavorate, progetti assegnati, microvoci ultimate, tasso di efficienza ed export PDF.
  - **🔑 Matrice Permessi & Controllo Accessi RBAC (Stile OpenSTAManager)**: Modal a tab per definire per ciascun operatore/collaboratore il livello di autorizzazione (`denied`, `read`, `write`) per le 8 sezioni dello studio, con persintenza DB Prisma `PermessoModulo` e blocco API.
- [x] **Studio Document Studio & Word-like Contract Builder (`/documents`) — *Ispirato ad OpenSTAManager & DocuSeal***:
  - Editor visuale WYSIWYG per la redazione e personalizzazione dei contratti, relazioni e documenti dello Studio.
  - Toolbar di formattazione ricca (H1, H2, H3, tabelle, elenchi, allineamento, colori).
  - Foglio A4 tipografico con Intestazione (Logo Studio e dati fiscali) e Piè di Pagina (Paginazione "Pagina X di Y" e dati legali).
  - **🏷 Smart Tags ERP Live (Mail Merge)**: Inserimento 1-click di tag dinamici (`{{cliente.ragione_sociale}}`, `{{cliente.partita_iva}}`, `{{cliente.sede_legale}}`, `{{cliente.referente}}`, `{{progetto.titolo}}`, `{{progetto.importo_totale}}`, `{{studio.ragione_sociale}}`, `{{data_odierna}}`).
  - **Libreria Modelli Master Predefiniti**: Lettera d'Incarico (Engagement Letter), Accordo NDA Bilaterale, Memorandum Società Malta, Contratto Servizi Intercompany, Procura Speciale.
  - **Azioni 1-Click**: Esportazione PDF Vettoriale A4 e Salvataggio diretto nel Vault del Progetto.

- [x] **Firma Elettronica Avanzata (FEA) con OTP SMS/WhatsApp/Email (`/portal`)**:
  - Generazione codice OTP a 6 cifre temporizzato (TTL 5 minuti) con rate-limiting.
  - Invio al cliente via WhatsApp Cloud API / Email transazionale.
  - Modale interattivo nel Portale Cliente con convalida istantanea e apposizione del sigillo digitale eIDAS (Timestamp ISO UTC, SHA-256 Digest e IP certificato).
- [x] **Worker Cron Scadenze & Rinnovi Automatici (`src/services/cronService.ts`)**:
  - Scansione automatica delle scadenze rinnovi UBO Registry / MFSA Malta (annuali).
  - Scansione monitoraggio marchi EUIPO e solleciti fatture in scadenza/scadute.
  - Dispatch proattivo notifiche WhatsApp ed Email transazionali.
  - Trigger manuale 1-Click nel Calendario Condiviso Studio (`CalendarPage.tsx`).
- [x] **Webhook Ricezione Telegram Bot Reale (`/webhooks/communications/telegram`)**:
  - Serverless Function e ricezione messaggi da Telegram Webhook API.
  - Matching anagrafica cliente ERP e ingestion automatica delle comunicazioni nella timeline del progetto.
- [x] **Connettore SDI Diretto 1-Click (`src/services/sdiService.ts` & `InvoicesPage.tsx`)**:
  - Trasmissione web service delle fatture elettroniche XML al Sistema di Interscambio (SdI - Agenzia delle Entrate) con generazione identificativo SdI e audit trail.
- [x] **Modulo di Sicurezza & Sanitizzazione Upload KYC (`src/services/securityScanner.ts`)**:
  - Validazione binaria *Magic-Bytes* (PDF, PNG, JPEG) e blocco eseguibili/script pericolosi per la massima conformità bancaria.

---

## 🔍 Checklist per il Rilascio in Produzione A-Z (Enterprise Readiness)

Per la messa in produzione professionale ed il passaggio ad un ambiente live:

### FASE 2 — Autenticazione RBAC & Permessi Attori (§2bis, §23)
- [x] Staff: Login JWT (`POST /auth/login`), verifica token (`GET /auth/me`), ruoli (`super_admin`, `advisor`, `collaboratore_interno`, `collaboratore_esterno`).
- [x] Cliente: Login passwordless a Magic Link (`POST /auth/magic-login`).
- [x] Interfaccia Frontend: Pagina di Login `LoginPage.tsx`, supporto per disconnessione (Logout) e controllo sessione in `localStorage`.

1. **🔐 Autenticazione JWT & Sessioni Cookie Secure**:
   - [x] Firma JWT con HMAC SHA-256 e verifica payload Bearer Header su tutte le rotte.
2. **📧 Transport Email SMTP Reale (Nodemailer + Register.it / SendGrid)**:
   - [x] Modulo Nodemailer (`src/services/emailService.ts`) integrato per l'invio reale di Magic Link e notifiche.
3. **📦 Cloud Object Storage (AWS S3 / Supabase Storage)**:
   - [x] Modulo Cloud Storage (`src/services/storageService.ts`) per l'upload e la gestione di contratti su Supabase Storage.
4. **🛡 Row-Level Security (RLS) PostgreSQL**:
   - [x] Migrazione SQL nativa (`supabase/migrations/20260815_enable_rls.sql`) con policy di isolamento multi-tenant per tutte le tabelle.
5. **📜 Webhook Firma Qualificata eIDAS (FEA / OTP SMS)**:
   - [x] Tracciamento IP, User Agent e Timestamp 1-click engagement letter nel Portale Cliente con convalida OTP WhatsApp/Email.
