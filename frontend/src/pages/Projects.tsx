import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup } from '../components/ui/Avatar';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, progressColor } from '../utils';
import { PROJECTS } from '../store/mockData';
import { fetchProgetti } from '../api/client';
import { NewProjectWizard } from '../components/NewProjectWizard';
import type { Progetto } from '../types';

export function Projects() {
  const navigate = useNavigate();
  const [projectList, setProjectList] = useState<Progetto[]>(PROJECTS);
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadProjects = async () => {
    let combined: Progetto[] = [];

    // 1. Carica progetti salvati localmente
    const localStr = localStorage.getItem('bluman_custom_projects');
    if (localStr) {
      try {
        const localProjs = JSON.parse(localStr);
        if (Array.isArray(localProjs)) combined.push(...localProjs);
      } catch (err) {
        console.warn('Errore parsing custom projects:', err);
      }
    }

    // 2. Carica progetti remoti da API Supabase/DB
    const remote = await fetchProgetti();
    if (remote && Array.isArray(remote)) {
      const dbProjs: Progetto[] = remote.map((rp: any) => {
        let rpMods = (rp.moduli || []).map((m: any, mIdx: number) => ({
          id: mIdx + 100,
          n: m.nome,
          cat: m.categoria || 'Societario',
          st: m.stato || 'in_progress',
          pct: m.stato === 'done' ? 100 : 50,
          h: m.orePreventivate || 20,
          a: m.oreConsuntivate || 0,
          p: m.prezzo ? m.prezzo / 100 : 3500,
          team: [1, 2],
          delay: false,
          v: [],
        }));

        if (rpMods.length === 0) {
          const match = combined.find(p => p.cl === rp.cliente?.nome || p.n === rp.nome)
                     || PROJECTS.find(p => p.cl === rp.cliente?.nome || p.n === rp.nome);
          if (match && match.mods && match.mods.length > 0) {
            rpMods = match.mods;
          }
        }

        return {
          id: rp.id,
          n: rp.nome,
          cl: rp.cliente?.nome || rp.clienteId || 'Cliente',
          ct: (rp.cliente?.tipo as any) || 'individual',
          st: rp.stato || 'in_progress',
          pct: rp.stato === 'completed' ? 100 : rp.stato === 'in_progress' ? 45 : 10,
          start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : 'Oggi',
          due: 'In corso',
          val: rp.valoreTotale ? rp.valoreTotale / 100 : 12000,
          delay: false,
          fisc: 'privato',
          fatture: [],
          mods: rpMods,
        };
      });

      const existingIds = new Set(combined.map(p => String(p.id)));
      for (const dp of dbProjs) {
        if (!existingIds.has(String(dp.id))) {
          combined.push(dp);
        }
      }
    }

    // 3. Aggiungi progetti di default mock se non presenti
    const existingIds = new Set(combined.map(p => String(p.id)));
    const mockToAppend = PROJECTS.filter(p => !existingIds.has(String(p.id)));
    combined.push(...mockToAppend);

    setProjectList(combined);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const [searchTerm, setSearchTerm] = useState('');

  // Mostra TUTTI i progetti dello studio per il team, o filtra per cliente/ricerca
  const visibleProjects = projectList.filter(p => {
    if (currentUser.ruolo === 'cliente') {
      if (!p.cl?.toLowerCase().includes((currentUser.nome || '').toLowerCase())) return false;
    }
    const query = searchTerm.toLowerCase();
    if (query && !p.n.toLowerCase().includes(query) && !p.cl.toLowerCase().includes(query)) return false;
    return true;
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Tutti i progetti ({visibleProjects.length})</div>
          <input
            type="text"
            placeholder="🔍 Cerca per nome o cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, width: 260 }}
          />
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >
          + Nuovo progetto
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleProjects.map(p => {
          const color = progressColor(p);
          const allTeam = [...new Set((p.mods || []).flatMap(m => m.team || [1]).filter(Boolean))];
          return (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{
                background: 'var(--card)', border: `1px solid ${p.delay ? 'var(--amber)' : 'var(--border)'}`,
                borderLeft: p.delay ? '3px solid var(--amber)' : undefined,
                borderRadius: 12, padding: 16, cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--indigo)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = p.delay ? 'var(--amber)' : 'var(--border)')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.n}</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span>{p.ct === 'individual' ? '👤' : '🏢'} {p.cl}</span>
                    <span>📅 {p.start} → {p.due}</span>
                    <span>💶 {fmt(p.val)}</span>
                    {p.mods.length > 0 && <span>🗂 {p.mods.length} moduli</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <AvatarGroup ids={allTeam.length ? allTeam : [1]} size={22} />
                  <Badge stato={p.st} />
                </div>
              </div>
              {p.mods.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {p.mods.map((m, idx) => <CatBadge key={idx} cat={m.cat} />)}
                </div>
              )}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                  <span>Avanzamento</span>
                  <span style={{ color, fontWeight: 600 }}>{p.pct}%</span>
                </div>
                <ProgressBar value={p.pct} color={color} height={4} />
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
