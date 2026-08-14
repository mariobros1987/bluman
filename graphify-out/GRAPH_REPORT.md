# Graph Report - bluman-api  (2026-08-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 542 nodes · 1048 edges · 25 communities (21 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c6792f35`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- istanziazionePort.ts
- esecuzione.ts
- inMemoryApp.ts
- PrismaApp
- App.tsx
- devDependencies
- utils/index.ts
- AppPort
- compilerOptions
- scripts
- compilerOptions
- frontend/package.json
- ClientPortal.tsx
- InMemoryApp
- compilerOptions
- PassaggioModal.tsx
- NewProjectWizard.tsx
- client.ts
- ProjectDetail.tsx
- AppLayout.tsx
- bootstrap.ts
- Placeholders.tsx
- frontend/tsconfig.json
- seedFull.ts

## God Nodes (most connected - your core abstractions)
1. `PrismaApp` - 34 edges
2. `AppPort` - 30 edges
3. `buildServer()` - 29 edges
4. `InMemoryApp` - 25 edges
5. `FakeIstanziazionePort` - 19 edges
6. `react` - 19 edges
7. `fmt()` - 18 edges
8. `compilerOptions` - 18 edges
9. `PrismaIstanziazionePort` - 16 edges
10. `EsecuzionePort` - 15 edges

## Surprising Connections (you probably didn't know these)
- `MicrovoceStored` --references--> `StatoMicrovoce`  [EXTRACTED]
  src/services/fakeIstanziazionePort.ts → src/domain/types.ts
- `PassaggioModalProps` --references--> `Progetto`  [EXTRACTED]
  frontend/src/components/PassaggioModal.tsx → frontend/src/types/index.ts
- `GrafoModuliProgettoView()` --calls--> `fmt()`  [EXTRACTED]
  frontend/src/pages/ProjectDetail.tsx → frontend/src/utils/index.ts
- `FakeIstanziazionePort` --implements--> `EsecuzionePort`  [EXTRACTED]
  src/services/fakeIstanziazionePort.ts → src/services/istanziazionePort.ts
- `ModuloStored` --references--> `StatoModulo`  [EXTRACTED]
  src/services/fakeIstanziazionePort.ts → src/domain/types.ts

## Import Cycles
- None detected.

## Communities (25 total, 4 thin omitted)

### Community 0 - "istanziazionePort.ts"
Cohesion: 0.05
Nodes (37): main(), prisma, seedModulo(), moduloAnalisiPatrimoniale, moduloCorporateStructuring, ProceduraIncompletaError, setupProgettoConDueModuli(), templateDipendente() (+29 more)

### Community 1 - "esecuzione.ts"
Cohesion: 0.10
Nodes (25): calcolaPercentualeMicrovoce(), calcolaPercentualeModulo(), calcolaPercentualeProgetto(), calcolaStatoModulo(), calcolaStatoProgetto(), marcaRitardoManuale(), ModuloConDipendenze, registraConsuntivazione() (+17 more)

### Community 2 - "inMemoryApp.ts"
Cohesion: 0.09
Nodes (29): ClienteNonTrovatoError, ModuloNonTrovatoError, PreventivoNonTrovatoError, ProgettoNonTrovatoError, TransizioneNonValidaError, Cliente, Preventivo, Progetto (+21 more)

### Community 3 - "PrismaApp"
Cohesion: 0.06
Nodes (4): PrismaApp, PrismaIstanziazionePort, Cliente, Preventivo

### Community 4 - "App.tsx"
Cohesion: 0.20
Nodes (14): fetchProgetti(), App(), Badge(), BadgeProps, ProgressBar(), ProgressBarProps, Dashboard(), KpiCardProps (+6 more)

### Community 5 - "devDependencies"
Cohesion: 0.06
Nodes (31): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema, devDependencies, oxlint, @types/node (+23 more)

### Community 6 - "utils/index.ts"
Cohesion: 0.12
Nodes (28): creaArticoloApi(), creaModuloTemplateApi(), fetchArticoli(), CreaModuloForm(), Library(), LibreriaDocumentiEForm(), NuovoArticoloModal(), SubTab (+20 more)

### Community 7 - "AppPort"
Cohesion: 0.12
Nodes (4): buildServer(), nuovoServer(), templateAnalisi, AppPort

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+15 more)

### Community 9 - "scripts"
Cohesion: 0.09
Nodes (22): dotenv, fastify, @fastify/cors, dependencies, dotenv, fastify, @fastify/cors, @prisma/client (+14 more)

### Community 10 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+11 more)

### Community 11 - "frontend/package.json"
Cohesion: 0.11
Nodes (18): dependencies, react, react-dom, react-router-dom, @supabase/supabase-js, name, private, scripts (+10 more)

### Community 12 - "ClientPortal.tsx"
Cohesion: 0.17
Nodes (14): CatBadge(), CatBadgeProps, bodyStyle, containerStyle, docBoxStyle, heroBannerStyle, modRowStyle, ModuloProposta (+6 more)

### Community 14 - "compilerOptions"
Cohesion: 0.12
Nodes (16): src/adapters/prisma, compilerOptions, esModuleInterop, module, moduleResolution, noUncheckedIndexedAccess, outDir, rootDir (+8 more)

### Community 15 - "PassaggioModal.tsx"
Cohesion: 0.16
Nodes (13): closeBtnStyle, DocumentoEntry, getDefaultPassaggi(), headStyle, modalStyle, NoteEntry, overlayStyle, PassaggioModal() (+5 more)

### Community 16 - "NewProjectWizard.tsx"
Cohesion: 0.16
Nodes (17): creaClienteApi(), creaPreventivoEAccettaApi(), creaProgettoApi(), fetchClienti(), fetchModuliLibreria(), closeBtnStyle, labelStyle, NewProjectWizard() (+9 more)

### Community 17 - "client.ts"
Cohesion: 0.26
Nodes (9): API_BASE, creaUtenteTenantApi(), fetchAccessiProgetto(), fetchUtentiTenant(), updateArticoloPrezzoApi(), uploadFileApi(), ArticoliCatalogView(), SettingsPage() (+1 more)

### Community 18 - "ProjectDetail.tsx"
Cohesion: 0.17
Nodes (14): assegnaAccessoProgettoApi(), consuntivaMicrovoceApi(), emettiFatturaApi(), fetchProgettoDettaglio(), Avatar(), AvatarGroup(), AvatarGroupProps, AvatarProps (+6 more)

### Community 19 - "AppLayout.tsx"
Cohesion: 0.29
Nodes (6): AppLayout(), AppLayoutProps, TITLES, NAV, Sidebar(), SidebarProps

### Community 20 - "bootstrap.ts"
Cohesion: 0.50
Nodes (5): main(), prisma, generaPasswordTemporanea(), hashPassword(), verifyPassword()

## Knowledge Gaps
- **160 isolated node(s):** `DbState`, `IstanziaProgettoInput`, `IstanziaProgettoRisultato`, `ModuloCreatoInfo`, `RigaPreventivoAccettato` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.tsx` to `devDependencies`, `utils/index.ts`, `ClientPortal.tsx`, `PassaggioModal.tsx`, `NewProjectWizard.tsx`, `client.ts`, `ProjectDetail.tsx`, `AppLayout.tsx`, `Placeholders.tsx`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `plugins` connect `devDependencies` to `App.tsx`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `buildServer()` (e.g. with `.accettaPreventivoEIstanzia()` and `.completaMicrovoce()`) actually correct?**
  _`buildServer()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DbState`, `IstanziaProgettoInput`, `IstanziaProgettoRisultato` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `istanziazionePort.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05472837022132797 - nodes in this community are weakly interconnected._
- **Should `esecuzione.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10452961672473868 - nodes in this community are weakly interconnected._
- **Should `inMemoryApp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09268292682926829 - nodes in this community are weakly interconnected._