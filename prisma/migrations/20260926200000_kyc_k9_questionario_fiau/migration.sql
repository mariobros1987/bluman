-- KYC/AML Fase K9/§5.5 — questionario periodico FIAU (REQ). ADDITIVA. Una riga per anno per studio.
-- Il sistema raccoglie i dati per l'MLRO e registra il riferimento dopo l'invio manuale (come la STR).
-- Tenant-scoped: porta la propria policy RLS come le altre tabelle nate dopo PIANO_MULTITENANT.md.

CREATE TABLE "questionario_fiau" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "anno" INTEGER NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'bozza',
    "contenuto_json" JSONB,
    "note" TEXT,
    "riferimento" TEXT,
    "trasmesso_at" TIMESTAMP(3),
    "compilato_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "questionario_fiau_pkey" PRIMARY KEY ("id")
);

-- Un REQ per anno per studio.
CREATE UNIQUE INDEX "questionario_fiau_tenant_id_anno_key" ON "questionario_fiau"("tenant_id", "anno");
CREATE INDEX "questionario_fiau_tenant_id_anno_idx" ON "questionario_fiau"("tenant_id", "anno");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.questionario_fiau ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.questionario_fiau FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.questionario_fiau FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
