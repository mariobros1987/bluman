import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup } from '../components/ui/Avatar';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, progressColor } from '../utils';
import { fetchProgetti } from '../api/client';
import { NewProjectWizard } from '../components/NewProjectWizard';
import type { Progetto } from '../types';

export function Projects() {
  const navigate = useNavigate();
  const [projectList, setProjectList] = useState<Progetto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const loadProjects = async () => {
    let combined: Progetto[] = [];

    // 1. Carica progetti salvati localmente dall'utente
    const localStr = localStorage.getItem('bluman_custom_projects');
    if (localStr) {
      try {
        const localProjs = JSON.parse(localStr);
        if (Array.isArray(localProjs)) combined.push(...localProjs);
      } catch (err) {
        console.warn('Errore parsing custom projects:', err);
      }
    }

    // 2. Carica progetti remoti dal backend Fastify/DB se presenti
    try {
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
          return {
            id: rp.id,
            n: rp.nome,
            cl: rp.cliente?.nome || 'Cliente',
            ct: (rp.cliente?.tipo as any) || 'individual',
            st: rp.stato || 'in_progress',
            pct: rp.stato === 'completed' ? 100 : 45,
            start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : 'Oggi',
            due: 'In corso',
            val: rp.valoreTotale ? rp.valoreTotale / 100 : 15000,
            delay: false,
            fisc: 'privato',
            fatture: [],
            mods: rpMods,
          };
        });
        const existingIds = new Set(combined.map(p => String(p.id)));
        for (const dp of dbProjs) {
          if (!existingIds.has(String(dp.id))) combined.push(dp);
        }
      }
    } catch (err) {
      console.warn('Fetch DB fallback:', err);
    }

    // 3. Ripristina tutti i progetti storici dello studio
    const existingIds = new Set(combined.map(p => String(p.id)));
    const studioProjs = PROJECTS.filter(p => !existingIds.has(String(p.id)));
    combined.push(...studioProjs);

    setProjectList(combined);
    setLoading(false);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const visibleProjects = projectList.filter(p => {
    const query = searchTerm.toLowerCase();
    if (query && !p.n.toLowerCase().includes(query) && !p.cl.toLowerCase().includes(query)) return false;
    return true;
  });

  // ── Stato: Caricamento ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Connessione al database in corso...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Stato: Errore DB ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 20 }}>
        <div style={{ fontSize: 48 }}>🔴</div>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>
            Errore di connessione al database
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={loadProjects}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 600
              }}
            >
              🔄 Riprova
            </button>
            <button
              onClick={() => window.open('mailto:admin@bluecode.advisory?subject=Errore%20Database%20BluMan', '_blank')}
              style={{
                padding: '8px 20px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                fontSize: 13
              }}
            >
              📧 Contatta Amministratore
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Vista Progetti ──────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Tutti i progetti ({visibleProjects.length})</div>
          <input
            type="text"
            placeholder="🔍 Cerca per nome o cliente..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--surface)', color: 'var(--fg)', fontSize: 13, width: 240,
            }}
          />
        </div>
        <button
          id="btn-nuovo-progetto"
          onClick={() => setWizardOpen(true)}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          + Nuovo Progetto
        </button>
      </div>

      {visibleProjects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Nessun progetto trovato</div>
          <div style={{ fontSize: 13 }}>Crea il primo progetto cliccando su "Nuovo Progetto"</div>
        </div>
      ) : (
        <div className="project-grid" style={{ display: 'grid', gap: 14 }}>
          {visibleProjects.map(p => (
            <div
              key={p.id}
              className="card"
              onClick={() => navigate(`/projects/${p.id}`)}
              style={{ cursor: 'pointer', padding: 18 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{p.n}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.cl}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {p.delay && <Badge label="⚠ Ritardo" color="amber" />}
                  <Badge
                    label={p.st === 'in_progress' ? 'In corso' : p.st === 'completed' ? 'Completato' : p.st === 'archived' ? 'Archiviato' : p.st}
                    color={p.st === 'completed' ? 'green' : p.st === 'archived' ? 'gray' : 'blue'}
                  />
                </div>
              </div>
              <ProgressBar pct={p.pct} color={progressColor(p)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                <span>💶 {fmt(p.val)}</span>
                <span>📅 {p.due}</span>
                {p.mods && p.mods.length > 0 && <CatBadge cat={p.mods[0].cat} />}
                <AvatarGroup ids={p.mods?.[0]?.team || []} />
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => { setWizardOpen(false); loadProjects(); }}
        />
      )}
    </>
  );
}
