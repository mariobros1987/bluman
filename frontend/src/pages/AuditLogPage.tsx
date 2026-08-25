import React, { useState, useEffect } from 'react';
import { fmt } from '../utils';
import { fetchAuditLogsApi } from '../api/client';

export interface AuditEntry {
  id: string;
  tenantId: string;
  tenantName: string;
  userEmail: string;
  userNome: string;
  ruolo: 'super_admin' | 'advisor' | 'collaboratore_interno' | 'cliente';
  azione: string;
  categoria: 'AUTH' | 'PROGETTO' | 'DOCUMENTI' | 'FATTURAZIONE' | 'KYC' | 'PERMESSI' | 'TENANT';
  entita: string;
  dettagli: string;
  ipAddress: string;
  dataOra: string;
}

export function AuditLogPage() {
  const currentUserStr = localStorage.getItem('bluman_user');
  const currentUser = currentUserStr ? JSON.parse(currentUserStr) : { ruolo: 'super_admin', tenantId: '00000000-0000-0000-0000-000000000001' };
  const isSuperAdmin = currentUser.ruolo === 'super_admin';

  const [logs, setLogs] = useState<AuditEntry[]>([
    {
      id: 'log-001',
      tenantId: '00000000-0000-0000-0000-000000000001',
      tenantName: 'Bluecode Ltd (Malta HQ)',
      userEmail: 'joe@bluecode.advisory',
      userNome: 'Joe Disabato',
      ruolo: 'advisor',
      azione: 'DOCUMENTO_CARICATO',
      categoria: 'DOCUMENTI',
      entita: 'Accordo_Firma_Cliente_HoldingBeta.pdf',
      dettagli: 'Caricato documento contrattuale con richiesta firma digitale 1-Click',
      ipAddress: '83.211.12.94',
      dataOra: '15/08/2026 00:45:12',
    },
    {
      id: 'log-002',
      tenantId: '00000000-0000-0000-0000-000000000001',
      tenantName: 'Bluecode Ltd (Malta HQ)',
      userEmail: 'joe@bluecode.advisory',
      userNome: 'Joe Disabato',
      ruolo: 'advisor',
      azione: 'FATTURA_EMESSA',
      categoria: 'FATTURAZIONE',
      entita: 'Fattura FT-2026-001 (€ 5.000,00)',
      dettagli: 'Generato XML FatturaPA e preparato per invio manuale a SdI (codice destinatario SUBM70N)',
      ipAddress: '83.211.12.94',
      dataOra: '15/08/2026 00:30:40',
    },
    {
      id: 'log-003',
      tenantId: '00000000-0000-0000-0000-000000000001',
      tenantName: 'Bluecode Ltd (Malta HQ)',
      userEmail: 'operator@bluecode.advisory',
      userNome: 'Francesca Disabato',
      ruolo: 'collaboratore_interno',
      azione: 'ORE_CONSUNTIVATE',
      categoria: 'PROGETTO',
      entita: 'Microvoce: Deposito marchio EUIPO',
      dettagli: 'Registrate +3.5 ore di consuntivo su progetto IP Holding Beta',
      ipAddress: '151.48.90.10',
      dataOra: '14/08/2026 18:20:05',
    },
    {
      id: 'log-004',
      tenantId: '00000000-0000-0000-0000-000000000001',
      tenantName: 'Bluecode Ltd (Malta HQ)',
      userEmail: 'client@holdingbeta.advisory',
      userNome: 'Ing. Roberto Rossi (Cliente)',
      ruolo: 'cliente',
      azione: 'FIRMA_ENGAGEMENT_LETTER',
      categoria: 'DOCUMENTI',
      entita: 'Engagement Letter — Holding Beta S.r.l.',
      dettagli: 'Firma 1-Click accettata dal Portale Cliente con tracciamento IP e User-Agent',
      ipAddress: '2.234.190.44',
      dataOra: '14/08/2026 16:10:00',
    },
    {
      id: 'log-005',
      tenantId: '00000000-0000-0000-0000-000000000002',
      tenantName: 'Advisory Italia S.r.l.',
      userEmail: 'admin@bluecode.advisory',
      userNome: 'Super Admin System',
      ruolo: 'super_admin',
      azione: 'TENANT_CREATO',
      categoria: 'TENANT',
      entita: 'Tenant: Swiss Wealth Management SA',
      dettagli: 'Istanziato nuovo tenant studio con isolamento PostgreSQL Row-Level Security',
      ipAddress: '93.35.100.12',
      dataOra: '14/08/2026 14:00:22',
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterRuolo, setFilterRuolo] = useState<string>('TUTTI');
  const [filterCat, setFilterCat] = useState<string>('TUTTI');

  useEffect(() => {
    const loadAuditLogs = async () => {
      const dbLogs = await fetchAuditLogsApi();
      if (dbLogs && Array.isArray(dbLogs) && dbLogs.length > 0) {
        setLogs(dbLogs.map((l: any) => ({
          ...l,
          tenantName: l.tenantName || 'Bluecode Ltd (Malta HQ)',
          categoria: l.categoria || 'DOCUMENTI',
          dataOra: l.createdAt ? new Date(l.createdAt).toLocaleString('it-IT') : l.dataOra,
        })));
      }
    };
    loadAuditLogs();
  }, []);

  // Filtra per tenant (SuperAdmin vede tutti i tenant, gli altri vedono SOLO il proprio tenant)
  const tenantFilteredLogs = logs.filter(l => {
    if (isSuperAdmin) return true;
    return l.tenantId === currentUser.tenantId;
  });

  const filteredLogs = tenantFilteredLogs.filter(l => {
    const matchSearch = l.userNome.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        l.azione.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        l.entita.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        l.dettagli.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRuolo = filterRuolo === 'TUTTI' || l.ruolo === filterRuolo;
    const matchCat = filterCat === 'TUTTI' || l.categoria === filterCat;
    return matchSearch && matchRuolo && matchCat;
  });

  const getRuoloBadge = (ruolo: string) => {
    switch (ruolo) {
      case 'super_admin': return { bg: '#312e81', color: '#a5b4fc', text: '👑 Super Admin' };
      case 'advisor': return { bg: '#1e1b4b', color: '#818cf8', text: '👨‍💼 Advisor Senior' };
      case 'collaboratore_interno': return { bg: '#064e3b', color: '#a7f3d0', text: '👷 Operatore Studio' };
      case 'cliente': return { bg: '#451a03', color: '#fde68a', text: '🔑 Cliente' };
      default: return { bg: 'var(--card2)', color: 'var(--muted)', text: ruolo };
    }
  };

  const getCatBadge = (cat: string) => {
    switch (cat) {
      case 'DOCUMENTI': return { bg: '#1a1f3d', color: '#818cf8' };
      case 'FATTURAZIONE': return { bg: '#0d2d22', color: '#34d399' };
      case 'PROGETTO': return { bg: '#200f40', color: '#a78bfa' };
      case 'TENANT': return { bg: '#312e81', color: '#a5b4fc' };
      default: return { bg: 'var(--card2)', color: 'var(--muted)' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📋 Registro Audit & Log Attività Operatori (Tenant Isolato)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Tracciamento in tempo reale di tutte le azioni eseguite da Advisors, Operatori e Clienti nello Studio.
            {isSuperAdmin ? ' (Vista globale SuperAdmin)' : ' (Isolato per il tuo Studio)'}
          </div>
        </div>

        <div style={{ fontSize: 11, background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>
          ✓ Log Inalterabile & Isolato tramite RLS PostgreSQL
        </div>
      </div>

      {/* Toolbar Controlli Ricerca e Filtri */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 Cerca per operatore, azione o dettagli..."
            style={{ width: 260, fontSize: 12 }}
          />

          <select value={filterRuolo} onChange={e => setFilterRuolo(e.target.value)} style={{ padding: 8, fontSize: 12 }}>
            <option value="TUTTI">Tutti i Ruoli Attore</option>
            <option value="super_admin">👑 Super Admin</option>
            <option value="advisor">👨‍💼 Advisor Senior</option>
            <option value="collaboratore_interno">👷 Operatore Studio</option>
            <option value="cliente">🔑 Cliente</option>
          </select>

          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ padding: 8, fontSize: 12 }}>
            <option value="TUTTI">Tutte le Categorie Azione</option>
            <option value="DOCUMENTI">📄 Documenti & File</option>
            <option value="FATTURAZIONE">💶 Fatturazione & SDI</option>
            <option value="PROGETTO">🗂 Progetti & Ore</option>
            <option value="TENANT">🏢 Multi-Tenant Admin</option>
          </select>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
          {filteredLogs.length} Eventi Tracciati
        </div>
      </div>

      {/* Log Table */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 10 }}>Data & Ora</th>
                <th style={{ padding: 10 }}>Operatore / Esecutore</th>
                <th style={{ padding: 10 }}>Ruolo Attore</th>
                <th style={{ padding: 10 }}>Azione Eseguita</th>
                <th style={{ padding: 10 }}>Entità Coinvolta</th>
                <th style={{ padding: 10 }}>Dettagli Operazione</th>
                <th style={{ padding: 10 }}>Indirizzo IP</th>
                {isSuperAdmin && <th style={{ padding: 10 }}>Studio / Tenant</th>}
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 8 : 7} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                    Nessun evento registrato corrispondente ai filtri selezionati.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => {
                  const rBadge = getRuoloBadge(log.ruolo);
                  const cBadge = getCatBadge(log.categoria);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 10, whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>
                        {log.dataOra}
                      </td>
                      <td style={{ padding: 10, fontWeight: 700, color: 'var(--text)' }}>
                        {log.userNome}
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{log.userEmail}</div>
                      </td>
                      <td style={{ padding: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: rBadge.bg, color: rBadge.color }}>
                          {rBadge.text}
                        </span>
                      </td>
                      <td style={{ padding: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: cBadge.bg, color: cBadge.color }}>
                          {log.azione}
                        </span>
                      </td>
                      <td style={{ padding: 10, fontWeight: 600, color: 'var(--indigo-l)' }}>
                        {log.entita}
                      </td>
                      <td style={{ padding: 10, color: 'var(--muted)', maxWidth: 300 }}>
                        {log.dettagli}
                      </td>
                      <td style={{ padding: 10, fontFamily: 'monospace', fontSize: 11, color: 'var(--hint)' }}>
                        {log.ipAddress}
                      </td>
                      {isSuperAdmin && (
                        <td style={{ padding: 10, fontSize: 11, fontWeight: 600, color: '#34d399' }}>
                          {log.tenantName}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
