-- KYC/AML Fase K2 (Malta, spec §7) — titolare effettivo, catena di controllo, deposito al registro.
-- ADDITIVA. Config TE nelle impostazioni compliance + tre tabelle nuove (tenant-scoped, RLS come K0/K1).

-- 1. Configurazione titolare effettivo per-studio (regole per configurazione, §3.2).
ALTER TABLE "tenant_compliance_settings"
  ADD COLUMN "soglia_titolare_effettivo" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "allarme_variazioni_te" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gestione_registro_te" BOOLEAN NOT NULL DEFAULT false;

-- 2. Tabelle K2.
CREATE TABLE "titolare_effettivo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "soggetto_id" TEXT NOT NULL,
    "criterio" TEXT NOT NULL,
    "percentuale" DECIMAL(65,30),
    "fonte" "FonteUbo" NOT NULL DEFAULT 'autodichiarazione',
    "data_verifica" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "titolare_effettivo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legame_controllo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "da_soggetto_id" TEXT NOT NULL,
    "a_soggetto_id" TEXT NOT NULL,
    "percentuale" DECIMAL(65,30),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legame_controllo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deposito_registro_te" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'da_depositare',
    "data_deposito" TIMESTAMP(3),
    "scadenza" TIMESTAMP(3),
    "riferimento" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deposito_registro_te_pkey" PRIMARY KEY ("id")
);

-- K2_MIGR_PLACEHOLDER

CREATE INDEX "titolare_effettivo_tenant_id_fascicolo_id_idx" ON "titolare_effettivo"("tenant_id", "fascicolo_id");
CREATE INDEX "legame_controllo_tenant_id_fascicolo_id_idx" ON "legame_controllo"("tenant_id", "fascicolo_id");
CREATE INDEX "deposito_registro_te_tenant_id_fascicolo_id_idx" ON "deposito_registro_te"("tenant_id", "fascicolo_id");

ALTER TABLE "titolare_effettivo" ADD CONSTRAINT "titolare_effettivo_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "titolare_effettivo" ADD CONSTRAINT "titolare_effettivo_soggetto_id_fkey" FOREIGN KEY ("soggetto_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legame_controllo" ADD CONSTRAINT "legame_controllo_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legame_controllo" ADD CONSTRAINT "legame_controllo_da_soggetto_id_fkey" FOREIGN KEY ("da_soggetto_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legame_controllo" ADD CONSTRAINT "legame_controllo_a_soggetto_id_fkey" FOREIGN KEY ("a_soggetto_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposito_registro_te" ADD CONSTRAINT "deposito_registro_te_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant sulle tre tabelle nuove, guardato da IF EXISTS come K0/K1.
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    FOREACH t IN ARRAY ARRAY['titolare_effettivo', 'legame_controllo', 'deposito_registro_te'] LOOP
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
