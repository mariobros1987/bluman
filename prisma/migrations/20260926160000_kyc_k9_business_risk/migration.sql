-- KYC/AML Fase K9/§5.5 — valutazione del rischio dell'attività (business risk assessment). ADDITIVA.
-- Livello di studio (nessun fascicolo/cliente), versionata e mai sovrascritta (§7). Tenant-scoped:
-- porta la propria policy RLS, come le altre tabelle nate dopo PIANO_MULTITENANT.md.

CREATE TABLE "business_risk_assessment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "clientela_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "clientela_motivazione" TEXT,
    "servizi_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "servizi_motivazione" TEXT,
    "geografia_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "geografia_motivazione" TEXT,
    "canali_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "canali_motivazione" TEXT,
    "livello_complessivo" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "motivazione_complessiva" TEXT,
    "prossima_revisione" TIMESTAMP(3),
    "redatto_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_risk_assessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_risk_assessment_tenant_id_versione_idx" ON "business_risk_assessment"("tenant_id", "versione");

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni compliance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.business_risk_assessment ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.business_risk_assessment FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.business_risk_assessment FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
