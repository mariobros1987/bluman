# BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo

Questo file serve come indice rapido per l'IA ed i collaboratori per identificare i file responsabili ed evitare scansioni complete dell'intera codebase.

---

## 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`)

- **`pages/Dashboard.tsx`**: Dashboard principale con KPI portafoglio, avvisi ritardo e progetti in corso.
- **`pages/Projects.tsx`**: Gestione Avanzata Progetti & Fascicoli Operativi con 3 viste switchabili (Schede Operatore con consuntivazione ore & checklist microvoci, Tabella ERP Matrice ad alta densità, Kanban Pipeline a 4 fasi di workflow) e Executive KPI Strip.
- **`pages/ClientsPage.tsx`**: Anagrafica Clienti ERP con salvataggio bidirezionale completo, disimballo campi `referentiJson`, Magic Link passwordless e modal `AnagraficaErpModal` a 4 schede.
- **`pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Attività Studio (Vista Mese, Lista Scadenzario, Filtro Categorie e Modal Nuovo Evento).
- **`components/QuickTimeTracker.tsx`**: Timer orario fluttuante (Stopwatch 1-Click) integrato nella topbar con selezione rapida commessa/microvoce, calcolo automatico tariffa oraria e consuntivazione immediata a database.
- **`utils/zipBuilder.ts`**: Modulo ZIP client-side autonomo a zero dipendenze per l'esportazione in 1-Click del fascicolo digitale completo in cartelle ordinate (`/01_Contratti`, `/02_Societario`, `/03_KYC`, `/04_Fatture`, `INDICE_FASCICOLO.txt`).
- **`pages/ProjectDetail.tsx`**: Vista dettagliata del progetto con tab:
  - `🗂 Moduli & Microvoci` (Checklist passaggi, note operative, consuntivazione ore e notifiche milestone automatiche via WhatsApp/Email)
  - `🕸 Grafo & Dipendenze Moduli` (`GrafoModuliProgettoView`)
  - `💬 Comunicazioni & Ingestion Hub` (`ComunicazioniTab` con sincronizzazione live, chat interattiva e binding recapiti WhatsApp, Email, Telegram, Signal dall'Anagrafica Cliente ERP)
  - `💶 Fatturazione & SDI` (Emissione FT/NC e tracciato XML)
  - `📊 Redditività & Margini` (Analisi Margine Lordo Commessa, Semaforo Budget Live, Resa Oraria Reale ed Export Rendiconto Economico CSV)
  - `📄 Documenti & Vault Legale` (Cloud Vault Google Drive Style ed Export Fascicolo Completo ZIP 1-Click)
- **`pages/InvoicesPage.tsx`**: Registro Fiscale Fatture, Note di Credito, Aliquote, Export XML SDI ed **Export Registro Fiscale per Commercialista (CSV / Excel)**.
- **`pages/PrimaNotaPage.tsx`**: Registro Prima Nota, Transazioni Cassa/Banca, CRO/TRN, Import & Riconciliazione Estratto Conto Bancario ed **Export Contabile Commercialista (CSV / Excel)** compatibile con Zucchetti, TeamSystem, Datev e Profis.
- **`pages/ScadenzarioPage.tsx`**: Scadenzario Incassi, Partite Aperte & Solleciti Clienti con Link al Progetto.
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

### 🔑 Accesso & Gerarchia dei Ruoli (§2bis, §23)

**Non esistono credenziali precaricate e non vanno reintrodotte.** Fino alla Fase 0
`src/server.ts` conteneva una tabella di sette utenti con password nel sorgente
(`joe@…`/`password123`, `admin@…`/`admin2026!` …) e accettava qualunque password come
jolly: chiunque leggesse il repository pubblico poteva autenticarsi in produzione. La
tabella che stava qui elencava proprio quelle coppie, in violazione della regola 5 più in
basso. L'unica fonte di verità è ora la tabella `user` del database.

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
- `src/server.test.ts` ha un test di regressione che rifiuta ognuna delle otto vecchie
  coppie email/password: se torna verde per una di esse, la falla è stata reintrodotta.

- **Progetti**: `GET /progetti`, `GET /progetti/:id`, `PUT /progetti/:id/stato-completo` (Persistenza totale moduli, microvoci, checklist passaggi e note operative con audit log)
- **Clienti**: `GET /clienti`, `POST /clienti`, `PUT /clienti/:id` (Salvataggio e recupero completo di tutti i campi ERP, legali, SDI, IBAN, KYC e referentiJson con audit log)
- **Comunicazioni Omnichannel**: `GET /progetti/:id/comunicazioni`, `POST /progetti/:id/comunicazioni` (Messaggistica bidirezionale live Portale Cliente ⇄ Advisor Hub su tabella PostgreSQL `comunicazione_progetto`, con invio email reale Nodemailer SMTP Register.it e WhatsApp Cloud API)
- **Fatturazione & Incassi**: `POST /progetti/:id/fatture` (gestisce sia Fatture `FT` che Note di Credito `NC` con numerazione distinta), `GET /invoices/scadenzario`, `POST /invoices/scadenze/:id/incassi` (Prima Nota) e `GET /invoices/:id/sdi-xml` (Tracciato XML FatturaPA).
- **Contratti Retainer**: `GET /contratti-ricorrenti`, `POST /contratti-ricorrenti` (collegati sia al Cliente che al Progetto specifico).
- **Upload Documenti**: `POST /upload` (riceve base64 e salva in `./uploads/`), `GET /uploads/:filename`
- **Servizi Integrati**:
  - `prisma/seed.ts`: Script di seed master completo e idempotente per popolare Supabase/PostgreSQL (7 utenti studio, 5 giurisdizioni, 45 articoli distinta base, 10 moduli template e clienti ERP).
  - `frontend/src/hooks/useTeamMembers.ts`: Hook React centralizzato e performante per interrogare gli operatori live dal database via API `GET /tenant/utenti` con calcolo dinamico delle iniziali reali (`MD`, `JD`, `LM`, `ER`, `FD`) e supporto personalizzazione colori.
  - `frontend/src/utils/reorganizationTemplates.ts`: Collezione di 22 modelli contrattuali e verbali Word per operazioni di riorganizzazione societaria (Cessioni quote, trasformazioni, holding, trust, conferimenti) integrati nativamente in Document Studio con Smart Tags ERP.
  - `frontend/src/components/ui/Avatar.tsx`: Componente avatar fluttuante con iniziali operatore e card di anteprima (nome completo, ruolo, punto di stato) al passaggio del mouse (hover).
  - `api/send-email.ts`: Vercel Serverless Function ultra-rapida con Nodemailer per invio test SMTP, inviti collaboratori con credenziali e comunicazioni live fascicolo a clienti.
  - `frontend/src/utils/rbac.ts`: Motore di sicurezza e controllo accessi RBAC granulare a 12 moduli (filtra Sidebar e Route Guards per moduli `denied` / `read` / `write`).
  - `src/scripts/backupDb.ts`: Script di backup e snapshot JSON di tutte le tabelle del database BluMan multi-tenant.
  - `src/scripts/verifyAll.ts`: Test runner completo per il collaudo automatico della test suite end-to-end (11/11 test).
  - `.github/workflows/ci.yml`: Workflow di Continuous Integration GitHub Actions per build e test automatici ad ogni push.
  - `src/services/otpService.ts`: Gestione codice OTP a tempo (5 min), rate limiting e sigillo crittografico FEA eIDAS UE 910/2014.
  - `src/services/cronService.ts`: Worker automatico background scansione rinnovi UBO Malta, marchi EUIPO e solleciti fatture.
  - `src/services/sdiService.ts`: Trasmissione diretta 1-Click della Fattura Elettronica XML a SdI Agenzia delle Entrate.
  - `src/services/securityScanner.ts`: Validazione Magic-Bytes e sanitizzazione PDF nel Vault Documenti.
  - `src/services/emailService.ts`: Invio email transazionali SMTP Nodemailer (Magic Link, notifica scadenze e test socket Register.it).
  - `src/services/storageService.ts`: Archiviazione Cloud S3/Supabase Storage con Presigned URL.
  - `src/util/prismaClient.ts`: I tre client Prisma e il contesto tenant per richiesta (§14). `prisma` è il client applicativo: impone `app.current_tenant_id` a ogni query, così le policy RLS hanno qualcosa su cui filtrare. `prismaAmministrativo()` scavalca RLS e va usato **solo** per script, seed, bootstrap, backup e la ricerca dell'utente per email al login. `conContestoInTransazione()` reimposta la variabile dentro una transazione interattiva, che gira su una connessione propria.
  - `supabase/migrations/20260819_rls_effettiva.sql`: Ruolo `bluman_app` (senza `BYPASSRLS`), policy `isolamento_tenant` su tutte le tabelle, `FORCE ROW LEVEL SECURITY`. Si applica con `psql` (usa `\gexec` per non stampare la password). Sostituisce `20260815_enable_rls.sql`, che era inerte: `src/adapters/prisma/applyRls.ts` ora si rifiuta di eseguire quel file perché le sue policy PERMISSIVE si sommerebbero in OR a quelle nuove, vanificandole.
  - `src/scripts/checkRls.ts`: Diagnostica read-only dell'isolamento reale — ruolo di connessione, `bypassrls`, RLS attivo/forzato per tabella e prova pratica con un tenant inesistente (deve restituire 0 righe).
  - `.agents/skills/meta-whatsapp-integration/SKILL.md`: Skill e runbook per l'integrazione WhatsApp Business Cloud API & Remote MCP Meta DevTools.
- **Firma FEA & OTP**: `POST /portal/request-otp`, `POST /portal/verify-otp-and-sign` (Sigillo SHA-256 e Timestamp ISO).
- **Cron Scadenze**: `POST /cron/esegui-notifiche-scadenze` (Scansione UBO, KYC, fatture e solleciti automatici).
- **Telegram Bot Webhook**: `POST /webhooks/communications/telegram`, `POST /tenant/telegram-webhook-setup` (Ingestion live nei progetti).
- **Trasmissione SDI 1-Click**: `POST /invoices/:id/trasmetti-sdi` (Invio diretto e tracciatura SdI).
- **Articoli & Listino**: `GET /articoli`, `POST /articoli`, `PATCH /articoli/:id` (Modifica Prezzo & Ore Admin)
- **Document Studio & Template Contratti**: `GET /documenti-template`, `POST /documenti-template`, `PUT /documenti-template/:id`, `DELETE /documenti-template/:id` (Salvataggio modelli con Smart Tags ERP)

---

## 🗄 3. Database Schema (`prisma/schema.prisma`)

- **`Tenant`**: Dati studio, Sede Legale, Sede Operativa, P.IVA, Logo URL, Colore Tema PDF, credenziali SMTP (`smtp_pass`) e IMAP (`imap_pass`) isolate per tenant.
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
   - Il filtro applicativo su `tenant_id` **non basta e non è la difesa**: è RLS che lo è. Il runtime si connette col ruolo `bluman_app`, che non può scavalcare le policy, e il contesto tenant viene impostato per ogni richiesta dall'hook `onRequest` di `src/server.ts`. Non usare `new PrismaClient()` in codice che serve una richiesta HTTP: usa `prisma` da `src/util/prismaClient.ts`, altrimenti la query parte senza contesto e non vede nulla.
   - `prismaAmministrativo()` scavalca RLS. È ammesso solo in script di manutenzione, seed, bootstrap, backup e nella ricerca dell'utente per email al login (dove il tenant si scopre proprio da quella riga). **Ogni altro uso riapre esattamente il buco che le policy chiudono.**
   - Verifica sul database reale: `npx tsx src/scripts/checkRls.ts`.

2. **Migrazioni Versionate, Mai `db push` su Dati Reali**:
   - Lo schema si cambia con `prisma migrate dev` in sviluppo e `prisma migrate deploy` in produzione, mai con `prisma db push --accept-data-loss`: quest'ultimo riallinea il database al file cancellando in silenzio colonne e tabelle non presenti. Era il comando di avvio del container su Railway.
   - Le migrazioni girano su `DIRECT_URL` (ruolo proprietario dello schema); il server usa `DATABASE_URL` (ruolo `bluman_app`, che non ha `CREATE` su `public` di proposito).

3. **Sincronizzazione Schema Database & Persistenza Cloud Obbligatoria (Prisma & Fastify DB)**:
   - **TUTTO QUELLO CHE VIENE AGGIUNTO O MODIFICATO NELL'INTERFACCIA E NEI MODULI (spunte, passaggi, microvoci, note, scadenze, assegnazioni operatori, clienti, comunicazioni) DEVE ESSERE TASSATIVAMENTE SALVABILE E COLLEGATO AL DATABASE POSTGRESQL/PRISMA VIA API FASTIFY.**
   - **NON POSSIAMO PERMETTERCI DI PERDERE DATI.** Ogni stato o azione deve persistere su Database Server in modo che, spegnendo il PC o collegandosi da qualsiasi altra postazione/dispositivo, lo storico rimanga al 100% integro ed accessibile.
   - Ogni nuova funzionalità o campo form aggiunto **DEVE essere istantaneamente mappato** in `prisma/schema.prisma` ed allineato al backend. NESSUN dato deve essere mantenuto solo in RAM o registrato solo temporaneamente.
   - Eseguire sempre `npx prisma generate` ad ogni variazione dello schema.

4. **Aggiornamento Documentazione Markdown (`.md`)**:
   - Dopo ogni modifica importante, refactoring o cambio codice, tutti i file di documentazione (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) **DEVONO essere tassativamente aggiornati ed allineati**.

5. **Aggiornamento Mappa Grafo (Graphify)**:
   - Dopo modifiche strutturali ai moduli o ai servizi, eseguire `graphify extract . --code-only` e `graphify cluster-only .` per mantenere la mappa delle dipendenze di codice e la documentazione architettonica sempre sincronizzate.

6. **Divieto Assoluto di Esposizione Credenziali su GitHub & Persistenza Isolata su DB Tenant**:
   - **NESSUNA credenziale reale (password email SMTP/IMAP, token segreti, chiavi API o password di database) deve MAI essere scritta in chiaro nel codice versionato su GitHub o nei file `.md`**.
   - Tutte le password e credenziali dello studio DEVONO risiedere rigorosamente nel Database PostgreSQL collegate al singolo `Tenant` (`prisma.tenant.smtpPass`, `prisma.tenant.imapPass`, ecc.) e gestite in modo protetto via API (`PUT /tenant/settings`).
   - L'isolamento multi-tenant garantisce che uno studio non possa in alcun modo visualizzare né accedere ai dati, alla posta o ai contratti di un altro studio.

