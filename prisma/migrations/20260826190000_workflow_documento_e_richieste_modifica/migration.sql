-- §WF-DOC — Ciclo di vita documento e richieste modifica operatore-cliente

-- CreateEnum
CREATE TYPE "StatoDocumento" AS ENUM ('bozza', 'pubblicato', 'in_revisione', 'firmato');

-- AlterTable Documento
ALTER TABLE "documento" ADD COLUMN "stato_doc" "StatoDocumento" NOT NULL DEFAULT 'bozza';
ALTER TABLE "documento" ADD COLUMN "pubblicato_at" TIMESTAMP(3);
ALTER TABLE "documento" ADD COLUMN "documento_padre_id" TEXT;

-- CreateTable
CREATE TABLE "richiesta_modifica_documento" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "commento" TEXT NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'aperta',
    "creato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "risposto_at" TIMESTAMP(3),
    "risposta_studio" TEXT,

    CONSTRAINT "richiesta_modifica_documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documento_stato_doc_idx" ON "documento"("stato_doc");
CREATE INDEX "richiesta_modifica_documento_documento_id_idx" ON "richiesta_modifica_documento"("documento_id");
CREATE INDEX "richiesta_modifica_documento_tenant_id_stato_idx" ON "richiesta_modifica_documento"("tenant_id", "stato");

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_documento_padre_id_fkey" FOREIGN KEY ("documento_padre_id") REFERENCES "documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "richiesta_modifica_documento" ADD CONSTRAINT "richiesta_modifica_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "richiesta_modifica_documento" ADD CONSTRAINT "richiesta_modifica_documento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
DO $$
DECLARE
  t text := 'richiesta_modifica_documento';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RETURN;
  END IF;

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
END
$$;
