-- Standby moduli a livello di studio: l'admin decide quali moduli lo studio non usa per ora,
-- e vengono nascosti dalla navigazione per tutti (non un blocco di sicurezza: la matrice
-- PermessoModulo per-utente resta il controllo a prova di API). Additiva e nullable: NULL = tutti
-- i moduli attivi, nessuna riga esistente toccata.
ALTER TABLE "tenant" ADD COLUMN "moduli_disattivati" JSONB;
