# 19 · Infrastruttura & Deploy

## 👤 Cosa fa e come si usa
BluMan è distribuito in due metà:
- **Backend** (Fastify) su **Railway**;
- **Frontend** (React/Vite) su **Vercel**.

Il deploy si fa con **`scripts/distribuisci.sh`** (regola 9): verifica (typecheck backend+frontend,
lint, build, `vitest run`), controlla l'autore Git richiesto da Vercel, poi push → Vercel e
`railway up` → Railway. Dopo il deploy verifica health e sonda rotta (401, non 404).

Sulla **postazione Windows** del titolare il comando `railway` (wrapper npm) ingoia stdout/exit:
si usa il **`.exe` nativo** via `RAILWAY_BIN` (lo script lo supporta).

## 📐 Calcoli & logica / regole
- **Migrazioni versionate**: lo schema si cambia con `prisma migrate dev`/`deploy`; il Dockerfile
  esegue `prisma migrate deploy` all'avvio (mai `db push --accept-data-loss` su dati reali).
- **RLS effettiva**: l'app gira come ruolo `bluman_app` (non superuser); ogni migrazione che crea una
  tabella porta **la propria policy RLS** dentro di sé. Verifica: `checkRls.ts`.
- **Tre connection string** (`.env`): `DATABASE_URL` (`bluman_app`, no bypass RLS), `DIRECT_URL`
  (migrazioni), `ADMIN_DATABASE_URL` (manutenzione/seed/backup, scavalca RLS).
- **Regola**: **mentre `distribuisci.sh` gira NON si modificano file tracciati** — al passo 2 controlla
  l'albero sporco ed esce con errore. Si aspetta la fine del push o si committa prima.
- **Un `git push` su `main` applica anche le migrazioni**, non solo il codice: Railway auto-deploya da
  GitHub (dal 25/09/2026) e il container lancia `prisma migrate deploy` all'avvio. Una migrazione
  committata e lasciata lì **non è inerte** — parte al primo push. Se una migrazione non va ancora
  applicata alla produzione, va tenuta **fuori dal branch** (o il push va rimandato), non semplicemente
  non eseguita a mano: `npx prisma migrate status` dice cosa è in attesa.
- **Backup**: rimandato alla migrazione **VPS** Register.it (per ora dati di prova).

## 🔗 Collegamenti
- Tutti i moduli: il deploy porta in produzione backend (Railway) e frontend (Vercel) insieme.

## ⚠️ Stati limite & errori
- Autore ultimo commit ≠ identità Vercel → lo script si ferma (correzione manuale, niente amend auto).
- Albero sporco → esce con errore (vedi regola sopra).
- Health/sonda rotta non ok dopo il deploy → fallimento non silenzioso (exit 1).

## 🔧 Nota tecnica
- `scripts/distribuisci.sh` (+ `--solo-push` / `--solo-api`); IaC `.railway/railway.ts`; migrazioni
  `prisma/migrations/` (RLS inline) + `supabase/migrations/20260819_rls_effettiva.sql`; diagnostica
  `src/scripts/checkRls.ts`, `verificaAccessi.ts`.
- Deploy: `export RAILWAY_BIN="…/@railway/cli/bin/railway.exe" && bash scripts/distribuisci.sh`.
- **Stack VPS «tutto su un server»** (`docker-compose.prod.yml`): `postgres:17` → `migrate`
  (`prisma migrate deploy`) → `rls` (crea `bluman_app` senza bypassrls + policy) → `api` (gira come
  `bluman_app`, con `env_file: .env` per i secret runtime) → `nginx` (SPA + proxy API) + `certbot`
  (TLS Let's Encrypt, rinnovo automatico). Secret in `.env.prod.example`. Backup: `scripts/backup-vps.sh`.
  Il flusso migrate→rls→api è stato **verificato in dry-run locale** (RLS su 70 tabelle, isolamento ok).
- Fonti: `.agents/AGENTS.md`, `ISTRUZIONI_PER_IA.md` (regola 9), `PIANO_MIGRAZIONE_VPS.md`,
  `AUDIT_2026-09-27/07-frontend-infra.md`.
