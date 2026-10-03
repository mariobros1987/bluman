-- Piano firma §8.1 (decisioni del titolare, 03/10/2026) — la controfirma bidirezionale resa
-- integra: la PARTE che ha firmato scritta nel dato, e il sigillo di QUELLA firma persistito.
-- ADDITIVA: due colonne nuove, nessuna colonna riscritta, nessuna riga cancellata.
--
-- Perché una colonna di parte. Finora la parte si deduceva dalla stringa, con due letture
-- diverse e nessuna affidabile: `tipo_firma = 'studio'` (vero solo per il canale grafometrico)
-- oppure `canale_verificato LIKE '%Studio%'`. La firma dello studio con file caricato non
-- soddisfa né l'una né l'altra — scrive `tipo_firma` = 'manuale_scansionata'/'qualificata_esterna'
-- e canale 'Firma Digitale Qualificata Esterna' / 'Copia Cartacea Controfirmata'
-- (`documentiFirmaStudio.ts`) — quindi passava per firma del CLIENTE: nel PDF finale la sua
-- riga di attestazione diceva «Cliente», e l'anti-ri-firma dello studio non la vedeva, così se
-- ne poteva fare una seconda. Da qui in poi la parte la scrivono le rotte al momento della firma.

ALTER TABLE "firma_elettronica" ADD COLUMN IF NOT EXISTS "parte" TEXT NOT NULL DEFAULT 'cliente';
ALTER TABLE "firma_elettronica" ADD COLUMN IF NOT EXISTS "sigillo_digest" TEXT;

-- Backfill, una volta sola e in chiaro: è l'ultima volta che la parte si deduce.
-- 1) `tipo_firma = 'studio'`: la marca esplicita del canale grafometrico/OTP dello studio.
UPDATE "firma_elettronica" SET "parte" = 'studio' WHERE "tipo_firma" = 'studio';

-- 2) La firma dello studio via FILE, che la deduzione vecchia sbagliava. Il riconoscimento è
--    esatto e non euristico: quelle due stringhe di canale le scrive solo il ramo file della
--    rotta `/documenti/:id/firma-studio` (le firme cliente da file portano invece il periodo
--    lungo «Documento scaricato, sottoscritto a mano…» / «Documento sottoscritto con firma
--    digitale qualificata di provider esterno…», più il dettaglio OTP). Assegnarle 'studio'
--    non cambia la storia: la rotta che le ha create è la rotta dello studio, ed è chiusa al
--    ruolo advisor/super_admin. Le righe restano intatte in ogni altro campo.
UPDATE "firma_elettronica" SET "parte" = 'studio'
WHERE "tipo_firma" IN ('manuale_scansionata', 'qualificata_esterna')
  AND "canale_verificato" IN ('Firma Digitale Qualificata Esterna', 'Copia Cartacea Controfirmata');

-- Nessun backfill per `sigillo_digest`: l'impronta HMAC non è ricostruibile a posteriori
-- (il payload include IP, sessione e istante della firma). Resta NULL per le firme anteriori
-- a oggi, e chi la stampa scrive «non registrato» invece di prendere in prestito il sigillo
-- di un'altra firma (§8.1: è esattamente il difetto che questa migrazione chiude).

-- Indice per le letture per parte su un documento del Vault (copia firmata, cronologia,
-- anti-ri-firma: filtrano tutte per tenant + ambito + riferimento). Il nome è quello che
-- genera Prisma dalla `@@index` dichiarata nello schema, così non c'è deriva fra i due.
CREATE INDEX IF NOT EXISTS "firma_elettronica_tenant_id_ambito_riferimento_id_parte_idx"
  ON "firma_elettronica" ("tenant_id", "ambito", "riferimento_id", "parte");
