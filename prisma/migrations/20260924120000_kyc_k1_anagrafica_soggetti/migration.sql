-- KYC/AML Fase K1 (Malta, spec v0.2 §7) — anagrafica soggetti, documenti d'identità, rappresentanza.
-- ADDITIVA: tre tabelle nuove e tre colonne su fascicolo_kyc. Nessuna riga esistente toccata, nessun
-- dato rimappato qui (il rimappaggio dei pochi record di prova arriva col commit che accende la
-- macchina a stati). I nuovi stati v0.2 stanno nella migrazione precedente (kyc_k1_stati_v02), a sé
-- perché ALTER TYPE ADD VALUE va isolato dalla transazione che li userebbe (regola Postgres).
-- RLS come le altre tabelle tenant-scoped (regola 1): separazione fra studi affidata al motore.

-- 1. Tipo soggetto (persona fisica / giuridica).
CREATE TYPE "TipoSoggettoKyc" AS ENUM ('persona_fisica', 'persona_giuridica');

-- 2. La pratica (FascicoloKyc = KycCase) acquista soggetto, incarico e responsabile (tutti nullable in K1).
ALTER TABLE "fascicolo_kyc"
  ADD COLUMN "soggetto_id" TEXT,
  ADD COLUMN "progetto_id" TEXT,
  ADD COLUMN "responsabile_user_id" TEXT;

-- K1_TABLES_PLACEHOLDER

CREATE TABLE "soggetto_kyc" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tipo" "TipoSoggettoKyc" NOT NULL DEFAULT 'persona_fisica',
    "cliente_id" TEXT,
    "denominazione" TEXT NOT NULL,
    "codice_fiscale" TEXT,
    "partita_iva" TEXT,
    "luogo_nascita" TEXT,
    "data_nascita" TEXT,
    "paese_residenza" TEXT,
    "indirizzo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "soggetto_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documento_identita" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "soggetto_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "emittente" TEXT,
    "scadenza" TIMESTAMP(3),
    "url_storage" TEXT,
    "hash_sha256" TEXT,
    "esito_verifica" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documento_identita_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rappresentanza" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rappresentante_id" TEXT NOT NULL,
    "rappresentato_id" TEXT NOT NULL,
    "poteri" TEXT,
    "fonte" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rappresentanza_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "soggetto_kyc_tenant_id_cliente_id_idx" ON "soggetto_kyc"("tenant_id", "cliente_id");
CREATE INDEX "documento_identita_tenant_id_soggetto_id_idx" ON "documento_identita"("tenant_id", "soggetto_id");
CREATE INDEX "rappresentanza_tenant_id_rappresentante_id_idx" ON "rappresentanza"("tenant_id", "rappresentante_id");
CREATE INDEX "rappresentanza_tenant_id_rappresentato_id_idx" ON "rappresentanza"("tenant_id", "rappresentato_id");

ALTER TABLE "fascicolo_kyc" ADD CONSTRAINT "fascicolo_kyc_soggetto_id_fkey" FOREIGN KEY ("soggetto_id") REFERENCES "soggetto_kyc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "soggetto_kyc" ADD CONSTRAINT "soggetto_kyc_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documento_identita" ADD CONSTRAINT "documento_identita_soggetto_id_fkey" FOREIGN KEY ("soggetto_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rappresentanza" ADD CONSTRAINT "rappresentanza_rappresentante_id_fkey" FOREIGN KEY ("rappresentante_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rappresentanza" ADD CONSTRAINT "rappresentanza_rappresentato_id_fkey" FOREIGN KEY ("rappresentato_id") REFERENCES "soggetto_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: attiva e forza l'isolamento per tenant sulle tre tabelle nuove, come le altre tenant-scoped.
-- Guardata da IF EXISTS (ruolo bluman_app + funzione app_tenant_corrente) come la migrazione K0.
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    FOREACH t IN ARRAY ARRAY['soggetto_kyc', 'documento_identita', 'rappresentanza'] LOOP
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
