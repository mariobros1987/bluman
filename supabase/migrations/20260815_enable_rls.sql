-- ====================================================================
-- BluMan Advisory — Migrazione PostgreSQL Row-Level Security (RLS)
-- Isolamento Multi-Tenant rigoroso a livello Kernel Database
-- ====================================================================

-- 1. Attivazione RLS su tutte le tabelle principali
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articolo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modulo_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "riga_distinta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progetto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modulo_progetto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "microvoce_progetto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passaggio_progetto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fattura" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fattura_riga" ENABLE ROW LEVEL SECURITY;

-- 2. Policy Isolamento Tenant per la tabella Cliente
DROP POLICY IF EXISTS tenant_isolation_cliente ON "cliente";
CREATE POLICY tenant_isolation_cliente ON "cliente"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

-- 3. Policy Isolamento Tenant per la tabella Progetto
DROP POLICY IF EXISTS tenant_isolation_progetto ON "progetto";
CREATE POLICY tenant_isolation_progetto ON "progetto"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

-- 4. Policy Isolamento Tenant per la tabella Fattura
DROP POLICY IF EXISTS tenant_isolation_fattura ON "fattura";
CREATE POLICY tenant_isolation_fattura ON "fattura"
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));
