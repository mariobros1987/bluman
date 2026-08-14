# BluMan — Piano di Sviluppo & Stato Avanzamento Produzione

**Fonte:** `BluMan_specifica_di_sviluppo_v2.3.docx` (34 sezioni).

---

## 🎯 Stato di Avanzamento Fasi (Aggiornato)

### FASE 0 — Setup e Fondamenta Progetto
- [x] Repository Git locale e remoto GitHub (`mariobros1987/bluman`).
- [x] Backend Fastify + TypeScript + Prisma ORM.
- [x] Frontend React 19 + Vite.
- [x] Mappa architetturale ed indicizzazione per ottimizzazione token (`.agents/AGENTS.md`).

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
  - `🕸 Grafo & Dipendenze Moduli` (Workflow visivo con frecce `➔` e pulsante `+ Aggiungi Modulo da Libreria`).
  - `💶 Fatturazione & SDI` (Emissione sia di Fatture `FT` che Note di Credito `NC` con serie distinte ed anteprima PDF).
- [x] **Libreria Moduli & Distinta Base (`/library`)**:
  - Split-screen builder con **editing prezzo unitario (€)** in distinta base.
  - Catalogo articoli con modal di modifica prezzo e ore listino per Admin.
  - Tab 4: Modelli contratti PDF in bianco e Form Master.
- [x] **Portale Cliente Passwordless (`/portal`)**:
  - Scheda 1: ✍️ Proposta d'Ordine & Firma Engagement Letter 1-Click.
  - Scheda 2: 📊 Avanzamento Live Lavori (progress bar 65% e timeline).
  - Scheda 3: 📋 Form Dati Societari con salvataggio diretto.
  - Scheda 4: 📎 Vault Documenti Legali.
  - Scheda 5: 💬 Contatti Advisor.
- [x] **Impostazioni Studio (`/settings`)**:
  - Sede Legale e Sede Operativa disaccoppiate.
  - Configuratore Layout Fattura PDF (Logo studio, colore tema, note legali ed anteprima live).
- [x] **Calendario Condiviso & Scadenzario Studio (`/calendar`)**:
  - [x] Vista Mese ed Inserimento Scadenze Attività.
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
   - [ ] Sostituire la simulazione locale dell'autenticazione con vera firma JWT su Cookie HTTP-Only e Bearer Header.
2. **📧 Transport Email SMTP Reale (Nodemailer + Register.it / SendGrid)**:
   - [ ] Attivare l'invio reale delle email per i Magic Link ed i promemoria scadenze invece di mostrare gli URL negli appunti.
3. **📦 Cloud Object Storage (AWS S3 / Supabase Storage)**:
   - [ ] Sostituire la cartella `./uploads/` locale del server con un bucket S3 / Supabase Storage con backup automatico.
4. **🛡 Row-Level Security (RLS) PostgreSQL**:
   - [ ] Eseguire le migrazioni SQL per abilitare le policy RLS sul database PostgreSQL per l'isolamento multi-tenant a livello di DB kernel.
5. **📜 Webhook Firma Qualificata eIDAS (FEA / OTP SMS)**:
   - [ ] Se richiesto dal cliente, collegare i provider di firma remota qualificata (Namirial / InfoCert) per la firma con valore legale pieno dell'Engagement Letter.
