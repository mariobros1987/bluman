-- ============================================================================
-- Migrazione: Riforma Fatturazione & Contabilità Integrata (OpenSTAManager Engine)
-- Idempotente, additiva e sicura (Zero data loss)
-- ============================================================================

-- 1. Nuovi Tipi Enum (se non esistono già)
DO $$ BEGIN
    CREATE TYPE "CondizionePagamento" AS ENUM ('immediato', 'bonifico_30gg', 'bonifico_60gg', 'bonifico_30_60gg', 'bonifico_fine_mese', 'personalizzato');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "TipoCassaPrevidenziale" AS ENUM ('nessuna', 'inps_gestione_separata', 'cassa_commercialisti', 'cassa_forense', 'inarcassa');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "EsigibilitaIva" AS ENUM ('immediata', 'differita', 'split');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "MotivoNotaCredito" AS ENUM ('errore_esposizione', 'reso_merce', 'sconto_post_fattura', 'abbuono', 'annullo_totale', 'correzione_dati');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "TipoMovimentoPrimaNota" AS ENUM ('entrata', 'uscita');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "CategoriaPrimaNota" AS ENUM ('incasso_fattura', 'pagamento_fornitore', 'imposta_tasse', 'stipendi_compensi', 'spese_generali', 'giroconto', 'altro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Aggiornamento Tabella "fattura"
ALTER TABLE "fattura"
    ALTER COLUMN "progetto_id" DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS "cliente_id" TEXT,
    ADD COLUMN IF NOT EXISTS "preventivo_id" TEXT,
    ADD COLUMN IF NOT EXISTS "contratto_ricorrente_id" TEXT,
    ADD COLUMN IF NOT EXISTS "condizione_pagamento" "CondizionePagamento" NOT NULL DEFAULT 'bonifico_30gg',
    ADD COLUMN IF NOT EXISTS "metodo_pagamento" "MetodoPagamento" NOT NULL DEFAULT 'bonifico',
    ADD COLUMN IF NOT EXISTS "conto_accredito_id" TEXT,
    ADD COLUMN IF NOT EXISTS "tipo_cassa" "TipoCassaPrevidenziale" NOT NULL DEFAULT 'nessuna',
    ADD COLUMN IF NOT EXISTS "aliquota_cassa" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "aliquota_ritenuta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "esigibilita_iva" "EsigibilitaIva" NOT NULL DEFAULT 'immediata',
    ADD COLUMN IF NOT EXISTS "totale_imponibile_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_cassa_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_iva_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_ritenuta_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_bollo_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_documento_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "netto_a_pagare_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "fattura_origine_id" TEXT,
    ADD COLUMN IF NOT EXISTS "motivo_nota_credito" "MotivoNotaCredito",
    ADD COLUMN IF NOT EXISTS "conservazione_riferimento" TEXT,
    ADD COLUMN IF NOT EXISTS "conservazione_data_invio" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "note" TEXT,
    ADD COLUMN IF NOT EXISTS "note_pie_pagina" TEXT,
    ADD COLUMN IF NOT EXISTS "codice_destinatario" TEXT,
    ADD COLUMN IF NOT EXISTS "pec_destinatario" TEXT,
    ADD COLUMN IF NOT EXISTS "esito_sdi_dettagli" TEXT,
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Popolamento sicuro di cliente_id per fatture esistenti tramite progetto.cliente_id
UPDATE "fattura" f
SET "cliente_id" = p."cliente_id"
FROM "progetto" p
WHERE f."progetto_id" = p."id" AND f."cliente_id" IS NULL;

-- 3. Aggiornamento Tabella "fattura_riga"
ALTER TABLE "fattura_riga"
    ADD COLUMN IF NOT EXISTS "articolo_id" TEXT,
    ADD COLUMN IF NOT EXISTS "quantita" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS "unita_misura" TEXT NOT NULL DEFAULT 'ore',
    ADD COLUMN IF NOT EXISTS "prezzo_unitario_cent" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "sconto_percentuale" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "aliquota_iva" INTEGER NOT NULL DEFAULT 22,
    ADD COLUMN IF NOT EXISTS "natura_esenzione" TEXT,
    ADD COLUMN IF NOT EXISTS "applica_cassa" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "applica_ritenuta" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "applica_bollo" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "imponibile_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "iva_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totale_riga_centesimi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "ordine" INTEGER NOT NULL DEFAULT 1;

-- 4. Nuova Tabella "audit_log_fattura"
CREATE TABLE IF NOT EXISTS "audit_log_fattura" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "fattura_id" TEXT NOT NULL,
    "utente_id" TEXT,
    "azione" TEXT NOT NULL,
    "dettagli" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_fattura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "audit_log_fattura_fattura_id_fkey" FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "audit_log_fattura_tenant_id_fattura_id_idx" ON "audit_log_fattura"("tenant_id", "fattura_id");

-- 5. Nuova Tabella "fornitore"
CREATE TABLE IF NOT EXISTS "fornitore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "ragione_sociale" TEXT NOT NULL,
    "partita_iva" TEXT,
    "codice_fiscale" TEXT,
    "email" TEXT,
    "pec" TEXT,
    "sdi_code" TEXT,
    "indirizzo" TEXT,
    "citta" TEXT,
    "cap" TEXT,
    "nazione" TEXT DEFAULT 'IT',
    "iban" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fornitore_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "fornitore_tenant_id_idx" ON "fornitore"("tenant_id");

-- 6. Nuova Tabella "fattura_ricevuta"
CREATE TABLE IF NOT EXISTS "fattura_ricevuta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "fornitore_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "imponibile_centesimi" INTEGER NOT NULL,
    "iva_centesimi" INTEGER NOT NULL,
    "totale_centesimi" INTEGER NOT NULL,
    "esigibilita_iva" "EsigibilitaIva" NOT NULL DEFAULT 'immediata',
    "pagata" BOOLEAN NOT NULL DEFAULT false,
    "data_pagamento" TIMESTAMP(3),
    "xml_sdi_raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fattura_ricevuta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fattura_ricevuta_fornitore_id_fkey" FOREIGN KEY ("fornitore_id") REFERENCES "fornitore"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "fattura_ricevuta_tenant_id_fornitore_id_idx" ON "fattura_ricevuta"("tenant_id", "fornitore_id");

-- 7. Nuova Tabella "liquidazione_iva"
CREATE TABLE IF NOT EXISTS "liquidazione_iva" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "iva_debito_centesimi" INTEGER NOT NULL DEFAULT 0,
    "iva_credito_centesimi" INTEGER NOT NULL DEFAULT 0,
    "saldo_centesimi" INTEGER NOT NULL DEFAULT 0,
    "versata" BOOLEAN NOT NULL DEFAULT false,
    "data_versamento" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liquidazione_iva_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidazione_iva_tenant_id_periodo_key" UNIQUE ("tenant_id", "periodo")
);

-- 8. Nuova Tabella "movimento_prima_nota"
CREATE TABLE IF NOT EXISTS "movimento_prima_nota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "conto_bancario_id" TEXT,
    "fattura_id" TEXT,
    "fattura_ricevuta_id" TEXT,
    "cliente_id" TEXT,
    "fornitore_id" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "TipoMovimentoPrimaNota" NOT NULL DEFAULT 'entrata',
    "categoria" "CategoriaPrimaNota" NOT NULL DEFAULT 'incasso_fattura',
    "descrizione" TEXT NOT NULL,
    "importo_centesimi" INTEGER NOT NULL,
    "metodo_pagamento" "MetodoPagamento" NOT NULL DEFAULT 'bonifico',
    "riferimento_transazione" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimento_prima_nota_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "movimento_prima_nota_conto_bancario_id_fkey" FOREIGN KEY ("conto_bancario_id") REFERENCES "conto_bancario"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "movimento_prima_nota_fattura_id_fkey" FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "movimento_prima_nota_fattura_ricevuta_id_fkey" FOREIGN KEY ("fattura_ricevuta_id") REFERENCES "fattura_ricevuta"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "movimento_prima_nota_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "movimento_prima_nota_fornitore_id_fkey" FOREIGN KEY ("fornitore_id") REFERENCES "fornitore"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "movimento_prima_nota_tenant_id_data_idx" ON "movimento_prima_nota"("tenant_id", "data");
CREATE INDEX IF NOT EXISTS "movimento_prima_nota_tenant_id_fattura_id_idx" ON "movimento_prima_nota"("tenant_id", "fattura_id");

-- 9. Foreign Keys e Indici Aggiuntivi su "fattura" e "fattura_riga"
DO $$ BEGIN
    ALTER TABLE "fattura" ADD CONSTRAINT "fattura_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "fattura" ADD CONSTRAINT "fattura_preventivo_id_fkey" FOREIGN KEY ("preventivo_id") REFERENCES "preventivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "fattura" ADD CONSTRAINT "fattura_contratto_ricorrente_id_fkey" FOREIGN KEY ("contratto_ricorrente_id") REFERENCES "contratto_ricorrente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "fattura" ADD CONSTRAINT "fattura_conto_accredito_id_fkey" FOREIGN KEY ("conto_accredito_id") REFERENCES "conto_bancario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "fattura" ADD CONSTRAINT "fattura_fattura_origine_id_fkey" FOREIGN KEY ("fattura_origine_id") REFERENCES "fattura"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "fattura_riga" ADD CONSTRAINT "fattura_riga_articolo_id_fkey" FOREIGN KEY ("articolo_id") REFERENCES "articolo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "fattura_tenant_id_cliente_id_idx" ON "fattura"("tenant_id", "cliente_id");
CREATE INDEX IF NOT EXISTS "fattura_tenant_id_progetto_id_idx" ON "fattura"("tenant_id", "progetto_id");
