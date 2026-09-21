-- Indici sulla tabella comunicazione_progetto, che finora non ne aveva NESSUNO (audit 21/09/2026).
--
-- 1) La lista del fascicolo comunicazioni (GET /progetti/:id/comunicazioni) filtra per
--    progetto e ordina per data: senza indice è un seq scan a ogni apertura della chat,
--    amplificato dal polling del frontend. Con la RLS ogni query costa già più round-trip,
--    quindi il seq scan pesa molto più del previsto.
-- 2) I webhook di stato WhatsApp/Telegram cercano il messaggio per external_id: senza indice
--    anche quello è un seq scan a ogni evento di consegna/lettura.
--
-- IF NOT EXISTS: migration idempotente, non fallisce se un indice fosse già presente.

CREATE INDEX IF NOT EXISTS "idx_comunicazione_progetto_tenant_progetto_data"
  ON "comunicazione_progetto" ("tenant_id", "progetto_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_comunicazione_progetto_tenant_external"
  ON "comunicazione_progetto" ("tenant_id", "external_id");
