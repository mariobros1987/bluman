import React, { useState } from 'react';
import { X, Receipt } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import api from '@/lib/api';

interface FatturaModalProps {
  isOpen: boolean;
  onClose: () => void;
  progettoId: string;
  moduli: any[];
  onSuccess: () => void;
}

export const FatturaModal: React.FC<FatturaModalProps> = ({
  isOpen, onClose, progettoId, moduli, onSuccess
}) => {
  const [tipo, setTipo] = useState<'modulo_completo' | 'modulo_parziale' | 'milestone_libera'>('modulo_completo');
  const [selectedModuloId, setSelectedModuloId] = useState<string>('');
  const [percentuale, setPercentuale] = useState<number>(100);
  const [descrizioneLibera, setDescrizioneLibera] = useState('');
  const [importoLibero, setImportoLibero] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const righe = [];

    if (tipo === 'modulo_completo' || tipo === 'modulo_parziale') {
      if (!selectedModuloId) {
        alert('Seleziona un modulo');
        setLoading(false);
        return;
      }
      righe.push({
        tipo_riga: tipo,
        modulo_progetto_id: selectedModuloId,
        percentuale: tipo === 'modulo_parziale' ? percentuale : null,
      });
    } else {
      if (!descrizioneLibera || importoLibero <= 0) {
        alert('Inserisci descrizione e importo validi');
        setLoading(false);
        return;
      }
      righe.push({
        tipo_riga: 'milestone_libera',
        descrizione: descrizioneLibera,
        importo_unitario: importoLibero,
        quantita: 1,
      });
    }

    try {
      await api.post('/api/fatture/emetti', {
        progetto_id: progettoId,
        righe,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore durante l\'emissione della fattura');
    } finally {
      setLoading(false);
    }
  };

  const selectedModulo = moduli.find(m => m.id === selectedModuloId);
  const maxPercentuale = selectedModulo ? (100 - (selectedModulo.fatturato_pct || 0)) : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-lg shadow-2xl animate-fade-in relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-bg-sidebar transition-colors"
        >
          <X size={18} className="text-muted" />
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary">
            <Receipt size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold">Emetti Fattura</h2>
            <p className="text-xs text-muted">Genera un documento per questo progetto</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-muted block mb-1">Tipo di fatturazione</label>
            <select 
              className="input-field"
              value={tipo}
              onChange={(e: any) => setTipo(e.target.value)}
            >
              <option value="modulo_completo">Modulo Completo (100%)</option>
              <option value="modulo_parziale">Avanzamento Modulo (Parziale)</option>
              <option value="milestone_libera">Milestone / Importo Libero</option>
            </select>
          </div>

          {(tipo === 'modulo_completo' || tipo === 'modulo_parziale') && (
            <div className="flex flex-col gap-4 p-3 rounded-lg border border-color bg-bg-sidebar/50">
              <div>
                <label className="text-xs text-muted block mb-1">Seleziona Modulo</label>
                <select 
                  className="input-field"
                  value={selectedModuloId}
                  onChange={(e) => setSelectedModuloId(e.target.value)}
                  required
                >
                  <option value="">-- Seleziona --</option>
                  {moduli.map(m => {
                    const fatturato = m.fatturato_pct || 0;
                    if (fatturato >= 100) return null;
                    return (
                      <option key={m.id} value={m.id}>
                        {m.nome} (Fatturato: {fatturato}%) - Valore residuo: €{((m.prezzo || 0) * (100 - fatturato) / 100).toLocaleString('it-IT')}
                      </option>
                    );
                  })}
                </select>
              </div>

              {tipo === 'modulo_parziale' && selectedModuloId && (
                <div>
                  <label className="text-xs text-muted block mb-1">
                    Percentuale da fatturare (Max {maxPercentuale}%)
                  </label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" 
                      min="1" 
                      max={maxPercentuale}
                      step="1"
                      className="input-field flex-1"
                      value={percentuale}
                      onChange={(e) => setPercentuale(Number(e.target.value))}
                      required
                    />
                    <span className="text-sm font-bold">
                      € {((selectedModulo?.prezzo || 0) * (percentuale / 100)).toLocaleString('it-IT')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {tipo === 'milestone_libera' && (
            <div className="flex flex-col gap-4 p-3 rounded-lg border border-color bg-bg-sidebar/50">
              <div>
                <label className="text-xs text-muted block mb-1">Descrizione (Milestone/Spesa)</label>
                <input 
                  type="text" 
                  className="input-field"
                  value={descrizioneLibera}
                  onChange={(e) => setDescrizioneLibera(e.target.value)}
                  placeholder="Es. Rimborso spese trasferta"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Importo (€)</label>
                <input 
                  type="number" 
                  min="0.01" 
                  step="0.01"
                  className="input-field"
                  value={importoLibero || ''}
                  onChange={(e) => setImportoLibero(Number(e.target.value))}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-color">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Annulla
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Emissione...' : 'Emetti Fattura'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
};
