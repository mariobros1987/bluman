-- KYC/AML Fase K9/§5.5 — registro della formazione AML (TrainingRecord, spec §7). ADDITIVA.
-- Log a livello di studio (nessun cliente): non versionato, si aggiungono righe. Tenant-scoped:
-- porta la propria policy RLS come le altre tabelle nate dopo PIANO_MULTITENANT.md.

CREATE TABLE "training_record" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'personale',
    "data" TIMESTAMP(3) NOT NULL,
    "partecipanti" TEXT,
    "ore_formazione" DECIMAL(65,30),
    "ente" TEXT,
    "note" TEXT,
    "registrato_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_record_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "training_record_tenant_id_data_idx" ON "training_record"("tenant_id", "data");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.training_record ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.training_record FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.training_record FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
