-- Modulo KYC/AML §5.5 — Fase 5.5.1: il modello dati del fascicolo di adeguata verifica.
--
-- FascicoloKyc è la fonte di verità del processo (D.Lgs. 231/2007). I quattro campi legacy su
-- `cliente` (rischio_aml, ubo, fonte_patrimonio, data_kyc) restano intatti come proiezione di sola
-- lettura: nessuna colonna viene toccata o rimossa. Additiva e senza perdita. Le policy RLS stanno
-- QUI (come per collegamento_chat_progetto): `migrate deploy` gira senza nessuno davanti e una
-- tabella tenant-scoped nata scoperta non la coprirebbe nessuno.

CREATE TYPE "StatoKyc" AS ENUM ('bozza', 'in_attesa_revisione', 'approvato', 'respinto', 'scaduto');
CREATE TYPE "LivelloVerifica" AS ENUM ('semplificata', 'ordinaria', 'rafforzata');
CREATE TYPE "LivelloRischio" AS ENUM ('basso', 'medio', 'alto');
CREATE TYPE "FonteUbo" AS ENUM ('registro_camerale', 'autodichiarazione');
CREATE TYPE "TipoDocumentoKyc" AS ENUM ('documento_identita', 'documento_ubo', 'visura_camerale', 'autodichiarazione_fondi', 'esito_screening_pep', 'esito_screening_liste', 'altro');

CREATE TABLE "fascicolo_kyc" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "cliente_id" TEXT NOT NULL,
  "stato" "StatoKyc" NOT NULL DEFAULT 'bozza',
  "livello_verifica" "LivelloVerifica" NOT NULL DEFAULT 'ordinaria',
  "rischio_calcolato" "LivelloRischio" NOT NULL DEFAULT 'basso',
  "punteggio_rischio" INTEGER NOT NULL DEFAULT 0,
  "pep" BOOLEAN NOT NULL DEFAULT false,
  "paese_rischio" TEXT,
  "paese_residenza" TEXT,
  "fonte_verifica_ubo" "FonteUbo" NOT NULL DEFAULT 'autodichiarazione',
  "ubo_verificato_il" TIMESTAMP(3),
  "data_verifica" TIMESTAMP(3),
  "data_scadenza" TIMESTAMP(3),
  "approvato_da" TEXT,
  "approvato_il" TIMESTAMP(3),
  "note_compliance" TEXT,
  "soglie_operazione" DECIMAL(65,30),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fascicolo_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storico_fascicolo_kyc" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "fascicolo_id" TEXT NOT NULL,
  "stato_precedente" "StatoKyc",
  "stato_nuovo" "StatoKyc" NOT NULL,
  "attore_user_id" TEXT NOT NULL,
  "motivazione" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storico_fascicolo_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "override_kyc" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "fascicolo_id" TEXT NOT NULL,
  "attore_user_id" TEXT NOT NULL,
  "azione_sbloccata" TEXT NOT NULL,
  "motivazione" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "override_kyc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documento_kyc" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "fascicolo_id" TEXT NOT NULL,
  "tipo" "TipoDocumentoKyc" NOT NULL,
  "fonte" "FonteUbo" NOT NULL DEFAULT 'autodichiarazione',
  "url_storage" TEXT NOT NULL,
  "hash_sha256" TEXT,
  "caricato_da" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "documento_kyc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fascicolo_kyc_tenant_id_cliente_id_idx" ON "fascicolo_kyc"("tenant_id", "cliente_id");
CREATE INDEX "fascicolo_kyc_tenant_id_stato_data_scadenza_idx" ON "fascicolo_kyc"("tenant_id", "stato", "data_scadenza");
CREATE INDEX "storico_fascicolo_kyc_tenant_id_fascicolo_id_idx" ON "storico_fascicolo_kyc"("tenant_id", "fascicolo_id");
CREATE INDEX "override_kyc_tenant_id_fascicolo_id_idx" ON "override_kyc"("tenant_id", "fascicolo_id");
CREATE INDEX "documento_kyc_tenant_id_fascicolo_id_idx" ON "documento_kyc"("tenant_id", "fascicolo_id");

ALTER TABLE "fascicolo_kyc"
  ADD CONSTRAINT "fascicolo_kyc_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storico_fascicolo_kyc"
  ADD CONSTRAINT "storico_fascicolo_kyc_fascicolo_id_fkey"
  FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "override_kyc"
  ADD CONSTRAINT "override_kyc_fascicolo_id_fkey"
  FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documento_kyc"
  ADD CONSTRAINT "documento_kyc_fascicolo_id_fkey"
  FOREIGN KEY ("fascicolo_id") REFERENCES "fascicolo_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolamento tenant su tutte e quattro le tabelle KYC (fascicolo, storico, override, documento):
-- dati particolari ai fini GDPR e obbligo di conservazione decennale, la separazione fra studi la
-- deve fare RLS, non un filtro applicativo (regola 1).
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    FOREACH t IN ARRAY ARRAY['fascicolo_kyc', 'storico_fascicolo_kyc', 'override_kyc', 'documento_kyc'] LOOP
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
