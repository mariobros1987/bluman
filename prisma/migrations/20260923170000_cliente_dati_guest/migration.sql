-- Dati anagrafici del guest/persona fisica sul Cliente, per l'auto-compilazione dei template
-- documenti (Service/Hospitality Agreement) e per il KYC Malta. Additive/nullable: NULL su tutte
-- le righe esistenti, nessun dato toccato.
ALTER TABLE "cliente" ADD COLUMN "documento_tipo" TEXT;
ALTER TABLE "cliente" ADD COLUMN "documento_numero" TEXT;
ALTER TABLE "cliente" ADD COLUMN "data_nascita" TEXT;
ALTER TABLE "cliente" ADD COLUMN "luogo_nascita" TEXT;
ALTER TABLE "cliente" ADD COLUMN "indirizzo_residenza" TEXT;
ALTER TABLE "cliente" ADD COLUMN "indirizzo_alloggio" TEXT;
