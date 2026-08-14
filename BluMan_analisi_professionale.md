# BluMan Advisory Platform — Analisi Professionale & Piano Esecutivo

> Consulenza Patrimoniale • Corporate Structuring • Trust • Banking • Legal • IP
> **Documento:** Analisi pre-sviluppo — produzione codice condizionata all'approvazione.

---

## 1. Contesto e Perimetro

### Chi sei e cosa fa la piattaforma
Sei un **consulente di protezione patrimoniale** che opera con clienti sia business che individuali.
Il tuo processo di lavoro copre:

| Dominio | Servizi |
|---|---|
| Analisi & Consulenza | Pre-analisi, report patrimoniale, struttura ottimale |
| Corporate Structuring | Società a Malta, Holdings internazionali, atti costitutivi |
| Trust | Deed of trust, letter of wishes, trasferimento asset |
| Banking | Selezione banche, KYC, apertura conti, banking online |
| Legal | Contratti intra-societari, contratti con terzi, NDA, agenzia |
| Fiscale | Tax planning Malta (IPA, 6/7 refund), CRS/FATCA |
| IP | Marchi EUIPO, licensing, monitoraggio e rinnovo |
| Compliance | Due diligence, KYC, aggiornamenti annuali |

---

## 2. Stato Attuale del Codice

### ✅ Già fatto (non si butta nulla)
- **Schema database Prisma** ([schema.prisma](file:///Users/mariodibenedetto/Downloads/bluman-api/prisma/schema.prisma)): completo al 95% — tutti i modelli, enumerazioni, relazioni, note operative SQL per RLS e CHECK.
- **Motore di dominio** in [src/domain/](file:///Users/mariodibenedetto/Downloads/bluman-api/src): logica stati micro-voci e moduli (Fase 5 del piano).
- **API HTTP** con Fastify ([src/server.ts](file:///Users/mariodibenedetto/Downloads/bluman-api/src/server.ts)): endpoint clienti, progetti, preventivi, micro-voci, passaggi — già funzionanti.
- **Test** ([src/server.test.ts](file:///Users/mariodibenedetto/Downloads/bluman-api/src/server.test.ts)): test sull'istanziazione transazionale e sul motore stati.
- **Prototipo HTML** ([BluMan_platform.html](file:///Users/mariodibenedetto/Downloads/bluman-api/BluMan_platform.html)): interfaccia validata con dati reali, distinta base articoli, libreria moduli, wizard creazione progetto.
- **Frontend placeholder** ([frontend/index.html](file:///Users/mariodibenedetto/Downloads/bluman-api/frontend/index.html)): già servito con `npx serve`.

### ⚠️ Cosa manca (il lavoro da fare)
- Frontend React component-based (attualmente solo HTML statico)
- API fatturazione completa (SDI, numero progressivo, webhook)
- API permessi granulari (checkScope)
- Calendario (CRUD eventi)
- Dashboard Super Admin
- Notifiche email (provider transazionale)
- Firma digitale (EngagementLetter via FirmaProvider astratto)
- Upload documenti reale (storage + antivirus)

---

## 3. Il Processo Produttivo Completo — Creazione/Spostamento di un'Azienda

Questo è il cuore della tua attività. Di seguito il processo end-to-end, con tutti i passaggi che BluMan deve supportare.

---

### FASE A — Pre-analisi e acquisizione cliente

```
Cliente potenziale → Contatto iniziale → Pre-analisi → Preventivo analisi → Accettazione
```

**Passaggi dettagliati:**

| # | Passaggio | Chi | Documenti coinvolti | Stato BluMan |
|---|---|---|---|---|
| A1 | Primo contatto / briefing | Advisor | — | Evento calendario |
| A2 | Raccolta documentazione iniziale | Cliente | Visure, estratti conto, atti | Passaggio tipo `documento` |
| A3 | Analisi struttura patrimoniale esistente | Advisor + Tax Advisor | Report interno | Micro-voce `in_progress` |
| A4 | Report analisi iniziale | Advisor | PDF report | Documento allegato |
| A5 | Presentazione al cliente | Advisor + Cliente | Slide presentazione | Evento calendario + passaggio |
| A6 | Preventivo analitico | Advisor | Documento preventivo | `Preventivo` in BluMan |
| A7 | Accettazione preventivo analisi | Cliente | — | `POST /preventivi/:id/accetta` |
| A8 | Preventivo progetto completo | Advisor | Dettaglio moduli + prezzi | Wizard selezione moduli |
| A9 | Accettazione progetto | Cliente | — | Approvazione in BluMan |
| A10 | Generazione Engagement Letter | Sistema | PDF firmabile | `POST /engagement-letters` |
| A11 | Firma digitale engagement letter | Cliente | PDF firmato | Webhook firma → progetto attivo |

> **Punto critico:** L'istanziazione del progetto (A11 → progetto attivo) è la transazione più delicata: crea in sequenza atomica tutti i `modulo_progetto`, le `microvoce_progetto`, i `passaggio_progetto`, le dipendenze e le micro-voci in attesa.

---

### FASE B — Strutturazione Societaria (il core del servizio)

Il processo di **creazione o spostamento di un'azienda** si articola in sotto-processi dipendenti l'uno dall'altro:

#### B1 — Selezione Giurisdizione

| # | Passaggio | Chi | Dettaglio |
|---|---|---|---|
| B1.1 | Analisi obiettivi fiscali e patrimoniali | Advisor + Tax Advisor | Malta IPA, Cipro, UAE, Lussemburgo, ecc. |
| B1.2 | Studio comparato giurisdizioni | Tax Advisor | Tabella confronto tassazione effettiva |
| B1.3 | Selezione giurisdizione ottimale | Advisor + Cliente | Decisione documentata |
| B1.4 | Piano societario definitivo | Advisor | Struttura: Holding → OpCo → Trust |

#### B2 — Corporate Structuring Malta (caso principale)

> Malta è la giurisdizione primaria per la tua attività (meccanismo 6/7 refund, IPA, MFSA).

**Struttura tipo:**
```
Cliente (persona fisica o società esistente)
    │
    ├── Holding Company (LTD Malta) ─── dividendi → cliente con 6/7 refund
    │       │
    │       └── Operating Company (LTD Malta) ─── attività operativa
    │
    └── Trust (opzionale) ─── protezione patrimoniale
```

**Passaggi operativi:**

| # | Passaggio | Chi | Documenti | Note |
|---|---|---|---|---|
| B2.1 | Studio struttura societaria ottimale | Advisor + Tax Advisor | Memorandum struttura | Dipende da B1.3 |
| B2.2 | Raccolta dati fondatori e UBO | Back Office | KYC documentazione | MFSA obbligatorio |
| B2.3 | Redazione Memorandum & Articles | Avvocato | M&A bozza | Personalizzati |
| B2.4 | Due diligence AML/KYC fondatori | Compliance | Report due diligence | FIAU Malta |
| B2.5 | Sottoscrizione M&A e atto costitutivo | Avvocato + Cliente | Atto notarile/elettronico | Firma cliente |
| B2.6 | Registrazione MFSA | Back Office | Application form MFSA | 5-10 giorni lavorativi |
| B2.7 | Registrazione fiscale (TIN) | Back Office | Modulo CFR | 3-5 giorni |
| B2.8 | Registrazione VAT (se applicabile) | Tax Advisor | Modulo VAT | Se turnover > soglia |
| B2.9 | Apertura VAT number EU | Tax Advisor | VIES registration | Cross-border |
| B2.10 | Documentazione UBO Registry | Back Office | UBO form + docs | Obbligatorio Malta |
| B2.11 | Setup sede legale e domiciliazione | Advisor | Contratto sede | Se non ha sede fisica |

> **Dipendenza:** B2 richiede completamento di B1 (selezione giurisdizione). I conti correnti (B4) richiedono società costituita (B2 completato).

#### B3 — Holding Internazionale (se prevista struttura multi-layer)

| # | Passaggio | Chi | Documenti | Note |
|---|---|---|---|---|
| B3.1 | Selezione giurisdizione holding | Tax Advisor | Studio confronto | Lussemburgo, Olanda, Malta |
| B3.2 | Costituzione holding | Avvocato locale | Atto costitutivo | Può richiedere notaio locale |
| B3.3 | Struttura partecipazioni | Avvocato + Tax Advisor | Shareholders agreement | Quote, diritti di voto |
| B3.4 | Intercompany agreement | Avvocato | Contratto servizi | Transfer pricing |
| B3.5 | Compliance ongoing | Compliance | Check list annuale | Reporting, filing |

#### B4 — Struttura Trust (protezione patrimoniale)

| # | Passaggio | Chi | Documenti | Note |
|---|---|---|---|---|
| B4.1 | Selezione trust company idonea | Advisor | Short list + analisi | MFSA licensed trustee |
| B4.2 | Definizione struttura trust | Advisor + Cliente | Brief struttura | Discrezionale vs. fisso |
| B4.3 | Redazione deed of trust | Avvocato + Trust Co | Deed of trust bozza | Legge del trust: Malta |
| B4.4 | Definizione letter of wishes | Cliente + Advisor | Letter of wishes | Riservata al settlor |
| B4.5 | Due diligence settlor/beneficiari | Trust Company | KYC completo | MFSA / FIAU |
| B4.6 | Esecuzione deed of trust | Avvocato + Cliente | Deed firmato | Firma tutte le parti |
| B4.7 | Trasferimento asset al trust | Advisor + Notaio | Atti trasferimento | Immobili, quote, liquidità |
| B4.8 | Registrazione trust Malta | Back Office | Application MFSA | Se trust maltese |
| B4.9 | Apertura conto corrente del trust | Back Office | KYC trust + beneficiari | Banca dedicata |

> **CRITICO:** B4.3 richiede B2.2 (dati fondatori). B4.7 deve avvenire dopo B4.6. B4.8 e B4.9 dipendono da B4.6.

---

### FASE C — Banking (Apertura Conti Correnti)

Ogni entità giuridica (OpCo, Holding, Trust) necessita di un proprio conto. Il processo è il più soggetto a ritardi (KYC rejection è il principale ostacolo):

| # | Passaggio | Chi | Documenti | Banche tipiche |
|---|---|---|---|---|
| C1 | Analisi esigenze bancarie | Advisor | Brief banche | Multi-currency, trading, SEPA |
| C2 | Selezione banche idonee | Advisor | Short list | BOV, APS, Revolut Business, ING |
| C3 | Preparazione dossier KYC | Back Office | Pacchetto completo | Vedi sotto |
| C4 | Submission domande di conto | Back Office | Application forms | Banca per banca |
| C5 | Gestione richieste integrative | Back Office + Cliente | Documenti aggiuntivi | Tipicamente 2-4 round |
| C6 | Approvazione KYC | Banca | — | 2-8 settimane tipiche |
| C7 | Apertura conto e IBAN | Back Office | Contratto conto | |
| C8 | Configurazione internet banking | Back Office | Credenziali + token | |
| C9 | Test flussi transazionali | Back Office + Cliente | — | Bonifico test intra-struttura |

**Documentazione KYC standard (pacchetto per ogni entità):**
- Atto costitutivo e statuto aggiornato
- Certificato di registrazione (MFSA)
- UBO documentation (tutti i titolari effettivi ≥ 25%)
- Passport/ID dei direttori e UBO (data < 3 mesi)
- Proof of address direttori e UBO
- Business plan / source of funds
- Ultimi 3 anni di bilanci (se società esistente)
- Struttura societaria grafica firmata

> **Segnale di rischio BluMan:** se C6 supera la soglia di giorni configurata → alert automatico all'advisor → notifica al cliente.

---

### FASE D — Contratti e Legal

#### D1 — Contratti Intra-Societari

| Contratto | Perché | Chi redige |
|---|---|---|
| Service agreement (OpCo → Holding) | Transfer pricing, giustifica flussi | Avvocato |
| Management agreement | Compenso management | Avvocato |
| Intercompany loan | Finanziamenti infra-gruppo | Avvocato + Tax Advisor |
| IP licensing agreement | Royalties intra-gruppo | Avvocato + IP specialist |
| Shareholder agreement | Governance, diritti voto, drag/tag-along | Avvocato |

#### D2 — Contratti con Terzi

| Contratto | Tipo cliente | Note |
|---|---|---|
| Contratto di distribuzione | Società | Esclusività, territorialità |
| NDA e riservatezza | Tutti | Pre-engagement |
| Contratto di agenzia | Tutti | Con calcolo provvigioni |
| SLA fornitori | Tutti | Penali, livelli servizio |

#### D3 — Documenti Cliente BluMan

Ogni contratto/documento in BluMan passa per il ciclo:
```
Template vuoto → Compilato dall'advisor → Firmato dal cliente → Archiviato
```

---

### FASE E — Gestione IP (Marchi e Proprietà Intellettuale)

| # | Passaggio | Chi | Strumento | Tempi |
|---|---|---|---|---|
| E1 | Ricerca anteriorità EUIPO | Avvocato IP | EUIPO database | 2-3 giorni |
| E2 | Analisi rischio confusione | Avvocato IP | Report analisi | 3-5 giorni |
| E3 | Deposito marchio EUIPO | Avvocato IP | e-filing EUIPO | 1 giorno filing |
| E4 | Gestione osservazioni EUIPO | Avvocato IP | Risposte scritte | 2-4 mesi se opposto |
| E5 | Registrazione marchio | — | Certificato EUIPO | ~6 mesi totali |
| E6 | Contratto licenza d'uso | Avvocato | License agreement | Dopo E5 |
| E7 | Monitoraggio rinnovi | Sistema (BluMan) | Alert automatico | Rinnovo ogni 10 anni |

> **Nota architetturale BluMan:** E7 richiede un **job schedulato** che verifica le scadenze IP nei documenti allegati alle micro-voci.

---

### FASE F — Tax Planning e Compliance Ongoing

#### F1 — Tax Planning Malta (IPA + 6/7 Refund)

**Il meccanismo 6/7 refund di Malta:**
```
Tassazione nominale Malta:    35%
Refund agli shareholders:      6/7 × 35% = 30%
Tassazione effettiva:          35% - 30% = 5%
```

| # | Passaggio | Chi | Output |
|---|---|---|---|
| F1.1 | Analisi regime IPA applicabile | Tax Advisor | Memorandum IPA |
| F1.2 | Struttura rimesse e dividendi | Tax Advisor + Advisor | Flow of funds diagram |
| F1.3 | Ottimizzazione 6/7 refund | Tax Advisor | Piano refund |
| F1.4 | Report tax planning definitivo | Tax Advisor | Report completo firmato |
| F1.5 | Presentazione al cliente | Advisor | Meeting |

#### F2 — Compliance Ongoing (annuale)

| Task | Frequenza | Responsabile |
|---|---|---|
| Aggiornamento UBO registry | Annuale o a variazione | Back Office |
| Filing annuale MFSA | Annuale | Back Office |
| CRS/FATCA reporting | Annuale | Tax Advisor |
| Rinnovo due diligence | Ogni 2 anni o a rischio | Compliance |
| Aggiornamento KYC banca | Ogni 2-3 anni | Back Office |

---

### FASE G — Monitoraggio e Chiusura Progetto

| Attività BluMan | Come funziona |
|---|---|
| Stato avanzamento real-time | `calcolaPercentualeProgetto()` su tutti i moduli |
| Alert ritardi | `segnaleRischio = true` quando ore consuntivate > soglia |
| Notifica cliente | Email automatica con link portale cliente |
| Consuntivazione ore | Collaboratori aggiornano `oreConsuntivate` per micro-voce |
| Fatturazione | 3 modalità: modulo completo / parziale / milestone libera |
| Engagement letter | PDF generato e firmato digitalmente |
| Chiusura progetto | Tutti i moduli `done` → progetto `completed` |

---

## 4. Architettura Tecnica Scelta

### Stack definitivo

| Layer | Tecnologia | Motivazione |
|---|---|---|
| Backend | Node.js + TypeScript + Fastify | Già iniziato, schema Prisma pronto |
| Database | PostgreSQL + Prisma ORM | Schema completo e testato |
| Frontend | React + Vite (SPA) | Migrazione da HTML prototipo, stesso design |
| Auth | JWT (access 15min + refresh 30gg) + magic link clienti | Già pianificato in Fase 2 |
| Storage | S3-compatible (Cloudflare R2 o AWS S3) | Per documenti/upload |
| Email | Postmark o SendGrid | Provider astratto FirmaProvider |
| Firma digitale | Yousign o DocuSign (interfaccia astratta) | Engagement letter |
| SDI | Aruba o FatturaPRO | FatturaPA + SDI |
| Deploy | Docker (app) + servizio managed PostgreSQL | Non containerizzare DB in produzione |

### Struttura cartelle frontend (da creare)

```
frontend/
├── src/
│   ├── components/       # UI riutilizzabili (Button, Badge, Card, ProgressBar)
│   ├── pages/            # Dashboard, Progetti, Progetto, Clienti, Libreria, Calendario
│   ├── layouts/          # AppLayout (sidebar + topbar)
│   ├── hooks/            # useProject, useModules, useCalendar
│   ├── store/            # Zustand o React Query
│   ├── api/              # Client HTTP verso il backend Fastify
│   └── styles/           # Design tokens CSS (colori, tipografia)
├── index.html
└── vite.config.ts
```

---

## 5. Piano di Sviluppo Esecutivo — Ordine di Priorità

### 🔴 PRIORITÀ CRITICA (necessario per operare dal giorno 1)

#### Sprint 1 — Foundation Backend (2 settimane)
- [ ] Setup Docker Compose (Postgres + app)
- [ ] Migrazione database (`prisma migrate dev`)
- [ ] Script CLI creazione super_admin
- [ ] Auth completa: JWT + refresh token + magic link + 2FA TOTP super_admin
- [ ] Middleware `tenant_id` extraction e RLS Postgres
- [ ] API libreria articoli e moduli (CRUD base)

#### Sprint 2 — Flusso Pre-Progetto (2 settimane)
- [ ] API clienti completa (con paginazione)
- [ ] API preventivi: bozza → inviato → accettato
- [ ] **Transazione istanziazione** (il pezzo più critico — 6 passaggi atomici)
- [ ] API engagement letter (generazione PDF + webhook firma)
- [ ] API micro-voci: consuntiva, ritardo, risolvi-ritardo, completa

#### Sprint 3 — Fatturazione (2 settimane) ← PRIORITÀ ALTA
- [ ] API fatture con 3 tipi (modulo_completo, modulo_parziale, milestone_libera)
- [ ] Generazione numero progressivo (lock transazionale)
- [ ] Emissione FatturaPA + SDI (interfaccia astratta SDIProvider)
- [ ] Webhook SDI + incasso
- [ ] API vista fatturazione progetto con formula residuo

#### Sprint 4 — Permessi e Collaboratori (1 settimana)
- [ ] `checkScope()` function trasversale
- [ ] API collaboratori: invito email + accesso granulare
- [ ] API team e ore aggregate per collaboratore

### 🟡 PRIORITÀ MEDIA (necessario entro il primo mese)

#### Sprint 5 — Frontend React (3 settimane)
- [ ] Setup Vite + React + TypeScript
- [ ] Design system: CSS variables dal prototipo HTML → componenti React
- [ ] Layout: Sidebar + Topbar + routing
- [ ] Pagina Dashboard: KPI, alert ritardi, lista progetti
- [ ] Pagina Progetti: lista con stato/avanzamento
- [ ] Pagina Progetto: moduli, micro-voci, procedura guidata passaggi
- [ ] Wizard nuovo progetto (3 step: cliente → moduli → riepilogo)
- [ ] Libreria moduli: grafo dipendenze con SVG edges
- [ ] Pagina Clienti

#### Sprint 6 — Documenti e Upload (1 settimana)
- [ ] Upload reale (storage S3-compatible)
- [ ] Scansione antivirus (ClamAV o cloud)
- [ ] Whitelist magic bytes (non solo estensione)
- [ ] Documento visibile solo dopo `stato_scansione = 'pulito'`

#### Sprint 7 — Calendario e Notifiche (1 settimana)
- [ ] CRUD eventi calendario
- [ ] Scope ereditato dal progetto collegato
- [ ] Notifiche email transazionali (provider astratto)
- [ ] Job schedulato promemoria passaggi pending

### 🟢 PRIORITÀ BASSA (V2 — dopo il go-live)

- [ ] Dashboard Super Admin multi-tenant
- [ ] Versionamento moduli/articoli (nuova versione + ripubblicazione)
- [ ] Portale cliente separato (magic link, vista solo passaggi cliente)
- [ ] UI di gestione libreria moduli
- [ ] Monitoraggio automatico scadenze IP
- [ ] Mobile responsive completo

---

## 6. Diagramma del Flusso Progetto

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CICLO DI VITA PROGETTO                      │
└─────────────────────────────────────────────────────────────────────┘

  [CLIENTE]                    [ADVISOR]                  [SISTEMA]
     │                            │                           │
     │◄── Contatto iniziale ──────┤                           │
     │                            │ Crea cliente + progetto   │
     │                            │──────────────────────────►│
     │                            │                           │ pre_project
     │ Riceve preventivo ─────────┤◄── Crea preventivo ───────│
     │                            │                           │
     │ Accetta preventivo ────────►──────────────────────────►│
     │                            │                           │ Transazione
     │                            │                           │ istanziazione
     │                            │                           │ ┌─────────┐
     │                            │                           │ │moduli   │
     │                            │                           │ │microvoci│
     │                            │                           │ │passaggi │
     │                            │                           │ │dipendenz│
     │                            │                           │ └─────────┘
     │ Riceve engagement letter ──┤◄── Sistema genera PDF ────│
     │                            │                           │
     │ Firma engagement letter ───►──────────────────────────►│ in_progress
     │                            │                           │
     │                            │    ESECUZIONE MODULI      │
     │                            │                           │
     │ Passaggi cliente:          │ Passaggi operatore:       │
     │ - Carica documenti         │ - Consuntiva ore          │
     │ - Compila form ───────────►│ - Marca ritardi           │
     │                            │ - Risolve blocchi         │
     │                            │                           │
     │◄── Alert ritardi ──────────│◄── segnaleRischio ────────│
     │                            │                           │
     │◄── Fatture periodiche ─────│◄── Emette fattura ────────│
     │                            │                           │
     │◄── Notifica completamento ─│◄── Modulo done ───────────│ completed
     │                            │                           │
```

---

## 7. Decisioni da Confermare Prima di Procedere

> [!IMPORTANT]
> Queste decisioni impattano l'architettura e devono essere confermate prima di iniziare a scrivere codice:

1. **Provider firma digitale**: Yousign (EU, prezzi chiari) vs DocuSign (più noto, più costoso)?
2. **Provider SDI**: Aruba FatturaPA vs FatturaPRO vs altro? (necessario per fatturazione legale Italia)
3. **Storage documenti**: Cloudflare R2 (più economico) vs AWS S3 vs server locale?
4. **Hosting**: Hetzner (EU, economico) vs Fly.io (semplice) vs AWS?
5. **Email**: Postmark vs SendGrid? (preferenza per deliverability)

> [!WARNING]
> **Incoerenza nel documento originale (già segnalata nel piano):** La roadmap §13 classifica fatturazione come V2, ma §18-21 le descrivono come pronte subito. **Si propone di implementare la fatturazione in Sprint 3** (priorità alta), come concordato nella discussione successiva al documento.

> [!NOTE]
> Il prototipo HTML (`BluMan_platform.html`) ha 3 scostamenti dai modelli dati del documento (già identificati nel piano di sviluppo). Il frontend React si baserà sulle API reali, non sui dati hardcoded del prototipo. Il design visivo del prototipo verrà invece mantenuto fedelmente.

---

## 8. Struttura delle Dipendenze tra Moduli

```
M01 Analisi patrimoniale iniziale
    │ (obbligatorio per tutti gli altri)
    ├── M02 Corporate structuring Malta
    │       ├── M05 Apertura conti correnti
    │       ├── M06 Contratti intra-societari
    │       ├── M07 Contratti con terzi
    │       ├── M08 Gestione marchi e IP
    │       ├── M09 Tax planning internazionale
    │       └── M10 Compliance e KYC
    ├── M03 Holding internazionale
    └── M04 Struttura Trust
```

> **Anti-ciclo garantito:** BluMan verifica a ogni inserimento di dipendenza che non si crei un ciclo (DFS applicativo su `modulo_dipendenza_template`).

---

## 9. Verification Plan

### Test automatici da eseguire
```bash
# Test motore stati (già presenti)
npm test

# Test istanziazione transazionale (già presente)
# Test numero progressivo fatture sotto concorrenza (da aggiungere)
# Test RLS tenant isolation (da aggiungere)
```

### Verifica manuale al termine di ogni sprint
1. Creare un progetto completo end-to-end (cliente → preventivo → firma → progetto)
2. Verificare che un utente del tenant A non veda dati del tenant B
3. Verificare che la fattura emessa abbia numero progressivo senza gap
4. Verificare che un documento infetto non sia accessibile a nessuno

---

## 10. Primo Passo Concreto

Una volta approvata questa analisi, il primo commit conterrà:
1. Setup `docker-compose.yml` con Postgres
2. `prisma migrate dev` per creare le tabelle reali
3. Script CLI `createSuperAdmin.ts`
4. Setup Vite + React frontend con il design system del prototipo

