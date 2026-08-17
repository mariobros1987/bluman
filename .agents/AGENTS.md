# BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo

Questo file serve come indice rapido per l'IA ed i collaboratori per identificare i file responsabili ed evitare scansioni complete dell'intera codebase.

---

## 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`)

- **`pages/Dashboard.tsx`**: Dashboard principale con KPI portafoglio, avvisi ritardo e progetti in corso.
- **`pages/Projects.tsx`**: Gestione Avanzata Progetti & Fascicoli Operativi con 3 viste switchabili (Schede Operatore con consuntivazione ore & checklist microvoci, Tabella ERP Matrice ad alta densità, Kanban Pipeline a 4 fasi di workflow) e Executive KPI Strip.
- **`pages/ClientsPage.tsx`**: Anagrafica Clienti ERP con salvataggio bidirezionale completo, disimballo campi `referentiJson`, Magic Link passwordless e modal `AnagraficaErpModal` a 4 schede.
- **`pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Attività Studio (Vista Mese, Lista Scadenzario, Filtro Categorie e Modal Nuovo Evento).
- **`pages/ProjectDetail.tsx`**: Vista dettagliata del progetto con tab:
  - `🗂 Moduli & Microvoci` (Checklist passaggi, note operative e consuntivazione ore)
  - `🕸 Grafo & Dipendenze Moduli` (`GrafoModuliProgettoView`)
  - `💬 Comunicazioni & Ingestion Hub` (`ComunicazioniTab` con sincronizzazione live, chat interattiva e binding recapiti WhatsApp, Email, Telegram, Signal dall'Anagrafica Cliente ERP)
  - `💶 Fatturazione & SDI` (Emissione FT/NC e tracciato XML)
  - `📊 Redditività & Margini`
  - `📄 Documenti & Vault Legale`
- **`pages/InvoicesPage.tsx`**: Registro Fiscale Fatture, Note di Credito, Aliquote ed Export XML SDI.
- **`pages/ScadenzarioPage.tsx`**: Scadenzario Incassi, Partite Aperte & Solleciti Clienti con Link al Progetto.
- **`pages/PrimaNotaPage.tsx`**: Registro Prima Nota, Transazioni Cassa/Banca, CRO/TRN, Import & Riconciliazione Estratto Conto Bancario (CSV).
- **`pages/BanksPage.tsx`**: Gestione Banche, Conti Correnti Studio, IBAN & Riconciliazione Liquidità.
- **`pages/RetainersPage.tsx`**: Contratti Ricorrenti & Retainer Studio per la fatturazione periodica pianificata, collegato ai Progetti specifici con filtraggio clienti a cascata e link 1-Click `📁 Nome Progetto ↗`.
- **`pages/DocumentEditorPage.tsx`**: Studio Document Studio & Contract Builder (Editor Word WYSIWYG, Smart Tags ERP, Intestazione/Piè di Pagina A4 ed Export PDF).
- **`pages/Library.tsx`**: Gestione Distinta Base, Costruttore Moduli Template, Catalogo Articoli e Modelli Documenti in Bianco.
- **`pages/ClientPortal.tsx`**: Portale Cliente a 5 schede (Proposta & Firma 1-Click, Live Progress, Form Societari, Documenti, Live Chat & Comunicazioni con Advisor).
- **`pages/SettingsPage.tsx`**: Anagrafica Studio, Sede Legale/Operativa, Configuratore PDF Fatture con Logo, Gestione Team con 4 Professionisti Ufficiali, Matrice Permessi Granulari RBAC, ed **Email Suite Completa** (SMTP Outbound + Reply-To + BCC, IMAP/POP3 Inbound + Cartelle + Polling Live, Firma Automatica HTML con Smart Tags e Diagnostica DNS Register.it SPF/DMARC/MX con Test Socket TLS Reali).
- **`pages/SuperAdminPage.tsx`**: Dashboard Super Admin & Gestione Multi-Tenant Studi (`/admin/tenants`).
- **`pages/AuditLogPage.tsx`**: Registro Audit Super Dettagliato & Tracciamento Attività Operatori per Tenant (`/audit`).

---

## 🔌 2. API Backend Fastify (`src/server.ts`) & API Client (`frontend/src/api/client.ts`)

- **Autenticazione & Permessi RBAC**: `POST /auth/login`, `POST /auth/magic-login`, `GET /auth/me`, `GET /tenant/utenti/:userId/permessi`, `PUT /tenant/utenti/:userId/permessi` (Token JWT 15 min + Magic Link + Matrice Permessi Sezioni).

### 🔑 Tabella Credenziali di Accesso Ufficiali

| Ruolo Attore | Email Registrata | Password di Accesso | Tipo Accesso |
| :--- | :--- | :--- | :--- |
| 👨‍💼 **Advisor Senior** | `joe@bluecode.advisory` | `password123` | JWT Access Token |
| 👑 **Super Admin** | `admin@bluecode.advisory` | `admin2026!` | JWT Access Token |
| 👷 **Operatore Studio** | `operator@bluecode.advisory` | `operator123` | JWT Access Token |
| 🔑 **Cliente Incarico** | `client@holdingbeta.advisory` | *Passwordless* | Magic Link `/portal` |

- **Progetti**: `GET /progetti`, `GET /progetti/:id`, `PUT /progetti/:id/stato-completo` (Persistenza totale moduli, microvoci, checklist passaggi e note operative con audit log)
- **Clienti**: `GET /clienti`, `POST /clienti`, `PUT /clienti/:id` (Salvataggio e recupero completo di tutti i campi ERP, legali, SDI, IBAN, KYC e referentiJson con audit log)
- **Comunicazioni Omnichannel**: `GET /progetti/:id/comunicazioni`, `POST /progetti/:id/comunicazioni` (Messaggistica bidirezionale live Portale Cliente ⇄ Advisor Hub su tabella PostgreSQL `comunicazione_progetto`)
- **Fatturazione & Incassi**: `POST /progetti/:id/fatture` (gestisce sia Fatture `FT` che Note di Credito `NC` con numerazione distinta), `GET /invoices/scadenzario`, `POST /invoices/scadenze/:id/incassi` (Prima Nota) e `GET /invoices/:id/sdi-xml` (Tracciato XML FatturaPA).
- **Contratti Retainer**: `GET /contratti-ricorrenti`, `POST /contratti-ricorrenti` (collegati sia al Cliente che al Progetto specifico).
- **Upload Documenti**: `POST /upload` (riceve base64 e salva in `./uploads/`), `GET /uploads/:filename`
- **Servizi Integrati**:
  - `src/services/otpService.ts`: Gestione codice OTP a tempo (5 min), rate limiting e sigillo crittografico FEA eIDAS UE 910/2014.
  - `src/services/cronService.ts`: Worker automatico background scansione rinnovi UBO Malta, marchi EUIPO e solleciti fatture.
  - `src/services/sdiService.ts`: Trasmissione diretta 1-Click della Fattura Elettronica XML a SdI Agenzia delle Entrate.
  - `src/services/securityScanner.ts`: Validazione Magic-Bytes e sanitizzazione PDF nel Vault Documenti.
  - `src/services/emailService.ts`: Invio email transazionali SMTP Nodemailer (Magic Link & notifica scadenze).
  - `src/services/storageService.ts`: Archiviazione Cloud S3/Supabase Storage con Presigned URL.
  - `src/adapters/prisma/applyRls.ts`: Applicazione automatica delle policy RLS PostgreSQL (`supabase/migrations/20260815_enable_rls.sql`).
  - `.agents/skills/meta-whatsapp-integration/SKILL.md`: Skill e runbook per l'integrazione WhatsApp Business Cloud API & Remote MCP Meta DevTools.
- **Firma FEA & OTP**: `POST /portal/request-otp`, `POST /portal/verify-otp-and-sign` (Sigillo SHA-256 e Timestamp ISO).
- **Cron Scadenze**: `POST /cron/esegui-notifiche-scadenze` (Scansione UBO, KYC, fatture e solleciti automatici).
- **Telegram Bot Webhook**: `POST /webhooks/communications/telegram`, `POST /tenant/telegram-webhook-setup` (Ingestion live nei progetti).
- **Trasmissione SDI 1-Click**: `POST /invoices/:id/trasmetti-sdi` (Invio diretto e tracciatura SdI).
- **Articoli & Listino**: `GET /articoli`, `POST /articoli`, `PATCH /articoli/:id` (Modifica Prezzo & Ore Admin)
- **Document Studio & Template Contratti**: `GET /documenti-template`, `POST /documenti-template`, `PUT /documenti-template/:id`, `DELETE /documenti-template/:id` (Salvataggio modelli con Smart Tags ERP)

---

## 🗄 3. Database Schema (`prisma/schema.prisma`)

- **`Tenant`**: Dati studio, Sede Legale, Sede Operativa, P.IVA, Logo URL, Colore Tema PDF.
- **`Cliente`**: Dati ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC, `referentiJson`.
- **`ComunicazioneProgetto`**: `progettoId`, `canale` (`email`, `whatsapp`, `telegram`, `signal`), `mittente`, `direzione` (`entrata`, `uscita`), `testo`, `allegatiJson`.
- **`ContrattoRicorrente`**: `clienteId`, `progettoId` (opzionale con FK), `frequenza`, `importoCentesimi`, `prossimaFatturazione`.
- **`ModelloDocumentoCustom`**: `tenantId`, `titolo`, `categoria`, `descrizione`, `contenutoHtml` (persistenza template Word-like studio).
- **`PermessoModulo`**: Matrice isolata per `tenantId`, `userId`, `moduloChiave` con livello (`denied` | `read` | `write`).
- **`Fattura`**: `tipoDocumento` (`fattura` | `nota_credito`), `serie` (`FT` | `NC`), `numeroProgressivoSerie`, `causaNotaCredito`.
- **`PassaggioProgetto`**: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY AGENT & DEV RULES)

1. **Isolamento Multi-Tenant Tassativo (`tenant_id`)**:
   - I dati tra i vari Tenant/Studi **NON SI DEVONO ASSOLUTAMENTE MISCHIARE**.
   - Ogni query, rotta API e tabella PostgreSQL **DEVE essere rigorosamente isolata** tramite `tenant_id` ed a livello database con PostgreSQL Row-Level Security (RLS).

2. **Sincronizzazione Schema Database & Persistenza Cloud Obbligatoria (Prisma & Fastify DB)**:
   - **TUTTO QUELLO CHE VIENE AGGIUNTO O MODIFICATO NELL'INTERFACCIA E NEI MODULI (spunte, passaggi, microvoci, note, scadenze, assegnazioni operatori, clienti, comunicazioni) DEVE ESSERE TASSATIVAMENTE SALVABILE E COLLEGATO AL DATABASE POSTGRESQL/PRISMA VIA API FASTIFY.**
   - **NON POSSIAMO PERMETTERCI DI PERDERE DATI.** Ogni stato o azione deve persistere su Database Server in modo che, spegnendo il PC o collegandosi da qualsiasi altra postazione/dispositivo, lo storico rimanga al 100% integro ed accessibile.
   - Ogni nuova funzionalità o campo form aggiunto **DEVE essere istantaneamente mappato** in `prisma/schema.prisma` ed allineato al backend. NESSUN dato deve essere mantenuto solo in RAM o registrato solo temporaneamente.
   - Eseguire sempre `npx prisma generate` ad ogni variazione dello schema.

3. **Aggiornamento Documentazione Markdown (`.md`)**:
   - Dopo ogni modifica importante, refactoring o cambio codice, tutti i file di documentazione (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) **DEVONO essere tassativamente aggiornati ed allineati**.

4. **Aggiornamento Mappa Grafo (Graphify)**:
   - Dopo modifiche strutturali ai moduli o ai servizi, eseguire `graphify extract . --code-only` e `graphify cluster-only .` per mantenere la mappa delle dipendenze di codice e la documentazione architettonica sempre sincronizzate.
