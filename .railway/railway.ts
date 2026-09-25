// Infrastructure as Code Railway — sostituisce railway.json (Config as Code,
// deprecato: smette di essere letto il 01/12/2026).
//
// Il progetto bluman-backend ha due servizi applicativi più il Redis di coda.
// ⚠️ AGGIORNAMENTO 25/09/2026: `bluman-api` è ora **collegato a GitHub**
// (repo mariobros1987/bluman, branch main, root /) dalla dashboard Railway →
// Settings → Source. Da allora un `git push origin main` auto-deploya il
// backend (regola 9 di AGENTS.md aggiornata). Il servizio `cron-notifiche`
// resta su `railway up -s cron-notifiche`.
//
// ⚠️⚠️ PRIMA DI QUALSIASI `railway config apply`: questo file NON dichiara
// ancora il `source` GitHub né le watch paths di `bluman-api` (lo schema
// `source: github(...)` + branch/watchPatterns va confermato dal SDK, che qui
// non è installato). Poiché l'apply ha semantica "omesso = cancellato" (ha già
// cancellato bluman-cron e Postgres-14L3 il 15/09/2026), un apply da questo
// file **staccherebbe il collegamento GitHub**. La via corretta: sulla macchina
// col SDK installato (il Mac) `railway config pull` per importare lo stato reale
// — source + watch paths inclusi — poi `railway config plan` e solo allora apply.
//
// I valori segreti restano su Railway (preserve() / riferimenti): nel repo
// non entra nessuna credenziale (regola 6).
//
// Rimossi in passato (approvati dal titolare il 15/09/2026):
// - servizio `bluman-cron`: vecchio tentativo collegato a GitHub, mai
//   configurato (nessuna schedule, nessuno start command, 0/1 repliche) —
//   ogni push lo faceva rebuildare per niente;
// - database `Postgres-14L3`: relitto, l'app usa Supabase e nessuna
//   variabile lo puntava.
import { defineRailway, project, service, volume, preserve, redis } from "railway/iac";

export default defineRailway(() => {
  // Redis di coda: dichiarato per nome così la config adotta quello esistente
  // (redis.railway.internal) invece di cancellarlo.
  const coda = redis("Redis");

  // API backend: build dal Dockerfile del repo via `railway up`, documenti
  // caricati sul volume /app/uploads.
  const blumanApi = service("bluman-api", {
    volumeMounts: {
      "/app/uploads": volume("bluman-api-volume", { region: "sfo", sizeMB: 5000 }),
    },
    env: {
      DATABASE_URL: preserve(),
      ADMIN_DATABASE_URL: preserve(),
      DIRECT_URL: preserve(),
      APP_BASE_URL: preserve(),
      CORS_ORIGINS: preserve(),
      EMAIL_RELAY_SECRET: preserve(),
      JWT_SECRET: preserve(),
      NODE_ENV: preserve(),
      REDIS_URL: coda.env.REDIS_URL,
      SENTRY_DSN: preserve(),
      SUPABASE_URL: preserve(),
      SUPABASE_SERVICE_KEY: preserve(),
      WA_VERIFY_TOKEN: preserve(),
      WEBHOOK_SECRET_SDI: preserve(),
    },
  });

  // Cron delle notifiche scadenze: ogni giorno 07:00 UTC (09:00 italiane con
  // l'ora legale). Deploy del codice: `railway up -s cron-notifiche`.
  // ⚠️ `cronSchedule` qui sotto è IGNORATO dall'SDK (non lo supporta): la
  // schedule si imposta solo da dashboard Railway, Settings → Cron Schedule.
  // ⚠️ Lo start command dei servizi Dockerfile gira SENZA shell (exec form,
  // https://docs.railway.com/builds/build-and-start-commands#start-command):
  // `&&`, `;` e `$()` richiedono il wrapper `sh -c "..."` esplicito, altrimenti
  // tutto ciò che segue il primo comando viene passato come argomento e ignorato.
  const cronNotifiche = service("cron-notifiche", {
    cronSchedule: "0 7 * * *",
    start: "sh -c \"npx prisma migrate deploy && npx tsx src/scripts/runDailyNotificationCron.ts\"",
    env: {
      DATABASE_URL: blumanApi.env.DATABASE_URL,
      ADMIN_DATABASE_URL: blumanApi.env.ADMIN_DATABASE_URL,
      DIRECT_URL: blumanApi.env.DIRECT_URL,
      APP_BASE_URL: blumanApi.env.APP_BASE_URL,
      EMAIL_RELAY_SECRET: blumanApi.env.EMAIL_RELAY_SECRET,
      NODE_ENV: blumanApi.env.NODE_ENV,
      REDIS_URL: coda.env.REDIS_URL,
      SUPABASE_URL: blumanApi.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: blumanApi.env.SUPABASE_SERVICE_KEY,
    },
  });

  return project("bluman-backend", {
    resources: [blumanApi, cronNotifiche, coda],
  });
});
