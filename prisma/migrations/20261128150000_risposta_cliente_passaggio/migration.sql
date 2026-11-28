-- Risposte del cliente ai passaggi «a carico del cliente» (portale, 28/11/2026) — ADDITIVA: due
-- colonne nuove e facoltative su `passaggio_progetto`, nessun dato toccato, nessuna tabella nuova
-- (la policy RLS della tabella copre già le colonne aggiunte).
--
-- `risposte_cliente_json` è ciò che il cliente ha compilato dal portale, `risposta_cliente_at`
-- quando. Restano distinte da `risposte_form_json`, che è ciò che registra l'operatore.
--
-- Scritta a mano e non con `prisma migrate dev`: il database ombra non riesce a rieseguire una
-- migrazione storica (20260825120000_rls_portale_dati_addendum, P3006). Le istruzioni qui sotto
-- sono quelle che `prisma migrate diff` produce dallo schema.

ALTER TABLE "passaggio_progetto" ADD COLUMN "risposte_cliente_json" JSONB;
ALTER TABLE "passaggio_progetto" ADD COLUMN "risposta_cliente_at" TIMESTAMP(3);
