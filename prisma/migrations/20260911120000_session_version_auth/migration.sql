-- Revoca versionata delle sessioni staff e cliente.
ALTER TABLE "user"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "cliente"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
