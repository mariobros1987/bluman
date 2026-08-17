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

### 📊 Redditività Incarico & Report Margini (€/ora)
- **KPI Finanziari Live**: Margine Lordo Studio (€), Resa Oraria Effettiva Studio (€/ora), Ore Stimate vs Consuntivate Reali.
- **Rendiconto per Singolo Modulo**: Tabella analitica con margine di profitto ed indicatori `🟢 In Utile Extra` / `🟡 In Target`.
- **📄 Export Dossier Trasparenza PDF**: Esportazione 1-click del rendiconto trasparente dell'incarico per il cliente.

### 💬 WhatsApp Business Cloud API & Omnichannel Integration (§14)
- **WhatsApp Cloud API Ufficiale (Graph API v21.0)**: Phone ID `1318817114639409`, WABA `1397431142562576`, Token Permanente System User illimitato.
- **Remote MCP Meta DevTools**: Configurato in `~/.gemini/config/mcp_config.json` su `https://mcp.facebook.com/devtools`.
- **Webhooks Bidirezionali**: Connessione verificata sia su Vercel Serverless (`/api/webhooks/communications/whatsapp.ts`) che su Fastify (`/webhooks/communications/whatsapp`).
- **Binding Dinamico Anagrafica ERP**: Scansione del numero mittente su Supabase ed inserimento automatico nella chat del progetto attivo del cliente.
- **Guida Operativa Dettagliata**: Consulta [`GUIDA_META_WHATSAPP_INTEGRAZIONE.md`](file:///Volumes/Macintosh%20HD/Users/mariodibenedetto/Downloads/bluman-api/GUIDA_META_WHATSAPP_INTEGRAZIONE.md).

### 👥 Gestione Team & Timesheet Live Operatori (`/settings`)
- **Scheda Performance Operatore 1-Click**: Cliccando su qualsiasi collaboratore (*Francesca Disabato*, *Joe Disabato*, *Avv. Lorenzo Marino*, *Elena Rossi*, *Super Admin*) si apre la scheda analitica con ore consuntivate, incarichi gestiti e diario timesheet live.
- **📧 Server Email SMTP Transazionale & Omnichannel**: Form credenziali SMTP + 4 Pulsanti di Test 1-Click per WhatsApp, Telegram Bot, Signal Daemon ed Email.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY DEV RULES)

1. **Sincronizzazione Schema Database (Prisma & Supabase)**:
   - Ad ogni cambio codice o nuova funzionalità, lo schema `prisma/schema.prisma` ed il database Supabase DEVONO essere istantaneamente aggiornati. Nessun dato viene perso o gestito solo volatile.
2. **Allineamento Documentazione Markdown (`.md`)**:
   - Tutti i file `.md` (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) DEVONO essere tassativamente aggiornati dopo ogni modifica importante.
3. **Mappa Grafo (Graphify)**:
   - Mantenere aggiornato il grafo con `graphify extract . --code-only` e `graphify cluster-only .`.

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

## 🔑 Credenziali Ufficiali di Accesso (Ruoli Staff & Cliente)

| Ruolo Attore | Email Registrata | Password di Accesso | Tipo Accesso |
| :--- | :--- | :--- | :--- |
| 👨‍💼 **Advisor Senior** | `joe@bluecode.advisory` | `password123` | JWT Access Token |
| 👑 **Super Admin** | `admin@bluecode.advisory` | `admin2026!` | JWT Access Token |
| 👷 **Operatore Studio** | `operator@bluecode.advisory` | `operator123` | JWT Access Token |
| 🔑 **Cliente Incarico** | `client@holdingbeta.advisory` | *Passwordless* | `/portal?magic_token=client_demo` |

---

## 🔍 AUDIT SCHIETTO: Cosa Manca per la Produzione A-Z (Enterprise Checklist)

Per distribuire BluMan in produzione a clienti e studi reali:

1. **🔑 Autenticazione JWT + Cookie HTTP-Only**:
   - Attualmente l'accesso operatore usa token locali. In produzione va attivata la firma JWT con refresh token su Cookie Secure SameSite.
2. **📧 Provider Email SMTP Reale (Register.it / SendGrid)**:
   - I Magic Link vengono attualmente generati a schermo. Serve collegare `Nodemailer` con credenziali SMTP per l'invio automatico delle email.
3. **📦 Storage Persistente Cloud (AWS S3 / Supabase Storage)**:
   - Gli upload salvano attualmente nella cartella `./uploads/` locale. Per la produzione va collegato un bucket S3 ridondato.
4. **🛡 Row-Level Security (RLS) PostgreSQL**:
   - Applicare le policy RLS SQL presenti in `schema.prisma` per garantire l'isolamento multi-tenant a livello di DB engine.
5. **📜 Provider Firma Digitale Qualificata (FEA / OTP SMS)**:
   - Integrazione Webhook con provider qualificati (Namirial / InfoCert) se richiesta firma con valore legale pleno eIDAS.
