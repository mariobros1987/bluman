-- KYC/AML Fase K3 (Malta, spec §6) — valutazione del rischio a 4 pilastri. ADDITIVA.
-- Tenant-scoped, RLS come K0/K1/K2. Livello per pilastro (LivelloRischio) + complessivo worst-case.
CREATE TABLE "risk_assessment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "cliente_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "cliente_motivazione" TEXT,
    "geografia_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "geografia_motivazione" TEXT,
    "prodotto_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "prodotto_motivazione" TEXT,
    "canale_livello" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "canale_motivazione" TEXT,
    "livello_complessivo" "LivelloRischio" NOT NULL DEFAULT 'basso',
    "motivazione_complessiva" TEXT,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "prossima_revisione" TIMESTAMP(3),
    "attore_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_assessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "risk_assessment_tenant_id_fascicolo_id_idx" ON "risk_assessment"("tenant_id", "fascicolo_id");

ALTER TABLE "risk_assessment" ADD CONSTRAINT "risk_assessment_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni compliance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.risk_assessment ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.risk_assessment FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.risk_assessment FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
