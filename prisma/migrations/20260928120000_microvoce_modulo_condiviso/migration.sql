-- Condivisione micro-voce ↔ moduli addizionali (regola: «una micro-voce che vale per due moduli
-- si esegue una volta e conta per entrambi»). ADDITIVA, tenant-scoped, RLS come le altre tabelle.
-- La micro-voce resta una sola riga (proprietario = microvoce_progetto.modulo_progetto_id);
-- questa join la fa comparire e contare anche nei moduli qui elencati.

CREATE TABLE "microvoce_modulo_condiviso" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "microvoce_progetto_id" TEXT NOT NULL,
    "modulo_progetto_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "microvoce_modulo_condiviso_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "microvoce_modulo_condiviso_microvoce_progetto_id_modulo_prog_key"
    ON "microvoce_modulo_condiviso"("microvoce_progetto_id", "modulo_progetto_id");
CREATE INDEX "microvoce_modulo_condiviso_tenant_id_modulo_progetto_id_idx"
    ON "microvoce_modulo_condiviso"("tenant_id", "modulo_progetto_id");

ALTER TABLE "microvoce_modulo_condiviso"
    ADD CONSTRAINT "microvoce_modulo_condiviso_microvoce_progetto_id_fkey"
    FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "microvoce_modulo_condiviso"
    ADD CONSTRAINT "microvoce_modulo_condiviso_modulo_progetto_id_fkey"
    FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.microvoce_modulo_condiviso ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.microvoce_modulo_condiviso FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.microvoce_modulo_condiviso FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
