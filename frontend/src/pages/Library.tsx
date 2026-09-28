import { useState, useEffect, useRef } from 'react';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, moduloH, moduloP, resolveRighe, levelOf } from '../utils';
import { fetchModuliLibreria, fetchArticoli, fetchGiurisdizioniApi, disattivaModuloTemplateApi, disattivaArticoloApi } from '../api/client';
import type { CategoriaModulo, Articolo, Giurisdizione, ModuloTemplate } from '../types';
import { ArticoliCatalogView } from '../components/library/ArticoliCatalogView';
import { GiurisdizioniView } from '../components/library/GiurisdizioniView';
import { LibreriaDocumentiEForm } from '../components/library/LibreriaDocumentiEForm';
import { NuovoArticoloModal } from '../components/library/NuovoArticoloModal';
import { CreaModuloForm } from '../components/library/CreaModuloForm';
import { AssegnaModuloClienteModal } from '../components/library/AssegnaModuloClienteModal';
import { useToast } from '../components/ui/ToastProvider';
import { confirm } from '../components/ui/ConfirmProvider';

type SubTab = 'grafo' | 'articoli' | 'giurisdizioni' | 'crea_modulo' | 'doc_form';

export function Library() {
  const toast = useToast();
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
    const conferma = await confirm({
      titolo: `Disattivare il modulo template «${m.n}»?`,
      messaggio: 'Il modulo sparirà dalla libreria, ma i progetti e i preventivi già creati continueranno a funzionare.',
      confermaLabel: 'Disattiva',
      pericolo: true,
    });
    if (!conferma) return;
    try {
      await disattivaModuloTemplateApi(m.id);
      setModuliList(prev => prev.filter(x => x.id !== m.id));
    } catch (err: any) {
      toast.errore(`Disattivazione non riuscita: ${err?.message || 'errore di rete'}. Il modulo NON è stato disattivato.`);
    }
  };

  const handleDisattivaArticolo = async (id: string, nome: string) => {
    const conferma = await confirm({
      titolo: `Disattivare l'articolo «${nome}»?`,
      messaggio: 'Sparirà dal catalogo, ma le distinte base e i progetti che già lo usano restano validi.',
      confermaLabel: 'Disattiva',
      pericolo: true,
    });
    if (!conferma) return;
    try {
      await disattivaArticoloApi(id);
      setArticoliList(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      toast.errore(`Disattivazione non riuscita: ${err?.message || 'errore di rete'}. L'articolo NON è stato disattivato.`);
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
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--card2)" />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--indigo-l)" />
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
        path.setAttribute('stroke', isActive ? 'var(--indigo-l)' : 'var(--card2)');
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
                <div style={{ width: 14, height: 2, background: 'var(--indigo-l)' }} />
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
                                background: m.giurisdizioneId ? 'var(--surface-1)' : 'var(--card2)',
                                border: `1px solid ${m.giurisdizioneId ? 'var(--card2)' : 'var(--border)'}`,
                                color: m.giurisdizioneId ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                              }}
                            >
                              {gFlag} {gLabel}
                            </span>
                          </div>
                          <span style={{ fontSize: 9, fontWeight: 700, color: dn.length ? 'var(--amber)' : 'var(--green)', background: dn.length ? 'var(--pill-amber-bg)' : 'var(--pill-green-bg)', border: `1px solid ${dn.length ? 'var(--amber)' : 'var(--green)'}`, padding: '1px 8px', borderRadius: 20 }}>
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
                                {r.qty > 1 && <span style={{ color: 'var(--indigo-l)' }}>×{r.qty}</span>}
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
                                style={{ flex: 1, background: 'var(--surface-1)', border: '1px solid var(--card2)', color: 'var(--indigo-l)', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                              >
                                ✏️ Modifica
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDisattivaModulo(m);
                                }}
                                title="§30 — Disattivazione: il modulo sparisce dalla libreria, i progetti esistenti restano validi"
                                style={{ flex: 1, background: 'var(--card2)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
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
          onUpdateGiur={(g) => setGiurList(prev => prev.map(x => x.id === g.id ? g : x))}
          onDeleteGiur={(id) => setGiurList(prev => prev.filter(x => x.id !== id))}
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
          moduliList={moduliList}
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
