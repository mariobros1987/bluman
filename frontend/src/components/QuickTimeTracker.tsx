import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadTeamMembersFromDb } from '../hooks/useTeamMembers';
import { fetchProgetti, salvaProgettoDettaglioApi } from '../api/client';
import type { Progetto, TeamMember } from '../types';

interface TimeTrackerProps {
  user?: any;
}

export function QuickTimeTracker({ user }: TimeTrackerProps) {
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [projects, setProjects] = useState<Progetto[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMicrovoceIdx, setSelectedMicrovoceIdx] = useState<number>(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const timerRef = useRef<any>(null);

  const loadAllProjects = async () => {
    const list: Progetto[] = [];

    // 1. Progetti salvati in local storage
    try {
      const savedStr = localStorage.getItem('bluman_custom_projects');
      if (savedStr) {
        const arr = JSON.parse(savedStr);
        if (Array.isArray(arr)) {
          list.push(...arr);
        }
      }
    } catch {}

    // 2. Progetti salvati sul DB server Fastify / PostgreSQL
    try {
      const remote = await fetchProgetti();
      if (remote && Array.isArray(remote)) {
        const existingIds = new Set(list.map(p => String(p.id)));
        remote.forEach((rp: any) => {
          if (!existingIds.has(String(rp.id))) {
            list.push({
              id: rp.id,
              n: rp.nome,
              cl: rp.cliente?.nome || 'Cliente',
              ct: (rp.cliente?.tipo as any) || 'individual',
              st: rp.stato || 'in_progress',
              pct: rp.stato === 'completed' ? 100 : 50,
              start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : 'Oggi',
              due: rp.scadenza ? new Date(rp.scadenza).toLocaleDateString('it-IT') : '31/12/2026',
              val: rp.valoreTotale ? rp.valoreTotale / 100 : 15000,
              delay: rp.inRitardo || false,
              fisc: rp.regimeFiscale || 'privato_italia',
              fatture: rp.fatture || [],
              mods: (rp.moduli || []).map((m: any, mIdx: number) => ({
                id: mIdx + 100,
                n: m.nome,
                cat: m.categoria || 'Societario',
                st: m.stato || 'in_progress',
                pct: 50,
                h: m.orePreventivate || 20,
                a: m.oreConsuntivate || 0,
                p: m.prezzo ? m.prezzo / 100 : 3500,
                team: [1, 2],
                delay: false,
                v: (m.microvoci || []).map((v: any) => ({
                  n: v.titolo || v.nome,
                  hE: v.orePreventivate || 2,
                  hA: v.oreConsuntivate || 0,
                  s: v.completato ? 'done' : 'pending',
                  as: 1,
                  d: 1,
                })),
              })),
            });
          }
        });
      }
    } catch {}

    setProjects(list);
    if (list.length > 0) {
      setSelectedProjectId(prev => (prev && list.some(p => String(p.id) === String(prev))) ? prev : String(list[0].id));
    }
  };

  useEffect(() => {
    loadAllProjects();
    loadTeamMembersFromDb().then(t => setTeamMembers(t));

    // Ascolta aggiornamenti progetti da altre finestre o azioni
    const handleStorage = () => loadAllProjects();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('bluman_project_created', handleStorage);

    // Ripristina stato timer salvato
    try {
      const savedTimerStr = localStorage.getItem('bluman_active_timer');
      if (savedTimerStr) {
        const savedTimer = JSON.parse(savedTimerStr);
        if (savedTimer.isRunning && savedTimer.startTime) {
          const elapsed = Math.floor((Date.now() - savedTimer.startTime) / 1000) + (savedTimer.baseSeconds || 0);
          setSeconds(elapsed);
          setIsRunning(true);
          if (savedTimer.projectId) setSelectedProjectId(String(savedTimer.projectId));
          if (typeof savedTimer.mvIdx === 'number') setSelectedMicrovoceIdx(savedTimer.mvIdx);
        } else if (savedTimer.seconds) {
          setSeconds(savedTimer.seconds);
          if (savedTimer.projectId) setSelectedProjectId(String(savedTimer.projectId));
          if (typeof savedTimer.mvIdx === 'number') setSelectedMicrovoceIdx(savedTimer.mvIdx);
        }
      }
    } catch {}

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('bluman_project_created', handleStorage);
    };
  }, []);

  // Tick timer
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  // Salva stato timer in localStorage
  useEffect(() => {
    if (isRunning) {
      localStorage.setItem('bluman_active_timer', JSON.stringify({
        isRunning: true,
        startTime: Date.now(),
        baseSeconds: seconds,
        projectId: selectedProjectId,
        mvIdx: selectedMicrovoceIdx,
      }));
    } else if (seconds > 0) {
      localStorage.setItem('bluman_active_timer', JSON.stringify({
        isRunning: false,
        seconds,
        projectId: selectedProjectId,
        mvIdx: selectedMicrovoceIdx,
      }));
    } else {
      localStorage.removeItem('bluman_active_timer');
    }
  }, [isRunning, seconds, selectedProjectId, selectedMicrovoceIdx]);

  const formatTime = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    if (projects.length === 0) {
      alert('Non hai ancora creato alcuna pratica. Clicca su "+ Nuovo Progetto" nella pagina Progetti per avviare il timer.');
      navigate('/projects');
      return;
    }
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleStop = () => {
    setIsRunning(false);
    setShowStopModal(true);
  };

  const currentProject = projects.find(p => String(p.id) === String(selectedProjectId)) || projects[0];
  const microvociList: { name: string; modId: number; mvIdx: number }[] = [];
  if (currentProject && currentProject.mods) {
    currentProject.mods.forEach(m => {
      if (m.v && m.v.length > 0) {
        m.v.forEach((mv, idx) => {
          microvociList.push({ name: `${m.n} › ${mv.n}`, modId: m.id, mvIdx: idx });
        });
      } else {
        microvociList.push({ name: `${m.n} (Attività generale)`, modId: m.id, mvIdx: 0 });
      }
    });
  }

  // Tariffa oraria operatore corrente
  const currentMember = teamMembers.find(t => t.n.toLowerCase().includes((user?.nome || '').toLowerCase()) || (user?.email && t.n.toLowerCase().includes(user.email.toLowerCase()))) || teamMembers[0];
  const hourlyRate = currentMember ? (currentMember.id === 1 ? 120 : currentMember.id === 5 ? 95 : currentMember.id === 3 ? 90 : currentMember.id === 4 ? 85 : 45) : 95;
  const hoursSpentDecimal = Number((seconds / 3600).toFixed(2));
  const totalCost = Number((hoursSpentDecimal * hourlyRate).toFixed(2));

  const handleConfirmSaveHours = async () => {
    if (!currentProject) {
      setShowStopModal(false);
      setSeconds(0);
      return;
    }

    const selectedMv = microvociList[selectedMicrovoceIdx] || microvociList[0];
    const newMods = (currentProject.mods || []).map(m => {
      if (selectedMv && m.id === selectedMv.modId) {
        const newV = (m.v && m.v.length > 0) ? m.v.map((mv, idx) => {
          if (idx === selectedMv.mvIdx) {
            return {
              ...mv,
              hA: (mv.hA || 0) + hoursSpentDecimal,
              s: 'done' as any,
              vn: sessionNotes ? `${mv.vn || ''} [Sessione: +${hoursSpentDecimal}h - ${sessionNotes}]`.trim() : mv.vn,
            };
          }
          return mv;
        }) : [
          {
            n: selectedMv.name,
            hE: 4,
            hA: hoursSpentDecimal,
            s: 'done' as any,
            as: 1,
            d: 1,
            vn: sessionNotes ? `[Sessione: +${hoursSpentDecimal}h - ${sessionNotes}]` : undefined,
          }
        ];
        const newActualHours = newV.reduce((acc, v) => acc + (v.hA || 0), 0);
        return { ...m, v: newV, a: newActualHours };
      }
      return m;
    });

    const updatedPrj = { ...currentProject, mods: newMods };
    const savedArr = projects.map(p => String(p.id) === String(currentProject.id) ? updatedPrj : p);
    setProjects(savedArr);
    localStorage.setItem('bluman_custom_projects', JSON.stringify(savedArr));

    try {
      await salvaProgettoDettaglioApi(String(currentProject.id), updatedPrj);
    } catch {}

    alert(`✓ Consuntivate con successo ${hoursSpentDecimal}h (€ ${totalCost}) sulla pratica "${currentProject.n}"!`);
    setShowStopModal(false);
    setSeconds(0);
    setSessionNotes('');
    localStorage.removeItem('bluman_active_timer');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--card2)', border: `1.5px solid ${isRunning ? '#6366f1' : 'var(--border)'}`, borderRadius: 24, padding: '3px 8px', boxShadow: isRunning ? '0 0 14px rgba(99,102,241,0.3)' : 'none', transition: 'all 0.2s ease' }}>
      {/* Indicatore Stopwatch */}
      <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
        {isRunning ? '⏱️' : '⏳'}
      </span>

      {/* Selettore Progetto Rapido */}
      {projects.length > 0 ? (
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          disabled={isRunning}
          style={{
            background: 'var(--card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 600,
            maxWidth: 160,
            cursor: isRunning ? 'not-allowed' : 'pointer',
            outline: 'none',
            textOverflow: 'ellipsis',
          }}
          title="Seleziona la pratica su cui registrare il tempo"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id} style={{ background: 'var(--card)', color: 'var(--text)' }}>
              📁 {p.n} ({p.cl})
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/projects')}
          style={{
            background: 'var(--card)',
            color: 'var(--indigo-l)',
            border: '1px dashed var(--indigo)',
            borderRadius: 14,
            padding: '2px 8px',
            fontSize: 10.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
          title="Crea una nuova pratica per iniziare a tracciare il tempo"
        >
          ➕ Crea Pratica
        </button>
      )}

      {/* Display Tempo Digitale */}
      <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 800, color: isRunning ? '#818cf8' : 'var(--text)', letterSpacing: 0.5, minWidth: 55, textAlign: 'center' }}>
        {formatTime(seconds)}
      </div>

      {/* Controlli Timer */}
      {!isRunning ? (
        <button
          type="button"
          onClick={handleStart}
          style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
          title="Avvia Time Tracker"
        >
          ▶
        </button>
      ) : (
        <button
          type="button"
          onClick={handlePause}
          style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
          title="Pausa Timer"
        >
          ⏸
        </button>
      )}

      {seconds > 0 && (
        <button
          type="button"
          onClick={handleStop}
          style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
          title="Ferma e Registra Ore"
        >
          ⏹
        </button>
      )}

      {/* Modale Consuntivazione Fine Sessione */}
      {showStopModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--indigo-l)' }}>⏱ Consuntivazione Sessione di Lavoro</div>
              <button onClick={() => setShowStopModal(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: 10 }}>TEMPO REGISTRATO</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#818cf8', marginTop: 2 }}>{formatTime(seconds)} <span style={{ fontSize: 11, fontWeight: 500 }}>({hoursSpentDecimal}h)</span></div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: 10 }}>COSTO LAVORO EFFETTIVO</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#34d399', marginTop: 2 }}>€ {totalCost.toFixed(2)}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                👤 Operatore: <strong>{user?.nome || 'Avv. Mario Dibenedetto'}</strong> (Tariffa: {hourlyRate} €/h)
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                  Pratica di Imputazione:
                </label>
                {projects.length > 0 ? (
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        📁 {p.n} — Cliente: {p.cl}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 11, color: '#ef4444' }}>Nessuna pratica presente</div>
                )}
              </div>

              {microvociList.length > 0 && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                    Attività / Microvoce su cui imputare il tempo:
                  </label>
                  <select
                    value={selectedMicrovoceIdx}
                    onChange={(e) => setSelectedMicrovoceIdx(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 11.5, borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    {microvociList.map((mv, idx) => (
                      <option key={idx} value={idx}>
                        {mv.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                  Note Operative Sessione (opzionale):
                </label>
                <input
                  type="text"
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  placeholder="Es. Call con il cliente, redazione clausole fiduciarie, studio interpello..."
                  style={{ width: '100%', padding: '8px 12px', fontSize: 12, borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setShowStopModal(false);
                  setSeconds(0);
                  localStorage.removeItem('bluman_active_timer');
                }}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Annulla & Azzera
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveHours}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)' }}
              >
                💾 Salva & Registra Ore nel Progetto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
