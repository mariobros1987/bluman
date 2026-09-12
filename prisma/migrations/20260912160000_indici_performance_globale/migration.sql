-- Migration: 20260912160000_indici_performance_globale
-- Obiettivo: indici compositi e selettivi per velocizzare le restanti aree della piattaforma:
-- Clienti, Fatture attive, Righe fattura, Scadenzario incassi, Ciclo passivo (Fornitori e Fatture acquisto),
-- Vault/Archivio Documenti e Contratti ricorrenti (Retainers).
-- Sicuri da rieseguire con IF NOT EXISTS.

-- ─── 1. Cliente ─────────────────────────────────────────────────────────────
-- Query paginazione/ordinamento e dropdown anagrafica clienti:
CREATE INDEX IF NOT EXISTS idx_cliente_tenant_created
  ON cliente (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cliente_tenant_nome
  ON cliente (tenant_id, nome);

-- ─── 2. Fattura (Ciclo Attivo) ──────────────────────────────────────────────
-- Query registro fatture con ordinamento progressivo serie:
CREATE INDEX IF NOT EXISTS idx_fattura_tenant_prog_serie
  ON fattura (tenant_id, numero_progressivo_serie DESC);

-- Filtri per stato e aggregazioni KPI (emesso, incassato, sospeso):
CREATE INDEX IF NOT EXISTS idx_fattura_tenant_stato
  ON fattura (tenant_id, stato);

CREATE INDEX IF NOT EXISTS idx_fattura_tenant_tipo_stato
  ON fattura (tenant_id, tipo_documento, stato);

-- ─── 3. FatturaRiga & ScadenzaIncasso (Relazioni Fattura) ───────────────────
-- Lettura righe e rate quando si apre o si elabora una fattura:
CREATE INDEX IF NOT EXISTS idx_fattura_riga_tenant_fattura
  ON fattura_riga (tenant_id, fattura_id);

CREATE INDEX IF NOT EXISTS idx_scadenza_incasso_tenant_fattura
  ON scadenza_incasso (tenant_id, fattura_id);

-- ─── 4. Fornitore & FatturaRicevuta (Ciclo Passivo) ─────────────────────────
-- Elenco fornitori ordinato e autocompletamento:
CREATE INDEX IF NOT EXISTS idx_fornitore_tenant_ragione
  ON fornitore (tenant_id, ragione_sociale);

-- Elenco fatture d'acquisto per data e filtro pagata per scadenziario/LIPE:
CREATE INDEX IF NOT EXISTS idx_fattura_ricevuta_tenant_data
  ON fattura_ricevuta (tenant_id, data DESC);

CREATE INDEX IF NOT EXISTS idx_fattura_ricevuta_tenant_pagata
  ON fattura_ricevuta (tenant_id, pagata);

-- ─── 5. Documento (Vault & Archivio) ────────────────────────────────────────
-- Query albero archivio / fascicolo progetto escludendo gli archiviati:
CREATE INDEX IF NOT EXISTS idx_documento_tenant_progetto_archiviato
  ON documento (tenant_id, progetto_id, is_archiviato);

CREATE INDEX IF NOT EXISTS idx_documento_tenant_created
  ON documento (tenant_id, created_at DESC);

-- ─── 6. ContrattoRicorrente (Retainers) ─────────────────────────────────────
-- Filtro per cliente e cron schedulatore prossima fatturazione:
CREATE INDEX IF NOT EXISTS idx_contratto_ricorrente_tenant_cliente
  ON contratto_ricorrente (tenant_id, cliente_id);

CREATE INDEX IF NOT EXISTS idx_contratto_ricorrente_tenant_prossima
  ON contratto_ricorrente (tenant_id, prossima_fatturazione);
