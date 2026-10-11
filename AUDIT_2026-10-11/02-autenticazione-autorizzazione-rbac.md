# 02 · Autenticazione, autorizzazione & RBAC — 11/10/2026

> Audit avversariale a mano. Ogni rilievo cita `file:riga` su codice letto.

## Sintesi

Auth e RBAC sono robusti e — fatto notevole — il **rilievo Alta del 27/09** («server default
permissivo ⇄ UI restrittiva per ruolo») **è chiuso e verificato sul codice attuale**: l'hook di
enforcement applica ora il default per ruolo quando manca la riga in matrice, ed è **fail-closed**
sull'errore di lettura. I token JWT sono firmati HMAC-SHA256 con confronto a tempo costante e
rotazione dei segreti; gli OTP sono generati con `crypto.randomInt`, salvati come HMAC (non in
chiaro), limitati nei tentativi e vincolati all'ambito; i flussi di login sono rate-limited; i
segreti sono obbligatori in produzione. I rilievi sotto sono minori.

## Rilievi

### [RISOLTO — verificato] RBAC «default permissivo» lato server (era Alta, 27/09)

- **Descrizione.** Il vecchio audit segnalava che l'API lasciava passare chi non aveva riga in
  matrice, mentre la UI applicava default restrittivi, così un `collaboratore_esterno` senza
  matrice leggeva via API IBAN/CF/UBO di tutti i clienti. **Oggi è chiuso.** L'hook risolve il
  livello con `permessoDefaultPerRuolo(ruolo, modulo)` quando la riga manca, e sul fallimento di
  lettura **ricade sul default per ruolo** (fail-closed), non più su «passa».
- **File.** `src/server.ts:550-589` (enforcement), `:573` (default per riga assente), `:574-582`
  (fail-closed), `src/util/rbacModuli.ts:125-140` (`permessoDefaultPerRuolo`, allineato a
  `frontend/src/utils/rbac.ts`).
- **Verdetto.** Chiuso. Lo lascio a verbale perché era il rilievo più grave della storia del progetto.

### [Severità Bassa] CORS: l'origine letterale `null` è ammessa

- **Descrizione.** L'handler CORS lascia passare sia l'assenza di `Origin` sia l'origine letterale
  `'null'` (`callback(null, true)`), per supportare client senza origine. L'origine `null` è però
  anche quella che il browser invia da documenti in sandbox/`data:`/`file:`: ammetterla allarga di
  poco la superficie cross-origin.
- **File.** `src/server.ts:286`.
- **Come sfruttarlo.** Marginale, e mitigato dal fatto che il token è Bearer in `localStorage`
  (non un cookie): un contesto `null` non porta credenziali ambientali.
- **Rimedio.** Distinguere «assenza di Origin» (ammessa, per curl/server-to-server) da «Origin:
  null» (da rifiutare), a meno che un client legittimo noto non la richieda davvero.

### [Severità Bassa] Durata del token di sessione e assenza di revoca esplicita

- **Descrizione.** I JWT di sessione hanno scadenza (`signJwt`, default 60 min, `src/util/jwt.ts:78-80`)
  e la rotazione dei segreti permette un'invalidazione di massa, ma non esiste una revoca per-utente
  prima della scadenza se non ruotando il segreto (che sloggerebbe tutti). Per un ERP con dati
  sensibili può servire poter revocare la sessione di un singolo operatore disattivato subito.
- **File.** `src/util/jwt.ts:78-137` (firma/verifica), `:103-118` (confronto a tempo costante, OK).
- **Rimedio.** Valutare una lista di revoca (per `userId`/`jti`) consultata nell'hook, o una durata
  più corta con refresh — da pesare contro il costo. Non urgente.

## Note positive (verificate, nessun rilievo)

- **JWT**: HMAC-SHA256, confronto `crypto.timingSafeEqual`, validazione dei claim, scadenza,
  rotazione via `JWT_PREVIOUS_SECRETS` (`src/util/jwt.ts:103-131`).
- **OTP**: `crypto.randomInt(100000,1000000)` (`otpService.ts:67`), salvato come HMAC
  (`hashCodiceOtp`), `MAX_TENTATIVI` contro il brute-force (`:226`), vincolo d'ambito (`:204-205`),
  consumo con `usatoAt` (`:249-252`), TTL 300s.
- **Rate-limit** sui flussi di auth: 5–10/min (`auth.ts:58,203,283,599,657,719,813`), con `req.ip`
  calcolato in modo da non fidarsi ciecamente del proxy (`server.ts:156-158`).
- **Segreti obbligatori in produzione**: `jwt.ts:24-40` (JWT_SECRET ≥32), `otpService.ts:321-336`
  (sigillo), `totp.ts:182-186` (TOTP cifrato AES-256-GCM con chiave derivata via HKDF da JWT_SECRET).
- **2FA**: il pre-token non è accettato sulle rotte normali, chiude il bypass del secondo fattore
  (`server.ts:444`).

## Conteggio: 0 Alta, 0 Media, 2 Bassa (più 1 rilievo storico verificato come risolto).
