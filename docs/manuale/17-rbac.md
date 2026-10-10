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
- **Fail-closed sull'errore** di lettura della matrice: se la lettura fallisce si applica il
  **default per ruolo**, non si lascia passare. Fino al 09/10/2026 era fail-open, e l'effetto
  collaterale era che l'error-path risultava **più permissivo del percorso normale** — con la matrice
  irraggiungibile, chi non aveva righe otteneva l'accesso pieno che il default gli nega. Il prezzo
  accettato è che un guasto possa negare un accesso legittimo: si sbaglia dal lato che si vede (una
  porta chiusa per errore si nota e si riapre; una aperta per errore no).
- **Cosa *non* passa dalla matrice.** Le rotte `/admin/*` (pannello di piattaforma) e `/tenant/*`
  (impostazioni dello studio) sono **deliberatamente fuori** da `ROTTE_MODULO`
  (`src/util/rbacModuli.ts`): la matrice governa i moduli di **dominio** (clients, invoices,
  comunicazioni…), non l'amministrazione, che è protetta da **guardie di ruolo**
  (`soloSuperAdmin` per `/admin/*`; `advisor`/`super_admin` per `/tenant/*`). La conseguenza
  pratica è che una funzione nuova riservata al titolare **non richiede una voce nella matrice**: le
  basta la guardia di ruolo già esistente. È il caso della **freschezza del backup off-site**
  (`GET /tenant/backup`, 10/10/2026): il riquadro in *Impostazioni → Manutenzione* la vede
  l'`advisor`, e gli altri ruoli ricevono 403 — che l'interfaccia interpreta come «non ti
  riguarda», non come un guasto (un 500, quello sì, si dice).
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
  assegnazione. La stessa guardia protegge `POST /tenant/utenti/:id/reset-password`, che su una
  persona **archiviata** risponde **409**: quella rotta rimette l'utenza in `invitato`, e su un
  archiviato la riporterebbe dentro senza riaprire nessun periodo. Per farla rientrare c'è la
  riattivazione, che è riservata agli stessi due ruoli.

## 🔗 Collegamenti
- **Impostazioni** (§16): la matrice e il team. La scheda **Manutenzione** mostra all'`advisor` la
  freschezza della copia di sicurezza (rotta `/tenant/backup`, guardia di ruolo, **non** matrice).
- **Super admin** (pagina piattaforma, **non** un modulo): la scheda **Backup off-site** è dietro
  `soloSuperAdmin` e **non** compare agli altri ruoli; la credenziale che vi si incolla non è mai
  rileggibile. Il campo del token è *write-only* per costruzione, non per convenzione: vedi §19.
- **Tutti i moduli**: comunicazioni (invio **e** lettura della casella), documenti, library, clients,
  invoices… passano dalla matrice.
- **Comunicazioni**: la matrice governa l'intero modulo — invio, casella in arrivo, fascicolo del
  progetto e chat della micro-voce. `read` = «consulta la conversazione senza poter scrivere», e vale
  identico per la posta in arrivo e per l'invio. Unica eccezione: `PATCH
  /progetti/:id/comunicazioni/segna-lette` resta agganciata al modulo **Progetti**, altrimenti chi ha
  `read` non riuscirebbe mai a spegnere il contatore dei non letti (il livello `read` blocca ogni
  metodo diverso da GET/HEAD).

## ⚠️ Stati limite & errori
- Permesso insufficiente → **403** con il modulo e il livello.
- Modulo disattivato per lo studio → **403**.
- Un advisor non può creare un super_admin; scritture di ruolo respinte non avvengono comunque.
- Reset password di una persona **archiviata** → **409**: non è una questione di permesso ma di
  significato — la riattivazione è l'unica porta di rientro (§16).
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
- Frontend: `utils/rbac.ts` (`getUserPermission`), `utils/comunicazioniAccesso.ts`
  (`haAccessoComunicazioni`, usato da `ProjectDetail` e `PassaggioModal` per non mostrare schede e
  linguette che il server negherebbe), `components/settings/OperatorDetailModal.tsx`,
  `components/settings/TabUsers.tsx`.
- Schema: `PermessoModulo` (`tenantId`,`userId`,`moduloChiave`,`livello`), `User` (`ruolo`, `tenant_id`,
  `stato`), `PeriodoCollaborazione` (`dal`,`al` — vedi §16).
- Fonti: `.agents/AGENTS.md` («Accesso & Gerarchia dei Ruoli»), `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
