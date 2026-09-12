-- Inbox persistente dei webhook: la chiave composta rende atomica la deduplicazione
-- degli eventi anche con più istanze applicative o richieste concorrenti.
CREATE TABLE "webhook_inbox" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_inbox_tenant_id_provider_event_id_key"
  ON "webhook_inbox"("tenant_id", "provider", "event_id");
CREATE INDEX "webhook_inbox_tenant_id_received_at_idx"
  ON "webhook_inbox"("tenant_id", "received_at");

ALTER TABLE "webhook_inbox"
  ADD CONSTRAINT "webhook_inbox_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La nuova tabella deve essere protetta come tutte le tabelle tenant-scoped. Negli
-- ambienti locali privi del ruolo RLS la migrazione resta applicabile e Prisma può
-- comunque generare il client.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    ALTER TABLE public.webhook_inbox ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.webhook_inbox FORCE ROW LEVEL SECURITY;
    CREATE POLICY isolamento_tenant ON public.webhook_inbox
      FOR ALL TO bluman_app
      USING (tenant_id = public.app_tenant_corrente())
      WITH CHECK (tenant_id = public.app_tenant_corrente());
  END IF;
END
$$;
