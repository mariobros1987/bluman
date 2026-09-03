import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Plus, Building2, User, Mail, Phone } from 'lucide-react';
import { NuovoClienteModal } from '@/components/clienti/NuovoClienteModal';
import api from '@/lib/api';

export const Clienti: React.FC = () => {
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchClienti = async () => {
    try {
      const resp = await api.get('/api/clienti');
      setClienti(resp.data || []);
    } catch (err) {
      console.error('Errore nel caricamento dei clienti', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClienti();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Anagrafica Clienti</h1>
          <p className="text-xs text-muted mt-1">Gestione clienti (persone fisiche e società) e storico progetti.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
          + Nuovo Cliente
        </Button>
      </div>

      {loading ? (
        <div className="text-muted text-sm py-4">Caricamento clienti...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clienti.map(c => (
            <Card key={c.id} className="cursor-pointer hover:border-primary transition-all flex flex-col justify-between">
              <div>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {c.tipo === 'company' ? <Building2 size={20} /> : <User size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate">{c.nome}</h3>
                    <Badge variant={c.tipo === 'company' ? 'info' : 'default'} className="mt-1">
                      {c.tipo === 'company' ? 'Società' : 'Persona Fisica'}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-muted pt-2 border-t border-color/50">
                  <div className="flex items-center gap-2">
                    <Mail size={12} className="text-muted" />
                    <span className="truncate">{c.email || 'Nessuna email registrata'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={12} className="text-muted" />
                    <span>{c.telefono || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-color flex justify-between items-center text-[10px] text-muted">
                <span>Registrato il: {new Date(c.created_at || Date.now()).toLocaleDateString('it-IT')}</span>
                <span className="text-primary font-semibold hover:underline">Vedi dettagli →</span>
              </div>
            </Card>
          ))}
          {clienti.length === 0 && (
            <div className="text-center text-muted col-span-3 py-8 text-sm">Nessun cliente presente in anagrafica.</div>
          )}
        </div>
      )}

      <NuovoClienteModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={fetchClienti} 
      />
    </div>
  );
};
