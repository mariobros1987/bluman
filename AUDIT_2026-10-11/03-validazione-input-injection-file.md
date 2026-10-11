# 03 · Validazione input, injection & file — 11/10/2026

> Audit avversariale a mano. Ogni rilievo cita `file:riga` su codice letto.

## Sintesi

Le superfici classiche di iniezione sono difese bene: **nessun SQL raw nelle rotte servite**
(tutti i `$queryRawUnsafe`/`$executeRawUnsafe` stanno in `src/scripts/**` e in `checkRls.ts`,
mai in `src/routes/**` — Prisma parametrizza), il download file ha **tre reti** contro il path
traversal (regex sul nome, prefisso-tenant, contenimento del percorso risolto), e il relay
email ha un segreto condiviso. Il punto migliorabile è la **validazione dei body**: 30 handler
leggono `req.body` come `Record<string, any>` ed estraggono i campi a mano, senza uno schema
`zod` che rifiuti a monte una richiesta malformata.

## Rilievi

### [Severità Media] Body non validati con schema su rotte sensibili (`Record<string, any>`)

- **Descrizione.** 30 handler tipizzano il corpo come `Record<string, any>` e selezionano i campi
  manualmente. Dove la selezione è esplicita (es. `POST /admin/tenants`, `tenant.ts:1077-1095`,
  mappa campo per campo e **non** fa spread del body in `prisma.create`) il rischio è contenuto;
  ma la mancanza di uno schema significa che tipi inattesi, campi extra e payload fuori forma
  arrivano fino alla logica, e un domani un `create({ data: b })` introdotto per fretta diventerebbe
  un mass-assignment. È difesa in profondità mancante, non un buco attivo che ho potuto dimostrare.
- **File.** `src/routes/tenant.ts`, `src/routes/clienti.ts`, `src/routes/kyc.ts`,
  `src/routes/progetti.ts`, `src/routes/notifiche.ts`, `src/routes/webhooks.ts` (30 occorrenze di
  `Body: Record<string, any>`).
- **Come sfruttarlo.** Non ho trovato un mass-assignment sfruttabile oggi (gli handler mappano i
  campi); il rischio è di regressione futura e di payload malformati non respinti a monte.
- **Verifica mirata (11/10/2026).** Ho cercato il pattern pericoloso — lo spread del body dentro
  Prisma (`data: b` / `data: { ...b }` in `create`/`update`) — su tutte le rotte: **nessuna
  occorrenza**. L'unico match è `contabilitaPrimaNota.ts:121` (`data: body.data ? new Date(...)`),
  che è un campo di nome `data` (una data), non uno spread. Quindi oggi **non c'è un
  mass-assignment sfruttabile**: il rilievo resta difesa in profondità, non un buco. Per questo lo
  `zod` va introdotto come passata deliberata e testata (a partire da tenant/admin e KYC), non con
  una riscrittura cieca dei 30 handler — che cambierebbe il comportamento di rotte in produzione
  senza un guadagno di sicurezza immediato.

### [Severità Bassa] File storici senza prefisso-tenant leggibili da qualunque studio autenticato

- **Descrizione.** Il download verifica l'appartenenza al tenant dal prefisso del nome file
  (`<tenantId>_...`). I file **storici senza prefisso** (loghi, allegati pre-isolamento) sono
  un'eccezione deliberata e restano leggibili da qualunque operatore autenticato di qualunque
  studio. È documentato e accettato, ma resta una lettura cross-tenant residua su un insieme chiuso.
- **File.** `src/routes/catalogo.ts:201-216` (il controllo scatta solo se `tenantDelFile` è valorizzato).
- **Come sfruttarlo.** Un operatore dello studio A che conosca il nome di un vecchio file senza
  prefisso dello studio B lo scaricherebbe. Richiede di indovinare un nome storico preciso.
- **Rimedio.** Censire i file senza prefisso e rinominarli col tenant di appartenenza (o spostarli
  in una cartella per-tenant), così l'eccezione si chiude invece di restare aperta a tempo indefinito.

### [Severità Bassa] Molte rotte senza rate-limit dedicato oltre a login/OTP

- **Descrizione.** Il rate-limit mirato (5–10/min) copre bene i flussi di autenticazione
  (`auth.ts:58,203,283,599,657,719,813`), ma le rotte applicative si affidano al solo limiter
  globale. Per endpoint costosi (export, generazione documenti/PDF) un abuso autenticato può pesare.
- **File.** `src/server.ts:354` (limiter globale); assenza di `config.rateLimit` sulle rotte di export/PDF.
- **Come sfruttarlo.** Un utente autenticato che martella un endpoint di export consuma risorse
  oltre la soglia pensata per il login.
- **Rimedio.** Aggiungere `config: { rateLimit: {...} }` agli endpoint pesanti, con soglie coerenti
  al costo reale.

## Note positive (verificate, nessun rilievo)

- **Nessun SQL raw nelle rotte**: `grep` di `queryRawUnsafe`/`executeRawUnsafe` dà solo
  `src/scripts/**` e `src/scripts/checkRls.ts`. Le rotte usano Prisma, che parametrizza.
- **Path traversal**: `src/routes/catalogo.ts:187-225` — `nomeFileValido` + controllo prefisso-tenant
  + contenimento del percorso risolto sotto `CARTELLA_UPLOADS` (`path.resolve(...).startsWith(radice + sep)`).
- **Firma HMAC dei download**: emessa dal server, scoping sul nome file, scadenza (`verificaFirmaDownload`).
- **Webhook fail-closed**: la verifica firma e il comportamento fail-closed sono presidiati da
  `src/webhooksSicurezza.test.ts`.

## Conteggio: 0 Alta, 1 Media, 2 Bassa.
