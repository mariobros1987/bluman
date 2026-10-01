-- Archiviazione degli operatori: i periodi di collaborazione (dal → al).
--
-- Perché serve. Fino a oggi non c'era **nessun** modo di togliere un operatore dallo studio:
-- `disattivato` esiste nell'enum `StatoUtente` ed è già rispettato dal login e dai due hook di
-- autenticazione, ma nessuna riga di codice lo scriveva mai. Chi smetteva di lavorare con lo
-- studio restava attivo, assegnabile ai progetti e con le credenziali valide, per sempre.
--
-- Perché una tabella e non due colonne su `user`. Le stagioni possono essere più d'una: una
-- persona se ne va e rientra. Con `data_assunzione`/`data_cessazione` su `user` il secondo
-- periodo cancellerebbe il primo, e la storia che il titolare ha chiesto di conservare
-- andrebbe persa. Qui ogni stagione è una riga, e quella con `al` nullo è quella in corso.
--
-- Additiva e senza perdita: nasce con le sole righe del backfill in coda, nessuna colonna o
-- riga esistente viene toccata.
--
-- `ON DELETE CASCADE` su entrambe le chiavi esterne: uno studio eliminato porta via i suoi
-- periodi, una persona eliminata porta via i suoi. È la stessa scelta delle altre figlie
-- tenant-scoped, e non c'è niente qui che debba sopravvivere al soggetto a cui si riferisce.

CREATE TABLE "periodo_collaborazione" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "dal"              TIMESTAMP(3) NOT NULL,
  "al"               TIMESTAMP(3),
  -- Lo `stato` dell'utenza prima dell'archiviazione, per rimetterlo al rientro. Chi era
  -- `invitato` — mai entrato, con la password temporanea ancora da cambiare — non deve
  -- ritrovarsi `attivo` per il solo fatto di essere stato archiviato e riattivato.
  --
  -- Il tipo è l'enum `"StatoUtente"`, non `TEXT`: la colonna è la copia di `user.stato` e
  -- scriverla come testo libero farebbe divergere la tabella dal modello Prisma
  -- (`statoPrecedente StatoUtente?`), che alla prima `migrate dev` chiederebbe un
  -- `ALTER COLUMN ... TYPE` per rimediare — una migrazione fantasma su una colonna appena nata.
  "stato_precedente" "StatoUtente",
  "motivo"           TEXT,
  "creato_da"        TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "periodo_collaborazione_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "periodo_collaborazione_tenant_id_user_id_idx"
  ON "periodo_collaborazione"("tenant_id", "user_id");

ALTER TABLE "periodo_collaborazione"
  ADD CONSTRAINT "periodo_collaborazione_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "periodo_collaborazione"
  ADD CONSTRAINT "periodo_collaborazione_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Il backfill. Senza, l'invariante nascerebbe già falsa: `stato` e periodo aperto devono
-- combaciare — `disattivato` **se e solo se** non c'è un periodo con `al` nullo — e ogni
-- utente già attivo oggi non avrebbe nessun periodo aperto, quindi la prima lettura del team
-- lo mostrerebbe come archiviato.
--
-- La data di inizio è `user.created_at`: è l'unica data di assunzione che il database ha.
-- Gli utenti `disattivato` sono esclusi di proposito (non sono in forza, non hanno un periodo
-- aperto), e i super admin di piattaforma pure: hanno `tenant_id` nullo, e `tenant_id` qui è
-- NOT NULL perché un periodo appartiene a uno studio. Il `NOT EXISTS` rende la migrazione
-- rieseguibile senza duplicare i periodi.
--
-- `stato_precedente` è lo stato attuale della riga: per chi non è mai entrato è `invitato`, e
-- archiviarne uno prima del primo accesso non deve promuoverlo ad `attivo` al rientro.

INSERT INTO "periodo_collaborazione" ("id", "tenant_id", "user_id", "dal", "stato_precedente", "created_at")
SELECT gen_random_uuid()::text, u."tenant_id", u."id", u."created_at", u."stato", CURRENT_TIMESTAMP
FROM "user" u
WHERE u."tenant_id" IS NOT NULL
  AND u."stato" <> 'disattivato'
  AND NOT EXISTS (
    SELECT 1 FROM "periodo_collaborazione" p WHERE p."user_id" = u."id"
  );

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
    ALTER TABLE public.periodo_collaborazione ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.periodo_collaborazione FORCE ROW LEVEL SECURITY;
    CREATE POLICY isolamento_tenant ON public.periodo_collaborazione
      FOR ALL TO bluman_app
      USING (tenant_id = public.app_tenant_corrente())
      WITH CHECK (tenant_id = public.app_tenant_corrente());
  END IF;
END
$$;
