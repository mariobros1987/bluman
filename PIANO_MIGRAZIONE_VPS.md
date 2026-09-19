# Piano di migrazione su VPS — runbook

_Redatto il 19/09/2026. Motivo dichiarato: lentezza nel caricamento di progetti e clienti; si vuole più velocità di lettura del database._

> **Questo documento è una guida operativa passo-passo.** Ogni fase ha un obiettivo, i comandi, e come verificare che sia andata a buon fine. Le fasi vanno fatte **in ordine**. Non saltare la Fase 0.

---

## 0. Premessa onesta — leggere prima di comprare il VPS

Il VPS **non è, da solo, la cura della lentezza**. La lentezza di oggi ha tre cause distinte, e solo una dipende dall'hosting:

| Causa | Peso | Il VPS aiuta? |
|---|---|---|
| **Indici mancanti sulle foreign key** (moduli/micro-voci/passaggi) | Alto | ❌ No — è un problema di schema, si risolve su qualsiasi DB |
| **Distanza di rete tra backend e database** (Railway ↔ Supabase in regioni diverse, ×2 per la RLS) | Medio | ✅ Sì — co-locando app e DB sulla stessa macchina il viaggio di rete sparisce |
| **Liste non paginate** che caricano tutti i record | Cresce nel tempo | ❌ No — è frontend/API |

**Già fatto il 19/09/2026 (indipendente dal VPS):** aggiunti gli indici su `modulo_progetto.progetto_id`, `microvoce_progetto.modulo_progetto_id`, `passaggio_progetto.microvoce_progetto_id` (migration `20260919160000_indici_include_progetti`). Questo è l'intervento che con ogni probabilità elimina la lentezza percepita oggi, **prima ancora del VPS**.

**Cosa il VPS ti dà davvero:** app + database + storage sulla stessa macchina → ogni query passa su socket locale invece che sulla rete. Con il pattern RLS (due statement per query) questo raddoppio di round-trip diventa quasi zero. È un guadagno reale, ma è il secondo passo, non il primo.

**Cosa il VPS ti toglie:** i backup automatici, il connection pooler (PgBouncer/Supavisor), lo storage gestito e gli aggiornamenti di sicurezza del database diventano **responsabilità tua**. Vanno ricostruiti a mano (Fasi 5, 6, 8).

**Ordine consigliato:**
1. Deploy degli indici (fatto) → misura se la lentezza è già sparita.
2. Se è sparita: il VPS resta una scelta di costo/controllo, non di velocità → decidi con calma.
3. Se resta lenta o vuoi comunque consolidare: procedi con questo piano.

---

## 1. Architettura attuale (punto di partenza)

```
Browser ──► Vercel (frontend React)  ──► Railway (backend Fastify) ──► Supabase PostgreSQL (RLS)
                                                                    └─► Supabase Storage (bucket bluman-documents)
```

**Ruoli database (il cuore della sicurezza multi-tenant — NON perdere):**
- `bluman_app` → ruolo runtime, **senza BYPASSRLS**, fail-closed. È quello che usa il backend (`DATABASE_URL`). Se questo ruolo diventasse superuser o bypassrls, **l'isolamento tra studi salterebbe in silenzio**.
- `postgres` (owner) → possiede le tabelle, esegue le migrazioni, ha `rolbypassrls`. Usato da `DIRECT_URL` (migrazioni) e `ADMIN_DATABASE_URL` (script/manutenzione).

**Policy RLS** definite in `supabase/migrations/20260819_rls_effettiva.sql`: `isolamento_tenant FOR ALL TO bluman_app`, con helper `app_tenant_corrente()` e `app_ruolo_corrente()`. La migration **si rifiuta di girare** se `bluman_app` ha superuser/bypassrls — è una protezione, non un bug.

**Variabili d'ambiente in uso:**
| Variabile | A cosa serve | Ruolo DB |
|---|---|---|
| `DATABASE_URL` | runtime backend | `bluman_app` |
| `DIRECT_URL` | migrazioni | owner (`postgres`) |
| `ADMIN_DATABASE_URL` | script/manutenzione (ripiega su `DIRECT_URL`) | owner |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | storage documenti | service_role |

---

## 2. Cosa deve esistere sul VPS (inventario di destinazione)

1. **PostgreSQL** (stessa major version di Supabase — verificare con `SELECT version();`).
2. I **due ruoli** `bluman_app` (no bypassrls) e `postgres`/owner, ricreati **identici**.
3. Le **estensioni** usate (tipicamente `pgcrypto`/`uuid-ossp` per gli UUID — verificare con `SELECT extname FROM pg_extension;`).
4. Un **connection pooler** (PgBouncer) — Supabase lo dava di default; senza, Fastify apre troppe connessioni.
5. Lo **storage documenti**: o si tiene Supabase Storage (più semplice), oppure si sostituisce con MinIO (S3-compatibile) o disco locale + il fallback già presente in `storageService.ts`.
6. **Backup automatici** (cron `pg_dump` + copia off-site).
7. **Reverse proxy + TLS** (Caddy o Nginx + certbot) per esporre l'API in HTTPS.
8. **Runtime Node** per il backend (o Docker, riusando il `Dockerfile` esistente).

---

## 3. Decisione da prendere PRIMA di iniziare

**Domanda: sposti anche lo storage documenti, o lo lasci su Supabase?**

- **Opzione A — Solo DB + backend sul VPS, storage resta su Supabase.** Più semplice, meno rischio, mantieni i documenti dove sono. Consigliata come primo passo. Tieni `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.
- **Opzione B — Tutto sul VPS (DB + backend + storage con MinIO/disco).** Autonomia totale, ma devi gestire anche backup dei file e la migrazione del bucket `bluman-documents`.

**Domanda: il frontend resta su Vercel?** Consigliato **sì** — Vercel è una CDN, non è il collo di bottiglia, e sposta staticamente. Sposta solo backend + DB.

> Configurazione consigliata per il primo giro: **backend + PostgreSQL sul VPS (co-locati), storage su Supabase (Opzione A), frontend su Vercel.** È il minimo che ti dà il guadagno di velocità (query su socket locale) col minor rischio.

---

## 4. Prerequisiti (da avere pronti prima della finestra di migrazione)

- [ ] VPS provisionato, Ubuntu LTS aggiornato, accesso SSH con chiave.
- [ ] Firewall: aperti solo 22 (SSH), 80/443 (HTTPS). PostgreSQL (5432) **NON** esposto pubblicamente — ascolta su localhost.
- [ ] Major version PostgreSQL di destinazione = quella di Supabase.
- [ ] Finestra di manutenzione concordata (l'app va in sola lettura o offline durante il dump/restore).
- [ ] Backup fresco verificato di Supabase (vedi Fase 5).
- [ ] Accesso al pannello DNS del dominio dell'API.

---

## 5. Fase migrazione dati — la parte delicata

> ⚠️ **Regola del progetto:** nessuna DELETE/TRUNCATE/DROP sul database di produzione senza autorizzazione esplicita. Il restore sul VPS lavora su un database **nuovo e vuoto**, non tocca Supabase. Supabase resta intatto fino al cut-over ed è il tuo rollback.

### 5.1 Dump completo da Supabase (include ruoli, policy, dati)
```bash
# Dump del solo schema + dati (usa l'owner, DIRECT_URL)
pg_dump "$DIRECT_URL" \
  --no-owner --no-privileges \
  --format=custom \
  --file=bluman_$(date +%Y%m%d).dump

# Dump SEPARATO di ruoli e grant (pg_dump non li include con --no-owner)
pg_dumpall "$DIRECT_URL_BASE" --roles-only > ruoli.sql
```
> `--no-owner --no-privileges` evita che il restore provi a riassegnare a ruoli Supabase che sul VPS non esistono. I ruoli li ricrei tu al punto 5.3.

### 5.2 Verifica il dump PRIMA di procedere
```bash
pg_restore --list bluman_YYYYMMDD.dump | head -40   # deve elencare tabelle, indici, policy
ls -lh bluman_YYYYMMDD.dump                          # dimensione plausibile, non 0 byte
```

### 5.3 Sul VPS: crea ruoli e database (ordine obbligatorio)
```sql
-- 1. Ruolo runtime SENZA bypassrls (fail-closed). NON dargli mai SUPERUSER.
CREATE ROLE bluman_app WITH LOGIN PASSWORD '***';   -- niente SUPERUSER, niente BYPASSRLS

-- 2. Owner (possiede le tabelle, esegue migrazioni)
--    In molte installazioni è già 'postgres'. Se usi un owner dedicato, crealo qui.

-- 3. Database vuoto di proprietà dell'owner
CREATE DATABASE bluman OWNER postgres;

-- 4. Estensioni (nel DB bluman, da owner)
\c bluman
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- aggiungi le altre che risultano da: SELECT extname FROM pg_extension; su Supabase
```

### 5.4 Restore dei dati nel DB nuovo
```bash
pg_restore --no-owner --no-privileges \
  --dbname="postgresql://postgres:***@localhost:5432/bluman" \
  bluman_YYYYMMDD.dump
```

### 5.5 Concedi i permessi a bluman_app e RIVERIFICA la RLS
```sql
\c bluman
GRANT USAGE ON SCHEMA public TO bluman_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bluman_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bluman_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluman_app;

-- CONTROLLO CRITICO: bluman_app NON deve avere bypassrls
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'bluman_app';
-- atteso: rolsuper=false, rolbypassrls=false

-- CONTROLLO CRITICO: le policy esistono su ogni tabella con tenant_id
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename;
-- devono comparire 'isolamento_tenant' (e le varianti su user/tenant/passaggio_template)
```

> Se il dump non ha portato le policy (dipende da come Supabase le esporta), **rilancia la migration** `20260819_rls_effettiva.sql` da owner. Ricorda: si rifiuta di girare se `bluman_app` ha superuser/bypassrls — se si rifiuta, hai sbagliato il punto 5.3.

### 5.6 Test di isolamento tenant (NON saltare — è il test che dice se la sicurezza è intatta)
```sql
-- Come bluman_app, senza contesto: deve vedere ZERO righe (fail-closed)
SET ROLE bluman_app;
SELECT count(*) FROM cliente;                        -- atteso: 0

-- Con contesto di uno studio: vede solo i suoi
SELECT set_config('app.current_tenant_id','<uuid-studio-A>', false);
SELECT count(*) FROM cliente;                        -- atteso: solo i clienti di A
RESET ROLE;
```
Se senza contesto vedi righe > 0, **la RLS non è attiva**: fermati e non fare il cut-over.

---

## 6. Fase pooler + backend

### 6.1 PgBouncer (transaction mode)
- Installa PgBouncer, `pool_mode = transaction`, punta a `localhost:5432`.
- `DATABASE_URL` del backend punterà al **pooler** (es. `localhost:6432`), non direttamente a Postgres.
- ⚠️ In transaction mode Prisma richiede `pgbouncer=true` nella URL e statement cache disattivata. Le migrazioni (`DIRECT_URL`) devono puntare a Postgres **diretto** (5432), mai al pooler.

### 6.2 Backend
- Opzione Docker: riusa il `Dockerfile` esistente (già lancia `prisma migrate deploy` all'avvio).
- Imposta le env sul VPS:
  - `DATABASE_URL` → `bluman_app` via pooler.
  - `DIRECT_URL` → owner, Postgres diretto.
  - `ADMIN_DATABASE_URL` → owner.
  - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` → invariate se Opzione A.
- Avvia dietro reverse proxy (Caddy consigliato: TLS automatico).

### 6.3 Storage (solo se Opzione B)
- Migra il bucket `bluman-documents` (scarica da Supabase, ricarica su MinIO).
- Adatta `storageService.ts` all'endpoint S3 di MinIO, oppure usa il fallback locale già presente.
- ⚠️ Gli URL firmati cambiano scadenza/host: verifica il download di un documento reale.

---

## 7. Cut-over (lo switch vero)

1. Metti l'app in manutenzione (o sola lettura) — evita scritture perse tra dump e switch.
2. Rifai un **dump incrementale finale** se sono passate ore dal 5.1 (o accetta la finestra).
3. Punta il DNS dell'API al VPS (o aggiorna l'URL backend su Vercel).
4. Verifica health check dell'API sul VPS.
5. Login reale + apri lista progetti e lista clienti + apri un documento.
6. Esegui il **test di isolamento** (6 del §5.6) anche via API con due studi diversi.
7. Togli la manutenzione.

**Vercel:** aggiorna la variabile con l'URL del nuovo backend e redeploy del frontend.

---

## 8. Dopo il cut-over — quello che prima faceva Supabase e ora fai tu

- [ ] **Backup automatici**: cron giornaliero `pg_dump` + copia off-site (altro provider/bucket). Testa un restore, un backup mai ripristinato non è un backup.
- [ ] **Monitoraggio**: spazio disco, connessioni attive, slow query log.
- [ ] **Aggiornamenti di sicurezza** di PostgreSQL e OS.
- [ ] **Rotazione password** `bluman_app` e owner.
- [ ] `pg_stat_statements` attivo per trovare le query lente future.

---

## 9. Rollback (se qualcosa va storto al cut-over)

Supabase resta **intatto e funzionante** durante tutta la migrazione. Rollback = ripuntare DNS/URL backend a Railway+Supabase. Nessun dato perso, purché non si siano accettate scritture sul VPS prima di aver deciso il cut-over definitivo. **Non spegnere/cancellare Supabase** finché il VPS non è stabile da almeno qualche giorno.

---

## 10. Checklist di rischio (le cose che, se sbagliate, rompono in silenzio)

- [ ] `bluman_app` **senza** superuser/bypassrls sul VPS (§5.5). Se sbagliato → isolamento tenant salta, gli studi si vedono a vicenda.
- [ ] Policy RLS presenti su tutte le tabelle con `tenant_id` (§5.5).
- [ ] Test di isolamento passato con due studi diversi (§5.6, §7.6).
- [ ] `DIRECT_URL` punta a Postgres diretto, non al pooler (§6.1).
- [ ] Major version PostgreSQL uguale a Supabase (§4).
- [ ] Backup automatico configurato **e** restore testato (§8).
- [ ] Documenti scaricabili dopo lo switch (§6.3, §7.5).

---

_Nota: gli indici della gerarchia progetto (la causa più probabile della lentezza attuale) sono già stati aggiunti il 19/09/2026 con la migration `20260919160000_indici_include_progetti`, indipendentemente dal VPS. Misura la velocità dopo quel deploy prima di decidere quanto è urgente il VPS._
