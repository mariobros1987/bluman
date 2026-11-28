-- Accentratore delle mail (mattia, 28/11/2026) — ADDITIVA: tre tabelle nuove e tre colonne
-- facoltative su `cliente`; nessun dato esistente viene toccato.
--   casella_posta    le caselle lette: di raccolta dello studio, o di un cliente (password cifrata)
--   messaggio_posta  i messaggi raccolti, attribuiti al cliente
--   allegato_posta   i loro allegati (il file sta nell'archivio documenti)
--   cliente.alias_posta (+ chi e quando l'ha attivata): l'indirizzo di inoltro del cliente
-- Le tre tabelle portano `tenant_id` e la propria policy RLS, come le altre nate dopo
-- PIANO_MULTITENANT.md. L'indice unico su (tenant_id, alias_posta) non tocca le righe di oggi:
-- per Postgres due NULL non sono uguali.
--
-- Scritta a mano e non con `prisma migrate dev`: da una sessione `prisma migrate` non si lancia
-- (10-produzione, punto 6). Le istruzioni qui sotto sono quelle che `prisma migrate diff` produce
-- confrontando i due schemi, senza toccare nessun database, riportate tali e quali.

-- AlterTable
ALTER TABLE "cliente" ADD COLUMN     "alias_posta" TEXT,
ADD COLUMN     "posta_attivata_at" TIMESTAMP(3),
ADD COLUMN     "posta_attivata_da" TEXT;

-- CreateTable
CREATE TABLE "casella_posta" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "indirizzo" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "servername" TEXT,
    "porta" INTEGER NOT NULL DEFAULT 993,
    "utente" TEXT NOT NULL,
    "password_cifrata" TEXT,
    "cartella" TEXT NOT NULL DEFAULT 'INBOX',
    "tipo" TEXT NOT NULL DEFAULT 'raccolta',
    "cliente_id" TEXT,
    "consenso_dichiarato_at" TIMESTAMP(3),
    "consenso_dichiarato_da" TEXT,
    "raccogli_dal" TIMESTAMP(3),
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "uid_validity" TEXT,
    "ultimo_uid" INTEGER NOT NULL DEFAULT 0,
    "ultima_raccolta_at" TIMESTAMP(3),
    "ultimo_successo_at" TIMESTAMP(3),
    "ultimo_errore" TEXT,
    "creata_da" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "casella_posta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaggio_posta" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "casella_id" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "uid_validity" TEXT NOT NULL,
    "message_id" TEXT,
    "mittente_email" TEXT NOT NULL,
    "mittente_nome" TEXT,
    "destinatari" TEXT,
    "oggetto" TEXT,
    "testo" TEXT,
    "html" TEXT,
    "ricevuto_at" TIMESTAMP(3) NOT NULL,
    "raccolto_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cliente_id" TEXT,
    "progetto_id" TEXT,
    "attribuzione" TEXT NOT NULL DEFAULT 'da_smistare',
    "criterio" TEXT,
    "consegnato_a" TEXT,
    "letto_at" TIMESTAMP(3),
    "letto_da" TEXT,
    "archiviato_at" TIMESTAMP(3),
    "ha_allegati" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "messaggio_posta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allegato_posta" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "messaggio_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT,
    "dimensione_byte" INTEGER,
    "url" TEXT,
    "motivo_non_salvato" TEXT,

    CONSTRAINT "allegato_posta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "casella_posta_tenant_id_attiva_idx" ON "casella_posta"("tenant_id", "attiva");

-- CreateIndex
CREATE INDEX "messaggio_posta_tenant_id_ricevuto_at_idx" ON "messaggio_posta"("tenant_id", "ricevuto_at" DESC);

-- CreateIndex
CREATE INDEX "messaggio_posta_tenant_id_cliente_id_idx" ON "messaggio_posta"("tenant_id", "cliente_id");

-- CreateIndex
CREATE INDEX "messaggio_posta_tenant_id_progetto_id_idx" ON "messaggio_posta"("tenant_id", "progetto_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaggio_posta_casella_id_uid_validity_uid_key" ON "messaggio_posta"("casella_id", "uid_validity", "uid");

-- CreateIndex
CREATE INDEX "allegato_posta_tenant_id_messaggio_id_idx" ON "allegato_posta"("tenant_id", "messaggio_id");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_tenant_id_alias_posta_key" ON "cliente"("tenant_id", "alias_posta");

-- AddForeignKey
ALTER TABLE "casella_posta" ADD CONSTRAINT "casella_posta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casella_posta" ADD CONSTRAINT "casella_posta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaggio_posta" ADD CONSTRAINT "messaggio_posta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaggio_posta" ADD CONSTRAINT "messaggio_posta_casella_id_fkey" FOREIGN KEY ("casella_id") REFERENCES "casella_posta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaggio_posta" ADD CONSTRAINT "messaggio_posta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaggio_posta" ADD CONSTRAINT "messaggio_posta_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegato_posta" ADD CONSTRAINT "allegato_posta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegato_posta" ADD CONSTRAINT "allegato_posta_messaggio_id_fkey" FOREIGN KEY ("messaggio_id") REFERENCES "messaggio_posta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni (su un ambiente
-- locale senza il ruolo `bluman_app` il blocco non fa nulla).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.casella_posta ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.casella_posta FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.casella_posta FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
    EXECUTE 'ALTER TABLE public.messaggio_posta ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.messaggio_posta FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.messaggio_posta FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
    EXECUTE 'ALTER TABLE public.allegato_posta ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.allegato_posta FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.allegato_posta FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
