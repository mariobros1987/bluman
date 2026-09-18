# 🛠 BluMan — Piano di Sviluppo e Correzione per l'Informatico
> Documento operativo derivato dall'analisi del 2026-09-08 e verificato direttamente sul codice sorgente della piattaforma. Ogni punto è pensato per essere assegnato come task singolo, con obiettivo, motivazione, stato reale nella codebase, lavoro tecnico richiesto e criterio di accettazione verificabile.

---

## 📊 Stato Reale della Codebase (Audit 2026-09-08)
Prima di iniziare, l'audit della codebase ha evidenziato che **diverse componenti chiave non devono essere riscritte da zero**, poiché già parzialmente implementate o impostate:

| Componente | File Esistente | Stato Attuale | Lavoro Residuo per l'Informatico |
| :--- | :--- | :--- | :--- |
| **Audit Progetti** | `src/scripts/probeAvanzamento.ts` | ✅ Copre già il 70%: scansiona in sola lettura progetti, divergenze stato calcolato vs salvato, moduli orfani e segnali rischio | Integrare verifica dipendenze cicliche, passaggi orfani e omonimie clienti |
| **Schemi Zod** | `src/schemas/*.schema.ts` (9 file) | ✅ **COMPLETATO AL 100%**: Collegati e attivi su tutte le route (`auth`, `clienti`, `progetti`, `contabilita`, `documenti`, `fornitori`, `liquidazioneIva`, `solleciti`) con `safeParse` | Mantenimento ed estensione a nuove route future |
| **Tipizzazione Fastify** | `src/types/fastify.d.ts` | ✅ Estende già `FastifyRequest` con `tenantId`, `userId`, `ruolo`, `user`, `clienteId` | Verificare e rimuovere i pochi cast residui |
| **Paginazione Schema** | `src/schemas/paginazione.schema.ts` | ✅ `PaginazioneQuerySchema` pronto con `page`, `limit`, `search`, `sortBy`, `sortOrder` | Applicare alle 5 rotte elenco su Prisma |
| **Cron Scadenze** | `src/services/cronService.ts` | ✅ Business logic completa: KYC/UBO annual return, rate aperte, deduplica 20h, notifiche DB | Attivare scheduler automatico in-process (`node-cron`), attualmente solo su rotta HTTP manuale |
| **Backup Database** | `src/scripts/backupDb.ts` | ✅ Script esistente che scarica dump JSON di tutte le tabelle isolate per tenant | Eseguire e documentare un drill di restore di prova |

---

## Legenda priorità

| Simbolo | Significato |
|---------|-------------|
| 🔴 BLOCCANTE | Da fare prima di continuare altro sviluppo — rischio dati/produzione |
| 🟠 ALTA | Da pianificare nella settimana corrente |
| 🟡 MEDIA | Da pianificare entro il mese |
| 🟢 BASSA | Backlog, nessuna urgenza |

---

## FASE 0 — Audit dati preliminare 🔴 BLOCCANTE
**Perché prima di tutto**: prima di fidarsi dello stateEngine su tutti i progetti, bisogna sapere quanti progetti hanno dati incoerenti oltre ai 2-3 casi già noti. Un progetto con moduli senza micro-voci calcola stati e percentuali sbagliati, che possono finire in fatture o report al cliente.

### 0.1 Script di audit integrità progetti
- **Base di partenza esistente**: `src/scripts/probeAvanzamento.ts` scansiona già tutti i progetti in sola lettura con `prismaAmministrativo()`, rileva moduli vuoti, divergenze tra stato calcolato dallo `stateEngine` e stato persistito su DB, e calcola i segnali di rischio delle microvoci.
- **Task**: creare/estendere in `src/scripts/auditIntegritaProgetti.ts` aggiungendo i controlli mancanti:
  - moduli senza micro-voci associate (già rilevati in `probeAvanzamento.ts`)
  - micro-voci senza passaggi operativi
  - progetti con stato calcolato diverso da quello persistito in DB (già rilevati)
  - dipendenze tra moduli che formano cicli (attraverso grafo DAG)
  - clienti o progetti con nomi duplicati / omonimi
- **Output atteso**: report testuale strutturato / JSON con tenant, progetto, tipo di anomalia riscontrata
- **Criterio di accettazione**: lo script gira su produzione in sola lettura (nessuna scrittura), tempo di esecuzione < 10 secondi, nessun impatto sul traffico live
- **Stima**: 0.25 giorni (grazie alla base già presente)

### 0.2 Bonifica dei casi noti
- Debito 3: decidere e sistemare i moduli senza micro-voci su "Struttura Holding Ricci"
- Debito 4: ricalcolare correttamente "holding dibenedetto" dopo aver capito la causa della percentuale errata (non premere semplicemente "Ricalcola avanzamento" senza log di cosa cambia)
- Debito 2: rimuovere le 2 righe utente inerti senza password dalla dashboard super admin
- Debito 5: verificare se i 2 clienti/progetti omonimi sono duplicati reali o casi legittimi, ed eventualmente aggiungere un identificativo distintivo in UI
- **Criterio di accettazione**: report dello script 0.1 pulito su questi casi specifici
- **Stima**: 0.5 giorni

---

## FASE 1 — Logging Strutturato 🟠 ALTA
**Perché prima del resto**: senza log strutturati è impossibile verificare in produzione se i fix successivi funzionano davvero. È la base abilitante per osservare il comportamento del backend su Railway.

### 1.1 Attivare Pino su Fastify
- **Stato attuale**: in `src/server.ts` riga 86 è presente `logger: false`.
- **Task**: abilitare Pino nativo in Fastify:
```typescript
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  },
  trustProxy: process.env.NODE_ENV === 'production',
  bodyLimit: 45 * 1024 * 1024,
});
```

### 1.2 Sostituire tutti i `console.log`/`console.error`
- Sostituire con `req.log.info()` / `req.log.error()` / `server.log.*` in tutte le rotte e servizi
- Includere sempre `tenantId` e `userId` (se autenticati) nei log come campi strutturati, non concatenati in stringa
- **Criterio di accettazione**: `grep -r "console\." src/` non restituisce risultati nei file di produzione (esclusi gli script CLI standalone); i log in produzione su Railway sono JSON strutturati parsabili
- **Stima**: 1 giorno

---

## FASE 2 — Validazione Zod e Tipi 🟠 ALTA

### 2.1 Collegare gli schemi Zod già pronti alle rotte — ✅ COMPLETATO (2026-09-11)
- **Stato completato**: tutti gli schemi Zod sono stati importati, collegati e validati con `safeParse` ritornando HTTP 400 con dettaglio di validazione Zod su tutte le rotte:
  - `src/routes/auth.ts`: `LoginSchema`, `ChangePasswordSchema`, `MagicLoginSchema`
  - `src/routes/clienti.ts`: `CreaClienteSchema`
  - `src/routes/progetti.ts`: `CreaProgettoSchema`, `ConsuntivaOreSchema`
  - `src/routes/contabilita.ts`: `EmettiFatturaSchema`, `RegistraIncassoSchema`
  - `src/routes/documenti.ts`: `GeneraDocumentoSchema`
  - `src/routes/fornitori.ts`, `liquidazioneIva.ts`, `solleciti.ts`: già validati
- **Esito**: verificato con suite completa di test (614/614 verdi) e rilasciato in produzione.

### 2.2 Consolidare FastifyRequest tipizzata
- **Stato attuale**: `src/types/fastify.d.ts` esiste già e dichiara `tenantId`, `userId`, `ruolo`, `user`, `clienteId`.
- **Task**: verificare che nessun controller utilizzi cast forzati come `(req as any).tenantId`.
- **Criterio di accettazione**: `grep -r "as any" src/routes/` non trova occorrenze su `req`.

### 2.3 Pulizia cast Prisma residui
- Dopo `npx prisma generate`, verificare che tutti i modelli (incluso `codiceOtp`) siano tipizzati dal client.
- Rimuovere i cast superflui.
- **Criterio di accettazione**: compilazione TypeScript con `npm run build` pulita a zero errori con `strict: true`.
- **Stima totale fase**: 2 giorni (ridotta da 4-5 giorni grazie agli schemi già scritti)

---

## FASE 3 — Paginazione Liste Critiche 🟠 ALTA
**Ordine di implementazione**: `GET /invoices` → `GET /prima-nota` → `GET /progetti` → `GET /clienti` → `GET /audit`

### 3.1 Utilizzo di `PaginazioneQuerySchema`
- **Stato attuale**: `src/schemas/paginazione.schema.ts` è già presente:
```typescript
export const PaginazioneQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});
```
- **Task**: applicare la paginazione alle query Prisma con conteggio totale:
```typescript
const { page = 1, limit = 50 } = req.query as PaginazioneQuery;
const skip = (page - 1) * limit;
const [data, totale] = await Promise.all([
  prisma.fattura.findMany({ where: filtri, skip, take: limit, orderBy: { createdAt: 'desc' } }),
  prisma.fattura.count({ where: filtri }),
]);
return { data, meta: { page, limit, totale, pagine: Math.ceil(totale / limit) } };
```
- **Criterio di accettazione**: nessuna delle 5 liste carica più di `limit` elementi per richiesta; il frontend supporta la paginazione o fallback a default 50 elementi; risposta rapida anche su archivi storici estesi.
- **Stima**: 1.5 giorni

---

## FASE 4 — Automazioni e Affidabilità 🟡 MEDIA

### 4.1 Attivazione automatica notturna del Cron
- **Stato attuale**: `src/services/cronService.ts` implementa già `runDailyNotificationCron()` completa di controlli su UBO-MFSA, KYC annuali, rate insolute e deduplica entro 20 ore. Attualmente è richiamabile solo via `POST /cron/esegui-notifiche-scadenze` in `src/routes/contabilitaCron.ts`.
- **Task**: schedulare l'esecuzione automatica quotidiana in-process (es. alle 08:00 ogni mattina) iterando su tutti i tenant attivi con `prismaAmministrativo()`.
```typescript
import cron from 'node-cron';
cron.schedule('0 8 * * *', async () => {
  const tenants = await prismaAmministrativo().tenant.findMany({ where: { attivo: true } });
  for (const t of tenants) {
    await runDailyNotificationCron(t.id);
  }
});
```
- **Criterio di accettazione**: il cron gira autonomamente senza chiamate HTTP esterne; i log attestano l'esecuzione e il numero di notifiche generate.
- **Stima**: 0.5 giorni

### 4.2 Coda notifiche asincrona con retry
- **Problema**: l'invio sincrono di Email/WhatsApp espone l'utente a rallentamenti o fallimenti HTTP se i server di Register.it o Meta Cloud API sono momentaneamente lenti.
- **Task**: implementare coda in-memory / job worker con max 3 tentativi e backoff esponenziale.
- **Criterio di accettazione**: la rotta di invio risponde immediatamente 202 Accepted, mentre il worker gestisce l'effettivo dispacciamento in background.
- **Stima**: 1.5 giorni

---

## FASE 5 — Produzione Solida 🟡 MEDIA

### 5.1 Monitoring Errori & Uptime
- Setup Sentry (`@sentry/node`) per tracciare eccezioni non gestite in produzione.
- Configurare Uptime monitoring (es. UptimeRobot) su endpoint `/health` (frequenza 60s).
- **Stima**: 0.5 giorni

### 5.2 Rate Limiting su Repliche
- Se si scala a repliche multiple su Railway, configurare store Redis per `@fastify/rate-limit`.
- **Stima**: 1 giorno

### 5.3 Drill di Restore del Backup Database 🟠 ALTA
- **Stato attuale**: `src/scripts/backupDb.ts` esiste già ed esegue il backup di tutte le 34 tabelle.
- **Task**: predisporre uno script di ripristino di prova (`src/scripts/restoreDbTest.ts`) ed eseguire un test di restore su ambiente isolato documentando il tempo impiegato e la consistenza referenziale.
- **Criterio di accettazione**: procedura di restore testata con successo su database di test.
- **Stima**: 0.5 giorni

### 5.4 Ambiente di Staging Separato 🟠 ALTA
- **Perché**: con RLS su 34 tabelle, le modifiche allo schema e le nuove migrazioni Prisma non devono mai andare direttamente in produzione senza un test preliminare.
- **Task**: istanziare un ambiente di staging (Supabase + Railway staging) con schema allineato e dati demo per testare `prisma migrate deploy` e le policy RLS.
- **Criterio di accettazione**: nessuna migrazione viene eseguita in produzione prima di essere validata in staging.
- **Stima**: 1 giorno

### 5.5 Audit Dipendenze Automatizzato 🟡 MEDIA
- Attivare `npm audit` o Dependabot su GitHub per identificare tempestivamente vulnerabilità sulle dipendenze esterne.
- **Stima**: 0.25 giorni

---

## FASE 6 — Sicurezza Avanzata 🟢 BASSA

### 6.1 Autenticazione a Due Fattori (TOTP) per Super Admin
- Campo `totpSecret` già presente nel modello `User`: abilitare verifica TOTP per gli utenti con ruolo `super_admin`.
- **Stima**: 1 giorno

### 6.2 Documentazione OpenAPI/Swagger
- Configurare `@fastify/swagger` per documentare automaticamente gli endpoint e gli schemi Zod.
- **Stima**: 1 giorno

### 6.3 Procedura di Rotazione Segreti
- Documentare procedura operativa per la rotazione periodica di `JWT_SECRET` e credenziali SMTP.
- **Stima**: 0.5 giorni

### 6.4 Conservazione e Privacy Dati (AML/GDPR)
- Definire policy di retention per documenti KYC/UBO ed esecuzione di anonimizzazione su richiesta.
- **Stima**: condivisa con il team di studio

---

## FASE 7 — Test End-to-End sui Flussi Critici 🟠 ALTA

### 7.1 Test E2E Creazione Progetto (Flusso 1)
- Dalla selezione cliente e accettazione preventivo fino a `stato: 'in_progress'`, verificando la transazione atomica su Modulo/Microvoce/Passaggio e il corretto rollback in caso di errore.

### 7.2 Test E2E Firma OTP Documenti (Flusso 3)
- Dalla pubblicazione del documento alla richiesta OTP e validazione sigillo.
- Verificare che l'IP registrato nel sigillo sia preso dal server (`req.ip`) e che l'eliminazione di documenti firmati sia bloccata con HTTP 409.

### 7.3 Test E2E Fatturazione SDI (Flusso 4)
- Dalla creazione fattura alla generazione XML FatturaPA v1.2.2 e lock sul progressivo annuale.

- **Criterio di accettazione**: test automatici che attestano la robustezza dei 3 flussi critici prima di ogni rilascio in produzione.
- **Stima**: 2-3 giorni

---

## Sequenza Operativa Immediata (Roadmap Prioritaria Aggiornata)

```
STEP 0 (Completato) ➜ FASE 2.1: Allacciamento schemi Zod già pronti alle route principali ✅ FATTO
STEP 0b (Completato)➜ Fix 4: Separazione sessione portale (`bluman_portal_token`) e isolamento progetti cliente ✅ FATTO
STEP 0c (Completato)➜ Hub Comunicazioni: Allegati IMAP/WhatsApp e Spunte stato WhatsApp-style ✅ FATTO

STEP 1 (Prioritario)➜ FASE 3: Paginazione unificata sulle 5 liste pesanti (GET /invoices, /prima-nota, /progetti, /clienti, /audit)
STEP 2 (Prioritario)➜ FASE 4.1: Scheduler notturno automatico in-process per il Cron scadenze (node-cron)
STEP 3 (Prossimo)   ➜ FASE 1: Attivazione Logging Pino strutturato su Fastify
STEP 4 (Prossimo)   ➜ FASE 0.1 & 0.2: Script Audit Integrità Progetti e bonifica dati noti
STEP 5 (A seguire)  ➜ FASE 5.4 & 5.3: Configurazione Staging e test di restore backup
STEP 6 (A seguire)  ➜ FASE 7: Test E2E sui flussi legali/fiscali critici
```

---

## Regole Inviolabili della Piattaforma

| # | Regola | Perché |
|---|--------|--------|
| 1 | RLS è la difesa — mai `new PrismaClient()` nelle rotte | Il filtro applicativo da solo non basta: RLS garantisce isolamento reale |
| 2 | Solo `prisma migrate deploy` in produzione | `db push --accept-data-loss` distrugge dati in silenzio |
| 3 | Tutto si salva su DB via API — localStorage non è persistenza | Un pulsante che scrive solo in localStorage non salva nulla |
| 4 | Stati e percentuali li calcola solo il backend | La logica di business e di calcolo avanzamento appartiene allo `stateEngine` |
| 5 | Il frontend non inventa dati | Se i dati mancano o non sono collegati, la UI deve dichiararlo esplicitamente |
| 6 | Mai credenziali hardcoded nel codice | `credenziali.test.ts` le cerca attivamente e blocca il CI |
| 7 | File max ~500 righe, split obbligatorio sopra ~800 | Monoliti rendono impossibili test e revisioni sicure |
| 8 | Deploy doppio: `git push` (Vercel) + `railway up` (backend) | Railway non è su auto-deploy da GitHub |
| 9 | Firme legali sigillate solo dal server (SHA-256, IP reale, timestamp) | Il browser non può certificare il proprio IP pubblico né il timestamp legale |
| 10 | Nessuna migrazione in produzione senza passare prima da staging | Protezione fondamentale per 34 tabelle multi-tenant |

---

## Architettura e Piattaforme di Produzione

| Componente | Piattaforma | Note Operative |
|------------|-------------|----------------|
| Backend Fastify | Railway | Aggiornare via CLI: `npx @railway/cli up --detach` |
| Frontend React | Vercel | Auto-deploy da `git push origin main` |
| Database | Supabase EU-WEST-1 | PostgreSQL con RLS attiva su 34 tabelle |
| Storage Documenti | Supabase Storage | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` configurati su Railway |
| Posta Elettronica | SMTP per tenant (Register.it) | Connessioni TLS enforced |
| WhatsApp Business | Meta Cloud API | Webhook ricezione: `/webhooks/communications/whatsapp/<slug>` — lo **slug è dello studio** e il valore esatto lo compone **Impostazioni Studio → Canali**. Il dominio è quello del **backend** (Railway), non quello del sito: i ponti su Vercel sono stati rimossi il 16/09/2026 |
| Telegram Bot | Bot API | Webhook ricezione: `/webhooks/communications/telegram` |
