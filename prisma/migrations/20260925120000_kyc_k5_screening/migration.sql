-- KYC/AML Fase K5 (Malta, spec §5.1.5 / §7 / §8.4 / §10) — screening PEP / sanzioni / media negativi.
-- ADDITIVA: la tabella nasce vuota, nessuna riga esistente viene toccata, nessuna colonna rimossa.
-- Processo MANUALE (screeningProvider default "MANUALE", spec §10): l'operatore registra l'esito con
-- un eventuale allegato. Tenant-scoped, RLS come K0/K1/K2/K3. Una riga per `tipo` (spec §7): un match
-- PEP si risolve indipendentemente da uno sanzioni. Il blocco dell'approvazione su match non risolto
-- (§8.4) è enforcement applicativo (service/rotta), non un vincolo DB.

CREATE TYPE "TipoScreening" AS ENUM ('sanzioni', 'pep', 'media_negativi');
CREATE TYPE "EsitoScreening" AS ENUM ('nessun_match', 'match_da_valutare', 'match_confermato', 'falso_positivo');

CREATE TABLE "screening_kyc" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fascicolo_id" TEXT NOT NULL,
    "soggetto_id" TEXT,
    "tipo" "TipoScreening" NOT NULL,
    "esito" "EsitoScreening" NOT NULL DEFAULT 'nessun_match',
    "fonte" TEXT,
    "data_screening" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "match_dettagli" TEXT,
    "allegato_url" TEXT,
    "nota_risoluzione" TEXT,
    "risolto_da" TEXT,
    "risolto_il" TIMESTAMP(3),
    "attore_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_kyc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "screening_kyc_tenant_id_fascicolo_id_idx" ON "screening_kyc"("tenant_id", "fascicolo_id");

ALTER TABLE "screening_kyc" ADD CONSTRAINT "screening_kyc_fascicolo_id_fkey" FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni compliance (K0-K3).
-- La policy sta QUI e non solo in supabase/migrations/: `migrate deploy` gira senza nessuno davanti
-- a ogni deploy, e una tabella nata scoperta su un database nuovo non la coprirebbe nessuno. Negli
-- ambienti locali senza il ruolo RLS la migrazione resta applicabile (il DO non fa nulla).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.screening_kyc ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.screening_kyc FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.screening_kyc FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
