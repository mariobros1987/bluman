import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import api from '@/lib/api';

export const Progetti: React.FC = () => {
  const [progetti, setProgetti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProgetti = async () => {
      try {
        const resp = await api.get('/api/progetti');
        setProgetti(resp.data || []);
      } catch (err) {
        console.error('Errore nel caricamento dei progetti', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProgetti();
  }, []);

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'active': return <Badge variant="success">Attivo</Badge>;
      case 'completed': return <Badge variant="info">Completato</Badge>;
      case 'at_risk': return <Badge variant="error">A Rischio</Badge>;
      case 'delayed': return <Badge variant="warning">In Ritardo</Badge>;
      default: return <Badge variant="default">{stato}</Badge>;
    }
  };

  return (
    <div>
      <h1 className="text-3xl mb-6">Progetti</h1>
      
      {loading ? (
        <div className="text-muted">Caricamento progetti...</div>
      ) : (
        <div className="flex-col gap-4">
          {progetti.map(prog => (
            <Card 
              key={prog.id} 
              className="flex flex-col gap-4 cursor-pointer hover:border-primary transition-colors mb-4"
              onClick={() => navigate(`/app/progetti/${prog.id}`)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold">{prog.nome}</h3>
                  <p className="text-sm text-muted mt-1">
                    Cliente ID: {prog.cliente_id}
                  </p>
                </div>
                {getStatusBadge(prog.stato)}
              </div>
              
              <div>
                <ProgressBar progress={prog.avanzamento_pct || 0} label="Avanzamento Globale" />
              </div>
              
              <div className="flex justify-between mt-2 pt-4 border-t border-color text-sm text-muted">
                <span>Preventivato: €{prog.valore_totale || 0}</span>
                <span>Data Inizio: {prog.data_inizio_stimata ? new Date(prog.data_inizio_stimata).toLocaleDateString() : 'N/D'}</span>
              </div>
            </Card>
          ))}
          {progetti.length === 0 && <p className="text-muted">Nessun progetto trovato.</p>}
        </div>
      )}
    </div>
  );
};
