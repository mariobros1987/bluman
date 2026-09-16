-- §Signal per studio: l'endpoint, il token e il numero del demone `signal-cli-rest-api`
-- diventano credenziali della riga `Tenant`, come SMTP, IMAP, WhatsApp e Telegram.
--
-- Perché una colonna nuova e non una rinomina. `signal_cli_endpoint` conteneva esattamente
-- questo valore — l'indirizzo del demone — ed era scritta dall'interfaccia. Nessuna riga di
-- codice la leggeva, quindi non si sa se uno studio l'abbia compilata: nel dubbio il valore
-- si **copia** sulla colonna nuova invece di lasciarlo indietro.
--
-- Perché non `RENAME COLUMN`, che sarebbe stato più breve. Il backend in esecuzione su Railway
-- è compilato contro lo schema vecchio, e le sue query su `tenant` in gran parte non hanno un
-- `select` esplicito (`clienti.ts`, `portale.ts`, `solleciti.ts`, `contabilita*`, `tenant.ts`):
-- Prisma genera per quelle un `SELECT` che elenca tutte le colonne, `signal_cli_endpoint`
-- compresa. Rinominare la colonna mentre quel backend gira significa che ognuna di quelle
-- richieste fallisce con «column does not exist» per tutta la durata del deploy. Copiare
-- invece lascia in piedi **entrambe** le colonne, quindi il backend vecchio e quello nuovo
-- convivono senza finestra di errore.
--
-- `signal_cli_endpoint` resta per questo, ed è l'unica ragione per cui resta: nessuno la legge
-- più. Va rimossa quando il backend che legge `signal_endpoint` è in produzione — la migrazione
-- `20260916200000_rimuovi_signal_cli_endpoint` fa esattamente questo, e si può applicare senza
-- fretta perché a quel punto nessun codice nomina la colonna.
--
-- Additiva e senza perdita: `signal_token` e `signal_number` nascono NULL, cioè «non
-- configurato», che è la verità per ogni studio finché non ne ospita uno. Nessuna riga
-- cancellata, nessun dato toccato.

ALTER TABLE "tenant" ADD COLUMN "signal_endpoint" TEXT;
ALTER TABLE "tenant" ADD COLUMN "signal_token" TEXT;
ALTER TABLE "tenant" ADD COLUMN "signal_number" TEXT;

-- Il valore che c'era viene portato sulla colonna nuova, se c'era. `WHERE ... IS NOT NULL`
-- perché una colonna vuota non è una configurazione: scrivere NULL su NULL non cambia nulla.
UPDATE "tenant"
SET "signal_endpoint" = "signal_cli_endpoint"
WHERE "signal_cli_endpoint" IS NOT NULL;
