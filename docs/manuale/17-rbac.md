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
- **Gestione del team**: `POST /tenant/utenti` (creare) e le due rotte di **archiviazione**
  (`POST /tenant/utenti/:id/disattiva`) e **riattivazione** (`.../riattiva`) sono riservate a
  **super_admin e advisor**. Un advisor agisce solo sulle persone del **proprio** studio e non tocca
  un super admin della piattaforma (il controllo guarda il ruolo *esistente*, non quello richiesto).
  I collaboratori ricevono **403** prima ancora di arrivare al controllo sul bersaglio.
  L'archiviazione spegne l'utenza (`stato: 'disattivato'`) e chiude il periodo di collaborazione
  aperto — vedi §16. L'utente archiviato non accede più (403 al login) e sparisce dai selettori di
  assegnazione.

## 🔗 Collegamenti
- **Impostazioni** (§16): la matrice e il team.
- **Tutti i moduli**: comunicazioni (invio), documenti, library, clients, invoices… passano dalla matrice.

## ⚠️ Stati limite & errori
- Permesso insufficiente → **403** con il modulo e il livello.
- Modulo disattivato per lo studio → **403**.
- Un advisor non può creare un super_admin; scritture di ruolo respinte non avvengono comunque.
- **Autobloccaggio dello studio** (chiuso): nessuno può archiviare **sé stesso** né l'**ultimo
  responsabile attivo** dello studio — senza un advisor, `POST /tenant/utenti` risponde 403 a
  chiunque e il team non è più gestibile né riattivabile da lì. Entrambi → **400** con il motivo,
  e nessuna scrittura.

## 🔧 Nota tecnica
- `src/util/rbacModuli.ts` (`moduloDellaRotta`, `permessoDefaultPerRuolo`), enforcement nell'hook
  `onRequest` di `src/server.ts`; test `rbacServer.test.ts`, `gerarchiaRuoli.test.ts`,
  `periodiCollaborazione.test.ts`.
- La guardia comune alle rotte che agiscono su una persona del team (reset password, archiviazione,
  riattivazione) è `utenteGestibile(req, reply, id)` in `src/routes/tenant.ts`: una sola
  implementazione per i tre casi, così non possono divergere.
- Frontend: `utils/rbac.ts` (`getUserPermission`), `components/settings/OperatorDetailModal.tsx`,
  `components/settings/TabUsers.tsx`.
- Schema: `PermessoModulo` (`tenantId`,`userId`,`moduloChiave`,`livello`), `User` (`ruolo`, `tenant_id`,
  `stato`), `PeriodoCollaborazione` (`dal`,`al` — vedi §16).
- Fonti: `.agents/AGENTS.md` («Accesso & Gerarchia dei Ruoli»), `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
