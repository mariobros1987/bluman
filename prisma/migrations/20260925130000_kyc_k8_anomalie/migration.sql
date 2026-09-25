-- KYC/AML Fase K8a (Malta, spec §5.3) — anomalie/segnalazioni interne e decisioni MLRO. ADDITIVA.
-- Tenant-scoped, RLS come K0-K7. L'anomalia è un candidato SAR interno; MlroDecisionLog è append-only.
-- L'export goAML (K8b) è una fase successiva (serve l'XSD FIAU): qui nessun formato regolatorio.

CREATE TYPE "TipoAnomaliaKyc" AS ENUM ('match_sanzioni', 'match_pep', 'operazione_sospetta', 'documento_incongruente', 'rischio_elevato', 'altro');
CREATE TYPE "StatoAnomaliaKyc" AS ENUM ('aperta', 'in_valutazione', 'chiusa_nessuna_azione', 'monitoraggio_rafforzato', 'segnalata_fiau', 'rapporto_chiuso');
CREATE TYPE "DecisioneMlro" AS ENUM ('nessuna_azione', 'monitoraggio_rafforzato', 'segnalazione_fiau', 'chiusura_rapporto');

CREATE TABLE "anomalia_kyc" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "tipo" "TipoAnomaliaKyc" NOT NULL,
    "descrizione" TEXT NOT NULL,
    "stato" "StatoAnomaliaKyc" NOT NULL DEFAULT 'aperta',
    "rilevata_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anomalia_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mlro_decision_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "anomalia_id" TEXT NOT NULL,
    "decisione" "DecisioneMlro" NOT NULL,
    "motivazione" TEXT NOT NULL,
    "decisa_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mlro_decision_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "anomalia_kyc_tenant_id_fascicolo_id_idx" ON "anomalia_kyc"("tenant_id", "fascicolo_id");
CREATE INDEX "mlro_decision_log_tenant_id_anomalia_id_idx" ON "mlro_decision_log"("tenant_id", "anomalia_id");

ALTER TABLE "anomalia_kyc" ADD CONSTRAINT "anomalia_kyc_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mlro_decision_log" ADD CONSTRAINT "mlro_decision_log_anomalia_id_fkey" FOREIGN KEY ("anomalia_id") REFERENCES "anomalia_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant su entrambe, guardato da IF EXISTS come le altre migrazioni compliance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.anomalia_kyc ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.anomalia_kyc FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.anomalia_kyc FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
    EXECUTE 'ALTER TABLE public.mlro_decision_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.mlro_decision_log FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.mlro_decision_log FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
