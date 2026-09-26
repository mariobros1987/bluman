-- KYC/AML Fase K8b (Malta, spec §5.3/§10) — segnalazione operazione sospetta (STR) verso la FIAU.
-- ADDITIVA. Tenant-scoped, RLS come K0-K8a. Nasce da un'anomalia decisa `segnalazione_fiau` (K8a).
-- Il sistema PREPARA i dati (snapshot immutabile in dati_preparati_json → dossier PDF per l'MLRO) e
-- REGISTRA riferimento e timestamp goAML dopo l'invio manuale sul portale FIAU. NON trasmette:
-- nessuna integrazione diretta in prima fase (spec §10), quindi qui nessun formato regolatorio XSD.

CREATE TYPE "StatoSegnalazioneFiau" AS ENUM ('preparata', 'trasmessa');

CREATE TABLE "segnalazione_fiau" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "anomalia_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "stato" "StatoSegnalazioneFiau" NOT NULL DEFAULT 'preparata',
    "dati_preparati_json" JSONB NOT NULL,
    "riferimento_goaml" TEXT,
    "trasmessa_at" TIMESTAMP(3),
    "preparata_da" TEXT,
    "trasmessa_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segnalazione_fiau_pkey" PRIMARY KEY ("id")
);

-- Una anomalia = una segnalazione: la STR è la coda della decisione MLRO, non se ne aprono due per lo
-- stesso rilievo. Una nuova preparazione prima dell'invio aggiorna la riga esistente (upsert sul vincolo).
CREATE UNIQUE INDEX "segnalazione_fiau_anomalia_id_key" ON "segnalazione_fiau"("anomalia_id");
CREATE INDEX "segnalazione_fiau_tenant_id_fascicolo_id_idx" ON "segnalazione_fiau"("tenant_id", "fascicolo_id");

ALTER TABLE "segnalazione_fiau" ADD CONSTRAINT "segnalazione_fiau_anomalia_id_fkey" FOREIGN KEY ("anomalia_id") REFERENCES "anomalia_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segnalazione_fiau" ADD CONSTRAINT "segnalazione_fiau_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni compliance. La policy sta
-- qui e non solo in supabase/migrations/: migrate deploy gira senza nessuno davanti a ogni deploy, e il
-- fascicolo anomalie/segnalazioni è tra i dati più sensibili — non deve nascere scoperto su un DB nuovo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.segnalazione_fiau ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.segnalazione_fiau FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.segnalazione_fiau FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
