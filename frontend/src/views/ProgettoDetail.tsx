import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Lock, Paperclip, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ProceduraModal } from '@/components/progetti/ProceduraModal';
import { FatturaModal } from '@/components/progetti/FatturaModal';
import { UploadDocumento } from '@/components/shared/UploadDocumento';
import api from '@/lib/api';

export const ProgettoDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [progetto, setProgetto] = useState<any>(null);
  const [moduli, setModuli] = useState<any[]>([]);
  const [fatture, setFatture] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'moduli' | 'team' | 'documenti' | 'fatturazione'>('moduli');
  const [expandedModuli, setExpandedModuli] = useState<Record<string, boolean>>({});
  const [selectedMicrovoce, setSelectedMicrovoce] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFatturaModalOpen, setIsFatturaModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchDati = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [progRes, moduliRes, fattRes] = await Promise.all([
        api.get(`/api/progetti/${id}`),
        api.get(`/api/moduli/progetto/${id}`),
        api.get(`/api/fatture?progetto_id=${id}`).catch(() => ({ data: [] }))
      ]);
      setProgetto(progRes.data);
      const mods = moduliRes.data || [];
      setModuli(mods);
      setFatture(fattRes.data || []);
      
      // Espandi il primo modulo per default se presente
      if (mods.length > 0) {
        setExpandedModuli(prev => ({ ...prev, [mods[0].id]: true }));
      }
    } catch (err) {
      console.error('Errore nel caricamento del dettaglio progetto', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDati();
  }, [id]);

  const toggleModulo = (modId: string) => {
    setExpandedModuli(prev => ({ ...prev, [modId]: !prev[modId] }));
  };

  if (loading) return <div className="text-muted text-sm py-4">Caricamento progetto...</div>;
  if (!progetto) return <div className="text-error text-sm py-4">Progetto non trovato.</div>;

  const oreConsuntivateTotali = moduli.reduce((acc, m) => acc + (m.ore_consuntivate || 0), 0);
  const orePreventivateTotali = moduli.reduce((acc, m) => acc + (m.ore_preventivate || 0), 0);
  const valoreTotale = progetto.valore_totale || moduli.reduce((acc, m) => acc + (m.prezzo || 0), 0);
  
  const fatturatoTotale = fatture.reduce((acc, f) => acc + (f.totale || 0), 0);
  const daFatturare = valoreTotale - fatturatoTotale;

  return (
    <div className="flex flex-col gap-5">
      {/* Header Back & Info */}
      <div>
        <Link to="/app/progetti" className="inline-flex items-center text-xs text-muted hover:text-text-main mb-2 transition-colors">
          <ChevronLeft size={14} className="mr-1" /> Dashboard / Progetti
        </Link>
        
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant={progetto.stato === 'in_progress' ? 'info' : progetto.stato === 'completed' ? 'success' : 'warning'}>
                {progetto.stato}
              </Badge>
              {(progetto.stato === 'delayed' || progetto.stato === 'blocked') && (
                <span className="text-xs text-warning font-semibold flex items-center gap-1">
                  <AlertTriangle size={12} /> Ritardi in corso
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold">{progetto.nome}</h1>
            <div className="flex items-center gap-4 text-xs text-muted mt-1.5">
              <span>👤 Cliente ID: {progetto.cliente_id}</span>
              <span>💶 € {valoreTotale.toLocaleString('it-IT')}</span>
              <span>🕐 {oreConsuntivateTotali}h / {orePreventivateTotali}h</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-3xl font-black text-primary">{progetto.avanzamento_pct || 0}%</span>
            <div className="text-xs text-muted">completato</div>
            <div className="w-28 mt-1">
              <ProgressBar progress={progetto.avanzamento_pct || 0} />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-color gap-6 mt-6">
          {(['moduli', 'team', 'documenti', 'fatturazione'] as const).map(tab => (
            <button
              key={tab}
              className={`pb-2.5 text-xs font-semibold capitalize border-b-2 transition-colors ${
                activeTab === tab 
                  ? 'border-primary text-primary font-bold' 
                  : 'border-transparent text-muted hover:text-text-main'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {{
                moduli: 'Moduli & Attività',
                team: 'Team',
                documenti: 'Documenti',
                fatturazione: 'Fatturazione'
              }[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="mt-2">
        {/* TAB 1: MODULI & ATTIVITÀ (FEDELE AL PROTOTIPO HTML) */}
        {activeTab === 'moduli' && (
          <div className="flex flex-col gap-3">
            {moduli.map(m => {
              const isExpanded = !!expandedModuli[m.id];
              const microvoci = m.microvoce_progetto || [];
              
              return (
                <div key={m.id} className={`bg-bg-card rounded-xl border border-color overflow-hidden ${m.stato === 'delayed' || m.stato === 'blocked' ? 'border-l-4 border-l-warning' : ''}`}>
                  {/* Header Modulo */}
                  <div 
                    className="p-3.5 flex items-center gap-3 cursor-pointer hover:bg-bg-card-hover transition-colors"
                    onClick={() => toggleModulo(m.id)}
                  >
                    <ChevronRight size={16} className={`text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary-light text-primary">{m.categoria || 'Modulo'}</span>
                        <Badge variant={m.stato === 'completed' ? 'success' : m.stato === 'delayed' || m.stato === 'blocked' ? 'warning' : 'info'}>{m.stato}</Badge>
                      </div>
                      <h4 className="text-sm font-semibold">{m.nome}</h4>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <span className="text-xs font-semibold text-primary">{m.avanzamento_pct || 0}%</span>
                        <div className="w-16">
                          <ProgressBar progress={m.avanzamento_pct || 0} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">€ {m.prezzo?.toLocaleString('it-IT')}</div>
                        <div className="text-xs text-muted">{m.ore_consuntivate || 0}h / {m.ore_preventivate || 0}h</div>
                      </div>
                    </div>
                  </div>

                  {/* Tabella Micro-voci espansa */}
                  {isExpanded && (
                    <div className="border-t border-color bg-bg-sidebar">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-bg-card text-muted border-b border-color">
                            <th className="p-2.5 pl-4 font-semibold">Attività</th>
                            <th className="p-2.5 font-semibold text-center">Stato</th>
                            <th className="p-2.5 font-semibold text-center">H Prev.</th>
                            <th className="p-2.5 font-semibold text-center">H Cons.</th>
                            <th className="p-2.5 font-semibold text-center">Docs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {microvoci.map((mv: any) => {
                            const isDone = mv.stato === 'done';
                            const isProblem = mv.stato === 'delayed' || mv.stato === 'blocked' || mv.stato === 'at_risk';
                            const isWaitDep = mv.stato === 'attesa_dipendenza';

                            return (
                              <tr 
                                key={mv.id} 
                                className="border-b border-color/50 hover:bg-bg-card-hover cursor-pointer transition-colors group"
                                onClick={() => {
                                  setSelectedMicrovoce(mv);
                                  setIsModalOpen(true);
                                }}
                              >
                                <td className="p-2.5 pl-4">
                                  <div className="flex items-center gap-2">
                                    {isDone && <CheckCircle2 size={14} className="text-success" />}
                                    {isProblem && <AlertTriangle size={14} className="text-error" />}
                                    {isWaitDep && <Lock size={14} className="text-purple-400" />}
                                    {!isDone && !isProblem && !isWaitDep && <div className="w-2 h-2 rounded-full bg-primary" />}
                                    <div>
                                      <span className={`font-medium ${isDone ? 'line-through text-muted' : ''}`}>{mv.nome}</span>
                                      {mv.causa_nota && <div className="text-[10px] text-warning mt-0.5">⚠ {mv.causa_nota}</div>}
                                    </div>
                                    <span className="ml-auto text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">Apri procedura →</span>
                                  </div>
                                </td>
                                <td className="p-2.5 text-center">
                                  <Badge variant={isDone ? 'success' : isProblem ? 'error' : 'info'}>{mv.stato}</Badge>
                                </td>
                                <td className="p-2.5 text-center text-muted">{mv.ore_preventivate}h</td>
                                <td className="p-2.5 text-center font-semibold">{mv.ore_consuntivate > 0 ? `${mv.ore_consuntivate}h` : '—'}</td>
                                <td className="p-2.5 text-center text-muted">
                                  {mv.docs_count ? <span className="text-primary font-semibold flex items-center justify-center gap-1"><Paperclip size={12} /> {mv.docs_count}</span> : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="p-2.5 px-4 text-xs text-muted flex justify-between items-center bg-bg-card/50">
                        <span>{m.ore_consuntivate || 0}h consuntivate su {m.ore_preventivate || 0}h preventivate</span>
                        <strong className="text-text-main font-bold">€ {m.prezzo?.toLocaleString('it-IT')}</strong>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Sommatore Totale */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-bg-card to-primary-light/20 border border-primary/30 flex justify-between items-center mt-2">
              <div>
                <div className="text-xs text-primary font-medium">Valore Totale Progetto</div>
                <div className="text-xs text-muted mt-0.5">{oreConsuntivateTotali}h consuntivate / {orePreventivateTotali}h preventivate</div>
              </div>
              <div className="text-2xl font-black text-white">€ {valoreTotale.toLocaleString('it-IT')}</div>
            </div>
          </div>
        )}

        {/* TAB 2: TEAM */}
        {activeTab === 'team' && (
          <div className="flex flex-col gap-3">
            <Card>
              <h3 className="text-sm font-semibold mb-3">Membri Assegnati al Progetto</h3>
              <p className="text-xs text-muted">La panoramica dell'allocazione ore e delle attività completate per risorsa verrà popolata dalle assegnazioni.</p>
            </Card>
          </div>
        )}

        {/* TAB 3: DOCUMENTI */}
        {activeTab === 'documenti' && (
          <div className="flex flex-col gap-3">
            <Card>
              <h3 className="text-sm font-semibold mb-3">📁 Documenti di Progetto</h3>
              <p className="text-xs text-muted mb-4">Carica un documento generico per questo progetto.</p>
              <div className="max-w-md">
                <UploadDocumento 
                  progettoId={id!} 
                  onUploadSuccess={fetchDati}
                />
              </div>
            </Card>
          </div>
        )}

        {/* TAB 4: FATTURAZIONE (FEDELE AL PROTOTIPO HTML) */}
        {activeTab === 'fatturazione' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <div className="text-xs text-muted mb-1">Valore Totale</div>
                <div className="text-xl font-bold">€ {valoreTotale.toLocaleString('it-IT')}</div>
              </Card>
              <Card>
                <div className="text-xs text-muted mb-1">Fatturato</div>
                <div className="text-xl font-bold text-success">€ {fatturatoTotale.toLocaleString('it-IT')}</div>
              </Card>
              <Card>
                <div className="text-xs text-muted mb-1">Da Fatturare</div>
                <div className="text-xl font-bold text-primary">€ {daFatturare.toLocaleString('it-IT')}</div>
              </Card>
            </div>

            <Card title="Fatture Emesse">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold">Storico Fatture</h3>
                <button 
                  className="btn-primary flex items-center gap-2 text-xs py-1.5 px-3"
                  onClick={() => setIsFatturaModalOpen(true)}
                >
                  <Plus size={14} /> Emetti Fattura
                </button>
              </div>

              {fatture.length > 0 ? (
                <table className="w-full text-left text-xs border-collapse mt-2">
                  <thead>
                    <tr className="bg-bg-sidebar text-muted border-b border-color">
                      <th className="p-2 font-semibold">Tipo / Descrizione</th>
                      <th className="p-2 font-semibold text-center">Stato</th>
                      <th className="p-2 font-semibold text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fatture.map(f => (
                      <tr key={f.id} className="border-b border-color/50">
                        <td className="p-2">{f.descrizione || f.numero}</td>
                        <td className="p-2 text-center"><Badge variant="success">{f.stato}</Badge></td>
                        <td className="p-2 text-right font-bold">€ {f.totale?.toLocaleString('it-IT')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-muted italic py-2">Nessuna fattura emessa al momento.</p>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Modal Procedura */}
      <ProceduraModal 
        isOpen={isModalOpen} 
        onClose={() => {
          setIsModalOpen(false);
          setSelectedMicrovoce(null);
        }} 
        microvoce={selectedMicrovoce}
        onUpdate={fetchDati}
      />

      <FatturaModal
        isOpen={isFatturaModalOpen}
        onClose={() => setIsFatturaModalOpen(false)}
        progettoId={id!}
        moduli={moduli}
        onSuccess={fetchDati}
      />
    </div>
  );
};
