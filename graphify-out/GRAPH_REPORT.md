# Graph Report - bluman-api  (2026-08-15)

## Corpus Check
- 77 files · ~83,459 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 770 nodes · 1359 edges · 38 communities (30 shown, 8 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dcdad5f1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- istanziazionePort.ts
- esecuzione.ts
- inMemoryApp.ts
- PrismaApp
- ProjectDetail.tsx
- plugins
- BluMan Advisory Platform — Analisi Professionale & Piano Esecutivo
- buildServer
- compilerOptions
- scripts
- compilerOptions
- devDependencies
- BluMan_specifica_di_sviluppo_v2.3_6ca9437e.md
- InMemoryApp
- compilerOptions
- PassaggioModal.tsx
- server.ts
- client.ts
- 📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti
- 🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC
- bootstrap.ts
- Placeholders.tsx
- frontend/tsconfig.json
- seedFull.ts
- 🏛 BluMan Advisory Platform — Architettura & Guida Produzione
- 🎯 Stato di Avanzamento Fasi (Aggiornato)
- 5. Caso di studio: trasferimento/costituzione di una struttura societaria internazionale
- 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)
- BluMan Advisory Platform — Mappa Architetturale & Regole Sviluppo
- 16. Motore di calcolo stati
- 17. API — Fase 2-4 (esecuzione, procedura guidata, documenti)
- server.test.ts
- React + TypeScript + Vite
- 15. API — Fase 0-1 (pre-progetto → progetto attivo)
- 7. Regole di calcolo (da implementare come logica di dominio, non come dato statico)
- applyRls.ts
- src/index.ts

## God Nodes (most connected - your core abstractions)
1. `buildServer()` - 36 edges
2. `PrismaApp` - 34 edges
3. `InMemoryApp` - 30 edges
4. `AppPort` - 30 edges
5. `react` - 27 edges
6. `fmt()` - 21 edges
7. `FakeIstanziazionePort` - 19 edges
8. `compilerOptions` - 18 edges
9. `PrismaIstanziazionePort` - 16 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `start()` --calls--> `buildServer()`  [EXTRACTED]
  src/index.ts → src/server.ts
- `ArticoliCatalogView()` --calls--> `updateArticoloPrezzoApi()`  [EXTRACTED]
  frontend/src/pages/Library.tsx → frontend/src/api/client.ts
- `DigitalSignatureModalProps` --references--> `SignatureData`  [EXTRACTED]
  frontend/src/components/DigitalSignatureModal.tsx → frontend/src/utils/pdfGenerator.ts
- `PassaggioModalProps` --references--> `Progetto`  [EXTRACTED]
  frontend/src/components/PassaggioModal.tsx → frontend/src/types/index.ts
- `CatBadgeProps` --references--> `CategoriaModulo`  [EXTRACTED]
  frontend/src/components/ui/CatBadge.tsx → frontend/src/types/index.ts

## Import Cycles
- None detected.

## Communities (38 total, 8 thin omitted)

### Community 0 - "istanziazionePort.ts"
Cohesion: 0.06
Nodes (36): main(), prisma, seedModulo(), StatoModulo, moduloAnalisiPatrimoniale, moduloCorporateStructuring, setupProgettoConDueModuli(), templateDipendente() (+28 more)

### Community 1 - "esecuzione.ts"
Cohesion: 0.12
Nodes (26): calcolaPercentualeMicrovoce(), calcolaPercentualeModulo(), calcolaPercentualeProgetto(), calcolaStatoModulo(), calcolaStatoProgetto(), marcaRitardoManuale(), ModuloConDipendenze, registraConsuntivazione() (+18 more)

### Community 2 - "inMemoryApp.ts"
Cohesion: 0.15
Nodes (21): ClienteNonTrovatoError, ModuloNonTrovatoError, PreventivoNonTrovatoError, ProgettoNonTrovatoError, TransizioneNonValidaError, Cliente, Preventivo, Progetto (+13 more)

### Community 3 - "PrismaApp"
Cohesion: 0.06
Nodes (4): PrismaApp, PrismaIstanziazionePort, Cliente, Preventivo

### Community 4 - "ProjectDetail.tsx"
Cohesion: 0.05
Nodes (89): assegnaAccessoProgettoApi(), consuntivaMicrovoceApi(), creaClienteApi(), creaModuloTemplateApi(), creaPreventivoEAccettaApi(), creaProgettoApi(), emettiFatturaApi(), fetchArticoli() (+81 more)

### Community 5 - "plugins"
Cohesion: 0.22
Nodes (8): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, oxc, typescript, warn

### Community 6 - "BluMan Advisory Platform — Analisi Professionale & Piano Esecutivo"
Cohesion: 0.04
Nodes (44): 10. Primo Passo Concreto, 1. Contesto e Perimetro, 2. Stato Attuale del Codice, 3. Il Processo Produttivo Completo — Creazione/Spostamento di un'Azienda, 4. Architettura Tecnica Scelta, 5. Piano di Sviluppo Esecutivo — Ordine di Priorità, 6. Diagramma del Flusso Progetto, 7. Decisioni da Confermare Prima di Procedere (+36 more)

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 9 - "scripts"
Cohesion: 0.05
Nodes (37): dotenv, fastify, @fastify/cors, nodemailer, dependencies, dotenv, fastify, @fastify/cors (+29 more)

### Community 10 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 11 - "devDependencies"
Cohesion: 0.05
Nodes (37): dependencies, html2canvas, jspdf, react, react-dom, react-router-dom, @supabase/supabase-js, devDependencies (+29 more)

### Community 12 - "BluMan_specifica_di_sviluppo_v2.3_6ca9437e.md"
Cohesion: 0.06
Nodes (30): 10. Architettura tecnica di massima (per lo sviluppo), 11. Decisioni architetturali prese, 12. Fatturazione flessibile — dettaglio, 13. Roadmap di sviluppo proposta, 14. Schema database proposto, 18. API — Fatturazione, 19. Permessi granulari, 1. Obiettivo del documento (+22 more)

### Community 14 - "compilerOptions"
Cohesion: 0.12
Nodes (16): src/adapters/prisma, compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+8 more)

### Community 15 - "PassaggioModal.tsx"
Cohesion: 0.18
Nodes (13): closeBtnStyle, DocumentoEntry, getDefaultPassaggi(), headStyle, modalStyle, NoteEntry, overlayStyle, PassaggioModal() (+5 more)

### Community 16 - "server.ts"
Cohesion: 0.11
Nodes (14): app, porta, prisma, server, inMemoryTenantStore, prisma, createTransporter(), EmailOptions (+6 more)

### Community 17 - "client.ts"
Cohesion: 0.08
Nodes (34): API_BASE, creaArticoloApi(), createAuditLogApi(), creaUtenteTenantApi(), fetchAccessiProgetto(), fetchAuditLogsApi(), fetchComunicazioniApi(), fetchTenantInfoApi() (+26 more)

### Community 18 - "📖 BluMan — Guida Dettagliata Configurazione Canali Multicanale & Associazione Automatica Progetti"
Cohesion: 0.12
Nodes (15): 🟢 1. WhatsApp Business API (Official Meta Cloud API), ✈️ 2. Telegram Bot API (100% Gratuito), ✉️ 3. Email Inbound Webhook Parse (SendGrid / SMTP / PEC), 🔒 4. Signal End-to-End Encrypted (Clienti VIP), A. Configurazione Inbound Parse, A. Creare il Bot dello Studio con @BotFather, A. Ottenere le Credenziali da Meta Developers, A. Setup Daemon REST API (+7 more)

### Community 19 - "🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC"
Cohesion: 0.18
Nodes (10): 1. Prerequisiti, 2. Installazione sul NUOVO PC, 3. Avvio dei Server, 4. Connessione a Supabase PostgreSQL via CLI (Produzione), 🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC, Opzione A: Da Repository GitHub (Consigliato), Opzione B: Da archivio ZIP (`bluman-api-backup.zip`), Step 1: Avvia il Backend Fastify API (:3000) (+2 more)

### Community 20 - "bootstrap.ts"
Cohesion: 0.50
Nodes (5): main(), prisma, generaPasswordTemporanea(), hashPassword(), verifyPassword()

### Community 25 - "🏛 BluMan Advisory Platform — Architettura & Guida Produzione"
Cohesion: 0.18
Nodes (10): 📋 Anagrafica Master Cliente ERP (4 Schede), 🔍 AUDIT SCHIETTO: Cosa Manca per la Produzione A-Z (Enterprise Checklist), 🏛 BluMan Advisory Platform — Architettura & Guida Produzione, 🔑 Credenziali Ufficiali di Accesso (Ruoli Staff & Cliente), 💶 Fatturazione & Note di Credito (Numerazione Sequenziale Distinta), 🕸 Grafo & Dipendenze Moduli nel Progetto, ⚙️ Guida Avvio Rapido Locale, 🧑‍💼 Portale Cliente Passwordless (5 Schede) (+2 more)

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

### Community 33 - "React + TypeScript + Vite"
Cohesion: 0.50
Nodes (3): Expanding the Oxlint configuration, React Compiler, React + TypeScript + Vite

### Community 34 - "15. API — Fase 0-1 (pre-progetto → progetto attivo)"
Cohesion: 0.50
Nodes (4): 15.1 Regola di scope — da rispettare fin dal primo endpoint, 15.2 Endpoint, 15.3 Cosa succede internamente alla firma dell'engagement letter, 15. API — Fase 0-1 (pre-progetto → progetto attivo)

### Community 35 - "7. Regole di calcolo (da implementare come logica di dominio, non come dato statico)"
Cohesion: 0.67
Nodes (3): 7. Regole di calcolo (da implementare come logica di dominio, non come dato statico), 7bis. Ritardo/blocco — doppio innesco (automatico + manuale), 7ter. Grafo di dipendenze tra moduli

## Knowledge Gaps
- **295 isolated node(s):** `$schema`, `typescript`, `oxc`, `react/rules-of-hooks`, `warn` (+290 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PrismaApp` connect `PrismaApp` to `server.ts`, `inMemoryApp.ts`, `src/index.ts`, `buildServer`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `AppPort` connect `buildServer` to `server.ts`, `inMemoryApp.ts`, `PrismaApp`, `InMemoryApp`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `InMemoryApp` connect `InMemoryApp` to `server.test.ts`, `inMemoryApp.ts`, `src/index.ts`, `buildServer`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `buildServer()` (e.g. with `.accettaPreventivoEIstanzia()` and `.completaMicrovoce()`) actually correct?**
  _`buildServer()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `typescript`, `oxc` to the rest of the system?**
  _295 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `istanziazionePort.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05755693581780538 - nodes in this community are weakly interconnected._
- **Should `esecuzione.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11948790896159317 - nodes in this community are weakly interconnected._