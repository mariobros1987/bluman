# 16 · Impostazioni Studio

## 👤 Cosa fa e come si usa
Le **Impostazioni** (`/settings`) configurano lo studio (tenant):
- **Dati studio**: ragione sociale, sedi, P.IVA, **logo**, colore del tema PDF;
- **Email Suite**: credenziali **SMTP/IMAP** dello studio (per invio/ingestione posta);
- **Canali**: WhatsApp/Telegram/Signal (token, username bot, callback);
- **Configuratore PDF** della fattura;
- **Team**: gli utenti dello studio (iniziali, ruoli), gli **operatori archiviati** e la **Matrice Permessi RBAC** (§17);
- **Sicurezza**: 2FA/TOTP;
- **Compliance**: profilo regolatorio e **MLRO** (per il modulo KYC, §13).

## 📐 Calcoli & logica
- Le **credenziali dello studio** vivono nella riga **Tenant** del database e si aggiornano via
  `PUT /tenant/settings`; le password delle **persone** solo come **hash scrypt** su
  `user.password_hash` (mai in chiaro, regola 5). Nessun valore di ripiego precompilato nella UI.
- `PATCH /tenant/info` (impostazioni studio) è **riservato ad advisor/super_admin** — non passa dalla
  matrice permessi (è funzione da titolare, decisione 27/09).
- I segreti (SMTP/IMAP pass, token canali) non vengono mai restituiti in chiaro alle letture.

### 📦 Archiviare un operatore che non lavora più nello studio

Quando una persona smette di collaborare, **non si cancella**: i progetti a cui ha lavorato, le ore
registrate e i documenti che ha caricato la citano con chiavi esterne, e cancellarla vorrebbe dire o
romperli o azzerarli. Si **archivia**.

- Nella scheda **Gestione Team**, ogni persona attiva ha il pulsante **`📦 Archivia`**. Si indica il
  **giorno in cui la collaborazione è finita** (precompilato a oggi, modificabile: non è per forza il
  giorno in cui ci si ricorda di archiviare) e, se serve, un motivo.
- Da quel momento l'utenza è **spenta**: la persona non accede più e **non compare più tra gli
  operatori assegnabili** ai progetti e agli eventi.
- Chi è archiviato finisce in una sezione a parte, **«Operatori archiviati»**, con il periodo in cui
  ha lavorato. Da lì il pulsante **`↩️ Riattiva`** lo riporta in forza indicando la **data di inizio**.
- Chi era stato **invitato** e non aveva mai scelto una password personale non se la ritrova
  pronta: al primo accesso dopo la riattivazione gli viene chiesto di cambiarla, esattamente come
  al primo invito. È voluto — quella password temporanea la conosce anche chi l'ha creata.
- Se una persona rientra dopo anni, la sua storia ha **due periodi**: il precedente non viene
  sovrascritto. È il motivo per cui i periodi sono registrati uno per uno e non in due colonne.

Chi può archiviare: **super admin** e **responsabile dello studio** (advisor). Un advisor agisce solo
sul proprio studio e non tocca un super admin della piattaforma.

Le regole che impediscono di chiudersi fuori da soli:

- **non si archivia sé stessi** — serve un altro responsabile;
- **non si archivia l'ultimo responsabile attivo** dello studio: senza di lui nessuno può più creare
  utenti né riattivare chi è stato archiviato;
- un **super admin di piattaforma** non appartiene a uno studio e non si archivia da qui.

Nessuna data è modificabile a posteriori: un periodo chiuso è un fatto registrato, non una bozza.
Se è stato scritto male, si riattiva e si richiude con la data giusta — e restano agli atti entrambe
le operazioni.

## 🔗 Collegamenti
- **Comunicazioni** (§15): SMTP/IMAP e canali si impostano qui.
- **RBAC** (§17): la Matrice Permessi e il team si gestiscono da qui.
- **KYC** (§13): profilo regolatorio e MLRO.
- **Fatture** (§05): il Configuratore PDF e i dati studio finiscono in fattura.

## ⚠️ Stati limite & errori
- Modifica impostazioni studio da un collaboratore → **403** (solo advisor/super_admin).
- Un canale con credenziali errate → messaggi di configurazione mirati (non un fallimento muto).
- Archiviazione o riattivazione da un ruolo che non sia advisor/super_admin → **403**; da un advisor su
  un altro studio → **403**; su sé stessi, sull'ultimo responsabile attivo o con una data incoerente
  (fine prima dell'inizio, inizio prima della fine del periodo precedente) → **400** con il motivo;
  archiviare chi non è in forza o riattivare chi lo è già → **409**. In nessun caso la scrittura
  avviene a metà: periodo e stato dell'utenza cambiano insieme o non cambiano affatto.

## 🔧 Nota tecnica
- Rotte: `src/routes/tenant.ts` (`/tenant/info`, `/tenant/settings`, `/tenant/utenti`,
  `POST /tenant/utenti/:id/disattiva`, `POST /tenant/utenti/:id/riattiva`, `/tenant/moduli`).
- **Invariante dei periodi**: `user.stato = 'disattivato'` **se e solo se** non esiste una riga di
  `periodo_collaborazione` con `al` nullo. A presidiarla è un solo punto di scrittura,
  `src/services/periodiCollaborazione.ts` (`disattivaCollaboratore` / `riattivaCollaboratore`), che
  chiude/apre il periodo e aggiorna `stato` (con `sessionVersion` incrementata, così la sessione
  aperta muore subito) nella **stessa transazione**. Due scritture in due posti lascerebbero una
  persona disattivata col periodo ancora aperto.
- Il controllo sull'**ultimo responsabile attivo** è fatto *dentro* la transazione: due responsabili
  che si archiviano a vicenda nello stesso istante passerebbero entrambi un controllo fatto fuori.
- Frontend: `pages/SettingsPage.tsx`, `components/settings/` (`TabCompany`, `TabChannels`, `TabSdi`,
  `TabUsers`, `ArchiviaOperatoreModal`, `OperatorDetailModal`, `TabSicurezza`, `TabCompliance`,
  `TabInvoiceDesign`).
- Schema: `Tenant` (dati studio, `smtp_pass`/`imap_pass`, servername certificati), `User`,
  **`PeriodoCollaborazione`** (`periodo_collaborazione`: `dal`, `al` nullo = in forza, `motivo`,
  `creato_da`, `stato_precedente`; migrazione `20261001_periodi_collaborazione`, che fa anche il
  **backfill** di un periodo aperto da `user.created_at` per ogni utente già esistente non
  disattivato).
- **`stato_precedente`** è lo stato dell'utenza prima di spegnerla, e serve a non promuovere
  nessuno per sbaglio: chi era **`invitato`** — creato, mai entrato, con la password temporanea
  ancora da cambiare — **torna `invitato`**, non `attivo`. Riattivarlo come `attivo` gli darebbe un
  accesso pieno retto da una password che chi l'ha creato conosce. Per tutti gli altri il ritorno è
  `attivo`, ed è anche il ripiego per le righe nate prima che la colonna esistesse.
- Presidio: `src/periodiCollaborazione.test.ts` (19 test).
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
