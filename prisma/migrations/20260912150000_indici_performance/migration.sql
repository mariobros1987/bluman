-- Migration: 20260912150000_indici_performance
-- Obiettivo: indici compositi sulle 3 tabelle ad alto volume per query frequenti.
-- Creati come CONCURRENTLY per non bloccare scritture in produzione durante l'applicazione.
-- Sicuri da rieseguire: IF NOT EXISTS su ogni CREATE INDEX.

-- ─── AuditLog ────────────────────────────────────────────────────────────────
-- Query più frequente: GET /audit-logs → WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50
-- Senza indice: sequential scan sull'intera tabella (cresce con ogni azione di ogni utente).
-- L'indice copre sia il filtro tenant che l'ordinamento: il planner non legge righe fuori tenant.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_tenant_created
  ON audit_log (tenant_id, created_at DESC);

-- Ricerca per azione specifica (es. tutti i LOGIN, tutti i DOCUMENTO_FIRMATO del mese):
-- WHERE tenant_id = ? AND azione = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_tenant_azione_created
  ON audit_log (tenant_id, azione, created_at DESC);

-- ─── Notifica ────────────────────────────────────────────────────────────────
-- Query del badge "notifiche non lette" nella topbar:
-- WHERE tenant_id = ? AND destinatario_id = ? AND stato_lettura = 'non_letta'
-- Gli indici esistenti coprono (tenant_id, destinatario_id) ma non stato_lettura:
-- il planner deve filtrare le righe lette dopo aver usato l'indice esistente.
-- Con questo indice coperto la query è index-only scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifica_tenant_dest_stato
  ON notifica (tenant_id, destinatario_id, stato_lettura)
  WHERE stato_lettura = 'non_letta';

-- Stessa logica per notifiche cliente nel portale:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifica_tenant_dest_cliente_stato
  ON notifica (tenant_id, destinatario_cliente_id, stato_lettura)
  WHERE stato_lettura = 'non_letta';

-- Ordinamento cronologico per il pannello notifiche (lista completa con data):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifica_tenant_dest_created
  ON notifica (tenant_id, destinatario_id, created_at DESC);

-- ─── MovimentoPrimaNota ──────────────────────────────────────────────────────
-- @@index([tenantId, data]) già presente in schema.prisma → già in DB. ✅
-- @@index([tenantId, fatturaId]) già presente. ✅
-- Aggiunto: ricerca per tipo (entrata/uscita) per il riepilogo cassa:
-- WHERE tenant_id = ? AND tipo = 'entrata' AND data >= ? AND data <= ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prima_nota_tenant_tipo_data
  ON movimento_prima_nota (tenant_id, tipo, data DESC);

-- ─── Progetto ────────────────────────────────────────────────────────────────
-- Query dashboard "progetti in ritardo / a rischio":
-- WHERE tenant_id = ? AND stato IN ('in_corso','bloccato') ORDER BY created_at DESC
-- La tabella ha già @@index([tenantId, clienteId]) ma non (tenantId, stato).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_progetto_tenant_stato
  ON progetto (tenant_id, stato)
  WHERE stato IN ('in_corso', 'bloccato', 'in_attesa');
