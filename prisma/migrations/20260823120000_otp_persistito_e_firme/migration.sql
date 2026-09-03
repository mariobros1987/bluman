-- ────────────────────────────────────────────────────────────────────
-- Recapiti OTP in anagrafica cliente (§23bis, §1.2)
-- ────────────────────────────────────────────────────────────────────
-- `cliente` non aveva un numero di telefono. Il portale teneva quello del firmatario
-- cablato nel sorgente, quindi il codice di firma di qualunque cliente partiva verso
-- lo stesso telefono. Il recapito è un dato dell'anagrafica, non una costante del frontend.
ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "cellulare" TEXT;
ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "telegram_chat_id" TEXT;
ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "canale_otp_preferito" TEXT;

-- ────────────────────────────────────────────────────────────────────
-- codice_otp — il secondo fattore, persistito
-- ────────────────────────────────────────────────────────────────────
-- Prima i codici stavano in una Map in memoria: un restart di Railway, o la seconda
-- istanza di un deploy, e il cliente leggeva "codice non valido" su un codice appena
-- ricevuto. Un secondo fattore che non sopravvive al riavvio non è un secondo fattore.
CREATE TABLE IF NOT EXISTS "codice_otp" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    -- HMAC-SHA-256, non SHA-256 nudo: sei cifre sono un milione di digest precalcolabili.
    -- La chiave è JWT_SECRET, che vive in ambiente e non in tabella.
    "codice_hash" TEXT NOT NULL,
    "canale" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "target_dichiarato" BOOLEAN NOT NULL DEFAULT false,
    "target_anagrafica" TEXT,
    "ambito" TEXT NOT NULL,
    "riferimento_id" TEXT,
    "scadenza" TIMESTAMP(3) NOT NULL,
    "tentativi" INTEGER NOT NULL DEFAULT 0,
    "reinvii" INTEGER NOT NULL DEFAULT 0,
    "ultimo_invio_at" TIMESTAMP(3) NOT NULL,
    "ip_richiesta" TEXT,
    "usato_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codice_otp_pkey" PRIMARY KEY ("id")
);

-- ────────────────────────────────────────────────────────────────────
-- firma_elettronica — il sigillo eIDAS, persistito
-- ────────────────────────────────────────────────────────────────────
-- Il sigillo veniva costruito in memoria, restituito al browser e buttato: lo studio non
-- poteva dimostrare che una firma fosse stata apposta. `stato_firma = 'firmato'` dice che
-- è successo, non cosa è successo, e non regge una contestazione.
CREATE TABLE IF NOT EXISTS "firma_elettronica" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "signature_id" TEXT NOT NULL,
    -- fea_otp | manuale_scansionata | qualificata_esterna: cambia il valore probatorio,
    -- quindi sta scritto accanto alla firma e non si deduce.
    "tipo_firma" TEXT NOT NULL,
    "ambito" TEXT NOT NULL,
    "riferimento_id" TEXT,
    "documento_titolo" TEXT NOT NULL,
    "firmatario_nome" TEXT NOT NULL,
    "firmatario_ruolo" TEXT,
    "documento_hash" TEXT NOT NULL,
    "canale_verificato" TEXT,
    "codice_otp_id" TEXT,
    -- NULL quando l'IP non è disponibile. Il frontend scriveva '83.211.12.94 (eIDAS
    -- Verificato)': un indirizzo cablato in un sigillo probatorio è una dichiarazione falsa.
    "ip_address" TEXT,
    "user_agent" TEXT,
    "firma_grafometrica_png" TEXT,
    "file_firmato_url" TEXT,
    "file_firmato_hash" TEXT,
    "standard" TEXT NOT NULL,
    "firmato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firma_elettronica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "firma_elettronica_signature_id_key" ON "firma_elettronica"("signature_id");
CREATE INDEX IF NOT EXISTS "codice_otp_cliente_id_ambito_scadenza_idx" ON "codice_otp"("cliente_id", "ambito", "scadenza");
CREATE INDEX IF NOT EXISTS "firma_elettronica_cliente_id_ambito_idx" ON "firma_elettronica"("cliente_id", "ambito");

-- AddForeignKey
-- Postgres non ha ADD CONSTRAINT IF NOT EXISTS: il DO block rende la migrazione
-- rieseguibile senza fallire su un database dove i vincoli ci sono già.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codice_otp_tenant_id_fkey') THEN
    ALTER TABLE "codice_otp" ADD CONSTRAINT "codice_otp_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codice_otp_cliente_id_fkey') THEN
    ALTER TABLE "codice_otp" ADD CONSTRAINT "codice_otp_cliente_id_fkey"
      FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firma_elettronica_tenant_id_fkey') THEN
    ALTER TABLE "firma_elettronica" ADD CONSTRAINT "firma_elettronica_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firma_elettronica_cliente_id_fkey') THEN
    ALTER TABLE "firma_elettronica" ADD CONSTRAINT "firma_elettronica_cliente_id_fkey"
      FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Il legame fra sigillo e codice che lo ha autorizzato. RESTRICT e non CASCADE: un
  -- codice OTP non si cancella lasciando una firma senza la prova del suo secondo fattore.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'firma_elettronica_codice_otp_id_fkey') THEN
    ALTER TABLE "firma_elettronica" ADD CONSTRAINT "firma_elettronica_codice_otp_id_fkey"
      FOREIGN KEY ("codice_otp_id") REFERENCES "codice_otp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- Row-Level Security (§14, regola 1)
-- ────────────────────────────────────────────────────────────────────
-- Stessa ragione di 20260819210000_magic_link_persistito: il blocco per introspezione di
-- supabase/migrations/20260819_rls_effettiva.sql troverebbe da sé queste due tabelle, ma
-- quel file lo esegue una persona con psql, mentre questa migrazione la applica
-- `prisma migrate deploy` a ogni deploy. Su un database nuovo le tabelle nascerebbero
-- scoperte, e una tabella senza policy è una tabella fuori dall'isolamento.
--
-- Qui la posta in gioco è più alta che altrove: senza policy, `bluman_app` leggerebbe i
-- digest OTP e i sigilli di firma di ogni tenant.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RAISE NOTICE 'Ruolo bluman_app assente: policy su codice_otp e firma_elettronica non create. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RAISE NOTICE 'Funzione app_tenant_corrente() assente: policy non create. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['codice_otp', 'firma_elettronica']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE vale anche per il proprietario: se lo schema passasse di mano, la policy
    -- resterebbe in vigore. `postgres` scavalca grazie a rolbypassrls, quindi migrazioni
    -- e seed non si rompono.
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
