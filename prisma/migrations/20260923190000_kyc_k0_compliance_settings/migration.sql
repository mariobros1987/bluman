-- KYC/AML Fase K0 (Malta, spec v0.2): le due tabelle di fondazione — impostazioni di compliance
-- per tenant e log eventi immutabile. Additive, nessuna riga esistente toccata. Le policy RLS
-- stanno qui (come le altre tabelle tenant-scoped): dati di compliance, separazione fra studi
-- affidata al motore, non a un filtro applicativo (regola 1).

CREATE TABLE "tenant_compliance_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "jurisdiction_pack" TEXT NOT NULL DEFAULT 'MT',
  "regulatory_profile" TEXT,
  "other_subject_category" TEXT,
  "retention_years" INTEGER NOT NULL DEFAULT 5,
  "mlro_user_id" TEXT,
  "reporting_channel" TEXT NOT NULL DEFAULT 'goAML',
  "screening_provider" TEXT NOT NULL DEFAULT 'MANUALE',
  "feature_flags" JSONB,
  "versione" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_compliance_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_compliance_settings_tenant_id_key" ON "tenant_compliance_settings"("tenant_id");

CREATE TABLE "compliance_event" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "attore_user_id" TEXT,
  "payload" JSONB,
  "hash_precedente" TEXT,
  "hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "compliance_event_tenant_id_created_at_idx" ON "compliance_event"("tenant_id", "created_at");

DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    FOREACH t IN ARRAY ARRAY['tenant_compliance_settings', 'compliance_event'] LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format(
        'CREATE POLICY isolamento_tenant ON public.%I FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())',
        t
      );
    END LOOP;
  END IF;
END
$$;
