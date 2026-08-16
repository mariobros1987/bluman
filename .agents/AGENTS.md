# BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo

Questo file serve come indice rapido per l'IA ed i collaboratori per identificare i file responsabili ed evitare scansioni complete dell'intera codebase.

---

## 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`)

- **`pages/Dashboard.tsx`**: Dashboard principale con KPI portafoglio, avvisi ritardo e progetti in corso.
- **`pages/ClientsPage.tsx`**: Anagrafica Clienti ERP, filtraggio, Magic Link passwordless e modal `AnagraficaErpModal`.
- **`pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Attività Studio (Vista Mese, Lista Scadenzario, Filtro Categorie e Modal Nuovo Evento).
- **`pages/ProjectDetail.tsx`**: Vista dettagliata del progetto con tab:
  - `🗂 Moduli & Microvoci`
  - `🕸 Grafo & Dipendenze Moduli` (`GrafoModuliProgettoView`)
  - `💶 Fatturazione & SDI` (`FatturazioneTab` con Fatture FT e Note di Credito NC)
- **`pages/Library.tsx`**: Gestione Distinta Base, Costruttore Moduli Template, Catalogo Articoli e Modelli Documenti in Bianco.
- **`pages/ClientPortal.tsx`**: Portale Cliente a 5 schede (Proposta & Firma 1-Click, Live Progress, Form Societari, Documenti, Contatti Advisor).
- **`pages/SettingsPage.tsx`**: Anagrafica Studio, Sede Legale/Operativa, Configuratore PDF Fatture con Logo ed Anteprima Live.
- **`pages/SuperAdminPage.tsx`**: Dashboard Super Admin & Gestione Multi-Tenant Studi (`/admin/tenants`).
- **`pages/AuditLogPage.tsx`**: Registro Audit Super Dettagliato & Tracciamento Attività Operatori per Tenant (`/audit`).

---

## 🔌 2. API Backend Fastify (`src/server.ts`) & API Client (`frontend/src/api/client.ts`)

- **Autenticazione RBAC**: `POST /auth/login`, `POST /auth/magic-login`, `GET /auth/me` (Token JWT 15 min + Magic Link).

### 🔑 Tabella Credenziali di Accesso Ufficiali

| Ruolo Attore | Email Registrata | Password di Accesso | Tipo Accesso |
| :--- | :--- | :--- | :--- |
| 👨‍💼 **Advisor Senior** | `joe@bluecode.advisory` | `password123` | JWT Access Token |
| 👑 **Super Admin** | `admin@bluecode.advisory` | `admin2026!` | JWT Access Token |
| 👷 **Operatore Studio** | `operator@bluecode.advisory` | `operator123` | JWT Access Token |
| 🔑 **Cliente Incarico** | `client@holdingbeta.advisory` | *Passwordless* | Magic Link `/portal` |

- **Autenticazione RBAC**: `POST /auth/login`, `POST /auth/magic-login`, `GET /auth/me` (Token JWT 15 min + Magic Link).
- **Progetti**: `GET /progetti`, `GET /progetti/:id`
- **Clienti**: `GET /clienti`, `POST /clienti`
- **Fatturazione & Incassi**: `POST /progetti/:id/fatture` (gestisce sia Fatture `FT` che Note di Credito `NC` con numerazione distinta), `GET /invoices/scadenzario`, `POST /invoices/scadenze/:id/incassi` (Prima Nota) e `GET /invoices/:id/sdi-xml` (Tracciato XML FatturaPA).
- **Upload Documenti**: `POST /upload` (riceve base64 e salva in `./uploads/`), `GET /uploads/:filename`
- **Servizi Integrati**:
  - `src/services/emailService.ts`: Invio email transazionali SMTP Nodemailer (Magic Link & notifica scadenze).
  - `src/services/storageService.ts`: Archiviazione Cloud S3/Supabase Storage con Presigned URL.
  - `src/adapters/prisma/applyRls.ts`: Applicazione automatica delle policy RLS PostgreSQL (`supabase/migrations/20260815_enable_rls.sql`).
- **Articoli & Listino**: `GET /articoli`, `POST /articoli`, `PATCH /articoli/:id` (Modifica Prezzo & Ore Admin)

---

## 🗄 3. Database Schema (`prisma/schema.prisma`)

- **`Tenant`**: Dati studio, Sede Legale, Sede Operativa, P.IVA, Logo URL, Colore Tema PDF.
- **`Cliente`**: Dati ERP, Partita IVA, Codice Fiscale, Sede Legale, Codice SDI, IBAN, Rischio AML, UBO, Fonte Patrimonio, Data KYC.
- **`Fattura`**: `tipoDocumento` (`fattura` | `nota_credito`), `serie` (`FT` | `NC`), `numeroProgressivoSerie`, `causaNotaCredito`.
- **`PassaggioProgetto`**: `noteOperatoreJson`, `richiedeFirmaCliente`, `documentoAllegatoUrl`.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY AGENT & DEV RULES)

1. **Isolamento Multi-Tenant Tassativo (`tenant_id`)**:
   - I dati tra i vari Tenant/Studi **NON SI DEVONO ASSOLUTAMENTE MISCHIARE**.
   - Ogni query, rotta API e tabella PostgreSQL **DEVE essere rigorosamente isolata** tramite `tenant_id` ed a livello database con PostgreSQL Row-Level Security (RLS).

2. **Sincronizzazione Schema Database & Persistenza Cloud Obbligatoria (Prisma & Fastify DB)**:
   - **TUTTO QUELLO CHE VIENE AGGIUNTO O MODIFICATO NELL'INTERFACCIA E NEI MODULI (spunte, passaggi, microvoci, note, scadenze, assegnazioni operatori) DEVE ESSERE TASSATIVAMENTE SALVABILE E COLLEGATO AL DATABASE POSTGRESQL/PRISMA VIA API FASTIFY.**
   - **NON POSSIAMO PERMETTERCI DI PERDERE DATI.** Ogni stato o azione deve persistere su Database Server in modo che, spegnendo il PC o collegandosi da qualsiasi altra postazione/dispositivo, lo storico rimanga al 100% integro ed accessibile.
   - Ogni nuova funzionalità o campo form aggiunto **DEVE essere istantaneamente mappato** in `prisma/schema.prisma` ed allineato al backend. NESSUN dato deve essere mantenuto solo in RAM o registrato solo temporaneamente.
   - Eseguire sempre `npx prisma generate` ad ogni variazione dello schema.

3. **Aggiornamento Documentazione Markdown (`.md`)**:
   - Dopo ogni modifica importante, refactoring o cambio codice, tutti i file di documentazione (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) **DEVONO essere tassativamente aggiornati ed allineati**.

4. **Aggiornamento Mappa Grafo (Graphify)**:
   - Dopo modifiche strutturali ai moduli o ai servizi, eseguire `graphify update . --code-only` per mantenere la mappa delle dipendenze di codice e la documentazione architettonica sempre sincronizzate.
