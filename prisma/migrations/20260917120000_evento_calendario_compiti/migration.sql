-- Il calendario diventa un calendario vero, e i compiti si possono assegnare.
--
-- Il contesto. La tabella `evento_calendario` esiste dalla prima migrazione ed è vuota: misurata in
-- produzione il 17/09/2026, **zero righe**. Il frontend, nel frattempo, disegnava un calendario
-- fatto di costanti: date inventate quando una sorgente non ne aveva una, clienti cablati nel
-- codice, e un `localStorage` scritto con una chiave e riletto con un'altra — per cui un evento
-- creato a mano non tornava mai indietro. Lo scheletro dei dati era stato progettato, mai acceso.
--
-- Questa migrazione accende la parte dati. Tre cose da dire sulle scelte:
--
-- 1. **`assegnato_a_id` è distinto da `user_id`.** `user_id` dice di chi è la riga nel calendario;
--    `assegnato_a_id` dice chi deve fare il compito. Un advisor apre un compito nel proprio
--    calendario e lo assegna a un collaboratore: sono due persone diverse. Il piano prevedeva
--    `assegnato_a_id` obbligatorio; è stato reso **nullable** perché «nessuno se l'è preso» è uno
--    stato legittimo — un compito appena creato non ha ancora un assegnatario — e perché
--    un'obbligatorietà avrebbe dovuto inventare un assegnatario per le righe esistenti.
--
-- 2. **`ON DELETE` diverso per gli assegnatari e per le sorgenti.** Su `user` è `SET NULL`:
--    cancellare un collaboratore non deve far sparire in silenzio i compiti che aveva in mano, che
--    restano senza assegnatario e quindi visibili. Su `cliente`, `modulo_progetto` e
--    `microvoce_progetto` è `CASCADE`: un evento derivato senza la sua sorgente non ha significato.
--    Il cascade ha anche un effetto pratico già noto a questo progetto — senza, una relazione
--    obbligatoria genererebbe il P2003 «impossibile eliminare per record collegati» che ha già
--    richiesto una correzione una volta.
--
-- 3. **Nessuna policy RLS qui, ed è deliberato.** `evento_calendario` è **già** protetta: sempre
--    misurato il 17/09/2026, ha `relrowsecurity = true`, `relforcerowsecurity = true` e la policy
--    `isolamento_tenant`. Questa migrazione aggiunge colonne a una tabella che ha già un
--    `tenant_id` obbligatorio, quindi la RLS introspettiva di
--    `supabase/migrations/20260819_rls_effettiva.sql` la copre senza che nulla venga toccato. La
--    lezione, per chi verrà dopo: **prima si misura se la policy c'è, poi si scrive.** L'ipotesi
--    contraria — «una tabella modificata nasce esposta» — è ragionevole e qui è falsa.
--
-- Additiva e senza perdita: le colonne nuove hanno un default o sono nullable, nessuna colonna
-- viene rimossa e nessuna riga viene toccata. Le tabelle `user`, `cliente`, `modulo_progetto`,
-- `microvoce_progetto` non cambiano: le relazioni inverse esistono solo nel datamodel Prisma.

-- CreateEnum
--
-- `CREATE TYPE` non ha una forma `IF NOT EXISTS` in PostgreSQL, quindi la guardia è un blocco
-- anonimo che interroga `pg_type`. Serve a poter riapplicare questo file a mano — cosa che in
-- questo progetto succede — senza che la seconda esecuzione si fermi sulla prima riga.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'CategoriaEvento') THEN
    CREATE TYPE "CategoriaEvento" AS ENUM ('promemoria', 'microvoce', 'kyc', 'fattura', 'contratto');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'StatoEvento') THEN
    CREATE TYPE "StatoEvento" AS ENUM ('da_fare', 'fatto', 'annullato');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'PrioritaEvento') THEN
    CREATE TYPE "PrioritaEvento" AS ENUM ('alta', 'media', 'normale');
  END IF;
END
$$;

-- AlterTable
--
-- I default non sono decorativi: `categoria` e `stato` sono `NOT NULL`, e senza default questa
-- migrazione non sarebbe applicabile su un database che avesse anche una sola riga. Su produzione
-- le righe sono zero, ma «in produzione è vuoto» non è una ragione per scrivere una migrazione che
-- vale solo in produzione.
--
-- `generato` a `false` come default è la scelta prudente: una riga preesistente è, per definizione,
-- qualcosa che qualcuno ha scritto. Marcarla come derivata autorizzerebbe a cancellarla.
ALTER TABLE "evento_calendario" ADD COLUMN IF NOT EXISTS "assegnato_a_id" TEXT,
ADD COLUMN IF NOT EXISTS "categoria" "CategoriaEvento" NOT NULL DEFAULT 'promemoria',
ADD COLUMN IF NOT EXISTS "cliente_id" TEXT,
ADD COLUMN IF NOT EXISTS "generato" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "luogo_url" TEXT,
ADD COLUMN IF NOT EXISTS "microvoce_progetto_id" TEXT,
ADD COLUMN IF NOT EXISTS "modulo_progetto_id" TEXT,
ADD COLUMN IF NOT EXISTS "note" TEXT,
ADD COLUMN IF NOT EXISTS "priorita" "PrioritaEvento" NOT NULL DEFAULT 'normale',
ADD COLUMN IF NOT EXISTS "stato" "StatoEvento" NOT NULL DEFAULT 'da_fare';

-- CreateIndex
--
-- I due indici sono le due query che contano. Prima non ce n'era nessuno: la griglia del mese
-- filtra per tenant e intervallo di date, l'elenco «i miei compiti aperti» filtra per tenant,
-- assegnatario e stato.
CREATE INDEX IF NOT EXISTS "evento_calendario_tenant_id_data_inizio_idx"
  ON "evento_calendario"("tenant_id", "data_inizio");
CREATE INDEX IF NOT EXISTS "evento_calendario_tenant_id_assegnato_a_id_stato_idx"
  ON "evento_calendario"("tenant_id", "assegnato_a_id", "stato");

-- AddForeignKey
--
-- Le guardie `DO` servono perché `ADD CONSTRAINT` non ha `IF NOT EXISTS`: senza, una seconda
-- applicazione a mano fallirebbe sul vincolo già presente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evento_calendario_assegnato_a_id_fkey') THEN
    ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_assegnato_a_id_fkey"
      FOREIGN KEY ("assegnato_a_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evento_calendario_cliente_id_fkey') THEN
    ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_cliente_id_fkey"
      FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evento_calendario_modulo_progetto_id_fkey') THEN
    ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_modulo_progetto_id_fkey"
      FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evento_calendario_microvoce_progetto_id_fkey') THEN
    ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_microvoce_progetto_id_fkey"
      FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
