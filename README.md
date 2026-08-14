# 🏛 BluMan Advisory Platform — Architettura & Guida Produzione

Piattaforma ERP per studi di consulenza societaria, wealth protection ed advisory. Integrazione end-to-end con **React 19 + Fastify + Prisma + PostgreSQL (Supabase)**.

---

## 🎯 Stato del Progetto & Componenti Verificati

### 🧑‍💼 Portale Cliente Passwordless (5 Schede)
- **Firma Engagement Letter**: Firma 1-click del preventivo d'ordine e della lettera di incarico.
- **Avanzamento Live Lavori**: Timeline delle fasi di consulenza in corso con percentuale globale.
- **Form Dati Societari**: Compilazione guidata dei dati fiscali, IBAN e UBO.
- **Vault Documenti**: Archivio contratti ed allegati da firmare.
- **Contatti Advisor**: Canale diretto di assistenza col Lead Senior Advisor.

### 📋 Anagrafica Master Cliente ERP (4 Schede)
- **Dati Legali**: Ragione Sociale, Partita IVA / VAT, Codice Fiscale, Giurisdizione, REA.
- **Sedi Distinte**: Sede Legale e Sede Operativa / Rappresentanza disaccoppiate.
- **Fatturazione SDI**: Codice Destinatario 7 caratteri (es. `SUBM70N`) ed IBAN cliente.
- **Compliance KYC/AML**: Classe di rischio antiriciclaggio, Titolare Effettivo (UBO), origine patrimoniale e rinnovo KYC.

### 💶 Fatturazione & Note di Credito (Numerazione Sequenziale Distinta)
- **Fatture VENDITA (Serie `FT`)**: Numerazione autonoma (es. `FT-2026/001`).
- **Note di Credito (Serie `NC`)**: Numerazione autonoma (es. `NC-2026/001`) con causale di storno e riferimento fattura originale.
- **Tracciato SDI Comped Servizi FPA**: Generazione ed associazione XML FatturaPA.
- **Configuratore Layout PDF (Admin)**: Upload Logo Studio, colore tema e note legali in piè di pagina con anteprima live.

### 🕸 Grafo & Dipendenze Moduli nel Progetto
- **Visual Flow**: Grafico visuale con frecce `➔ Sblocca` delle dipendenze dei moduli acquistati dal cliente.
- **Upselling Moduli**: Pulsante `+ Aggiungi Modulo da Libreria` per espandere l'incarico del cliente in tempo reale.

---

## 🚨 REGOLE TASSATIVE DI SVILUPPO (MANDATORY DEV RULES)

1. **Sincronizzazione Schema Database (Prisma & Supabase)**:
   - Ad ogni cambio codice o nuova funzionalità, lo schema `prisma/schema.prisma` ed il database Supabase DEVONO essere istantaneamente aggiornati. Nessun dato viene perso o gestito solo volatile.
2. **Allineamento Documentazione Markdown (`.md`)**:
   - Tutti i file `.md` (`README.md`, `BluMan_piano_di_sviluppo.md`, `ISTRUZIONI_INSTALLAZIONE.md`, `.agents/AGENTS.md`) DEVONO essere tassativamente aggiornati dopo ogni modifica importante.
3. **Mappa Grafo (Graphify)**:
   - Mantenere aggiornato il grafo con `graphify update . --code-only`.

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
