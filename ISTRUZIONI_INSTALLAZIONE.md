# 🏛 BluMan Advisory Platform — Istruzioni di Installazione & Avvio sul Nuovo PC

Guida passo-passo per scaricare, installare ed avviare l'applicazione sul tuo nuovo PC in meno di 5 minuti.

---

## 1. Prerequisiti
- **Node.js** (versione 18 o 20+ LTS). Verifica con:
  ```bash
  node -v
  ```
- **Git** installato ed un terminale (Mac Terminal / PowerShell).

---

## 2. Installazione sul NUOVO PC

### Opzione A: Da Repository GitHub (Consigliato)
```bash
# 1. Clona il repository
git clone https://github.com/mariobros1987/bluman.git
cd bluman

# 2. Installa le dipendenze del Backend e del Frontend
npm install
cd frontend && npm install && cd ..
```

### Opzione B: Da archivio ZIP (`bluman-api-backup.zip`)
1. Scompatta l'archivio `bluman-api-backup.zip` nella tua cartella di lavoro.
2. Apri il terminale nella cartella `bluman/`.
3. Esegui l'installazione delle dipendenze:
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

---

## 3. Avvio dei Server

Apri il terminale nella cartella principale del progetto:

### Step 1: Avvia il Backend Fastify API (:3000)
```bash
npx tsx src/index.ts
```
*Ti aspetti di vedere: `BluMan API in ascolto su http://127.0.0.1:3000`*

### Step 2: Avvia il Frontend React 19 Vite (:5173)
Apri una seconda finestra o tab del terminale:
```bash
cd frontend
npm run dev
```
*Apri il browser su: `http://localhost:5173`*

Per accedere al **Portale Cliente Passwordless** serve un Magic Link vero: l'indirizzo
`?magic_token=client_demo` non funziona più, ed è la correzione — quella stringa apriva una
sessione valida perché `POST /auth/magic-login` accettava qualunque valore che iniziasse per
`client_`. Il link lo emette lo studio, dalla scheda del cliente:

```bash
# Autenticato come advisor o super_admin del tenant del cliente:
curl -s -X POST http://127.0.0.1:3000/clienti/<ID_CLIENTE>/magic-link \
     -H "Authorization: Bearer <JWT>" -H 'Content-Type: application/json' \
     -d '{"email":"cliente@esempio.it"}'
# → { "magicUrl": "http://localhost:5173/portal?magic_token=client_...", "scadenza": "..." }
```

Dall'interfaccia: **Clienti → riga del cliente → Magic Link**, inserendo l'indirizzo a cui
inviarlo. Il token in chiaro esiste solo in quella risposta e nell'email: in tabella
(`magic_link`) c'è il suo SHA-256, quindi non è recuperabile dopo. Scade dopo 7 giorni e il
primo login valido lo consuma atomicamente; riaperture, link scaduti o revocati vengono
rifiutati. Cambio e reset password revocano inoltre i link ancora attivi e invalidano le
sessioni precedenti incrementando `sessionVersion`.

---

## 🔑 Accesso: come si ottengono le credenziali

Non esiste nessuna credenziale precaricata, né in questo file né nel codice (§23). Fino
alla Fase 0 `src/server.ts` accettava una tabella di utenti e password scritti nel
sorgente: chiunque leggesse il repository su GitHub poteva entrare in produzione. Sono
stati rimossi, e con loro la tabella che stava qui.

L'unica fonte di verità per le credenziali è la tabella `user` del database.

**Primo accesso su un database vuoto** — crea il primo `super_admin` (§27):

```bash
# In .env: BOOTSTRAP_EMAIL="tua.email@studio.example"
npm run bootstrap
```

Lo script stampa **una sola volta** una password temporanea: non viene salvata in chiaro
da nessuna parte né inviata per email. Copiala subito.

**Utenti già presenti in database senza password** — è il caso degli utenti creati dai
seed, che avevano `password_hash` a NULL e dopo la rimozione degli utenti cablati non
potrebbero più autenticarsi:

```bash
npm run passwords:assign            # solo chi non ha una password
npm run passwords:assign -- --force # rigenera per tutti (invalida quelle in uso)
```

**Nuovi collaboratori** — li crea il `super_admin` o il responsabile dello studio dalla
dashboard (`POST /tenant/utenti`), che restituisce la password temporanea da consegnare a
mano. La gerarchia è quella di §2bis:

| Ruolo | Ambito |
| :--- | :--- |
| 👑 `super_admin` | Gestisce tutto e vede tutti i tenant (`tenant_id` NULL). Può cambiare studio corrente. |
| 👨‍💼 `advisor` | Responsabile del proprio tenant. Crea e gestisce collaboratori solo nel proprio studio. |
| 👷 `collaboratore_interno` / `collaboratore_esterno` | Appartengono al tenant da cui vengono creati e non ne escono. |
| 🔑 `cliente` | Passwordless: accede solo via Magic Link su `/portal`, mai da `/auth/login`. |

Un `advisor` non può creare un `super_admin`, e un'email già registrata presso un altro
studio viene rifiutata con 409 invece di essere spostata di tenant. Una riga che è già
`super_admin` la può modificare solo un `super_admin`: 403 per tutti gli altri.

**Prima di ogni rilascio, chiediti se qualcuno potrà ancora entrare:**

```bash
npx tsx src/scripts/verificaAccessi.ts
```

Elenca ruolo, tenant e presenza/assenza di `password_hash` — mai l'hash — ed esce con
codice 1 se non esiste un `super_admin` attivo con password. Un deploy che chiude
correttamente l'autenticazione, su un database dove nessuno ha una password, blocca la
piattaforma fuori da sé stessa. La domanda va posta prima, non scoperta dopo.

Nell'elenco i `super_admin` devono comparire con `tutti i tenant`, non con un id di tenant:
`user.tenant_id` NULL è l'invariante su cui si appoggia la policy RLS di `user`. Se un
super admin risulta dentro uno studio, l'advisor di quello studio può modificarlo — è il
guasto chiuso dalla migrazione `20260819190000_super_admin_senza_tenant`.

**Nuovi studi (solo `super_admin`)** — `POST /admin/tenants` registra lo studio **e** la
riga `user` del responsabile con ruolo `advisor`, restituendo la sua password temporanea
una volta sola. Se va perduta, `POST /admin/tenants/:id/reset-password` ne genera un'altra.
Nella dashboard Super Admin il modale la mostra una volta e non la conserva: non torna
dall'elenco, non finisce nel `localStorage`, non è rileggibile.

> La password la emette **sempre** il server. Non esiste un campo per proporne una, non
> esiste un valore di ripiego, e il database ne conserva soltanto l'hash scrypt. Anche una
> password di default annunciata dall'API sarebbe una password valida per chiunque legga la
> risposta o il sorgente, quindi non ce ne sono: `src/credenziali.test.ts` scandisce `src/`,
> `frontend/src/` e `api/` e fallisce se ne ricompare una.

---

## 🚧 Perché serve un login anche in locale

Il server respinge con `401` qualunque richiesta priva di un JWT verificabile: l'elenco
delle rotte pubbliche è breve (`/health`, `/auth/login`, `/auth/magic-login`, i webhook di
canale, il portale cliente) e tutto il resto è protetto per difetto.

In pratica: dopo `npx tsx src/index.ts` un `curl http://127.0.0.1:3000/clienti` risponde
`401 {"errore":"Non autenticato"}`, ed è corretto. Serve prima un token:

```bash
curl -s -X POST http://127.0.0.1:3000/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"tua.email@studio.example","password":"LA-TUA-PASSWORD"}'
# poi:  curl http://127.0.0.1:3000/clienti -H "Authorization: Bearer <token>"
```

Dal browser non serve nulla di manuale: la pagina di login lo ottiene e lo mette in
`localStorage`.

---

## 4. Connessione a Supabase PostgreSQL via CLI (Produzione)

1. Duplica `.env.example` in `.env`:
   ```bash
   cp .env.example .env
   ```
2. Compila le **tre** connection string. Sono tre ruoli diversi di proposito (§14):
   ```env
   # Runtime: ruolo applicativo, soggetto alle policy RLS. Vede solo il tenant della
   # richiesta in corso; senza contesto tenant non legge nulla.
   DATABASE_URL="postgresql://bluman_app.[PROJECT-REF]:[APP-PASSWORD]@[POOLER-HOST]:5432/postgres"
   # Migrazioni Prisma: ruolo proprietario dello schema.
   DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
   # Manutenzione, seed, bootstrap, backup e ricerca utente al login: scavalca RLS.
   ADMIN_DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
   ```
3. Crea il ruolo applicativo e le policy RLS (una volta per database):
   ```bash
   PW=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,28))")
   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \
        -f supabase/migrations/20260819_rls_effettiva.sql
   # Metti $PW in DATABASE_URL, poi verifica:
   npx tsx src/scripts/checkRls.ts
   ```
   `checkRls` deve mostrare `current_user: bluman_app`, `bypassa_rls: false`, RLS attivo e
   forzato su tutte le tabelle, e **0 clienti visibili** con un tenant inesistente.
   Serve `psql` perché la migrazione usa `\gexec` per creare il ruolo senza stampare la
   password.
4. Collega la CLI Supabase e applica lo schema Prisma:
   ```bash
   # Collegamento CLI Supabase
   npx supabase link --project-ref cfdtjdrfeidbemhunilt

   # Genera Prisma Client & applica le migrazioni versionate
   npx prisma generate
   npx prisma migrate deploy   # NON `db push`: vedi nota qui sotto
   npm run seed                # Popola i dati di seed master sul DB reale Supabase
   npm run start:db            # Server in ascolto col DB Supabase reale
   ```

> ⚠️ **Mai `prisma db push --accept-data-loss` su un database con dati reali.** Riallinea
> lo schema cancellando in silenzio colonne e tabelle non presenti nel file. Era il comando
> di avvio del container su Railway: ora il `Dockerfile` esegue `prisma migrate deploy`, che
> applica solo le migrazioni versionate in `prisma/migrations/` e si ferma se il database è
> in uno stato che non riconosce.
>
> Le migrazioni P0 per `sessionVersion` e `WebhookInbox` sono presenti nel repository ma non
> risultano applicate. Eseguire prima backup e prova in staging, verificare login operatore e
> cliente, revoca delle sessioni, consumo monouso dei Magic Link e webhook firmati; solo dopo
> promuovere le stesse migrazioni in produzione con un'autorizzazione operativa separata.

---

## 5. Variabili d'Ambiente su Railway (Backend in Produzione)

Il servizio `bluman-api` del progetto Railway `bluman-backend` punta a **Supabase**, non
più al Postgres di Railway (che resta in piedi ma inutilizzato). Le tre connection string
sono le stesse tre di §14, con gli stessi tre ruoli distinti:

```bash
railway variable set "DATABASE_URL=postgresql://bluman_app.[REF]:[APP-PW]@[POOLER]:5432/postgres" \
                     --service bluman-api --skip-deploys
railway variable set "DIRECT_URL=postgresql://postgres.[REF]:[DB-PW]@[POOLER]:5432/postgres" \
                     --service bluman-api --skip-deploys
railway variable set "ADMIN_DATABASE_URL=postgresql://postgres.[REF]:[DB-PW]@[POOLER]:5432/postgres" \
                     --service bluman-api --skip-deploys
railway variables --service bluman-api --json   # verifica
```

Tre avvertenze pratiche, tutte imparate sul campo:

- **`--skip-deploys`** è voluto: senza di esso ogni `set` fa ripartire il servizio, quindi
  tre variabili significherebbero tre riavvii, i primi due con la configurazione a metà.
  Le variabili nuove entrano in vigore al deploy successivo.
- **Non passare il valore per stdin da PowerShell.** `$v | railway variable set K --stdin`
  premette un BOM UTF-8 al valore: la variabile diventa `﻿postgresql://…` e la
  connessione fallisce con un errore di schema che non nomina il BOM. Passare il valore come
  argomento (`railway variable set "K=$v"`) evita il problema.
- **`JWT_SECRET` (≥32 caratteri) è obbligatorio.** Senza, il server non si arresta —
  `NODE_ENV` non è impostato nel `Dockerfile` — ma genera un segreto casuale a ogni
  processo: **tutti i token in circolazione vengono invalidati a ogni redeploy.**
- **`APP_BASE_URL` è l'origin pubblico del frontend** (es. `https://bluman.vercel.app`, senza
  barra finale). Ci finiscono dentro i link inviati per email, primo fra tutti il Magic Link
  del portale cliente: era cablato a `http://localhost:5173`, quindi ogni link spedito dalla
  produzione portava alla macchina di chi apriva l'email. Con `NODE_ENV=production` la sua
  assenza è ora un errore all'emissione del link, non un default silenzioso.

Dopo il deploy, la verifica che conta la fa il ruolo di runtime:

```bash
npx tsx src/scripts/checkRls.ts
```

Deve mostrare `current_user: bluman_app`, `bypassa_rls: false`, RLS attivo **e forzato** su
tutte e 34 le tabelle applicative (`_prisma_migrations` esclusa, correttamente) e **0
clienti visibili** con un tenant inesistente.

---

### Railway Cron per le notifiche quotidiane (configurazione prevista)

Le notifiche in-app sulle scadenze dovranno essere generate da un **servizio Railway Cron separato** dal processo web. Non avviare timer nel server Fastify: restart, sleep e repliche potrebbero perdere o duplicare esecuzioni.

Il worker tenant-scoped è disponibile in `src/services/cronService.ts`; il runner CLI è `src/scripts/runDailyNotificationCron.ts` e si avvia con `npm run cron:notifiche`. Il comando elabora tutti i tenant attivi e può creare notifiche persistenti: provarlo su un ambiente controllato prima di abilitarne la pianificazione in produzione.

Configurare un secondo servizio dallo stesso repository con le medesime `DATABASE_URL`, `DIRECT_URL` e `ADMIN_DATABASE_URL` del backend, impostare come start command `npm run cron:notifiche` e pianificarlo ogni giorno alle **08:00 Europe/Rome**. Railway usa espressioni cron in UTC: verificare l’orario UTC desiderato quando cambia l’ora legale.

Il runner amministrativo legge soltanto i tenant con `stato: 'attivo'`; ogni tenant viene poi elaborato tramite il client Prisma condiviso dentro un contesto RLS esplicito. Se almeno un tenant fallisce, il comando termina con exit code non zero e Railway registra l’esecuzione come fallita. Le notifiche prodotte sono persistite in-app; la futura coda email/WhatsApp con retry è un’attività separata e non va considerata già implementata.

---

## 6. Avanzamento dei Progetti: Verifica e Ricalcolo (§16)

Stati e percentuali non li decide più il frontend. `GET /progetti` e `GET /progetti/:id`
restituiscono un oggetto `avanzamento` (stato, percentuale, `segnaleRischio`, `oreExtra`)
per il progetto **e per ciascun modulo**, calcolato da `src/services/calcoloService.ts`
sulle ore realmente consuntivate. Non c'è nulla da installare né da migrare: le percentuali
derivano da colonne che esistono già.

**Guarda prima di scrivere.** Dopo un'importazione, una correzione fatta a mano a database o
una modifica alle regole del motore, questo script dice esattamente quali righe un ricalcolo
cambierebbe — e non ne cambia nessuna:

```bash
npx tsx src/scripts/probeAvanzamento.ts
```

Stampa, progetto per progetto, `stato in riga` contro `calcolato`, la percentuale, i moduli
con il numero di micro-voci, e in coda il conteggio delle righe divergenti. Le righe marcate
`<-- CAMBIA` sono quelle che un ricalcolo riscriverebbe.

**Il ricalcolo che scrive** è una rotta autenticata, non uno script:

```bash
curl -s -X POST http://127.0.0.1:3000/progetti/<ID-PROGETTO>/ricalcola \
     -H "Authorization: Bearer <token>"
```

Persiste la cascata verso l'alto — micro-voce → modulo → progetto — e scrive **solo** dove il
valore calcolato differisce da quello in riga: un ricalcolo che riscrive valori identici
sporcherebbe `updatedAt` e renderebbe indistinguibile "lo stato è cambiato" da "qualcuno ha
premuto ricalcola". Ogni esecuzione lascia una riga di audit `PROGETTO_RICALCOLATO`.

Due cose che il ricalcolo **non** fa, di proposito:

- **Non tocca lo stato delle micro-voci.** La cascata sale, non scende (§16.6): una
  micro-voce cambia stato solo per azione esplicita (consuntivazione, ritardo, chiusura).
- **Non declassa un modulo senza micro-voci.** `calcolaStatoModulo([])` risponde `pending`,
  che è giusto per un modulo appena creato e sbagliato per uno chiuso a mano: la riga è
  l'unica fonte di informazione e sovrascriverla cancellerebbe un dato irrecuperabile. Il
  probe li segnala a parte (`0 micro-voci: non ricalcolabile, riga preservata`) proprio
  perché il loro stato non ha alcuna copertura di controllo — se ne trovi, la correzione è
  aggiungere le micro-voci, non ricalcolare.

---

## 7. Disaster Recovery & Backup Schedulato Cifrato AES-256-GCM (§5.2)

Per eseguire l'esportazione di emergenza o il backup schedulato di tutti i tenant attivi con cifratura AES-256-GCM:

```bash
# Esecuzione del backup schedulato cifrato con retention a 14 giorni
npm run backup:scheduled
```

- Salva file protetti `.enc` in `backups/` con struttura crittografica: `IV (12 byte) || AuthTag (16 byte) || Ciphertext`.
- Esclude gli hash password degli utenti (conserva solo dati operativi e contabili).
- In ambiente di produzione richiede la variabile d'ambiente `BACKUP_ENCRYPTION_KEY` (stringa esadecimale a 64 caratteri, 32 byte).

---

## 8. Redis & Rate Limiting Distribuito (§4.2, §INF-1)

Il backend Fastify supporta la scalabilità orizzontale multi-container tramite Redis:
- Impostando `REDIS_URL` (es. `redis://default:password@host:6379`), `@fastify/rate-limit` utilizza lo store distribuito Redis e la cache multi-layer di catalogo (`src/services/backendCache.ts`).
- Se `REDIS_URL` non è valorizzata (sviluppo locale), il server effettua il fallback trasparente in-memory senza richiedere configurazioni aggiuntive.
