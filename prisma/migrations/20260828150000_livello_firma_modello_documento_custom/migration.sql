-- Piano firma legale §3.1 (Fase 2) — livello richiesto sul template del Document Studio.
--
-- I template che lo studio usa davvero sono i ModelloDocumentoCustom (la tabella
-- `modello_documento_custom` letta da POST /documenti/genera); la colonna viene copiata
-- sul documento concreto alla generazione, salvo override dell'operatore.
--
-- Migrazione additiva: colonna con default, zero downtime, nessun backfill
-- (i template esistenti restano 'ses', che è il comportamento attuale).
ALTER TABLE "modello_documento_custom" ADD COLUMN "livello_firma_richiesto" TEXT NOT NULL DEFAULT 'ses';
