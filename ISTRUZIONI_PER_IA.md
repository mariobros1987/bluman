# 🤖 Istruzioni & Context Prompt per l'IA (Nuovo PC)

Questo file contiene il contesto completo, le regole di sviluppo tassative ed il prompt di avvio pronto da copiare ed incollare nella finestra dell'IA sul nuovo computer.

---

## 📋 PROMPT DA COPIARE ED INCOLLARE ALLA NUOVA IA:

```text
Ciao! Sto lavorando sulla piattaforma BluMan Advisory (ERP per Studi di Consulenza, Corporate Structuring, Trust e Tax Planning). 

Repository GitHub: https://github.com/mariobros1987/bluman
Stack: React 19 + TypeScript + Fastify API + Prisma ORM + Supabase PostgreSQL + Graphify.

REGOLE TASSATIVE DA SEGUIRE RIGOROSAMENTE:
1. Isolamento Multi-Tenant Tassativo (tenant_id): I dati tra i vari Tenant/Studi non si devono MAI mischiare. Ogni query DB e rotta deve essere filtrata su tenant_id e protetta da RLS PostgreSQL.
2. Sincronizzazione Database & Persistenza Cloud Tassativa: Tutto quello che viene aggiunto o modificato nell'interfaccia (spunte, passaggi, note, scadenze, assegnazioni) deve essere tassativamente salvabile e collegato al database PostgreSQL via API Fastify. Non possiamo permetterci di perdere dati. Aggiorna sia prisma/schema.prisma (con npx prisma generate) sia tutti i file di documentazione (.md).
3. Grafo Graphify: Esegui `graphify update . --code-only` per mantenere la mappa delle dipendenze aggiornata.

CREDENZIALI UFFICIALI DI TEST (LOGIN):
- 👨‍💼 Lead Advisor Senior: joe@bluecode.advisory / password123
- ⚖️ Legal Counsel Advisor: mario.dibenedetto@bluecode.advisory / password123
- ⚖️ Avv. Lorenzo Marino: lorenzo.marino@bluecode.advisory / password123
- 💶 Dr. Elena Russo (Tax Advisor): elena.russo@bluecode.advisory / password123
- 👑 Super Admin: admin@bluecode.advisory / admin2026!
- 👷 Operatore Studio: operator@bluecode.advisory / operator123
- 🔑 Cliente Incarico: client@holdingbeta.advisory (Magic Link /portal)

STATO ATTUALE:
Abbiamo completato l'autenticazione JWT RBAC, il Portale Cliente con Firma FEA eIDAS OTP, l'Anagrafica ERP Clienti, la Fatturazione/NC con tracciato XML SDI, il Connettore SDI 1-Click, il Document Studio Word-like con Smart Tags, il Grafo Dipendenze Moduli nel progetto, il Calendario Condiviso con Scadenzario Attività Studio (/calendar) ed il Cron Worker Scadenze UBO/Marchi.

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
Nel file `.env` sul nuovo PC, inserire la stringa di connessione ufficiale Supabase:
```env
DATABASE_URL="postgresql://postgres:[YOUR-DB-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:[YOUR-DB-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
```

### 2. Collegamento Supabase CLI & Migrazioni Prisma:
Per collegarsi ed allineare il database Supabase dal terminale:

```bash
# A. Collegamento tramite Supabase CLI
npx supabase link --project-ref cfdtjdrfeidbemhunilt

# B. Generazione Prisma Client & Allineamento Schema DB
npx prisma generate
npx prisma db push             # Sincronizza lo schema Prisma con Supabase
npx tsx prisma/seed.ts         # Popola i dati master di seed sul DB reale Supabase
```

