-- §41 — Cartella template dello studio: stato di revisione dei modelli del Document Studio.
--
-- La tabella `modello_documento_custom` conteneva il testo del modello e nient'altro: non si
-- poteva sapere se quel testo fosse una bozza appena abbozzata o un atto riletto e approvato
-- dal titolare. Nell'elenco i due casi erano identici, e la differenza la ricordava soltanto
-- chi aveva scritto il modello — cioè nessuno, dopo qualche settimana.
--
-- Le colonne aggiunte qui rispondono a tre domande: in che stato è il modello, chi lo ha
-- deciso e quando, e da quale carta di serie nasce (se nasce da una).
--
--   stato_revisione        bozza | in_revisione | approvato. L'insieme dei valori ammessi e i
--                          passaggi consentiti stanno in `src/services/revisioneModello.ts`:
--                          un CHECK in colonna avrebbe fissato lo stesso elenco in due posti.
--   versione               sale quando il TESTO di un modello approvato cambia. Un'approvazione
--                          che resta appesa a un contenuto diverso da quello approvato non
--                          attesta nulla, quindi la modifica riporta il modello in bozza e
--                          incrementa la versione.
--   note_revisione         il motivo scritto da chi ha deciso lo stato (facoltativo).
--   revisionato_da_*       chi ha deciso, denormalizzato come in `audit_log`: id per risalire
--                          all'utenza, nome perché la riga resti leggibile anche quando
--                          l'utenza viene disattivata o rinominata.
--   archiviato_at          archiviare non è eliminare. Prima l'archiviazione dei modelli
--                          viveva in `localStorage` del browser (`bluman_archived_template_ids`),
--                          quindi un modello archiviato da un computer restava attivo su tutti
--                          gli altri e spariva svuotando la cache: non era un dato dello studio.
--   riferimento_serie      l'id del modello di serie (quelli scritti nel codice, es.
--                          `tmpl-engagement`) da cui il modello è stato adottato. Rende
--                          l'adozione idempotente: la cartella non mostra due volte la stessa
--                          carta se due operatori la adottano insieme.
--
-- Migrazione additiva: colonne con default o nullable, nessun backfill, nessun fermo. I modelli
-- esistenti restano 'bozza' versione 1, che è esattamente quanto si sa di loro oggi — dire
-- «approvato» su una riga che nessuno ha mai riletto sarebbe un'attestazione inventata.
--
-- RLS: nessuna modifica necessaria. `modello_documento_custom` ha la colonna `tenant_id` e
-- ricade quindi nel ciclo di `supabase/migrations/20260819_rls_effettiva.sql`, che abilita RLS
-- forzata e la policy `isolamento_tenant` su tutte le tabelle con quella colonna.

ALTER TABLE "modello_documento_custom" ADD COLUMN "stato_revisione" TEXT NOT NULL DEFAULT 'bozza';
ALTER TABLE "modello_documento_custom" ADD COLUMN "versione" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "modello_documento_custom" ADD COLUMN "note_revisione" TEXT;
ALTER TABLE "modello_documento_custom" ADD COLUMN "revisionato_da_user_id" TEXT;
ALTER TABLE "modello_documento_custom" ADD COLUMN "revisionato_da_nome" TEXT;
ALTER TABLE "modello_documento_custom" ADD COLUMN "revisionato_at" TIMESTAMP(3);
ALTER TABLE "modello_documento_custom" ADD COLUMN "archiviato_at" TIMESTAMP(3);
ALTER TABLE "modello_documento_custom" ADD COLUMN "riferimento_serie" TEXT;

-- Un modello di serie si adotta una volta per studio. In PostgreSQL i NULL restano distinti
-- fra loro in un indice unico, quindi i modelli scritti dallo studio (riferimento_serie NULL)
-- non si ostacolano a vicenda: il vincolo morde solo sulle adozioni.
CREATE UNIQUE INDEX "modello_documento_custom_tenant_serie_key"
  ON "modello_documento_custom"("tenant_id", "riferimento_serie");
