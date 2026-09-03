import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

export const Dashboard: React.FC = () => {
  const [progetti, setProgetti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const progRes = await api.get('/api/progetti');
        setProgetti(progRes.data || []);
      } catch (err) {
        console.error('Errore nel caricamento delle statistiche', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const fmt = (n: number) => '€ ' + n.toLocaleString('it-IT');

  const delays = progetti.flatMap(p => 
    (p.modulo_progetto || []).filter((m: any) => m.stato === 'delayed' || m.stato === 'blocked').map((m: any) => ({
      p: p.nome,
      m: m.nome,
      note: m.causa_nota || 'Richiesta attenzione'
    }))
  );

  const totV = progetti.reduce((a, p) => a + (p.valore_totale || 0), 0);
  const totI = progetti.reduce((a, p) => a + (p.importo_fatturato || 0), 0);
  const avg = progetti.length ? Math.round(progetti.reduce((a, p) => a + (p.avanzamento_pct || 0), 0) / progetti.length) : 0;
  const actN = progetti.filter(p => p.stato === 'in_progress').length;

  const badge = (s: string) => {
    const M: Record<string, [string, string, string, string]> = {
      done: ['b-done', '#0d2d22', '#34d399', 'Completato'],
      completed: ['b-done', '#0d2d22', '#34d399', 'Completato'],
      in_progress: ['b-ip', '#1a1f3d', '#818cf8', 'In corso'],
      active: ['b-ip', '#1a1f3d', '#818cf8', 'In corso'],
      pending: ['b-p', '#1e2030', '#7b7f9e', 'In attesa'],
      delayed: ['b-d', '#2d1a05', '#f59e0b', 'Ritardo'],
      blocked: ['b-b', '#2d0d0d', '#f87171', 'Bloccato'],
      pre_project: ['b-pre', '#20134a', '#a78bfa', 'Pre-progetto'],
      attesa_dipendenza: ['b-wd', '#241a3d', '#a78bfa', 'Attesa dipendenza']
    };
    const [, bg, cl, lb] = M[s] || M.pending;
    return (
      <span className="badge" style={{ background: bg, color: cl }}>
        <span className="bd-dot" style={{ background: cl }} />
        {lb}
      </span>
    );
  };

  const dcol = (p: any) => {
    if (!p) return '#6366f1';
    if (p.stato === 'blocked') return '#ef4444';
    if (p.stato === 'delayed') return '#f59e0b';
    if (p.stato === 'completed') return '#10b981';
    return '#6366f1';
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#1a1f3d' }}>📁</div>
          <div className="kpi-value">{actN}</div>
          <div className="kpi-label">Progetti attivi</div>
          <div className="kpi-sub">{progetti.length} totali</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#0d2d22' }}>💶</div>
          <div className="kpi-value">{fmt(totV)}</div>
          <div className="kpi-label">Valore portafoglio</div>
          <div className="kpi-sub">{fmt(totI)} fatturato</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#200f40' }}>📈</div>
          <div className="kpi-value">{avg}%</div>
          <div className="kpi-label">Avanzamento medio</div>
          <div className="kpi-sub">su tutti i progetti</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#2d1a05' }}>⚠️</div>
          <div className="kpi-value">{delays.length}</div>
          <div className="kpi-label">Ritardi attivi</div>
          <div className="kpi-sub">moduli con problemi</div>
        </div>
      </div>

      {/* Alert Banner */}
      {delays.length > 0 && (
        <div className="alert-banner">
          <div className="alert-title">⚠ Alert ritardi — azione richiesta</div>
          {delays.map((d, i) => (
            <div key={i} className="alert-row">
              <div className="alert-dot" />
              <strong style={{ color: '#e8a060' }}>{d.p}</strong>&nbsp;→ {d.m}: {d.note}
            </div>
          ))}
        </div>
      )}

      {/* Section Header */}
      <div className="section-header">
        <div className="section-title">Progetti in corso</div>
        <button className="btn-primary" onClick={() => navigate('/app/preventivi/nuovo')}>
          + Nuovo progetto
        </button>
      </div>

      {/* Project List */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Caricamento...</div>
      ) : (
        <div className="project-list">
          {progetti.map(p => {
            const mods = p.modulo_progetto || [];
            const pd = mods.filter((m: any) => m.stato === 'delayed' || m.stato === 'blocked').length;
            const col = dcol(mods.find((m: any) => m.stato === 'delayed' || m.stato === 'blocked'));

            return (
              <div 
                key={p.id} 
                className={`project-card ${pd ? 'has-delay' : ''}`}
                onClick={() => navigate(`/app/progetti/${p.id}`)}
              >
                <div className="project-top">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                      {badge(p.stato)}
                      {pd > 0 && (
                        <span style={{ fontSize: '10px', color: '#f59e0b', fontWeight: 600 }}>
                          ⚠ {pd} ritard{pd > 1 ? 'i' : 'o'}
                        </span>
                      )}
                    </div>
                    <div className="project-name">{p.nome}</div>
                    <div className="project-meta">
                      <span>👤 {p.cliente?.nome || p.cliente_id}</span>
                      <span>📅 {p.data_scadenza || 'In corso'}</span>
                      <span>{mods.length} moduli</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{fmt(p.valore_totale || 0)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>valore progetto</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#818cf8' }}>{p.avanzamento_pct || 0}%</div>
                  </div>
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted)', marginBottom: '4px' }}>
                    <span>Avanzamento</span>
                    <span>{p.avanzamento_pct || 0}%</span>
                  </div>
                  <div className="pbar" style={{ height: '4px' }}>
                    <div className="pfill" style={{ width: `${p.avanzamento_pct || 0}%`, background: col, height: '4px' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {mods.map((m: any) => {
                    const isDelay = m.stato === 'delayed' || m.stato === 'blocked';
                    const isDone = m.stato === 'completed';
                    const bg = isDelay ? '#2d1a05' : isDone ? '#0d2d22' : m.stato === 'in_progress' ? '#1a1f3d' : '#1e2030';
                    const tc = isDelay ? '#f59e0b' : isDone ? '#34d399' : m.stato === 'in_progress' ? '#818cf8' : '#7b7f9e';

                    return (
                      <span key={m.id} className="pill" style={{ background: bg, color: tc }}>
                        {isDelay ? '⚠ ' : ''}{isDone ? '✓ ' : ''}{m.nome}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {progetti.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px', fontSize: '12px' }}>
              Nessun progetto disponibile.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
