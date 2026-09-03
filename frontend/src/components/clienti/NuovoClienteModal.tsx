import React, { useState } from 'react';
import { X, Building2, User, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import api from '@/lib/api';

interface NuovoClienteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const NuovoClienteModal: React.FC<NuovoClienteModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'individual' | 'company'>('company');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.post('/api/clienti', {
        nome,
        tipo,
        email: email || undefined,
        telefono: telefono || undefined,
        note: note || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore durante la creazione del cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-lg shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-bg-sidebar transition-colors"
        >
          <X size={18} className="text-muted" />
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center text-primary">
            <UserPlus size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold">Nuovo Cliente</h2>
            <p className="text-xs text-muted">Aggiungi un cliente alla tua anagrafica</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${tipo === 'company' ? 'border-primary bg-primary/10 text-primary' : 'border-color text-muted hover:border-primary/50'}`}
              onClick={() => setTipo('company')}
            >
              <Building2 size={24} />
              <span className="text-sm font-semibold">Società</span>
            </button>
            <button
              type="button"
              className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${tipo === 'individual' ? 'border-primary bg-primary/10 text-primary' : 'border-color text-muted hover:border-primary/50'}`}
              onClick={() => setTipo('individual')}
            >
              <User size={24} />
              <span className="text-sm font-semibold">Persona Fisica</span>
            </button>
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">
              {tipo === 'company' ? 'Ragione Sociale' : 'Nome e Cognome'} *
            </label>
            <input 
              type="text" 
              className="input-field" 
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted block mb-1">Email</label>
              <input 
                type="email" 
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Telefono</label>
              <input 
                type="text" 
                className="input-field"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Note (opzionale)</label>
            <textarea 
              className="input-field min-h-[80px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && <div className="text-xs text-error">{error}</div>}

          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-color">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Annulla
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creazione...' : 'Crea Cliente'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
};
