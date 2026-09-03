import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Plus } from 'lucide-react';
import api from '@/lib/api';

export const Preventivi: React.FC = () => {
  const [preventivi, setPreventivi] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPreventivi = async () => {
      try {
        const resp = await api.get('/api/preventivi');
        setPreventivi(resp.data || []);
      } catch (err) {
        console.error('Errore nel caricamento dei preventivi', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPreventivi();
  }, []);

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'bozza': return <Badge variant="default">Bozza</Badge>;
      case 'inviato': return <Badge variant="warning">Inviato</Badge>;
      case 'accettato': return <Badge variant="success">Accettato</Badge>;
      case 'rifiutato': return <Badge variant="error">Rifiutato</Badge>;
      default: return <Badge variant="default">{stato}</Badge>;
    }
  };

  const handleAccetta = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      setLoading(true);
      await api.post(`/api/preventivi/${id}/accetta`);
      alert("Progetto creato con successo!");
      navigate('/app/progetti');
    } catch (err) {
      console.error(err);
      alert("Errore durante l'accettazione del preventivo");
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl">Preventivi (Engagement Letters)</h1>
        <Button icon={<Plus size={18} />} onClick={() => navigate('/app/preventivi/nuovo')}>
          Nuovo Preventivo
        </Button>
      </div>
      
      {loading ? (
        <div className="text-muted">Caricamento preventivi...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {preventivi.map(p => (
            <Card key={p.id} className="flex justify-between items-center hover:border-primary transition-colors">
              <div>
                <h3 className="text-lg font-semibold">{p.titolo || 'Preventivo senza titolo'}</h3>
                <p className="text-sm text-muted mt-1">Cliente ID: {p.cliente_id}</p>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-sm text-muted">Valore</p>
                  <p className="font-semibold">€ {p.valore_totale}</p>
                </div>
                {getStatusBadge(p.stato)}
                {p.stato === 'bozza' && (
                  <Button variant="primary" size="sm" onClick={(e) => handleAccetta(e, p.id)}>
                    Accetta e Crea Progetto
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {preventivi.length === 0 && <p className="text-muted">Nessun preventivo trovato.</p>}
        </div>
      )}
    </div>
  );
};
