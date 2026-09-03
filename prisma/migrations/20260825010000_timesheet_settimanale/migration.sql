-- Blocco 6.1 — Timesheet settimanale (§ consuntivazione oraria)
--
-- Registro ore per operatore: una riga per membro per giorno (griglia settimanale
-- membro×giorno). Le ore nascono in stato `bozza`; advisor/super_admin le approvano
-- o le rifiutano. Solo lo stato `approvato` alimenta il report "Ore per Operatore".

-- CreateEnum
CREATE TYPE "StatoTimesheet" AS ENUM ('bozza', 'approvato', 'rifiutato');

-- CreateTable
CREATE TABLE "ora_timesheet" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "giorno" DATE NOT NULL,
    "minuti" INTEGER NOT NULL,
    "progetto_id" TEXT,
    "nota" TEXT,
    "stato" "StatoTimesheet" NOT NULL DEFAULT 'bozza',
    "approvato_da_id" TEXT,
    "approvato_at" TIMESTAMP(3),
    "motivo_rifiuto" TEXT,
    "rifiutato_da_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ora_timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: una registrazione per membro per giorno (base dell'upsert API)
CREATE UNIQUE INDEX "ora_timesheet_tenant_id_user_id_giorno_key" ON "ora_timesheet"("tenant_id", "user_id", "giorno");

-- CreateIndex
CREATE INDEX "ora_timesheet_tenant_id_giorno_idx" ON "ora_timesheet"("tenant_id", "giorno");

-- AddForeignKey
ALTER TABLE "ora_timesheet" ADD CONSTRAINT "ora_timesheet_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ora_timesheet" ADD CONSTRAINT "ora_timesheet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ora_timesheet" ADD CONSTRAINT "ora_timesheet_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ora_timesheet" ADD CONSTRAINT "ora_timesheet_approvato_da_id_fkey" FOREIGN KEY ("approvato_da_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ora_timesheet" ADD CONSTRAINT "ora_timesheet_rifiutato_da_id_fkey" FOREIGN KEY ("rifiutato_da_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security su tenant_id (§14): stessa policy uniforme delle altre tabelle.
-- Senza questo blocco il ruolo applicativo `bluman_app` leggerebbe le ore di tutti i
-- tenant. Se ruolo o funzione di contesto mancano (ambiente non ancora inizializzato)
-- si avvisa invece di fallire la migrazione.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RAISE NOTICE 'Ruolo bluman_app assente: policy su ora_timesheet non creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RAISE NOTICE 'Funzione app_tenant_corrente() assente: policy non creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['ora_timesheet']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY isolamento_tenant ON public.%I
        FOR ALL
        TO bluman_app
        USING (tenant_id = public.app_tenant_corrente())
        WITH CHECK (tenant_id = public.app_tenant_corrente())
    $p$, t);
  END LOOP;
END
$$;
