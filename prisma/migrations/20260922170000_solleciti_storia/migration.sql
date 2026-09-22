-- Storia dei solleciti per rata (W4 audit).
--
-- Prima `livello` era un parametro libero passato all'invio e nient'altro: nessuna traccia di
-- cosa fosse già partito, quindi si poteva spedire una **diffida legale come primo contatto**.
-- Questa tabella registra ogni sollecito riuscito; l'escalation stretta (1_avviso_bonario →
-- 2_sollecito_mora → 3_diffida_legale) si verifica su queste righe prima di inviare.
--
-- Additiva e senza perdita: nasce vuota, nessuna riga o colonna esistente viene toccata.
-- `ON DELETE CASCADE` su `scadenza_incasso_id` come per le altre figlie della rata: una rata
-- eliminata non deve lasciare solleciti orfani né bloccarsi con un P2003.

CREATE TABLE "sollecito" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "scadenza_incasso_id" TEXT NOT NULL,
  "livello" TEXT NOT NULL,
  "canale" TEXT NOT NULL DEFAULT 'email',
  "inviato_da" TEXT,
  "inviato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sollecito_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sollecito_tenant_id_scadenza_incasso_id_idx"
  ON "sollecito"("tenant_id", "scadenza_incasso_id");

ALTER TABLE "sollecito"
  ADD CONSTRAINT "sollecito_scadenza_incasso_id_fkey"
  FOREIGN KEY ("scadenza_incasso_id") REFERENCES "scadenza_incasso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La tabella è tenant-scoped: stessa politica RLS di tutte le altre. La policy sta qui perché
-- `migrate deploy` gira senza nessuno davanti e una tabella nata scoperta non la coprirebbe
-- nessuno. Negli ambienti locali senza il ruolo RLS la migrazione resta applicabile.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    ALTER TABLE public.sollecito ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sollecito FORCE ROW LEVEL SECURITY;
    CREATE POLICY isolamento_tenant ON public.sollecito
      FOR ALL TO bluman_app
      USING (tenant_id = public.app_tenant_corrente())
      WITH CHECK (tenant_id = public.app_tenant_corrente());
  END IF;
END
$$;
