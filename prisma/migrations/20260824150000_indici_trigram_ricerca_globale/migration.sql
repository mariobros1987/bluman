-- Ricerca globale (Blocco 4): indici trigramma (pg_trgm) per velocizzare
-- le ILIKE '%q%' sulle colonne di testo indicizzate.
--
-- Difensiva in due livelli:
-- 1. Se il ruolo non ha i privilegi o l'estensione non è disponibile, la
--    CREATE EXTENSION viene ignorata invece di far fallire la migrazione.
-- 2. Gli indici vengono creati SOLO se l'estensione risulta effettivamente
--    installata. In sua assenza la ricerca funziona comunque (seq scan
--    ILIKE), solo più lenta su dataset grandi — non è un blocco funzionale.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    -- Clienti: nome, email, partita IVA
    CREATE INDEX IF NOT EXISTS idx_cliente_nome_trgm ON "cliente" USING GIN ("nome" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_cliente_email_trgm ON "cliente" USING GIN ("email" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_cliente_piva_trgm ON "cliente" USING GIN ("piva" gin_trgm_ops);

    -- Progetti: nome, numero lettera d'incarico
    CREATE INDEX IF NOT EXISTS idx_progetto_nome_trgm ON "progetto" USING GIN ("nome" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_progetto_numero_contratto_trgm ON "progetto" USING GIN ("numero_contratto" gin_trgm_ops);

    -- Fatture: numero documento ("FT-2026/001")
    CREATE INDEX IF NOT EXISTS idx_fattura_numero_trgm ON "fattura" USING GIN ("numero" gin_trgm_ops);

    -- Documenti: fileUrl (contiene il nome del file)
    CREATE INDEX IF NOT EXISTS idx_documento_file_url_trgm ON "documento" USING GIN ("file_url" gin_trgm_ops);

    -- Team studio: nome, email
    CREATE INDEX IF NOT EXISTS idx_user_nome_trgm ON "user" USING GIN ("nome" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_user_email_trgm ON "user" USING GIN ("email" gin_trgm_ops);

    -- Calendario: titolo evento
    CREATE INDEX IF NOT EXISTS idx_evento_titolo_trgm ON "evento_calendario" USING GIN ("titolo" gin_trgm_ops);

    -- Contratti retainer: titolo
    CREATE INDEX IF NOT EXISTS idx_contratto_titolo_trgm ON "contratto_ricorrente" USING GIN ("titolo" gin_trgm_ops);
  END IF;
END $$;
