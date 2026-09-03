-- Alert sicurezza Supabase 23/08/2026 (rls_disabled_in_public): la migrazione
-- 20260824130000_portale_dati_addendum_contratto ha creato `proposta_dati_fiscale` e
-- `richiesta_addendum` senza il blocco RLS che accompagna tutte le altre tabelle.
-- Senza RLS, chiunque conosca l'URL del progetto può leggere quelle righe via
-- PostgREST con la chiave anon: dati fiscali dei clienti e testo degli addendum.
--
-- Qui si riallineano al pattern di supabase/migrations/20260819_rls_effettiva.sql:
-- RLS attiva e FORZATA + policy isolamento_tenant per il ruolo applicativo bluman_app.
-- `postgres` (ruolo delle migrazioni, rolbypassrls) continua a scavalcare le policy,
-- quindi questa migrazione e le successive non si rompono.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RAISE NOTICE 'Ruolo bluman_app assente: policy su proposta_dati_fiscale e richiesta_addendum non create. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RAISE NOTICE 'Funzione app_tenant_corrente() assente: policy non create. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['proposta_dati_fiscale', 'richiesta_addendum']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE vale anche per il proprietario: se lo schema passasse di mano, la policy
    -- resterebbe in vigore. `postgres` scavalca grazie a rolbypassrls, quindi migrazioni
    -- e seed non si rompono.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY isolamento_tenant ON public.%I
        FOR ALL
        TO bluman_app
        USING (tenant_id = public.app_tenant_corrente())
        WITH CHECK (tenant_id = public.app_tenant_corrente())
    $p$, t);
  END LOOP;
END
$$;

-- Igiene: anche la tabella interna delle migrazioni di Prisma non aveva RLS. Non
-- contiene dati di business, ma lo scanner la segnalerebbe comunque; abilitiamo RLS
-- senza policy (il ruolo delle migrazioni ha rolbypassrls, gli altri ruoli restano fuori).
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
