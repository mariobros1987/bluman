-- Marca temporale RFC 3161 legata alla firma (P1.2, 17/10/2026).
-- ADDITIVA: sole colonne nullable su `firma_elettronica`, nessuna riga esistente cambia.
--
-- Al momento della firma il server chiede alla TSA configurata di marcare l'impronta del
-- sigillo e conserva qui il token. Le firme anteriori restano senza marca: è la verità di
-- come sono state apposte, e non si inventa un token a posteriori.
--
-- `marca_temporale_token` è il token RFC 3161 in base64 (DER). `marca_temporale_impronta`
-- è l'impronta SHA-256 esatta inviata alla TSA, in hex: serve a verificare il token senza
-- ricostruire il sigillo. `marca_temporale_token_hash` è lo SHA-256 del token, per
-- accorgersi se il valore memorizzato viene alterato.
--
-- `marca_temporale_errore` registra perché la marca non c'è. La firma non fallisce mai
-- per un disservizio della TSA: il campo dice cosa è successo, e il verbale lo riporta.

ALTER TABLE "firma_elettronica"
  ADD COLUMN "marca_temporale_token" TEXT,
  ADD COLUMN "marca_temporale_impronta" TEXT,
  ADD COLUMN "marca_temporale_tsa" TEXT,
  ADD COLUMN "marca_temporale_gen_time" TIMESTAMP(3),
  ADD COLUMN "marca_temporale_policy" TEXT,
  ADD COLUMN "marca_temporale_serial" TEXT,
  ADD COLUMN "marca_temporale_token_hash" TEXT,
  ADD COLUMN "marca_temporale_errore" TEXT,
  ADD COLUMN "marca_temporale_richiesta_at" TIMESTAMP(3);
