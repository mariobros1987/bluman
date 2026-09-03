-- §2.9 — Documento a livello di progetto.
--
-- I file caricati dallo studio nel fascicolo appartengono al progetto, non per forza a una
-- micro-voce: l'upload può avvenire prima dell'istanziazione, quando di micro-voci non ne
-- esistono ancora. `microvoce_progetto_id` diventa opzionale e si aggiunge `progetto_id`;
-- almeno uno dei due è sempre valorizzato (garantito dall'applicazione).
--
-- ON DELETE SET NULL sulla micro-voce: se una micro-voce viene rimossa, il documento non
-- sparisce con lei — è un atto caricato dal cliente o dallo studio e resta nel fascicolo
-- del progetto. Prima era RESTRICT, che avrebbe impedito la rimozione.

ALTER TABLE "documento" ALTER COLUMN "microvoce_progetto_id" DROP NOT NULL;

ALTER TABLE "documento" ADD COLUMN "progetto_id" TEXT;

ALTER TABLE "documento" DROP CONSTRAINT "documento_microvoce_progetto_id_fkey";
ALTER TABLE "documento" ADD CONSTRAINT "documento_microvoce_progetto_id_fkey" FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documento" ADD CONSTRAINT "documento_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "documento_progetto_id_idx" ON "documento"("progetto_id");
