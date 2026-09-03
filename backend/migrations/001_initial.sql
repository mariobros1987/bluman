-- ============================================================
-- BluMan — Migration 001: Schema DB Completo
-- PostgreSQL / Supabase
-- Eseguire su: Supabase SQL Editor (dashboard.supabase.com)
-- ============================================================

-- Abilita estensioni necessarie
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- per gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- per ricerca testo

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE ruolo_utente AS ENUM (
    'super_admin',
    'advisor',
    'collaboratore_interno',
    'collaboratore_esterno',
    'cliente'
);

CREATE TYPE stato_tenant AS ENUM ('trial', 'attivo', 'sospeso');

CREATE TYPE tipo_cliente AS ENUM ('individual', 'company');

CREATE TYPE stato_preventivo AS ENUM ('bozza', 'inviato', 'accettato', 'rifiutato');

CREATE TYPE stato_firma AS ENUM ('in_attesa', 'inviata', 'firmata', 'rifiutata', 'scaduta');

CREATE TYPE stato_progetto AS ENUM ('pre_project', 'in_progress', 'completed', 'archiviato');

CREATE TYPE stato_modulo AS ENUM (
    'pending',
    'in_progress',
    'delayed',
    'blocked',
    'completed'
);

CREATE TYPE stato_microvoce AS ENUM (
    'pending',
    'attesa_dipendenza',
    'active',
    'at_risk',
    'delayed',
    'blocked',
    'done'
);

CREATE TYPE tipo_documento AS ENUM ('template_vuoto', 'compilato', 'firmato');

CREATE TYPE stato_fattura AS ENUM ('bozza', 'emessa', 'incassata');

CREATE TYPE tipo_fattura_riga AS ENUM ('modulo_completo', 'modulo_parziale', 'milestone_libera');

CREATE TYPE canale_notifica AS ENUM ('email', 'in_app');

CREATE TYPE destinatario_tipo AS ENUM ('user', 'cliente');

-- ============================================================
-- TENANT
-- ============================================================

CREATE TABLE tenant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ragione_sociale TEXT NOT NULL,
    piano           TEXT NOT NULL DEFAULT 'trial',   -- trial | base | pro
    stato           stato_tenant NOT NULL DEFAULT 'trial',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USER
-- Nota: Supabase Auth gestisce l'autenticazione in auth.users.
-- Questa tabella è il profilo applicativo collegato a auth.users.
-- tenant_id è NULL per super_admin.
-- ============================================================

CREATE TABLE "user" (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id   UUID REFERENCES tenant(id) ON DELETE CASCADE,   -- NULL se super_admin
    nome        TEXT NOT NULL,
    email       TEXT NOT NULL,
    ruolo       ruolo_utente NOT NULL DEFAULT 'collaboratore_interno',
    colore      TEXT DEFAULT '#6366f1',   -- avatar color
    avatar_ini  TEXT,                     -- es. "JD"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT user_tenant_check CHECK (
        (ruolo = 'super_admin' AND tenant_id IS NULL) OR
        (ruolo != 'super_admin' AND tenant_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_tenant ON "user"(tenant_id);

-- ============================================================
-- CLIENTE
-- ============================================================

CREATE TABLE cliente (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nome        TEXT NOT NULL,
    tipo        tipo_cliente NOT NULL DEFAULT 'individual',
    email       TEXT,
    telefono    TEXT,
    note        TEXT,
    referenti   JSONB DEFAULT '[]',   -- [{nome, email, ruolo}]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cliente_tenant ON cliente(tenant_id);

-- ============================================================
-- LIBRERIA MODULI (Template — per tenant, versionati)
-- ============================================================

CREATE TABLE modulo_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nome                TEXT NOT NULL,
    categoria           TEXT NOT NULL,   -- Analisi | Societario | Trust | Banking | Fiscale | Legale | IP | Compliance
    versione            INTEGER NOT NULL DEFAULT 1,
    is_ultima_versione  BOOLEAN NOT NULL DEFAULT true,
    ore_default         NUMERIC(6,2) NOT NULL DEFAULT 0,
    prezzo_default      NUMERIC(12,2) NOT NULL DEFAULT 0,
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_modulo_template_tenant ON modulo_template(tenant_id);
CREATE INDEX idx_modulo_template_ultima ON modulo_template(tenant_id, is_ultima_versione);

CREATE TABLE microvoce_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    modulo_template_id  UUID NOT NULL REFERENCES modulo_template(id) ON DELETE CASCADE,
    nome                TEXT NOT NULL,
    ordine              INTEGER NOT NULL DEFAULT 0,
    ore_default         NUMERIC(6,2) NOT NULL DEFAULT 0,
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_microvoce_template_modulo ON microvoce_template(modulo_template_id);

-- ============================================================
-- GRAFO DIPENDENZE (Template)
-- DAG diretto: modulo X dipende da modulo Y.
-- Verifica anti-ciclo applicata a livello applicativo.
-- ============================================================

CREATE TABLE modulo_dipendenza_template (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    modulo_template_id              UUID NOT NULL REFERENCES modulo_template(id) ON DELETE CASCADE,
    dipende_da_modulo_template_id   UUID NOT NULL REFERENCES modulo_template(id) ON DELETE CASCADE,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT no_self_dep CHECK (modulo_template_id != dipende_da_modulo_template_id),
    UNIQUE (modulo_template_id, dipende_da_modulo_template_id)
);

CREATE INDEX idx_dep_template_tenant ON modulo_dipendenza_template(tenant_id);
CREATE INDEX idx_dep_template_modulo ON modulo_dipendenza_template(modulo_template_id);

-- ============================================================
-- PREVENTIVO
-- ============================================================

CREATE TABLE preventivo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cliente_id      UUID NOT NULL REFERENCES cliente(id),
    creato_da       UUID NOT NULL REFERENCES "user"(id),
    stato           stato_preventivo NOT NULL DEFAULT 'bozza',
    titolo          TEXT,
    note            TEXT,
    valore_totale   NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- righe = snapshot dei moduli selezionati con prezzi al momento del preventivo
    righe           JSONB NOT NULL DEFAULT '[]',
    -- [{modulo_template_id, modulo_template_versione, nome, ore, prezzo_proposto}]
    inviato_at      TIMESTAMPTZ,
    accettato_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preventivo_tenant ON preventivo(tenant_id);
CREATE INDEX idx_preventivo_cliente ON preventivo(cliente_id);
CREATE INDEX idx_preventivo_stato ON preventivo(tenant_id, stato);

-- ============================================================
-- ENGAGEMENT LETTER
-- Generata automaticamente quando il preventivo viene accettato.
-- ============================================================

CREATE TABLE engagement_letter (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    preventivo_id   UUID NOT NULL REFERENCES preventivo(id),
    progetto_id     UUID,  -- popolato dopo la creazione del progetto (FK aggiunto sotto)
    stato_firma     stato_firma NOT NULL DEFAULT 'in_attesa',
    -- DocuSign
    docusign_envelope_id    TEXT,
    docusign_signing_url    TEXT,
    -- Tracciamento
    inviata_at      TIMESTAMPTZ,
    firmata_at      TIMESTAMPTZ,
    -- Storage: URL del PDF generato
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_el_tenant ON engagement_letter(tenant_id);
CREATE INDEX idx_el_preventivo ON engagement_letter(preventivo_id);

-- ============================================================
-- PROGETTO
-- Creato automaticamente all'accettazione del preventivo.
-- ============================================================

CREATE TABLE progetto (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cliente_id      UUID NOT NULL REFERENCES cliente(id),
    preventivo_id   UUID REFERENCES preventivo(id),   -- riferimento al preventivo di origine
    nome            TEXT NOT NULL,
    stato           stato_progetto NOT NULL DEFAULT 'pre_project',
    data_inizio     DATE,
    data_scadenza   DATE,
    valore_totale   NUMERIC(12,2) NOT NULL DEFAULT 0,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aggiunge FK su engagement_letter ora che progetto esiste
ALTER TABLE engagement_letter
    ADD CONSTRAINT fk_el_progetto
    FOREIGN KEY (progetto_id) REFERENCES progetto(id);

CREATE INDEX idx_progetto_tenant ON progetto(tenant_id);
CREATE INDEX idx_progetto_cliente ON progetto(cliente_id);
CREATE INDEX idx_progetto_stato ON progetto(tenant_id, stato);

-- ============================================================
-- MODULO PROGETTO (Istanza)
-- Copia congelata del template al momento della creazione.
-- ============================================================

CREATE TABLE modulo_progetto (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    progetto_id                 UUID NOT NULL REFERENCES progetto(id) ON DELETE CASCADE,
    -- Riferimento congelato al template (non cambia se il template evolve)
    modulo_template_id          UUID REFERENCES modulo_template(id),
    modulo_template_versione    INTEGER,
    -- Dati istanza (personalizzabili rispetto al template)
    nome                        TEXT NOT NULL,
    categoria                   TEXT NOT NULL,
    prezzo                      NUMERIC(12,2) NOT NULL DEFAULT 0,
    stato                       stato_modulo NOT NULL DEFAULT 'pending',
    ore_preventivate            NUMERIC(6,2) NOT NULL DEFAULT 0,
    ore_consuntivate            NUMERIC(6,2) NOT NULL DEFAULT 0,
    -- Avanzamento calcolato (media pesata micro-voci) — aggiornato dal motore stati
    avanzamento_pct             NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Importo già fatturato su questo modulo
    importo_fatturato           NUMERIC(12,2) NOT NULL DEFAULT 0,
    ordine                      INTEGER NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_modulo_prog_tenant ON modulo_progetto(tenant_id);
CREATE INDEX idx_modulo_prog_progetto ON modulo_progetto(progetto_id);

-- Team assegnato al modulo (relazione N:N user <-> modulo_progetto)
CREATE TABLE modulo_progetto_team (
    modulo_progetto_id  UUID NOT NULL REFERENCES modulo_progetto(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    PRIMARY KEY (modulo_progetto_id, user_id)
);

-- ============================================================
-- MICRO-VOCE PROGETTO (Istanza)
-- ============================================================

CREATE TABLE microvoce_progetto (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    modulo_progetto_id  UUID NOT NULL REFERENCES modulo_progetto(id) ON DELETE CASCADE,
    nome                TEXT NOT NULL,
    ordine              INTEGER NOT NULL DEFAULT 0,
    ore_preventivate    NUMERIC(6,2) NOT NULL DEFAULT 0,
    ore_consuntivate    NUMERIC(6,2) NOT NULL DEFAULT 0,
    stato               stato_microvoce NOT NULL DEFAULT 'pending',
    -- Nota obbligatoria quando stato = delayed o blocked
    causa_nota          TEXT,
    -- Risorsa assegnata
    risorsa_id          UUID REFERENCES "user"(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_microvoce_prog_tenant ON microvoce_progetto(tenant_id);
CREATE INDEX idx_microvoce_prog_modulo ON microvoce_progetto(modulo_progetto_id);

-- ============================================================
-- GRAFO DIPENDENZE PROGETTO (copia congelata dal template)
-- ============================================================

CREATE TABLE modulo_progetto_dipendenza (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    modulo_progetto_id          UUID NOT NULL REFERENCES modulo_progetto(id) ON DELETE CASCADE,
    dipende_da_modulo_progetto_id UUID NOT NULL REFERENCES modulo_progetto(id) ON DELETE CASCADE,

    CONSTRAINT no_self_dep_prog CHECK (modulo_progetto_id != dipende_da_modulo_progetto_id),
    UNIQUE (modulo_progetto_id, dipende_da_modulo_progetto_id)
);

CREATE INDEX idx_dep_prog_tenant ON modulo_progetto_dipendenza(tenant_id);

-- ============================================================
-- DOCUMENTO
-- ============================================================

CREATE TABLE documento (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    microvoce_progetto_id   UUID REFERENCES microvoce_progetto(id) ON DELETE SET NULL,
    progetto_id             UUID REFERENCES progetto(id) ON DELETE CASCADE,
    tipo                    tipo_documento NOT NULL DEFAULT 'compilato',
    nome_file               TEXT NOT NULL,
    file_url                TEXT NOT NULL,   -- Supabase Storage URL
    mime_type               TEXT,
    dimensione_bytes        BIGINT,
    versione                INTEGER NOT NULL DEFAULT 1,
    caricato_da             UUID REFERENCES "user"(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documento_tenant ON documento(tenant_id);
CREATE INDEX idx_documento_progetto ON documento(progetto_id);
CREATE INDEX idx_documento_microvoce ON documento(microvoce_progetto_id);

-- ============================================================
-- FATTURA
-- ============================================================

CREATE TABLE fattura (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    progetto_id     UUID NOT NULL REFERENCES progetto(id),
    cliente_id      UUID NOT NULL REFERENCES cliente(id),
    numero          TEXT NOT NULL,
    data_fattura    DATE NOT NULL DEFAULT CURRENT_DATE,
    stato           stato_fattura NOT NULL DEFAULT 'bozza',
    totale          NUMERIC(12,2) NOT NULL DEFAULT 0,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, numero)
);

CREATE INDEX idx_fattura_tenant ON fattura(tenant_id);
CREATE INDEX idx_fattura_progetto ON fattura(progetto_id);

CREATE TABLE fattura_riga (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    fattura_id          UUID NOT NULL REFERENCES fattura(id) ON DELETE CASCADE,
    tipo                tipo_fattura_riga NOT NULL,
    -- Riferimento al modulo (NULL se milestone_libera)
    modulo_progetto_id  UUID REFERENCES modulo_progetto(id),
    -- Usato se tipo = modulo_parziale
    percentuale         NUMERIC(5,2),
    importo             NUMERIC(12,2) NOT NULL,
    descrizione         TEXT NOT NULL,
    ordine              INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT riga_modulo_check CHECK (
        (tipo = 'milestone_libera' AND modulo_progetto_id IS NULL) OR
        (tipo != 'milestone_libera' AND modulo_progetto_id IS NOT NULL)
    ),
    CONSTRAINT riga_pct_check CHECK (
        (tipo = 'modulo_parziale' AND percentuale IS NOT NULL AND percentuale > 0 AND percentuale <= 100) OR
        (tipo != 'modulo_parziale')
    )
);

CREATE INDEX idx_fattura_riga_fattura ON fattura_riga(fattura_id);
CREATE INDEX idx_fattura_riga_modulo ON fattura_riga(modulo_progetto_id);

-- ============================================================
-- EVENTO CALENDARIO
-- ============================================================

CREATE TABLE evento_calendario (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES "user"(id),
    progetto_id UUID REFERENCES progetto(id) ON DELETE SET NULL,
    titolo      TEXT NOT NULL,
    descrizione TEXT,
    data_inizio TIMESTAMPTZ NOT NULL,
    data_fine   TIMESTAMPTZ,
    tutto_giorno BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evento_tenant ON evento_calendario(tenant_id);
CREATE INDEX idx_evento_user ON evento_calendario(user_id);

-- ============================================================
-- NOTIFICA
-- ============================================================

CREATE TABLE notifica (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    destinatario_id     UUID NOT NULL,   -- user_id oppure cliente_id
    destinatario_tipo   destinatario_tipo NOT NULL,
    canale              canale_notifica NOT NULL DEFAULT 'email',
    oggetto             TEXT NOT NULL,
    corpo               TEXT NOT NULL,
    letta               BOOLEAN NOT NULL DEFAULT false,
    inviata_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifica_tenant ON notifica(tenant_id);
CREATE INDEX idx_notifica_dest ON notifica(destinatario_id);

-- ============================================================
-- FUNZIONE updated_at automatico
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applica a tutte le tabelle con updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tenant', '"user"', 'cliente',
        'modulo_template', 'preventivo', 'engagement_letter',
        'progetto', 'modulo_progetto', 'microvoce_progetto',
        'fattura'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER set_updated_at
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
            t
        );
    END LOOP;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Il backend usa service_role key (bypassa RLS).
-- Il frontend NON accede mai direttamente al DB (passa per FastAPI).
-- RLS è qui come difesa in profondità — nel caso di bug che esponga
-- il DB direttamente, nessun tenant può vedere dati di altri.
-- ============================================================

ALTER TABLE cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE progetto ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_progetto ENABLE ROW LEVEL SECURITY;
ALTER TABLE microvoce_progetto ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE fattura ENABLE ROW LEVEL SECURITY;
ALTER TABLE fattura_riga ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifica ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_calendario ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE microvoce_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_dipendenza_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_progetto_dipendenza ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_progetto_team ENABLE ROW LEVEL SECURITY;

-- Policy di base: un utente vede solo dati del proprio tenant
-- (tenant_id estratto dal JWT Supabase tramite app_metadata)
-- Nota: queste policy si attivano solo per chiamate con anon/authenticated role,
-- non per service_role (che le bypassa sempre).

CREATE POLICY tenant_isolation ON cliente
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON preventivo
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON progetto
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON modulo_progetto
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON microvoce_progetto
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON fattura
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON documento
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

CREATE POLICY tenant_isolation ON modulo_template
    USING (tenant_id = ((auth.jwt()->'app_metadata'->>'tenant_id')::UUID));

-- ============================================================
-- DATI SEED — Tenant demo Bluecode Ltd
-- (da eseguire solo in ambiente di sviluppo)
-- ============================================================

-- Decommenta per inserire il tenant demo:
/*
INSERT INTO tenant (id, ragione_sociale, piano, stato)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Bluecode Ltd',
    'pro',
    'attivo'
);
*/

-- ============================================================
-- FINE MIGRATION 001
-- ============================================================
