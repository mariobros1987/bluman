# 26 · Report & Analytics

## 👤 Cosa fa e come si usa
**Report & Analytics** (`/reports`) raccoglie la reportistica direzionale sui dati reali dello studio. Si sceglie il report dai pulsanti in alto e lo si scarica con **Scarica PDF** o **Scarica Excel**.

| Report | Cosa mostra |
|---|---|
| **Ore per Operatore** | Voci assegnate e completate, ore preventivate, consuntivate ed extra, ore approvate dal timesheet e costo per ciascuna risorsa |
| **Margine per Progetto** | Ricavo contrattuale confrontato con il costo delle ore consuntivate |
| **Ricavi Mensili** | Fatturato mese per mese, al netto delle note di credito |
| **Scadenzario Incassi** | Partite aperte, parziali e scadute, ordinate per scadenza |
| **Redditività per Cliente** | Valore dei progetti confrontato con il costo ore, dal margine più alto al più basso |

## 📐 Calcoli & logica
- Il costo del lavoro usa il **costo orario** di ciascun operatore. Per le voci senza operatore assegnato si applica il valore predefinito di **30 €/ora**: il margine è quindi una stima.
- Nel report ore rientrano solo le ore del timesheet **approvate** dal responsabile (§27).
- Solo **Ricavi Mensili** ha il filtro per anno. I report non seguono il Periodo globale della barra in alto (§18).

## 🔗 Collegamenti
- **Timesheet** (§27), **Progetti** (§01), **Fatture** (§05), **Scadenzario** (§06).

## ⚠️ Stati limite & errori
- In caso di errore la pagina lo mostra con **Riprova** e non espone dati sostitutivi.
- Senza dati, il report dichiara che non c'è nulla da mostrare.

## 🔧 Nota tecnica
- Frontend: `pages/ReportsPage.tsx`, `api/report.ts` (`CHIAVI_REPORT`).
- Backend: `src/services/reportsService.ts`, rotte `/reports/:chiave`, chiave RBAC `reports`.
