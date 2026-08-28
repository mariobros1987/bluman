-- Piano firma legale §3.1 (Fase 2) — valore legale richiesto e valore legale effettivo.
--
-- `livello_firma_richiesto` (ses|fea|feq): il livello che un documento esige prima di
-- poter essere firmato. Sta su tre tabelle perché tre sono i punti in
-- cui il livello viene imposto: il template (modello_documento_in_bianco, da cui viene
-- copiato alla generazione), il documento concreto (documento, scelto dall'operatore
-- alla pubblicazione per gli upload manuali) e il passaggio di progetto
-- (passaggio_progetto, per la conferma firmata dei moduli).
--
-- `valore_legale` (firma_elettronica): il valore legale EFFETTIVO della firma apposta.
-- Le righe già registrate non si toccano: è un atto probatorio. Il default 'ses' vale
-- solo per le firme future.
--
-- Migrazione additiva: colonne con default, zero downtime, nessun backfill
-- (lo storico resta 'ses', che è il comportamento attuale).
ALTER TABLE "modello_documento_in_bianco" ADD COLUMN "livello_firma_richiesto" TEXT NOT NULL DEFAULT 'ses';
ALTER TABLE "documento" ADD COLUMN "livello_firma_richiesto" TEXT NOT NULL DEFAULT 'ses';
ALTER TABLE "passaggio_progetto" ADD COLUMN "livello_firma_richiesto" TEXT NOT NULL DEFAULT 'ses';
ALTER TABLE "firma_elettronica" ADD COLUMN "valore_legale" TEXT NOT NULL DEFAULT 'ses';
