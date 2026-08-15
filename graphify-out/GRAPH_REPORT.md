# Graph Report - bluman-api  (2026-08-15)

## Corpus Check
- 86 files · ~104,565 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 847 nodes · 1511 edges · 55 communities (46 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `761ff785`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- istanziazionePort.ts
- esecuzione.ts
- inMemoryApp.ts
- PrismaApp
- LoginPage.tsx
- plugins
- BluMan Advisory Platform — Analisi Professionale & Piano Esecutivo
- buildServer
- compilerOptions
- scripts
- compilerOptions
- dependencies
- BluMan_specifica_di_sviluppo_v2.3_6ca9437e.md
- InMemoryApp
- compilerOptions
- PassaggioModal.tsx
- NewProjectWizard
- client.ts
- 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti
- 🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC
- utils/index.ts
- Placeholders.tsx
- frontend/tsconfig.json
- seedFull.ts
- 🎯 Stato del Progetto & Componenti Verificati
- 🎯 Stato di Avanzamento Fasi (Aggiornato)
- 5. Caso di studio: trasferimento/costituzione di una struttura societaria internazionale
- 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)
- BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo
- 16. Motore di calcolo stati
- 17. API — Fase 2-4 (esecuzione, procedura guidata, documenti)
- ConfirmDeleteModal.tsx
- React + TypeScript + Vite
- 15. API — Fase 0-1 (pre-progetto → progetto attivo)
- 7. Regole di calcolo (da implementare come logica di dominio, non come dato statico)
- applyRls.ts
- ProjectDetail.tsx
- App.tsx
- Avatar.tsx
- AppLayout.tsx
- Library.tsx
- istanziaProgetto.ts
- PrismaIstanziazionePort
- FakeIstanziazionePort
- 🟢 1. WhatsApp Business API (Official Meta Cloud API)
- ClientPortal.tsx
- ModuloTemplateConDistinta
- IstanziazioneTransazione
- downloadRealPdf
- teamAnalytics.test.ts
- antiDuplication.test.ts
- giurisdizioni.test.ts
- catalogDocumentLinkage.test.ts

## God Nodes (most connected - your core abstractions)
1. `buildServer()` - 39 edges
2. `PrismaApp` - 37 edges
3. `InMemoryApp` - 33 edges
4. `AppPort` - 33 edges
5. `react` - 29 edges
6. `fmt()` - 27 edges
7. `FakeIstanziazionePort` - 19 edges
8. `compilerOptions` - 18 edges
9. `PrismaIstanziazionePort` - 16 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `ClientPortal()` --calls--> `fetchProgetti()`  [EXTRACTED]
  frontend/src/pages/ClientPortal.tsx → frontend/src/api/client.ts
- `AssegnaModuloClienteModal()` --calls--> `fetchProgetti()`  [EXTRACTED]
  frontend/src/pages/Library.tsx → frontend/src/api/client.ts
- `LibreriaDocumentiEForm()` --calls--> `fetchProgetti()`  [EXTRACTED]
  frontend/src/pages/Library.tsx → frontend/src/api/client.ts
- `ClientPortal()` --calls--> `fetchModuliLibreria()`  [EXTRACTED]
  frontend/src/pages/ClientPortal.tsx → frontend/src/api/client.ts
- `NewProjectWizard()` --calls--> `fetchGiurisdizioniApi()`  [EXTRACTED]
  frontend/src/components/NewProjectWizard.tsx → frontend/src/api/client.ts

## Import Cycles
- None detected.

## Communities (55 total, 9 thin omitted)

### Community 0 - "istanziazionePort.ts"
Cohesion: 0.21
Nodes (11): StatoModulo, DbState, ModuloStored, PassaggioStored, ModuloConDipendenzeRuntime, ModuloRecord, NuovaMicrovoceProgettoInput, NuovoModuloProgettoInput (+3 more)

### Community 1 - "esecuzione.ts"
Cohesion: 0.10
Nodes (32): calcolaPercentualeMicrovoce(), calcolaPercentualeModulo(), calcolaPercentualeProgetto(), calcolaStatoModulo(), calcolaStatoProgetto(), marcaRitardoManuale(), ModuloConDipendenze, registraConsuntivazione() (+24 more)

### Community 2 - "inMemoryApp.ts"
Cohesion: 0.14
Nodes (20): ClienteNonTrovatoError, ModuloNonTrovatoError, PreventivoNonTrovatoError, ProgettoNonTrovatoError, TransizioneNonValidaError, Cliente, Preventivo, Progetto (+12 more)

### Community 3 - "PrismaApp"
Cohesion: 0.06
Nodes (7): app, porta, prisma, server, PrismaApp, Cliente, Preventivo

### Community 4 - "LoginPage.tsx"
Cohesion: 0.60
Nodes (4): loginApi(), LoginPage(), LoginPageProps, roleBtnStyle()

### Community 5 - "plugins"
Cohesion: 0.22
Nodes (8): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, typescript, warn

### Community 6 - "BluMan Advisory Platform — Analisi Professionale & Piano Esecutivo"
Cohesion: 0.04
Nodes (44): 10. Primo Passo Concreto, 1. Contesto e Perimetro, 2. Stato Attuale del Codice, 3. Il Processo Produttivo Completo — Creazione/Spostamento di un'Azienda, 4. Architettura Tecnica Scelta, 5. Piano di Sviluppo Esecutivo — Ordine di Priorità, 6. Diagramma del Flusso Progetto, 7. Decisioni da Confermare Prima di Procedere (+36 more)

### Community 7 - "buildServer"
Cohesion: 0.07
Nodes (15): main(), prisma, start(), buildServer(), recordAudit(), AppPort, createTransporter(), EmailOptions (+7 more)

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (37): dotenv, fastify, @fastify/cors, nodemailer, dependencies, dotenv, fastify, @fastify/cors (+29 more)

### Community 10 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 11 - "dependencies"
Cohesion: 0.05
Nodes (39): dependencies, html2canvas, jspdf, react, react-dom, react-router-dom, @supabase/supabase-js, @types/jspdf (+31 more)

### Community 12 - "BluMan_specifica_di_sviluppo_v2.3_6ca9437e.md"
Cohesion: 0.06
Nodes (30): 10. Architettura tecnica di massima (per lo sviluppo), 11. Decisioni architetturali prese, 12. Fatturazione flessibile — dettaglio, 13. Roadmap di sviluppo proposta, 14. Schema database proposto, 18. API — Fatturazione, 19. Permessi granulari, 1. Obiettivo del documento (+22 more)

### Community 14 - "compilerOptions"
Cohesion: 0.12
Nodes (16): src/adapters/prisma, compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+8 more)

### Community 15 - "PassaggioModal.tsx"
Cohesion: 0.18
Nodes (13): closeBtnStyle, DocumentoEntry, getDefaultPassaggi(), headStyle, modalStyle, NoteEntry, overlayStyle, PassaggioModal() (+5 more)

### Community 16 - "NewProjectWizard"
Cohesion: 0.27
Nodes (10): creaClienteApi(), creaPreventivoEAccettaApi(), creaProgettoApi(), fetchClienti(), NewProjectWizard(), ClientPortal(), AnagraficaErpModal(), ClientsPage() (+2 more)

### Community 17 - "client.ts"
Cohesion: 0.14
Nodes (21): API_BASE, createAuditLogApi(), creaUtenteTenantApi(), fetchAuditLogsApi(), fetchComunicazioniApi(), fetchGiurisdizioniApi(), fetchNotificheApi(), fetchTenantInfoApi() (+13 more)

### Community 18 - "📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti"
Cohesion: 0.12
Nodes (15): 🟢 1. WhatsApp Business API (Official Meta Cloud API), ✈️ 2. Telegram Bot API (100% Gratuito), ✉️ 3. Email Inbound Webhook Parse (SendGrid / SMTP / PEC), 🔒 4. Signal End-to-End Encrypted (Clienti VIP), A. Configurazione Inbound Parse, A. Creare il Bot dello Studio con @BotFather, A. Ottenere le Credenziali da Meta Developers, A. Setup Daemon REST API (+7 more)

### Community 19 - "🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC"
Cohesion: 0.18
Nodes (10): 1. Prerequisiti, 2. Installazione sul NUOVO PC, 3. Avvio dei Server, 4. Connessione a Supabase PostgreSQL via CLI (Produzione), 🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC, Opzione A: Da Repository GitHub (Consigliato), Opzione B: Da archivio ZIP (`bluman-api-backup.zip`), Step 1: Avvia il Backend Fastify API (:3000) (+2 more)

### Community 20 - "utils/index.ts"
Cohesion: 0.13
Nodes (22): closeBtnStyle, labelStyle, NewProjectWizardProps, overlayStyle, wizStyle, ARTICOLI, GIURISDIZIONI, MLIB (+14 more)

### Community 25 - "🎯 Stato del Progetto & Componenti Verificati"
Cohesion: 0.14
Nodes (13): 📋 Anagrafica Master Cliente ERP (4 Schede), 🗄 Archiviazione & Eliminazione Sicura, 🔍 AUDIT SCHIETTO: Cosa Manca per la Produzione A-Z (Enterprise Checklist), 🏛 BluMan Advisory Platform — Architettura & Guida Produzione, 🔑 Credenziali Ufficiali di Accesso (Ruoli Staff & Cliente), 💶 Fatturazione & Note di Credito (Numerazione Sequenziale Distinta), 👥 Gestione Team & Timesheet Live Operatori (`/settings`), 🕸 Grafo & Dipendenze Moduli nel Progetto (+5 more)

### Community 26 - "🎯 Stato di Avanzamento Fasi (Aggiornato)"
Cohesion: 0.25
Nodes (7): BluMan — Piano di Sviluppo & Stato Avanzamento Produzione, 🔍 Checklist per il Rilascio in Produzione A-Z (Enterprise Readiness), FASE 0 — Setup e Fondamenta Progetto, FASE 1 — Schema Database PostgreSQL & Prisma (`prisma/schema.prisma`), FASE 2 — Autenticazione RBAC & Permessi Attori (§2bis, §23), FASE 2 — Frontend UI & Portale Cliente Passwordless, 🎯 Stato di Avanzamento Fasi (Aggiornato)

### Community 27 - "5. Caso di studio: trasferimento/costituzione di una struttura societaria internazionale"
Cohesion: 0.25
Nodes (8): 5. Caso di studio: trasferimento/costituzione di una struttura societaria internazionale, FASE 0 — Pre-progetto, FASE 1 — Setup del progetto, FASE 2 — Esecuzione, FASE 3 — Monitoraggio in tempo reale, FASE 4 — Comunicazione e portale cliente, FASE 5 — Fatturazione, FASE 6 — Chiusura

### Community 28 - "🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)"
Cohesion: 0.25
Nodes (7): 1. Configurazione Variabile `.env` Database URL:, 2. Collegamento Supabase CLI & Migrazioni Prisma:, ⚙️ Comandi di Avvio sul Nuovo PC, ⚡ Connessione Diretta a Supabase tramite CLI & Prisma (IMPORTANTISSIMO), 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC), 🏛 Mappa Architetturale Rapida, 📋 PROMPT DA COPIARE ED INCOLLARE ALLA NUOVA IA:

### Community 29 - "BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo"
Cohesion: 0.29
Nodes (6): 🏛 1. Mappa dei Componenti Frontend (`frontend/src/`), 🔌 2. API Backend Fastify (`src/server.ts`) & API Client (`frontend/src/api/client.ts`), 🗄 3. Database Schema (`prisma/schema.prisma`), BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo, 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY AGENT & DEV RULES), 🔑 Tabella Credenziali di Accesso Ufficiali

### Community 30 - "16. Motore di calcolo stati"
Cohesion: 0.29
Nodes (7): 16.1 Funzioni sulla micro-voce, 16.2 Funzioni sul modulo (aggregazione dalle sue micro-voci), 16.3 Funzioni sul progetto, 16.4 Trigger — quando il motore viene invocato, 16.5 Risoluzione delle dipendenze — lo sblocco a cascata, 16.6 Un punto da tenere a mente per l'implementazione, 16. Motore di calcolo stati

### Community 31 - "17. API — Fase 2-4 (esecuzione, procedura guidata, documenti)"
Cohesion: 0.40
Nodes (5): 17.1 Consuntivazione e stato micro-voce, 17.2 Procedura guidata (passaggi), 17.3 Documenti liberi e vista progetto, 17.4 Job schedulato — promemoria passaggi in sospeso, 17. API — Fase 2-4 (esecuzione, procedura guidata, documenti)

### Community 32 - "ConfirmDeleteModal.tsx"
Cohesion: 0.17
Nodes (11): closeBtnStyle, ConfirmDeleteModal(), ConfirmDeleteModalProps, contentStyle, footerStyle, formGroupStyle, headerStyle, modalStyle (+3 more)

### Community 33 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

### Community 34 - "15. API — Fase 0-1 (pre-progetto → progetto attivo)"
Cohesion: 0.50
Nodes (4): 15.1 Regola di scope — da rispettare fin dal primo endpoint, 15.2 Endpoint, 15.3 Cosa succede internamente alla firma dell'engagement letter, 15. API — Fase 0-1 (pre-progetto → progetto attivo)

### Community 35 - "7. Regole di calcolo (da implementare come logica di dominio, non come dato statico)"
Cohesion: 0.67
Nodes (3): 7. Regole di calcolo (da implementare come logica di dominio, non come dato statico), 7bis. Ritardo/blocco — doppio innesco (automatico + manuale), 7ter. Grafo di dipendenze tra moduli

### Community 37 - "ProjectDetail.tsx"
Cohesion: 0.16
Nodes (16): archiviaProgettoApi(), assegnaAccessoProgettoApi(), consuntivaMicrovoceApi(), eliminaProgettoApi(), emettiFatturaApi(), fetchAccessiProgetto(), fetchProgettoDettaglio(), salvaProgettoDettaglioApi() (+8 more)

### Community 38 - "App.tsx"
Cohesion: 0.17
Nodes (17): fetchProgetti(), App(), AvatarGroup(), Badge(), BadgeProps, ProgressBar(), ProgressBarProps, Dashboard() (+9 more)

### Community 39 - "Avatar.tsx"
Cohesion: 0.21
Nodes (10): AssignOperatorModal(), AssignOperatorModalProps, CalendarPreviewModalProps, Avatar(), AvatarGroupProps, AvatarProps, CalendarPage(), EventoStudio (+2 more)

### Community 40 - "AppLayout.tsx"
Cohesion: 0.21
Nodes (10): AppLayoutProps, INITIAL_NOTIFICATIONS, TITLES, NAV, Sidebar(), SidebarProps, NotificationItem, NotificationModal() (+2 more)

### Community 41 - "Library.tsx"
Cohesion: 0.20
Nodes (18): creaArticoloApi(), creaGiurisdizioneApi(), creaModuloTemplateApi(), fetchArticoli(), fetchModuliLibreria(), updateArticoloPrezzoApi(), ArticoliCatalogView(), AssegnaModuloClienteModal() (+10 more)

### Community 42 - "istanziaProgetto.ts"
Cohesion: 0.16
Nodes (10): ConsoleNotificationPort, FakeNotificationPort, calcolaOreModulo(), calcolaPrezzoModulo(), istanziaProgetto(), IstanziaProgettoInput, IstanziaProgettoRisultato, ModuloCreatoInfo (+2 more)

### Community 43 - "PrismaIstanziazionePort"
Cohesion: 0.14
Nodes (3): PrismaIstanziazionePort, IstanziazionePort, StatoMicrovoceIniziale

### Community 44 - "FakeIstanziazionePort"
Cohesion: 0.21
Nodes (5): clonaDb(), FakeIstanziazionePort, nuovoId(), MicrovoceRecord, PassaggioRecord

### Community 45 - "🟢 1. WhatsApp Business API (Official Meta Cloud API)"
Cohesion: 0.22
Nodes (8): 🟢 1. WhatsApp Business API (Official Meta Cloud API), ✈️ 2. Telegram Bot API (100% Gratuito), ✉️ 3. Email Inbound Webhook Parse (SendGrid / SMTP / PEC), A. Creare il Bot dello Studio con @BotFather, A. Ottenere le Credenziali da Meta Developers, B. Configurare il Webhook di Ricezione Messaggi, 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti, C. Associazione Automatica al Progetto Cliente

### Community 46 - "ClientPortal.tsx"
Cohesion: 0.28
Nodes (9): DigitalSignatureModal(), DigitalSignatureModalProps, CatBadge(), CatBadgeProps, ModuloProposta, PortalTab, CategoriaModulo, catCls() (+1 more)

### Community 47 - "ModuloTemplateConDistinta"
Cohesion: 0.22
Nodes (8): main(), prisma, seedModulo(), moduloAnalisiPatrimoniale, moduloCorporateStructuring, nuovoServer(), templateAnalisi, ModuloTemplateConDistinta

### Community 49 - "downloadRealPdf"
Cohesion: 0.38
Nodes (6): fetchTutteFattureStudioApi(), uploadFileApi(), InvoicesPage(), LibreriaDocumentiEForm(), DocumentiTab(), downloadRealPdf()

### Community 50 - "teamAnalytics.test.ts"
Cohesion: 0.40
Nodes (3): Modulo, Progetto, Task

## Knowledge Gaps
- **323 isolated node(s):** `$schema`, `typescript`, `oxc`, `react/rules-of-hooks`, `warn` (+318 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaApp` connect `PrismaApp` to `inMemoryApp.ts`, `PrismaIstanziazionePort`, `buildServer`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `AppPort` connect `buildServer` to `inMemoryApp.ts`, `PrismaApp`, `InMemoryApp`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `react` connect `App.tsx` to `ConfirmDeleteModal.tsx`, `LoginPage.tsx`, `plugins`, `ProjectDetail.tsx`, `Avatar.tsx`, `AppLayout.tsx`, `Library.tsx`, `ClientPortal.tsx`, `PassaggioModal.tsx`, `NewProjectWizard`, `client.ts`, `downloadRealPdf`, `utils/index.ts`, `Placeholders.tsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `buildServer()` (e.g. with `.accettaPreventivoEIstanzia()` and `.archiviaProgetto()`) actually correct?**
  _`buildServer()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `typescript`, `oxc` to the rest of the system?**
  _323 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `esecuzione.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0975177304964539 - nodes in this community are weakly interconnected._
- **Should `inMemoryApp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14039408866995073 - nodes in this community are weakly interconnected._