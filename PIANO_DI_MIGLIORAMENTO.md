# 🛠️ BluMan — Piano di Miglioramento e Implementazione

> **Data**: 2025-07-14 (creazione) — ultimo aggiornamento in calce
> **Stato**: Fasi 0 e 1 completate, 6.1 CI/CD completata; Fasi 2-5 e resto Fase 6 in attesa
> **Autore**: Analisi AI completa del codebase
> **Priorità**: 🔴 Critica (sicurezza) → 🟠 Alta → 🟡 Media → 🟢 Bassa

---

## 📋 Indice

1. [Riepilogo Esecutivo](#1-riepilogo-esecutivo)
2. [FASE 0 — Sicurezza Critica (immediata)](#2-fase-0--sicurezza-critica)
3. [FASE 1 — Affidabilità e Correttezza](#3-fase-1--affidabilità-e-correttezza)
4. [FASE 2 — Refactoring Architetturale](#4-fase-2--refactoring-architetturale)
5. [FASE 3 — Qualità del Codice](#5-fase-3--qualità-del-codice)
6. [FASE 4 — Performance e Scalabilità](#6-fase-4--performance-e-scalabilità)
7. [FASE 5 — Nuove Funzionalità](#7-fase-5--nuove-funzionalità)
8. [FASE 6 — DevOps e CI/CD](#8-fase-6--devops-e-cicd)
9. [Checklist Finale](#9-checklist-finale)

---

## 1. Riepilogo Esecutivo

### Cosa funziona bene ✅
- Architettura multi-tenant con RLS PostgreSQL reale (ruolo `bluman_app` senza BYPASSRLS)
- Motore di stato puro (`stateEngine.ts`) ben progettato e testato
- Autenticazione JWT senza segreti hardcoded, password scrypt, magic link con hash SHA-256
- Presidio automatico contro credenziali cablate (`credenziali.test.ts`)
- Dockerfile con `migrate deploy` (non `db push`)
- `secrets/` correttamente escluso da git

### Cosa va corretto 🔴
| # | Problema | Rischio | Fase |
|---|----------|---------|------|
| 1 | ~~CORS `origin: true` + `credentials: true`~~ ✅ (0.1) | ~~Furto sessione cross-origin~~ | 0.1 |
| 2 | ~~Fallback InMemoryApp in produzione~~ ✅ (0.2) | ~~Dati non persistenti, comportamento imprevedibile~~ | 0.2 |
| 3 | ~~Frontend: fallback silenziosi che restituiscono `{ok:true}`~~ ✅ (0.3) | ~~Dati persi senza errore visibile~~ | 0.3 |
| 4 | ~~TLS `rejectUnauthorized: false` su SMTP/IMAP~~ ✅ (0.4) | ~~MITM su credenziali email~~ | 0.4 |
| 5 | ~~Confronto firma JWT non constant-time~~ ✅ (0.5) | ~~Timing attack (basso)~~ | 0.5 |
| 6 | ~~Audit log fuori contesto AsyncLocalStorage~~ ✅ (0.6) | ~~Audit su tenant sbagliato o perso~~ | 0.6 |
| 7 | ~~PDF fatture reali nel repo~~ ✅ (0.7) | ~~Esposizione dati sensibili~~ | 0.7 |
| 8 | ~~`eliminaProgetto` non transazionale~~ ✅ (1.1) | ~~Dati orfani su fallimento parziale~~ | 1.1 |
| 9 | `server.ts` monolite 4300 righe | Manutenibilità, rischio bug | 2.1 |
| 10 | Nessuna validazione input strutturata | Injection, dati malformati | 2.2 |
| 11 | Nessuna paginazione | Performance con dati crescenti | 4.1 |
| 12 | Rate limit in-memory | Inefficace con più repliche | 4.2 |

---

## 2. FASE 0 — Sicurezza Critica

> **Obiettivo**: Chiudere tutte le vulnerabilità di sicurezza note.
> **Tempo stimato**: 2-3 giorni
> **Impatto**: NESSUNA modifica funzionale, solo hardening.

### 0.1 🔴 CORS: whitelist delle origini — ✅ RISOLTO (2026-08-26)

**Risoluzione**: whitelist implementata in `src/server.ts` (~righe 269-301): le origini ammesse arrivano da variabili d'ambiente (`ALLOWED_ORIGINS`/frontend URL), con fail-fast in produzione se la whitelist manca o contiene `*` — l'avvio si blocca invece di riflettere qualunque origine.

**Problema**: `origin: true` riflette qualunque origine del richiedente. Combinato con `credentials: true`, un sito malevolo può fare richieste autenticate all'API BluMan usando i cookie/token del browser della vittima.

**File**: `src/server.ts` riga ~247

**Soluzione**:
```typescript
const ORIGINI_CONSENTITE = [
  'http://localhost:5173',           // dev frontend
  'http://127.0.0.1:5173',          // dev frontend
  'https://bluman.vercel.app',       // produzione frontend
  // Aggiungere qui eventuali altri domini autorizzati
];

server.register(cors, {
  origin: (origin, callback) => {
    // Consenti richieste senza Origin (curl, server-to-server, app mobile)
    if (!origin) return callback(null, true);
    if (ORIGINI_CONSENTITE.includes(origin)) return callback(null, true);
    callback(new Error('Origine non consentita'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'Accept'],
  credentials: true,
  strictPreflight: true,
});
```

**Nota**: In produzione, le origini dovrebbero venire da variabile d'ambiente `CORS_ORIGINS` (separata da virgole), non hardcoded.

**Verifica**:
```bash
# Deve restituire errore CORS
curl -H "Origin: https://evil.com" http://localhost:3000/health -v
# Deve funzionare
curl -H "Origin: http://localhost:5173" http://localhost:3000/health -v
```

---

### 0.2 🔴 Rimuovere fallback InMemoryApp in produzione — ✅ RISOLTO (2026-08-26)

**Risoluzione**: fail-fast in `src/index.ts` (§3.2): in produzione, senza PostgreSQL raggiungibile, il processo fa `process.exit(1)`; il fallback `InMemoryApp` resta attivo solo in sviluppo.

**Problema**: Se il DB non risponde, il server parte con `InMemoryApp`. In produzione questo significa: dati non persistenti, nessun isolamento tenant, comportamento imprevedibile. L'utente non sa che i suoi dati non vengono salvati.

**File**: `src/index.ts`

**Soluzione**:
```typescript
async function start() {
  console.log('🚀 Avvio del processo BluMan API...');

  const isProduction = process.env.NODE_ENV === 'production';

  let app: any;
  try {
    console.log('🔌 Connessione a PostgreSQL / Prisma in corso...');
    await prisma.$connect();
    // Verifica che il DB risponda davvero
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connessesso a PostgreSQL con successo.');
    app = new PrismaApp(prisma, TENANT_ID);
  } catch (e)
    if (isProduction) {
      // In produzione: fail-fast, non partire con dati finti
      console.error('❌ FATALE: impossibile connettersi a PostgreSQL in produzione.');
      console.error('   Il server non può avvi senza database. Controlla DATABASE_URL.');
      process.exit(1);
    }
    // Solo in sviluppo: fallback InMemory
    console.warn('⚠️ Impossibile connettersi a PostgreSQL, uso InMemoryApp fallback (solo dev):', e);
    app = new InMemoryApp();
  }

  // ... resto invariato
}
```

**Verifica**: Avviare il server senza DB in `NODE_ENV=production` → deve uscire con codice 1.

---

### 0.3 🔴 Frontend: eliminareare fallback silenziosi sulle scritture — ✅ RISOLTO (2026-08-26)

**Risoluzione**: verificato `frontend/src/api/client.ts`: le scritture non restituiscono più `{ ok: true }` con dati finti quando il backend non risponde; gli errori reali vengono propagati al chiamante (nessun catch silenzioso residuo).

**Problema**: Diverse funzioni in `frontend/src/api/client.ts`, se il backend non risponde, restituiscono `{ ok: true }` con dati finti. L'utente crede che l'azione sia stata salvata, ma non è così.

 è esattamente il meccanismoanicmo che ha causato il bug documentato "il cliente non vede i moduli inseriti dall'operatore".

**Funzioni da correg** (tutte in `frontend/src/api/client.ts`):

| Fun | Comportamento attuale | Correzione |
|------|---------------------|------------|
| `uploadFileApi` | `catch → { ok: true, url: ... }` | Propagare l'errore, mostrare messaggio UI |
| `creaGiurisdizioneApi` | `catch → { id: 'giur-...' }` | Propagare l'errore |
| `updateArticoloPrezzoApi` | `catch → { ok: true, ...input }` | Propagare l'errore |
| `fetchProgetti` | `catch → null` | Accettabile per letture, ma mostrare stato "offline" nella UI |
| `fetchProgettoDettaglio` | `catch → null` | Come sopra |
| `fetchModuliLibreria` | `catch → null` | Come sopra |
| `fetchClienti` | `catch → null` | Come sopra |

**Regola**: Le **scritture** (POST, PUT, PATCH, DELETE) non devono MAI avere fallback silenziosi. Le **letture** possono mostrare uno stato "offline" ma devono comunque segnalare il problema.

**Esempio di correzione per `uploadFileApi`**:
```typescript
export async function uploadFileApi(filename: string, contentBase64: string) {
  const res = await apiFetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ filename, contentBase64 }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.errore || 'Errore upload file: server non disponibile');
  }
  return await res.json();
}
```

**Verifica**: Disattivare il backend, provare a caricare un file → deve comparire un errore esplicito, non un finto successo.

---

### 0.4 🔴 TLS: riattivare verifica certificati — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `tlsRejectUnauthorized()` in `src/services/imapFetcher.ts:30` e `src/services/emailRelay.ts:197` impone `rejectUnauthorized: true` di default; la disattivazione è possibile solo in sviluppo tramite variabile d'ambiente esplicita.

**Problema**: `rejectUnauthorized: false` in `emailService.ts` disattiva la verifica del certificato TLS. Un attaccante in posizione di rete intermedia può intercettare le credenziali SMTP.

**File**: `src/services/emailService.ts` (righe ~38, ~92, ~166)

**Soluzione**:
```typescript
// RIMUOVERE da tutti i transporter:
// tls: { rejectUnauthorized: false }

// SOSTITUIRE CON:
tls: {
  rejectUnauthorized: true,  // Verifica certificato
  minVersion: 'TLSv1.2',    // Minimo TLS 1.2
}
```

**Eccezione**: Se il provider SMTP (es. Register.it) usa un certificato self-signed, configurare il CA specifico:
```typescript
tls: {
  rejectUnauthorized: true,
  ca: fs.readFileSync('/path/to/register-it-ca.pem'),
}
```

**Per IMAP** (`verifyRealImap`): stessa correzione sul socket TLS.

**Verifica**: Test SMTP con `npm run dev` → deve connettersi correttamente con verifica TLS attiva.

---

### 0.5 🟠 JWT: confronto firma constant-time — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `src/util/jwt.ts` usa `crypto.timingSafeEqual` per il confronto della firma (righe 129 e 165), eliminando il confronto stringa vulnerabile a timing attack.

**Problema**: `verifyJwt` usa `signature !== expectedSignature` (confronto stringa). Questo è teoricamente vulnerabile a timing attack, anche se il rischio è basso per HMAC-SHA256.

**File**: `src/util/jwt.ts` riga ~73

**Soluzione**:
```typescript
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [base64Header, base64Payload, signature] = parts;
    if (!base64Header || !base64Payload || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${base64Header}.${base64Payload}`)
      .digest('base64url');

    // Confronto a tempo costante
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload: JwtPayload = JSON.parse(
      Buffer.from(base64Payload, 'base64url').toString('utf8')
    );
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
```

---

### 0.6 🟠 Audit log: tenant esplicito — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `recordAudit` ora ha `tenantId` obbligatorio (non optional), scrive con `prismaAmministrativo()` (operazione di sistema, non soggetta a RLS), non usa più `setImmediate` (tutti i ~44 chiamanti fanno `await`) e logga gli errori con `console.error('[AUDIT] ...')` invece di ingoiarli. I due audit del login passano `userTenantId || TENANT_DEFAULT` perché per il super_admin `utente.tenantId` è null.

**Problema**: `recordAudit` in `server.ts` usa `prisma.auditLog.create` dentro `setImmediate`. A quel punto l'`AsyncLocalStorage` potrebbe non avere più il contesto tenant, quindi l'audit finisce sul tenant di default o fallisce silenziosamente (c è un `catch {}`).

**File**: `src/server.ts` funzione `recordAudit`

**Soluzione**: Passare il tenant esplicitamente e usare il client amministrativo per l'audit (l'audit è un'operazione di sistema, non soggetta a RLS del tenant corrente):
```typescript
async function recordAudit(params: {
  tenantId: string;  // OBBLIGATORIO, non optional
  userId?: string;
  userEmail?: string;
  userNome?: string;
  ruolo?: string;
  azione: string;
  entita: string;
  dettagli: string;
  ipAddress?: string | null;
}) {
  // Non usare setImmediate: se il processo muore, l'audit è perso.
  // Meglio await diretto o una coda con retry.
  try {
    await prismaAmministrativo().auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId ?? 'usr-system',
        userEmailEmail: params.userEmail ?? 'system@bluecode.advisory',
        userNome: params.userNome ?? 'Sistema / Operatore',
        ruolo: params.ruolo ?? 'operator',
        azione: params.azione,
        entita: params.entita,
        dettagli: params.dettagli,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    // L'audit non deve bloccare l'operazione, ma il fallimento VA loggato
    console.error('[AUDIT] Impossile registrare audit log:', err);
  }
}
```

**Nota**: Ogni chim a `recordAudit` deve già il `tenantId` dal payload JWT. Verificare che nessuna chimata lo passi senza.

---

### 0.7 🟠 Ripulire file sensibili dal repo — ✅ RISOLTO (2026-08-26)

**Risoluzione**: verificato con `git ls-files`: nessun PDF né file con dati reali è tracciato; l'unico file di configurazione tracciato è `.env.example` (solo segnaposto).

**Problema**: Nel repo ci sono file che contengono dati realieli:
- `BluMan_Fattura_FT-2026-001.pdf`
 `BluMan_Fattura_FT-2026-002.pdf`
- `Engagement_Leter_Mario_Dibenedetto.pdf`
- `BLUECODE-Logo-orizzontale-2-1.jpeg` (logo, meno critico)

**Soluzione**:
1. Spostare i PDF in una cartella non tracciata (es. `docs/privati/`)
 aggiungerla al `.gitignore`
2. Verficare con `git ls-filesles` che non siano già stati committati
3. Se sono nel history di git: valutare `git filter-branch` o BFG per rimuoverli

```bash
# .gitignore - aggiungerere:
*.pdf
docs/privati/
```

---

## 3. FASE 1 — Affidabilità e Corretteza

> **Obietivo**: Eliminare i comportmenti che posono portare a dati corrotti o inconsistenti.
> **Tempo stimato**: 3-4 giorni
> **Impatto**: Nessuna modfica funziomle est, solo robbstezza.

### 1.1 🟠 `elimProgetto`: transazione atomica — ✅ RISOLTO (2026-08-26)

**Risoluzione**: la logica transazionale FK-safe esisteva già nell'adapter (`PrismaApp.eliminaProgetto`) ma era orfana: nessuna rotta HTTP la esponeva, quindi il frontend (`eliminaProgettoApi` in ProjectDetail) riceveva 404. Aggiunta la rotta `DELETE /progetti/:id` in `src/server.ts` con: guard di ruolo (solo `super_admin`/`advisor`, come `/progetti/:id/ricalcola`), audit `PROGETTO_ELIMINATO`, errori tradotti dal gestore centrale (progetto inesistente → 404, fatture presenti → 409). L'adapter ora riceve il tenant della richiesta JWT (prima usava solo quello fisso del costruttore) e `ProgettoNonTrovatoError` non viene più mascherato da errore di record collegati. Coperta da 4 test in `src/server.test.ts` (suite a 273 test verdi).

**Problema**: La cancellazione di un progetto avviene con una serie di `deleteMany`/ `delete` in sequenza. Se uno fallisce a metà, restano dati orfni.

**File**: `src/adapters/prisma/prismaApp.ts` metodo `elimProgetto`

**Soluz**: Avvolgereere tutto in una transione interattiva:
```typescript
async eliminaProgetto(id: string): Promise<void> {
  const fatture = await this.prisma.fattura.count({
    where: { progettoId: id, tenantId: this.tenantId },
  });
  if (fatture > 0) {
    throw new TransizioneNonValidaError(
      `Impossibile eliminare il progetto: contiene ${fatture} fatture/NC. Archivialo.`
    );
  }

  await this.prisma.$transaction(async (tx) => {
    // Imposta contesto tenant nella transazione
    await conContestoInTransazione(tx, async () => {
      const moduli = await tx.moduloProgetto.findMany({ where: { progettoId: id } });
      for (const m of moduli) {
        await tx.moduloProgettoDipendenza.deleteMany({ where: { dipendeDaModuloProgettoId: m.id } });
        await tx.moduloProgettoDipendenza.deleteMany({ where: { moduloProgettoId: m.id } });
        await tx.passaggioProgetto.deleteMany({ where: { microvoceProgetto: { moduloProgettoId: m.id } } });
        await tx.microvoceProgetto.deleteMany({ where: { moduloProgettoId: m.id } });
      }
      await tx.moduloProgetto.deleteMany({ where: { progettoId: id } });
      await tx.preventivo.deleteMany({ where: { progettoId: id } });
      await tx.eventoCalendario.deleteMany({ where: { progettoId: id } });
      await tx.accessoRisorsa.deleteMany({ where: { progettoId: id } });
      await tx.comunicazioneProgetto.deleteMany({ where: { progettoId: id } });
      await tx.progetto.delete({ where: { id, tenantId: this.tenantId } });
    });
  });
}
```

**Alternativa migliore (lungo termine)**: Aggiungere `onDelete: Cascade` alle relazioni in `prisma/schema.prisma` dove appropriato, così il DB gestisce la cascata automaticamente.

---

### 1.2 🟠 Cron service: rimuovere fallback mock — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `src/services/cronService.ts` ora crea le notifiche reali sul database (nessun cliente fittizio nei catch), con deduplicazione giornaliera (`giaNotificataOggi`): il report del cron riflette solo la realtà.

**Problema**: `cronService.ts` ha un `catch` che, se la query al DB fallisce, inventa un cliente fittizio e lo conta come "notifica inviata". Il report del cron deve riflettere solo la realtà.

**File**: `src/services/cronService.ts` righe ~35-44

**Soluzione**:
```typescript
// RIMUOVERE il blocco catch con i dati mock:
// catch {
//   clienti = [{ id: 'c-1', nome: 'Holding Beta S.r.l.', ... }];
// }

// SOSTITUIRE CON:
try {
  clienti = await prisma.cliente.findMany({ where: tenantFilter });
} catch (err) {
  console.error('[CRON] Errore lettura clienti:', err);
  report.dettagli.push('[ERRORE] Impossibile leggere i clienti dal database');
  return report;  // Interrompe il cron, non inventa dati
}
```

---

### 1.3 🟠 Health check con verifica DB — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `GET /health` in `src/server.ts` esegue un ping reale del database (`SELECT 1` con timeout corto); se il DB è irraggiungibile risponde 503 con `{ stato: 'degradato' }`, così Railway riavvia l'istanza invece di servire errori.

**Problema**: `GET /health` restituisce `{ stato: 'ok' }` senza verificare che il DB sia raggiungibile. Railway può continuare a mandare traffico a un'istanza il cui DB è giù.

**File**: `src/server.ts`

**Soluzione**:
```typescript
server.get('/health', async (_req, reply) => {
  try {
    await prismaAmministrativo().$queryRaw`SELECT 1`;
    return { stato: 'ok', database: 'connesso', timestamp: new Date().toISOString() };
  } catch {
    reply.code(503);
    return { stato: 'degradato', database: 'non raggiungibile', timestamp: new Date().toISOString() };
  }
});
```

**Nota**: Usare `prismaAmministrativo()` perché l'health check non ha un tenant corrente.

---

### 1.4 🟡 Frontend: rimuovere `mockData` da App.tsx — ✅ RISOLTO (2026-08-26)

**Risoluzione**: `frontend/src/store/mockData.ts` è stato rimosso (la cartella `store/` non esiste più); App.tsx usa solo dati provenienti dalle API. Aggiornato anche `.agents/AGENTS.md` (Regola 7).

**Problema**: `App.tsx` importa `PROJECTS` da `store/mockData.ts` per il conteggio alert. Dat finti mescolati a a dati reali.

**File**: `frontend/src/App.tsx` riga ~24, ~50

**Soluzione**: Il conteggio alert deve venire dai dati reali dell'API (progetti con `segngnaleRischio` o stato `delayed`/`blocked`).

---

## 4. FASE 2 — Refactoring Archititettrale

> **Obiettivo**: Rendere il codice manutengile e testabile.
> **Tempo stimato**: 1-2 setimane
> **Impatto**: Nessuna modifca funzionale. Il comportmento est deve restare identico.

### 2.1 ✅ Spezz `server.ts` in moduli di route — COMPLETATO (27/08/2026)

**Problema**: 4.300+ r in un singlo file. Ogni modfica è a rischio di trovare, testare, revieware.

**Risoluzione**: fatto il 27/08/2026 in 9 commit bisectabili ("Split monoliti 1/9…9/9"). `src/server.ts` è passato da ~4.570 a 513 righe: tiene middleware, hook `onRequest`, `/stream` SSE, health/refresh, error handler centrale e chiusura del wrapper `server.register`. Le rotte vivono in 11 moduli `src/routes/*.ts` (auth, tenant, catalogo, clienti, progetti, contabilita, documenti, portale, firma, notifiche, webhooks), registrate con `await registraRotte*(server[, app])` SEMPRE dentro il wrapper — hook auth e rate-limit si applicano esattamente come prima. Gli helper condivisi sono in `src/util/serverHelpers.ts`. Split puramente meccanico: zero cambi di comportamento, nessun rename; a ogni passo vitest (352/352), `tsc --noEmit` root e `tsc -b` frontend verdi. Nota: hook/limiter/error handler sono rimasti nel guscio invece che in `src/plugins/` per non spostare la chiusura del contesto di incapsulamento — la struttura proposta qui sotto è indicativa, quella reale è questa.

**Struttura proposta**:
```
src/
├── server.ts              → buildServer() registra, registra plugin
├── routes/
│   ├── index.ts           → registra tutte le route
│   ├── auth.ts            → /auth/* (login, magic, me,│   ├── clienti.ts         → /clientien/*
│   ├── progetti.ts        → /proget/*
│   ├── moduli.ts           → /moduli/*, /articoli/*
│   ├── fatture.ts         → /fatture/*
│   ├── tenant.ts          → /tenant/*
│   ├── admin.ts           → /admin/*
│   ├── portal.ts          → /portal/*
│   ├── upload.ts          → /upload, /uploads/*
│   ├── webhooks.ts        → /webhooks/*
│   ├── comunicazioni.ts   → /comunicazioni/*
│   └── cron.ts            → /cron/*
├── plugins/
│   ├── authGuard.ts       → hook onRequest + ROTTE_PUBBLICHE
│   ├── rateLimiter.ts     → rate limiting
│   └── errorHandler.ts    → setErrorHandler
```

**Approccio**:
1. Creare `src/routes/` e `src/plugins/`
2. Estrarre un gruppo di route alla volta
3. Dopo ogni estrazione: `npm test` deve passare
4. `server.ts` finale: ~100 righe che registrano i plugin

**Esempio `src/plugins/authGuard.ts`**:
```typescript
import { type FastifyInstance } from 'fastify';
import { verifyJwt, signJwt } from '../util/jwt.js';
import { attivaContestoTenant } from '../util/prismaClient.js';

export const ROTTE_PUBBLICHE = new Set<string>([
  'GET /health',
  'POST /auth/login',
  // ...
]);

export async function authGuardPlugin(server: FastifyInstance) {
  server.addHook('onRequest', async (req, reply) => {
    // ... logica esistente estratta da server.ts
  });
}
```

---

### 2.1b ✅ Split frontend: `ClientPortal.tsx` — COMPLETATO (28/08/2026)

**Problema**: `frontend/src/pages/ClientPortal.tsx` era il monolite più grande del frontend (4.668 righe): login, 7 tab, 6 modali e tutto lo stato del portale cliente in un solo file.

**Risoluzione**: fatto il 28/08/2026 (commit `6aee803`). `ClientPortal.tsx` è passato da 4.668 a 1.890 righe: mantiene **tutto lo stato** (useState), gli handler async e gli useEffect; il JSX è migrato in 18 componenti presentazionali in `frontend/src/components/portal/`:

```
components/portal/
├── types.ts               → tipi condivisi del portale (NotificaPortale, ModuloProposta, PortalTab, BersaglioFirma…)
├── mapPortalModules.ts    → mapProjectToPortalModules
├── format.ts              → dataOraLeggibile
├── styles.ts              → stili condivisi (portalWrapper, topNav, heroBanner, tabsBar, docBox…)
├── PortalLogin.tsx        → schermata di accesso (credenziali + magic link)
├── TabProposta.tsx        → tab proposta/incarico + addendum
├── TabAvanzamento.tsx     → tab avanzamento moduli
├── TabForm.tsx            → tab form proposta dati
├── TabDocumenti.tsx       → tab vault documenti + firma
├── TabFatture.tsx         → tab fatture
├── TabContatti.tsx        → tab contatti studio
├── TabProfilo.tsx         → tab profilo + cambio password
├── FirmaOtpModal.tsx      → modale OTP della firma SES
├── DocumentViewerModal.tsx→ viewer A4 pre-firma
├── ModificaDocModal.tsx   → richiesta modifiche documento
├── SuccessSealModal.tsx   → attestazione/ricevuta di firma
├── InvioManualeModal.tsx  → conferma invio firma a penna/qualificata esterna
└── DettaglioModuloModal.tsx→ dettaglio attività modulo + firma conclusione
```

Split puramente presentazionale: nessun cambio di comportamento, `App.tsx` invariato (`<Route path="/portal" element={<ClientPortal />} />`), `npx tsc -b` verde. Restano da spezzare gli altri monoliti frontend (§2.1c).

### 2.1c ⏳ Split frontend: gli altri monoliti — IN CORSO

**Problema**: restano file frontend sopra le ~1.300 righe: `ProjectDetail.tsx` (3.377), `Library.tsx` (2.879), `api/client.ts` (2.792), `SettingsPage.tsx` (1.905), `PassaggioModal.tsx` (1.801), `DocumentEditorPage.tsx` (1.552), `ClientsPage.tsx` (1.384).

**Approccio**: stesso metodo di §2.1b — estrazione presentazionale (stato e logica restano nel padre), un file alla volta, `npx tsc -b` dopo ogni estrazione. `api/client.ts` è un caso a parte: non è JSX ma un catalogo di funzioni API, si spezza per dominio (clienti, progetti, documenti, portale, firma…) mantenendo la barrel export per non rompere gli import esistenti.

**Progresso**:
- ✅ `ProjectDetail.tsx` (28/08/2026, commit `8a19b6f`): da 3.377 a 883 righe. La pagina mantiene stato, handler ed effetti; estratti 10 componenti in `frontend/src/components/projectDetail/` (`HeaderProgetto`, `ModuliTab`, `DocumentiTab`, `CalendarioProgettoTab`, `RedditivitaTab`, `StoricoContrattiTab`, `RichiesteAddendumTab`, `GrafoModuliProgettoView`, `ModalAccessiProgetto` + `documentiUtils.ts`). `FatturazioneTab` e `ModuloBlock` erano già stati estratti in `15a630d`. `npx tsc -b` verde.
- ⏳ `Library.tsx` — split in corso (28/08/2026).
- ⏸ Coda: `api/client.ts`, `SettingsPage.tsx`, `PassaggioModal.tsx`, `DocumentEditorPage.tsx`, `ClientsPage.tsx`.

---

### 2.2 🔴 Validazione input con Zod

**Problema**: La validazione degli input è manuale e sparsa. Ogni endpoint fa i propri controlli `if (!email || !password)`. Manca una validazione strutturata di tipi, lunghezze, formati.

**Soluzione**: Introdurre [Zod](https://zod.dev/) + integrazione Fastify.

```bash
npm install zod fastify-type-provider-zod
```

**Esempio**:
```typescript
// src/schemas/auth.ts
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email().max(255).transform(v => v.toLowerCase().trim()),
  password: z.string().min(1).max(128),
});

export const MagicLoginSchema = z.object({
  magicToken: z.string().min(10).max(500),
});

// src/routes/auth.ts
server.post('/auth/login', {
  schema: { body: LoginSchema },
}, async (req, reply) => {
  const { email, password } = req.body; // già validato e trasformato
  // ...
});
```

**Schema da creare per ogni endpoint**:
- `auth.ts`: login, magic-login, change-password
- `clienti.ts`: crea/aggiorna cliente
- `progetti.ts`: crea progetto, consuntiva, ritardo
- `fatture.ts`: emetti fattura
- `tenant.ts`: crea utente, aggiorna settings

---

### 2.3 🟡 Tipizzare Fastify request (eliminare `as any`)

**Problema**: `(req as any).tenantId`, `(req as any).ruolo`, `(req as any).user` — TypeScript non può verificare questi campi.

**Soluzione**: Decorare Fastify con tipi propri:
```typescript
// src/types/fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    ruolo?: string;
    user?: JwtPayload;
    userId?: string;
  }
}
```

Dopo questa dichiarazione, `req.tenantId` funziona senza `as any`.

---

### 2.4 🟡 Eliminare `(prisma as any)` nei servizi

**Problema**: `otpService.ts` usa `(prisma as any).codiceOtp` — il tipo del client esteso non include i modelli.

**Soluzione**: Il tipo `PrismaConContesto` in `prismaClient.ts` dovrebbe già includere tutti i modelli. Verificare che `prisma generate` sia stato eseguito e che il tipo sia corretto. Se il problema persiste, creare un'interfaccia esplicita:
```typescript
// Invece di (prisma as any).codiceOtp.findFirst(...)
// Usare:
prisma.codiceOtp.findFirst(...)  // Se il tipo è corretto
```

---

## 5. FASE 3 — Qualità del Codice

> **Obiettivo**: Migliorare testabilità, logging, gestione errori.
> **Tempo stimato**: 1 settimana

### 3.1 🟡 Logging strutturato con Pino

**Problema**: `Fastify({ logger: false })` + `console.log` sparsi. In produzione i log non sono strutturati, non si possono filtrare, non hanno correlation ID.

**Soluzione**:
```typescript
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});
```

Sostituire tutti i `console.log`/`console.error` con `req.log.info()`/`req.log.error()`.

---

### 3.2 🟡 Test E2E sul flusso critico

**Flusso da testare**:
1. Bootstrap super_admin
2. Login → JWT
3. Crea cliente
4. Crea progetto
5. Crea preventivo
6. Accetta preventivo → istanziazione
7. Consuntiva microvoce
8. Verifica cascata stati
9. Emetti fattura
10. Verifica PDF

**Strumento**: Vitest + supertest (o Playwright per il frontend).

---

### 3.3 🟢 OpenAPI / Swagger

Generare documentazione automatica delle ~87 rotte con `@fastify/swagger`:
```bash
npm install @fastify/swagger @fastify/swagger-ui
```

---

## 6. FASE 4 — Performance e Scalabilità

> **Obiettivo**: Preparare il sistema alla crescita.
> **Tempo stimato**: 1 settimana

### 4.1 🟡 Paginazione su tutte le liste

**Problema**: `listaProgetti`, `listaClienti`, `listaFattureTutte` caricano tutto. Con centinaia di progetti e migliaia di fatture, le query diventano lente e la risposta enorme.

**Soluzione**: Parametri `page` e `pageSize` su ogni endpoint GET di lista:
```typescript
// GET /progetti?page=1&pageSize=50
const { page = 1, pageSize = 50 } = req.query;
const skip = (page - 1) * pageSize;
const [progetti, totale] = await Promise.all([
  prisma.progetto.findMany({ skip, take: pageSize, ... }),
  prisma.progetto.count({ ... }),
]);
return { data: progetti, meta: { page, pageSize, totale, pagine: Math.ceil(totale / pageSize) } };
```

---

### 4.2 🟡 Rate limiting distribuito (Redis)

**Problema**: Il rate limit in-memory funziona solo con una singola istanza. Con più repliche Railway, ogni istanza ha il suo contatore.

**Soluzione**: `@fastify/rate-limit` con store Redis:
```bash
npm install @fastify/rate-limit ioredis
```
```typescript
server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  redis: new Redis(process.env.REDIS_URL),
  // Whitelist per health check e webhook
  whitelist: (req) => req.url === '/health' || req.url.startsWith('/webhooks/'),
});
```

---

### 4.3 🟢 Indici database

Verificare che esistano indici su:
- `cliente.tenant_id`
- `progetto.tenant_id`, `progetto.cliente_id`, `progetto.stato`
- `fattura.tenant_id`, `fattura.progetto_id`
- `microvoce_progetto.modulo_progetto_id`
- `user.email` (già unique)
- `magic_link.token_hash`

---

## 7. FASE 5 — Nuove Funzionalità

> **Obiettivo**: Completare le funzionalità mancanti.
> **Tempo stimato**: 2-3 settimane

### 5.1 🟡 Scheduler cron reale

**Problema**: Il cron è un endpoint HTTP (`POST /cron/esegui-notifiche-scadenze`) che va chiamato manualmente o con un servizio esterno.

**Soluzione**: Integrare `node-cron` nel processo:
```bash
npm install node-cron
```
```typescript
import cron from 'node-cron';

// Ogni giorno alle 8:00
cron.schedule('0 8 * * *', async () => {
  for (const tenant of await prismaAmministrativo().tenant.findMany()) {
    attivaContestoTenant({ tenantId: tenant.id, ruolo: 'system' });
    await runDailyNotificationCron(tenant.id);
  }
});
```

---

### 5.2 🟡 Coda per notifiche con retry

**Problema**: L'invio email/WhatsApp è inline nella richiesta. Se il provider è lento o giù, la richiesta HTTP fallisce o va in timeout.

**Soluzione**: Coda semplice in-memory (o BullMQ con Redis per produzione):
```typescript
// src/services/notificationQueue.ts
const coda: Array<{ tipo: 'email' | 'whatsapp'; payload: any; tentativi: number }> = [];

export function accodaNotifica(tipo: 'email' | 'whatsapp', payload: any) {
  coda.push({ tipo, payload, tentativi: 0 });
}

// Worker che processa la coda ogni 5 secondi con retry (max 3 tentativi)
```

---

### 5.3 🟢 TOTP per super_admin

Il campo `totpSecret` esiste già in `User`. Implementare:
- Generazione secret TOTP al bootstrap
- Verifica TOTP al login per `super_admin`
- Libreria: `otplib` (pure JS, no binding nativi)

---

### 5.4 🟢 Backup DB schedulato

Lo script `src/scripts/backupDb.ts` esiste. Schedularlo:
- Railway: cron job separato
- Oppure: `node-cron` nel processo principale (ogni notte alle 3:00)
- Destinazione: Supabase Storage o S3

---

## 8. FASE 6 — DevOps e CI/CD

> **Obiettivo**: Automatizzare test, deploy, monitoring.
> **Tempo stimato**: 1 settimana

### 6.1 ✅ CI/CD con GitHub Actions (fatto, 27 agosto 2026)

La workflow reale è `.github/workflows/ci.yml` (push e PR su `main`) e comprende,
nell'ordine: setup Node 20 con cache npm su entrambi i lockfile, `npm ci` in radice,
`npx prisma generate`, **typecheck backend** (`npx tsc --noEmit`), **suite completa**
(`npx vitest run`), **build backend** (`npm run build`), `npm ci` in `frontend/`,
**typecheck frontend REALE** (`npx tsc -b --force` — il `tsc --noEmit` sul tsconfig del
frontend con `"files": []` non verifica nulla) e **build frontend** (`tsc -b && vite build`).
`frontend/package-lock.json` è versionato perché `npm ci` funzioni in CI.

---

### 6.2 🟢 Monitoring

- **Sentry**: Error tracking backend + frontend
- **Uptime check**: `GET /health` ogni 60s da un servizio esterno
- **Alerting**: Notifica se health check fallisce per 3 minuti consecutivi

---

### 6.3 🟢 Variabili d'ambiente documentate

Creare `.env.example`:
```bash
# Database
DATABASE_URL=postgresql://bluman_app:PASSWORD@host:5432/bluman
DIRECT_URL=postgresql://postgres:PASSWORD@host:5432/bluman
ADMIN_DATABASE_URL=postgresql://postgres:PASSWORD@host:5432/bluman

# Auth
JWT_SECRET=  # minimo 32 caratteri, genera con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# App
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://bluman.vercel.app
CORS_ORIGINS=https://bluman.vercel.app

# SMTP (fallback, le credenziali reali stanno in tenant)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=

# Supabase Storage (opzionale)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Redis (per rate limit distribuito, Fase 4)
REDIS_URL=
```

---

## 9. Checklist Finale

### FASE 0 — Sicurezza (2-3 giorni)
- [x] 0.1 CORS whitelist origini
- [x] 0.2 Fail-fast senza DB in produzione
- [x] 0.3 Frontend: rimuovere fallback silenziosi su scritture
- [x] 0.4 TLS `rejectUnauthorized: true`
- [x] 0.5 JWT confronto constant-time
- [x] 0.6 Audit log con tenant esplicito
- [x] 0.7 File sensibili fuori dal repo

### FASE 1 — Affidabilità (3-4 giorni)
- [x] 1.1 `eliminaProgetto` in transazione
- [x] 1.1bis `eliminaModulo` con transazione, controllo ruoli e blocco ore consuntivate
- [x] 1.2 Cron senza dati mock
- [x] 1.3 Health check con verifica DB
- [x] 1.4 Frontend: rimuovere mockData da App.tsx
- [x] 1.5 §WF-DOC: Workflow bidirezionale documenti (bozza ⇄ pubblicato ⇄ revisione ⇄ firma OTP con versioning a DB)
- [x] 1.6 §WF-DOC hardening (27/08/2026): documento firmato blocca tutto con 409 (stato/nuova versione/eliminazione), sblocco riservato all'admin del tenant con motivazione ≥10 caratteri e audit, tracciabilità a ritroso nel portale cliente (`documentoPadreId` + `versioniPrecedenti[]`)

### FASE 2 — Refactoring (1-2 settimane)
- [x] 2.1 Spezzare server.ts in moduli route (27/08/2026, commit da 246d313 a 05c3d7e)
- [x] 2.1b Split frontend ClientPortal.tsx (28/08/2026, commit 6aee803)
- [ ] 2.1c Split frontend altri monoliti (ProjectDetail ✅ 8a19b6f; Library, api/client.ts, SettingsPage, PassaggioModal, DocumentEditorPage, ClientsPage)
- [ ] 2.2 Validazione Zod su tutti gli endpoint
- [ ] 2.3 Tipizzare FastifyRequest
- [ ] 2.4 Eliminare `as any` residui

### FASE 3 — Qualità (1 settimana)
- [ ] 3.1 Logging Pino strutturato
- [ ] 3.2 Test E2E flusso critico
- [ ] 3.3 OpenAPI/Swagger

### FASE 4 — Performance (1 settimana)
- [ ] 4.1 Paginazione liste
- [ ] 4.2 Rate limit Redis
- [ ] 4.3 Indici DB

### FASE 5 — Funzionalità (2-3 settimane)
- [ ] 5.1 Cron schedulato reale
- [ ] 5.2 Coda notifiche con retry
- [ ] 5.3 TOTP super_admin
- [ ] 5.4 Backup DB schedulato

### FASE 6 — DevOps (1 settimana)
- [x] 6.1 CI/CD GitHub Actions
- [ ] 6.2 Monitoring Sentry + uptime
- [ ] 6.3 `.env.example` documentato

---

## 📊 Timeline Complessiva

| Fase | Durata | Priorità | Dipendenze |
|------|--------|----------|------------|
| 0 — Sicurezza | 2-3 giorni | 🔴 CRITICA | Nessuna |
| 1 — Affidabilità | 3-4 giorni | 🟠 ALTA | Fase 0 |
| 2 — Refactoring | 1-2 settimane | 🔴 ALTA | Fase 1 |
| 3 — Qualità | 1 settimana | 🟡 MEDIA | Fase 2 |
| 4 — Performance | 1 settimana | 🟡 MEDIA | Fase 2 |
| 5 — Funzionalità | 2-3 settimane | 🟢 BASSA | Fase 2 |
| 6 — DevOps | 1 settimana | 🟢 BASSA | Fase 3 |

**Totale stimato**: 6-8 settimane per completamento integrale.
**Minimo indispensabile per produzione sicura**: Fasi 0 + 1 = ~1 settimana.

---

*Ultimo aggiornamento: 2026-08-28 (split monoliti frontend §2.1c: `ProjectDetail.tsx` da 3.377 a 883 righe con 10 componenti in `components/projectDetail/`, commit `8a19b6f`; `Library.tsx` in corso; deploy frontend aggiornato su Vercel. Precedente: Punto 3 del piano gap firma documenti chiuso — archiviazione soft dei firmati con migrazione additiva 20260827180000, `PATCH /documenti/:id/archivia`, hard delete vietato anche all'admin con 409, pulsante «📦 Archivia»; fix produzione eliminazione moduli — guard 409 + transazione ordinata; etichette firma declassate a «Firma Elettronica Semplice (OTP verificata) · art. 20 CAD»; più ciclo §WF-DOC firma/sblocco/tracciabilità, firma OTP vera per la conclusione operazione e CI GitHub Actions completa; 298 test in 23 file)*
*Prossima revisione: dopo completamento Fase 2 (refactoring server.ts)*
