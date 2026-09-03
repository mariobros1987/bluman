-- ============================================================
-- BluMan — Migration 002: Passaggi Procedura Guidata Microvoce
-- ============================================================

CREATE TYPE tipo_passaggio AS ENUM ('info', 'documento', 'form', 'verifica');
CREATE TYPE chi_passaggio AS ENUM ('operatore', 'cliente');
CREATE TYPE stato_passaggio AS ENUM ('pending', 'done');

-- Passaggio Template (agganciato a microvoce_template o articolo)
CREATE TABLE passaggio_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    microvoce_template_id UUID NOT NULL REFERENCES microvoce_template(id) ON DELETE CASCADE,
    titolo              TEXT NOT NULL,
    tipo                tipo_passaggio NOT NULL DEFAULT 'info',
    chi                 chi_passaggio NOT NULL DEFAULT 'operatore',
    ordine              INTEGER NOT NULL DEFAULT 0,
    descrizione         TEXT,
    campi_form_json     JSONB DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_passaggio_tpl_microvoce ON passaggio_template(microvoce_template_id);

-- Passaggio Progetto (Istanza per ciascuna microvoce di progetto)
CREATE TABLE passaggio_progetto (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    microvoce_progetto_id UUID NOT NULL REFERENCES microvoce_progetto(id) ON DELETE CASCADE,
    titolo              TEXT NOT NULL,
    tipo                tipo_passaggio NOT NULL DEFAULT 'info',
    chi                 chi_passaggio NOT NULL DEFAULT 'operatore',
    ordine              INTEGER NOT NULL DEFAULT 0,
    descrizione         TEXT,
    campi_form_json     JSONB DEFAULT '[]',
    stato               stato_passaggio NOT NULL DEFAULT 'pending',
    documento_id        UUID REFERENCES documento(id) ON DELETE SET NULL,
    risposte_form_json  JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_passaggio_prog_tenant ON passaggio_progetto(tenant_id);
CREATE INDEX idx_passaggio_prog_microvoce ON passaggio_progetto(microvoce_progetto_id);

-- RLS
ALTER TABLE passaggio_progetto ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON passaggio_progetto
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

-- Trigger updated_at
CREATE TRIGGER set_passaggio_progetto_updated_at
    BEFORE UPDATE ON passaggio_progetto
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
