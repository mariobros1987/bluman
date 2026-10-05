-- Messaggi abbinati alle micro-voci, e il contesto che li abbina da sé.
--
-- Perché. Un messaggio sapeva a quale PRATICA apparteneva e nient'altro: la micro-voce — dove il
-- lavoro accade davvero — non sapeva che il cliente aveva scritto qualcosa che la riguardava, e per
-- scoprirlo bisognava rileggere la chat a mano. `collegamento_chat_progetto` aveva già risolto lo
-- stesso problema un livello sopra (a chi appartiene un messaggio) scegliendo il collegamento
-- ESPLICITO invece dell'euristica: indovinare di cosa parla un messaggio è più difficile che
-- indovinare a chi appartiene, quindi la stessa scelta vale a maggior ragione.
--
-- Due tabelle, ADDITIVE, tenant-scoped, RLS come le altre.
--
--   comunicazione_microvoce   il legame messaggio ↔ micro-voce (join, non FK singola: un messaggio
--                             che riguarda due moduli è realistico — precedente:
--                             microvoce_modulo_condiviso). `origine` dice PERCHÉ è lì.
--   contesto_microvoce_chat   la micro-voce di cui si sta parlando ADESSO in una chat. Tiene la
--                             chiave unica sulla chat, e la scadenza: un contesto armato tre
--                             settimane fa abbinerebbe in silenzio i messaggi sbagliati.
--
-- Nomi d'indice espliciti: senza, Prisma tronca gli identificatori a 63 caratteri e la troncatura
-- non è una cosa da indovinare a mano.

-- Da quale chat viene il messaggio: è la chiave con cui un contesto armato sa a quale conversazione
-- appartiene. Senza, l'operatore potrebbe armare il contesto solo sulle chat Telegram (le uniche
-- enumerabili da collegamento_chat_progetto), mentre il cliente può scrivere su qualunque canale.
-- Nullable: le righe scritte dal portale non vengono da una chat, e le righe storiche non lo sanno.
ALTER TABLE "comunicazione_progetto" ADD COLUMN "chat_id" TEXT;

CREATE TABLE "comunicazione_microvoce" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "comunicazione_id" TEXT NOT NULL,
    "microvoce_progetto_id" TEXT NOT NULL,
    "origine" TEXT NOT NULL,
    "creato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comunicazione_microvoce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_comunicazione_microvoce_unica"
    ON "comunicazione_microvoce"("comunicazione_id", "microvoce_progetto_id");
CREATE INDEX "idx_comunicazione_microvoce_tenant_microvoce"
    ON "comunicazione_microvoce"("tenant_id", "microvoce_progetto_id");

ALTER TABLE "comunicazione_microvoce"
    ADD CONSTRAINT "comunicazione_microvoce_comunicazione_id_fkey"
    FOREIGN KEY ("comunicazione_id") REFERENCES "comunicazione_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comunicazione_microvoce"
    ADD CONSTRAINT "comunicazione_microvoce_microvoce_progetto_id_fkey"
    FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contesto_microvoce_chat" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "canale" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "microvoce_progetto_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "armato_da" TEXT NOT NULL DEFAULT 'link',
    "armato_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scade_at" TIMESTAMP(3),
    CONSTRAINT "contesto_microvoce_chat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_contesto_microvoce_chat_unica"
    ON "contesto_microvoce_chat"("tenant_id", "canale", "chat_id");
CREATE INDEX "idx_contesto_microvoce_tenant_microvoce"
    ON "contesto_microvoce_chat"("tenant_id", "microvoce_progetto_id");
-- La pratica della micro-voce, ridondata perché il controllo che ogni messaggio in ingresso deve
-- fare («la micro-voce armata è di questa pratica?») resti un confronto fra campi invece di una
-- risalita microvoce → modulo → progetto dentro la transazione del webhook. È immutabile: il modulo
-- proprietario di una micro-voce non cambia, quindi non c'è niente da tenere allineato.
CREATE INDEX "idx_contesto_microvoce_tenant_progetto"
    ON "contesto_microvoce_chat"("tenant_id", "progetto_id");

ALTER TABLE "contesto_microvoce_chat"
    ADD CONSTRAINT "contesto_microvoce_chat_microvoce_progetto_id_fkey"
    FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: isolamento per tenant, guardato da IF EXISTS come le altre migrazioni.
-- Le due tabelle hanno `tenant_id NOT NULL`, quindi il blocco per introspezione di
-- supabase/migrations/20260819_rls_effettiva.sql (montato come /rls.sql nel deploy) le copre da sé
-- a ogni deploy: questo blocco serve per gli ambienti dove quel file non gira.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bluman_app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_tenant_corrente'
     ) THEN
    EXECUTE 'ALTER TABLE public.comunicazione_microvoce ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.comunicazione_microvoce FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.comunicazione_microvoce FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';

    EXECUTE 'ALTER TABLE public.contesto_microvoce_chat ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contesto_microvoce_chat FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY isolamento_tenant ON public.contesto_microvoce_chat FOR ALL TO bluman_app USING (tenant_id = public.app_tenant_corrente()) WITH CHECK (tenant_id = public.app_tenant_corrente())';
  END IF;
END
$$;
