import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import api from '@/lib/api';

export const Libreria: React.FC = () => {
  const [moduli, setModuli] = useState<any[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const fetchModuli = async () => {
      try {
        const resp = await api.get('/api/libreria');
        setModuli(resp.data || []);
      } catch (err) {
        console.error('Errore nel caricamento della libreria', err);
      } finally {
        setLoading(false);
      }
    };
    fetchModuli();
  }, []);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const drawEdges = () => {
    if (!svgRef.current || !wrapRef.current || moduli.length === 0) return;
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    const wr = wrap.getBoundingClientRect();
    
    svg.setAttribute('width', String(wrap.scrollWidth));
    svg.setAttribute('height', String(wrap.scrollHeight));
    
    let html = '';
    moduli.forEach(m => {
      const deps = m.dipendenze || [];
      deps.forEach((d: any) => {
        const from = document.getElementById('lib-' + d.dipende_da_modulo_template_id);
        const to = document.getElementById('lib-' + m.id);
        if (!from || !to) return;
        
        const fr = from.getBoundingClientRect();
        const tr = to.getBoundingClientRect();
        
        const x1 = fr.right - wr.left + wrap.scrollLeft;
        const y1 = fr.top - wr.top + fr.height / 2 + wrap.scrollTop;
        const x2 = tr.left - wr.left + wrap.scrollLeft;
        const y2 = tr.top - wr.top + tr.height / 2 + wrap.scrollTop;
        const mx = (x1 + x2) / 2;
        
        html += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/><circle cx="${x1}" cy="${y1}" r="2.5"/><circle cx="${x2}" cy="${y2}" r="2.5"/>`;
      });
    });
    svg.innerHTML = html;
  };

  useLayoutEffect(() => {
    drawEdges();
    window.addEventListener('resize', drawEdges);
    return () => window.removeEventListener('resize', drawEdges);
  }, [moduli, expandedIds]);

  // Topological sort per le colonne
  const levels: Record<string, number> = {};
  const getLevel = (id: string): number => {
    if (levels[id] !== undefined) return levels[id];
    const m = moduli.find(x => x.id === id);
    const deps = m?.dipendenze || [];
    if (!m || !deps.length) {
      levels[id] = 0;
      return 0;
    }
    levels[id] = 1 + Math.max(...deps.map((d: any) => getLevel(d.dipende_da_modulo_template_id)));
    return levels[id];
  };

  moduli.forEach(m => getLevel(m.id));
  const maxLvl = moduli.length ? Math.max(0, ...Object.values(levels)) : -1;
  
  const cols = [];
  for (let i = 0; i <= maxLvl; i++) {
    cols.push(moduli.filter(m => levels[m.id] === i));
  }
  const colLabels = ['Punto di partenza', 'Sbloccati a cascata', 'Dipendenti'];

  const catCls = (c: string) => {
    const map: Record<string, string> = {
      Analisi: 'cA', Societario: 'cS', Trust: 'cT', Banking: 'cB', Fiscale: 'cF', Legale: 'cL', IP: 'cI', Compliance: 'cC'
    };
    return map[c] || 'cL';
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Libreria Moduli Template</h1>
          <p className="text-xs text-muted mt-1">Moduli e micro-processi riutilizzabili con congelamento versioni.</p>
        </div>
      </div>

      <div className="lib-legend">
        <div className="lib-legend-item"><div className="lib-legend-swatch" style={{background: '#1a1f3d', border: '1px solid #2d3260'}} />Versione del template — congelata nei progetti già avviati</div>
        <div className="lib-legend-item"><div className="lib-legend-swatch" style={{background: '#3a3d56', height: '2px', width: '16px', borderRadius: 0}} />Dipendenza: il modulo si sblocca solo a monte completato</div>
        <div className="lib-legend-item">Clic su un modulo per vedere gli articoli della distinta — riutilizzabili tra moduli diversi</div>
      </div>

      {loading ? (
        <div className="text-muted text-sm">Caricamento libreria...</div>
      ) : (
        <div className="lib-wrap flex-1" id="lib-wrap" ref={wrapRef} onScroll={drawEdges}>
          <svg className="lib-svg" id="lib-svg" ref={svgRef}></svg>
          
          <div className="lib-graph" id="lib-graph">
            {cols.map((items, ci) => (
              <div key={ci} className="lib-col">
                <div className="lib-col-label">{colLabels[ci] || 'Livello ' + ci}</div>
                {items.map(m => {
                  const open = expandedIds.has(m.id);
                  const microvoci = m.micro_voci || [];
                  const dipNomi = (m.dipendenze || []).map((d: any) => moduli.find(x => x.id === d.dipende_da_modulo_template_id)?.nome).filter(Boolean);
                  
                  return (
                    <div key={m.id} id={`lib-${m.id}`} className={`lib-node ${open ? 'lib-open' : ''}`} onClick={(e) => toggleExpand(m.id, e)}>
                      <div className="lib-node-top">
                        <span className={`cat ${catCls(m.categoria)}`}>{m.categoria || 'Generale'}</span>
                        <span className="lib-ver">v{m.versione || 1}</span>
                      </div>
                      <div className="lib-node-name">{m.nome}</div>
                      <div className="lib-node-meta">
                        <span>{m.ore_default || 0}h · {microvoci.length} articoli{dipNomi.length > 0 ? ` · da: ${dipNomi.join(', ')}` : ''}</span>
                      </div>
                      <div className="lib-node-meta" style={{ marginTop: '4px' }}>
                        <span className="lib-node-price">€ {(m.prezzo_default || 0).toLocaleString('it-IT')}</span>
                        <span>{open ? '▲' : '▼'}</span>
                      </div>
                      
                      {open && (
                        <div className="lib-node-detail">
                          {microvoci.map((mv: any) => (
                            <div key={mv.id} className="lib-node-mv">
                              <span className="lib-node-mv-dot"></span>
                              {mv.nome} <span style={{ color: '#818cf8', marginLeft: 'auto' }}>{mv.ore_default}h</span>
                            </div>
                          ))}
                          {microvoci.length === 0 && <span className="text-xs text-muted italic">Nessuna micro-voce definita.</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ci === 0 && <button className="lib-addbtn" onClick={e => e.stopPropagation()}>+ Nuovo modulo</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
