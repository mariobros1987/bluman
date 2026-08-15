import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup } from '../components/ui/Avatar';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, progressColor } from '../utils';
import { PROJECTS } from '../store/mockData';
import { NewProjectWizard } from '../components/NewProjectWizard';
import { fetchProgetti } from '../api/client';
import type { Progetto } from '../types';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [projectList, setProjectList] = useState<Progetto[]>(PROJECTS);
  const [isDbConnected, setIsDbConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'attivi' | 'archiviati'>('attivi');

  const loadProjects = async () => {
    const remote = await fetchProgetti();
    if (remote && Array.isArray(remote)) {
      setIsDbConnected(true);
      const dbProjs: Progetto[] = remote.map((rp: any, idx: number) => ({
        id: rp.id,
        n: rp.nome,
        cl: rp.cliente?.nome || 'Cliente',
        ct: (rp.cliente?.tipo as any) || 'individual',
        st: rp.stato || 'in_progress',
        pct: rp.stato === 'completed' ? 100 : rp.stato === 'in_progress' ? 45 : 10,
        start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : 'Oggi',
        due: 'In corso',
        val: rp.valoreTotale ? rp.valoreTotale / 100 : 15000,
        delay: false,
        fisc: 'privato',
        fatture: [],
        mods: (rp.moduli || []).map((m: any, mIdx: number) => ({
          id: mIdx + 100,
          n: m.nome,
          cat: m.categoria || 'Societario',
          st: m.stato || 'pending',
          pct: m.stato === 'done' ? 100 : m.stato === 'in_progress' ? 50 : 0,
          h: m.orePreventivate || 20,
          a: m.oreConsuntivate || 0,
          p: m.prezzo ? m.prezzo / 100 : 3500,
          team: [1, 2],
          delay: m.stato === 'delayed' || m.stato === 'blocked',
          v: (m.microvoci || []).map((mv: any) => ({
            n: mv.nome,
            hE: mv.orePreventivate || 4,
            hA: mv.oreConsuntivate || 0,
            s: mv.stato || 'pending',
            as: 1,
            d: 0,
            vn: mv.causaNota || undefined,
          })),
        })),
      }));
      
      const existingIds = new Set(dbProjs.map(p => String(p.id)));
      const filteredMock = PROJECTS.filter(p => !existingIds.has(String(p.id)));
      setProjectList([...dbProjs, ...filteredMock]);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const active   = projectList.filter(p => p.st === 'in_progress').length;
  const alerts   = projectList.filter(p => p.delay).length;
  const totalVal = projectList.reduce((a, p) => a + p.val, 0);
  const avgPct   = Math.round(projectList.reduce((a, p) => a + p.pct, 0) / (projectList.length || 1));

  const delayedProjects = projectList.filter(p =>
    p.delay || p.mods?.some(m => m.st === 'blocked' || m.st === 'delayed')
  );

  return (
    <>
      {/* DB Connection Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: isDbConnected ? '#34d399' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDbConnected ? '#10b981' : 'var(--amber)' }} />
          {isDbConnected ? '🟢 Enterprise Cloud Database Collegato' : '🟡 Server Locale API'}
        </div>
      </div>

      {/* KPI */}
      <div className={styles.kpiGrid}>
        <KpiCard icon="📁" iconBg="#1a1f3d" value={projectList.length} label="Progetti attivi" sub={`${active} in lavorazione`} />
        <KpiCard icon="⚠️" iconBg="#2d1a05" value={alerts} label="Ritardi attivi" sub="Richiedono attenzione" valueColor={alerts > 0 ? 'var(--amber)' : undefined} />
        <KpiCard icon="💶" iconBg="#0d2d22" value={fmt(totalVal)} label="Valore portafoglio" sub="Progetti in corso" />
        <KpiCard icon="📈" iconBg="#1a1f3d" value={`${avgPct}%`} label="Avanzamento medio" sub="Tutti i progetti" />
      </div>

      {/* Alert banner */}
      {delayedProjects.length > 0 && (
        <div className={styles.alertBanner}>
          <div className={styles.alertTitle}>⚠ Situazioni che richiedono attenzione immediata</div>
          {(delayedProjects.flatMap(p =>
            (p.mods || []).filter(m => m.delay || m.st === 'blocked').map(m => (
              <div key={`${p.id}-${m.id}`} className={styles.alertRow}>
                <span className={styles.alertDot} />
                <span><strong>{p.n}</strong> — {m.n}: {m.dn || 'Ritardo rilevato'}</span>
              </div>
            ))
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setActiveTab('attivi')}
          style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'attivi' ? '2px solid var(--indigo-l)' : '2px solid transparent', color: activeTab === 'attivi' ? 'var(--indigo-l)' : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}
        >
          Progetti in Corso ({projectList.filter(p => p.st !== 'archived').length})
        </button>
        <button
          onClick={() => setActiveTab('archiviati')}
          style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'archiviati' ? '2px solid var(--indigo-l)' : '2px solid transparent', color: activeTab === 'archiviati' ? 'var(--indigo-l)' : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}
        >
          🗄 Archivio Progetti ({projectList.filter(p => p.st === 'archived').length})
        </button>
      </div>

      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>{activeTab === 'attivi' ? 'Progetti in corso' : 'Archivio Storico'}</div>
        <button className={styles.btnPrimary} onClick={() => setWizardOpen(true)}>
          + Nuovo progetto
        </button>
      </div>

      <div className={styles.projectList}>
        {projectList.filter(p => activeTab === 'attivi' ? p.st !== 'archived' : p.st === 'archived').map(p => {
          const color = progressColor(p);
          const allTeam = [...new Set((p.mods || []).flatMap(m => m.team || [1]).filter(Boolean))];
          return (
            <div
              key={p.id}
              className={`${styles.projectCard} ${p.delay ? styles.hasDelay : ''}`}
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <div className={styles.projectTop}>
                <div>
                  <div className={styles.projectName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{p.n}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }} title="Apri / Modifica Dettagli Progetto">✏️</span>
                  </div>
                  <div className={styles.projectMeta}>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/clients?client=${encodeURIComponent(p.cl)}`);
                      }}
                      style={{ cursor: 'pointer', color: 'var(--indigo-l)', textDecoration: 'underline' }}
                      title="Apri Anagrafica Specifica Cliente"
                    >
                      {p.ct === 'individual' ? '👤' : '🏢'} {p.cl}
                    </span>
                    <span>📅 {p.start} → {p.due}</span>
                    <span>💶 {fmt(p.val)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <AvatarGroup ids={allTeam.length ? allTeam : [1]} size={22} />
                  <Badge stato={p.st} />
                </div>
              </div>

              {/* Modules summary */}
              <div className={styles.modsSummary}>
                {(p.mods || []).map((m, idx) => (
                  <CatBadge key={idx} cat={m.cat} />
                ))}
              </div>

              {/* Progress */}
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                  <span>Avanzamento</span>
                  <span style={{ color, fontWeight: 600 }}>{p.pct}%</span>
                </div>
                <ProgressBar value={p.pct} color={color} height={5} />
              </div>
            </div>
          );
        })}
      </div>

      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onProjectCreated={() => loadProjects()}
        />
      )}
    </>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────
interface KpiCardProps {
  icon: string; iconBg: string;
  value: string | number; label: string; sub?: string;
  valueColor?: string;
}

function KpiCard({ icon, iconBg, value, label, sub, valueColor }: KpiCardProps) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiIcon} style={{ background: iconBg }}>{icon}</div>
      <div className={styles.kpiValue} style={{ color: valueColor }}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}
