-- KYC/AML Fase K9 (Malta, spec §5.4/§8.9/§11) — conservazione/retention del fascicolo. ADDITIVA.
-- Alla chiusura il fascicolo entra in conservazione: chiuso_at = fine del rapporto, retention_scadenza
-- = chiuso_at + retentionYears (config tenant), salvo proroga. Allo scadere l'MLRO conferma la
-- cancellazione o l'anonimizzazione (retention_esito). Nessuna cancellazione fisica prima (§8.9).
-- Solo colonne nuove su fascicolo_kyc (già RLS da K1) + un enum: nessuna riga toccata, nessun backfill.

CREATE TYPE "EsitoRetention" AS ENUM ('cancellato', 'anonimizzato');

ALTER TABLE "fascicolo_kyc"
  ADD COLUMN "chiuso_at" TIMESTAMP(3),
  ADD COLUMN "retention_scadenza" TIMESTAMP(3),
  ADD COLUMN "retention_proroga_al" TIMESTAMP(3),
  ADD COLUMN "retention_proroga_motivo" TEXT,
  ADD COLUMN "retention_esito" "EsitoRetention",
  ADD COLUMN "retention_esito_at" TIMESTAMP(3),
  ADD COLUMN "retention_esito_da" TEXT;
