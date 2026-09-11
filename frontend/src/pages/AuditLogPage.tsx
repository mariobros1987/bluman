import { useState, useEffect } from 'react';
import { fetchAuditLogsApi } from '../api/client';
import { Paginatore } from '../components/ui/Paginatore';
import { isRispostaPaginata, type MetaPaginazione } from '../api/paginazione';

const META_INIZIALE: MetaPaginazione = { page: 1, limit: 50, totale: 0, pagine: 0 };

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

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [meta, setMeta] = useState<MetaPaginazione>(META_INIZIALE);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [filterRuolo, setFilterRuolo] = useState<string>('TUTTI');
  const [filterCat, setFilterCat] = useState<string>('TUTTI');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchDebounced(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    const loadAuditLogs = async () => {
      setLoading(true);
      setErrore('');
      try {
        const risposta = await fetchAuditLogsApi({ page, limit, search: searchDebounced, sortBy: 'createdAt', sortOrder: 'desc' });
        if (!isRispostaPaginata<any>(risposta)) throw new Error('Risposta audit log non valida');
        setMeta(risposta.meta);
        if (risposta.meta.pagine > 0 && page > risposta.meta.pagine) setPage(risposta.meta.pagine);
        setLogs(risposta.data.map((l: any) => {
          const az = (l.azione || '').toUpperCase();
          let cat: AuditEntry['categoria'] = 'DOCUMENTI';
          if (az.includes('FATTURA') || az.includes('INCASSO') || az.includes('SDI') || az.includes('PRIMA_NOTA') || az.includes('CONTRATTO')) {
            cat = 'FATTURAZIONE';
          } else if (az.includes('PROGETTO') || az.includes('ORE') || az.includes('MODULO') || az.includes('PREVENTIVO')) {
            cat = 'PROGETTO';
          } else if (az.includes('TENANT') || az.includes('UTENTE') || az.includes('STUDIO')) {
            cat = 'TENANT';
          } else if (az.includes('LOGIN') || az.includes('AUTH') || az.includes('PASSWORD')) {
            cat = 'AUTH';
          } else if (az.includes('PERMESSI')) {
            cat = 'PERMESSI';
          } else if (az.includes('KYC')) {
            cat = 'KYC';
          }

          return {
            ...l,
            tenantName: l.tenantName || 'Studio Advisory',
            categoria: l.categoria || cat,
            dataOra: l.createdAt ? new Date(l.createdAt).toLocaleString('it-IT') : l.dataOra,
          };
        }));
      } catch (err) {
        setLogs([]);
        setErrore(err instanceof Error ? err.message : 'Errore caricamento audit log');
      } finally {
        setLoading(false);
      }
    };
    loadAuditLogs();
  }, [page, limit, searchDebounced]);

  // L'endpoint è già isolato sul tenant della sessione; questi filtri agiscono sulla pagina corrente.
  const filteredLogs = logs.filter(l => {
    const matchSearch = true;
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
            {' (Vista isolata sul tenant corrente)'}
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

          <select value={filterRuolo} onChange={e => { setFilterRuolo(e.target.value); setPage(1); }} style={{ padding: 8, fontSize: 12 }}>
            <option value="TUTTI">Tutti i Ruoli Attore (pagina corrente)</option>
            <option value="super_admin">👑 Super Admin</option>
            <option value="advisor">👨‍💼 Advisor Senior</option>
            <option value="collaboratore_interno">👷 Operatore Studio</option>
            <option value="cliente">🔑 Cliente</option>
          </select>

          <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1); }} style={{ padding: 8, fontSize: 12 }}>
            <option value="TUTTI">Tutte le Categorie Azione (pagina corrente)</option>
            <option value="DOCUMENTI">📄 Documenti & File</option>
            <option value="FATTURAZIONE">💶 Fatturazione & SDI</option>
            <option value="PROGETTO">🗂 Progetti & Ore</option>
            <option value="TENANT">🏢 Multi-Tenant Admin</option>
          </select>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
          {meta.totale} Eventi Tracciati
        </div>
      </div>

      {/* Log Table */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        {errore && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: '#7f1d1d', color: '#fecaca' }}>{errore}</div>}
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Caricamento registro audit...</div>
        ) : <div style={{ overflowX: 'auto' }}>
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
        </div>}
        <Paginatore
          meta={meta}
          onPageChange={setPage}
          onLimitChange={(nuovoLimite) => { setLimit(nuovoLimite); setPage(1); }}
        />
      </div>
    </div>
  );
}
