-- Allinea tre FOREIGN KEY al comportamento già dichiarato da prisma/schema.prisma.
--
-- Lo schema era stato aggiornato (Cascade su FatturaRiga, SetNull su Fattura.progetto
-- e Documento.caricatoDaUser) ma nessuna migrazione ha mai portato il cambiamento nel
-- database: il drift è emerso dalla suite E2E di settembre 2026, che crea il database
-- dalle sole migrazioni versionate ed è quindi una fotografia fedele di produzione.
--
-- 1. fattura_riga → fattura: ON DELETE CASCADE (prima RESTRICT). Senza questo
--    DELETE /invoices/:id sulle bozze falliva con P2003: le bozze nascono già con le
--    righe e la FK RESTRICT impediva la cancellazione. Scadenze e registrazioni
--    incasso erano già in cascade, la riga era l'unica esclusa.
-- 2. fattura → progetto: ON DELETE SET NULL (prima CASCADE). La cancellazione di un
--    progetto non deve mai trascinarsi dietro le fatture, nemmeno quelle: la rotta
--    le blocca già col guard fiscale di eliminaProgetto (prismaApp.ts), questo è la
--    difesa in profondità. Le fatture restano nel registro con progetto NULL.
-- 3. documento → "user" (caricato_da): ON DELETE SET NULL (prima RESTRICT). Il
--    documento sopravvive alla sparizione dell'operatore che lo ha caricato;
--    caricatoDaUser è opzionale nello schema proprio per questo.

-- 1. Righe di fattura seguono la fattura.
ALTER TABLE "fattura_riga" DROP CONSTRAINT "fattura_riga_fattura_id_fkey";
ALTER TABLE "fattura_riga"
  ADD CONSTRAINT "fattura_riga_fattura_id_fkey"
  FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. La fattura sopravvive al progetto.
ALTER TABLE "fattura" DROP CONSTRAINT "fattura_progetto_id_fkey";
ALTER TABLE "fattura"
  ADD CONSTRAINT "fattura_progetto_id_fkey"
  FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Il documento sopravvive all'operatore che lo ha caricato.
ALTER TABLE "documento" DROP CONSTRAINT "documento_caricato_da_fkey";
ALTER TABLE "documento"
  ADD CONSTRAINT "documento_caricato_da_fkey"
  FOREIGN KEY ("caricato_da") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
