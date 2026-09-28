# Manuale BluMan — guida per modulo e sezione

> Documentazione funzionale + tecnica dell'applicazione, una scheda per sezione.
> File markdown versionati col codice: quando cambia il comportamento, si aggiorna la scheda.

## Com'è organizzato
Ogni scheda è su **due livelli**, così serve sia a chi usa lo studio sia a chi sviluppa:
- **👤 Come si usa** — in parole semplici: cosa fa, come si opera, cosa vede il cliente.
- **🔧 Nota tecnica** — dove vive nel codice: file, endpoint, motore di calcolo, guardie, dati.

Convenzioni: 📐 calcoli/logica · 🔗 collegamenti ad altri moduli · ✍️ firma · ⚙️ impostazioni · ⚠️ stati limite/errori.

## Panoramica di BluMan
**Cos'è**: ERP multitenant per studi di consulenza/commercialisti (Malta + Italia) — pratiche,
contabilità, documenti con firma, compliance KYC/AML, portale cliente.
**Stack**: Fastify + TypeScript + Prisma + PostgreSQL (Supabase) · frontend React/Vite.

**Isolamento multi-tenant**: ogni studio è un `tenant`; i dati non si mischiano **mai**. La difesa
vera è la **RLS** del database (non il filtro applicativo): ogni richiesta viaggia col tenant impostato
come variabile di sessione, e le policy filtrano su quello.

**Ruoli**: `super_admin` (piattaforma, vede tutti gli studi, `tenant_id` NULL) · `advisor`
(responsabile del proprio studio) · `collaboratore_interno`/`collaboratore_esterno`/`operator`
(membri dello studio, con permessi per modulo) · `cliente` (accesso passwordless al solo Portale).

**Il ciclo di vita di una pratica** (filo conduttore di quasi tutti i moduli):

```
Cliente ─▶ Preventivo ─(accetta)▶ Progetto ─▶ Moduli ─▶ Micro-voci + Passaggi
   │                                   │                     │
   │                                   │              esecuzione / consuntivazione ore
   │                                   ▼                     ▼
   │                             Avanzamento (§16)      Documenti & Firma (SES/FEA)
   │                                   │                     │
   └────────────▶ Fatture / NC ─▶ SDI ─▶ Scadenzario/Incassi ─▶ Prima Nota
```

**Chi calcola cosa**: stati e percentuali di avanzamento li calcola il **backend** (motore §16), non
il frontend; il frontend non inventa dati che il database non ha (empty state sinceri).

## Indice delle sezioni
Una scheda per sezione (🚧 = da scrivere, ✅ = pronta). Le facciamo una alla volta.

| # | Sezione | File | Contenuto | Stato |
|---|---------|------|-----------|-------|
| 00 | Panoramica & concetti | questo file | multi-tenant, ruoli, ciclo pratica | ✅ |
| 01 | Progetti & Motore di stato (§16) | `01-progetti-motore-stato.md` | moduli, micro-voci, condivisione, avanzamento, dipendenze | ✅ |
| 02 | Clienti & Anagrafica ERP | `02-clienti.md` | anagrafica, magic link, progetti attivi | ✅ |
| 03 | Libreria & Catalogo | `03-libreria.md` | articoli, moduli template, distinta base, giurisdizioni | ✅ |
| 04 | Preventivi & istanziazione | `04-preventivi.md` | dal preventivo ai moduli del progetto (§15.3) | 🚧 |
| 05 | Fatture / Note di Credito & SDI | `05-fatture-sdi.md` | numerazione, IVA, XML SDI, NC parziali/storno | 🚧 |
| 06 | Scadenzario incassi & Solleciti | `06-scadenzario-solleciti.md` | rate, incassi, mora D.Lgs. 231, escalation | 🚧 |
| 07 | Prima Nota & Riconciliazione | `07-prima-nota.md` | cassa/banca, riconciliazione CSV | 🚧 |
| 08 | LIPE / IVA & F24 | `08-lipe-iva.md` | liquidazione periodica, codici tributo | 🚧 |
| 09 | Contratti ricorrenti / Retainer | `09-retainer.md` | periodicità, generazione fatture | 🚧 |
| 10 | Documenti / Vault & Studio | `10-documenti.md` | vault, Document Studio, Smart Tags, versioni | 🚧 |
| 11 | Firma elettronica | `11-firma.md` | SES/FEA/FEQ, OTP, sigillo HMAC, multi-firma, cronologia | 🚧 |
| 12 | Portale Cliente | `12-portale.md` | 7 tab, firma, form, documenti, chat | 🚧 |
| 13 | KYC / AML (Malta) | `13-kyc.md` | rischio, gate, monitoraggio, MLRO, STR/goAML | 🚧 |
| 14 | Calendario & scadenze attività | `14-calendario.md` | vista mese/agenda, cron scadenze | 🚧 |
| 15 | Comunicazioni & Canali | `15-comunicazioni.md` | email/WhatsApp/Telegram/Signal, matrice invio | 🚧 |
| 16 | Impostazioni Studio | `16-impostazioni.md` | SMTP/IMAP, PDF, team, credenziali tenant | 🚧 |
| 17 | RBAC / Permessi & Ruoli | `17-rbac.md` | matrice permessi, gerarchia, default per ruolo | 🚧 |
| 18 | Filtri per data & Periodo | `18-filtri-periodo.md` | filtro da/a, selettore Esercizio globale | 🚧 |
| 19 | Infrastruttura & Deploy | `19-infra-deploy.md` | Railway/Vercel, migrazioni, RLS, backup | 🚧 |

## Template di ogni scheda
Ogni file `NN-*.md` segue questa struttura (così sono tutte uguali e complete):

```markdown
# NN · <Nome sezione>

## 👤 Cosa fa e come si usa
<scopo + flusso operatore, cosa vede il cliente, passo per passo>

## 📐 Calcoli & logica
<le regole e dove vengono decise; ogni scelta/blocco spiegabile in una frase (§12)>

## 🔗 Collegamenti
<a quali altri moduli/dati/eventi è legata questa sezione (aiuta il grafo)>

## ✍️ Firma / ⚙️ Impostazioni
<se applicabile: cosa si firma/come; cosa si configura e dove>

## ⚠️ Stati limite & errori
<empty/loading/error, guardie 409/403, casi particolari>

## 🔧 Nota tecnica
<file, endpoint, motore, tabelle, migrazioni — per chi sviluppa>
```

## Fonti da cui attingere (già esistenti)
- **`.agents/AGENTS.md`** — mappa tecnica completa (componenti, rotte, dominio, schema, RBAC, firma).
- **`AUDIT_2026-09-27/01`–`08`** — per ogni area c'è una parte «come funziona & logica applicata».
- **Spec di dominio** — KYC (`bluman-kyc-compliance-specifica-v0.2.md`), firma
  (`piano-firma-legale-ses-fea-feq.md`, `spec-portale-moduli-firma.md`), contabilità
  (`piano-riforma-fatture-contabilita-openstamanager.md`), canali (`GUIDA_CONFIGURAZIONE_CANALI.md`).
- **Grafo** (`graphify-out/GRAPH_REPORT.md`) — struttura del codice e comunità: utile per la sezione
  «🔗 Collegamenti» e per non dimenticare pezzi.

> Aggiornamento: quando si cambia il comportamento di una sezione, si aggiorna la sua scheda qui,
> come si fa già con `.agents/AGENTS.md` (regola 4).

