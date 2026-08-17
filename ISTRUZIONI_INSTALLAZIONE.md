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

## 🔑 Tabella Credenziali di Accesso Ufficiali

| Ruolo Attore | Email Registrata | Password di Accesso | Tipo Accesso |
| :--- | :--- | :--- | :--- |
| 👨‍💼 **Lead Advisor Senior** | `joe@bluecode.advisory` | `password123` | JWT Access Token |
| ⚖️ **Legal Counsel Advisor** | `mario.dibenedetto@bluecode.advisory` | `password123` | JWT Access Token |
| ⚖️ **Avv. Lorenzo Marino** | `lorenzo.marino@bluecode.advisory` | `password123` | JWT Access Token |
| 💶 **Dr. Elena Russo (Tax Advisor)** | `elena.russo@bluecode.advisory` | `password123` | JWT Access Token |
| 👑 **Super Admin** | `admin@bluecode.advisory` | `admin2026!` | JWT Access Token |
| 👷 **Operatore Studio** | `operator@bluecode.advisory` | `operator123` | JWT Access Token |
| 🔑 **Cliente Incarico** | `client@holdingbeta.advisory` | *Passwordless* | Magic Link `/portal` |

---

## 4. Connessione a Supabase PostgreSQL via CLI (Produzione)

1. Duplica `.env.example` in `.env`:
   ```bash
   cp .env.example .env
   ```
2. Incolla la tua stringa `DATABASE_URL` di Supabase PostgreSQL nel tuo file `.env` locale:
   ```env
   DATABASE_URL="postgresql://postgres:[YOUR-DB-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
   DIRECT_URL="postgresql://postgres:[YOUR-DB-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
   ```
3. Collega la CLI Supabase e sincronizza lo schema Prisma:
   ```bash
   # Collegamento CLI Supabase
   npx supabase link --project-ref cfdtjdrfeidbemhunilt

   # Genera Prisma Client & Applica lo Schema DB
   npx prisma generate
   npx prisma db push
   npx tsx prisma/seed.ts  # Popola i dati di seed master sul DB reale Supabase
   npm run start:db        # Server in ascolto col DB Supabase reale
   ```
