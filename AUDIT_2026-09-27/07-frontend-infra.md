# 07 — Frontend & Infra/Deploy

Auditor senior · 2026-09-27 · Area: Frontend trasversale (architettura) + Infrastruttura/Deploy/CI.
Fonte: lettura del codice reale (`file:riga`), con `.agents/AGENTS.md` usato solo come mappa.

---

## Come funziona & logica applicata

### A) Come il frontend trova il backend
`frontend/src/api/http.ts` centralizza tutto. `getApiBase()` (`http.ts:29-50`) legge `VITE_API_BASE`; se manca usa `http://localhost:3000` in locale, altrimenti l'host Railway cablato (`http.ts:5`). Due difese §34: `normalizzaBase()` (`http.ts:25-27`) taglia la barra finale (che darebbe `//documenti/genera`, un 404 di Fastify) e una base **uguale all'origine della pagina** viene **rifiutata** con errore in console (`http.ts:36-43`) perché su quel dominio Vercel riscrive tutto su `/index.html`. Coerentemente `apiFetch()` (`http.ts:114-123`) solleva un errore parlante se la risposta è `text/html`: nessuna rotta API risponde HTML, quindi quella è la prova che la richiesta non ha raggiunto il backend (e un 200 HTML passava per «salvato»).

Sessione: `fetchWithTimeout()` (`http.ts:55-91`) rinnova il JWT dall'header `X-Bluman-Token` (rinnovo scorrevole) e distingue portale (`bluman_portal_token`) da staff (`bluman_jwt_token`); su 401 emette l'evento `bluman_unauthorized` (staff) o `bluman_portal_unauthorized` (portale con sessione preesistente). `getAuthHeaders()` (`http.ts:162-182`) non manda alcun token di ripiego (§23: rimosso `jwt_advisor_mock_123`) e allega `x-tenant-id`. `conCorpoCoerente()` (`http.ts:139-160`) evita il rifiuto Fastify «Body cannot be empty» inviando `{}` sulle POST senza corpo.

### B) Caching & deduplicazione
`frontend/src/api/cache.ts`: `cachedQuery()` (`cache.ts:31-66`) serve dalla cache in-memory se fresca (TTL default 30s, `cache.ts:36`), altrimenti deduplica le richieste in volo condividendo la stessa Promise (`cache.ts:48-50`). `invalidateCache()` (`cache.ts:72-86`) invalida per pattern o svuota tutto. Isolamento tenant: i listener azzerano l'intera cache su `tenant_changed` e `bluman_unauthorized` (`cache.ts:91-94`); il logout la svuota anche esplicitamente (`App.tsx:99`).

### C) RBAC che filtra la UI
`frontend/src/utils/rbac.ts` `getUserPermission()`: super_admin sempre `write`, dashboard sempre `write` (`rbac.ts:7-8`), poi override letti da **localStorage** (`rbac.ts:15-37`) e infine default per ruolo (`rbac.ts:40-61`). La Sidebar filtra le voci (`Sidebar.tsx:55-62`) e `App.tsx` avvolge le pagine in `ProtectedModule` (`App.tsx:37-57`, che mostra un pannello «Modulo Bloccato» con via d'uscita — regola 13). L'enforcement **vero** è però server-side (hook `onRequest`), come da mappa: la UI è solo cosmetica.

### D) Isolamento tenant lato client
`frontend/src/utils/tenant.ts`: `getCurrentTenantId()` (`tenant.ts:84-111`) vincola i non-super_admin al proprio `tenantId` e ha rimosso l'euristica email→tenant. `getTenantStorageKey()` (`tenant.ts:116-119`) isola le chiavi localStorage per tenant. Cruciale: `CHIAVI_SEGRETE_TENANT` (`tenant.ts:212-218`) + `senzaSegretiTenant()` (`tenant.ts:221-231`) tengono `smtpPass`, `imapPass`, `waAccessToken`, `waVerifyToken`, `tgBotToken` **fuori** da localStorage (salvati solo come flag `<chiave>Impostata`). `saveTenantInfoToStorage()` (`tenant.ts:248-282`) applica lo strip prima di scrivere.

### E) Autenticazione UI
`LoginPage.tsx`: campi vuoti (rimosse le scorciatoie con credenziali reali, `LoginPage.tsx:11-13,138-145`), flusso 2FA a due step con `preToken` e countdown 120s (`LoginPage.tsx:31-47,84-108`). `App.tsx` gestisce sessione: `fetchMeApi()` riallinea `mustChangePassword`/`stato` (`App.tsx:114-142`) e `MustChangePasswordModal` blocca lo schermo se `mustChangePassword || stato==='invitato'` (`AppLayout.tsx:308-315`). Logout pulisce token+tenant+cache (`App.tsx:89-104`).

### F) Sentry / stati limite / design token
`utils/sentry.ts` è opt-in per costruzione: senza `VITE_SENTRY_DSN` l'SDK non viene caricato (import dinamico, `sentry.ts:27-42`); `tracesSampleRate:0`, `sendDefaultPii:false`. Design system: i componenti usano token CSS (`var(--...)`) coerentemente (Sidebar/AppLayout/LoginPage), niente esadecimali improvvisati salvo poche ombre RGBA.

### G) Pipeline di deploy
Backend: `Dockerfile` gira come utente `node` non-root (`Dockerfile:16-17`), CMD `prisma migrate deploy && tsx src/index.ts` (`Dockerfile:34`) → **le migrazioni si applicano all'avvio del container** (versionate, mai `db push`). Railway è collegato a GitHub `main` (`.railway/railway.ts:5-9`): `git push origin main` auto-deploya backend + frontend Vercel. `vercel.json` builda il frontend e riscrive tutto su `/index.html` tranne `/api/send-email`. Stack VPS alternativo (`docker-compose.prod.yml`): avvio deterministico `postgres → migrate → rls → api`, con l'app che gira come ruolo `bluman_app` **senza** bypassrls (RLS provisionato dallo stack, regola 1); segreti fail-closed `${VAR:?}`. `nginx.conf` proxa `/uploads/` all'API (mai statico) e genera i prefissi API dai percorsi reali. Cron: `runDailyNotificationCron.ts` gira per ogni tenant attivo (07:00 UTC) con contesto RLS per studio. CI (`.github/workflows/ci.yml`): typecheck+vitest+build backend, lint+test+typecheck+build frontend.

---

## Rilievi d'audit

**[ALTO] Il backup di disaster recovery non è operativo in produzione**
`runScheduledBackup.ts` scrive i `.enc` in `backups/` sotto `process.cwd()` (`runScheduledBackup.ts:173`), ma su Railway il filesystem è effimero: l'unico volume persistente è `/app/uploads` (`.railway/railway.ts:39-40`). Inoltre `.railway/railway.ts` **non dichiara alcun servizio o cron** che lanci `backup:scheduled` — definisce solo `bluman-api`, `cron-notifiche` (che esegue `runDailyNotificationCron`, non il backup) e Redis (`railway.ts:38-82`) — e `BACKUP_ENCRYPTION_KEY` non è tra le env preservate (`railway.ts:42-57`). Impatto: il backup cifrato documentato come attivo (retention 14gg) di fatto **non gira** in produzione, e anche se lanciato a mano i file andrebbero persi al primo redeploy. Nessun DR reale dei dati studio/clienti. Rimedio: servizio Railway cron dedicato che scrive su storage off-site (S3/Supabase Storage, non filesystem locale) + `BACKUP_ENCRYPTION_KEY` nell'ambiente + un restore drill periodico (`restoreDbTest.ts` esiste ma va schedulato).

**[MEDIO-ALTO] La CI non è un cancello di deploy: un `main` rotto va in produzione**
Railway (auto-deploy da GitHub `main`, `railway.ts:5-9`) e Vercel (webhook su push) costruiscono **indipendentemente** dall'esito di `.github/workflows/ci.yml`. Un `git push origin main` con typecheck o vitest rossi viene comunque deployato. La regola 9 riconosce «main deve restare deployabile» ma affida il gate solo a `scripts/distribuisci.sh` (opzionale, e la maggior parte dei push non lo usa). Impatto: la sola disciplina umana separa un commit rotto dalla produzione. `file:` `.github/workflows/ci.yml:3-7`, `.railway/railway.ts:5-9`. Rimedio: branch protection su `main` con CI «required» e, su Railway, «Wait for CI» / deploy solo dopo check verdi.

**[MEDIO] Vicolo cieco: `/admin/tenants` renderizzata a qualsiasi utente autenticato**
In `App.tsx:190` la rotta `/admin/tenants` è dichiarata **senza** `ProtectedModule` e **senza** condizione su `super_admin` (a differenza di tutte le altre). La Sidebar la mostra solo al super_admin (`Sidebar.tsx:49-50,57`), ma la navigazione diretta all'URL carica `SuperAdminPage` per un advisor/collaboratore. Il server risponde 403 (`soloSuperAdmin`), quindi **nessun dato esce**, ma l'utente vede stati d'errore invece del pannello «Modulo Bloccato» previsto per gli altri moduli (regola 13, nessun vicolo cieco). Rimedio: avvolgere la rotta in un guard `admin`/super_admin coerente con le altre.

**[MEDIO] HTTPS opzionale e disattivo di default nello stack VPS**
In `nginx.conf` il redirect 301→HTTPS (`nginx.conf:43`) e l'intero blocco `:443` (`nginx.conf:54-72`) sono **commentati** di default. È necessario per il primo avvio (il cert non esiste ancora), ma se l'operatore dimentica di scommentarli dopo l'emissione, JWT e documenti del vault viaggiano in chiaro su `:80` — il file stesso lo avverte (`nginx.conf:42`). Impatto: sicurezza del trasporto affidata alla memoria dell'operatore. Rimedio: procedura di post-provisioning che verifica l'attivazione TLS, o script che scommenta e ricarica nginx dopo `certbot`.

**[MEDIO] RBAC UI su localStorage con default permissivo**
`getUserPermission()` legge la matrice permessi da **localStorage** (`rbac.ts:15-37`) e in assenza di righe concede l'accesso per ruolo (advisor → `write` su quasi tutto, `rbac.ts:40-47`). Coerente col server (default permissivo documentato), ma: (a) una modifica dei permessi fatta da un'altra postazione non si riflette finché non si ricarica; (b) localStorage è manipolabile dall'utente. È solo cosmetica (l'enforcement vero è l'hook server-side), quindi non è una falla di sicurezza, ma è fragile. Rimedio già indicato in mappa: leggere la matrice dal server.

**[BASSO] CORS `*.vercel.app` con `credentials: true`**
`server.ts:249,255-257` ammette qualunque sottodominio `*.vercel.app` (suffix-match) con `credentials:true` (`server.ts:278`). Rischio pratico basso perché il JWT sta in localStorage e viaggia in header `Authorization` (un sito cross-origin non può leggere il localStorage di `bluman.vercel.app` né forgiare l'header), ma resta una superficie ampia: qualsiasi progetto ospitato su `*.vercel.app` è un'origine ammessa. Rimedio: restringere alle origin di produzione note via `CORS_ORIGINS`, rimuovendo il jolly dal default.

**[BASSO] Build Vercel non riproducibile**
`vercel.json:3` usa `npm install --include=dev` invece di `npm ci`: non rispetta rigorosamente il lockfile e può tirare versioni diverse tra build. (Scelta nota per includere i devDeps di build.) Rimedio: `npm ci --include=dev`.

**[BASSO] Standby moduli non-KYC è solo client-side**
`getModuliDisattivati()` (`tenant.ts:237-246`) è letto solo dalla Sidebar per nascondere le voci (`Sidebar.tsx:54-59`). Per il modulo KYC esiste il gating server-side (`guardiaModuli`, da mappa), ma per gli altri moduli lo standby è puramente estetico: le rotte restano raggiungibili con un JWT valido. Rimedio: se lo standby deve avere valore di sicurezza, enforcarlo lato server; altrimenti documentarlo come preferenza di visualizzazione.

**Note positive verificate (non rilievi)**
- Nessuna credenziale/segreto nel bundle: token di ripiego rimossi (`http.ts:162-182`), segreti fuori da localStorage (`tenant.ts:212-231`); il testo che nomina App Secret/Verify Token in `pdfGenerator.ts:285-321` è **istruzione all'utente**, non un valore cablato.
- Guard auth fail-closed con **elenco di rotte pubbliche** (`server.ts:203-231,481-482`); `/docs` protetto in produzione con verifica ruolo advisor/super_admin (`server.ts:467-476`).
- Helmet + CSP `default-src 'none'` su ogni risposta (`server.ts:289-298`); verifica identità JWT contro il DB fail-closed (`server.ts:446-451`).
- Nessun ripiego che «inventa dati» (regola 7) trovato nei file trasversali: l'euristica in `AppLayout.tsx:49-53` è un fallback legittimo per righe notifica legacy, non dati fabbricati.
- Sonda di deploy 401-vs-404 in `distribuisci.sh:196-204` e health check post-deploy.

---

## Domande aperte / da verificare col titolare

1. **Backup DR**: confermare se esiste un meccanismo di backup del DB **fuori** da questa app (es. backup automatici di Supabase). Se sì, `runScheduledBackup.ts` è ridondante e va o rimosso o reso operativo/off-site; se no, è un rischio ALTO da chiudere (nessun DR).
2. **Gate CI/deploy**: si vuole attivare branch protection su `main` con CI obbligatoria prima dell'auto-deploy Railway/Vercel? Oggi un push rosso va in produzione.
3. **Drift schema/migrazioni**: eseguire `npx prisma migrate diff` (o una corsa E2E) per confermare che `schema.prisma` e `prisma/migrations/` siano allineati come dopo la fix `20260915172000` — non l'ho verificato in questa sessione e la suite E2E è l'unico posto che lo cattura.
4. **Restore drill**: `restoreDbTest.ts` è schedulato/eseguito periodicamente o solo come test manuale? Un backup senza restore provato non è un DR.
5. **TLS VPS**: lo stack `docker-compose.prod.yml` è già in uso su un VPS reale o resta il piano futuro? Se in uso, verificare che il blocco `:443` di `nginx.conf` sia stato scommentato.
6. **CORS**: si può restringere `*.vercel.app` alle sole origin di produzione, o servono i preview deploy Vercel come origini ammesse?
