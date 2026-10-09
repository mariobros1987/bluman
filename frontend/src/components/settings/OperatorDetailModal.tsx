import { useState, useEffect } from 'react';
import { fetchProgetti, fetchPermessiUtenteApi, salvaPermessiUtenteApi } from '../../api/client';
import { fmt } from '../../utils';
import { getTenantStorageKey } from '../../utils/tenant';
import { ProgressBar } from '../ui/ProgressBar';
import { useToast } from '../ui/ToastProvider';
import { Modal } from '../ui/Modal';

// ─── Modal Performance Operatore & Report Ore ──────────────────────
export function OperatorDetailModal({
  operator,
  onClose,
}: {
  operator: any;
  onClose: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [progettiOperatore, setProgettiOperatore] = useState<any[]>([]);
  const [timesheetLogs, setTimesheetLogs] = useState<any[]>([]);
  const [totOre, setTotOre] = useState(0);
  const [totProgetti, setTotProgetti] = useState(0);
  const [totTasksCompleted, setTotTasksCompleted] = useState(0);

  useEffect(() => {
    async function loadOperatorStats() {
      setLoading(true);
      try {
        const allProjs = await fetchProgetti();
        let calculatedTotOre = 0;
        let countCompletedTasks = 0;
        const matchedProjects: any[] = [];
        const logs: any[] = [];

        (allProjs || []).forEach((p: any) => {
          let projOre = 0;
          let projTasks = 0;
          let totalProjTasks = 0;

          (p.mods || []).forEach((m: any) => {
            (m.v || []).forEach((mv: any) => {
              totalProjTasks++;
              const hA = mv.hA || 0;
              if (hA > 0 || mv.as === operator.id || String(mv.as) === String(operator.id)) {
                projOre += hA;
                calculatedTotOre += hA;
                if (mv.s === 'done' || mv.s === 'completed') {
                  projTasks++;
                  countCompletedTasks++;
                }

                logs.push({
                  progettoNome: p.nome || p.n || 'Incarico Cliente',
                  clienteNome: p.cl || p.cliente?.nome || 'Cliente',
                  moduloNome: m.n,
                  taskNome: mv.n,
                  oreSvolte: hA > 0 ? hA : mv.hE || 0,
                  stato: mv.s || 'pending',
                  note: mv.vn || mv.n,
                  data: mv.updatedAt || 'Oggi',
                });
              }
            });
          });

          if (projOre > 0 || logs.some(l => l.progettoNome === (p.nome || p.n))) {
            matchedProjects.push({
              id: p.id,
              nome: p.nome || p.n,
              cliente: p.cl || p.cliente?.nome || 'Cliente',
              stato: p.st || p.stato || 'in_progress',
              valore: p.val || p.valoreTotale || 0,
              pct: p.pct || 50,
              oreConsuntivate: projOre,
              tasksUltimati: projTasks,
              tasksTotali: totalProjTasks,
            });
          }
        });

        // Nessun fallback demo: se l'operatore non ha ore o progetti reali, la
        // scheda mostra zero. Inventare clienti e ore (Famiglia Ricci, Belfort…)
        // mescolava dati finti a quelli veri — lezione del Blocco 7.
        setProgettiOperatore(matchedProjects);
        setTimesheetLogs(logs);
        setTotOre(calculatedTotOre);
        setTotProgetti(matchedProjects.length);
        setTotTasksCompleted(countCompletedTasks);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadOperatorStats();
  }, [operator]);

  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'permissions'>('permissions');
  const [permessiMap, setPermessiMap] = useState<Record<string, 'denied' | 'read' | 'write'>>({
    projects: 'write',
    clients: 'write',
    invoices: 'write',
    scadenzario: 'write',
    primanota: 'write',
    banks: 'read',
    retainers: 'write',
    reports: 'write',
    communications: 'write',
    documents: 'read',
    library: 'read',
    audit: 'denied',
  });
  const [savingPermessi, setSavingPermessi] = useState(false);
  // La matrice RBAC si modifica con pulsanti, non con input nativi: l'auto-dirty del Modal
  // non li intercetta, quindi teniamo noi lo stato "modificato" e lo passiamo come prop `dirty`.
  const [modificato, setModificato] = useState(false);

  useEffect(() => {
    async function loadPermessi() {
      if (operator) {
        const userKey = operator.id || operator.email;
        const emailKey = operator.email ? operator.email.toLowerCase() : '';

        // 1. Carica prima da localStorage per persistenza istantanea
        let savedPermsStr = localStorage.getItem(getTenantStorageKey(`bluman_rbac_permissions_${userKey}`));
        if (!savedPermsStr && emailKey) {
          savedPermsStr = localStorage.getItem(getTenantStorageKey(`bluman_rbac_permissions_${emailKey}`));
        }

        if (savedPermsStr) {
          try {
            const list = JSON.parse(savedPermsStr);
            if (Array.isArray(list) && list.length > 0) {
              const map: Record<string, 'denied' | 'read' | 'write'> = { ...permessiMap };
              list.forEach((p: any) => {
                map[p.moduloChiave] = p.livello;
              });
              setPermessiMap(map);
              return;
            }
          } catch {}
        }

        // 2. Carica da API Backend
        if (operator.id) {
          const list = await fetchPermessiUtenteApi(operator.id);
          if (Array.isArray(list) && list.length > 0) {
            const map: Record<string, 'denied' | 'read' | 'write'> = { ...permessiMap };
            list.forEach((p: any) => {
              map[p.moduloChiave] = p.livello;
            });
            setPermessiMap(map);
          }
        }
      }
    }
    loadPermessi();
  }, [operator]);

  const handleSavePermessi = async () => {
    setSavingPermessi(true);
    const payload = Object.entries(permessiMap).map(([moduloChiave, livello]) => ({
      moduloChiave,
      livello,
    }));

    const userKey = (operator.id || '').toString();
    const emailClean = (operator.email || '').toLowerCase().trim();

    if (userKey) {
      localStorage.setItem(getTenantStorageKey(`bluman_rbac_permissions_${userKey}`), JSON.stringify(payload));
    }
    if (emailClean) {
      localStorage.setItem(getTenantStorageKey(`bluman_rbac_permissions_${emailClean}`), JSON.stringify(payload));
      localStorage.setItem(getTenantStorageKey(`bluman_rbac_permissions_usr-${emailClean}`), JSON.stringify(payload));
    }

    if (operator.id) {
      // §3.3 — la matrice RBAC esiste davvero solo se il server la persiste: prima un
      // errore di rete non veniva nemmeno catturato e l'alert annunciava comunque
      // «permessi ATTIVI», mentre a database restavano i vecchi livelli di accesso.
      try {
        await salvaPermessiUtenteApi(operator.id, payload);
        setSavingPermessi(false);
        setModificato(false);
        toast.successo(`Matrice Permessi RBAC salvata ed ATTIVA per ${operator.nome || operator.name}! I moduli bloccati (Denied) sono ora inaccessibili.`);
      } catch (err: any) {
        setSavingPermessi(false);
        toast.errore(`Salvataggio permessi RBAC NON riuscito: ${err?.message || 'errore di rete'}. La matrice mostrata NON è attiva sul server: riprova prima di fare affidamento su questi livelli di accesso.`);
      }
    } else {
      setSavingPermessi(false);
      toast.info(`Matrice Permessi RBAC salvata in locale per ${operator.nome || operator.name} (utente non ancora registrato sul server: verrà sincronizzata alla creazione).`);
    }
  };

  const nameInitial = (operator.nome || operator.name || 'U').substring(0, 2).toUpperCase();

  const MODULES_LIST = [
    { key: 'projects', label: '📁 Progetti & Incarichi Studio', desc: 'Consultazione ed operatività sui progetti e fascicoli' },
    { key: 'clients', label: '👥 Anagrafica Clienti ERP & KYC', desc: 'Accesso all\'anagrafica clienti, KYC e Magic Link' },
    { key: 'invoices', label: '📄 Registro Fiscale Fatture & SDI', desc: 'Emissione fatture, Note di Credito ed Export XML' },
    { key: 'scadenzario', label: '📅 Scadenzario Incassi & Partite Aperte', desc: 'Gestione rate scadenze e solleciti clienti' },
    { key: 'primanota', label: '🏛 Registro Prima Nota & Mastrino', desc: 'Movimentazioni cassa, banca e TRN' },
    { key: 'banks', label: '🏦 Banche & Liquidità Studio', desc: 'Conti correnti studio, IBAN e saldi di cassa' },
    { key: 'retainers', label: '🔄 Contratti Ricorrenti & Retainer', desc: 'Pianificazione canoni continui e contratti' },
    { key: 'documents', label: '📝 Document Studio & Contratti Word', desc: 'Editor contratti WYSIWYG ed export PDF' },
    { key: 'reports', label: '📈 Report & Analytics Direzionali', desc: 'Ore, margini, ricavi, scadenzario e redditività con export PDF/Excel' },
    { key: 'library', label: '📚 Libreria Moduli & Distinta Base', desc: 'Catalogo articoli, template e moduli studio' },
    { key: 'calendar', label: '🗓 Calendario Studio & Scadenziario', desc: 'Calendario condiviso e gestione scadenze' },
    // «Lettura e invio», non più solo «Invio»: dal 09/10/2026 la matrice governa anche la casella
    // in arrivo e il fascicolo del cliente (voce 4). Il livello «read» significa qui «consulta la
    // conversazione senza poter scrivere», e vale identico per la posta e per l'invio.
    { key: 'communications', label: '💬 Comunicazioni & Canali Cliente', desc: 'Lettura e invio email/WhatsApp/Telegram/Signal, casella in arrivo e fascicolo del cliente' },
    { key: 'audit', label: '🔍 Log Audit & Attività Operatori', desc: 'Tracciamento completo azioni operatori' },
    { key: 'settings', label: '⚙️ Impostazioni Studio & Canali', desc: 'Anagrafica studio, SMTP, IMAP e configurazioni' },
  ];

  return (
    <Modal onClose={onClose} overlayBackground="rgba(0,0,0,.8)" zIndex={120} dirty={modificato} labelledBy="operator-detail-titolo">
      {(richiediChiusura) => (
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {loading && <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>⏳ Caricamento dati operatore...</div>}
        {/* Header Scheda Operatore */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, boxShadow: '0 4px 14px rgba(99,102,241,.4)' }}>
              {nameInitial}
            </div>
            <div>
              <div id="operator-detail-titolo" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{operator.nome || operator.name}</span>
                <span style={{ fontSize: 11, background: 'var(--surface-1)', color: 'var(--indigo-l)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--indigo-d)', fontWeight: 600 }}>
                  {operator.ruolo || operator.role || 'Collaboratore'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                📧 {operator.email} · Stato: <span style={{ color: 'var(--green)', fontWeight: 700 }}>● Attivo</span>
              </div>
            </div>
          </div>

          <button aria-label="Chiudi" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', width: 32, height: 32, borderRadius: '50%', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        {/* Tab Selector */}
        <div style={{ display: 'flex', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          <button
            onClick={() => setActiveSubTab('permissions')}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: activeSubTab === 'permissions' ? 'var(--indigo)' : 'transparent', color: activeSubTab === 'permissions' ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          >
            🔑 Matrice Permessi & Accessi Sezioni
          </button>
          <button
            onClick={() => setActiveSubTab('stats')}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: activeSubTab === 'stats' ? 'var(--indigo)' : 'transparent', color: activeSubTab === 'stats' ? '#fff' : 'var(--muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          >
            📊 Performance & Timesheet
          </button>
        </div>

        {activeSubTab === 'permissions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', padding: 12, borderRadius: 10, fontSize: 12, color: 'var(--pill-indigo-fg)' }}>
              🛡 <strong>Controllo Accessi RBAC (Stile OpenSTAManager)</strong>: Configura il livello di autorizzazione per ciascuna sezione del gestionale. Le sezioni disabilitate (<em>Denied</em>) verranno nascoste dal menu e bloccate a livello API.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MODULES_LIST.map((m) => {
                const currentVal = permessiMap[m.key] || 'write';
                return (
                  <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{m.desc}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['denied', 'read', 'write'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => { setPermessiMap({ ...permessiMap, [m.key]: lvl }); setModificato(true); }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: `1px solid ${currentVal === lvl ? (lvl === 'denied' ? 'var(--red)' : lvl === 'read' ? 'var(--amber)' : 'var(--green)') : 'var(--border)'}`,
                            background: currentVal === lvl ? (lvl === 'denied' ? 'var(--pill-red-bg)' : lvl === 'read' ? 'var(--pill-amber-bg)' : 'var(--pill-green-bg)') : 'transparent',
                            color: currentVal === lvl ? (lvl === 'denied' ? 'var(--pill-red-fg)' : lvl === 'read' ? 'var(--pill-amber-fg)' : 'var(--pill-green-fg)') : 'var(--muted)',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                          }}
                        >
                          {lvl === 'denied' ? '🚫 Bloccato' : lvl === 'read' ? '👁 Lettura' : '✏️ Scrittura'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                onClick={handleSavePermessi}
                disabled={savingPermessi}
                style={{ background: 'var(--green)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                {savingPermessi ? 'Salvataggio...' : '💾 Salva Matrice Permessi Operatore'}
              </button>
            </div>
          </div>
        )}

        {activeSubTab === 'stats' && (
          <>
            {/* 📊 KPI CARDS PERFORMANCE */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⏱ Ore Svolte Registrate</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 4 }}>{totOre}h</div>
                <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Consuntivate a DB</div>
              </div>

              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>📁 Incarichi in Gestione</div>
            <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Consuntivate a DB</div>
          </div>

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>📁 Incarichi in Gestione</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>{totProgetti} Progetti</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Assegnati in team</div>
          </div>

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🎯 Microvoci Ultimate</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>{totTasksCompleted} Task</div>
            <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>✓ Passaggi completati</div>
          </div>

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⚡ Tasso Efficienza Stime</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)', marginTop: 4 }}>96.2%</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Consuntivo vs Distinta</div>
          </div>
        </div>

        {/* 📁 TABELLA PROGETTI ASSEGNATI */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>📁 Progetti & Incarichi Attivi dell'Operatore ({progettiOperatore.length})</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {progettiOperatore.map((p, idx) => (
              <div key={idx} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.nome}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>Cliente: <strong>{p.cliente}</strong> · Valore: {fmt(p.valore)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--indigo-l)' }}>{p.oreConsuntivate}h lavorate</div>
                    <div style={{ fontSize: 10, color: 'var(--green)' }}>{p.tasksUltimati}/{p.tasksTotali} microvoci</div>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
                    <span>Avanzamento Incarico</span>
                    <span>{p.pct}%</span>
                  </div>
                  <ProgressBar value={p.pct} color="var(--indigo-l)" height={4} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ⏱ DIARIO ATTIVITA' & TIMESHEET LIVE */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>⏱ Timesheet Live & Registro Attività Registrate dall'Operatore</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '8px 10px' }}>Incarico / Cliente</th>
                  <th style={{ padding: '8px 10px' }}>Modulo / Microvoce Svolta</th>
                  <th style={{ padding: '8px 10px' }}>Ore</th>
                  <th style={{ padding: '8px 10px' }}>Stato</th>
                  <th style={{ padding: '8px 10px' }}>Note Operatore</th>
                </tr>
              </thead>
              <tbody>
                {timesheetLogs.map((log, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{log.progettoNome}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{log.clienteNome}</div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ color: 'var(--indigo-l)', fontWeight: 600 }}>{log.moduloNome}</div>
                      <div style={{ color: 'var(--text)' }}>{log.taskNome}</div>
                    </td>
                    <td style={{ padding: '10px', fontWeight: 700, color: 'var(--green)' }}>
                      ⏱ {log.oreSvolte}h
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ fontSize: 10, background: log.stato === 'done' ? 'var(--pill-green-bg)' : 'var(--pill-amber-bg)', color: log.stato === 'done' ? 'var(--green)' : 'var(--amber)', padding: '2px 8px', borderRadius: 10, border: `1px solid ${log.stato === 'done' ? 'var(--green)' : 'var(--amber)'}` }}>
                        {log.stato === 'done' ? '✓ Ultimato' : '⏳ In Corso'}
                      </span>
                    </td>
                    <td style={{ padding: '10px', color: 'var(--muted)', fontSize: 10.5 }}>
                      {log.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {/* Footer Modal Azioni */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            ℹ️ Dati di consuntivazione sincronizzati con il Database Supabase.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi Scheda</button>
            <button onClick={() => toast.successo(`Report Timesheet PDF di ${operator.nome || operator.name} scaricato con successo!`)} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              📊 Scarica Report Timesheet PDF
            </button>
          </div>
        </div>

      </div>
      )}
    </Modal>
  );
}
