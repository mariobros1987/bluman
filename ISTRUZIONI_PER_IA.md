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
2. Sincronizzazione Database & File MD: Ad ogni modifica o nuova funzionalità, aggiorna sia prisma/schema.prisma (con npx prisma generate) sia tutti i file di documentazione (.md).
3. Grafo Graphify: Esegui `graphify update . --code-only` per mantenere la mappa delle dipendenze aggiornata.

CREDENZIALI UFFICIALI DI TEST (LOGIN):
- 👨‍💼 Advisor Senior: joe@bluecode.advisory / password123
- 👑 Super Admin: admin@bluecode.advisory / admin2026!
- 👷 Operatore Studio: operator@bluecode.advisory / operator123
- 🔑 Cliente Incarico: /portal?magic_token=client_demo (Passwordless)

STATO ATTUALE:
Abbiamo completato l'autenticazione JWT RBAC, il Portale Cliente a 5 schede, l'Anagrafica ERP Clienti, la Fatturazione/NC con serie distinte (FT vs NC), il Grafo Dipendenze Moduli nel progetto ed il Calendario Condiviso con Scadenzario Attività Studio (/calendar).

Leggiti i file .agents/AGENTS.md, README.md ed ISTRUZIONI_INSTALLAZIONE.md prima di iniziare qualsiasi modifica!
```

---

## 🏛 Mappa Architetturale Rapida

- **`frontend/src/pages/Dashboard.tsx`**: Dashboard KPI portafoglio, avvisi ritardo e navigazione clienti.
- **`frontend/src/pages/ClientsPage.tsx`**: Anagrafica Clienti ERP (4 schede) e Magic Link passwordless.
- **`frontend/src/pages/CalendarPage.tsx`**: Calendario Condiviso & Scadenzario Studio (Vista Mese / Agenda Lista).
- **`frontend/src/pages/ProjectDetail.tsx`**: Dettaglio Progetto con Grafo Moduli (`GrafoModuliProgettoView`), Fatture/NC e Scadenze microvoci.
- **`frontend/src/pages/Library.tsx`**: Distinta Base, Catalogo Articoli ed Editing Prezzi Unitari.
- **`frontend/src/pages/ClientPortal.tsx`**: Portale Cliente a 5 schede (Firma 1-Click, Live Progress, Form Societari, Vault Documenti).
- **`frontend/src/pages/LoginPage.tsx`**: Login Staff cifrato con ruoli RBAC.
- **`src/server.ts`**: Server Fastify API con endpoint `/auth/login`, `/auth/magic-login`, `/upload`, `/progetti` ed isolamento multi-tenant.
- **`prisma/schema.prisma`**: Schema database Supabase PostgreSQL.

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
