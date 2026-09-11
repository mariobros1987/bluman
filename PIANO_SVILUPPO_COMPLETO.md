# 🗺️ BluMan Advisory Platform — Piano di Sviluppo Completo & Dettagliato

> **Versione**: 3.0 — Master Plan di Sviluppo & Consolidamento Enterprise  
> **Data di Riferimento**: 2026-09-11  
> **Stato Codebase**: 614/614 Test Vitest Verdi (47 Suite) • Zero Errori TypeScript Frontend & Backend • Deploy Attivo su Vercel & Railway  
> **Autore**: Mario Dibenedetto & Team di Ingegneria AI  

---

## 📑 Indice del Piano

1. [Stato di Avanzamento Attuale & Risultati Raggiunti](#1-stato-di-avanzamento-attuale--risultati-raggiunti)
2. [Matrice delle Priorità Tecniche](#2-matrice-delle-priorità-tecniche)
3. [FASE 1 — Paginazione Unificata Liste Critiche & Scalabilità Database (🟠 ALTA)](#fase-1--paginazione-unificata-liste-critiche--scalabilità-database)
4. [FASE 2 — Background Jobs: Automazione Notturna Cron & Resilienza Dispatcher (🟠 ALTA)](#fase-2--background-jobs-automazione-notturna-cron--resilienza-dispatcher)
5. [FASE 3 — Osservabilità: Logging Strutturato Pino & Tracciabilità Railway (🟡 MEDIA)](#fase-3--osservabilità-logging-strutturato-pino--tracciabilità-railway)
6. [FASE 4 — Audit Integrità Dati, Rilevamento Cicli DAG & Bonifica Storica (🟡 MEDIA)](#fase-4--audit-integrità-dati-rilevamento-cicli-dag--bonifica-storica)
7. [FASE 5 — Resilienza Dati: Backup Programmato, Restore Drill & Staging (🟡 MEDIA)](#fase-5--resilienza-dati-backup-programmato-restore-drill--staging)
8. [FASE 6 — Sicurezza Avanzata & Compliance (AML, eIDAS, GDPR) (🟢 BASSA)](#fase-6--sicurezza-avanzata--compliance-aml-eidas-gdpr)
9. [FASE 7 — Suite di Collaudo E2E sui Flussi Legali/Fiscali Critici (🟠 ALTA)](#fase-7--suite-di-collaudo-e2e-sui-flussi-legalifiscali-critici)
10. [FASE 8 — Pulizia Tipizzazione & Rimozione Cast Residui (🟢 BASSA)](#fase-8--pulizia-tipizzazione--rimozione-cast-residui)
11. [Checklist Operativa di Avanzamento](#11-checklist-operativa-di-avanzamento)

---

## 1. Stato di Avanzamento Attuale & Risultati Raggiunti

La piattaforma BluMan ha completato con successo le fasi critiche di sicurezza e architettura:

- ✅ **Sicurezza Multi-Tenant Reale**: RLS PostgreSQL attiva su 34 tabelle con ruolo `bluman_app` non bypassabile.
- ✅ **Chiusura Falla Sessioni Cross-Tenant (Fix 4)**:
  - Frontend: Separazione della chiave token portale cliente (`bluman_portal_token`) rispetto alla sessione operatore (`bluman_jwt_token`), risolvendo ogni rischio di disconnessione o collisione sul dominio unificato.
  - Backend: Filtraggio rigoroso delle query `GET /progetti` e `GET /progetti/:id` vincolate al `clienteId` ricavato dalla sessione autenticata (`client-<clienteId>`). Protezione estesa a comunicazioni e caricamento documenti.
- ✅ **Validazione Schemi Zod al 100%**:
  - Implementati controlli `safeParse` su tutte le route chiave: `auth`, `clienti`, `progetti`, `contabilita`, `documenti`, `fornitori`, `liquidazioneIva`, `solleciti`.
- ✅ **Hub Comunicazioni Omnichannel Completo**:
  - Ingestion allegati IMAP Inbound (`imapflow`) e WhatsApp Cloud API (Meta Graph API).
  - Spunte di recapito e lettura in tempo reale stile WhatsApp (`✓` inviato, `✓✓` consegnato, `✓✓` azzurro letto con sincronizzazione Webhook).
  - Smart chat scroll con ancoraggio automatico ai messaggi non letti e tasto flottante `⬇️ Scorri all'ultimo`.
- ✅ **Workflow Documentale & Firma Elettronica Legale (§WF-DOC)**:
  - Ciclo di vita a 4 stati (bozza ⇄ pubblicato ⇄ revisione ⇄ firmato), blocco modifiche a 409 con sblocco motivato riservato ad admin studio.
  - Firma OTP con generazione del sigillo crittografico lato server (SHA-256, timestamp, IP pubblico reale verificato, evidenze forensi).

---

## 2. Matrice delle Priorità Tecniche

| ID | Modulo / Task | Priorità | Rischio Attuale | Tempo Stimato | Dipendenze |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | Paginazione unificata 5 liste pesanti | 🟠 ALTA | Degrado performance con volumi crescenti di record | 1.5 giorni | Nessuna |
| **F2** | Scheduler notturno in-process per Cron scadenze | 🟠 ALTA | Mancata notifica automatica scadenze se non invocato via HTTP | 0.5 giorni | Nessuna |
| **F3** | Logging strutturato Pino su Fastify | 🟡 MEDIA | Difficoltà nel debug e correlazione log su Railway | 1 giorno | Nessuna |
| **F4** | Script Audit Integrità Progetti & Bonifica | 🟡 MEDIA | Incongruenze storiche su moduli vuoti o divergenze calcoli | 1 giorno | Nessuna |
| **F5** | Backup programmato & Drill di restore | 🟡 MEDIA | Rischio mancata procedura validata di Disaster Recovery | 1 giorno | Backup script esistente |
| **F6** | 2FA TOTP per Super Admin & OpenAPI Docs | 🟢 BASSA | Sicurezza account master non fortificata con secondo fattore | 1.5 giorni | Campo DB esistente |
| **F7** | Test E2E sui flussi critici (Progetto, Firma, SDI) | 🟠 ALTA | Rischio regressione su modifiche a logiche transazionali core | 2 giorni | Test runner Vitest |
| **F8** | Tipizzazione FastifyRequest & rimozione `as any` | 🟢 BASSA | Debito tecnico minore di compilazione TypeScript | 0.5 giorni | `fastify.d.ts` |

---

## FASE 1 — Paginazione Unificata Liste Critiche & Scalabilità Database

### 1.1 Motivazione e Problema
Attualmente le 5 liste principali restituiscono tutti i record del tenant senza clausola `take`/`skip` su Prisma:
1. `GET /invoices` (Fatture attive/passive e note di credito)
2. `GET /prima-nota` (Movimenti finanziari, cassa e banche)
3. `GET /progetti` (Fascicoli e commesse studio)
4. `GET /clienti` (Anagrafica clienti ERP)
5. `GET /audit` (Registro tracciamento attività operatori)

Con la crescita dello studio, il payload JSON e il consumo di RAM crescono linearmente, rallentando sia il rendering del frontend che il database.

### 1.2 Implementazione Tecnica

#### Schema di Validazione
Utilizzare lo schema già pronto `PaginazioneQuerySchema` in [`src/schemas/paginazione.schema.ts`](file:///Volumes/Macintosh%20HD/Users/mariodibenedetto/Downloads/bluman-api/src/schemas/paginazione.schema.ts):
```typescript
export const PaginazioneQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});
```

#### Standard di Risposta Retrocompatibile
Per non rompere i componenti frontend che si aspettano un array diretto, supportare:
- Chiamate senza parametri di paginazione: continuano a restituire l'array (o con default `limit: 50` + metadati).
- Formato strutturato con metadati:
```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 50,
    "totale": 240,
    "pagine": 5
  }
}
```

#### Esempio Endpoint `GET /invoices` in `src/routes/contabilita.ts`:
```typescript
const parsed = PaginazioneQuerySchema.safeParse(req.query);
const { page = 1, limit = 50, search, sortBy = 'dataEmissione', sortOrder = 'desc' } = parsed.success ? parsed.data : {};
const skip = (page - 1) * limit;

const where: any = { tenantId: req.tenantId };
if (search) {
  where.OR = [
    { numero: { contains: search, mode: 'insensitive' } },
    { cliente: { nome: { contains: search, mode: 'insensitive' } } }
  ];
}

const [fatture, totale] = await Promise.all([
  prisma.fattura.findMany({
    where,
    skip,
    take: limit,
    orderBy: { [sortBy]: sortOrder },
    include: { cliente: true, righe: true }
  }),
  prisma.fattura.count({ where })
]);

return reply.send({
  data: fatture,
  meta: { page, limit, totale, pagine: Math.ceil(totale / limit) }
});
```

#### Interventi Frontend
- `pages/InvoicesPage.tsx`: Integrazione componente paginatore in calce alla tabella con selettore pagine (1, 2, 3...) e numero elementi per pagina.
- `pages/PrimaNotaPage.tsx`: Paginazione server-side.
- `pages/Projects.tsx`: Supporto filtro di ricerca integrato con `skip`/`take`.
- `pages/ClientsPage.tsx`: Paginazione anagrafica ERP.
- `pages/AuditLogPage.tsx`: Caricamento paginato degli eventi di audit.

---

## FASE 2 — Background Jobs: Automazione Notturna Cron & Resilienza Dispatcher

### 2.1 Motivazione e Problema
La business logic per l'analisi delle scadenze è già completata in [`src/services/cronService.ts`](file:///Volumes/Macintosh%20HD/Users/mariodibenedetto/Downloads/bluman-api/src/services/cronService.ts) (`runDailyNotificationCron` per KYC annuali, UBO/MFSA e rate insolute). Tuttavia, attualmente viene innescata **solo** tramite richiesta HTTP esplicita su `POST /cron/esegui-notifiche-scadenze`. Se nessun servizio esterno effettua un webhook quotidiano, le notifiche di scadenza non partono.

### 2.2 Implementazione Tecnica

#### Scheduler In-Process Automatico
Creare un modulo autonomo `src/services/cronScheduler.ts` basato su `node-cron` (o timer nativo robusto) avviato da `src/server.ts`:
```typescript
// src/services/cronScheduler.ts
import cron from 'node-cron';
import { prismaAmministrativo } from '../util/prismaClient.js';
import { runDailyNotificationCron } from './cronService.js';

export function avviaSchedulerNotifiche(server: FastifyInstance) {
  // Ogni giorno alle 08:00 (Europe/Rome)
  cron.schedule('0 8 * * *', async () => {
    server.log.info('[CRON] Avvio scansione quotidiana scadenze tenant...');
    try {
      const tenants = await prismaAmministrativo().tenant.findMany({
        where: { attivo: true },
        select: { id: true, nome: true },
      });

      for (const t of tenants) {
        server.log.info(`[CRON] Elaborazione scadenze tenant ${t.nome} (${t.id})...`);
        const res = await runDailyNotificationCron(t.id);
        server.log.info(`[CRON] Tenant ${t.id} completato: generate ${res.notificheGenerate} notifiche.`);
      }
    } catch (err: any) {
      server.log.error('[CRON ERROR] Errore durante l\'esecuzione del cron quotidiano:', err);
    }
  }, {
    timezone: 'Europe/Rome'
  });
}
```

#### Coda di Dispatch Asincrono con Retry (Email & WhatsApp)
- Creare `src/services/notificationQueue.ts`:
  - Se il server SMTP (Register.it) o Meta Cloud API risponde lentamente, la richiesta dell'operatore non deve andare in timeout.
  - La coda accumula le notifiche, risponde `202 Accepted` al client e tenta l'invio con 3 tentativi e backoff esponenziale (1s, 5s, 25s).
  - Se tutti i tentativi falliscono, lo stato viene memorizzato come `errore_invio` con log dettagliato per l'audit.

---

## FASE 3 — Osservabilità: Logging Strutturato Pino & Tracciabilità Railway

### 3.1 Motivazione e Problema
In `src/server.ts` il logger di Fastify è impostato su `logger: false` o limitato. Diversi file utilizzano `console.log` o `console.error` non strutturati, rendendo difficile filtrare e correlare gli errori in produzione nei log di Railway.

### 3.2 Implementazione Tecnica

1. **Abilitazione Pino nativo su Fastify** in `src/server.ts`:
```typescript
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          path: req.routerPath,
          ip: req.ip,
          tenantId: (req as any).tenantId,
          userId: (req as any).userId,
          ruolo: (req as any).ruolo,
        };
      },
    },
  },
  trustProxy: true,
  bodyLimit: 45 * 1024 * 1024,
});
```

2. **Sanitizzazione Dati Sensibili nei Log**:
   - Mascherare automaticamente nei payload di log i campi: `password`, `password_hash`, `token`, `otp`, `contentBase64`, `iban`.

3. **Sostituzione Progressiva `console.*`**:
   - Sostituire le chiamate con `req.log.info()`, `req.log.warn()`, `req.log.error()` preservando il contesto di richiesta.

---

## FASE 4 — Audit Integrità Dati, Rilevamento Cicli DAG & Bonifica Storica

### 4.1 Motivazione e Problema
Nel corso dell'evoluzione della piattaforma, alcuni progetti storici possono contenere anomalie strutturali:
- Moduli template istanziati privi di microvoci o passaggi operativi.
- Progetti con disallineamento tra la percentuale calcolata dallo `stateEngine` e il campo memorizzato su DB.
- Potenziali dipendenze cicliche tra moduli (Modulo A dipende da B che dipende da A).
- Omonimie clienti non gestite.

### 4.2 Implementazione Tecnica

Creare `src/scripts/auditIntegritaProgetti.ts` (estendendo `probeAvanzamento.ts`):
1. **Verifica Grafi Ciclici (DAG)**:
   - Algoritmo di rilevamento cicli con DFS (Depth-First Search) sulle dipendenze `dipendenzeDa` di ogni modulo progetto.
2. **Rilevamento Moduli e Microvoci Vuote**:
   - Segnalazione progetti con moduli a 0 microvoci (es. caso storico "Struttura Holding Ricci").
3. **Controllo Coerenza Avanzamento**:
   - Confronto tra `calcolaAvanzamento(progetto)` e `progetto.avanzamentoPercentuale`.
4. **Bonifica Assistita**:
   - Script `src/scripts/bonificaDatiProgetti.ts` che esegue `ricalcolaProgetto()` in modalità controllata per ogni pratica disallineata con log dettagliato dei campi aggiornati.

---

## FASE 5 — Resilienza Dati: Backup Programmato, Restore Drill & Staging

### 5.1 Motivazione e Problema
Il database PostgreSQL su Supabase è protetto da RLS su 34 tabelle. È presente uno script di backup JSON (`src/scripts/backupDb.ts`), ma non è documentata una procedura di ripristino collaudata in caso di disaster recovery.

### 5.2 Implementazione Tecnica

1. **Script di Restore di Prova (`src/scripts/restoreDbTest.ts`)**:
   - Lettura del dump JSON prodotto da `backupDb.ts`.
   - Inserimento transazionale rispettando l'ordine di consistenza delle chiavi esterne (`Tenant` → `User` → `Cliente` → `Progetto` → `ModuloProgetto` → `MicrovoceProgetto` → `Documento` → `Fattura`...).
   - Validazione conteggio righe e integrità referenziale al termine del ripristino.
2. **Schedulazione Backup Automatico**:
   - Schedulazione su Railway cron o cron notturno con salvataggio cifrato su bucket dedicato Supabase Storage / S3.
3. **Ambiente di Staging Dedicato**:
   - Definire pipeline per testare nuove migrazioni Prisma e policy RLS su un database di staging prima del deploy in produzione.

---

## FASE 6 — Sicurezza Avanzata & Compliance (AML, eIDAS, GDPR)

### 6.1 Autenticazione 2FA (TOTP) per Super Admin
- **Stato attuale**: La tabella `User` contiene già la colonna `totpSecret`.
- **Implementazione**:
  - Utilizzo di `otplib` (zero dipendenze binarie) per generare il segreto e il QR code (standard RFC 6238).
  - Rotta `POST /auth/totp/attiva`: riceve il primo codice a 6 cifre per confermare l'accoppiamento con Google Authenticator / 1Password.
  - Rotta `POST /auth/totp/verifica`: al login, se l'utente è `super_admin`, viene richiesto il codice TOTP prima di rilasciare il JWT definitivo.

### 6.2 Rotazione Periodica dei Segreti
- Documentare la procedura per la rotazione di `JWT_SECRET`:
  - Supporto temporaneo di un array di chiavi di decodifica (chiave corrente + chiave precedente) per evitare di disconnettere immediatamente tutti gli operatori attivi durante la rotazione.

### 6.3 Documentazione OpenAPI / Swagger
- Installare `@fastify/swagger` e `@fastify/swagger-ui`.
- Generazione automatica della documentazione interattiva a partire dagli schemi Zod registrati, accessibile da `/docs` solo agli utenti advisor/super_admin autenticati.

---

## FASE 7 — Suite di Collaudo E2E sui Flussi Legali/Fiscali Critici

### 7.1 Obiettivo
Creare test end-to-end automatizzati (con database di test isolato o mock completo) per validare i 3 flussi critici della piattaforma:

1. **Flusso Creazione Progetto & Contrattualizzazione**:
   - Dalla selezione del preventivo alla firma della proposta di incarico.
   - Creazione transazionale di moduli, microvoci e deliverable con verifica rollback su errore.
2. **Flusso Workflow Documentale & Firma OTP (FEA/SES)**:
   - Caricamento documento da parte dell'advisor.
   - Pubblicazione al cliente con notifica email/WhatsApp.
   - Firma del cliente con OTP verificata, apposizione del sigillo crittografico con IP pubblico reale e timestamp certificato.
   - Verifica impossibilità di eliminazione (HTTP 409) e procedura di sblocco motivato.
3. **Flusso Ciclo Fiscale & Fatturazione SDI**:
   - Emissione fattura, applicazione aliquote IVA (incluse esenzioni art. 15, reverse charge, split payment).
   - Generazione XML conforme al tracciato SdI FatturaPA v1.2.2.
   - Registrazione automatica della contropartita in Prima Nota.

---

## FASE 8 — Pulizia Tipizzazione & Rimozione Cast Residui

### 8.1 Obiettivo
- Rimuovere i cast `(req as any)` sfruttando appieno l'estensione di tipo già dichiarata in `src/types/fastify.d.ts` (`tenantId`, `userId`, `ruolo`, `clienteId`).
- Tipizzare rigorosamente le risposte dei controller per garantire che le modifiche al database o ai tipi Prisma vengano intercettate al momento della compilazione TypeScript.

---

## 11. Checklist Operativa di Avanzamento

### 🚀 Sprint 1 — Scalabilità & Automazione Immediata (Priorità 🟠 ALTA)
- [ ] **1.1** Applicare `PaginazioneQuerySchema` a `GET /invoices` con metadati di paginazione.
- [ ] **1.2** Applicare paginazione a `GET /prima-nota`.
- [ ] **1.3** Applicare paginazione a `GET /progetti`.
- [ ] **1.4** Applicare paginazione a `GET /clienti`.
- [ ] **1.5** Applicare paginazione a `GET /audit`.
- [ ] **2.1** Creare scheduler notturno in-process in `src/services/cronScheduler.ts` per l'invio scadenze quotidiane.
- [ ] **2.2** Integrare scheduler nell'avvio del server in `src/server.ts`.

### 🛡️ Sprint 2 — Integrità & Osservabilità (Priorità 🟡 MEDIA)
- [ ] **3.1** Abilitare logger Pino con formattazione JSON strutturata in `src/server.ts`.
- [ ] **3.2** Sanitizzazione automatica campi sensibili nei log (password, token, OTP).
- [ ] **4.1** Creare script `src/scripts/auditIntegritaProgetti.ts` con algoritmo DFS per cicli DAG.
- [ ] **4.2** Eseguire script di audit in sola lettura e generare report anomalie progetti.
- [ ] **4.3** Bonifica assistita dei progetti con divergenze avanzamento o moduli vuoti.

### 🔒 Sprint 3 — Resilienza, Disaster Recovery & Sicurezza (Priorità 🟡/🟢)
- [ ] **5.1** Creare e testare script `src/scripts/restoreDbTest.ts` su database di test.
- [ ] **5.2** Schedulare backup periodico su storage cloud.
- [ ] **6.1** Implementare 2FA TOTP con `otplib` per gli utenti con ruolo `super_admin`.
- [ ] **6.2** Configurare documentazione interattiva OpenAPI / Swagger (`@fastify/swagger`).
- [ ] **7.1** Test E2E sul flusso creazione progetto e transazione atomica.
- [ ] **7.2** Test E2E sul ciclo firma OTP e sigillo forense.
- [ ] **7.3** Test E2E sulla generazione XML FatturaPA SDI.
- [ ] **8.1** Rimozione cast `as any` residui nelle route Fastify.

---

*Documento creato, versionato e sincronizzato con il repository ufficiale BluMan.*  
*Ogni avanzamento operativo verrà tracciato aggiornando la presente checklist.*
