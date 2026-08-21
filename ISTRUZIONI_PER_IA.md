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
4. Grafo Graphify: Esegui `graphify extract . --code-only` e `graphify cluster-only .` per mantenere la mappa delle dipendenze aggiornata. NOTA: il grafo è attualmente STALE — la CLI non è installata sulla postazione Windows dove sono state fatte le correzioni di Fase 0 e di Fase 1.
5. Nessuna credenziale reale (password SMTP/IMAP, token, chiavi API, password di database) nel codice versionato o nei file .md, ripieghi inclusi: `|| 'password-qualunque'` ed un campo password precompilato nella UI sono credenziali cablate, perché il valore che l'API annuncia è quello con cui si entra. Le credenziali dello studio stanno nella riga Tenant del database e si gestiscono via PUT /tenant/settings; le password delle persone solo come hash scrypt su user.password_hash. Presidio: `npx vitest run src/credenziali.test.ts`.
6. Stati e percentuali di avanzamento (§16) li calcola il backend, non il frontend: `src/domain/stateEngine.ts` è puro e `src/services/calcoloService.ts` è l'unico punto che lo traduce in letture e scritture Prisma. Non reintrodurre percentuali cablate nelle pagine React e non duplicare le formule nel frontend — il dominio non deve finire nel bundle pubblico. La cascata sale sempre (micro-voce → modulo → progetto), mai verso il basso (§16.6).

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
src/accessoCliente.test.ts presidia l'accesso del cliente: token magic inventato o scaduto
→ 401, token valido → JWT col tenant preso dalla riga; in tabella solo lo SHA-256 del token;
path traversal su /uploads → 400; /uploads senza Bearer né firma → 401.
src/calcoloService.test.ts presidia il motore di stato: percentuali mostrate (col tetto a 99
finché lo stato non è chiuso), segnali di rischio, cosa il ricalcolo scrive davvero a database
(solo le righe divergenti), i moduli senza micro-voci che NON vanno declassati, e la presenza
di segnaleRischio/oreExtra per singolo modulo nella risposta HTTP — è il dato su cui il banner
della Dashboard scrive le sue righe.

STATO ATTUALE:
Abbiamo completato l'autenticazione JWT RBAC, il Portale Cliente con Firma FEA eIDAS OTP, l'Anagrafica ERP Clienti, la Fatturazione/NC con tracciato XML SDI, il Connettore SDI 1-Click, il Document Studio Word-like con Smart Tags, il Grafo Dipendenze Moduli nel progetto, il Calendario Condiviso con Scadenzario Attività Studio (/calendar) ed il Cron Worker Scadenze UBO/Marchi.
Fase 0 di sicurezza chiusa: credenziali cablate rimosse dal sorgente E dal frontend (il bundle Vite su Vercel è pubblico come il repository) e dalle funzioni serverless in api/; guard onRequest che respinge con 401 tutto ciò che non è in un elenco di rotte pubbliche, così una rotta nuova nasce protetta; /admin/tenants riservato al super_admin su tutti e quattro i verbi (RLS non poteva coprirlo: `tenant` è la tabella che contiene gli studi, non una tabella figlia filtrata per tenant_id); colonna tenant.lead_advisor_password eliminata dal database; super_admin riportati a tenant_id NULL con la migrazione 20260819190000 e listaUtenti() tornato di sola lettura (prima riscriveva cinque utenti cablati a ogni GET, spostandoli nel tenant che leggeva); magic link del portale cliente persistiti come SHA-256 in `magic_link` con scadenza a 7 giorni (prima /auth/magic-login accettava qualunque stringa `client_*` e firmava un JWT con tenant ed email cablati: era una sessione `cliente` valida per chiunque, non un controllo debole); GET /uploads/:filename confinata sotto uploads/ e non più anonima (Bearer oppure firma HMAC in query string, perché quegli URL finiscono in `<img src>` che non può inviare header); scrypt + JWT HMAC senza dipendenze native; rate limiting su /auth/*; RLS effettiva e forzata su tutte le 34 tabelle col ruolo `bluman_app` che non può scavalcarla; migrazioni versionate al posto di `db push` nel Dockerfile; variabili Railway puntate a Supabase.
Fase 1 (Integrazione State Engine) chiusa: `src/domain/stateEngine.ts` (già puro) è ora collegato all'applicazione da `src/services/calcoloService.ts`, che calcola l'avanzamento senza query e lo PERSISTE con `ricalcolaProgetto()`; `GET /progetti` e `GET /progetti/:id` restituiscono `avanzamento` (stato, percentuale, segnaleRischio, oreExtra) per progetto E per singolo modulo; nuova rotta `POST /progetti/:id/ricalcola` (audit `PROGETTO_RICALCOLATO`) che scrive solo le righe divergenti, per non sporcare `updatedAt` a ogni click. Sparite le percentuali cablate: Dashboard.tsx dava 45% a ogni progetto in corso, 10% a ogni altro e 50% a ogni modulo `in_progress`, mentre la barra di ProjectDetail.tsx leggeva `percentualeAvanzamento`, un campo che il backend non ha MAI prodotto — era ferma a zero da sempre. Le percentuali non hanno una colonna e non serviva una migrazione: derivano da `stato`, `orePreventivate` e `oreConsuntivate`, già in riga; si persistono solo gli stati e i segnali di rischio, che una query non ricostruisce. Due cose da non toccare: il tetto a 99 in `percentualeVisibile()` (un modulo al 99.7% non deve dichiarare 100 mentre è `in_progress`) e la guardia sui moduli senza micro-voci, che `calcolaStatoModulo([])` declasserebbe a `pending` cancellando uno stato messo a mano. Gli avvisi tengono separati il ritardo di calendario dallo sforamento di ore, perché hanno rimedi diversi: non riassumerli in un solo messaggio. Diagnostica di sola lettura prima di scrivere sui dati reali: `npx tsx src/scripts/probeAvanzamento.ts`. Suite: 18 file, 226 test.
Debiti ancora aperti, elencati in BluMan_piano_di_sviluppo.md ("Debiti Noti Aperti"): grafo Graphify STALE; due righe user residue senza password (francesca@ e lorenzo@, duplicati inerti lasciati dal seed); due moduli con zero micro-voci su "Struttura Holding — Famiglia Ricci" (stato messo a mano, non verificabile dal motore); una riga di stato modulo da riallineare su "holding dibenedetto" con `POST /progetti/:id/ricalcola` (scrittura in produzione, non eseguita).

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
- **`src/server.ts`**: Server Fastify API con endpoint `/auth/login`, `/auth/magic-login`, `/portal/request-otp`, `/portal/verify-otp-and-sign`, `/progetti/:id/ricalcola`, `/cron/esegui-notifiche-scadenze`, `/invoices/:id/trasmetti-sdi`.
- **`src/domain/stateEngine.ts`**: Motore di stato §16 in funzioni pure (nessun database, solo `import type`). Non aggiungerci query.
- **`src/services/calcoloService.ts`**: Unico ponte fra il motore e Prisma — `calcolaAvanzamento()` (in memoria, zero query), `arricchisciProgetti()` e `ricalcolaProgetto()` (persiste la cascata verso l'alto).
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

