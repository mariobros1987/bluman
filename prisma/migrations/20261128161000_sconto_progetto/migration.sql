-- Sconto concordato sul progetto (titolare, 28/11/2026) — ADDITIVA: una colonna nuova con
-- valore predefinito 0, nessun dato toccato.
--
-- Con moduli presenti il valore del progetto è la somma dei prezzi dei moduli meno questo sconto
-- (`services/valoreProgetto.ts`). I progetti esistenti nascono con sconto 0: il loro valore non cambia.

-- AlterTable
ALTER TABLE "progetto" ADD COLUMN     "sconto_centesimi" INTEGER NOT NULL DEFAULT 0;
