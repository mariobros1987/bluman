-- Punto 2 piano gap — Verbale di firma: collegamento FirmaElettronica → Documento verbale.
-- Ogni firma completata genera un Documento (tipo 'verbale_firma') che riassume l'evento
-- probatorio in forma umana leggibile. Il campo è nullable: le firme storiche (pre-migrazione)
-- non hanno verbale e restano valide così. Migrazione additiva, zero downtime.
--
-- caricato_da diventa nullable: i documenti generati automaticamente dalla piattaforma
-- (verbale_firma) non hanno un caricatore umano — il client firmatario non è una riga
-- della tabella user e attribuire il verbale a un utente dello studio sarebbe falso.

ALTER TABLE "firma_elettronica" ADD COLUMN "verbale_documento_id" TEXT;

CREATE INDEX IF NOT EXISTS "firma_elettronica_verbale_documento_id_idx" ON "firma_elettronica"("verbale_documento_id");

ALTER TABLE "firma_elettronica" ADD CONSTRAINT "firma_elettronica_verbale_documento_id_fkey"
  FOREIGN KEY ("verbale_documento_id") REFERENCES "documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documento" ALTER COLUMN "caricato_da" DROP NOT NULL;
