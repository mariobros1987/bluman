import React, { useState, useEffect, useRef } from 'react';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, moduloH, moduloP, resolveRighe, levelOf } from '../utils';
import { MLIB, ARTICOLI } from '../store/mockData';
import { fetchArticoli, creaArticoloApi, creaModuloTemplateApi } from '../api/client';
import type { CategoriaModulo, Articolo } from '../types';
import styles from './Library.module.css';

type SubTab = 'grafo' | 'articoli' | 'crea_modulo' | 'doc_form';

export function Library() {
  const [subTab, setSubTab] = useState<SubTab>('grafo');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [articoliList, setArticoliList] = useState<Articolo[]>(ARTICOLI);
  const [modalArticoloOpen, setModalArticoloOpen] = useState(false);

  const graphRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Carica articoli da Supabase DB
  const loadArticoli = async () => {
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
  };

  useEffect(() => {
    loadArticoli();
  }, []);

  const toggle = (id: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // Topological levels
  const maxLvl = Math.max(...MLIB.map(m => levelOf(m.id)));
  const cols: typeof MLIB[] = [];
  for (let i = 0; i <= maxLvl; i++) cols.push(MLIB.filter(m => levelOf(m.id) === i));
  const colLabels = ['Punto di partenza', 'Sbloccati a cascata', 'Dipendenti'];

  useEffect(() => {
    if (subTab === 'grafo') drawEdges();
  }, [open, subTab]);

  function drawEdges() {
    const svg = svgRef.current;
    const wrap = graphRef.current;
    if (!svg || !wrap) return;
    const wr = wrap.getBoundingClientRect();
    svg.setAttribute('width', String(wrap.scrollWidth));
    svg.setAttribute('height', String(wrap.scrollHeight));
    svg.innerHTML = '';
    MLIB.forEach(m => {
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
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', open.has(m.id) || open.has(depId) ? '#6366f1' : '#3a3d56');
        path.setAttribute('stroke-width', open.has(m.id) || open.has(depId) ? '2' : '1.5');
        svg.appendChild(path);
      });
    });
  }

  const cats = [...new Set(articoliList.map(a => a.cat))] as CategoriaModulo[];

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

      {/* TAB 1: Grafo */}
      {subTab === 'grafo' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 11, color: 'var(--muted)', marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: '#1a1f3d', border: '1px solid #2d3260' }} />
              Versione template congelata nei progetti
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 2, background: '#3a3d56', borderRadius: 0 }} />
              Dipendenza tra moduli
            </div>
            <div>Clic su un modulo per espandere la distinta base</div>
          </div>

          <div ref={graphRef} style={{ position: 'relative', overflowX: 'auto', paddingBottom: 12 }}>
            <svg ref={svgRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'visible' }} />
            <div style={{ display: 'flex', gap: 56, alignItems: 'flex-start', position: 'relative', zIndex: 1, minWidth: 'max-content', padding: 4 }}>
              {cols.map((items, ci) => (
                <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 230, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--hint)', textTransform: 'uppercase', letterSpacing: '.6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {colLabels[ci] || `Livello ${ci}`}
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  {items.map(m => {
                    const isOpen = open.has(m.id);
                    const dn = m.deps.map(d => MLIB.find(x => x.id === d)?.n).filter(Boolean);
                    const righe = resolveRighe(m);
                    return (
                      <div
                        key={m.id}
                        id={`lib-${m.id}`}
                        onClick={() => toggle(m.id)}
                        style={{
                          background: isOpen ? 'var(--card2)' : 'var(--card)',
                          border: `1px solid ${isOpen ? 'var(--indigo-l)' : 'var(--border)'}`,
                          borderRadius: 12, padding: 14, cursor: 'pointer',
                          transition: 'all .15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                          <CatBadge cat={m.cat} />
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--indigo-l)', background: '#1a1f3d', border: '1px solid #2d3260', padding: '1px 6px', borderRadius: 20 }}>v{m.ver}</span>
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, margin: '6px 0 8px' }}>{m.n}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
                          <span>{moduloH(m)}h · {righe.length} articoli{dn.length ? ` · da: ${dn.join(', ')}` : ''}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{fmt(moduloP(m))}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{isOpen ? '▲' : '▼'}</span>
                        </div>

                        {isOpen && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {righe.map((r, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--hint)', flexShrink: 0 }} />
                                {r.art.n}
                                {r.qty > 1 && <span style={{ color: '#818cf8' }}>×{r.qty}</span>}
                              </div>
                            ))}
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

      {/* TAB 3: Costruttore Modulo Template */}
      {subTab === 'crea_modulo' && (
        <CreaModuloForm articoliList={articoliList} onCreated={() => setSubTab('grafo')} />
      )}

      {/* TAB 4: Modelli Documenti in Bianco & Form Master */}
      {subTab === 'doc_form' && (
        <LibreriaDocumentiEForm />
      )}

      {/* Modal Nuovo Articolo */}
      {modalArticoloOpen && (
        <NuovoArticoloModal
          onClose={() => setModalArticoloOpen(false)}
          onCreated={() => loadArticoli()}
        />
      )}
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
              justify: 'space-between',
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

// ─── Componente Libreria Documenti in Bianco & Form Master ────────
function LibreriaDocumentiEForm() {
  const [docModels, setDocModels] = useState([
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
function NuovoArticoloModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nome, setNome] = useState('');
  const [cat, setCat] = useState<CategoriaModulo>('Analisi');
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
function CreaModuloForm({ articoliList, onCreated }: { articoliList: Articolo[]; onCreated: () => void }) {
  const [nome, setNome] = useState('');
  const [cat, setCat] = useState<CategoriaModulo>('Societario');
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
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Componi la distinta base ed imposta il listino pacchetto</div>
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

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
            <select value={cat} onChange={e => setCat(e.target.value as CategoriaModulo)}>
              {['Analisi', 'Societario', 'Trust', 'Banking', 'Fiscale', 'Legale', 'IP', 'Compliance'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
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
