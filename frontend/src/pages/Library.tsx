import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, moduloH, moduloP, resolveRighe, levelOf } from '../utils';
import { MLIB, ARTICOLI, GIURISDIZIONI } from '../store/mockData';
import { fetchModuliLibreria, fetchArticoli, fetchGiurisdizioniApi, creaGiurisdizioneApi, creaArticoloApi, creaModuloTemplateApi, updateArticoloPrezzoApi, uploadFileApi, fetchClienti, fetchProgetti, creaProgettoApi, salvaProgettoDettaglioApi } from '../api/client';
import type { CategoriaModulo, Articolo, Giurisdizione, ModuloTemplate } from '../types';

type SubTab = 'grafo' | 'articoli' | 'giurisdizioni' | 'crea_modulo' | 'doc_form';

export function Library() {
  const [subTab, setSubTab] = useState<SubTab>('grafo');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [articoliList, setArticoliList] = useState<Articolo[]>(ARTICOLI);
  const [giurList, setGiurList] = useState<Giurisdizione[]>(GIURISDIZIONI);
  const [moduliList, setModuliList] = useState<ModuloTemplate[]>(MLIB);
  const [modalArticoloOpen, setModalArticoloOpen] = useState(false);
  const [selectedGiurId, setSelectedGiurId] = useState<string>('ALL');
  const [assignModalModule, setAssignModalModule] = useState<ModuloTemplate | null>(null);

  const graphRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Carica articoli, moduli e giurisdizioni da Supabase DB
  const loadData = async () => {
    const dbArts = await fetchArticoli();
    if (dbArts && Array.isArray(dbArts) && dbArts.length > 0) {
      const mapped: Articolo[] = dbArts.map((a: any) => ({
        id: a.id,
        n: a.nome,
        cat: a.categoria as CategoriaModulo,
        h: a.oreDefault,
        p: a.prezzoDefault ? a.prezzoDefault / 100 : 500,
        ver: a.versione || 1,
      }));
      setArticoliList(mapped);
    }

    const dbMods = await fetchModuliLibreria();
    if (dbMods && Array.isArray(dbMods) && dbMods.length > 0) {
      const mappedMods: ModuloTemplate[] = dbMods.map((m: any) => ({
        id: m.id,
        n: m.nome,
        cat: m.categoria as CategoriaModulo,
        ver: m.versione || 1,
        deps: (m.dipendenze || []).map((d: any) => d.dipendeDaModuloTemplateId),
        pkg: m.prezzoPacchetto ? m.prezzoPacchetto / 100 : undefined,
        giurisdizioneId: m.giurisdizioneId,
        giurisdizione: m.giurisdizione,
        righe: (m.righeDistinta || []).map((r: any) => ({
          art: r.articoloId,
          artObj: r.articolo ? {
            id: r.articolo.id,
            n: r.articolo.nome,
            cat: r.articolo.categoria as CategoriaModulo,
            h: r.articolo.oreDefault,
            p: r.articolo.prezzoDefault ? r.articolo.prezzoDefault / 100 : 500,
            ver: r.articolo.versione || 1,
          } : undefined,
          qty: r.quantita,
          oO: r.overrideOre,
          oP: r.overridePrezzo ? r.overridePrezzo / 100 : undefined,
        })),
      }));
      setModuliList(mappedMods);
    }

    const dbGiur = await fetchGiurisdizioniApi();
    if (dbGiur && Array.isArray(dbGiur) && dbGiur.length > 0) {
      setGiurList(dbGiur);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggle = (id: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // Topological levels
  const maxLvl = Math.max(...moduliList.map(m => levelOf(m.id, moduliList)), 0);
  const cols: ModuloTemplate[][] = [];
  for (let i = 0; i <= maxLvl; i++) cols.push(moduliList.filter(m => levelOf(m.id, moduliList) === i));
  const colLabels = ['Punto di partenza', 'Sbloccati a cascata', 'Dipendenti'];

  useEffect(() => {
    if (subTab === 'grafo') drawEdges();
  }, [open, subTab, moduliList]);

  function drawEdges() {
    const svg = svgRef.current;
    const wrap = graphRef.current;
    if (!svg || !wrap) return;
    const wr = wrap.getBoundingClientRect();
    svg.setAttribute('width', String(wrap.scrollWidth));
    svg.setAttribute('height', String(wrap.scrollHeight));
    svg.innerHTML = `
      <defs>
        <marker id="arrow-inactive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#474b68" />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
        </marker>
      </defs>
    `;
    moduliList.forEach(m => {
      m.deps.forEach(depId => {
        const from = document.getElementById(`lib-${depId}`);
        const to   = document.getElementById(`lib-${m.id}`);
        if (!from || !to) return;
        const fr = from.getBoundingClientRect();
        const tr = to.getBoundingClientRect();
        const x1 = fr.right - wr.left;
        const y1 = fr.top + fr.height / 2 - wr.top;
        const x2 = tr.left - wr.left;
        const y2 = tr.top + tr.height / 2 - wr.top;
        const cx = (x1 + x2) / 2;
        const isActive = open.has(m.id) || open.has(depId);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', isActive ? '#818cf8' : '#474b68');
        path.setAttribute('stroke-width', isActive ? '2.5' : '1.8');
        path.setAttribute('marker-end', isActive ? 'url(#arrow-active)' : 'url(#arrow-inactive)');
        svg.appendChild(path);
      });
    });
  }



  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Navigation Sub-Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, gap: 8 }}>
        <button
          onClick={() => setSubTab('grafo')}
          style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none', color: subTab === 'grafo' ? 'var(--indigo-l)' : 'var(--muted)',
            borderBottom: `2px solid ${subTab === 'grafo' ? 'var(--indigo-l)' : 'transparent'}`,
          }}
        >
          🕸 Grafo Dipendenze Moduli
        </button>
        <button
          onClick={() => setSubTab('articoli')}
          style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none', color: subTab === 'articoli' ? 'var(--indigo-l)' : 'var(--muted)',
            borderBottom: `2px solid ${subTab === 'articoli' ? 'var(--indigo-l)' : 'transparent'}`,
          }}
        >
          🧩 Catalogo Articoli ({articoliList.length})
        </button>
        <button
          onClick={() => setSubTab('giurisdizioni')}
          style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none', color: subTab === 'giurisdizioni' ? 'var(--indigo-l)' : 'var(--muted)',
            borderBottom: `2px solid ${subTab === 'giurisdizioni' ? 'var(--indigo-l)' : 'transparent'}`,
          }}
        >
          🌍 Giurisdizioni ({giurList.length})
        </button>
        <button
          onClick={() => setSubTab('crea_modulo')}
          style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none', color: subTab === 'crea_modulo' ? 'var(--indigo-l)' : 'var(--muted)',
            borderBottom: `2px solid ${subTab === 'crea_modulo' ? 'var(--indigo-l)' : 'transparent'}`,
          }}
        >
          ⚡ Costruttore Moduli Template
        </button>
        <button
          onClick={() => setSubTab('doc_form')}
          style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            background: 'none', border: 'none', color: subTab === 'doc_form' ? 'var(--indigo-l)' : 'var(--muted)',
            borderBottom: `2px solid ${subTab === 'doc_form' ? 'var(--indigo-l)' : 'transparent'}`,
          }}
        >
          📄 Modelli Documenti in Bianco & Form Master
        </button>
      </div>

      {/* TAB 1: Grafo & Dipendenze Moduli */}
      {subTab === 'grafo' && (
        <div>
          {/* Toolbar Filtri Grafo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>🌍 Giurisdizione Target:</span>
              <select
                value={selectedGiurId}
                onChange={e => setSelectedGiurId(e.target.value)}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 600 }}
              >
                <option value="ALL">🌐 Tutte le Giurisdizioni & Generici</option>
                {giurList.map(g => {
                  const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
                  return <option key={g.id} value={g.id}>{flag} {g.nome} ({g.codice})</option>;
                })}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 11, color: 'var(--muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12 }}>🇲🇹 / 🌐</span>
                Badge Giurisdizione
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 2, background: '#818cf8' }} />
                Frecce Dipendenza ➔
              </div>
              <div>Clic su un modulo per espandere distinta base</div>
            </div>
          </div>

          <div ref={graphRef} style={{ position: 'relative', overflowX: 'auto', paddingBottom: 12 }}>
            <svg ref={svgRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'visible' }} />
            <div style={{ display: 'flex', gap: 56, alignItems: 'flex-start', position: 'relative', zIndex: 1, minWidth: 'max-content', padding: 4 }}>
              {cols.map((items, ci) => (
                <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 240, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--hint)', textTransform: 'uppercase', letterSpacing: '.6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {colLabels[ci] || `Livello ${ci}`}
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  {items.map(m => {
                    const isOpen = open.has(m.id);
                    const dn = m.deps.map(d => moduliList.find(x => x.id === d)?.n).filter(Boolean);
                    const righe = resolveRighe(m, articoliList);

                    // Flag ed etichetta Giurisdizione
                    const gMatch = giurList.find(g => g.id === m.giurisdizioneId);
                    const gFlag = gMatch ? (gMatch.codice === 'MT' ? '🇲🇹' : gMatch.codice === 'GI' ? '🇬🇮' : gMatch.codice.startsWith('US') ? '🇺🇸' : gMatch.codice === 'AE' ? '🇦🇪' : '🌐') : '🌐';
                    const gLabel = gMatch ? gMatch.nome : 'Generico';

                    return (
                      <div
                        key={m.id}
                        id={`lib-${m.id}`}
                        onClick={() => toggle(m.id)}
                        style={{
                          background: isOpen ? 'var(--card2)' : 'var(--card)',
                          border: `1px solid ${isOpen ? 'var(--indigo-l)' : selectedGiurId !== 'ALL' && m.giurisdizioneId === selectedGiurId ? 'var(--indigo)' : 'var(--border)'}`,
                          borderRadius: 12, padding: 14, cursor: 'pointer',
                          transition: 'all .15s',
                          boxShadow: selectedGiurId !== 'ALL' && m.giurisdizioneId === selectedGiurId ? '0 0 12px rgba(99,102,241,.35)' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CatBadge cat={m.cat} />
                            <span
                              title={`Giurisdizione: ${gLabel}`}
                              style={{
                                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                                background: m.giurisdizioneId ? '#1a1f3d' : 'var(--card2)',
                                border: `1px solid ${m.giurisdizioneId ? '#2d3260' : 'var(--border)'}`,
                                color: m.giurisdizioneId ? '#a5b4fc' : 'var(--muted)',
                              }}
                            >
                              {gFlag} {gLabel}
                            </span>
                          </div>
                          <span style={{ fontSize: 9, fontWeight: 700, color: dn.length ? '#f59e0b' : '#34d399', background: dn.length ? '#2d1a05' : '#0d2d22', border: `1px solid ${dn.length ? '#d97706' : '#059669'}`, padding: '1px 8px', borderRadius: 20 }}>
                            {dn.length ? `🔒 Dipende da ${dn[0]}` : '🔓 Partenza'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, margin: '6px 0 8px' }}>{m.n}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
                          <span>{moduloH(m, articoliList)}h · {righe.length} articoli{dn.length ? ` · ➔ Dipende da: ${dn.join(', ')}` : ''}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{fmt(moduloP(m, articoliList))}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{isOpen ? '▲' : '▼'}</span>
                        </div>

                        {isOpen && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {righe.map((r, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--hint)', flexShrink: 0 }} />
                                {r.art.n}
                                {r.qty > 1 && <span style={{ color: '#818cf8' }}>×{r.qty}</span>}
                              </div>
                            ))}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssignModalModule(m);
                              }}
                              style={{ marginTop: 6, width: '100%', background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,.3)' }}
                            >
                              🚀 Assegna a Progetto Cliente ➔
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Catalogo Articoli & Distinta Base */}
      {subTab === 'articoli' && (
        <ArticoliCatalogView
          articoliList={articoliList}
          onOpenNew={() => setModalArticoloOpen(true)}
        />
      )}

      {/* TAB 3: Giurisdizioni Studio */}
      {subTab === 'giurisdizioni' && (
        <GiurisdizioniView
          giurList={giurList}
          moduliList={moduliList}
          onAddGiur={(g) => setGiurList(prev => [...prev, g])}
          onOpenInGraph={(giurId) => {
            setSelectedGiurId(giurId);
            setSubTab('grafo');
          }}
        />
      )}

      {/* TAB 4: Costruttore Modulo Template */}
      {subTab === 'crea_modulo' && (
        <CreaModuloForm
          articoliList={articoliList}
          giurList={giurList}
          onCreated={() => {
            loadData();
            setSubTab('grafo');
          }}
        />
      )}

      {/* TAB 4: Modelli Documenti in Bianco & Form Master */}
      {subTab === 'doc_form' && (
        <LibreriaDocumentiEForm />
      )}

      {/* Modal Nuovo Articolo */}
      {modalArticoloOpen && (
        <NuovoArticoloModal
          giurList={giurList}
          onClose={() => setModalArticoloOpen(false)}
          onCreated={() => loadData()}
        />
      )}

      {/* Modal Assegna Modulo a Cliente (§1-Click con Anti-Duplicazione) */}
      {assignModalModule && (
        <AssegnaModuloClienteModal
          modulo={assignModalModule}
          articoliList={articoliList}
          onClose={() => setAssignModalModule(null)}
        />
      )}
    </div>
  );
}

// ─── Modal Assegna Modulo a Cliente con Anti-Duplicazione ─────────
function AssegnaModuloClienteModal({
  modulo,
  articoliList,
  onClose,
}: {
  modulo: ModuloTemplate;
  articoliList: Articolo[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [clienti, setClienti] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [progetti, setProgetti] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('new');
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [duplicationReport, setDuplicationReport] = useState<Array<{ name: string; status: string; isDuplicate: boolean }>>([]);

  useEffect(() => {
    async function loadClientData() {
      const dbClienti = await fetchClienti();
      if (dbClienti && Array.isArray(dbClienti) && dbClienti.length > 0) {
        setClienti(dbClienti);
        setSelectedClientId(dbClienti[0].id);
      }
    }
    loadClientData();
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    async function loadProjects() {
      const allProjs = await fetchProgetti();
      const clientProjs = (allProjs || []).filter((p: any) => String(p.clienteId || p.clId) === String(selectedClientId));
      setProgetti(clientProjs);
      if (clientProjs.length > 0) {
        setSelectedProjectId(String(clientProjs[0].id));
      } else {
        setSelectedProjectId('new');
      }
    }
    loadProjects();
  }, [selectedClientId]);

  // Scan live for duplicated articles in target project
  useEffect(() => {
    if (selectedProjectId === 'new' || !selectedProjectId) {
      setDuplicationReport([]);
      return;
    }
    const targetProj = progetti.find(p => String(p.id) === String(selectedProjectId));
    if (!targetProj || !targetProj.mods) {
      setDuplicationReport([]);
      return;
    }

    const righeNew = resolveRighe(modulo, articoliList);
    const existingMvNames = new Set<string>();
    const existingMvStatuses = new Map<string, string>();

    targetProj.mods.forEach((m: any) => {
      (m.v || []).forEach((mv: any) => {
        const nameClean = (mv.n || '').toLowerCase().trim();
        existingMvNames.add(nameClean);
        existingMvStatuses.set(nameClean, mv.s || 'pending');
      });
    });

    const report = righeNew.map(r => {
      const nameClean = (r.art.n || '').toLowerCase().trim();
      const isDup = existingMvNames.has(nameClean);
      return {
        name: r.art.n,
        status: isDup ? (existingMvStatuses.get(nameClean) || 'done') : 'new',
        isDuplicate: isDup,
      };
    });

    setDuplicationReport(report);
  }, [selectedProjectId, modulo, articoliList, progetti]);

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) return;
    setLoading(true);

    try {
      let projIdToUse = selectedProjectId;
      let targetProj: any = null;

      if (selectedProjectId === 'new') {
        const clientObj = clienti.find(c => String(c.id) === String(selectedClientId));
        const projName = newProjectName.trim() || `Incarico ${modulo.n} — ${clientObj?.nome || 'Cliente'}`;
        const newP = await creaProgettoApi({ clienteId: selectedClientId, nome: projName });
        projIdToUse = String(newP.id);
        targetProj = { id: projIdToUse, clienteId: selectedClientId, cl: clientObj?.nome, nome: projName, mods: [], val: 0 };
      } else {
        targetProj = progetti.find(p => String(p.id) === String(selectedProjectId));
      }

      const righeNew = resolveRighe(modulo, articoliList);
      const newMicrovoci = righeNew.map(r => {
        const dupItem = duplicationReport.find(d => d.name === r.art.n && d.isDuplicate);
        const isDoneAlready = dupItem && (dupItem.status === 'done' || dupItem.status === 'completed');

        return {
          n: r.art.n,
          hE: isDoneAlready ? 0 : r.h,
          hA: isDoneAlready ? r.h : 0,
          s: isDoneAlready ? 'done' : 'pending',
          as: 1,
          d: 0,
          vn: isDoneAlready ? '✓ Già ultimato nel progetto precedente (Evitato doppione)' : undefined,
        };
      });

      const newModObj = {
        id: Date.now(),
        n: modulo.n,
        cat: modulo.cat,
        st: newMicrovoci.every(v => v.s === 'done') ? 'done' : 'pending',
        pct: newMicrovoci.every(v => v.s === 'done') ? 100 : 0,
        h: moduloH(modulo, articoliList),
        a: 0,
        p: moduloP(modulo, articoliList),
        team: [1],
        v: newMicrovoci,
      };

      const updatedMods = [...(targetProj.mods || []), newModObj];
      const updatedVal = (targetProj.val || 0) + (newModObj.p || 0);
      const updatedProj = { ...targetProj, mods: updatedMods, val: updatedVal };

      await salvaProgettoDettaglioApi(projIdToUse, updatedProj);

      // Backup local storage
      const savedStr = localStorage.getItem('bluman_custom_projects');
      const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
      const updatedArr = [updatedProj, ...savedArr.filter(p => String(p.id) !== String(projIdToUse))];
      localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

      onClose();
      navigate(`/projects/${projIdToUse}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const hasDuplicates = duplicationReport.some(d => d.isDuplicate);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
      <form onSubmit={handleAssignSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)' }}>🚀 Assegna Modulo "{modulo.n}" a Cliente</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona il cliente ed il progetto in cui istanziare il modulo ed il relativo workflow.</div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>1. Seleziona Cliente Target *</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} required style={{ padding: 10, fontSize: 12 }}>
            {clienti.map(c => (
              <option key={c.id} value={c.id}>
                {c.tipo === 'company' ? '🏢' : '👤'} {c.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>2. Seleziona Incarico / Progetto del Cliente *</label>
          <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
            <option value="new">➕ Crea Nuovo Incarico per questo Cliente</option>
            {progetti.map(p => (
              <option key={p.id} value={p.id}>
                📁 {p.nome || p.n} (Valore: {fmt(p.val || 0)})
              </option>
            ))}
          </select>
        </div>

        {selectedProjectId === 'new' && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Nuovo Incarico *</label>
            <input
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder={`es. Incarico ${modulo.n}`}
              style={{ fontSize: 12 }}
            />
          </div>
        )}

        {/* Controllo Anti-Duplicazione Live */}
        {selectedProjectId !== 'new' && (
          <div style={{ background: hasDuplicates ? '#2d1a05' : '#0d2d22', border: `1px solid ${hasDuplicates ? '#f59e0b' : '#1a5c3c'}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: hasDuplicates ? '#f59e0b' : '#34d399' }}>
              {hasDuplicates ? '⚠️ Controllo Anti-Duplicazione: Rilevati Articoli Già Lavorati' : '✓ Nessun Doppione Rilevato'}
            </div>
            <div style={{ fontSize: 11, color: hasDuplicates ? '#fef3c7' : '#a7f3d0', lineHeight: 1.4 }}>
              {hasDuplicates
                ? 'Gli articoli già ultimati nel progetto non verranno duplicati. Saranno segnati come già validati a 0 ore per evitare di far rifare il lavoro.'
                : 'Tutti gli articoli della distinta base verranno integrati nel nuovo modulo del cliente.'}
            </div>

            {duplicationReport.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {duplicationReport.map((d, idx) => (
                  <div key={idx} style={{ fontSize: 10.5, display: 'flex', justifyContent: 'space-between', color: d.isDuplicate ? '#fde68a' : '#d1fae5' }}>
                    <span>• {d.name}</span>
                    <span style={{ fontWeight: 700 }}>{d.isDuplicate ? `✓ Già lavorato (${d.status})` : '➕ Nuovo'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={loading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {loading ? 'Assegnazione in corso...' : '✓ Conferma ed Assegna a Cliente ➔'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Componente Catalogo Articoli & Distinta Base ──────────────────
function ArticoliCatalogView({ articoliList, onOpenNew }: { articoliList: Articolo[]; onOpenNew: () => void }) {
  const [selectedCat, setSelectedCat] = useState<string>('TUTTI');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingArt, setEditingArt] = useState<Articolo | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editHours, setEditHours] = useState<number>(0);
  const [editName, setEditName] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  const categories = ['TUTTI', 'Analisi', 'Societario', 'Compliance', 'Banking', 'Trust', 'IP & Tax'];

  const filtered = articoliList.filter(a => {
    const matchCat = selectedCat === 'TUTTI' || a.cat === selectedCat;
    const matchQuery = a.n.toLowerCase().includes(searchQuery.toLowerCase()) || a.cat.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchQuery;
  });

  const totalOre = articoliList.reduce((sum, a) => sum + a.h, 0);
  const avgPrezzo = articoliList.length > 0 ? Math.round(articoliList.reduce((sum, a) => sum + a.p, 0) / articoliList.length) : 0;

  const handleStartEdit = (art: Articolo) => {
    setEditingArt(art);
    setEditPrice(art.p);
    setEditHours(art.h);
    setEditName(art.n);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingArt) return;
    setSavingEdit(true);
    try {
      await updateArticoloPrezzoApi(editingArt.id, {
        prezzoDefault: editPrice * 100,
        oreDefault: editHours,
        nome: editName,
      });
      // aggiorna locale
      editingArt.p = editPrice;
      editingArt.h = editHours;
      editingArt.n = editName;
      setEditingArt(null);
    } catch (err) {
      console.error(err);
      editingArt.p = editPrice;
      editingArt.h = editHours;
      editingArt.n = editName;
      setEditingArt(null);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Bar KPI & Toolbar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#1a1f3d', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🧩</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Totale Articoli in Libreria</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{articoliList.length} Prestazioni</div>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#200f40', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>⏱</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Monte Ore operative stimate</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{totalOre}h Complessive</div>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#0d2d22', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>💶</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Valore Medio Prestazione</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{fmt(avgPrezzo)}</div>
          </div>
        </div>
      </div>

      {/* Header Controlli: Filtri Categoria & Ricerca & Pulsante Nuovo */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        {/* Pills Categorie */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCat(c)}
              style={{
                background: selectedCat === c ? 'var(--indigo)' : 'var(--card2)',
                color: selectedCat === c ? '#fff' : 'var(--muted)',
                border: `1px solid ${selectedCat === c ? 'var(--indigo-l)' : 'var(--border)'}`,
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {c === 'TUTTI' ? 'Tutti gli Articoli' : c}
            </button>
          ))}
        </div>

        {/* Input Ricerca e Pulsante Nuovo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 Cerca per nome o categoria..."
            style={{ width: 220, fontSize: 12 }}
          />
          <button
            onClick={onOpenNew}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Nuovo Articolo Prestazione
          </button>
        </div>
      </div>

      {/* Grid Cards Articoli */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {filtered.map(a => (
          <div
            key={a.id}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
              boxShadow: '0 6px 24px rgba(0,0,0,.2)',
              transition: 'all .2s',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <CatBadge cat={a.cat} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => handleStartEdit(a)}
                    title="Modifica Prezzo & Ore (Admin)"
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                  >
                    ✏️ Modifica
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', background: '#1a1f3d', border: '1px solid #2d3260', padding: '2px 8px', borderRadius: 20 }}>
                    v{a.ver || 1}.0
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: 'var(--text)' }}>{a.n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>📋 Procedura guidata:</span>
                <span style={{ background: '#200f40', color: '#a78bfa', padding: '1px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
                  Form & Passaggi integrati
                </span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Ore operative</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>⏱ {a.h}h stimate</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Prezzo Listino</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 2 }}>{fmt(a.p)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Modifica Prezzo & Ore Articolo (§Admin) */}
      {editingArt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleSaveEdit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 450, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✏️ Modifica Listino Articolo (Admin)</span>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Prestazione *</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Prezzo Listino (€) *</label>
                <input type="number" value={editPrice} onChange={e => setEditPrice(Number(e.target.value))} min={0} step={50} required style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore Stimate (h) *</label>
                <input type="number" value={editHours} onChange={e => setEditHours(Number(e.target.value))} min={1} required />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📄 Modello Documento / PDF Allegato</label>
              <input
                type="text"
                placeholder="es. https://storage.bluman.com/templates/Accordo_NDA.pdf"
                value={editingArt?.documentoAllegatoUrl || ''}
                onChange={e => setEditingArt({ ...editingArt!, documentoAllegatoUrl: e.target.value })}
                style={{ fontSize: 12 }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📋 Form Master Dati da far Compilare al Cliente</label>
              <select
                value={editingArt?.formMasterId || ''}
                onChange={e => setEditingArt({ ...editingArt!, formMasterId: e.target.value })}
                style={{ padding: 8, fontSize: 12 }}
              >
                <option value="">-- Nessun Form Richiesto --</option>
                <option value="f1">Form Dati Societari & Legale Rappresentante</option>
                <option value="f2">Form Titolarità Effettiva & UBO</option>
                <option value="f3">Form Dati Bancari & KYC Compliance</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔗 Link Istruzioni per il Cliente (URL / Guida)</label>
              <input
                type="url"
                placeholder="es. https://gov.mt/adempimenti-notarili-guida"
                value={editingArt?.linkIstruzioni || ''}
                onChange={e => setEditingArt({ ...editingArt!, linkIstruzioni: e.target.value })}
                style={{ fontSize: 12 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setEditingArt(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={savingEdit} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{savingEdit ? 'Salvataggio...' : '✓ Salva Modifiche Prestazione'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Componente Giurisdizioni Studio ──────────────────────────────
function GiurisdizioniView({
  giurList,
  moduliList,
  onAddGiur,
  onOpenInGraph,
}: {
  giurList: Giurisdizione[];
  moduliList: ModuloTemplate[];
  onAddGiur: (g: Giurisdizione) => void;
  onOpenInGraph: (giurId: string) => void;
}) {
  const [modalGiurOpen, setModalGiurOpen] = useState(false);
  const [selectedGiur, setSelectedGiur] = useState<Giurisdizione | null>(null);
  const [newGiurNome, setNewGiurNome] = useState('');
  const [newGiurCodice, setNewGiurCodice] = useState('');
  const [newGiurTipo, setNewGiurTipo] = useState<'ue' | 'extra_ue' | 'stato_usa' | 'altro'>('ue');
  const [newGiurNote, setNewGiurNote] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>🌍 Giurisdizioni & Piazze Finanziarie Studio</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Clicca su una giurisdizione per vederne i moduli associati o per posizionarti direttamente nel Grafo delle dipendenze.
          </div>
        </div>
        <button
          onClick={() => setModalGiurOpen(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nuova Giurisdizione
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {giurList.map((g) => {
          const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
          const linkedMods = moduliList.filter(m => m.giurisdizioneId === g.id);

          return (
            <div
              key={g.id}
              onClick={() => setSelectedGiur(g)}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(0,0,0,.2)',
                cursor: 'pointer',
                transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--indigo)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{flag}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: g.tipo === 'ue' ? '#0d2d22' : g.tipo === 'stato_usa' ? '#1e1b4b' : '#2d1a05',
                      color: g.tipo === 'ue' ? '#34d399' : g.tipo === 'stato_usa' ? '#a5b4fc' : '#f59e0b',
                      textTransform: 'uppercase',
                    }}
                  >
                    {g.tipo}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{g.nome} ({g.codice})</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                  {g.note || 'Nessuna nota aggiuntiva'}
                </div>
              </div>

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>
                  🧩 {linkedMods.length} Moduli Specifici
                </span>
                <span style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600 }}>
                  Dettagli ➔
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dettaglio Giurisdizione Cliccata */}
      {selectedGiur && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{selectedGiur.codice === 'MT' ? '🇲🇹' : selectedGiur.codice === 'GI' ? '🇬🇮' : selectedGiur.codice.startsWith('US') ? '🇺🇸' : selectedGiur.codice === 'AE' ? '🇦🇪' : '🌐'}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedGiur.nome} ({selectedGiur.codice})</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Giurisdizione Studio · Tipo {selectedGiur.tipo.toUpperCase()}</div>
                </div>
              </div>
              <button onClick={() => setSelectedGiur(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--hint)', marginBottom: 4, textTransform: 'uppercase' }}>Note & Regole Operative:</div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
                {selectedGiur.note || 'Nessuna specifica o nota inserita.'}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>🧩 Moduli Template Collegati ({moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length}):</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: 10, background: 'var(--card2)', borderRadius: 8 }}>
                    Nessun modulo specifico attualmente collegato a questa giurisdizione. In questa piazza verranno usati i moduli generici.
                  </div>
                ) : (
                  moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).map(m => (
                    <div key={m.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.n}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Cat: {m.cat} · Version v{m.ver}</div>
                      </div>
                      <CatBadge cat={m.cat} />
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setSelectedGiur(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={() => {
                  const gId = selectedGiur.id;
                  setSelectedGiur(null);
                  onOpenInGraph(gId);
                }}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
              >
                🕸 VEDI NEL GRAFO DEI MODULI ➔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuova Giurisdizione */}
      {modalGiurOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 440, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>+ Nuova Giurisdizione Studio</div>
              <button onClick={() => setModalGiurOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newGiurNome || !newGiurCodice) return;
                const res = await creaGiurisdizioneApi({
                  nome: newGiurNome,
                  codice: newGiurCodice.toUpperCase(),
                  tipo: newGiurTipo,
                  note: newGiurNote,
                });
                onAddGiur(res);
                setModalGiurOpen(false);
                setNewGiurNome('');
                setNewGiurCodice('');
                setNewGiurNote('');
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Giurisdizione *</label>
                <input value={newGiurNome} onChange={e => setNewGiurNome(e.target.value)} placeholder="es. Svizzera / Lussemburgo" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice ISO / Paese *</label>
                <input value={newGiurCodice} onChange={e => setNewGiurCodice(e.target.value)} placeholder="es. CH / LU" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo *</label>
                <select value={newGiurTipo} onChange={e => setNewGiurTipo(e.target.value as any)}>
                  <option value="ue">Unione Europea (UE)</option>
                  <option value="extra_ue">Extra-UE (Gibilterra, EAU, UK...)</option>
                  <option value="stato_usa">Stato USA (Florida, Delaware...)</option>
                  <option value="altro">Altro</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note / Descrizione</label>
                <textarea value={newGiurNote} onChange={e => setNewGiurNote(e.target.value)} placeholder="Note adempimenti o valuta" rows={2} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setModalGiurOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Salva Giurisdizione</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente Libreria Documenti in Bianco & Form Master ────────
function LibreriaDocumentiEForm() {
  const [docModels, setDocModels] = useState<Array<{ id: string; nome: string; cat: string; firma: boolean; desc: string; url?: string }>>([
    { id: 'm1', nome: 'Accordo di Riservatezza NDA Tipo.pdf', cat: 'Societario', firma: true, desc: 'Modello standard NDA bilingue Malta/Italia.' },
    { id: 'm2', nome: 'Procura Legale MFSA In Bianco.pdf', cat: 'Compliance', firma: true, desc: 'Procura per adempimenti registro MFSA.' },
    { id: 'm3', nome: 'Dichiarazione Titolare Effettivo (UBO).pdf', cat: 'Compliance', firma: true, desc: 'Dichiarazione antiriciclaggio e titolarità effettiva.' },
    { id: 'm4', nome: 'Statuto Standard Holding Malta.pdf', cat: 'Societario', firma: false, desc: 'Bozza statuto societario tipo per holding europea.' },
  ]);

  const [formMasters, setFormMasters] = useState([
    { id: 'f1', nome: 'Form Dati Societari & Legale Rappresentante', campi: ['Ragione Sociale', 'P.IVA / VAT', 'Codice Fiscale', 'Indirizzo Sede Legale', 'Legale Rappresentante'] },
    { id: 'f2', nome: 'Form Titolarità Effettiva & Struttura di Controllo', campi: ['Nome Titolare Effettivo', 'Percentuale Quote', 'Dati Passaporto', 'Residenza Fiscale'] },
    { id: 'f3', nome: 'Form Dati Bancari & KYC Compliance', campi: ['Banca di Riferimento', 'IBAN', 'Origine dei Fondi', 'Volume Affari Annuo'] },
  ]);

  const [newDocOpen, setNewDocOpen] = useState(false);
  const [docName, setDocName] = useState('');
  const [docCat, setDocCat] = useState('Societario');
  const [docDesc, setDocDesc] = useState('');
  const [docSign, setDocSign] = useState(true);

  const [newFormOpen, setNewFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formFieldsText, setFormFieldsText] = useState('');

  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() && !fileToUpload) return;
    setUploading(true);
    let uploadedUrl = '';
    const nameToUse = docName.trim() || (fileToUpload ? fileToUpload.name : 'Documento.pdf');

    try {
      if (fileToUpload) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(fileToUpload);
        });
        const base64Data = await base64Promise;
        const uploadRes = await uploadFileApi(nameToUse, base64Data);
        if (uploadRes && uploadRes.url) {
          uploadedUrl = uploadRes.url;
        }
      }

      setDocModels([
        ...docModels,
        {
          id: `m-${Date.now()}`,
          nome: nameToUse.endsWith('.pdf') ? nameToUse : `${nameToUse}.pdf`,
          cat: docCat,
          firma: docSign,
          desc: docDesc || 'Modello documento caricato in libreria.',
          url: uploadedUrl || `/uploads/${nameToUse}`,
        },
      ]);
      setDocName('');
      setDocDesc('');
      setFileToUpload(null);
      setNewDocOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleAddForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const campiArr = formFieldsText.split(',').map(s => s.trim()).filter(Boolean);
    setFormMasters([
      ...formMasters,
      {
        id: `f-${Date.now()}`,
        nome: formName,
        campi: campiArr.length > 0 ? campiArr : ['Campo 1', 'Campo 2'],
      },
    ]);
    setFormName('');
    setFormFieldsText('');
    setNewFormOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sezione 1: Modelli Documenti in Bianco */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>📄 Modelli Documenti & Contratti in Bianco</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>I modelli in bianco caricati qui possono essere direttamente collegati all'anagrafica del cliente o alle microvoci di lavoro</div>
          </div>
          <button
            onClick={() => setNewDocOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            + Carica Nuovo Modello in Bianco
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {docModels.map(m => (
            <div key={m.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.nome}</div>
                  <CatBadge cat={m.cat as any} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{m.desc}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: m.firma ? '#a78bfa' : 'var(--muted)', fontWeight: 600 }}>
                  {m.firma ? '✍️ Richiede Firma Digitale' : 'ℹ️ Documento Informativo'}
                </span>
                <button style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}>
                  🔗 Collega a Cliente
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sezione 2: Form Master Dinamici */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Form Master Dinamici</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Definisci la struttura dei moduli di raccolta dati da guidare al cliente nel suo portale</div>
          </div>
          <button
            onClick={() => setNewFormOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            + Crea Nuovo Form Master
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {formMasters.map(f => (
            <div key={f.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>📋 {f.nome}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Campi di raccolta dati incorporati ({f.campi.length}):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {f.campi.map((c, i) => (
                  <span key={i} style={{ background: '#200f40', color: '#a78bfa', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Nuovo Modello Documento */}
      {newDocOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddDoc} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Carica Nuovo Modello Documento in Bianco</div>
            
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona File Documento (PDF/Word) *</label>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setFileToUpload(e.target.files[0]);
                    if (!docName) setDocName(e.target.files[0].name);
                  }
                }}
                style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome File Modello *</label>
              <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="es. Procura_Legale_MFSA_In_Bianco.pdf" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
              <select value={docCat} onChange={e => setDocCat(e.target.value)}>
                <option value="Societario">Societario</option>
                <option value="Compliance">Compliance</option>
                <option value="Banking">Banking</option>
                <option value="Analisi">Analisi</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione / Scopo *</label>
              <input value={docDesc} onChange={e => setDocDesc(e.target.value)} placeholder="es. Procura per deposito atti societari presso MFSA" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="chkSignDoc" checked={docSign} onChange={e => setDocSign(e.target.checked)} />
              <label htmlFor="chkSignDoc" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>Richiede Firma Digitale del Cliente (§22)</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setNewDocOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={uploading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{uploading ? 'Caricamento file...' : '+ Upload & Carica in Libreria'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Nuovo Form Master */}
      {newFormOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddForm} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Crea Nuovo Form Master Dinamico</div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Form Master *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="es. Form Adeguata Verifica & Profilo KYC" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Campi del Form (separati da virgola) *</label>
              <textarea
                value={formFieldsText}
                onChange={e => setFormFieldsText(e.target.value)}
                placeholder="es. Nome Completo, Codice Fiscale, Indirizzo Residenza, Origine Patrimoniale, IBAN"
                rows={4}
                required
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setNewFormOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Crea Form Master</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Componente Nuovo Articolo Modal ──────────────────────────────
function NuovoArticoloModal({ giurList, onClose, onCreated }: { giurList: Giurisdizione[]; onClose: () => void; onCreated: () => void }) {
  const [nome, setNome] = useState('');
  const [cat, setCat] = useState<CategoriaModulo>('Analisi');
  const [giurisdizioneId, setGiurisdizioneId] = useState<string>('');
  const [ore, setOre] = useState(4);
  const [prezzo, setPrezzo] = useState(1200);
  const [loading, setLoading] = useState(false);

  // Passaggi dinamici con Form e Documenti
  const [passaggi, setPassaggi] = useState<Array<{
    titolo: string;
    tipo: 'info' | 'documento' | 'form' | 'verifica';
    chi: 'operatore' | 'cliente';
    descrizione: string;
    campiFormText?: string;
    fileNome?: string;
  }>>([
    { titolo: 'Raccolta dati ed anagrafica', tipo: 'form', chi: 'cliente', descrizione: 'Il cliente compila il modulo con i dati societari.', campiFormText: 'Ragione Sociale, Partita IVA, Legale Rappresentante' },
    { titolo: 'Caricamento Contratto & Firma', tipo: 'documento', chi: 'cliente', descrizione: 'Il cliente scarica e firma digitalmente il documento.', fileNome: 'Accordo_Servizi_Advisory.pdf' },
    { titolo: 'Verifica ed approvazione operatoria', tipo: 'verifica', chi: 'operatore', descrizione: 'L\'operatore verifica la conformità dei dati inviati.' },
  ]);

  const addPassaggio = () => {
    setPassaggi([
      ...passaggi,
      { titolo: 'Nuovo passaggio', tipo: 'info', chi: 'operatore', descrizione: 'Descrizione delle attività previste' },
    ]);
  };

  const removePassaggio = (index: number) => {
    setPassaggi(passaggi.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setLoading(true);
    try {
      await creaArticoloApi({
        nome,
        categoria: cat,
        oreDefault: Number(ore),
        prezzoDefault: Number(prezzo) * 100,
        passaggi: passaggi.map(p => ({
          titolo: p.titolo,
          tipo: p.tipo,
          chi: p.chi,
          descrizione: p.tipo === 'form'
            ? `${p.descrizione} (Campi: ${p.campiFormText || 'Nessuno'})`
            : p.tipo === 'documento'
            ? `${p.descrizione} [Allegato: ${p.fileNome || 'Documento.pdf'}]`
            : p.descrizione,
        })),
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Nuovo Articolo Prestazione con Procedura & Form</div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome prestazione / articolo *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Redazione Parere Fiscale Malta" required />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
            <select value={cat} onChange={e => setCat(e.target.value as CategoriaModulo)}>
              {['Analisi', 'Societario', 'Trust', 'Banking', 'Fiscale', 'Legale', 'IP', 'Compliance'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🌍 Giurisdizione Target *</label>
          <select value={giurisdizioneId} onChange={e => setGiurisdizioneId(e.target.value)}>
            <option value="">🌐 Generico / Tutte le Giurisdizioni</option>
            {giurList.map(g => {
              const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
              return <option key={g.id} value={g.id}>{flag} {g.nome} ({g.codice})</option>;
            })}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore previste (default)</label>
            <input type="number" value={ore} onChange={e => setOre(Number(e.target.value))} min={1} required />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Prezzo listino (€)</label>
            <input type="number" value={prezzo} onChange={e => setPrezzo(Number(e.target.value))} min={0} step={50} required />
          </div>
        </div>

        {/* Costruttore Passaggi (Form & Documenti) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)' }}>
              ⚙️ Procedura Guidata Passaggi (Form, Documenti & Firma)
            </span>
            <button type="button" onClick={addPassaggio} style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
              + Aggiungi Passaggio
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {passaggi.map((p, i) => (
              <div key={i} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', width: 20 }}>#{i + 1}</span>
                  <input
                    style={{ flex: 2, fontSize: 12 }}
                    value={p.titolo}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].titolo = e.target.value;
                      setPassaggi(updated);
                    }}
                    placeholder="Titolo passaggio..."
                    required
                  />
                  <select
                    style={{ flex: 1, fontSize: 11 }}
                    value={p.tipo}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].tipo = e.target.value as any;
                      setPassaggi(updated);
                    }}
                  >
                    <option value="info">ℹ️ Testo Info</option>
                    <option value="form">📋 Form Dati</option>
                    <option value="documento">📎 Doc Firma</option>
                    <option value="verifica">✓ Verifica</option>
                  </select>
                  <select
                    style={{ flex: 1, fontSize: 11 }}
                    value={p.chi}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].chi = e.target.value as any;
                      setPassaggi(updated);
                    }}
                  >
                    <option value="cliente">🧑‍💼 Cliente</option>
                    <option value="operatore">👤 Operatore</option>
                  </select>
                  <button type="button" onClick={() => removePassaggio(i)} style={{ background: 'none', border: 'none', color: 'var(--hint)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>

                {/* Campi specifici per FORM */}
                {p.tipo === 'form' && (
                  <div style={{ marginTop: 2 }}>
                    <label style={{ fontSize: 10, color: '#a78bfa', display: 'block', marginBottom: 2 }}>📋 Campi del Form richiesti al cliente (separati da virgola):</label>
                    <input
                      style={{ fontSize: 11, background: '#200f40', borderColor: '#4c1d95' }}
                      value={p.campiFormText || ''}
                      onChange={e => {
                        const updated = [...passaggi];
                        updated[i].campiFormText = e.target.value;
                        setPassaggi(updated);
                      }}
                      placeholder="es. Ragione Sociale, P.IVA, Titolare Effettivo, IBAN"
                    />
                  </div>
                )}

                {/* Campi specifici per DOCUMENTO */}
                {p.tipo === 'documento' && (
                  <div style={{ marginTop: 2 }}>
                    <label style={{ fontSize: 10, color: '#818cf8', display: 'block', marginBottom: 2 }}>📎 Nome File PDF da caricare per Firma Cliente:</label>
                    <input
                      style={{ fontSize: 11, background: '#1a1f3d', borderColor: '#2d3260' }}
                      value={p.fileNome || ''}
                      onChange={e => {
                        const updated = [...passaggi];
                        updated[i].fileNome = e.target.value;
                        setPassaggi(updated);
                      }}
                      placeholder="es. Contratto_Firma_Cliente.pdf"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={loading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{loading ? 'Salvataggio...' : '✓ Salva Articolo & Procedura'}</button>
        </div>
      </form>
    </div>
  );
}

// ─── Componente Costruttore Modulo Template ───────────────────────
function CreaModuloForm({ articoliList, giurList, onCreated }: { articoliList: Articolo[]; giurList: Giurisdizione[]; onCreated: () => void }) {
  const [nome, setNome] = useState('');
  const [cat, setCat] = useState<CategoriaModulo>('Societario');
  const [giurisdizioneId, setGiurisdizioneId] = useState<string>('');
  const [prezzoPkg, setPrezzoPkg] = useState<number | ''>('');
  const [selectedArts, setSelectedArts] = useState<Array<{ artId: string; qty: number; customPrice?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleArt = (artId: string) => {
    setSelectedArts(prev => {
      const exists = prev.find(x => x.artId === artId);
      if (exists) return prev.filter(x => x.artId !== artId);
      const art = articoliList.find(a => a.id === artId);
      return [...prev, { artId, qty: 1, customPrice: art?.p }];
    });
  };

  const updateQty = (artId: string, qty: number) => {
    setSelectedArts(prev => prev.map(x => x.artId === artId ? { ...x, qty: Math.max(1, qty) } : x));
  };

  const updateCustomPrice = (artId: string, price: number) => {
    setSelectedArts(prev => prev.map(x => x.artId === artId ? { ...x, customPrice: Math.max(0, price) } : x));
  };

  const handleSave = async () => {
    if (!nome.trim() || selectedArts.length === 0) return;
    setLoading(true);
    try {
      await creaModuloTemplateApi({
        nome,
        categoria: cat,
        giurisdizioneId: giurisdizioneId || null,
        prezzoPacchetto: prezzoPkg !== '' ? Number(prezzoPkg) * 100 : null,
        righe: selectedArts.map(x => ({ articoloId: x.artId, quantita: x.qty })),
      });
      onCreated();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const totalCalculated = selectedArts.reduce((acc, curr) => {
    const art = articoliList.find(a => a.id === curr.artId);
    const unitPrice = curr.customPrice !== undefined ? curr.customPrice : (art ? art.p : 0);
    return acc + (unitPrice * curr.qty);
  }, 0);

  const totalHours = selectedArts.reduce((acc, curr) => {
    const art = articoliList.find(a => a.id === curr.artId);
    return acc + (art ? art.h * curr.qty : 0);
  }, 0);

  const filteredArticoli = articoliList.filter(a =>
    a.n.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.cat.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
      {/* Colonna 1: Editor Modulo Template */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 12px 36px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Costruttore Modulo Template</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Componi la distinta base ed imposta la giurisdizione target ed il listino pacchetto</div>
          </div>
          <CatBadge cat={cat} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Modulo Template *</label>
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="es. Corporate Structuring & Holding Malta"
              required
              style={{ fontSize: 13, fontWeight: 600 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
              <select value={cat} onChange={e => setCat(e.target.value as CategoriaModulo)}>
                {['Analisi', 'Societario', 'Trust', 'Banking', 'Fiscale', 'Legale', 'IP', 'Compliance'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🌍 Giurisdizione Target *</label>
              <select value={giurisdizioneId} onChange={e => setGiurisdizioneId(e.target.value)}>
                <option value="">🌐 Generico (Tutte)</option>
                {giurList.map(g => {
                  const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
                  return <option key={g.id} value={g.id}>{flag} {g.nome} ({g.codice})</option>;
                })}
              </select>
            </div>
          </div>
        </div>

        {/* Selezione Articoli Distinta Base */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)' }}>
              🧱 Articoli della Distinta Base ({selectedArts.length} selezionati)
            </span>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Cerca articolo..."
              style={{ width: 140, padding: '4px 8px', fontSize: 11 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
            {filteredArticoli.map(a => {
              const item = selectedArts.find(x => x.artId === a.id);
              const isSel = !!item;
              const currentPrice = item?.customPrice !== undefined ? item.customPrice : a.p;

              return (
                <div
                  key={a.id}
                  style={{
                    background: isSel ? 'linear-gradient(135deg,#1a1f3d,#1e2045)' : 'var(--card2)',
                    border: `1px solid ${isSel ? 'var(--indigo-l)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    transition: 'all var(--t)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleArt(a.id)}>
                    <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer', transform: 'scale(1.1)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: isSel ? '#fff' : 'var(--text)' }}>{a.n}</div>
                      <div style={{ fontSize: 10, color: isSel ? '#a5b4fc' : 'var(--muted)', marginTop: 2 }}>
                        {a.cat} · ⏱ {a.h}h stimate · Listino: {fmt(a.p)}
                      </div>
                    </div>
                  </div>

                  {isSel && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--sidebar)', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', gap: 10 }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>Q.tà:</span>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={e => updateQty(a.id, Number(e.target.value))}
                          style={{ width: 44, padding: '3px 4px', fontSize: 11, fontWeight: 700, textAlign: 'center' }}
                          min={1}
                        />
                      </div>

                      {/* EDIT PREZZO PERSONALIZZATO */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>€ Prezzo unitario:</span>
                        <input
                          type="number"
                          value={currentPrice}
                          onChange={e => updateCustomPrice(a.id, Number(e.target.value))}
                          style={{ width: 80, padding: '3px 6px', fontSize: 11, fontWeight: 700, textAlign: 'right', color: '#34d399', background: '#0d2d22', borderColor: '#1a5c3c' }}
                          min={0}
                          step={50}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Colonna 2: Anteprima Live & Riepilogo Economico */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 12px 36px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>👁 Anteprima Modulo Template</span>
        </div>

        {selectedArts.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--card2)', borderRadius: 12, border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Nessun articolo ancora selezionato</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Seleziona gli articoli a sinistra per comporre la distinta base del modulo.</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{nome || 'Nuovo Modulo Template'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {selectedArts.length} prestazioni incorporate · Stima totale <strong>{totalHours}h operative</strong>
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Distinta Base Componenti:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto', maxHeight: 240 }}>
              {selectedArts.map((item, idx) => {
                const art = articoliList.find(a => a.id === item.artId);
                if (!art) return null;
                return (
                  <div key={idx} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                    <div>
                      <strong>{item.qty}x</strong> {art.n}
                      <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>({art.h * item.qty}h)</span>
                    </div>
                    <div style={{ fontWeight: 600 }}>{fmt(art.p * item.qty)}</div>
                  </div>
                );
              })}
            </div>

            {/* Riepilogo Economico & Forfait */}
            <div style={{ background: 'linear-gradient(135deg,#1a1f3d,#1e2045)', border: '1px solid #2d3260', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: '#818cf8' }}>Somma Singoli Articoli:</span>
                <span style={{ fontWeight: 700, color: '#fff' }}>{fmt(totalCalculated)}</span>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#a5b4fc', display: 'block', marginBottom: 4 }}>Prezzo Forfait Modulo (€ opzionale) *</label>
                <input
                  type="number"
                  value={prezzoPkg}
                  onChange={e => setPrezzoPkg(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={`Prezzo Pacchetto € (Default ${fmt(totalCalculated)})`}
                  style={{ fontSize: 13, fontWeight: 700, background: '#0f172a', borderColor: '#334155' }}
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={!nome.trim() || selectedArts.length === 0 || loading}
              style={{
                width: '100%',
                background: 'var(--indigo)',
                color: '#fff',
                border: 'none',
                padding: '12px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                opacity: (!nome.trim() || selectedArts.length === 0) ? 0.5 : 1,
                boxShadow: '0 4px 16px rgba(99,102,241,.4)',
              }}
            >
              {loading ? 'Salvataggio...' : '✓ Salva Modulo Template con Distinta Base'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
