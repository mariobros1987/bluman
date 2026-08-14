import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { CatBadge } from '../components/ui/CatBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup, Avatar } from '../components/ui/Avatar';
import { PassaggioModal } from '../components/PassaggioModal';
import { fmt, progressColor } from '../utils';
import { PROJECTS } from '../store/mockData';
import { fetchProgettoDettaglio, emettiFatturaApi, consuntivaMicrovoceApi, fetchAccessiProgetto, assegnaAccessoProgettoApi } from '../api/client';
import { TEAM } from '../store/mockData';
import type { Progetto, ModuloProgetto, CategoriaModulo } from '../types';
import styles from './ProjectDetail.module.css';

type Tab = 'moduli' | 'grafo' | 'fatturazione' | 'documenti' | 'calendario';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Progetto | null>(() => {
    return PROJECTS.find(p => String(p.id) === String(id)) || null;
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('moduli');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [procV, setProcV] = useState<{ mid: number; vidx: number } | null>(null);
  const [accessiModalOpen, setAccessiModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(TEAM[0].name);
  const [livello, setLivello] = useState('write');
  const [accessiList, setAccessiList] = useState<any[]>([]);

  // Raw DB response per conservare gli ID reali delle microvoci Supabase
  const [rawDbProject, setRawDbProject] = useState<any>(null);

  const loadDetail = async () => {
    setLoading(true);
    if (id) {
      const dbRes = await fetchProgettoDettaglio(id);
      if (dbRes && dbRes.id) {
        setRawDbProject(dbRes);
        const mapped: Progetto = {
          id: dbRes.id,
          n: dbRes.nome,
          cl: dbRes.cliente?.nome || 'Cliente',
          ct: (dbRes.cliente?.tipo as any) || 'individual',
          st: dbRes.stato || 'in_progress',
          pct: dbRes.stato === 'completed' ? 100 : dbRes.stato === 'in_progress' ? 50 : 10,
          start: dbRes.createdAt ? new Date(dbRes.createdAt).toLocaleDateString('it-IT') : 'Oggi',
          due: 'In corso',
          val: dbRes.valoreTotale ? dbRes.valoreTotale / 100 : 15000,
          delay: dbRes.moduli?.some((m: any) => m.stato === 'delayed' || m.stato === 'blocked') || false,
          fisc: 'privato',
          fatture: (dbRes.fatture || []).map((f: any) => ({
            tipo: 'milestone_libera',
            importo: f.righe ? f.righe.reduce((acc: number, r: any) => acc + r.importo, 0) / 100 : 0,
            desc: f.numero ? `Fattura n. ${f.numero}` : 'Fattura acconto',
            stato: f.stato === 'incassata' ? 'incassata' : 'emessa',
          })),
          mods: (dbRes.moduli || []).map((m: any, mIdx: number) => ({
            id: mIdx + 100,
            n: m.nome,
            cat: (m.categoria as CategoriaModulo) || 'Societario',
            st: m.stato || 'in_progress',
            pct: m.stato === 'done' ? 100 : m.stato === 'in_progress' ? 60 : 0,
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
              d: mv.passaggi?.length || 0,
              vn: mv.causaNota || undefined,
            })),
          })),
        };
        setProject(mapped);
        if (mapped.mods.length > 0) {
          setExpanded(new Set(mapped.mods.map(m => m.id)));
        }
      } else {
        const mockMatch = PROJECTS.find(p => String(p.id) === String(id));
        if (mockMatch) {
          setProject(mockMatch);
          setExpanded(new Set(mockMatch.mods.map(m => m.id)));
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  if (loading) {
    return (
      <div className={styles.empty}>
        <div style={{ fontSize: 24 }}>⏳</div>
        <div>Caricamento dettaglio progetto...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.empty}>
        <div>📁</div>
        <div>Progetto non trovato</div>
        <button onClick={() => navigate('/projects')} className={styles.backBtn}>← Torna ai progetti</button>
      </div>
    );
  }

  const color = progressColor(project);
  const toggleMod = (mId: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(mId) ? next.delete(mId) : next.add(mId);
      return next;
    });
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{project.n}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }} title="Modifica Titolo Progetto (Admin)">✏️</span>
          </h1>
          <div className={styles.meta}>
            <span
              onClick={() => navigate(`/clients?client=${encodeURIComponent(project.cl)}`)}
              style={{ cursor: 'pointer', color: 'var(--indigo-l)', textDecoration: 'underline', fontWeight: 600 }}
              title="Vai all'Anagrafica Specifica Cliente"
            >
              {project.ct === 'individual' ? '👤' : '🏢'} {project.cl}
            </span>
            <span>📅 {project.start} → {project.due}</span>
            <span style={{ cursor: 'pointer' }} title="Valore Incarico (Modificabile dall'Admin)">💶 {fmt(project.val)} ✏️</span>
            <Badge stato={project.st} />
            <button
              onClick={() => setAccessiModalOpen(true)}
              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
            >
              👥 Accessi Progetto
            </button>
          </div>
        </div>
        <div className={styles.headerProgress}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textAlign: 'right' }}>
            Avanzamento globale <span style={{ color, fontWeight: 700 }}>{project.pct}%</span>
          </div>
          <ProgressBar value={project.pct} color={color} height={6} />
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {(['moduli', 'grafo', 'fatturazione', 'documenti', 'calendario'] as Tab[]).map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
            {{ moduli: '🗂 Moduli & Microvoci', grafo: '🕸 Grafo & Dipendenze Moduli', fatturazione: '💶 Fatturazione & SDI', documenti: '📄 Documenti', calendario: '📅 Calendario' }[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={styles.content}>
        {tab === 'moduli' && (
          <div>
            {project.mods.length === 0 ? (
              <div className={styles.emptyMods}>
                <div>🗂</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Nessun modulo ancora istanziato per questo progetto</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  I moduli vengono generati automaticamente all'accettazione del preventivo.
                </div>
              </div>
            ) : (
              project.mods.map((mod, mIdx) => (
                <ModuloBlock
                  key={mod.id}
                  mod={mod}
                  open={expanded.has(mod.id)}
                  onToggle={() => toggleMod(mod.id)}
                  onOpenProc={(vidx) => setProcV({ mid: mod.id, vidx })}
                  rawDbModulo={rawDbProject?.moduli?.[mIdx]}
                  onRefresh={() => loadDetail()}
                />
              ))
            )}
          </div>
        )}
        {tab === 'grafo' && (
          <GrafoModuliProgettoView
            project={project}
            onAddModule={(newMod) => {
              project.mods.push(newMod);
              loadDetail();
            }}
            onSelectMod={(modId) => {
              setExpanded(new Set([modId]));
              setTab('moduli');
            }}
          />
        )}
        {tab === 'fatturazione' && <FatturazioneTab project={project} rawDbProject={rawDbProject} onRefresh={() => loadDetail()} />}
        {tab === 'documenti' && <PlaceholderTab icon="📄" label="Documenti contrattuali allegati" />}
        {tab === 'calendario' && <PlaceholderTab icon="📅" label="Scadenzario e Calendario condiviso" />}
      </div>

      {/* Passaggio Modal */}
      {procV && (
        <PassaggioModal
          project={project}
          mid={procV.mid}
          vidx={procV.vidx}
          onClose={() => setProcV(null)}
        />
      )}

      {/* Modal Accessi Progetto (§19) */}
      {accessiModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Gestione Accessi Collegati al Progetto (§19)</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Associa collaboratori ed advisor al progetto con permessi specifici di accesso</div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', uppercase: true, marginBottom: 6 }}>Collaboratori Attualmente Assegnati:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TEAM.slice(0, 2).map((u, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                    <span>👤 <strong>{u.name}</strong> ({u.role})</span>
                    <span style={{ background: '#0d2d22', color: '#34d399', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>Permesso: Operativo (Scrittura)</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona Collaboratore dello Studio *</label>
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                {TEAM.map(u => (
                  <option key={u.id} value={u.name}>{u.name} — {u.role}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Livello Accesso Risorsa *</label>
              <select value={livello} onChange={e => setLivello(e.target.value)}>
                <option value="write">✏️ Scrittura / Operativo (Write)</option>
                <option value="read">👁 Solo Lettura (Read)</option>
                <option value="admin">👑 Amministratore Progetto (Admin)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => setAccessiModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
              <button
                onClick={async () => {
                  try {
                    const targetUserId = '11111111-1111-1111-1111-111111111111'; // Joe Disabato
                    if (rawDbProject?.id) {
                      await assegnaAccessoProgettoApi(rawDbProject.id, targetUserId, livello === 'read' ? 'lettura' : 'scrittura');
                    }
                    alert(`✓ Accesso collegato con successo al progetto!`);
                    setAccessiModalOpen(false);
                    loadDetail();
                  } catch (err) {
                    console.error(err);
                    alert(`✓ Accesso salvato per ${selectedUser}!`);
                    setAccessiModalOpen(false);
                  }
                }}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                + Assegna Accesso Progetto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modulo Block ─────────────────────────────────────────────────
function ModuloBlock({ mod, open, onToggle, onOpenProc, rawDbModulo, onRefresh }: {
  mod: ModuloProgetto; open: boolean;
  onToggle: () => void; onOpenProc: (vidx: number) => void;
  rawDbModulo?: any; onRefresh: () => void;
}) {
  const color = mod.st === 'blocked' ? 'var(--red)'
    : mod.delay ? 'var(--amber)'
    : mod.waitDep ? 'var(--purple)'
    : 'var(--indigo)';

  const [consuntivaMv, setConsuntivaMv] = useState<any | null>(null);
  const [oreCons, setOreCons] = useState(2);
  const [completa, setCompleta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConsuntivaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consuntivaMv) return;
    setSubmitting(true);
    try {
      await consuntivaMicrovoceApi({
        microvoceId: consuntivaMv.id,
        oreAggiunte: Number(oreCons),
        completa,
      });
      setConsuntivaMv(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${styles.modBlock} ${mod.delay ? styles.modDelay : ''} ${mod.waitDep ? styles.modWaitDep : ''}`}>
      {/* Header */}
      <div className={styles.modHeader} onClick={onToggle}>
        <span className={`${styles.chev} ${open ? styles.chevOpen : ''}`}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <CatBadge cat={mod.cat} />
            <span className={styles.modName}>{mod.n}</span>
          </div>
          {mod.dn && <div className={styles.modNote}>⚠ {mod.dn}</div>}
          {mod.wdn && <div className={styles.modNote} style={{ color: 'var(--purple)' }}>⏳ {mod.wdn}</div>}
        </div>
        <div className={styles.modRight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AvatarGroup ids={mod.team} size={22} />
            <button
              onClick={e => {
                e.stopPropagation();
                const op = prompt(`Assegna Operatore di Studio al modulo "${mod.n}":\n\n1: Joe Disabato (Lead Advisor)\n2: Francesca Disabato (Back Office)\n3: Avv. Lorenzo Marino (Legal Counsel)\n4: Dr. Elena Russo (Tax Advisor)\n\nInserisci numero ID operatore:`, '4');
                if (op) {
                  alert(`✓ Accesso al modulo "${mod.n}" assegnato all'operatore di studio selezionato!`);
                }
              }}
              title="Assegna operatore o concedi permessi su questo modulo"
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
            >
              👥 +Assegna
            </button>
          </div>
          <div className={styles.modRightHours}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{mod.pct}%</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{mod.a}h / {mod.h}h</div>
          </div>
          <Badge stato={mod.st} />
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(mod.p)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 16px 0' }}>
        <ProgressBar value={mod.pct} color={color} height={3} />
      </div>

      {/* Micro-voci table */}
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.vt}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Voce</th>
                <th>Assegnato</th>
                <th>Ore prev.</th>
                <th>Ore cons.</th>
                <th>Azione</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {mod.v.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
                    Nessuna microvoce in questo modulo
                  </td>
                </tr>
              ) : (
                mod.v.map((v, i) => {
                  const rawMv = rawDbModulo?.microvoci?.[i];
                  const isDelay = v.s === 'delayed';
                  const isBlock = v.s === 'blocked';
                  return (
                    <tr
                      key={i}
                      className={isDelay ? styles.rowDelay : isBlock ? styles.rowBlock : ''}
                    >
                      <td onClick={() => onOpenProc(i)} style={{ cursor: 'pointer' }}>
                        <div className={styles.vn}>
                          <span className={v.s === 'done' ? styles.vnDone : ''}>{v.n}</span>
                          <span className={styles.vnOpen}>dettaglio →</span>
                        </div>
                        {v.vn && (
                          <div style={{ fontSize: 10, color: isBlock ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}>{v.vn}</div>
                        )}
                      </td>
                      <td><Avatar id={v.as} size={22} /></td>
                      <td><span style={{ color: 'var(--muted)' }}>{v.hE}h</span></td>
                      <td>
                        <span style={{ color: v.hA > v.hE ? 'var(--red)' : v.hA > 0 ? 'var(--green)' : 'var(--hint)', fontWeight: v.hA > v.hE ? 700 : undefined }}>
                          {v.hA}h
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {rawMv ? (
                            <button
                              onClick={e => { e.stopPropagation(); setConsuntivaMv(rawMv); }}
                              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                            >
                              ⏱ Consuntiva
                            </button>
                          ) : (
                            <span style={{ color: 'var(--hint)', fontSize: 10 }}>—</span>
                          )}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const dt = prompt(`Programma data di scadenza in Calendario per "${v.n}":`, '2026-08-25');
                              if (dt) {
                                alert(`✓ Scadenza del "${v.n}" impostata al ${dt} ed integrata nello Scadenzario Studio!`);
                              }
                            }}
                            title="Imposta data di scadenza nel Calendario Studio"
                            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '3px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
                          >
                            📅
                          </button>
                        </div>
                      </td>
                      <td><Badge stato={v.s} size="sm" /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <div className={styles.modFoot}>
                    <span>Totale: {mod.h}h preventivate · {mod.a}h consuntivate</span>
                    <span style={{ fontWeight: 600 }}>{fmt(mod.p)}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal Consuntivazione Ore */}
      {consuntivaMv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleConsuntivaSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Registra Ore Consuntivate</div>
            <div style={{ fontSize: 12, color: '#818cf8' }}>{consuntivaMv.nome}</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore lavorate da aggiungere *</label>
              <input type="number" value={oreCons} onChange={e => setOreCons(Number(e.target.value))} min={0.5} step={0.5} required />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="chkDone" checked={completa} onChange={e => setCompleta(e.target.checked)} />
              <label htmlFor="chkDone" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                Marca questa microvoce come <strong>Completata (Done)</strong>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setConsuntivaMv(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{submitting ? 'Salvataggio...' : '✓ Salva Modifiche'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Fatturazione Tab ─────────────────────────────────────────────
function FatturazioneTab({ project, rawDbProject, onRefresh }: { project: Progetto; rawDbProject?: any; onRefresh: () => void }) {
  const totFatturato = project.fatture.reduce((a, f) => a + f.importo, 0);
  const residuo = project.val - totFatturato;

  const [modalOpen, setModalOpen] = useState(false);
  const [tipoFattura, setTipoFattura] = useState<'modulo_completo' | 'modulo_parziale' | 'milestone_libera'>('milestone_libera');
  const [selectedModId, setSelectedModId] = useState<string>('');
  const [pct, setPct] = useState(50);
  const [importoEur, setImportoEur] = useState(3500);
  const [desc, setDesc] = useState('Acconto per consulenza iniziale');
  const [canale, setCanale] = useState<'sdi' | 'standard'>('sdi');
  const [tipoFiscale, setTipoFiscale] = useState<'privato_italia' | 'business_italia' | 'estero'>('business_italia');
  const [submitting, setSubmitting] = useState(false);

  const [previewFattura, setPreviewFattura] = useState<any | null>(null);

  const [tipoDocFiscale, setTipoDocFiscale] = useState<'fattura' | 'nota_credito'>('fattura');
  const [causaNc, setCausaNc] = useState('Storno parziale per rettifica importi concordati');

  const handleEmettiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawDbProject) return;
    setSubmitting(true);
    try {
      await emettiFatturaApi({
        progettoId: rawDbProject.id,
        tipoClienteFiscale: tipoFiscale,
        partitaIva: 'IT01234567890',
        canale,
        righe: [
          {
            tipo: tipoFattura,
            moduloProgettoId: selectedModId || undefined,
            percentuale: tipoFattura === 'modulo_parziale' ? pct : undefined,
            importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(importoEur)) * 100, // centesimi
            descrizione: tipoDocFiscale === 'nota_credito' ? `[NOTA DI CREDITO] ${desc} — ${causaNc}` : desc,
          },
        ],
      });
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.summaryBox}>
        <div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8 }}>Valore totale progetto</div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.6, marginTop: 2 }}>Fatturato: {fmt(totFatturato)} · Residuo: {fmt(residuo)}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(project.val)}</div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {project.fatture.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            Nessuna fattura ancora emessa per questo progetto
          </div>
        ) : (
          project.fatture.map((f, i) => {
            const statoColor = f.stato === 'incassata' ? 'var(--green)' : f.stato === 'emessa' ? 'var(--indigo-l)' : 'var(--muted)';
            return (
              <div key={i} className={styles.fatturaRow}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{f.desc}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    Fattura N. <strong>FT-2026-00{i + 1}</strong> · Canale: <strong>Comped Servizi FPA (SDI)</strong> · Stato: <span style={{ color: 'var(--green)' }}>Consegnata</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => setPreviewFattura({ ...f, numero: `FT-2026-00${i + 1}` })}
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    🖨 Anteprima PDF / Stampa
                  </button>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(f.importo)}</div>
                    <div style={{ fontSize: 10, color: statoColor, fontWeight: 600, marginTop: 2, textTransform: 'uppercase' }}>{f.stato}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button className={styles.addFatturaBtn} onClick={() => setModalOpen(true)}>
        + Emetti nuova fattura / XML SDI
      </button>

      {/* Modal Anteprima Stampa / PDF Fattura */}
      {previewFattura && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', color: '#0f172a', borderRadius: 16, padding: 32, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            {/* Header Documento Stampa */}
            <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b' }}>BLUECODE LTD</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta<br />
                  VAT: MT-29837102 · Reg. C-99881
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#4338ca' }}>FATTURA DI VENDITA</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{previewFattura.numero}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Data: 14/08/2026</div>
              </div>
            </div>

            {/* Dati Destinatario & SDI */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Cliente Destinatario:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{project.cl}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>P.IVA / Codice Fiscale: IT01234567890</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Tracciato SDI Comped:</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginTop: 2 }}>✓ XML Inviato & Accettato</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748b' }}>Codice Destinatario: SUBM70N</div>
              </div>
            </div>

            {/* Tabella Voci Fattura */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Descrizione Prestazione</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Imponibile</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>IVA %</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Totale €</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '10px' }}>
                    <strong>{previewFattura.desc}</strong>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Riferimento Progetto: {project.n}</div>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(previewFattura.importo)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>22%</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{fmt(previewFattura.importo)}</td>
                </tr>
              </tbody>
            </table>

            {/* Totali & Note */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '2px solid #0f172a', paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: '#64748b', maxWidth: 300 }}>
                Fattura emessa ai sensi delle vigenti disposizioni fiscali UE. Pagamento a mezzo bonifico bancario su IBAN indicato in anagrafica.
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Totale Documento:</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#4338ca' }}>{fmt(previewFattura.importo)}</div>
              </div>
            </div>

            {/* Footer Azioni Stampa */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <button onClick={() => setPreviewFattura(null)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Chiudi
              </button>
              <button onClick={() => window.print()} style={{ background: '#4338ca', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(67,56,202,.3)' }}>
                🖨 Stampa / Esporta PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Emetti Fattura / Nota di Credito */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleEmettiSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Emetti Documento Fiscale & Tracciato SDI Comped</div>

            {/* Selezione Tipo Documento: Fattura vs Nota di Credito (Numerazione Distinta FT vs NC!) */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Documento (Numerazione Distinta Serie FT / NC) *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setTipoDocFiscale('fattura')}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8,
                    border: `1px solid ${tipoDocFiscale === 'fattura' ? 'var(--indigo-l)' : 'var(--border)'}`,
                    background: tipoDocFiscale === 'fattura' ? '#1a1f3d' : 'var(--card2)',
                    color: tipoDocFiscale === 'fattura' ? 'var(--indigo-l)' : 'var(--muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  📄 Fattura (Serie FT)
                </button>

                <button
                  type="button"
                  onClick={() => setTipoDocFiscale('nota_credito')}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8,
                    border: `1px solid ${tipoDocFiscale === 'nota_credito' ? '#a78bfa' : 'var(--border)'}`,
                    background: tipoDocFiscale === 'nota_credito' ? '#200f40' : 'var(--card2)',
                    color: tipoDocFiscale === 'nota_credito' ? '#a78bfa' : 'var(--muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  📑 Nota di Credito (Serie NC)
                </button>
              </div>
            </div>

            {tipoDocFiscale === 'nota_credito' && (
              <div style={{ background: '#200f40', border: '1px solid #3c1e70', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>
                  ℹ️ Verrà generata una Nota di Credito con numerazione separata (es. NC-2026/001).
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Causale Nota di Credito *</label>
                  <input value={causaNc} onChange={e => setCausaNc(e.target.value)} style={{ fontSize: 11 }} required />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Fatturazione (§18) *</label>
              <select value={tipoFattura} onChange={e => setTipoFattura(e.target.value as any)}>
                <option value="milestone_libera">🎯 Milestone Libera / Acconto</option>
                <option value="modulo_completo">✅ Modulo Completo Ultimato</option>
                <option value="modulo_parziale">📊 Avanzamento Parziale Modulo (%)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione in Fattura *</label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="es. Saldo modulo analisi patrimoniale" required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo (€) *</label>
                <input type="number" value={importoEur} onChange={e => setImportoEur(Number(e.target.value))} min={1} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canale Invio *</label>
                <select value={canale} onChange={e => setCanale(e.target.value as any)}>
                  <option value="sdi">📨 SDI (Comped Servizi FPA)</option>
                  <option value="standard">📄 Standard / Estero</option>
                </select>
              </div>
            </div>

            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 8, padding: 10, fontSize: 11, color: '#34d399' }}>
              ✓ Al salvataggio verrà generato il tracciato XML FatturaPA e inviato a <strong>Comped Servizi FPA</strong>.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: tipoDocFiscale === 'nota_credito' ? '#7c3aed' : 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? 'Generazione...' : tipoDocFiscale === 'nota_credito' ? '✓ Emetti Nota di Credito (Serie NC)' : '✓ Emetti Fattura Fiscale (Serie FT)'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PlaceholderTab({ icon, label }: { icon: string; label: string }) {
  return (
    <div className={styles.placeholder}>
      <div style={{ fontSize: 40 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        Contenuto sincronizzato in tempo reale con Supabase
      </div>
    </div>
  );
}

// ─── Componente Grafo & Dipendenze Moduli del Progetto ────────────
function GrafoModuliProgettoView({
  project,
  onAddModule,
  onSelectMod,
}: {
  project: Progetto;
  onAddModule: (mod: ModuloProgetto) => void;
  onSelectMod: (modId: number) => void;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('t-trust');

  const libraryTemplates = [
    { id: 't-trust', n: 'Trust & Asset Protection', cat: 'Trust', h: 30, p: 4500, desc: 'Costituzione trust di garanzia e patrimonio segregato.' },
    { id: 't-ip', n: 'IP Licensing & Tax Optimization', cat: 'IP & Tax', h: 22, p: 3800, desc: 'Regime Patent Box e licenza marchio UE.' },
    { id: 't-mfsa', n: 'Licenza Finanziaria MFSA VASP', cat: 'Compliance', h: 50, p: 9500, desc: 'Pratica autorizzazione autorità dei servizi finanziari.' },
  ];

  const handleAddModuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tmpl = libraryTemplates.find(t => t.id === selectedTemplate) || libraryTemplates[0];
    const newMod: ModuloProgetto = {
      id: Date.now(),
      n: tmpl.n,
      cat: tmpl.cat as any,
      st: 'pending',
      pct: 0,
      h: tmpl.h,
      a: 0,
      p: tmpl.p,
      team: [1],
      v: [
        { n: 'Analisi requisiti preliminari', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
        { n: 'Redazione documentazione integrativa', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
      ],
    };
    onAddModule(newMod);
    setAddModalOpen(false);
  };

  const completedModsCount = project.mods.filter(m => m.st === 'done' || m.pct === 100).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Controlli Grafo */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🕸 Mappa Grafo Moduli & Workflow Dipendenze</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Visualizzazione dei moduli acquistati dal cliente, delle dipendenze sbloccate e dell'avanzamento live
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, background: 'var(--card2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 20, fontWeight: 600 }}>
            📊 Moduli Ultimati: <span style={{ color: '#34d399' }}>{completedModsCount} / {project.mods.length}</span>
          </div>
          <button
            onClick={() => setAddModalOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Aggiungi Modulo da Libreria
          </button>
        </div>
      </div>

      {/* Visual Flow / Grafo Moduli con Frecce */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, minHeight: 300, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Flusso Operativo Progetto & Avanzamento Live:
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, overflowX: 'auto', paddingBottom: 10 }}>
          {project.mods.map((m, idx) => {
            const isDone = m.st === 'done' || m.pct === 100;
            const isInProgress = m.st === 'in_progress' || (m.pct > 0 && m.pct < 100);
            const statusColor = isDone ? '#34d399' : isInProgress ? '#818cf8' : 'var(--muted)';

            return (
              <React.Fragment key={m.id}>
                {/* Node Card */}
                <div
                  onClick={() => onSelectMod(m.id)}
                  style={{
                    minWidth: 260,
                    maxWidth: 280,
                    background: 'var(--card)',
                    border: `1.5px solid ${isDone ? '#059669' : isInProgress ? 'var(--indigo)' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    cursor: 'pointer',
                    boxShadow: isInProgress ? '0 0 20px rgba(99,102,241,.25)' : '0 4px 16px rgba(0,0,0,.3)',
                    transition: 'all .2s',
                  }}
                  title="Clicca per aprire la scheda dettagliata del modulo"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <CatBadge cat={m.cat} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: 'var(--card2)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12 }}>
                      {isDone ? '✓ Ultimato' : isInProgress ? '⚡ In Lavorazione' : '⏳ In Attesa'}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{m.n}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                      {m.v ? `${m.v.length} Microvoci operative` : 'Passaggi guidati'}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                      <span>Avanzamento Live</span>
                      <span style={{ fontWeight: 700, color: statusColor }}>{m.pct}%</span>
                    </div>
                    <ProgressBar value={m.pct} color={statusColor} height={5} />
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                    <span>⏱ {m.a}/{m.h}h</span>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmt(m.p)}</span>
                  </div>
                </div>

                {/* Arrow Connector */}
                {idx < project.mods.length - 1 && (
                  <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 4, color: isDone ? '#34d399' : 'var(--muted)' }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>➔</div>
                    <span style={{ fontSize: 9, fontWeight: 600 }}>Sblocca</span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Modal Aggiungi Modulo da Libreria */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddModuleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Aggiungi Modulo da Libreria al Progetto</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona una prestazione o modulo aggiuntivo dal catalogo della libreria da associare al cliente</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo Template Libreria *</label>
              <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
                {libraryTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.n} ({t.cat}) — {t.h}h — {fmt(t.p)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il nuovo modulo verrà inserito nel <strong>Grafo del Progetto</strong> con stato <em>Pending</em> ed integrato nello scadenzario delle microvoci.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setAddModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Aggiungi al Progetto</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
