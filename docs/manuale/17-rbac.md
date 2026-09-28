# 17 · RBAC / Permessi & Ruoli

## 👤 Cosa fa e come si usa
Regola **chi può fare cosa**. Due meccanismi:
- **Gerarchia dei ruoli**: `super_admin` (piattaforma, tutti gli studi) · `advisor` (responsabile del
  proprio studio) · `collaboratore_interno` / `collaboratore_esterno` / `operator` (membri) ·
  `cliente` (solo Portale).
- **Matrice Permessi per modulo**: per ogni collaboratore l'admin imposta, modulo per modulo, il
  livello `denied` / `read` / `write` (da **Impostazioni → Team → OperatorDetailModal**).
- **Attivazione moduli per-studio**: la piattaforma concede un modulo (es. KYC) e lo studio può
  disattivarlo; una rotta di un modulo spento risponde **403**.

## 📐 Calcoli & logica
- **Enforcement lato server** (hook `onRequest`): traduce la rotta in chiave modulo
  (`moduloDellaRotta`) e consulta `PermessoModulo`. `denied` blocca tutto il modulo, `read` lascia solo
  GET/HEAD, `write` tutto.
- **Default per ruolo** quando **manca la riga** (`permessoDefaultPerRuolo`, allineato al frontend
  `getUserPermission`): l'advisor è pieno tranne `audit`; i collaboratori partono **ristretti** (prima
  «nessuna riga» = accesso pieno — buco chiuso: un `collaboratore_esterno` non legge più IBAN/CF/UBO di
  tutti i clienti via API).
- **Fail-open solo sull'errore** di lettura della matrice (la sessione è già verificata sullo stesso DB).
- **super_admin** ha `tenant_id` **NULL** (invariante RLS): un super_admin con tenant valorizzato
  diventa un utente ordinario di quello studio.
- **2FA/TOTP** disponibile; il marcatore `pre_totp` non vale come sessione (niente bypass 2FA).

## 🔗 Collegamenti
- **Impostazioni** (§16): la matrice e il team.
- **Tutti i moduli**: comunicazioni (invio), documenti, library, clients, invoices… passano dalla matrice.

## ⚠️ Stati limite & errori
- Permesso insufficiente → **403** con il modulo e il livello.
- Modulo disattivato per lo studio → **403**.
- Un advisor non può creare un super_admin; scritture di ruolo respinte non avvengono comunque.

## 🔧 Nota tecnica
- `src/util/rbacModuli.ts` (`moduloDellaRotta`, `permessoDefaultPerRuolo`), enforcement nell'hook
  `onRequest` di `src/server.ts`; test `rbacServer.test.ts`, `gerarchiaRuoli.test.ts`.
- Frontend: `utils/rbac.ts` (`getUserPermission`), `components/settings/OperatorDetailModal.tsx`.
- Schema: `PermessoModulo` (`tenantId`,`userId`,`moduloChiave`,`livello`), `User` (`ruolo`, `tenant_id`).
- Fonti: `.agents/AGENTS.md` («Accesso & Gerarchia dei Ruoli»), `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
