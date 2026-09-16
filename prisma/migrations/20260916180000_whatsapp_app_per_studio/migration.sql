-- WhatsApp in ingresso: ogni studio porta la propria app Meta.
--
-- Il problema che questa migrazione sblocca. Meta configura la Callback URL e il Verify Token
-- **per applicazione**, non per numero di telefono: finché l'app era una sola, erano valori di
-- piattaforma e `WA_APP_SECRET` non esisteva nemmeno su Railway. Risultato misurato il
-- 16/09/2026: `POST /webhooks/communications/whatsapp` rispondeva 503 a ogni evento, cioè
-- nessun messaggio WhatsApp è mai entrato. Uno studio non poteva aggiungere il proprio numero
-- senza passare dall'app di un altro.
--
-- Con un'app per studio servono, sulla riga dello studio, l'App ID, l'App Secret (la chiave che
-- verifica la firma `X-Hub-Signature-256`) e il nome del template di autenticazione, che vive
-- nell'app che lo ha fatto approvare. `wa_verify_token` esiste già e resta dov'è: cambia solo
-- che ora viene letto al posto della variabile d'ambiente.
--
-- Perché uno slug nel path. L'App Secret è per studio, quindi la firma non si può verificare
-- prima di sapere di chi è il messaggio: l'ordine si inverte e lo studio va dedotto dall'URL.
-- `wa_webhook_slug` è quel discriminante. È generato **dal database** e non da un file
-- versionato: finirebbe altrimenti in un repository pubblico, dove chiunque lo leggesse
-- potrebbe indovinare il path di callback di uno studio.
--
-- 32 caratteri esadecimali da `gen_random_uuid()`, funzione nativa (PostgreSQL 13+, quindi
-- anche sul Postgres 16 dell'ambiente E2E): nessuna estensione da installare.
--
-- Nota: la colonna è NULL-abile e l'indice è UNIQUE. In PostgreSQL più NULL convivono sotto un
-- indice unico, quindi uno studio che non usa WhatsApp resta senza slug senza disturbare gli
-- altri. Nulla viene cancellato da questa migrazione: è solo aggiunta di colonne e riempimento
-- di una colonna appena creata.

ALTER TABLE "tenant" ADD COLUMN "wa_app_id" TEXT;
ALTER TABLE "tenant" ADD COLUMN "wa_app_secret" TEXT;
ALTER TABLE "tenant" ADD COLUMN "wa_webhook_slug" TEXT;
ALTER TABLE "tenant" ADD COLUMN "wa_otp_template" TEXT;
ALTER TABLE "tenant" ADD COLUMN "wa_otp_template_lang" TEXT;

UPDATE "tenant"
SET "wa_webhook_slug" = replace(gen_random_uuid()::text, '-', '')
WHERE "wa_webhook_slug" IS NULL;

CREATE UNIQUE INDEX "tenant_wa_webhook_slug_key" ON "tenant"("wa_webhook_slug");
