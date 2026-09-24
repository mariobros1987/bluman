-- Concessione moduli dalla piattaforma allo studio (solo KYC per ora, struttura generalizzabile).
-- ADDITIVA. `moduli_concessi` = chiavi concesse dal super_admin; si combina con `moduli_disattivati`
-- (già esistente, deciso dall'admin dello studio): un modulo è attivo se concesso E non disattivato.
ALTER TABLE "tenant" ADD COLUMN "moduli_concessi" JSONB;

-- Default richiesto dal titolare: gli studi ESISTENTI mantengono KYC attivo (non si rompe nulla di
-- ciò che è già live); i nuovi studi partiranno senza (lo imposta la rotta di creazione, non qui).
UPDATE "tenant" SET "moduli_concessi" = '["kyc"]'::jsonb WHERE "moduli_concessi" IS NULL;
