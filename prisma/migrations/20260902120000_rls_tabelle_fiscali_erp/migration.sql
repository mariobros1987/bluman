-- Regola 1 — «Il filtro applicativo su tenant_id non basta e non è la difesa: è RLS che lo è.»
--
-- La migrazione 20260901_riforma_fatturazione_integrata ha creato cinque tabelle nuove
-- (audit_log_fattura, fornitore, fattura_ricevuta, liquidazione_iva, movimento_prima_nota),
-- tutte con `tenant_id TEXT NOT NULL`, ma senza il blocco RLS che accompagna ogni altra
-- tabella. Il buco non è teorico: supabase/migrations/20260819_rls_effettiva.sql (righe 74-77)
-- imposta
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluman_app;
-- quindi le tabelle create dopo sono immediatamente leggibili e scrivibili da bluman_app,
-- mentre il ciclo che ATTIVA la RLS è stato eseguito una volta sola il 19/08 e non le conosce.
-- Risultato: fatture d'acquisto, anagrafiche fornitori, liquidazioni IVA e prima nota di un
-- tenant sono raggiungibili dal ruolo applicativo di un altro tenant se una sola query
-- dimentica `tenant_id` nel `where` — cioè esattamente la difesa che la regola 1 non accetta.
--
-- Invece di elencare le cinque tabelle, si riesegue il ciclo per introspezione del punto 3 di
-- 20260819_rls_effettiva.sql: così questa migrazione sana il presente e, ripetuta, sanerebbe
-- qualunque tabella futura. Vive sotto prisma/migrations/ (precedente: 20260825120000_rls_
-- portale_dati_addendum) perché `prisma migrate deploy` gira con DIRECT_URL, cioè col ruolo
-- proprietario dello schema, e quindi si applica da sola al deploy su Railway senza psql a mano.

DO $$
DECLARE
  t text;
  eccezioni text[] := ARRAY['user', 'tenant', 'passaggio_template', '_prisma_migrations'];
  coperte int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RAISE NOTICE 'Ruolo bluman_app assente: nessuna policy creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RAISE NOTICE 'Funzione app_tenant_corrente() assente: nessuna policy creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

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
    -- FORCE vale anche per il proprietario della tabella: se lo schema passasse di mano le
    -- policy resterebbero in vigore. Il ruolo delle migrazioni ha rolbypassrls, quindi
    -- migrate deploy e i seed non si rompono.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY isolamento_tenant ON public.%I
        FOR ALL
        TO bluman_app
        USING (tenant_id = public.app_tenant_corrente())
        WITH CHECK (tenant_id = public.app_tenant_corrente())
    $f$, t);
    coperte := coperte + 1;
  END LOOP;

  RAISE NOTICE 'RLS + policy isolamento_tenant riallineate su % tabelle con tenant_id NOT NULL', coperte;
END
$$;

-- Verifica in-migrazione: se una delle cinque tabelle della riforma fatturazione restasse
-- senza RLS o senza policy, la migrazione FALLISCE e il deploy si ferma. Meglio un deploy
-- rosso che un isolamento multi-tenant che si crede attivo e non lo è.
DO $$
DECLARE
  mancanti text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RETURN; -- ambiente senza ruolo applicativo (sviluppo locale): niente da verificare
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO mancanti
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname = ANY (ARRAY['audit_log_fattura', 'fornitore', 'fattura_ricevuta', 'liquidazione_iva', 'movimento_prima_nota'])
     AND (
       c.relrowsecurity IS FALSE
       OR c.relforcerowsecurity IS FALSE
       OR NOT EXISTS (
         SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'isolamento_tenant'
       )
     );

  IF mancanti IS NOT NULL THEN
    RAISE EXCEPTION 'RLS incompleta sulle tabelle fiscali ERP: %', mancanti;
  END IF;
END
$$;
