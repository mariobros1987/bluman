# Rotazione `JWT_SECRET` su Railway — Procedura Zero-Downtime

> **Riferimento**: `6.2b` — `src/util/jwt.ts` (variabile `JWT_PREVIOUS_SECRETS`)
> **Ultima revisione**: 2026-09-12

---

## Perché serve la rotazione

`JWT_SECRET` è il segreto con cui vengono firmati tutti i token di sessione degli
operatori e dei clienti. Se viene compromesso (leak di variabili d'ambiente, accesso
non autorizzato alla dashboard Railway), chiunque può forgiare token validi con
qualunque `tenantId` e `ruolo`.

La rotazione periodica (consigliata ogni 90 giorni, obbligatoria in caso di sospetto
leak) **revoca implicitamente tutti i token esistenti** — a meno di non usare il
meccanismo dual-key descritto qui sotto.

---

## Meccanismo dual-key (`JWT_PREVIOUS_SECRETS`)

`src/util/jwt.ts` implementa una lista di segreti:

- **`signJwt()`** firma sempre con `JWT_SECRET` (segreto corrente).
- **`verifyJwt()`** prova in sequenza `JWT_SECRET`, poi ogni segreto in
  `JWT_PREVIOUS_SECRETS`: il token è valido se almeno uno produce la firma corretta.

Questo permette di impostare il nuovo segreto senza disconnettere immediatamente
gli utenti che hanno ancora un token firmato con il vecchio.

---

## Procedura passo-passo

### Passo 1 — Genera il nuovo segreto

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Output esempio: 7k3Fq...Xp9= (copia questo valore)
```

### Passo 2 — Imposta le variabili d'ambiente su Railway

Vai su **Railway → Progetto → Variables** e modifica/aggiungi:

```
JWT_SECRET=<NUOVO_SEGRETO>
JWT_PREVIOUS_SECRETS=<VECCHIO_SEGRETO>
```

> Se stai ruotando per la seconda volta e hai già una `JWT_PREVIOUS_SECRETS`,
> concatena i vecchi segreti separati da virgola:
> `JWT_PREVIOUS_SECRETS=vecchio1,vecchio2`
> (max 2-3 segreti precedenti: più sono, più lento diventa `verifyJwt`).

### Passo 3 — Redeploy

Railway ridistribuisce automaticamente il servizio. Da questo momento:
- I **nuovi token** vengono firmati con `JWT_SECRET` nuovo.
- I **token esistenti** (firmati con il vecchio segreto) restano validi perché
  `verifyJwt` li verifica anche con `JWT_PREVIOUS_SECRETS`.

### Passo 4 — Attendi il TTL massimo delle sessioni

La durata massima di una sessione operatore è `DURATA_SESSIONE_OPERATORE_MINUTI`
(definita in `src/util/serverHelpers.ts`). Attendi almeno questo tempo prima di
procedere al passo 5, per essere sicuro che nessun token firmato con il vecchio
segreto sia ancora in circolazione.

> In produzione questa durata è tipicamente 60-480 minuti. Verifica il valore
> attuale nel file `src/util/serverHelpers.ts`.

### Passo 5 — Rimuovi `JWT_PREVIOUS_SECRETS`

Su Railway, rimuovi completamente la variabile `JWT_PREVIOUS_SECRETS`.
Redeploy. Da questo momento solo `JWT_SECRET` è accettato.

---

## Gestione dei Magic Link e degli OTP

I **Magic Link** (accesso portale cliente) usano SHA-256, non HMAC con `JWT_SECRET`.
Non sono influenzati dalla rotazione: continuano a funzionare finché non scadono
naturalmente (TTL proprio in tabella `magic_link`).

Gli **OTP** (firma elettronica) usano HMAC-SHA-256 con `JWT_SEGRETI[0]` (segreto
corrente). Un OTP emesso prima della rotazione diventerà non verificabile dopo il
redeploy — ma gli OTP hanno TTL di 10 minuti, quindi in pratica non è un problema.

Le **firme degli URL di download** (`/uploads/:filename?firma=...&scad=...`) vengono
generate e verificate con il segreto corrente. Un URL firmato prima della rotazione
e non ancora scaduto (TTL 7 giorni) non sarà più verificabile. Se questo è un
problema per il tuo caso d'uso, aggiungi il vecchio segreto anche a
`JWT_PREVIOUS_SECRETS` finché tutti gli URL precedenti non sono scaduti.

---

## Checklist di verifica post-rotazione

- [ ] Tutti gli operatori riescono a fare login con le proprie credenziali.
- [ ] Il portale cliente è accessibile via Magic Link.
- [ ] I download dei file (logo, allegati) funzionano correttamente.
- [ ] La Dashboard di AuditLog mostra i login effettuati dopo la rotazione.
- [ ] `GET /health` risponde `{ stato: 'ok' }`.

---

## Rotazione di emergenza (leak sospetto)

In caso di sospetto leak, la procedura è la stessa ma **senza** impostare
`JWT_PREVIOUS_SECRETS`: imposta solo il nuovo `JWT_SECRET` e fai redeploy.

Questo disconnette **immediatamente tutti gli utenti** (inclusi eventuali
attaccanti con token rubati). Gli utenti legittimi dovranno ri-autenticarsi.

```
# Emergency: nessuna grazia, revoca immediata di tutti i token
JWT_SECRET=<NUOVO_SEGRETO>
# JWT_PREVIOUS_SECRETS: NON impostare
```
