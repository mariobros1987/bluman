-- Collegamento chat → pratica: la chat di un canale agganciata a un progetto.
--
-- Nasce dal link per progetto (`t.me/<Bot>?start=<payload>`). L'instradamento precedente
-- pretendeva che il `chat_id` fosse in una sola scheda cliente **e** che quel cliente avesse un
-- solo progetto aperto: due condizioni che nella realtà cadono spesso (un cliente con due pratiche
-- aperte, una persona che scrive per due clienti). Quando cadevano, il messaggio non poteva
-- entrare in nessun fascicolo. Con questa tabella il collegamento è dichiarato dal cliente che
-- tocca il link, non dedotto.
--
-- Additiva e senza perdita: la tabella nasce vuota, nessuna riga esistente viene toccata e nessuna
-- colonna viene rimossa. Chi ha già un `telegram_chat_id` in anagrafica continua a funzionare per
-- la via di prima: questa tabella è una seconda via, non un rimpiazzo.
--
-- `ON DELETE CASCADE` sulle tre chiavi esterne, e in particolare su `progetto_id`, non è
-- cosmetico: le relazioni obbligatorie in Prisma hanno `Restrict` per default, e senza cascade un
-- progetto collegato diventerebbe non cancellabile con P2003 — cioè di nuovo il guasto
-- «Impossibile eliminare il progetto a causa di record collegati nel database» appena risolto, per
-- una via nuova. Stesso precedente di `comunicazione_progetto.progetto_id`.

CREATE TABLE "collegamento_chat_progetto" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "canale" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "cliente_id" TEXT NOT NULL,
  "progetto_id" TEXT NOT NULL,
  "creato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "creato_da" TEXT NOT NULL DEFAULT 'link',

  CONSTRAINT "collegamento_chat_progetto_pkey" PRIMARY KEY ("id")
);

-- La chiave è sulla chat, non sulla pratica: una chat scrive in una sola pratica, e un secondo
-- `/start` dalla stessa chat sposta il collegamento invece di crearne un secondo. Più chat
-- possono invece puntare alla stessa pratica.
CREATE UNIQUE INDEX "collegamento_chat_progetto_tenant_id_canale_chat_id_key"
  ON "collegamento_chat_progetto"("tenant_id", "canale", "chat_id");
CREATE INDEX "collegamento_chat_progetto_tenant_id_progetto_id_idx"
  ON "collegamento_chat_progetto"("tenant_id", "progetto_id");

ALTER TABLE "collegamento_chat_progetto"
  ADD CONSTRAINT "collegamento_chat_progetto_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collegamento_chat_progetto"
  ADD CONSTRAINT "collegamento_chat_progetto_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collegamento_chat_progetto"
  ADD CONSTRAINT "collegamento_chat_progetto_progetto_id_fkey"
  FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La nuova tabella deve essere protetta come tutte le tabelle tenant-scoped. La policy sta qui e
-- non solo in `supabase/migrations/`: `migrate deploy` gira senza nessuno davanti a ogni deploy, e
-- una tabella nata scoperta su un database nuovo non la coprirebbe nessuno. I GRANT non servono:
-- `ALTER DEFAULT PRIVILEGES` copre già le tabelle future.
--
-- Negli ambienti locali privi del ruolo RLS la migrazione resta applicabile e Prisma può comunque
-- generare il client.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    ALTER TABLE public.collegamento_chat_progetto ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.collegamento_chat_progetto FORCE ROW LEVEL SECURITY;
    CREATE POLICY isolamento_tenant ON public.collegamento_chat_progetto
      FOR ALL TO bluman_app
      USING (tenant_id = public.app_tenant_corrente())
      WITH CHECK (tenant_id = public.app_tenant_corrente());
  END IF;
END
$$;
