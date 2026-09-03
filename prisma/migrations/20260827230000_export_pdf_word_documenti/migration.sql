-- Punto 1 piano gap — Export contestuale PDF + Word.
-- I documenti generati da template (tipo='compilato') vivono in duplice formato:
-- file_url resta il master (PDF, il formato su cui è fissato l'hash legale della
-- firma), file_pdf_url/file_docx_url dichiarano la disponibilità dei due formati.
-- Migrazione additiva: colonne nullable + colonna con default, zero downtime,
-- nessun backfill (documenti storici: file_docx_url resta null — il download Word
-- è indisponibile solo per lo storico pre-migrazione, salvo rigenerazione esplicita).

ALTER TABLE "documento" ADD COLUMN "file_pdf_url" TEXT;
ALTER TABLE "documento" ADD COLUMN "file_docx_url" TEXT;
ALTER TABLE "documento" ADD COLUMN "formato_origine" TEXT NOT NULL DEFAULT 'pdf';
