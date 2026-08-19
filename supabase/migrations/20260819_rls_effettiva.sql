-- ====================================================================
-- BluMan — Row-Level Security effettiva (§14, §2bis)
-- ====================================================================
-- Sostituisce 20260815_enable_rls.sql, che era inerte per quattro motivi
-- indipendenti, tutti verificati sul database reale:
--
--   1. Prisma si connette come `postgres`, che ha rolbypassrls = true:
--      le policy vengono saltate a prescindere da come sono scritte.
--   2. relforcerowsecurity = false: anche il proprietario le scavalca.
--   3. 9 delle 14 tabelle con RLS attivo non avevano nessuna policy, e
--      19 tabelle non avevano RLS affatto (preventivo, tenant, notifica…).
--   4. L'applicazione non impostava mai app.current_tenant_id.
--
-- Prova che documentava il problema: con app.current_tenant_id impostato a
-- un tenant inesistente, `SELECT count(*) FROM cliente` restituiva 10.
--
-- USO:
--   PW=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,28))")
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$PW" \
--        -f supabase/migrations/20260819_rls_effettiva.sql
--
-- La password del ruolo applicativo arriva da riga di comando: questo file non
-- contiene segreti e può stare nel repo. `\gexec` la usa senza stamparla.
-- ====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. Ruolo applicativo, soggetto alle policy
-- ────────────────────────────────────────────────────────────────────
-- `postgres` resta il proprietario dello schema e continua a scavalcare RLS:
-- serve così per migrazioni, seed e backup. Il runtime dell'applicazione usa
-- invece questo ruolo, che NON può scavalcare nulla.

-- Le variabili psql non vengono interpolate dentro i blocchi dollar-quoted, quindi
-- CREATE/ALTER ROLE stanno fuori da qualsiasi DO. `\gexec` esegue il comando
-- generato dalla SELECT senza stamparlo.
SELECT format('CREATE ROLE bluman_app WITH LOGIN PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
\gexec

SELECT format('ALTER ROLE bluman_app WITH LOGIN PASSWORD %L', :'pw')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
\gexec

-- Gli attributi SUPERUSER e BYPASSRLS si possono modificare solo da superuser, e
-- `postgres` su Supabase non lo è: non si possono nemmeno ribadire. Non è un
-- problema — CREATE ROLE li lascia già spenti — ma va verificato, perché un
-- ruolo con BYPASSRLS renderebbe di nuovo inerte tutto questo file.
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb INTO r
    FROM pg_roles WHERE rolname = 'bluman_app';
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION 'bluman_app ha superuser=% o bypassrls=%: le policy non verrebbero applicate. Serve un superuser per correggerlo.',
      r.rolsuper, r.rolbypassrls;
  END IF;
  IF r.rolcreaterole OR r.rolcreatedb THEN
    RAISE WARNING 'bluman_app ha createrole=% createdb=%: privilegi non necessari al runtime.',
      r.rolcreaterole, r.rolcreatedb;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO bluman_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bluman_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bluman_app;

-- Le tabelle create dalle migrazioni future sono raggiungibili senza rieseguire i GRANT.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluman_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bluman_app;

-- Nessun DDL: lo schema lo cambiano solo le migrazioni, che girano come postgres.
REVOKE CREATE ON SCHEMA public FROM bluman_app;

-- ────────────────────────────────────────────────────────────────────
-- 2. Funzioni di contesto
-- ────────────────────────────────────────────────────────────────────
-- Il secondo argomento `true` di current_setting evita l'errore quando la
-- variabile non è impostata: si ottiene NULL, e `tenant_id = NULL` non è vero
-- per nessuna riga. L'assenza di contesto quindi non mostra niente invece di
-- mostrare tutto — se l'applicazione dimentica di impostare il tenant il
-- guasto è immediato e visibile, non silenzioso.

CREATE OR REPLACE FUNCTION public.app_tenant_corrente() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION public.app_ruolo_corrente() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_ruolo', true), '') $$;

GRANT EXECUTE ON FUNCTION public.app_tenant_corrente() TO bluman_app;
GRANT EXECUTE ON FUNCTION public.app_ruolo_corrente() TO bluman_app;

-- ────────────────────────────────────────────────────────────────────
-- 3. Policy uniforme sulle tabelle con tenant_id NOT NULL
-- ────────────────────────────────────────────────────────────────────
-- Generata per introspezione invece che elencata a mano: le tabelle aggiunte
-- in futuro con una colonna tenant_id vengono coperte rieseguendo questo
-- blocco, senza che nessuno debba ricordarsi di aggiornare un elenco.
-- Le tre tabelle con un legame diverso sono trattate singolarmente al punto 4.

DO $$
DECLARE
  t text;
  eccezioni text[] := ARRAY['user', 'tenant', 'passaggio_template', '_prisma_migrations'];
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT (c.relname = ANY (eccezioni))
       AND EXISTS (
         SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
            AND col.is_nullable = 'NO'
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE vale anche per il proprietario della tabella: se un domani lo schema
    -- passasse di mano, le policy resterebbero in vigore. `postgres` continua a
    -- scavalcare grazie a rolbypassrls, quindi migrazioni e seed non si rompono.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY isolamento_tenant ON public.%I
        FOR ALL
        TO bluman_app
        USING (tenant_id = public.app_tenant_corrente())
        WITH CHECK (tenant_id = public.app_tenant_corrente())
    $f$, t);
    -- Policy della vecchia migrazione: erano PERMISSIVE e senza destinatario,
    -- quindi si sommavano in OR a quella nuova, vanificandola.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON public.%I', t, t);
  END LOOP;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- 4. I tre casi con un legame diverso al tenant
-- ────────────────────────────────────────────────────────────────────

-- 4a. user — tenant_id è NULL per il super_admin, che sovrintende tutti i
-- tenant (§2bis). Perché possa elencare gli altri super_admin serve vedere
-- anche le righe senza tenant, ma solo se è davvero lui: il ruolo arriva dal
-- token JWT verificato, non da un header.
ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant ON public."user";
CREATE POLICY isolamento_tenant ON public."user"
  FOR ALL
  TO bluman_app
  USING (
    tenant_id = public.app_tenant_corrente()
    OR (tenant_id IS NULL AND public.app_ruolo_corrente() = 'super_admin')
  )
  WITH CHECK (
    tenant_id = public.app_tenant_corrente()
    OR (tenant_id IS NULL AND public.app_ruolo_corrente() = 'super_admin')
  );

-- 4b. tenant — non ha tenant_id: il vincolo è sulla chiave primaria. Il
-- super_admin deve poter elencare tutti i tenant per cambiare studio; gli
-- altri ruoli vedono solo il proprio.
ALTER TABLE public."tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tenant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant ON public."tenant";
DROP POLICY IF EXISTS tenant_isolation_tenant ON public."tenant";
CREATE POLICY isolamento_tenant ON public."tenant"
  FOR ALL
  TO bluman_app
  USING (id = public.app_tenant_corrente() OR public.app_ruolo_corrente() = 'super_admin')
  WITH CHECK (id = public.app_tenant_corrente() OR public.app_ruolo_corrente() = 'super_admin');

-- 4c. passaggio_template — unica tabella senza tenant_id e senza esserne il
-- padre: il tenant si risale dall'articolo a cui appartiene.
ALTER TABLE public."passaggio_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."passaggio_template" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant ON public."passaggio_template";
CREATE POLICY isolamento_tenant ON public."passaggio_template"
  FOR ALL
  TO bluman_app
  USING (EXISTS (
    SELECT 1 FROM public."articolo" a
     WHERE a.id = passaggio_template.articolo_id
       AND a.tenant_id = public.app_tenant_corrente()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."articolo" a
     WHERE a.id = passaggio_template.articolo_id
       AND a.tenant_id = public.app_tenant_corrente()
  ));

COMMIT;

-- ────────────────────────────────────────────────────────────────────
-- 5. _prisma_migrations: fuori portata del ruolo applicativo
-- ────────────────────────────────────────────────────────────────────
-- Non contiene dati di tenant, quindi non ha (né serve) una policy: la si toglie di mezzo
-- revocando l'accesso. `ALTER DEFAULT PRIVILEGES` qui sopra la concederebbe a bluman_app
-- appena Prisma la crea, e una tabella raggiungibile senza policy è esattamente ciò che
-- la verifica al punto 6 cerca. Idempotente: se la tabella non esiste ancora, non fa nulla
-- (viene creata dal primo `prisma migrate`, quindi l'ordine dei due passi non conta).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
  ) THEN
    REVOKE ALL ON public._prisma_migrations FROM bluman_app;
  END IF;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- 6. Verifica: nessuna tabella raggiungibile da bluman_app senza policy
-- ────────────────────────────────────────────────────────────────────
SELECT c.relname AS tabella_senza_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND has_table_privilege('bluman_app', c.oid, 'SELECT')
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
 ORDER BY 1;
