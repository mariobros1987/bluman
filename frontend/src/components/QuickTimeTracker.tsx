import React, { useState, useEffect, useRef } from 'react';
import { loadTeamMembersFromDb } from '../hooks/useTeamMembers';
import { salvaProgettoDettaglioApi } from '../api/client';
import type { Progetto, TeamMember } from '../types';

interface TimeTrackerProps {
  user?: any;
}

export function QuickTimeTracker({ user }: TimeTrackerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [projects, setProjects] = useState<Progetto[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMicrovoceIdx, setSelectedMicrovoceIdx] = useState<number>(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const timerRef = useRef<any>(null);

  // Carica progetti e team members
  useEffect(() => {
    try {
      const savedStr = localStorage.getItem('bluman_custom_projects');
      if (savedStr) {
        const arr = JSON.parse(savedStr);
        if (Array.isArray(arr) && arr.length > 0) {
          setProjects(arr);
          setSelectedProjectId(String(arr[0].id));
        }
      }
    } catch {}

    loadTeamMembersFromDb().then(t => setTeamMembers(t));

    // Ripristina stato timer salvato
    try {
      const savedTimerStr = localStorage.getItem('bluman_active_timer');
      if (savedTimerStr) {
        const savedTimer = JSON.parse(savedTimerStr);
        if (savedTimer.isRunning && savedTimer.startTime) {
          const elapsed = Math.floor((Date.now() - savedTimer.startTime) / 1000) + (savedTimer.baseSeconds || 0);
          setSeconds(elapsed);
          setIsRunning(true);
          setSelectedProjectId(savedTimer.projectId || '');
          setSelectedMicrovoceIdx(savedTimer.mvIdx || 0);
        } else if (savedTimer.seconds) {
          setSeconds(savedTimer.seconds);
          setSelectedProjectId(savedTimer.projectId || '');
          setSelectedMicrovoceIdx(savedTimer.mvIdx || 0);
        }
      }
    } catch {}
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
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleStop = () => {
    setIsRunning(false);
    setShowStopModal(true);
  };

  const currentProject = projects.find(p => String(p.id) === String(selectedProjectId));
  const microvociList: { name: string; modId: number; mvIdx: number }[] = [];
  if (currentProject && currentProject.mods) {
    currentProject.mods.forEach(m => {
      if (m.v) {
        m.v.forEach((mv, idx) => {
          microvociList.push({ name: `${m.n}: ${mv.n}`, modId: m.id, mvIdx: idx });
        });
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
        const newV = (m.v || []).map((mv, idx) => {
          if (idx === selectedMv.mvIdx) {
            return {
              ...mv,
              hA: (mv.hA || 0) + hoursSpentDecimal,
              s: 'done',
              vn: sessionNotes ? `${mv.vn || ''} [Sessione: +${hoursSpentDecimal}h - ${sessionNotes}]`.trim() : mv.vn,
            };
          }
          return mv;
        });
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', border: `1.5px solid ${isRunning ? '#6366f1' : 'var(--border)'}`, borderRadius: 24, padding: '3px 10px', boxShadow: isRunning ? '0 0 12px rgba(99,102,241,0.25)' : 'none', transition: 'all 0.2s ease' }}>
      {/* Indicatore Stopwatch */}
      <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
        {isRunning ? '⏱️' : '⏳'}
      </span>

      {/* Selettore Progetto Rapido */}
      {projects.length > 0 && (
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          disabled={isRunning}
          style={{
            background: 'transparent',
            color: 'var(--text)',
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            maxWidth: 130,
            cursor: isRunning ? 'not-allowed' : 'pointer',
            outline: 'none',
            textOverflow: 'ellipsis',
          }}
          title="Seleziona la pratica su cui registrare il tempo"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id} style={{ background: 'var(--card)', color: 'var(--text)' }}>
              {p.n} ({p.cl})
            </option>
          ))}
        </select>
      )}

      {/* Display Tempo Digitale */}
      <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 800, color: isRunning ? '#818cf8' : 'var(--text)', letterSpacing: 0.5, minWidth: 60, textAlign: 'center' }}>
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
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, maxWidth: 460, width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
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
                  Pratica Selezionata:
                </label>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '8px 12px', background: 'var(--card2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  📁 {currentProject?.n} ({currentProject?.cl})
                </div>
              </div>

              {microvociList.length > 0 && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 4 }}>
                    Microvoce / Attività su cui imputare il tempo:
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
