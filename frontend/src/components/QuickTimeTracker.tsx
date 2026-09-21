import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProgetti, salvaProgettoDettaglioApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Progetto } from '../types';
import { useToast } from './ui/ToastProvider';

interface TimeTrackerProps {
  user?: any;
}

export function QuickTimeTracker({ user }: TimeTrackerProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [projects, setProjects] = useState<Progetto[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMicrovoceIdx, setSelectedMicrovoceIdx] = useState<number>(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');

  const timerRef = useRef<any>(null);

  const loadAllProjects = async () => {
    const list: Progetto[] = [];
    const currentTenantId = getCurrentTenantId(user);
    const storageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);

    // 1. Progetti salvati in local storage per questo specifico Tenant
    try {
      const savedStr = localStorage.getItem(storageKey);
      if (savedStr) {
        const arr = JSON.parse(savedStr);
        if (Array.isArray(arr)) {
          list.push(...arr);
        }
      }
    } catch {}

    // 2. Progetti salvati sul DB server Fastify / PostgreSQL filtrati per tenantId
    //
    // L'avanzamento arriva già calcolato dal server (§16): percentuale, stato e ore extra di ogni
    // modulo nascono dalle ore consuntivate sulle micro-voci. Qui venivano scartati e sostituiti
    // da costanti — 50% per ogni progetto e per ogni modulo, 20 ore preventivate, 3.500 € di
    // prezzo, 15.000 € di valore, scadenza 31/12/2026 — cioè esattamente i numeri che non si
    // muovevano mai. Dove il dato non c'è si mostra zero, non un valore inventato: un progetto
    // senza preventivo vale zero, e una scadenza non impostata è «—», non fine 2026.
    //
    // Quando lo stesso progetto esiste sia a database sia nella copia locale vince il database:
    // prima veniva scartato come duplicato della copia locale, e il timer consuntivava ore su
    // una fotografia vecchia dei moduli.
    try {
      const remote = await fetchProgetti();
      if (remote && Array.isArray(remote)) {
        const dalDb: Progetto[] = [];
        remote
          .filter((rp: any) => rp.tenantId === currentTenantId)
          .forEach((rp: any) => {
            const avanzamento = rp.avanzamento;
            // L'avanzamento dei moduli è indicizzato per id di database, non per posizione.
            const avModuli = new Map<string, any>(
              (avanzamento?.moduli || []).map((am: any) => [String(am.id), am]),
            );
            dalDb.push({
              id: rp.id,
              n: rp.nome,
              cl: rp.cliente?.nome || 'Cliente',
              ct: (rp.cliente?.tipo as any) || 'individual',
              st: avanzamento?.stato || rp.stato || 'in_progress',
              pct: avanzamento?.percentuale ?? 0,
              start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : '—',
              due: rp.dataScadenza || rp.scadenza
                ? new Date(rp.dataScadenza || rp.scadenza).toLocaleDateString('it-IT')
                : '—',
              val: rp.valoreTotale ? rp.valoreTotale / 100 : 0,
              delay: (avanzamento?.stato || rp.stato) === 'delayed' || rp.inRitardo || false,
              fisc: rp.regimeFiscale || 'privato_italia',
              fatture: rp.fatture || [],
              mods: (rp.moduli || []).map((m: any, mIdx: number) => {
                const av = avModuli.get(String(m.id));
                return {
                  id: mIdx + 100,
                  dbId: m.id,
                  n: m.nome,
                  cat: m.categoria || 'Societario',
                  st: av?.stato || m.stato || 'pending',
                  pct: av?.percentuale ?? 0,
                  h: m.orePreventivate ?? 0,
                  a: m.oreConsuntivate ?? 0,
                  p: m.prezzo ? m.prezzo / 100 : 0,
                  // La squadra vera sono le risorse assegnate alle micro-voci: finché non
                  // arrivano da qui, nessun volto è meglio di due volti inventati.
                  team: [],
                  delay: (av?.stato || m.stato) === 'delayed',
                  v: (m.microvoci || []).map((v: any) => ({
                    dbId: v.id,
                    n: v.titolo || v.nome,
                    hE: v.orePreventivate ?? 0,
                    hA: v.oreConsuntivate ?? 0,
                    s: v.stato || 'pending',
                    as: v.risorsaId ?? null,
                    d: v.ordine ?? 1,
                  })),
                } as any;
              }),
            } as any);
          });

        const idsDb = new Set(dalDb.map(p => String(p.id)));
        // I progetti locali restano solo se a database non esistono (creati prima che la
        // creazione passasse dal server).
        const soloLocali = list.filter(p => !idsDb.has(String(p.id)));
        list.length = 0;
        list.push(...dalDb, ...soloLocali);
      }
    } catch {}

    // 3. Se e solo se è il tenant demo Bluecode Ltd e non ci sono progetti salvati, carica i progetti di seed
    if (list.length === 0 && currentTenantId === BLUECODE_TENANT_ID) {
      const seed = getTenantSeedData(currentTenantId);
      list.push(...seed.projects);
    }

    setProjects(list);
    if (list.length > 0) {
      setSelectedProjectId(prev => (prev && list.some(p => String(p.id) === String(prev))) ? prev : String(list[0].id));
    } else {
      setSelectedProjectId('');
    }
  };

  useEffect(() => {
    loadAllProjects();

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
      toast.attenzione('Non hai ancora creato alcuna pratica. Clicca su "+ Nuovo Progetto" nella pagina Progetti per avviare il timer.');
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

  // Regola 7: la tariffa oraria non esiste nel modello utente del server, quindi qui non si
  // calcola alcun costo: prima c'era una tabella inventata per id numerico (1→120 €/h, 5→95,
  // 3→90, 4→85, altrimenti 45) applicata a chiunque, e gli importi mostrati come "costo lavoro
  // effettivo" non avevano alcuna fonte. Le ore registrate sono l'unico dato reale.
  const hoursSpentDecimal = Number((seconds / 3600).toFixed(2));

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
            // Regola 7: la riga nasce senza preventivo (hE 0, non 4 ore inventate), senza
            // assegnatario fittizio e senza documenti; le ore lavorate finiscono in hA.
            hE: 0,
            hA: hoursSpentDecimal,
            s: 'done' as any,
            d: 0,
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
    const currentTenantId = getCurrentTenantId(user);
    localStorage.setItem(getTenantStorageKey('bluman_custom_projects', currentTenantId), JSON.stringify(savedArr));

    // §3.3 — le ore sono salvate subito in locale (il timer non deve perdere dati), ma
    // l'alert deve dire se la sincronizzazione col server è riuscita: il catch vuoto
    // dichiarava sempre "consuntivate con successo" anche con la pratica non salvata sul DB.
    let syncOk = true;
    try {
      await salvaProgettoDettaglioApi(String(currentProject.id), updatedPrj);
    } catch {
      syncOk = false;
    }

    if (syncOk) {
      toast.successo(`Consuntivate con successo ${hoursSpentDecimal}h sulla pratica "${currentProject.n}"!`);
    } else {
      toast.attenzione(`${hoursSpentDecimal}h consuntivate in LOCALE sulla pratica "${currentProject.n}", ma NON sincronizzate col server. I dati restano disponibili su questo dispositivo: apri la scheda del progetto e salvala per ritentare la sincronizzazione.`);
    }
    setShowStopModal(false);
    setSeconds(0);
    setSessionNotes('');
    localStorage.removeItem('bluman_active_timer');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--card2)', border: `1.5px solid ${isRunning ? 'var(--indigo)' : 'var(--border)'}`, borderRadius: 24, padding: '3px 8px', boxShadow: isRunning ? '0 0 14px rgba(99,102,241,0.3)' : 'none', transition: 'all 0.2s ease' }}>
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
      <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 800, color: isRunning ? 'var(--indigo-l)' : 'var(--text)', letterSpacing: 0.5, minWidth: 55, textAlign: 'center' }}>
        {formatTime(seconds)}
      </div>

      {/* Controlli Timer */}
      {!isRunning ? (
        <button
          type="button"
          onClick={handleStart}
          style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
          title="Avvia Time Tracker"
        >
          ▶
        </button>
      ) : (
        <button
          type="button"
          onClick={handlePause}
          style={{ background: 'var(--amber)', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
          title="Pausa Timer"
        >
          ⏸
        </button>
      )}

      {seconds > 0 && (
        <button
          type="button"
          onClick={handleStop}
          style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer' }}
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
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 2 }}>{formatTime(seconds)} <span style={{ fontSize: 11, fontWeight: 500 }}>({hoursSpentDecimal}h)</span></div>
                </div>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: 10 }}>COSTO LAVORO</div>
                  {/* Regola 7: nessun costo calcolato con tariffe inventate per id operatore;
                      il server non espone una tariffa oraria, quindi il dato è dichiarato n/d. */}
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', marginTop: 2 }}>n/d</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                👤 Operatore: <strong>{user?.nome || user?.email || 'n/d'}</strong> (Tariffa: n/d)
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
                  <div style={{ fontSize: 11, color: 'var(--red)' }}>Nessuna pratica presente</div>
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
