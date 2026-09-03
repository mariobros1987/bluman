-- ============================================================
-- BluMan — Migration 003: Colmare i gap della Fase 1
-- ============================================================

-- 1. Aggiungere stato a user (attivo, invitato, disattivato)
CREATE TYPE stato_utente AS ENUM ('invitato', 'attivo', 'disattivato');

ALTER TABLE "user"
ADD COLUMN stato stato_utente NOT NULL DEFAULT 'invitato';

-- 2. Aggiungere prezzo_pacchetto a modulo_template
ALTER TABLE modulo_template
ADD COLUMN prezzo_pacchetto NUMERIC(12,2);

-- 3. Aggiungere segnale_rischio, ore_extra a microvoce_progetto
ALTER TABLE microvoce_progetto
ADD COLUMN segnale_rischio BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN ore_extra NUMERIC(6,2) NOT NULL DEFAULT 0;

-- 4. Aggiungere stato_scansione, scansionato_at a documento
CREATE TYPE stato_scansione AS ENUM ('in_attesa', 'pulito', 'infetto');

ALTER TABLE documento
ADD COLUMN stato_scansione stato_scansione NOT NULL DEFAULT 'in_attesa',
ADD COLUMN scansionato_at TIMESTAMPTZ;

-- 5. Aggiungere campi SDI a fattura + numero_progressivo
CREATE TYPE canale_fattura AS ENUM ('standard', 'sdi');
CREATE TYPE stato_sdi AS ENUM ('non_inviata', 'inviata', 'consegnata', 'scartata');
CREATE TYPE tipo_cliente_fiscale AS ENUM ('b2b', 'b2c', 'pa', 'estero');

ALTER TABLE fattura
ADD COLUMN tipo_cliente_fiscale tipo_cliente_fiscale NOT NULL DEFAULT 'b2b',
ADD COLUMN partita_iva TEXT,
ADD COLUMN codice_fiscale TEXT,
ADD COLUMN numero_progressivo INTEGER,
ADD COLUMN canale canale_fattura NOT NULL DEFAULT 'standard',
ADD COLUMN stato_sdi stato_sdi NOT NULL DEFAULT 'non_inviata',
ADD COLUMN xml_fatturapa_url TEXT;

-- Garantire l'unicità del numero_progressivo per tenant (usato per l'invio SDI)
CREATE UNIQUE INDEX idx_fattura_progressivo_tenant ON fattura(tenant_id, numero_progressivo) WHERE numero_progressivo IS NOT NULL;

-- 6. Creare tabella accesso_risorsa (Permessi granulari §19)
CREATE TYPE tipo_risorsa AS ENUM ('progetto', 'modulo_progetto', 'documento');
CREATE TYPE livello_accesso AS ENUM ('lettura', 'scrittura');

CREATE TABLE accesso_risorsa (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    tipo_risorsa        tipo_risorsa NOT NULL,
    risorsa_id          UUID NOT NULL,
    livello             livello_accesso NOT NULL DEFAULT 'lettura',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(user_id, tipo_risorsa, risorsa_id)
);

CREATE INDEX idx_accesso_risorsa_tenant ON accesso_risorsa(tenant_id);
CREATE INDEX idx_accesso_risorsa_user ON accesso_risorsa(user_id);
CREATE INDEX idx_accesso_risorsa_risorsa ON accesso_risorsa(tipo_risorsa, risorsa_id);

ALTER TABLE accesso_risorsa ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accesso_risorsa
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

-- (Opzionale: non creo articolo e riga_distinta per aderire strettamente ad AGENTS.md che usa microvoce_template come unica distinzione base)

