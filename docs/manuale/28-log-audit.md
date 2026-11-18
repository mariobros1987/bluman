# 28 · Log Audit Studio

## 👤 Cosa fa e come si usa
Il **Log Audit** (`/audit`) è il registro delle azioni eseguite nello studio: serve a ricostruire chi ha fatto cosa, quando e da dove.

- **Per ogni evento**: data e ora, operatore, ruolo, azione, entità coinvolta, dettagli e indirizzo IP.
- **Ricerca**: per operatore, azione o dettagli.
- **Filtri**: ruolo dell'attore e categoria dell'azione.
- In basso si cambia pagina e numero di righe mostrate.

## 📐 Calcoli & logica
- Il registro è isolato per studio. Solo il super admin vede anche la colonna con il nome dello studio.
- Gli eventi sono ordinati dal più recente.
- **L'advisor non vede questa pagina per impostazione predefinita** (§17).

## 🔗 Collegamenti
- **Permessi** (§17), **Prima Nota** (§07): qui compaiono anche i riallineamenti automatici dei saldi.

## ⚠️ Stati limite & errori
- Se la lettura non riesce, l'errore compare sopra la tabella.

- La ricerca vale per tutto il registro, mentre i filtri per **ruolo** e **categoria** agiscono **solo sulla pagina visualizzata** (lo dicono le loro etichette). Per un controllo completo conviene aumentare le righe per pagina o scorrere tutte le pagine.

## 🔧 Nota tecnica
- Frontend: `pages/AuditLogPage.tsx`. Rotta `GET /audit-logs`, chiave RBAC `audit`.
- Scrittura: `recordAudit` in `src/util/serverHelpers.ts`.
