-- §36 — La firma dentro il documento (`{{firma_cliente}}`).
--
-- Il documento generato da template è composto server-side da una sequenza di blocchi
-- tipizzati (titolo/intestazione/paragrafo/evidenza/firma) ricavati dall'HTML del modello
-- con i tag già risolti. Quei blocchi finivano nei due file e poi venivano buttati: al
-- momento della firma non esisteva più nulla da cui ricomporre il documento, e la
-- grafometrica del cliente poteva stare solo nel verbale allegato — mai nel testo firmato.
--
-- Qui li conserviamo. Non si modifica il PDF originale, per due ragioni: fra le dipendenze
-- non c'è una libreria che sappia annotare un PDF esistente, e soprattutto quel file è
-- quello su cui è fissato l'hash del sigillo — riscriverlo invaliderebbe la prova. La copia
-- firmata è una NUOVA riga documento (tipo='firmato', documento_padre_id → originale) resa
-- da questi stessi blocchi con l'immagine della firma nello slot previsto dal template.
--
-- Migrazione additiva: colonna nullable, zero downtime, nessun backfill. I documenti
-- generati prima di questa migrazione restano senza blocchi: per loro la copia firmata non
-- si produce e la firma resta valida esattamente come prima (sigillo e verbale invariati).

ALTER TABLE "documento" ADD COLUMN "contenuto_blocchi_json" JSONB;
