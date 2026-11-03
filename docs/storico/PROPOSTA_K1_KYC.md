# Proposta di design — KYC Malta v0.2, Fase K1

> Stato: **realizzata** — K1 è deployato. Il documento resta come **storia del progetto**: dice come
> si è arrivati al modello dati che oggi vive in `schema.prisma`, non cosa fare adesso. Per K2 e
> oltre vale `bluman-kyc-compliance-specifica-v0.2.md`.
> Riferimenti: `bluman-kyc-compliance-specifica-v0.2.md` (§7 modello dati, §8 stati, §9 RBAC, §13 fasi),
> decisioni in memoria `decisioni-kyc-fase1` e `kyc-malta-v02`. K0 (`TenantComplianceSettings` +
> `ComplianceEvent` + scheda Impostazioni) è già deployato.

## 1. Perimetro di K1 (dalla spec §13)

**Dentro K1:** `KycCase` (pratica: stato, livello verifica, responsabile, link all'incarico),
`Party` (soggetto PF/PG), `IdentityDocument`, `Representation` (rappresentante ↔ rappresentato),
riuso di `ComplianceEvent` (già K0) per l'audit, permessi incl. **MLRO**.

**Fuori da K1 (fasi successive, da NON anticipare):** titolare effettivo/catena di controllo e
`BoRegistryFiling` → **K2**; `RiskAssessment` a 4 pilastri + `ServiceOffering` → **K3**; gating nel
DAG e approvazioni → **K4**; screening PEP/sanzioni → **K5**. Il modello K1 lascia le *giunzioni*
(FK, campi) pronte per queste fasi ma non ne implementa la logica.

## 2. Principio guida: evolvere, non ricostruire

Esiste già in produzione `FascicoloKyc` (v0.1, IT-flavored) con `DocumentoKyc`,
`StoricoFascicoloKyc`, `OverrideKyc` ed enum collegati. Per [[decisioni-kyc-fase1]] si **evolve**,
non si ricostruisce. Prod è solo traffico di prova ([[produzione-solo-traffico-di-prova]]), quindi
una migrazione che rimodella è a rischio zero sui dati reali.

I campi legacy su `Cliente` (`rischioAml`, `ubo`, `dataKyc`, `fontePatrimonio`) **restano proiezione
di sola lettura** (li leggono calendario categoria `kyc` e `cronService` rinnovi UBO): non si toccano.

## 3. Entità K1 (nuove ed evolute)

### 3.1 `KycCase` — evoluzione di `FascicoloKyc`
Si **rinomina** `fascicolo_kyc` → `kyc_case` (migrazione `ALTER TABLE ... RENAME`, additiva sui dati)
e si adotta la macchina a stati della spec §8, sostituendo l'attuale `StatoKyc`:

`BOZZA → IN_RACCOLTA → IN_VERIFICA → IN_ATTESA_APPROVAZIONE → APPROVATO | RESPINTO | SOSPESO → IN_REVISIONE → CHIUSO`

- Si aggiunge `partyId` (FK → `Party`, il soggetto della pratica) e `incaricoId`/`progettoId`
  (link all'incarico, per il gating K4 — nullable in K1).
- `responsabileUserId` (l'operatore/compliance che segue la pratica).
- Restano `livelloVerifica` (semplificata|ordinaria|rafforzata), `dataScadenza`, `approvatoDa/Il`,
  `noteCompliance`. `rischioCalcolato`/`punteggioRischio` **restano ma congelati** (li ricalcolerà K3;
  in K1 non si scrivono da form).
- `StoricoFascicoloKyc` → `KycCaseTransition` (rinomina) resta il diario delle transizioni; in più,
  **ogni transizione emette un `ComplianceEvent`** append-only (spec §8 regola 10, riuso di K0).
- `OverrideKyc` resta (sblocco motivato, servirà al gating K4).

### 3.2 `Party` — nuovo
Soggetto PF/PG. In K1 il `Party` della pratica corrisponde al cliente, ma è entità separata perché
K2 (titolari effettivi, rappresentanti) userà `Party` anche per persone che non sono il cliente.
- `tipo` (persona_fisica | persona_giuridica), anagrafica, identificativi fiscali, residenza/sede.
- `clienteId` nullable (FK → `Cliente`): valorizzato quando il party **è** il cliente; per UBO/
  rappresentanti (K2) resterà null. Tenant-scoped.

### 3.3 `IdentityDocument` — nuovo
Tipo, numero, emittente, scadenza, **file cifrato a riposo** (riuso `storageService`, spec §11),
esito verifica. FK → `Party`. In K1 sostituisce/affianca `DocumentoKyc` per i documenti d'identità;
`DocumentoKyc` resta per gli allegati di fascicolo generici.

### 3.4 `Representation` — nuovo
Rappresentante ↔ rappresentato (`Party`↔`Party`), poteri, fonte. Predispone la catena di controllo di K2.

## 4. RBAC e MLRO (spec §9, decisione [[decisioni-kyc-fase1]] #2)

- **MLRO non è un nuovo ruolo nell'enum** (non si tocca la gerarchia né l'invariante `tenant_id` NULL
  del super_admin): è il `mlroUserId` già in `TenantComplianceSettings` (K0) + un **permesso RBAC**
  «compliance» assegnabile via matrice. Chiave modulo nuova: `compliance` (già usata dalla scheda K0/3).
- Enforcement lato server (hook `onRequest`, `rbacModuli.ts`): le rotte `/kyc/*` consultano il permesso.
- **Cliente**: mai rischio/screening/anomalie (RLS isola il tenant; le rotte client-facing non
  espongono questi campi — criterio d'accettazione §14). In K1 il cliente vede al più i propri
  documenti da caricare (upload sicuro è K6).
- **Amministratore tecnico**: nessun accesso ai contenuti dei fascicoli (fuori scope K1, si annota).

## 5. Migrazione dei dati esistenti

Rinomina tabelle/enum in migrazione versionata con **policy RLS nella stessa migrazione** (come K0).
Le righe `FascicoloKyc` esistenti (solo di prova) si rimappano allo stato nuovo: `bozza→BOZZA`,
`approvato→APPROVATO`, ecc. (mappa 1:1 esplicita). Nessun `Party` retroattivo automatico: al primo
salvataggio di una pratica si crea il `Party` dal `Cliente`. `prisma generate` + typecheck/test verdi
come primo commit (regola 8).

## 6. Sequenza di commit (regola 8, come K0)

1. **Modello dati**: schema Prisma (rinomina + Party/IdentityDocument/Representation) + migrazione con
   RLS + `prisma generate` + typecheck/test. Nessun comportamento nuovo.
2. **Dominio + servizi**: macchina a stati `KycCase` (funzioni pure + `ComplianceEvent` per transizione),
   porte/adapter, test.
3. **Rotte Fastify** `/kyc/*` (CRUD pratica, party, documenti) con guard `compliance`, test.
4. **UI**: scheda/pannello pratica KYC agganciata alla scheda cliente + al modulo, badge stato.

## 7. Decisioni che servono dal titolare prima di scrivere il commit 1

1. **Rinomina `FascicoloKyc`→`KycCase`** (tabella `kyc_case`): confermi la rinomina in-place, o
   preferisci tenere `fascicolo_kyc` come nome tabella e cambiare solo la semantica? (Prod è di prova,
   la rinomina è pulita.)
2. **Macchina a stati** a 8 stati della spec §8: la adottiamo sostituendo `StatoKyc` attuale? (mappa i
   pochi record di prova).
3. **`Party` come entità separata da subito** (consigliato, la spec la mette in K1 e serve a K2), o in
   K1 teniamo la pratica agganciata direttamente a `Cliente` e introduciamo `Party` in K2?
4. **Profilo regolatorio** (spec §15.1): hai già scelto `CSP_MFSA` o `ALTRO_SOGGETTO_OBBLIGATO` in
   Impostazioni? Non blocca K1, ma orienta i default.
5. **Migrazione clienti in portafoglio** (spec §15.8): KYC retroattivo su tutti, o solo sui **nuovi
   incarichi**? (in v0.1 la decisione era: `dataKyc` valorizzato → approvato, altri → non iniziato;
   confermi anche per v0.2?)

Al tuo via su questi punti, parto dal **commit 1 (modello dati)**.

