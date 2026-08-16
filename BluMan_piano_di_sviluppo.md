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
  - `💬 Comunicazioni & Ingestion` (Timeline messaggi omnichannel WhatsApp, Telegram, Email, Signal).
  - `📜 Storico Contratti & Addendum` (Registro immutabile delle versioni contrattuali firmate e marca temporale eIDAS).
  - **Archiviazione & Eliminazione Sicura**: Blocco fiscale anti-cancellazione se presenti fatture.
- [x] **Gestionale Fatture, Incassi & Partite Aperte (`/invoices`) — *Ispirato ad OpenSTAManager***:
  - Dashboard globale per tutte le fatture e note di credito dello studio.
  - KPI (Fatturato, Incassato, In Sospeso, Note Credito).
  - Tab **💳 Scadenzario & Prima Nota** con registrazione rate, scadenze d'incasso e metodo di pagamento.
  - Modal **💰 Registra Incasso** per saldare acconti/rate con tracciamento CRO/TRN e note operatore.
  - Generazione ed esportazione 1-Click **📥 XML SDI (FatturaPA v1.2.2)** per l'Agenzia delle Entrate.
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
- [x] **Impostazioni Studio & Gestione Team (`/settings`)**:
  - Sede Legale e Sede Operativa disaccoppiate.
  - Configuratore Layout Fattura PDF (Logo studio, colore tema, note legali ed anteprima live).
  - **📧 Server Email SMTP Transazionale & Omnichannel**: Form configurazione SMTP + 4 Pulsanti di Test per WhatsApp, Telegram Bot, Signal Daemon ed Email.
  - **👥 Gestione Team & Performance Operatori**: Card interattive con **Francesca Disabato**, **Joe Disabato**, **Avv. Lorenzo Marino**, **Elena Rossi** e **Super Admin**.
  - **📊 Scheda Dettagliata Operatore & Timesheet Live**: Modal 1-Click con consuntivo ore lavorate, progetti assegnati, microvoci ultimate, tasso di efficienza ed export PDF.
- [x] **Super Admin & Multi-Tenant Studio (`/admin/tenants`)**:
  - [x] Dashboard metrica globale per SuperAdmin (Fatturato globale, tenant attivi, contratti Enterprise).
  - [x] Modal registrazione nuovo Tenant / Studio professionale con isolamento `tenant_id`.
  - [x] Mappatura RBAC nella Sidebar per ruolo `super_admin`.
- [x] **Calendario Condiviso & Scadenzario Studio (`/calendar`)**:
  - [x] Vista Mese ed Inserimento Scadenze Attività con menu a tendina clienti dall'Anagrafica ERP.
  - [x] Programmazione scadenze 1-Click direttamente dalle microvoci di progetto (`ProjectDetail.tsx`).
  - [x] Scadenzario Cronologico Filtrabile (Microvoci, Compliance KYC, Emissione Fatture, Firma Contratti e Promemoria).
  - [x] Drawer Modal Dettagli Evento ed Azione `✓ Marca Come Completato`.

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
   - [x] Tracciamento IP, User Agent e Timestamp 1-click engagement letter nel Portale Cliente.
