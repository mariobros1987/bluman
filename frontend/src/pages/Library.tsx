import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, moduloH, moduloP, resolveRighe, levelOf } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import { PREBUILT_TEMPLATES, getAllTemplates, saveCustomTemplate, deleteTemplate, archiveTemplate, restoreTemplate, importTemplatesFromJson, exportTemplatesAsJson, type DocumentTemplate } from '../utils/documentTemplates';
import { getTenantStorageKey, getStudioInfoForTenant, getCurrentTenantId } from '../utils/tenant';
import { fetchModuliLibreria, fetchArticoli, fetchGiurisdizioniApi, creaGiurisdizioneApi, creaArticoloApi, creaModuloTemplateApi, aggiornaModuloTemplateApi, disattivaModuloTemplateApi, disattivaArticoloApi, updateArticoloPrezzoApi, uploadFileApi, fetchClienti, fetchProgetti, creaProgettoApi, salvaProgettoDettaglioApi, creaDocumentoTemplateApi, eliminaDocumentoTemplateApi } from '../api/client';
import type { CategoriaModulo, Articolo, Giurisdizione, ModuloTemplate } from '../types';

type SubTab = 'grafo' | 'articoli' | 'giurisdizioni' | 'crea_modulo' | 'doc_form';

export function Library() {
  const [subTab, setSubTab] = useState<SubTab>('grafo');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [articoliList, setArticoliList] = useState<Articolo[]>([]);
  const [giurList, setGiurList] = useState<Giurisdizione[]>([]);
  const [moduliList, setModuliList] = useState<ModuloTemplate[]>([]);
  const [modalArticoloOpen, setModalArticoloOpen] = useState(false);
  const [selectedGiurId, setSelectedGiurId] = useState<string>('ALL');
  const [assignModalModule, setAssignModalModule] = useState<ModuloTemplate | null>(null);
  const [moduloInModifica, setModuloInModifica] = useState<ModuloTemplate | null>(null);

  // §30 — la disattivazione è irreversibile per design: i riferimenti da
  // ModuloProgetto/Preventivo restano validi, il modulo sparisce solo dalla libreria.
  // Aggiorno lo stato locale solo DOPO la conferma del server (§3.3).
  const handleDisattivaModulo = async (m: ModuloTemplate) => {
    const conferma = window.confirm(
      `Disattivare il modulo template «${m.n}»?\n` +
      'Il modulo sparirà dalla libreria, ma i progetti e i preventivi già creati continueranno a funzionare.'
    );
    if (!conferma) return;
    try {
      await disattivaModuloTemplateApi(m.id);
      setModuliList(prev => prev.filter(x => x.id !== m.id));
    } catch (err: any) {
      alert(`Disattivazione non riuscita: ${err?.message || 'errore di rete'}. Il modulo NON è stato disattivato.`);
    }
  };

  const handleDisattivaArticolo = async (id: string, nome: string) => {
    const conferma = window.confirm(
      `Disattivare l'articolo «${nome}»?\n` +
      'Sparirà dal catalogo, ma le distinte base e i progetti che già lo usano restano validi.'
    );
    if (!conferma) return;
    try {
      await disattivaArticoloApi(id);
      setArticoliList(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      alert(`Disattivazione non riuscita: ${err?.message || 'errore di rete'}. L'articolo NON è stato disattivato.`);
    }
  };

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
      // Solo articoli reali dal database: il vecchio merge con l'elenco mock
      // reiniettava voci di esempio anche quando il catalogo era già completo.
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

  // Filter moduli list by selected jurisdiction filter
  const filteredModuliList = selectedGiurId === 'ALL'
    ? moduliList
    : moduliList.filter(m => m.giurisdizioneId === selectedGiurId || !m.giurisdizioneId);

  // Topological levels calculation on filtered list
  const maxLvl = Math.max(...filteredModuliList.map(m => levelOf(m.id, moduliList)), 0);
  const cols: ModuloTemplate[][] = [];
  for (let i = 0; i <= maxLvl; i++) {
    cols.push(filteredModuliList.filter(m => levelOf(m.id, moduliList) === i));
  }
  const colLabels = ['Punto di partenza', 'Sbloccati a cascata', 'Dipendenti'];

  useEffect(() => {
    if (subTab === 'grafo') drawEdges();
  }, [open, subTab, moduliList, selectedGiurId]);

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
    filteredModuliList.forEach(m => {
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
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModuloInModifica(m);
                                  setSubTab('crea_modulo');
                                }}
                                title="Riapri nel costruttore per modificare nome, giurisdizione, prezzo e distinta base"
                                style={{ flex: 1, background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                              >
                                ✏️ Modifica
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDisattivaModulo(m);
                                }}
                                title="§30 — Disattivazione: il modulo sparisce dalla libreria, i progetti esistenti restano validi"
                                style={{ flex: 1, background: 'var(--card2)', border: '1px solid #5b2130', color: '#f87171', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                              >
                                🗑 Disattiva
                              </button>
                            </div>
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
          onDisattiva={handleDisattivaArticolo}
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
          onLinkModulo={(modId, giurId) => {
            setModuliList(prev => prev.map(m => m.id === modId ? { ...m, giurisdizioneId: giurId || undefined } : m));
          }}
        />
      )}

      {/* TAB 4: Costruttore Modulo Template (anche modalità modifica §36) */}
      {subTab === 'crea_modulo' && (
        <CreaModuloForm
          key={moduloInModifica?.id ?? 'nuovo'}
          articoliList={articoliList}
          giurList={giurList}
          moduloInModifica={moduloInModifica}
          onCreated={() => {
            setModuloInModifica(null);
            loadData();
            setSubTab('grafo');
          }}
          onAnnullaModifica={() => {
            setModuloInModifica(null);
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
      const storageKey = getTenantStorageKey('bluman_custom_projects');
      const savedStr = localStorage.getItem(storageKey);
      const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
      const updatedArr = [updatedProj, ...savedArr.filter(p => String(p.id) !== String(projIdToUse))];
      localStorage.setItem(storageKey, JSON.stringify(updatedArr));

      onClose();
      navigate(`/projects/${projIdToUse}`);
    } catch (err: any) {
      // §3.3 — prima l'errore finiva solo in console.error: l'assegnazione falliva e il
      // modal restava lì senza alcun messaggio, oppure l'utente riprovava alla cieca.
      alert(`Assegnazione modulo non riuscita: ${err?.message || 'errore di rete'}. Il progetto NON è stato modificato.`);
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
function ArticoliCatalogView({ articoliList, onOpenNew, onDisattiva }: { articoliList: Articolo[]; onOpenNew: () => void; onDisattiva: (id: string, nome: string) => void }) {
  const [selectedCat, setSelectedCat] = useState<string>('TUTTI');
  const navigate = useNavigate();
  const editArtFileImportRef = useRef<HTMLInputElement>(null);
  const [allMasterTemplates, setAllMasterTemplates] = useState<DocumentTemplate[]>(() => getAllTemplates());

  const reloadMasterTemplates = () => {
    setAllMasterTemplates(getAllTemplates());
  };

  const resolveTemplateName = (mId: string) => {
    if (mId === 'm1') return 'Accordo NDA Riservatezza';
    if (mId === 'm2') return 'Procura Legale & Delega';
    if (mId === 'm3') return 'Dichiarazione UBO';
    if (mId === 'm4') return 'Statuto & Memorandum';
    const found = allMasterTemplates.find(t => t.id === mId);
    return found ? found.titolo : mId;
  };

  const handleCreateNewWordForArticle = async () => {
    const title = prompt('Inserisci il nome del nuovo Modello Word per questa prestazione:', `${editName || 'Documento'} - Modello Word`);
    if (!title || !title.trim()) return;

    const newTmpl: DocumentTemplate = {
      id: `tmpl-custom-${Date.now()}`,
      titolo: title.trim(),
      categoria: (editingArt?.cat.toLowerCase() as any) || 'societario',
      descrizione: `Modello Word personalizzato creato per la prestazione "${editName}".`,
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; font-size: 18px; margin-bottom: 20px;">${title.trim().toUpperCase()}</h1>
<p style="text-align: right; color: #64748b; font-size: 11px;"><strong>Data:</strong> {{data_odierna}} | <strong>Pratica:</strong> {{progetto.titolo}}</p>
<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px; margin: 20px 0; font-size: 11.5px;">
  <strong>Cliente:</strong> {{cliente.ragione_sociale}} (P.IVA {{cliente.partita_iva}})<br/>
  <strong>Studio:</strong> {{studio.ragione_sociale}}
</div>
<p style="font-size: 11.5px; line-height: 1.6;">Testo e condizioni operative per la prestazione ${editName}...</p>
      `,
    };

    saveCustomTemplate(newTmpl);
    // §3.3 — se il server non conferma, il modello esiste solo in localStorage: va detto,
    // non mostrato come «creato» e basta (al cambio dispositivo sparirebbe).
    try {
      await creaDocumentoTemplateApi(newTmpl);
      reloadMasterTemplates();
      setEditDocModels(prev => [...prev, newTmpl.id]);
      alert(`✓ Nuovo Modello Word "${newTmpl.titolo}" creato e allacciato all'articolo!`);
    } catch (err: any) {
      alert(`Modello "${newTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}. Al prossimo reload da un altro dispositivo non sarà visibile.`);
      setEditDocModels(prev => [...prev, newTmpl.id]);
    }
  };

  const handleImportDocFileForArticle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      let htmlBody = '';
      if (file.name.endsWith('.json')) {
        const res = importTemplatesFromJson(content);
        if (res.success) {
          reloadMasterTemplates();
          const first = getAllTemplates()[0];
          if (first) setEditDocModels(prev => [...prev, first.id]);
          alert(`✓ Modello importato da file JSON e allacciato all'articolo!`);
          return;
        }
      } else {
        htmlBody = content || `<h1>${file.name}</h1><p>Documento importato da PC per ${editName}...</p>`;
      }

      const docNameClean = file.name.replace(/\.[^/.]+$/, "");
      const newTmpl: DocumentTemplate = {
        id: `tmpl-custom-${Date.now()}`,
        titolo: docNameClean,
        categoria: (editingArt?.cat.toLowerCase() as any) || 'societario',
        descrizione: `Documento caricato da PC (${file.name}) per la prestazione "${editName}".`,
        contenutoHtml: htmlBody,
      };

      saveCustomTemplate(newTmpl);
      // §3.3 — come sopra: salvataggio locale subito, ma la verità sul sync col server.
      try {
        await creaDocumentoTemplateApi(newTmpl);
        reloadMasterTemplates();
        setEditDocModels(prev => [...prev, newTmpl.id]);
        alert(`✓ File "${file.name}" importato dal PC e allacciato con successo!`);
      } catch (err: any) {
        alert(`File "${file.name}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
        setEditDocModels(prev => [...prev, newTmpl.id]);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchEditArtTmpl, setSearchEditArtTmpl] = useState<string>('');
  const [editingArt, setEditingArt] = useState<Articolo | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editHours, setEditHours] = useState<number>(0);
  const [editName, setEditName] = useState<string>('');
  const [editFormMasterId, setEditFormMasterId] = useState<string>('f1');
  const [editDocModels, setEditDocModels] = useState<string[]>(['m1']);
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
    reloadMasterTemplates();
    setEditingArt(art);
    setEditPrice(art.p);
    setEditHours(art.h);
    setEditName(art.n);
    setEditFormMasterId(art.formMasterId || 'f1');
    setEditDocModels(art.documentiRichiesti || ['m1']);
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
      // §3.3 — aggiorna locale SOLO dopo la conferma del server. Prima anche il ramo
      // catch applicava le modifiche in locale e chiudeva il modal in silenzio: prezzo
      // e ore sembravano salvati mentre il database conservava i valori vecchi.
      editingArt.p = editPrice;
      editingArt.h = editHours;
      editingArt.n = editName;
      editingArt.documentiRichiesti = editDocModels;
      editingArt.formMasterId = editFormMasterId;
      setEditingArt(null);
    } catch (err: any) {
      alert(`Salvataggio articolo non riuscito: ${err?.message || 'errore di rete'}. Le modifiche NON sono state applicate, riprova.`);
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
                    title="Modifica Prezzo, Ore e Documenti Allacciati"
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✏️ Modifica
                  </button>
                  <button
                    onClick={() => onDisattiva(a.id, a.n)}
                    title="§30 — Disattivazione: sparisce dal catalogo, distinte e progetti esistenti restano validi"
                    style={{ background: '#2a1218', border: '1px solid #5b2130', color: '#f87171', padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                  >
                    🗑
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', background: '#1a1f3d', border: '1px solid #2d3260', padding: '2px 8px', borderRadius: 20 }}>
                    v{a.ver || 1}.0
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: 'var(--text)' }}>{a.n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📄 Documenti Allacciati:</span>
                  {(a.documentiRichiesti && a.documentiRichiesti.length > 0) ? (
                    a.documentiRichiesti.map(mId => (
                      <span
                        key={mId}
                        onClick={() => navigate(`/documents?tmplId=${mId}`)}
                        title="Clicca per aprire in Document Studio (Word)"
                        style={{ background: '#1a1f3d', color: '#818cf8', padding: '2px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, border: '1px solid #3730a3', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <span>📎 {resolveTemplateName(mId)}</span>
                        <span style={{ fontSize: 8.5, opacity: 0.8 }}>↗</span>
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 10, fontStyle: 'italic' }}>Nessun documento allacciato</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📋 Form Cliente:</span>
                  {a.formMasterId ? (
                    <span style={{ background: '#200f40', color: '#a78bfa', padding: '2px 6px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, border: '1px solid #581c87' }}>
                      {a.formMasterId === 'f1' ? 'Form Dati Societari' : a.formMasterId === 'f2' ? 'Form UBO & Controllo' : 'Form Dati Bancari & KYC'}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 10, fontStyle: 'italic' }}>Nessun form richiesto</span>
                  )}
                </div>
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

      {/* Modal Modifica Prezzo & Ore Articolo (§Admin) con 3 Opzioni Documento */}
      {editingArt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleSaveEdit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✏️ Modifica Listino & Documenti Allacciati</span>
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

            {/* Sezione Documenti Allacciati: 1. In Memoria, 2. Crea Nuovo Word, 3. Importa da PC */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>📄 Documenti & Modelli Allacciati ({editDocModels.length})</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Seleziona dalla memoria, crea un nuovo modello Word o importalo dal PC</div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="file"
                    ref={editArtFileImportRef}
                    accept=".docx,.doc,.pdf,.html,.htm,.json"
                    style={{ display: 'none' }}
                    onChange={handleImportDocFileForArticle}
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewWordForArticle}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Crea un nuovo modello Word dedicato a questa prestazione"
                  >
                    ➕ Nuovo Word
                  </button>
                  <button
                    type="button"
                    onClick={() => editArtFileImportRef.current?.click()}
                    style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Importa file .docx, .pdf, .html o .json dal tuo computer"
                  >
                    📁 Importa da PC
                  </button>
                </div>
              </div>

              {/* Search Filter per i Modelli nel modale */}
              <input
                type="text"
                placeholder="🔍 Cerca modello da allacciare..."
                value={searchEditArtTmpl}
                onChange={e => setSearchEditArtTmpl(e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', width: '100%' }}
              />

              {/* Grid di selezione di tutti i modelli in memoria */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxHeight: 180, overflowY: 'auto', background: 'var(--card)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                {allMasterTemplates
                  .filter(item => !searchEditArtTmpl || item.titolo.toLowerCase().includes(searchEditArtTmpl.toLowerCase()) || item.categoria.toLowerCase().includes(searchEditArtTmpl.toLowerCase()))
                  .map(item => {
                  const checked = editDocModels.includes(item.id);
                  const isCustom = item.id.startsWith('tmpl-custom');
                  return (
                    <label
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        fontSize: 11,
                        cursor: 'pointer',
                        padding: '4px 6px',
                        borderRadius: 6,
                        background: checked ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                        color: checked ? '#a5b4fc' : 'var(--text)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            if (e.target.checked) {
                              setEditDocModels([...editDocModels, item.id]);
                            } else {
                              setEditDocModels(editDocModels.filter(x => x !== item.id));
                            }
                          }}
                        />
                        <span style={{ fontWeight: checked ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.titolo}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {isCustom && (
                          <span style={{ fontSize: 8.5, background: '#064e3b', color: '#34d399', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                            Custom
                          </span>
                        )}
                        <span style={{ fontSize: 8.5, background: 'var(--card2)', color: 'var(--muted)', padding: '1px 4px', borderRadius: 4, textTransform: 'uppercase' }}>
                          {item.categoria}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Form Master Dinamico */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📋 Form Master Dati da far Compilare al Cliente</label>
              <select
                value={editFormMasterId}
                onChange={e => setEditFormMasterId(e.target.value)}
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
  onLinkModulo,
}: {
  giurList: Giurisdizione[];
  moduliList: ModuloTemplate[];
  onAddGiur: (g: Giurisdizione) => void;
  onOpenInGraph: (giurId: string) => void;
  onLinkModulo?: (modId: string, giurId: string | null) => void;
}) {
  const [modalGiurOpen, setModalGiurOpen] = useState(false);
  const [selectedGiur, setSelectedGiur] = useState<Giurisdizione | null>(null);
  const [newGiurNome, setNewGiurNome] = useState('');
  const [newGiurCodice, setNewGiurCodice] = useState('');
  const [newGiurTipo, setNewGiurTipo] = useState<'ue' | 'extra_ue' | 'stato_usa' | 'altro'>('ue');
  const [newGiurNote, setNewGiurNote] = useState('');
  const [selectedModToAssign, setSelectedModToAssign] = useState<string>('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Guida / Instruction Banner */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💡 Come assegnare un Modello alla Giurisdizione:</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
            • <strong>Metodo 1 (Rapido):</strong> Clicca su qualsiasi giurisdizione sotto per aprire il modal e seleziona il modulo da associare.<br />
            • <strong>Metodo 2 (Costruttore):</strong> Vai nella scheda <em>"Costruttore Modulo Template"</em> e scegli la giurisdizione target dal menu a tendina.
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
                  Gestisci & Associa ➔
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dettaglio & Assegnazione Moduli Giurisdizione */}
      {selectedGiur && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{selectedGiur.codice === 'MT' ? '🇲🇹' : selectedGiur.codice === 'GI' ? '🇬🇮' : selectedGiur.codice.startsWith('US') ? '🇺🇸' : selectedGiur.codice === 'AE' ? '🇦🇪' : '🌐'}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedGiur.nome} ({selectedGiur.codice})</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Gestione Moduli Specifici della Piazza Finanziaria</div>
                </div>
              </div>
              <button onClick={() => setSelectedGiur(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            {/* Assegnazione 1-Click Nuovo Modulo */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', textTransform: 'uppercase' }}>
                ➕ Associa un Modello di Libreria a questa Giurisdizione
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={selectedModToAssign}
                  onChange={e => setSelectedModToAssign(e.target.value)}
                  style={{ flex: 1, padding: 8, fontSize: 12 }}
                >
                  <option value="">-- Seleziona Modulo da Associare --</option>
                  {moduliList.filter(m => m.giurisdizioneId !== selectedGiur.id).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.n} ({m.cat}) {m.giurisdizioneId ? '— (Già associato ad altra giur)' : '— (Generico)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedModToAssign) return;
                    if (onLinkModulo) {
                      onLinkModulo(selectedModToAssign, selectedGiur.id);
                    }
                    const targetMod = moduliList.find(m => m.id === selectedModToAssign);
                    alert(`✓ Modulo "${targetMod?.n}" associato con successo alla giurisdizione ${selectedGiur.nome}!`);
                    setSelectedModToAssign('');
                  }}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Associa
                </button>
              </div>
            </div>

            {/* Lista Moduli Collegati */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>🧩 Moduli Template Attualmente Collegati ({moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length}):</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: 12, background: 'var(--card2)', borderRadius: 8, textAlign: 'center' }}>
                    Nessun modulo specifico attualmente collegato a questa giurisdizione.<br />Usa il menu sopra per associare i moduli spettai.
                  </div>
                ) : (
                  moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).map(m => (
                    <div key={m.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.n}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Cat: {m.cat} · Version v{m.ver}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CatBadge cat={m.cat} />
                        <button
                          type="button"
                          onClick={() => {
                            if (onLinkModulo) {
                              onLinkModulo(m.id, null);
                            }
                            alert(`✓ Modulo "${m.n}" scollegato dalla giurisdizione ${selectedGiur.nome}. Torna ad essere generico.`);
                          }}
                          title="Scollega da questa giurisdizione"
                          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--red)', padding: '2px 6px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}
                        >
                          ✕ Scollega
                        </button>
                      </div>
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
                🕸 VEDI NEL GRAFO CON FILTRO ATTIVO ➔
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
                // §3.3 — creaGiurisdizioneApi ora lancia se il server rifiuta o non risponde:
                // la giurisdizione si aggiunge alla lista SOLO con l'oggetto restituito dal DB,
                // mai con un id inventato dal client (succedeva: 'giur-<timestamp>').
                try {
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
                } catch (err: any) {
                  alert(`Creazione giurisdizione non riuscita: ${err?.message || 'errore di rete'}. Riprova.`);
                }
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
  const navigate = useNavigate();
  const libImportFileRef = useRef<HTMLInputElement>(null);

  const [searchDocQuery, setSearchDocQuery] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState('TUTTI');
  const [statusFilter, setStatusFilter] = useState<'attivi' | 'archiviati' | 'tutti'>('attivi');

  const [docModels, setDocModels] = useState<Array<{ id: string; nome: string; cat: string; firma: boolean; desc: string; url?: string; templateId?: string; archiviato?: boolean }>>(() => {
    return getAllTemplates(true).map(t => ({
      id: t.id,
      templateId: t.id,
      nome: `${t.titolo}.docx`,
      cat: t.categoria === 'engagement' || t.categoria === 'nda' ? 'Contratti' :
           t.categoria === 'societario' ? 'Societario' :
           t.categoria === 'trust' ? 'Trust' :
           t.categoria === 'compliance' ? 'Compliance' :
           t.categoria === 'delega' ? 'Societario' : 'Contratti',
      firma: t.id === 'tmpl-engagement' || t.id === 'tmpl-nda' || t.id === 'tmpl-delega' || t.id === 'tmpl-compliance',
      desc: t.descrizione,
      archiviato: !!t.archiviato,
    }));
  });

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

  const reloadDocModels = () => {
    const all = getAllTemplates(true);
    setDocModels(all.map(t => ({
      id: t.id,
      templateId: t.id,
      nome: `${t.titolo}.docx`,
      cat: t.categoria === 'engagement' || t.categoria === 'nda' ? 'Contratti' :
           t.categoria === 'societario' ? 'Societario' :
           t.categoria === 'trust' ? 'Trust' :
           t.categoria === 'compliance' ? 'Compliance' :
           t.categoria === 'delega' ? 'Societario' : 'Contratti',
      firma: t.id === 'tmpl-engagement' || t.id === 'tmpl-nda' || t.id === 'tmpl-delega' || t.id === 'tmpl-compliance',
      desc: t.descrizione,
      archiviato: !!t.archiviato,
    })));
  };

  const handleArchiveDoc = (templateId: string, nome: string) => {
    archiveTemplate(templateId);
    reloadDocModels();
    alert(`📦 Modello "${nome}" archiviato con successo. (I documenti storici già presenti nei progetti rimangono inalterati).`);
  };

  const handleRestoreDoc = (templateId: string, nome: string) => {
    restoreTemplate(templateId);
    reloadDocModels();
    alert(`♻️ Modello "${nome}" ripristinato tra i modelli attivi dello studio.`);
  };

  const handleDeleteDoc = async (templateId: string, nome: string) => {
    if (!confirm(`Sei sicuro di voler eliminare definitivamente il modello master "${nome}"?\n\nI documenti già firmati o salvati nei progetti del cliente rimarranno comunque congelati e perfettamente integri.`)) return;
    // §3.3 — prima la rimozione locale avveniva PRIMA della chiamata e il `catch {}`
    // vuoto annunciava comunque «eliminato»: il modello spariva dalla lista ma restava
    // a database (e riappariva al reload). Ora si cancella in locale solo a conferma avvenuta.
    try {
      await eliminaDocumentoTemplateApi(templateId);
      deleteTemplate(templateId);
      reloadDocModels();
      alert(`🗑️ Modello "${nome}" eliminato dalla libreria master.`);
    } catch (err: any) {
      alert(`Eliminazione del modello "${nome}" non riuscita: ${err?.message || 'errore di rete'}. Il modello NON è stato rimosso.`);
    }
  };

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() && !fileToUpload) return;
    setUploading(true);
    let uploadedUrl = '';
    const nameToUse = docName.trim() || (fileToUpload ? fileToUpload.name : 'Documento.docx');

    try {
      let fileText = '';
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

      const customTmpl: DocumentTemplate = {
        id: `tmpl-custom-${Date.now()}`,
        titolo: nameToUse.replace(/\.[^/.]+$/, ""),
        categoria: (docCat.toLowerCase() as any) || 'societario',
        descrizione: docDesc || 'Modello master personalizzato caricato nella libreria studio.',
        contenutoHtml: fileText || `<h1>${nameToUse}</h1><p>Bozza modello master studio...</p>`,
      };

      saveCustomTemplate(customTmpl);
      // §3.3 — il vecchio catch faceva solo console.error: upload o salvataggio falliti
      // sparivano in silenzio con lo spinner che si fermava come se tutto fosse andato bene.
      try {
        await creaDocumentoTemplateApi(customTmpl);
        reloadDocModels();
        setDocName('');
        setDocDesc('');
        setFileToUpload(null);
        setNewDocOpen(false);
        alert(`✓ Nuovo Modello Master "${customTmpl.titolo}" aggiunto con successo!`);
      } catch (err: any) {
        reloadDocModels();
        alert(`Modello "${customTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
      }
    } catch (err: any) {
      // Upload del file fallito: niente è stato salvato, né in locale né sul server.
      alert(`Caricamento del documento non riuscito: ${err?.message || 'errore di rete'}. Il file NON è stato salvato.`);
    } finally {
      setUploading(false);
    }
  };

  const handleImportBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        const res = importTemplatesFromJson(content);
        if (res.success) {
          reloadDocModels();
          alert(`✓ ${res.count} Modelli Master importati con successo nel Vault Studio!`);
        } else {
          alert('Errore importazione: ' + res.error);
        }
      } else {
        const customTmpl: DocumentTemplate = {
          id: `tmpl-custom-${Date.now()}`,
          titolo: file.name.replace(/\.[^/.]+$/, ""),
          categoria: 'societario',
          descrizione: `Modello importato da "${file.name}"`,
          contenutoHtml: content,
        };
        saveCustomTemplate(customTmpl);
        // §3.3 — l'import da file non deve annunciare successi se il server non conferma.
        try {
          await creaDocumentoTemplateApi(customTmpl);
          reloadDocModels();
          alert(`✓ Modello "${customTmpl.titolo}" importato con successo!`);
        } catch (err: any) {
          alert(`Modello "${customTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportBundle = () => {
    const jsonStr = exportTemplatesAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluman_master_templates_bundle_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  const [linkingDocModel, setLinkingDocModel] = useState<any | null>(null);
  const [clientiList, setClientiList] = useState<any[]>([]);
  const [progettiList, setProgettiList] = useState<any[]>([]);
  const [selectedLinkClientId, setSelectedLinkClientId] = useState<string>('');
  const [selectedLinkProjId, setSelectedLinkProjId] = useState<string>('');
  const [clientModalSearch, setClientModalSearch] = useState<string>('');
  const [linkingSuccessMsg, setLinkingSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadLinkageData() {
      const dbClienti = await fetchClienti();
      if (dbClienti && Array.isArray(dbClienti) && dbClienti.length > 0) {
        setClientiList(dbClienti);
        setSelectedLinkClientId(String(dbClienti[0].id));
      }
      const dbProgetti = await fetchProgetti();
      if (dbProgetti && Array.isArray(dbProgetti)) {
        setProgettiList(dbProgetti);
      }
    }
    loadLinkageData();
  }, []);

  const handleDownloadTemplatePdf = async (m: any) => {
    const studio = getStudioInfoForTenant();
    const tmpl = getAllTemplates(true).find(t => t.id === m.templateId || t.id === m.id) || PREBUILT_TEMPLATES[0];
    const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #0f172a;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
          <div>
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">${studio.sedeLegale} · P.IVA ${studio.piva}</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Modello: #${m.cat}<br />
            Data: ${new Date().toLocaleDateString('it-IT')}
          </div>
        </div>
        <div>${tmpl.contenutoHtml}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>${studio.ragioneSociale} • Modello Ufficiale Studio</span>
          <span>Sigillo eIDAS Documentale • Validità Giuridica UE</span>
        </div>
      </div>
    `;
    await downloadRealPdf(m.nome.replace(/\.[^/.]+$/, "") + '.pdf', htmlContent);
  };

  const handleConfirmLinkToClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingDocModel || !selectedLinkClientId) return;
    const clientObj = clientiList.find(c => String(c.id) === String(selectedLinkClientId));
    const projObj = progettiList.find(p => String(p.id) === String(selectedLinkProjId));
    const targetName = projObj ? `nel Progetto "${projObj.n || projObj.nome}"` : 'nell Anagrafica del Cliente';

    setLinkingSuccessMsg(`✓ Modello "${linkingDocModel.nome}" collegato con successo a ${clientObj?.nome || 'Cliente'} ${targetName}!`);
    setTimeout(() => {
      setLinkingSuccessMsg(null);
      setLinkingDocModel(null);
    }, 2500);
  };

  // Filtraggio dinamico Modelli
  const filteredDocModels = docModels.filter(m => {
    const matchSearch = m.nome.toLowerCase().includes(searchDocQuery.toLowerCase()) || m.desc.toLowerCase().includes(searchDocQuery.toLowerCase());
    const matchCat = selectedCatFilter === 'TUTTI' || m.cat.toLowerCase() === selectedCatFilter.toLowerCase();
    const matchStatus = statusFilter === 'tutti' || (statusFilter === 'archiviati' ? !!m.archiviato : !m.archiviato);
    return matchSearch && matchCat && matchStatus;
  });

  const countAttivi = docModels.filter(m => !m.archiviato).length;
  const countArchiviati = docModels.filter(m => !!m.archiviato).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sezione 1: Modelli Documenti in Bianco */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📄 Modelli Documenti & Contratti Master ({filteredDocModels.length})</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Crea, importa, archivia o elimina modelli in bianco riutilizzabili dello studio</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={libImportFileRef}
              accept=".json,.html,.htm"
              style={{ display: 'none' }}
              onChange={handleImportBundle}
            />
            <button
              onClick={() => libImportFileRef.current?.click()}
              style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              📥 Importa Modello / Bundle
            </button>
            <button
              onClick={handleExportBundle}
              style={{ background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              📤 Esporta (.json)
            </button>
            <button
              onClick={() => navigate('/documents')}
              style={{ background: '#312e81', color: '#c7d2fe', border: '1px solid #4f46e5', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              📝 Apri Document Studio
            </button>
            <button
              onClick={() => setNewDocOpen(true)}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              + Nuovo Modello Master
            </button>
          </div>
        </div>

        {/* 🛡️ Banner Immutabilità Documenti Progetto */}
        <div style={{ background: '#0d221c', border: '1px solid #059669', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: '#34d399' }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <strong>Garanzia di Immutabilità Fascicoli & Progetti:</strong> L'archiviazione o l'eliminazione dei modelli master riguarda esclusivamente i nuovi utilizzi. I documenti già generati, firmati digitalmente con sigillo eIDAS e archiviati all'interno dei singoli Progetti del Cliente <strong>rimangono sigillati e congelati alla data di firma</strong>.
          </div>
        </div>

        {/* Barra Filtri di Ricerca & Stato */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card2)', padding: 10, borderRadius: 12, border: '1px solid var(--border)' }}>
          {/* Categorie */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['TUTTI', 'Contratti', 'Societario', 'Trust', 'Compliance'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCatFilter(cat)}
                style={{
                  background: selectedCatFilter === cat ? 'var(--indigo)' : 'var(--card)',
                  color: selectedCatFilter === cat ? '#fff' : 'var(--muted)',
                  border: `1px solid ${selectedCatFilter === cat ? 'var(--indigo-l)' : 'var(--border)'}`,
                  padding: '4px 10px',
                  borderRadius: 16,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Stato Toggle & Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setStatusFilter('attivi')}
                style={{
                  background: statusFilter === 'attivi' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'attivi' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🟢 Attivi ({countAttivi})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('archiviati')}
                style={{
                  background: statusFilter === 'archiviati' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'archiviati' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                📦 Archiviati ({countArchiviati})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('tutti')}
                style={{
                  background: statusFilter === 'tutti' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'tutti' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tutti ({docModels.length})
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Cerca modello..."
              value={searchDocQuery}
              onChange={e => setSearchDocQuery(e.target.value)}
              style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 8, width: 180 }}
            />
          </div>
        </div>

        {/* Griglia Modelli */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
          {filteredDocModels.map(m => (
            <div
              key={m.id}
              style={{
                background: m.archiviato ? 'rgba(30, 27, 75, 0.25)' : 'var(--card2)',
                border: `1px solid ${m.archiviato ? '#4338ca' : 'var(--border)'}`,
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 10,
                opacity: m.archiviato ? 0.8 : 1,
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{m.nome}</span>
                    {m.archiviato && (
                      <span style={{ fontSize: 9, background: '#312e81', color: '#c7d2fe', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                        📦 Archiviato
                      </span>
                    )}
                  </div>
                  <CatBadge cat={m.cat as any} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{m.desc}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 10, color: m.firma ? '#a78bfa' : 'var(--muted)', fontWeight: 600 }}>
                  {m.firma ? '✍️ Firma eIDAS' : 'ℹ️ Informativo'}
                </span>
                
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Pulsanti Archiviazione & Ripristino */}
                  {m.archiviato ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreDoc(m.id, m.nome)}
                      style={{ background: '#064e3b', border: '1px solid #059669', color: '#34d399', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Ripristina modello tra quelli attivi"
                    >
                      <span>♻️</span>
                      <span>Ripristina</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleArchiveDoc(m.id, m.nome)}
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Archivia modello master"
                    >
                      <span>📦</span>
                      <span>Archivia</span>
                    </button>
                  )}

                  {/* Pulsante Eliminazione Ben Visibile */}
                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(m.id, m.nome)}
                    style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Elimina definitivamente modello master dalla libreria"
                  >
                    <span>🗑️</span>
                    <span>Elimina</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/documents?tmplId=${m.templateId || m.id}`)}
                    style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✏️ Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplatePdf(m)}
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600 }}
                  >
                    📥 PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkingDocModel(m);
                      setClientModalSearch('');
                    }}
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600 }}
                  >
                    🔗 Collega
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sezione 2: Form Master Dinamici */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Form Master Dinamici ({formMasters.length})</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Definisci la struttura dei moduli di raccolta dati da guidare al cliente nel suo portale</div>
          </div>
          <button
            onClick={() => setNewFormOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            + Crea Nuovo Form Master
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {formMasters.map(f => (
            <div key={f.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>📋 {f.nome}</div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Eliminare il Form Master "${f.nome}"?`)) {
                        setFormMasters(formMasters.filter(x => x.id !== f.id));
                      }
                    }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#f87171', padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Elimina Form Master"
                  >
                    <span>🗑️</span>
                    <span>Elimina</span>
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Campi di raccolta dati incorporati ({f.campi.length}):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {f.campi.map((c, i) => (
                    <span key={i} style={{ background: '#200f40', color: '#a78bfa', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
                      {c}
                    </span>
                  ))}
                </div>
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
      {/* Modal Collega Modello Documento a Cliente */}
      {linkingDocModel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <form onSubmit={handleConfirmLinkToClient} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔗 Collega Modello Documento a Cliente</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Associa il modello <strong>"{linkingDocModel.nome}"</strong> all'anagrafica ed al portale cliente
            </div>

            {linkingSuccessMsg ? (
              <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: 14, borderRadius: 10, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                {linkingSuccessMsg}
              </div>
            ) : (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona Cliente ERP Target *</label>
                    <input
                      type="text"
                      placeholder="🔍 Filtra cliente..."
                      value={clientModalSearch}
                      onChange={e => setClientModalSearch(e.target.value)}
                      style={{ fontSize: 10.5, padding: '3px 8px', width: 140, borderRadius: 6 }}
                    />
                  </div>
                  <select
                    value={selectedLinkClientId}
                    onChange={e => setSelectedLinkClientId(e.target.value)}
                    style={{ padding: 10, fontSize: 12, width: '100%' }}
                    required
                  >
                    {clientiList
                      .filter(c => !clientModalSearch || c.nome.toLowerCase().includes(clientModalSearch.toLowerCase()) || (c.partitaIva || c.piva || '').toLowerCase().includes(clientModalSearch.toLowerCase()))
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          🏢 {c.nome} ({c.partitaIva || c.piva || c.codiceFiscale || 'P.IVA N/D'})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Incarico / Progetto Destinazione (Opzionale)</label>
                  <select
                    value={selectedLinkProjId}
                    onChange={e => setSelectedLinkProjId(e.target.value)}
                    style={{ padding: 10, fontSize: 12 }}
                  >
                    <option value="">-- Inserisci nel Vault Anagrafica Generale Cliente --</option>
                    {progettiList.filter(p => String(p.clienteId || p.clId) === String(selectedLinkClientId)).map(p => (
                      <option key={p.id} value={p.id}>
                        📁 Progetto #{p.id} — {p.n || p.nome || 'Incarico'}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
                  ℹ️ Una volta collegato, il cliente visualizzerà il modello nel proprio <strong>Portale Riservato Cliente</strong> e potrà procedere con la compilazione e firma eIDAS o re-upload del PDF.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => setLinkingDocModel(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
                  <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Conferma & Collega Documento</button>
                </div>
              </>
            )}
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

  const fileInputNewArtRef = useRef<HTMLInputElement>(null);
  const [searchNewArtTmpl, setSearchNewArtTmpl] = useState('');
  const [allMasterTemplates, setAllMasterTemplates] = useState<DocumentTemplate[]>(() => getAllTemplates());
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(['tmpl-engagement']);

  const reloadMasterTemplates = () => {
    setAllMasterTemplates(getAllTemplates());
  };

  const handleCreateNewWordForNewArt = async () => {
    const title = prompt('Inserisci il nome del nuovo Modello Word per questo articolo:', `${nome || 'Documento'} - Modello Word`);
    if (!title || !title.trim()) return;

    const newTmpl: DocumentTemplate = {
      id: `tmpl-custom-${Date.now()}`,
      titolo: title.trim(),
      categoria: (cat.toLowerCase() as any) || 'societario',
      descrizione: `Modello Word personalizzato per la nuova prestazione "${nome}".`,
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; font-size: 18px; margin-bottom: 20px;">${title.trim().toUpperCase()}</h1>
<p style="text-align: right; color: #64748b; font-size: 11px;"><strong>Data:</strong> {{data_odierna}} | <strong>Pratica:</strong> {{progetto.titolo}}</p>
<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px; margin: 20px 0; font-size: 11.5px;">
  <strong>Cliente:</strong> {{cliente.ragione_sociale}} (P.IVA {{cliente.partita_iva}})<br/>
  <strong>Studio:</strong> {{studio.ragione_sociale}}
</div>
<p style="font-size: 11.5px; line-height: 1.6;">Testo e condizioni operative per la prestazione ${nome}...</p>
      `,
    };

    saveCustomTemplate(newTmpl);
    // §3.3 — salvataggio locale immediato, esito del sync col server comunicato onestamente.
    try {
      await creaDocumentoTemplateApi(newTmpl);
      reloadMasterTemplates();
      setSelectedDocIds(prev => [...prev, newTmpl.id]);
      alert(`✓ Nuovo Modello Word "${newTmpl.titolo}" creato e collegato all'articolo!`);
    } catch (err: any) {
      alert(`Modello "${newTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
      setSelectedDocIds(prev => [...prev, newTmpl.id]);
    }
  };

  const handleImportDocFileForNewArt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      let htmlBody = '';
      if (file.name.endsWith('.json')) {
        const res = importTemplatesFromJson(content);
        if (res.success) {
          reloadMasterTemplates();
          const first = getAllTemplates()[0];
          if (first) setSelectedDocIds(prev => [...prev, first.id]);
          alert(`✓ Modello importato da file JSON e allacciato all'articolo!`);
          return;
        }
      } else {
        htmlBody = content || `<h1>${file.name}</h1><p>Documento importato da PC per ${nome}...</p>`;
      }

      const docNameClean = file.name.replace(/\.[^/.]+$/, "");
      const newTmpl: DocumentTemplate = {
        id: `tmpl-custom-${Date.now()}`,
        titolo: docNameClean,
        categoria: (cat.toLowerCase() as any) || 'societario',
        descrizione: `Documento caricato da PC (${file.name}) per la prestazione "${nome}".`,
        contenutoHtml: htmlBody,
      };

      saveCustomTemplate(newTmpl);
      // §3.3 — stesso pattern: locale subito, sync col server dichiarato onestamente.
      try {
        await creaDocumentoTemplateApi(newTmpl);
        reloadMasterTemplates();
        setSelectedDocIds(prev => [...prev, newTmpl.id]);
        alert(`✓ File "${file.name}" importato dal PC e allacciato con successo!`);
      } catch (err: any) {
        alert(`File "${file.name}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
        setSelectedDocIds(prev => [...prev, newTmpl.id]);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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
        documentiRichiesti: selectedDocIds,
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
    } catch (err: any) {
      // §3.3 — creazione articolo fallita: va detto, non solo loggato in console.
      alert(`Creazione prestazione non riuscita: ${err?.message || 'errore di rete'}. Riprova.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🧩 Nuovo Articolo Prestazione con Documenti & Procedura</span>
        </div>

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

        {/* Sezione Documenti & Modelli Allacciati (In Memoria, Crea Word, Importa da PC) */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>📄 Documenti & Modelli Allacciati ({selectedDocIds.length})</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Allaccia modelli dalla memoria, creane uno nuovo in Word o importalo dal PC</div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="file"
                ref={fileInputNewArtRef}
                accept=".docx,.doc,.pdf,.html,.htm,.json"
                style={{ display: 'none' }}
                onChange={handleImportDocFileForNewArt}
              />
              <button
                type="button"
                onClick={handleCreateNewWordForNewArt}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                title="Crea un nuovo modello Word dedicato a questa prestazione"
              >
                ➕ Nuovo Word
              </button>
              <button
                type="button"
                onClick={() => fileInputNewArtRef.current?.click()}
                style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                title="Importa file .docx, .pdf, .html o .json dal tuo computer"
              >
                📁 Importa da PC
              </button>
            </div>
          </div>

          {/* Search filter nel modale */}
          <input
            type="text"
            placeholder="🔍 Cerca modello da allacciare..."
            value={searchNewArtTmpl}
            onChange={e => setSearchNewArtTmpl(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', width: '100%' }}
          />

          {/* Lista Modelli in Memoria */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxHeight: 150, overflowY: 'auto', background: 'var(--card)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
            {allMasterTemplates
              .filter(item => !searchNewArtTmpl || item.titolo.toLowerCase().includes(searchNewArtTmpl.toLowerCase()) || item.categoria.toLowerCase().includes(searchNewArtTmpl.toLowerCase()))
              .map(item => {
              const checked = selectedDocIds.includes(item.id);
              const isCustom = item.id.startsWith('tmpl-custom');
              return (
                <label
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: checked ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    color: checked ? '#a5b4fc' : 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedDocIds([...selectedDocIds, item.id]);
                        } else {
                          setSelectedDocIds(selectedDocIds.filter(x => x !== item.id));
                        }
                      }}
                    />
                    <span style={{ fontWeight: checked ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.titolo}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {isCustom && (
                      <span style={{ fontSize: 8.5, background: '#064e3b', color: '#34d399', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                        Custom
                      </span>
                    )}
                    <span style={{ fontSize: 8.5, background: 'var(--card2)', color: 'var(--muted)', padding: '1px 4px', borderRadius: 4, textTransform: 'uppercase' }}>
                      {item.categoria}
                    </span>
                  </div>
                </label>
              );
            })}
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
          <button type="submit" disabled={loading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{loading ? 'Salvataggio...' : '✓ Salva Articolo & Procedura'}</button>
        </div>
      </form>
    </div>
  );
}

// ─── Componente Costruttore Modulo Template ───────────────────────
function CreaModuloForm({ articoliList, giurList, moduloInModifica, onCreated, onAnnullaModifica }: { articoliList: Articolo[]; giurList: Giurisdizione[]; moduloInModifica?: ModuloTemplate | null; onCreated: () => void; onAnnullaModifica?: () => void }) {
  // §36 — modalità modifica: se arriva un modulo esistente, il costruttore si apre
  // pre-popolato (nome, categoria, giurisdizione, forfait e distinta base) e il
  // salvataggio passa per la PUT invece della POST di creazione.
  const [nome, setNome] = useState(moduloInModifica?.n ?? '');
  const [cat, setCat] = useState<CategoriaModulo>(moduloInModifica?.cat ?? 'Societario');
  const [giurisdizioneId, setGiurisdizioneId] = useState<string>(moduloInModifica?.giurisdizioneId ?? '');
  const [prezzoPkg, setPrezzoPkg] = useState<number | ''>(moduloInModifica?.pkg ?? '');
  const [selectedArts, setSelectedArts] = useState<Array<{ artId: string; qty: number; customPrice?: number }>>(() =>
    (moduloInModifica?.righe ?? []).map(r => ({
      artId: r.art,
      qty: r.qty ?? 1,
      customPrice: r.oP !== undefined ? r.oP : articoliList.find(a => a.id === r.art)?.p,
    }))
  );
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
      const payload = {
        nome,
        categoria: cat,
        giurisdizioneId: giurisdizioneId || null,
        prezzoPacchetto: prezzoPkg !== '' ? Number(prezzoPkg) * 100 : null,
        righe: selectedArts.map(x => ({ articoloId: x.artId, quantita: x.qty })),
      };
      if (moduloInModifica) {
        // §36 — le dipendenze non sono gestite da questo costruttore: non inviandole
        // nella PUT, il backend conserva quelle esistenti.
        await aggiornaModuloTemplateApi(moduloInModifica.id, payload);
      } else {
        await creaModuloTemplateApi(payload);
      }
      onCreated();
    } catch (err: any) {
      // §3.3 — salvataggio modulo template fallito: messaggio esplicito all'utente.
      alert(`Salvataggio modulo non riuscito: ${err?.message || 'errore di rete'}. Riprova.`);
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
            <div style={{ fontSize: 16, fontWeight: 700 }}>{moduloInModifica ? `✏️ Modifica Modulo Template — ${moduloInModifica.n}` : 'Costruttore Modulo Template'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {moduloInModifica
                ? 'Aggiorna nome, giurisdizione, listino pacchetto e distinta base; le dipendenze esistenti vengono conservate'
                : 'Componi la distinta base ed imposta la giurisdizione target ed il listino pacchetto'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {moduloInModifica && onAnnullaModifica && (
              <button
                onClick={onAnnullaModifica}
                style={{ background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                ✕ Annulla modifica
              </button>
            )}
            <CatBadge cat={cat} />
          </div>
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
              {loading ? 'Salvataggio...' : moduloInModifica ? '✓ Salva Modifiche al Modulo Template' : '✓ Salva Modulo Template con Distinta Base'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
