import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Check, Plus, Trash2 } from 'lucide-react';
import { UploadDocumento } from '@/components/shared/UploadDocumento';
import api from '@/lib/api';

interface ProceduraModalProps {
  isOpen: boolean;
  onClose: () => void;
  microvoce: any;
  onUpdate: () => void;
}

export const ProceduraModal: React.FC<ProceduraModalProps> = ({ isOpen, onClose, microvoce, onUpdate }) => {
  const [view, setView] = useState<'operatore' | 'cliente'>('operatore');
  const [passaggi, setPassaggi] = useState<any[]>([]);
  const [ore, setOre] = useState(microvoce?.ore_consuntivate || 0);
  const [nota, setNota] = useState(microvoce?.causa_nota || '');
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // State per nuovo passaggio
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'doc' | 'form' | 'check' | 'info'>('doc');

  const fetchPassaggi = async () => {
    if (!microvoce?.id) return;
    try {
      const res = await api.get(`/api/passaggi/microvoce/${microvoce.id}`);
      setPassaggi(res.data || []);
    } catch (e) {
      console.error('Errore nel caricamento dei passaggi:', e);
    }
  };

  useEffect(() => {
    if (microvoce) {
      setOre(microvoce.ore_consuntivate || 0);
      setNota(microvoce.causa_nota || '');
      fetchPassaggi();
    }
  }, [microvoce]);

  if (!microvoce) return null;

  const handleUpdateMicrovoce = async (nuovoStato?: string) => {
    setLoading(true);
    try {
      const payload: any = { ore_consuntivate: ore };
      if (nuovoStato) payload.stato = nuovoStato;
      if (nota) payload.causa_nota = nota;
      
      await api.patch(`/api/micro-voci/${microvoce.id}`, payload);
      onUpdate();
      onClose();
    } catch (e) {
      console.error(e);
      alert('Errore durante il salvataggio');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePassaggio = async (pId: string, attStato: string) => {
    const nStato = attStato === 'done' ? 'pending' : 'done';
    try {
      await api.patch(`/api/passaggi/${pId}`, { stato: nStato });
      fetchPassaggi();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddPassaggio = async () => {
    if (!newTitle.trim()) return;
    try {
      const typeMap: Record<string, string> = {
        doc: 'documento',
        form: 'form',
        check: 'verifica',
        info: 'info'
      };
      const chi = (newType === 'doc' || newType === 'form') ? 'cliente' : 'operatore';
      await api.post(`/api/passaggi/microvoce/${microvoce.id}`, {
        titolo: newTitle,
        tipo: typeMap[newType],
        chi,
        descrizione: newType === 'doc' ? 'Documento richiesto al cliente.' : newType === 'form' ? 'Form da compilare a cura del cliente.' : 'Passaggio del team.'
      });
      setNewTitle('');
      setShowAddForm(false);
      fetchPassaggi();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeletePassaggio = async (pId: string) => {
    try {
      await api.delete(`/api/passaggi/${pId}`);
      fetchPassaggi();
    } catch (e) {
      console.error(e);
    }
  };

  const passaggiVisibili = passaggi.filter(p => view === 'operatore' || p.chi === 'cliente');
  const passaggiCompletati = passaggi.filter(p => p.stato === 'done').length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Procedura: ${microvoce.nome}`}>
      <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pr-1">
        {/* Subheader */}
        <div className="flex justify-between items-center bg-bg-sidebar p-3 rounded-lg border border-color">
          <div>
            <span className="text-xs text-muted">Completamento Passaggi</span>
            <div className="font-semibold text-sm mt-0.5">{passaggiCompletati} / {passaggi.length} Completati</div>
          </div>
          <div className="flex gap-2 bg-bg-card p-1 rounded-md border border-color">
            <button 
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${view === 'operatore' ? 'bg-primary text-white' : 'text-muted hover:text-text-main'}`}
              onClick={() => setView('operatore')}
            >
              👤 Vista Operatore
            </button>
            <button 
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${view === 'cliente' ? 'bg-primary text-white' : 'text-muted hover:text-text-main'}`}
              onClick={() => setView('cliente')}
            >
              🧑‍💼 Vista Cliente
            </button>
          </div>
        </div>

        {/* Lista Passaggi */}
        <div className="flex flex-col gap-3 my-2">
          {passaggiVisibili.map((p, idx) => (
            <div key={p.id} className="flex gap-3 items-start bg-bg-card p-3 rounded-lg border border-color hover:border-border-hover transition-colors">
              <button 
                onClick={() => handleTogglePassaggio(p.id, p.stato)}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 transition-colors ${p.stato === 'done' ? 'bg-success text-white' : 'bg-bg-sidebar border border-color text-muted hover:border-primary'}`}
              >
                {p.stato === 'done' ? <Check size={14} /> : idx + 1}
              </button>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className={`text-sm font-medium ${p.stato === 'done' ? 'line-through text-muted' : ''}`}>{p.titolo}</h5>
                    {p.descrizione && <p className="text-xs text-muted mt-0.5">{p.descrizione}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.tipo === 'documento' ? 'info' : p.tipo === 'form' ? 'warning' : 'default'}>
                      {p.tipo}
                    </Badge>
                    {view === 'operatore' && (
                      <button onClick={() => handleDeletePassaggio(p.id)} className="text-muted hover:text-error p-1">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Azione Cliente */}
                {view === 'cliente' && p.chi === 'cliente' && (
                  <div className="mt-3">
                    {p.tipo === 'documento' && (
                      <UploadDocumento 
                        progettoId={microvoce.progetto_id} 
                        microvoceProgettoId={microvoce.id} 
                        tipoDocumento="compilato"
                        onUploadSuccess={onUpdate}
                      />
                    )}
                    {p.tipo === 'form' && (
                      <div className="bg-bg-sidebar p-2.5 rounded-md border border-color flex flex-col gap-2">
                        <span className="text-xs font-medium text-muted">Compilazione Form</span>
                        <input className="form-input text-xs" placeholder="Inserisci valore richiesto..." />
                        <Button variant="primary" className="text-xs py-1 mt-1">Invia Dati</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {passaggiVisibili.length === 0 && (
            <div className="text-center py-6 text-xs text-muted">Nessun passaggio impostato per questa micro-voce.</div>
          )}
        </div>

        {/* Form Aggiunta Passaggio (vista operatore) */}
        {view === 'operatore' && (
          <div>
            {showAddForm ? (
              <div className="bg-bg-sidebar p-3 rounded-lg border border-color flex flex-col gap-3">
                <input 
                  className="form-input text-xs" 
                  placeholder="Nome del nuovo passaggio..." 
                  value={newTitle} 
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                <div className="flex gap-2">
                  {(['doc', 'form', 'check', 'info'] as const).map(t => (
                    <button
                      key={t}
                      className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${newType === t ? 'border-primary bg-primary-light text-primary font-medium' : 'border-color text-muted'}`}
                      onClick={() => setNewType(t)}
                    >
                      {t === 'doc' ? '📎 Doc' : t === 'form' ? '📝 Form' : t === 'check' ? '✓ Check' : 'ℹ Info'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 justify-end mt-1">
                  <Button variant="ghost" className="text-xs" onClick={() => setShowAddForm(false)}>Annulla</Button>
                  <Button variant="primary" className="text-xs" onClick={handleAddPassaggio}>Aggiungi</Button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setShowAddForm(true)}
                className="w-full py-2.5 border border-dashed border-color hover:border-primary rounded-lg text-xs text-muted hover:text-primary flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={14} /> Aggiungi passaggio personalizzato
              </button>
            )}
          </div>
        )}

        {/* Log Ore & Note Status */}
        <div className="border-t border-color pt-4 flex flex-col gap-3 mt-2">
          <div className="flex gap-3">
            <div className="flex-1 form-group">
              <label className="text-xs text-muted mb-1 block">Ore Consuntivate</label>
              <input 
                type="number" 
                className="form-input text-xs" 
                value={ore} 
                onChange={(e) => setOre(Number(e.target.value))} 
                min="0" step="0.5"
              />
            </div>
            <div className="flex-1 form-group">
              <label className="text-xs text-muted mb-1 block">Ore Preventivate</label>
              <input className="form-input text-xs" value={`${microvoce.ore_preventivate}h`} disabled />
            </div>
          </div>

          <div className="form-group">
            <label className="text-xs text-muted mb-1 block">Nota / Causa Blocco</label>
            <textarea 
              className="form-input text-xs" 
              rows={2} 
              value={nota} 
              onChange={(e) => setNota(e.target.value)}
              placeholder="Inserisci nota in caso di ritardo o blocco..."
            />
          </div>
        </div>

        {/* Action Footer */}
        <div className="flex gap-2 mt-4 pt-3 border-t border-color justify-between items-center">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Chiudi</Button>
          
          <div className="flex gap-2">
             <Button variant="danger" isLoading={loading} onClick={() => handleUpdateMicrovoce('blocked')}>Segnala Blocco</Button>
             <Button variant="secondary" isLoading={loading} onClick={() => handleUpdateMicrovoce('active')}>Salva Cambiamenti</Button>
             <Button variant="primary" isLoading={loading} onClick={() => handleUpdateMicrovoce('done')}>Marca Completato</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
