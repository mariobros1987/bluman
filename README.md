# 🏛 BluMan Advisory Platform — Architettura & Guida Produzione

Piattaforma ERP per studi di consulenza societaria, wealth protection ed advisory. Integrazione end-to-end con **React 19 + Fastify + Prisma + PostgreSQL (Supabase)**.

> 🤖 **Devi passare ad un altro PC?** Apri ed incolla il testo di **[`ISTRUZIONI_PER_IA.md`](file:///Users/mariodibenedetto/Downloads/bluman-api/ISTRUZIONI_PER_IA.md)** nella nuova IA per riprendere il lavoro in 1 secondo!

---

## 🎯 Stato del Progetto & Componenti Verificati

### 🧑‍💼 Portale Cliente Passwordless (5 Schede)
- **Firma Engagement Letter**: Firma 1-click del preventivo d'ordine e della lettera di incarico.
- **Avanzamento Live Lavori**: Timeline delle fasi di consulenza in corso con percentuale globale.
- **Form Dati Societari**: Compilazione guidata dei dati fiscali, IBAN e UBO.
- **Vault Documenti**: Archivio contratti ed allegati da firmare.
- **Live Chat & Contatti Advisor**: Chat bidirezionale interattiva con l'Advisor collegata via API Fastify e salvata su PostgreSQL.

### 📋 Anagrafica Master Cliente ERP (4 Schede & Persistenza Totale)
- **Dati Legali**: Ragione Sociale, Partita IVA / VAT, Codice Fiscale, Giurisdizione, REA, Capitale Sociale.
- **Sedi Distinte**: Sede Legale (Indirizzo, Città, CAP, Nazione) e Sede Operativa / Rappresentanza disaccoppiate.
- **Fatturazione SDI**: Codice Destinatario 7 caratteri (es. `SUBM70N`), Regime Fiscale ed IBAN cliente.
- **Compliance KYC/AML**: Classe di rischio antiriciclaggio, Titolare Effettivo (UBO), origine patrimoniale e data rinnovo KYC.
- **Salvataggio Bidirezionale**: Persistenza sincrona su PostgreSQL (`prisma.cliente` + `referentiJson`) e fallback in locale.

### 📥 Prima Nota & Riconciliazione Estratto Conto Bancario (CSV)
- **Import Estratto Conto (CSV)**: Parsing automatico di righe CSV bancarie (`Data, Causale, Importo, CRO/TRN`).
- **Smart Reconciliation**: Riconciliazione automatica con le anagrafiche dei clienti e le fatture dello studio.
- **Registro Movimenti**: Tracciamento contabile per metodo di pagamento (Bonifico, POS, Stripe, Assegno) e codice CRO/TRN.

### 💶 Fatturazione & Note di Credito (Numerazione Sequenziale Distinta)
- **Fatture VENDITA (Serie `FT`)**: Numerazione autonoma (es. `FT-2026/001`).
- **Note di Credito (Serie `NC`)**: Numerazione autonoma (es. `NC-2026/001`) con causale di storno e riferimento fattura originale.
- **Tracciato SDI Comped Servizi FPA**: Generazione ed associazione XML FatturaPA.
- **Configuratore Layout PDF (Admin)**: Upload Logo Studio, colore tema e note legali in piè di pagina con anteprima live.
- **Gestionale Fatture (`/invoices`)**: Dashboard globale per il controllo pagamenti, scadenziario e filtri stato.

### 🗄 Archiviazione & Eliminazione Sicura
- **Blocco Fiscale**: Impossibile eliminare un progetto se sono state emesse Fatture/Note di Credito.
- **Doppio Controllo**: L'eliminazione definitiva richiede la digitazione manuale del nome progetto.

### 🕸 Grafo & Dipendenze Moduli nel Progetto
- **Visual Flow Topologico & Frecce SVG**: Layout a 3 colonne (*Punto di partenza*, *Sbloccati a cascata*, *Dipendenti*) con connettori direzionali SVG viola.
- **🔒 Lucchetti Topologici Dinamici & Notifica Sblocco Cliente**: Visualizzazione dello stato `🔒 Locked` / `🔓 Unlocked` sulle dipendenze e pulsante `✉️ Notifica Sblocco al Cliente` al completamento delle fasi.
- **Associazione Giurisdizioni**: Menù a tendina `🌍 Giurisdizione Target *` nel costruttore di moduli ed articoli per Malta 🇲🇹, Gibilterra 🇬🇮, USA 🇺🇸, EAU 🇦🇪.
- **Assegnazione 1-Click a Cliente & Smart Anti-Duplicazione**: Pulsante `🚀 Assegna a Progetto Cliente` direttamente dalle card del Grafo con scansione automatica per evitare la duplicazione di articoli o lavoro già svolto (0h per doppioni).
- **Upselling Moduli**: Pulsante `+ Aggiungi Modulo da Libreria` anche all'interno della scheda del progetto del cliente.

### ⏱️ Quick Time Tracker Fluttuante nella Topbar (Stopwatch 1-Click)
- **Timer Digitale Live**: Avvio, pausa e stop sessione di lavoro sempre a portata di mano nella barra superiore.
- **Selettore Pratica Rapido**: Caricamento dinamico di tutte le pratiche dal DB/local con selezione della microvoce.
- **Calcolo Costo Lavoro Reale**: Calcolo automatico della spesa lavoro in base alla tariffa oraria specifica dell'operatore (es. 120€/h, 95€/h, 90€/h, 85€/h, 45€/h) e consuntivazione immediata a database.

### 📦 Export Fascicolo Digitale Completo ZIP in 1-Click
- **Archivio Strutturato Zero-Dependency**: Compressione client-side di tutti gli atti del progetto in cartelle ordinate (`/01_Contratti_e_Incarico`, `/02_Societario_e_Delibere`, `/03_KYC_Compliance_e_Visure`, `/04_Fatture_e_Ricevute`).
- **Indice Conforme eIDAS**: Generazione automatica del file `INDICE_FASCICOLO.txt` con metadati, cliente, valore e marcatura temporale ISO UTC.

### 📊 Export Contabile Commercialista (CSV / Excel)
- **Prima Nota & Registro Fatture**: Download 1-click in formato CSV UTF-8 con BOM per la massima compatibilità con i gestionali fiscali (**Zucchetti, TeamSystem, Datev, Profis ed Excel**).

### 📲 Notifiche Push Desktop Native del Browser
- **Centro Notifiche Integrato**: Richiesta permessi push al browser (`Notification.requestPermission()`) con test istantaneo e ricezione avvisi live su scadenze, firme FEA e ritardi.

### 📊 Redditività Incarico & Controllo Budget Commessa Live
- **KPI Finanziari Live**: Margine Lordo Studio (€ e %), Resa Oraria Effettiva Studio (€/ora), Ore Stimate vs Consuntivate Reali.
- **Barra Progressiva Consumo Budget**: Semaforo visivo intelligente (🟢 Ottimale >50%, 🟡 In Linea 20-50%, 🔴 Allerta Sforamento <20%).
- **Ripartizione Lavoro Team**: Tabella dettagliata con ore registrate e costi effettivi per ogni singolo professionista dello studio.
- **📄 Export Rendiconto Economico CSV / PDF**: Esportazione immediata del prospetto trasparenza per lo studio o il cliente.

### 💬 WhatsApp Business Cloud API & Omnichannel Integration (§14)
- **WhatsApp Cloud API Ufficiale (Graph API v21.0)**: Phone ID `1318817114639409`, WABA `1397431142562576`, Token Permanente System User illimitato.
- **Remote MCP Meta DevTools**: Configurato in `~/.gemini/config/mcp_config.json` su `https://mcp.facebook.com/devtools`.
- **Webhooks Bidirezionali**: Connessione verificata sia su Vercel Serverless (`/api/webhooks/communications/whatsapp.ts`) che su Fastify (`/webhooks/communications/whatsapp`).
- **Binding Dinamico Anagrafica ERP**: Scansione del numero mittente su Supabase ed inserimento automatico nella chat del progetto attivo del cliente.
- **Guida Operativa Dettagliata**: Consulta [`GUIDA_META_WHATSAPP_INTEGRAZIONE.md`](file:///Volumes/Macintosh%20HD/Users/mariodibenedetto/Downloads/bluman-api/GUIDA_META_WHATSAPP_INTEGRAZIONE.md).

### 👥 Gestione Team & Timesheet Live Operatori (`/settings`)
- **Scheda Performance Operatore 1-Click**: Cliccando su qualsiasi collaboratore (*Francesca Disabato*, *Joe Disabato*, *Avv. Lorenzo Marino*, *Dr. Elena Russo*, *Avv. Mario Dibenedetto*) si apre la scheda analitica con ore consuntivate, incarichi gestiti e diario timesheet live.
- **📧 Server Email SMTP Transazionale & Omnichannel**: Form credenziali SMTP + 4 Pulsanti di Test 1-Click per WhatsApp, Telegram Bot, Signal Daemon ed Email.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY DEV RULES)

1. **Isolamento Multi-Tenant (`tenant_id`) & RLS**:
   - I dati tra i vari studi non si mischiano mai. Il filtro applicativo **non basta e non è la difesa**: è RLS che lo è. Nel codice che serve una richiesta HTTP usa `prisma` da `src/util/prismaClient.ts`, mai `new PrismaClient()`; `prismaAmministrativo()` scavalca le policy ed è ammesso solo in script, seed, bootstrap, backup e nella ricerca utente al login.
2. **Migrazioni Versionate, Mai `db push` su Dati Reali**:
   - Lo schema si cambia con `prisma migrate dev` / `prisma migrate deploy`. `prisma db push --accept-data-loss` riallinea il database cancellando in silenzio colonne e tabelle.
3. **Sincronizzazione Schema Database (Prisma & Supabase)**:
   - Ad ogni cambio codice o nuova funzionalità, lo schema `prisma/schema.prisma` ed il database Supabase DEVONO essere istantaneamente aggiornati. Nessun dato viene perso o gestito solo volatile.
4. **Allineamento Documentazione Markdown (`.md`)**:
   - Tutti i file `.md` (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) DEVONO essere tassativamente aggiornati dopo ogni modifica importante.
5. **Mappa Grafo (Graphify)**:
   - Mantenere aggiornato il grafo con `graphify extract . --code-only` e `graphify cluster-only .`.
   - ⚠️ Grafo **STALE**: la CLI non è installata sulla postazione Windows delle correzioni di Fase 0. Va rigenerato sulla prima postazione che la ha.
6. **Divieto Assoluto di Credenziali in Chiaro**:
   - Nessuna password, token o chiave API reale nel codice versionato o nei file `.md`. Le credenziali dello studio risiedono nella riga `Tenant` del database (`smtpPass`, `imapPass`) e si gestiscono via `PUT /tenant/settings`. Le password delle persone stanno solo come hash scrypt su `user.password_hash`.
   - Vale anche per i ripieghi: un `|| 'password-qualunque'` e un campo password precompilato sono credenziali cablate, perché il valore che l'API annuncia è quello con cui si entra. Presidio: `src/credenziali.test.ts`, che scandisce anche `frontend/src/`, `api/` ed i file `.md` — il bundle frontend è pubblico esattamente come il repository, e un segreto non va trascritto nemmeno per spiegare che è stato rimosso.

Il testo integrale ed autorevole delle regole è in [`.agents/AGENTS.md`](.agents/AGENTS.md).

---

## ⚙️ Guida Avvio Rapido Locale

```bash
# 1. Clona il repository
git clone https://github.com/mariobros1987/bluman.git
cd bluman

# 2. Installa dipendenze (Backend & Frontend)
npm install
cd frontend && npm install && cd ..

# 3. Avvia il Backend Fastify
npx tsx src/index.ts       # Server in ascolto su http://127.0.0.1:3000

# 4. Avvia il Frontend React
cd frontend && npm run dev # Dev Server in ascolto su http://localhost:5173
```

---

## 🔑 Accesso & Gerarchia dei Ruoli

Nessuna credenziale precaricata: non nel codice, non in questi file `.md`, non nel
frontend (§23). Fino alla Fase 0 `src/server.ts` conteneva una tabella di utenti e
password nel sorgente — chiunque leggesse il repository poteva entrare in produzione. Sono
stati rimossi. L'unica fonte di verità è la tabella `user` del database.

| Ruolo | Ambito (§2bis) | Accesso |
| :--- | :--- | :--- |
| 👑 `super_admin` | Gestisce tutto e vede tutti i tenant (`tenant_id` NULL — è l'invariante su cui si appoggia RLS, non un dettaglio); può cambiare studio corrente via `x-tenant-id` | JWT |
| 👨‍💼 `advisor` | Responsabile del **proprio** tenant; crea e gestisce i collaboratori del proprio studio | JWT |
| 👷 `collaboratore_interno` / `collaboratore_esterno` | Appartengono al tenant da cui vengono creati e non ne escono | JWT |
| 🔑 `cliente` | Passwordless: solo Magic Link su `/portal`, mai `/auth/login` | Magic Link |

Primo accesso su un database vuoto: `npm run bootstrap` crea il primo `super_admin` (§27)
e stampa una password temporanea **una sola volta**. Utenti esistenti senza password:
`npm run passwords:assign`. Nuovi collaboratori: li crea il `super_admin` o l'`advisor`
dalla dashboard, e la risposta contiene la password temporanea da consegnare a mano.
Dettagli in `ISTRUZIONI_INSTALLAZIONE.md`.

**La password la emette sempre il server.** Non c'è un campo dove proporne una, non esiste
un valore di ripiego, e la risposta la mostra in chiaro una volta sola: dopo, nel database
c'è solo l'hash scrypt. Se va perduta si rigenera — per il responsabile di uno studio con
`POST /admin/tenants/:id/reset-password`. Una password di default annunciata dall'API
sarebbe comunque una password valida, quindi non ce ne sono.

Il presidio automatico è `src/credenziali.test.ts`: scandisce `src/`, `frontend/src/` e
`api/` e fallisce se una vecchia password cablata, un token finto o un ripiego
`!password ||` ricompare su una riga non commentata.

---

## 🚧 Nessuna Rotta Aperta per Sbaglio (§23)

L'hook `onRequest` di `src/server.ts` respinge con `401` qualunque richiesta priva di un
JWT verificabile. L'elenco nel codice è quello delle rotte **pubbliche** — `/health`, il
login, il Magic Link, i webhook di canale — e tutto il resto è protetto per difetto: con
l'elenco opposto una rotta nuova sarebbe nata aperta senza che nessuno se ne accorgesse.

Vale la pena distinguere due controlli che si confondono facilmente: **RLS** protegge uno
studio dall'altro, ma non protegge da "non serve autenticarsi", perché una richiesta
anonima che porta il tenant di default corrisponde legittimamente alle policy. Prima del
guard RLS lavorava correttamente sul tenant sbagliato.

Il blocco `/admin/tenants` ha un secondo controllo, `soloSuperAdmin`, su tutti e quattro i
verbi. Neanche questo è un compito di RLS: `tenant` è la tabella che *contiene* gli studi,
non una tabella figlia filtrata per `tenant_id`, quindi le policy non le danno protezione.

`src/server.test.ts` verifica, rotta per rotta, 401 senza token e non-401 con un token
valido; `src/gerarchiaRuoli.test.ts` presidia la gerarchia dei ruoli (`npx vitest run` →
16 file, 187 test).

### 👑 Il `super_admin` non appartiene a nessuno studio

`user.tenant_id` è NULL per il `super_admin`, ed è l'invariante su cui si appoggia la policy
RLS di `user`: le righe senza tenant sono visibili al solo super admin. Il database non lo
rispettava — il seed li creava dentro il tenant di default e `listaUtenti()` li riassegnava
a ogni lettura — e la conseguenza era che **un advisor poteva declassare il super admin
della piattaforma** a collaboratore, perché il controllo anti-furto confronta i `tenant_id`
e li trovava uguali.

Corretto su tre piani: la migrazione `20260819190000_super_admin_senza_tenant` ripara il
dato (con NULL è RLS a nascondere la riga), `prismaApp.listaUtenti()` è tornato di sola
lettura, e `POST /tenant/utenti` risponde 403 a chi non è super admin e tenta di modificare
una riga che già lo è. Verifica prima di un rilascio:
`npx tsx src/scripts/verificaAccessi.ts`.

---

## 🛡 Sicurezza & Architettura Enterprise in Produzione

1. **🔑 Autenticazione JWT & Sessioni Protette**: Firma JWT HMAC SHA-256 e verifica payload Bearer Header su tutte le rotte Fastify con blocco categorico per utenti non autorizzati. `JWT_SECRET` obbligatorio (minimo 32 caratteri): con `NODE_ENV=production` il server si rifiuta di partire senza. Il guard `onRequest` lavora su un elenco di rotte *pubbliche*, quindi ogni rotta nuova nasce protetta; `/admin/tenants` ha in più il controllo di ruolo `soloSuperAdmin` (403 per chiunque altro).
2. **📧 Provider Email SMTP Reale (Register.it / SendGrid / Nodemailer)**: Suite email integrata per invio notifiche, Magic Link e comunicazioni transazionali.
3. **📦 Storage Cloud (Supabase Storage / AWS S3)**: Archiviazione documenti crittografata con URL pre-firmati e validazione binaria Magic-Bytes.
4. **🛡 Row-Level Security (RLS) PostgreSQL**: Isolamento multi-tenant imposto dal motore database, non dal codice applicativo. Il runtime si connette col ruolo `bluman_app`, che **non può scavalcare le policy**, e ogni richiesta HTTP imposta `app.current_tenant_id` come variabile di transazione. RLS è attivo **e forzato** su tutte le tabelle, con una policy per ciascuna. Se il contesto tenant manca, la query non vede nulla: un errore di programmazione produce un guasto immediato invece di una fuga silenziosa di dati. Policy in `supabase/migrations/20260819_rls_effettiva.sql`, lato applicativo in `src/util/prismaClient.ts`, verifica con `npx tsx src/scripts/checkRls.ts`.
5. **📜 Firma Elettronica Avanzata (FEA) eIDAS**: Generazione codice OTP a 6 cifre (WhatsApp/Email/SMS) e apposizione del sigillo digitale (SHA-256 Digest, Timestamp ISO UTC e IP certificato).
6. **⏰ Worker Cron Schedulato**: Scansione automatica per il rinnovo UBO Registry Malta (MFSA), marchi EUIPO e solleciti rate fatture.
7. **🚀 Connettore SDI 1-Click**: Trasmissione diretta dei tracciati XML FatturaPA all'Agenzia delle Entrate con tracking esiti.
8. **📝 Studio Document Studio**: Editor WYSIWYG stile Word con Smart Tags ERP (Mail Merge) ed esportazione PDF Vettoriale A4.

