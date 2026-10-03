# 01 — Sicurezza & Multi-tenant

> Audit del 2026-09-27. Ogni affermazione è verificata leggendo il codice sorgente reale; i riferimenti sono nella forma `file:riga`. Dove non ho potuto verificare qualcosa, è detto esplicitamente (sezione «Domande aperte»).

## Come funziona & logica applicata

La sicurezza di BluMan poggia su **tre controlli distinti e complementari**, che vanno tenuti separati per non confonderli:

1. **Autenticazione** (l'hook `onRequest` in `src/server.ts:392`) — decide *se la richiesta esiste*. Respinge con `401` qualsiasi richiesta senza un JWT verificabile, tranne le poche rotte elencate in `ROTTE_PUBBLICHE` (`src/server.ts:203-231`). L'elenco è di rotte **pubbliche**, non di rotte protette: tutto ciò che non è elencato è protetto per difetto.
2. **RLS (Row-Level Security)** (`supabase/migrations/20260819_rls_effettiva.sql`) — protegge *uno studio dall'altro*. Il runtime si connette con il ruolo `bluman_app`, che non può scavalcare RLS (`relforcerowsecurity`, nessun `BYPASSRLS`); le policy filtrano su `app.current_tenant_id`.
3. **RBAC per modulo** (`src/util/rbacModuli.ts` + `src/server.ts:508-540`) — restringe *cosa un utente può fare* dentro il proprio studio, secondo la Matrice Permessi.

### Flusso di login staff
`POST /auth/login` (`src/routes/auth.ts:56`): ricerca dell'utente per email con il **client amministrativo** (`prismaAmministrativo()`, unica lettura cross-tenant ammessa perché il tenant si scopre dalla riga cercata), verifica password scrypt a tempo costante (`src/util/password.ts:19`), controllo stato utente e stato del tenant (sospeso/archiviato → 403, `auth.ts:105-119`). Se il ruolo è abilitato al 2FA (`super_admin`/`advisor`) e l'IP non è fidato, ritorna un **preToken** di 2 minuti invece del token di sessione (`auth.ts:139-161`); altrimenti emette il JWT di sessione (12h, `serverHelpers.ts:59`).

### Flusso 2FA TOTP
Implementazione RFC 6238 nativa (`src/util/totp.ts`), segreto AES-256-GCM a riposo, finestra ±1 step, backup codes monouso a confronto costante. `POST /auth/totp/verifica` (`auth.ts:811`, pubblica) riceve preToken + codice ed emette il JWT definitivo. Feature «IP fidati»: da un IP già verificato il 2FA non viene richiesto (`auth.ts:137-139`).

### Flusso magic link cliente
Il cliente è passwordless via `POST /auth/magic-login` (`auth.ts:200`): token da 128 bit (`jwt.ts:133`), memorizzato come SHA-256 in `magic_link`, consumo atomico (`auth.ts:235-239`), tenant derivato dalla riga del cliente. Le rotte raggiungibili dal cliente sono una allowlist chiusa (`src/util/authorization.ts:48-79`).

### Richiesta autenticata → contesto tenant → RLS
L'hook `onRequest` verifica il JWT (`jwt.ts:89`, dual-key), ricontrolla che l'identità esista ancora, sia attiva e con la stessa `sessionVersion` (fail-closed su errore DB, `server.ts:446-451`), poi imposta il contesto tenant via `AsyncLocalStorage` (`prismaClient.ts:23-32`). Ogni query dell'estensione Prisma apre una transazione che fa `set_config('app.current_tenant_id', …)` (`prismaClient.ts:51-77`): senza contesto la variabile è vuota e RLS non mostra **nulla** (fail-closed, non fuga silenziosa).

### Invarianti chiave
- **`super_admin` ha `tenant_id NULL`**: è l'invariante su cui poggia la policy RLS di `public."user"` (`20260819_rls_effettiva.sql:162-172`). Solo chi ha ruolo `super_admin` nel token vede le righe senza tenant.
- Solo il `super_admin` può cambiare studio via header `x-tenant-id` (`server.ts:545-548`); per tutti gli altri il tenant del token è vincolante.
- Le password le emette sempre il server, mai il client; vivono solo come hash scrypt.
- I segreti dei canali (SMTP/IMAP/WhatsApp/Telegram/Signal) sono mascherati in uscita (`tenant.ts:60-79`).

### File chiave
| File | Ruolo |
| :--- | :--- |
| `src/server.ts` | Hook auth, `ROTTE_PUBBLICHE`, CORS, helmet, rate-limit, enforcement RBAC |
| `src/util/jwt.ts` | JWT dual-key, firma HMAC download, hash magic/OTP |
| `src/util/totp.ts` | 2FA TOTP, cifratura segreto, backup codes |
| `src/util/password.ts` | scrypt, confronto token costante |
| `src/util/prismaClient.ts` | 3 client Prisma + contesto tenant |
| `src/util/rbacModuli.ts` | Mappa rotta → modulo per il RBAC server |
| `src/util/authorization.ts` | Ruoli, allowlist rotte cliente |
| `src/util/networkPolicy.ts` | Validazione host/SSRF |
| `src/services/storageService.ts` | Sanificazione nomi file, firma download |
| `supabase/migrations/20260819_rls_effettiva.sql` | Policy RLS effettive |
| `frontend/src/utils/rbac.ts` | RBAC lato client |

## Rilievi d'audit

- **[Severità Alta] Il preToken 2FA è un token di sessione a tutti gli effetti → bypass del secondo fattore** — `POST /auth/login` (`src/routes/auth.ts:140-160`), quando serve il 2FA, emette un `preToken` firmato con `signJwt({ userId, tenantId, email, ruolo, sessionVersion }, 2)`. Questo payload **non contiene alcuna marcatura** che lo distingua da un token di sessione. L'hook `onRequest` (`src/server.ts:413-465`) accetta *qualsiasi* JWT valido con ruolo valido e `sessionVersion` intera: il preToken supera la verifica identità e imposta `autenticato = true`. Peggio: la logica di rinnovo (`src/server.ts:453-462`) confronta i secondi rimanenti (120s) con la soglia `DURATA_SESSIONE_OPERATORE_MINUTI * 60 * SOGLIA_RINNOVO` = `720*60*0.5` = 21600s (`serverHelpers.ts:59,80`); essendo `120 < 21600`, alla **prima** richiesta autenticata il server emette via header `X-Bluman-Token` un token pieno da 12 ore. — **Impatto:** un attaccante che possiede solo la password (lo scenario esatto che il 2FA difende) chiama `/auth/login`, riceve il preToken, lo usa come `Bearer` e ottiene una sessione completa di 12h; entro la finestra può anche chiamare `POST /auth/totp/disabilita` (che richiede solo la password, `auth.ts:717-737`) e spegnere del tutto il 2FA. Il limite dei «2 minuti» è illusorio. — **Rimedio:** dare al preToken un claim dedicato (es. `scope: 'totp_pending'`) e rifiutarlo nell'hook `onRequest` per tutte le rotte tranne `POST /auth/totp/verifica`; non rinnovarlo mai.

- **[Severità Alta] `PATCH /tenant/info`: nessun guard di ruolo sui campi sensibili (IBAN, stato, piano, dati fiscali)** — La rotta (`src/routes/tenant.ts:290`) applica un controllo di ruolo **solo** alle chiavi dei canali (`soloGestoriCanali`, `tenant.ts:293,235-241`) e a `moduliDisattivati` (`tenant.ts:296`). Tutti gli altri `allowedKeys` (`tenant.ts:346-364`) — tra cui `iban`, `piva`, `codiceFiscale`, `ragioneSociale`, `email`, `pec`, `sedeLegale`, `stato`, `piano`, `dataScadenza`, `leadAdvisorEmail` — sono scrivibili da **qualsiasi utente staff autenticato del tenant**, inclusi `collaboratore_interno` e `collaboratore_esterno`. La rotta non è in `ROTTE_MODULO` (`rbacModuli.ts:38-61`), quindi il modulo `settings` che il frontend nasconde ai collaboratori **non è presidiato lato server**. — **Impatto:** (a) un collaboratore può cambiare l'**IBAN** dello studio e dirottare gli incassi (frode); (b) può impostare `stato: 'sospeso'`/`'archiviato'`, che al login blocca *tutti* gli utenti dello studio, advisor compreso (`auth.ts:113-118`) → DoS dell'intero studio; (c) può alterare piano/scadenza dell'abbonamento e i dati fiscali che finiscono nelle fatture. RLS non aiuta: la modifica è sul *proprio* tenant. — **Rimedio:** limitare la scrittura dei campi anagrafici/fiscali/stato/piano ad `advisor`/`super_admin` (come già fatto per canali e moduli), o aggiungere `settings`/`admin` a `ROTTE_MODULO` con enforcement.

- **[Severità Media] Incoerenza RBAC frontend↔backend: i moduli `documents`/`library`/`settings` sono ristretti solo nell'interfaccia** — `frontend/src/utils/rbac.ts:49-59` concede a `collaboratore_interno`/`collaboratore_esterno` livello **`read`** su `documents` (e `library`), ma `rbacModuli.ts:22-31` mappa solo 9 chiavi (`projects, clients, invoices, scadenzario, primanota, banks, retainers, reports, audit`) — `documents`/`library`/`settings`/`calendar`/`timesheet` **non** sono presidiate. Verificato: `POST /documenti` (`src/routes/documenti.ts:245`) e `DELETE /documenti/:id` (`documenti.ts:913`) non hanno alcun controllo di ruolo oltre all'autenticazione. — **Impatto:** un collaboratore che nell'UI vede i documenti in sola lettura può crearli/eliminarli via `curl` — esattamente la classe di bug che l'enforcement RBAC server doveva chiudere, lasciata scoperta per questi moduli. — **Rimedio:** estendere `ROTTE_MODULO` a `documents`/`library` (e valutare `settings`), oppure aggiungere guard di ruolo espliciti sulle scritture di quei domini.

- **[Severità Media] `trustProxy: true` rende `req.ip` falsificabile via `X-Forwarded-For`** — `src/server.ts:157` imposta `trustProxy: process.env.NODE_ENV === 'production'` (trust-all); il commento conferma che Fastify «risolve `req.ip` dal primo salto di `x-forwarded-for`», che è un valore **fornito dal client**. — **Impatto:** (a) il rate-limit per-IP sulle rotte di login (`auth.ts:58`, 5/min) si aggira ruotando l'header, indebolendo la difesa brute-force; (b) la feature «IP fidati» del 2FA (`auth.ts:137`) confronta `req.ip` con la lista fidata: un IP fidato falsificato salta il secondo fattore. — **Rimedio:** impostare `trustProxy` al numero esatto di hop del proxy (es. `1`) o al CIDR del load balancer Railway, non a `true`. (Non ho verificato l'esatto comportamento XFF di Railway sul deploy reale: conservativamente, l'accoppiata trust-all + IP-fidati va corretta.)

- **[Severità Media] Il segreto TOTP è cifrato con una chiave derivata dal solo `JWT_SECRET` corrente → la rotazione (pubblicizzata «zero-downtime») rompe silenziosamente il 2FA** — `derivaChiaveTOTP()` (`src/util/totp.ts:181-194`) usa **solo** `process.env.JWT_SECRET`, non i `JWT_PREVIOUS_SECRETS` gestiti dalla rotazione dual-key (`jwt.ts:45-51`). Idem `hashCodiceOtp` (`jwt.ts:167-168`) e le firme download (`jwt.ts:190`) usano `JWT_SEGRETI[0]`. — **Impatto:** ruotando `JWT_SECRET` (procedura documentata come non-disruptiva per le sessioni) tutti i segreti TOTP a riposo diventano **indecifrabili** → `POST /auth/totp/verifica` va in 500 (`auth.ts:836-838`) e gli utenti con 2FA restano fuori; anche gli URL firmati dei file già emessi smettono di verificarsi. — **Rimedio:** derivare la chiave TOTP da un segreto dedicato e stabile (es. `TOTP_ENC_KEY`) indipendente dalla rotazione JWT, oppure ri-cifrare i segreti al cambio chiave; documentare l'accoppiamento in `docs/rotazione_segreti.md`.

- **[Severità Bassa] CORS: whitelist con wildcard `*.vercel.app` e Origin assente/`'null'` ammessi, con `credentials: true`** — `src/server.ts:243-280`: `DEFAULT_ORIGINS` include `*.vercel.app` (suffix-match su *qualsiasi* app Vercel, anche di un attaccante) e `origin: (…) if (!origine || origine === 'null') return callback(null, true)`. — **Impatto:** limitato, perché l'autenticazione è a Bearer token in `localStorage` (non cookie), quindi un sito terzo non dispone del token della vittima; resta però una superficie più ampia del necessario. — **Rimedio:** restringere `CORS_ORIGINS` ai domini realmente in uso ed evitare il wildcard generico su `*.vercel.app`.

- **[Severità Bassa] SSRF TOCTOU residuo su `validaUrlServizio` (Signal)** — Documentato dallo stesso codice (`src/util/networkPolicy.ts:180-187`): la risoluzione DNS valida l'indirizzo, ma `fetch` risolve di nuovo al momento della chiamata; un DNS che cambia risposta fra i due momenti può spostare la connessione verso un endpoint interno. — **Impatto:** uno studio che configura un endpoint Signal malevolo potrebbe colpire l'infrastruttura che lo ospita; tracciato (l'indirizzo è un campo della sua riga). — **Rimedio:** fissare la connessione all'indirizzo già validato (agent/lookup pinnato), come annotato nel commento.

- **[Severità Bassa] `POST /auth/client-login`: password per il cliente, in contrasto con l'invariante «cliente passwordless», e lookup cross-tenant per email** — La rotta (`src/routes/auth.ts:280-354`) autentica il cliente con password (`cliente.passwordHash`), mentre la tabella gerarchia in `.agents/AGENTS.md §2bis` dichiara il cliente accessibile **solo via Magic Link**. La ricerca è cross-tenant su email/`referentiJson` con `findFirst` (`auth.ts:295-302`): due clienti di studi diversi con la stessa email risolvono al primo trovato. — **Impatto:** basso (serve comunque la password corretta), ma è un canale d'accesso non riflesso nella documentazione e con risoluzione tenant per «primo match». — **Rimedio:** allineare doc e codice; se il login-password cliente è voluto, renderlo esplicito e valutare l'unicità email per tenant.

## Domande aperte / da verificare col titolare

1. **Dipendenza da `ADMIN_DATABASE_URL` per il login.** Il login usa `prismaAmministrativo()` (`prismaClient.ts:157-167`); senza `ADMIN_DATABASE_URL`/`DIRECT_URL` ripiega su un client legato a RLS che, senza contesto, non vede nessuna riga → login rotto per tutti (fail-closed, non una fuga). Confermato in produzione l'uso di un URL amministrativo (MEMORY.md). Verificare che sia sempre configurato e monitorato.
2. **`enterWith` di `AsyncLocalStorage` (`prismaClient.ts:30`).** Scelto al posto di `run` per gli hook Fastify. Confermare che non ci sia «context bleed» del tenant fra richieste concorrenti che condividono lo stesso contesto async padre (rischio teorico di leggere/scrivere sul tenant sbagliato sotto carico).
3. **Fail-open sul RBAC per errore di lettura della matrice** (`server.ts:531-533`): deliberato (la sessione è già verificata sullo stesso DB). Confermare che sia accettabile per il titolare come politica.
4. **Rate-limit in-memory su singola replica** (`server.ts:319-321`): con più repliche il limite reale diventa `max × repliche`. Verificare il piano di scaling e l'eventuale store Redis condiviso.
5. **Priorità di remediation:** confermare l'ordine proposto (preToken 2FA → guard `PATCH /tenant/info` → gap RBAC documents) e la finestra per la rotazione dei segreti già noti come compromessi (verify token WhatsApp storico, citato in AGENTS.md §2bis).

