-- Credenziali dei servizi esterni usati dallo studio (KYC/AML e firma).
-- ADDITIVA: nuova tabella, nessuna riga esistente viene toccata.
--
-- Perché una tabella e non colonne su `tenant`: i servizi sono un elenco aperto (visura,
-- screening PEP, marca temporale, e domani altri) e ognuno ha la sua trio endpoint/utenza/segreto.
-- La chiave `(tenant_id, servizio)` rende impossibile avere due credenziali per lo stesso servizio.
--
-- Il campo `segreto` è la password o l'API key: non esce MAI dalle API in chiaro. Le rotte la
-- mascherano in lettura e il registro di compliance non la registra (solo il nome del servizio).

CREATE TABLE "credenziale_servizio_esterno" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "servizio" TEXT NOT NULL,
    "etichetta" TEXT,
    "endpoint" TEXT,
    "username" TEXT,
    "segreto" TEXT,
    "extra" JSONB,
    "aggiornato_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credenziale_servizio_esterno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credenziale_servizio_esterno_tenant_id_servizio_key"
  ON "credenziale_servizio_esterno"("tenant_id", "servizio");

ALTER TABLE "credenziale_servizio_esterno"
  ADD CONSTRAINT "credenziale_servizio_esterno_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant come le altre tabelle KYC (K0–K9). Il DO resta applicabile anche
-- su un ambiente locale senza il ruolo `bluman_app`, dove semplicemente non fa nulla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.credenziale_servizio_esterno ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.credenziale_servizio_esterno FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.credenziale_servizio_esterno FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
