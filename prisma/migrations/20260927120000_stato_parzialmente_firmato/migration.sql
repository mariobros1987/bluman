-- §WF-DOC / firme multi-parte — nuovo stato `parzialmente_firmato` per StatoDocumento. ADDITIVA.
-- Un documento che prevede sia la firma del cliente CHE quella dello studio resta
-- «parzialmente_firmato» finché entrambe le parti previste non hanno firmato; diventa «firmato»
-- solo a firme complete. Aggiungere un valore a un enum Postgres è additivo e non tocca dati.
-- Nota Postgres: ALTER TYPE ... ADD VALUE non può girare dentro una transazione con altri comandi;
-- questa migrazione contiene solo questo statement, quindi `migrate deploy` la applica da sola.

ALTER TYPE "StatoDocumento" ADD VALUE IF NOT EXISTS 'parzialmente_firmato' BEFORE 'firmato';
