-- §Signal per studio: l'endpoint, il token e il numero del demone `signal-cli-rest-api`
-- diventano credenziali della riga `Tenant`, come SMTP, IMAP, WhatsApp e Telegram.
--
-- Perché una rinomina e non una colonna nuova. `signal_cli_endpoint` conteneva esattamente
-- questo valore — l'indirizzo del demone — ed era scritta dall'interfaccia. Nessuna riga di
-- codice la leggeva, quindi non si sa se uno studio l'abbia compilata; nella dubbio, il valore
-- si conserva: `RENAME COLUMN` lo porta sulla colonna nuova senza toccarlo, mentre una coppia
-- ADD + DROP lo perderebbe in silenzio. Il nome vecchio nominava uno strumento specifico
-- (`signal-cli`); quello nuovo nomina il dato, che è la stessa cosa che il campo contiene.
--
-- Additiva e senza backfill: `signal_token` e `signal_number` nascono NULL, cioè «non
-- configurato», che è la verità per ogni studio finché non ne ospita uno. Nessun dato toccato,
-- nessuna riga cancellata.

ALTER TABLE "tenant" RENAME COLUMN "signal_cli_endpoint" TO "signal_endpoint";

ALTER TABLE "tenant" ADD COLUMN "signal_token" TEXT;
ALTER TABLE "tenant" ADD COLUMN "signal_number" TEXT;
