-- Punto 3 piano gap — Integrità referenziale firme: soft-delete obbligatorio.
-- Un documento (o engagement letter) collegato a una FirmaElettronica non viene mai
-- cancellato fisicamente: l'applicazione lo archivia (is_archiviato) e le liste
-- operative lo escludono. Migrazione additiva: colonne nullable/default, zero downtime.

ALTER TABLE "documento" ADD COLUMN "is_archiviato" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documento" ADD COLUMN "archiviato_at" TIMESTAMP(3);
ALTER TABLE "documento" ADD COLUMN "archiviato_da_id" TEXT;

ALTER TABLE "engagement_letter" ADD COLUMN "is_archiviato" BOOLEAN NOT NULL DEFAULT false;
