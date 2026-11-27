-- Note della beta (Fabio, 27/11/2026) — ADDITIVA: una tabella nuova, nessuna colonna toccata.
-- Chi prova il gestionale scrive, pagina per pagina, ciò che non va o che si può migliorare.
-- Tenant-scoped: porta la propria policy RLS, come le altre tabelle nate dopo PIANO_MULTITENANT.md.
--
-- Scritta a mano e non con `prisma migrate dev`: il database ombra non riesce a rieseguire una
-- migrazione storica (20260825120000_rls_portale_dati_addendum, P3006). Le istruzioni CREATE qui
-- sotto sono quelle che `prisma migrate diff` produce dallo schema, riportate tali e quali.

CREATE TABLE "nota_beta" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "autore_nome" TEXT NOT NULL,
    "ruolo" TEXT NOT NULL,
    "pagina" TEXT NOT NULL,
    "percorso" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'errore',
    "testo" TEXT NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'aperta',
    "risolta_at" TIMESTAMP(3),
    "risolta_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nota_beta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nota_beta_tenant_id_pagina_stato_idx" ON "nota_beta"("tenant_id", "pagina", "stato");

CREATE INDEX "nota_beta_tenant_id_created_at_idx" ON "nota_beta"("tenant_id", "created_at" DESC);

ALTER TABLE "nota_beta" ADD CONSTRAINT "nota_beta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.nota_beta ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.nota_beta FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.nota_beta FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
