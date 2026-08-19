# 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)

Questo file contiene il contesto completo, le regole di sviluppo tassative ed il prompt di avvio pronto da copiare ed incollare nella finestra dell'IA sul nuovo computer.

---

## 📋 PROMPT DA COPIARE ED INCOLLARE ALLA NUOVA IA:

```text
Ciao! Sto lavorando sulla piattaforma BluMan Advisory (ERP per Studi di Consulenza, Corporate Structuring, Trust e Tax Planning). 

Repository GitHub: https://github.com/mariobros1987/bluman
Stack: React 19 + TypeScript + Fastify API + Prisma ORM + Supabase PostgreSQL + Graphify.

REGOLE TASSATIVE DA SEGUIRE RIGOROSAMENTE:
1. Isolamento Multi-Tenant Tassativo (tenant_id): I dati tra i vari Tenant/Studi non si devono MAI mischiare. Il filtro applicativo su tenant_id non basta e non è la difesa: è RLS che lo è. Nel codice che serve una richiesta HTTP usa `prisma` da src/util/prismaClient.ts, mai `new PrismaClient()`; `prismaAmministrativo()` scavalca le policy ed è ammesso solo in script, seed, bootstrap, backup e nella ricerca utente al login. Verifica con `npx tsx src/scripts/checkRls.ts`.
2. Migrazioni Versionate: lo schema si cambia con `prisma migrate dev` / `prisma migrate deploy`. MAI `prisma db push --accept-data-loss` su un database con dati reali: riallinea lo schema cancellando in silenzio colonne e tabelle.
3. Sincronizzazione Database & Persistenza Cloud Tassativa: Tutto quello che viene aggiunto o modificato nell'interfaccia (spunte, passaggi, note, scadenze, assegnazioni) deve essere tassativamente salvabile e collegato al database PostgreSQL via API Fastify. Non possiamo permetterci di perdere dati. Aggiorna sia prisma/schema.prisma (con npx prisma generate) sia tutti i file di documentazione (.md).
4. Grafo Graphify: Esegui `graphify extract . --code-only` e `graphify cluster-only .` per mantenere la mappa delle dipendenze aggiornata. NOTA: il grafo è attualmente STALE — la CLI non è installata sulla postazione Windows dove sono state fatte le correzioni di Fase 0.
5. Nessuna credenziale reale (password SMTP/IMAP, token, chiavi API, password di database) nel codice versionato o nei file .md, ripieghi inclusi: `|| 'password-qualunque'` ed un campo password precompilato nella UI sono credenziali cablate, perché il valore che l'API annuncia è quello con cui si entra. Le credenziali dello studio stanno nella riga Tenant del database e si gestiscono via PUT /tenant/settings; le password delle persone solo come hash scrypt su user.password_hash. Presidio: `npx vitest run src/credenziali.test.ts`.

CREDENZIALI DI TEST:
Non esistono e non devono essere reintrodotte. Fino alla Fase 0 src/server.ts conteneva
una tabella di sette utenti con password nel sorgente: chiunque leggesse il repository
pubblico poteva autenticarsi in produzione. Sono state rimosse, insieme all'accettazione
di qualunque password come jolly, e non vanno trascritte nemmeno qui per spiegare che sono
state rimosse — l'elenco esatto vive solo in src/credenziali.test.ts, che le cerca.
L'unica fonte di verità è la tabella `user` del database (§23).
- Primo super_admin su DB vuoto: `npm run bootstrap` (§27), stampa la password una volta.
- Utenti esistenti senza password: `npm run passwords:assign`.
- Nuovi collaboratori: li crea il super_admin o l'advisor via POST /tenant/utenti, che
  restituisce la password temporanea nella risposta.
- Nuovi studi: solo il super_admin, via POST /admin/tenants, che crea anche la riga user
  del responsabile (ruolo advisor) e restituisce la password una volta sola. Perduta? La
  rigenera POST /admin/tenants/:id/reset-password.
- Ruolo `cliente`: passwordless, solo Magic Link su /portal.
La password la emette SEMPRE il server: nessun campo per proporla, nessun valore di
ripiego, solo l'hash scrypt in database.
Gerarchia (§2bis): super_admin gestisce tutto e vede tutti i tenant; advisor è
responsabile del solo proprio tenant; i collaboratori appartengono al tenant da cui sono
stati creati. Un advisor non può creare un super_admin.
ATTENZIONE all'invariante `user.tenant_id` NULL per i super_admin: la policy RLS di `user`
concede la visione delle righe senza tenant al solo super_admin, quindi dà per assodato che
i super_admin SIANO quelle righe. Un super_admin con tenant_id valorizzato diventa un utente
ordinario di quello studio e il suo advisor può declassarlo — succedeva davvero, perché il
seed li creava dentro il tenant e prismaApp.listaUtenti() li riassegnava a ogni lettura.
Non reintrodurre né l'una né l'altra cosa. Verifica: `npx tsx src/scripts/verificaAccessi.ts`
(i super_admin devono comparire come `tutti i tenant`).
La suite ha tre presidi: src/server.test.ts rifiuta ognuna delle vecchie coppie
email/password, src/credenziali.test.ts scandisce src/, frontend/src/, api/ ed i file .md
alla ricerca di credenziali cablate, token finti e del ripiego `!password ||`, e
src/gerarchiaRuoli.test.ts verifica la gerarchia dei ruoli controllando anche che la
scrittura respinta non avvenga comunque.

STATO ATTUALE:
Abbiamo completato l'autenticazione JWT RBAC, il Portale Cliente con Firma FEA eIDAS OTP, l'Anagrafica ERP Clienti, la Fatturazione/NC con tracciato XML SDI, il Connettore SDI 1-Click, il Document Studio Word-like con Smart Tags, il Grafo Dipendenze Moduli nel progetto, il Calendario Condiviso con Scadenzario Attività Studio (/calendar) ed il Cron Worker Scadenze UBO/Marchi.
Fase 0 di sicurezza chiusa: credenziali cablate rimosse dal sorgente E dal frontend (il bundle Vite su Vercel è pubblico come il repository) e dalle funzioni serverless in api/; guard onRequest che respinge con 401 tutto ciò che non è in un elenco di rotte pubbliche, così una rotta nuova nasce protetta; /admin/tenants riservato al super_admin su tutti e quattro i verbi (RLS non poteva coprirlo: `tenant` è la tabella che contiene gli studi, non una tabella figlia filtrata per tenant_id); colonna tenant.lead_advisor_password eliminata dal database; super_admin riportati a tenant_id NULL con la migrazione 20260819190000 e listaUtenti() tornato di sola lettura (prima riscriveva cinque utenti cablati a ogni GET, spostandoli nel tenant che leggeva); scrypt + JWT HMAC senza dipendenze native; rate limiting su /auth/*; RLS effettiva e forzata su tutte le tabelle col ruolo `bluman_app` che non può scavalcarla; migrazioni versionate al posto di `db push` nel Dockerfile; variabili Railway puntate a Supabase. Suite: 16 file, 187 test.
Debiti ancora aperti, elencati in BluMan_piano_di_sviluppo.md ("Debiti Noti Aperti"): /auth/magic-login accetta qualunque stringa `client_*`; GET /uploads/:filename è pubblica e non sanifica il nome file (path traversal); Dashboard.tsx ha percentuali cablate; grafo Graphify STALE; due righe user residue senza password (francesca@ e lorenzo@, duplicati inerti lasciati dal seed).

Leggiti i file .agents/AGENTS.md, README.md ed ISTRUZIONI_INSTALLAZIONE.md prima di iniziare qualsiasi modifica!
```

---

## 🏛 Mappa Architetturale Rapida

- **`frontend/src/pages/Dashboard.tsx`**: Dashboard KPI portafoglio, avvisi ritardo e navigazione clienti.
- **`frontend/src/pages/Projects.tsx`**: Gestione Avanzata Progetti (Schede Operatore, Tabella ERP Matrice, Kanban Pipeline).
- **`frontend/src/pages/ClientsPage.tsx`**: Anagrafica Clienti ERP (4 schede) e Magic Link passwordless.
- **`frontend/src/pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Studio (Vista Mese / Agenda Lista con dati reali da DB).
- **`frontend/src/pages/ProjectDetail.tsx`**: Dettaglio Progetto con Grafo Moduli (`GrafoModuliProgettoView`), Comunicazioni Omnichannel, Fatture/NC e Scadenze microvoci.
- **`frontend/src/pages/DocumentEditorPage.tsx`**: Studio Document Studio (Word WYSIWYG, Smart Tags ERP, Foglio A4, PDF).
- **`frontend/src/pages/Library.tsx`**: Distinta Base, Catalogo Articoli, Modelli Documenti ed Editing Prezzi Unitari.
- **`frontend/src/pages/ClientPortal.tsx`**: Portale Cliente a 5 schede (Firma FEA OTP 1-Click, Live Progress, Form Societari, Vault Documenti, Chat Advisor).
- **`frontend/src/pages/InvoicesPage.tsx`**: Registro Fatture/NC ed Export XML SDI FatturaPA.
- **`frontend/src/pages/PrimaNotaPage.tsx`**: Registro Prima Nota, Movimenti Cassa/Banca e Riconciliazione CSV.
- **`frontend/src/pages/RetainersPage.tsx`**: Contratti Ricorrenti & Retainer Studio periodici.
- **`frontend/src/pages/SettingsPage.tsx`**: Impostazioni Studio, Configuratore PDF, Gestione Team con iniziali/hover card, Matrice Permessi RBAC ed Email Suite SMTP/IMAP.
- **`src/server.ts`**: Server Fastify API con endpoint `/auth/login`, `/auth/magic-login`, `/portal/request-otp`, `/portal/verify-otp-and-sign`, `/cron/esegui-notifiche-scadenze`, `/invoices/:id/trasmetti-sdi`.
- **`prisma/schema.prisma`**: Schema database Supabase PostgreSQL con RLS isolata per Tenant.

---

## ⚙️ Comandi di Avvio sul Nuovo PC

```bash
# 1. Clona il repository
git clone https://github.com/mariobros1987/bluman.git
cd bluman

# 2. Installa dipendenze
npm install
cd frontend && npm install && cd ..

# 3. Avvia Backend Fastify (Porta 3000)
npx tsx src/index.ts

# 4. Avvia Frontend React (Porta 5173)
cd frontend && npm run dev
```

---

## ⚡ Connessione Diretta a Supabase tramite CLI & Prisma (IMPORTANTISSIMO)

### 1. Configurazione Variabile `.env` Database URL:
Nel file `.env` sul nuovo PC servono **tre** stringhe di connessione, tre ruoli diversi di
proposito (§14 — vedi `.env.example` e `src/util/prismaClient.ts`):
```env
# Runtime: ruolo applicativo, NON può scavalcare le policy RLS.
DATABASE_URL="postgresql://bluman_app.[PROJECT-REF]:[APP-PASSWORD]@[POOLER-HOST]:5432/postgres"
# Migrazioni Prisma: ruolo proprietario dello schema.
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
# Manutenzione, seed, bootstrap, backup e ricerca utente al login: scavalca RLS.
ADMIN_DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@[POOLER-HOST]:5432/postgres"
```

### 2. Collegamento Supabase CLI & Migrazioni Prisma:
Per collegarsi ed allineare il database Supabase dal terminale:

```bash
# A. Collegamento tramite Supabase CLI
npx supabase link --project-ref cfdtjdrfeidbemhunilt

# B. Ruolo applicativo + policy RLS (una volta per database, serve psql per \gexec)
PW=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,28))")
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \
     -f supabase/migrations/20260819_rls_effettiva.sql
npx tsx src/scripts/checkRls.ts   # deve mostrare bluman_app, bypassa_rls=false, 0 righe con tenant finto

# C. Generazione Prisma Client & applicazione migrazioni versionate
npx prisma generate
npx prisma migrate deploy      # MAI `db push --accept-data-loss` su un DB con dati reali
npm run seed                   # Popola i dati master di seed sul DB reale Supabase
```

> ⚠️ `prisma db push --accept-data-loss` riallinea lo schema cancellando in silenzio
> colonne e tabelle non presenti nel file. Era il comando di avvio del container su
> Railway: ora il `Dockerfile` esegue `prisma migrate deploy`.

