-- Storno dell'incasso (titolare, 28/11/2026) — ADDITIVA: due colonne nuove, nullable, nessun dato toccato.
--
-- Un incasso sbagliato non si cancella: si storna con una registrazione contraria (importo
-- negativo) che punta a quella che annulla (`storno_di_id`, unico: un incasso si storna una volta
-- sola). Il movimento di Prima Nota ricorda la registrazione da cui è nato
-- (`registrazione_incasso_id`), così lo storno esce dallo stesso conto in cui il denaro era entrato.
-- Gli incassi registrati prima di questa migrazione restano senza legame: lo storno li ritrova
-- per fattura, importo e data.
--
-- Scritta a mano dalle istruzioni di `prisma migrate diff` fra lo schema di prima e quello nuovo
-- (nessun database toccato), come 20261127140000_note_beta. Le due tabelle hanno già la loro
-- policy RLS: aggiungere colonne non la cambia.

ALTER TABLE "registrazione_incasso" ADD COLUMN "storno_di_id" TEXT;

ALTER TABLE "movimento_prima_nota" ADD COLUMN "registrazione_incasso_id" TEXT;

CREATE UNIQUE INDEX "registrazione_incasso_storno_di_id_key" ON "registrazione_incasso"("storno_di_id");

CREATE INDEX "movimento_prima_nota_registrazione_incasso_id_idx" ON "movimento_prima_nota"("registrazione_incasso_id");

ALTER TABLE "registrazione_incasso" ADD CONSTRAINT "registrazione_incasso_storno_di_id_fkey" FOREIGN KEY ("storno_di_id") REFERENCES "registrazione_incasso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "movimento_prima_nota" ADD CONSTRAINT "movimento_prima_nota_registrazione_incasso_id_fkey" FOREIGN KEY ("registrazione_incasso_id") REFERENCES "registrazione_incasso"("id") ON DELETE SET NULL ON UPDATE CASCADE;
