-- ====================================================================
-- MagicLink — i token di accesso al portale cliente diventano verificabili (§23)
-- ====================================================================
-- Prima di questa tabella `POST /auth/magic-login` accettava qualunque stringa che
-- iniziasse per `client_` e in cambio firmava un JWT con tenant ed email cablati nel
-- sorgente. Non era un controllo debole: era assente, perché i token non venivano
-- persistiti da nessuna parte e non c'era nulla contro cui confrontarli. Un `curl` con
-- {"magicToken":"client_x"} otteneva una sessione valida di ruolo `cliente` sul tenant
-- che contiene i dati.
--
-- In tabella finisce lo SHA-256 del token, non il token: chi legge il database non deve
-- poter entrare al posto del cliente.

-- CreateTable
CREATE TABLE "magic_link" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scadenza" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "usato_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_token_hash_key" ON "magic_link"("token_hash");

-- AddForeignKey
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────
-- Row-Level Security (§14, regola 1)
-- ────────────────────────────────────────────────────────────────────
-- La policy sta qui e non solo in supabase/migrations/20260819_rls_effettiva.sql per un
-- motivo pratico: quel file lo applica una persona con psql, mentre questa migrazione la
-- applica `prisma migrate deploy` dal Dockerfile a ogni deploy. Se la policy vivesse solo
-- là, la tabella nascerebbe scoperta su ogni database nuovo — e una tabella senza policy è
-- una tabella fuori dall'isolamento, cioè esattamente il buco che le policy chiudono.
--
-- È la stessa policy che il blocco per introspezione di quel file genererebbe per una
-- tabella con `tenant_id` NOT NULL, scritta a mano per non dipendere da chi lo riesegue.
-- I GRANT non servono: `ALTER DEFAULT PRIVILEGES` copre già le tabelle future.
DO $$
BEGIN
  -- Su un database dove il ruolo applicativo e le funzioni di contesto non esistono
  -- ancora (sviluppo locale prima di aver eseguito il file psql), la policy non si può
  -- creare. Meglio un avviso che una migrazione che non applica: il file psql la creerà
  -- comunque, perché il suo blocco per introspezione trova questa tabella da sé.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app') THEN
    RAISE NOTICE 'Ruolo bluman_app assente: policy su magic_link non creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
  ) THEN
    RAISE NOTICE 'Funzione app_tenant_corrente() assente: policy su magic_link non creata. Esegui supabase/migrations/20260819_rls_effettiva.sql';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.magic_link ENABLE ROW LEVEL SECURITY';
  -- FORCE vale anche per il proprietario della tabella: se un domani lo schema passasse
  -- di mano, la policy resterebbe in vigore. `postgres` continua a scavalcare grazie a
  -- rolbypassrls, quindi migrazioni, seed e la verifica del token al login non si rompono.
  EXECUTE 'ALTER TABLE public.magic_link FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS isolamento_tenant ON public.magic_link';
  EXECUTE $p$
    CREATE POLICY isolamento_tenant ON public.magic_link
      FOR ALL
      TO bluman_app
      USING (tenant_id = public.app_tenant_corrente())
      WITH CHECK (tenant_id = public.app_tenant_corrente())
  $p$;
END
$$;
