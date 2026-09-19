-- Indici sulle foreign key della gerarchia progetto → moduli → micro-voci → passaggi.
-- La lista GET /progetti risolve la include annidata con query "WHERE <fk> IN (...)";
-- senza questi indici Postgres scansiona l'intera tabella a ogni caricamento (seq scan),
-- e il costo cresce linearmente col numero di righe. Con gli indici diventa una lookup.
--
-- IF NOT EXISTS: la migration è idempotente e non fallisce se un indice fosse già stato
-- creato a mano in ambienti diversi.

CREATE INDEX IF NOT EXISTS "modulo_progetto_progetto_id_idx"
  ON "modulo_progetto" ("progetto_id");

CREATE INDEX IF NOT EXISTS "microvoce_progetto_modulo_progetto_id_idx"
  ON "microvoce_progetto" ("modulo_progetto_id");

CREATE INDEX IF NOT EXISTS "passaggio_progetto_microvoce_progetto_id_idx"
  ON "passaggio_progetto" ("microvoce_progetto_id");
