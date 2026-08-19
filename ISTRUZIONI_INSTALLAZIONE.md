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

Per accedere direttamente al **Portale Cliente Passwordless**, apri:
`http://localhost:5173/portal?magic_token=client_demo`

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
studio viene rifiutata con 409 invece di essere spostata di tenant.

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
