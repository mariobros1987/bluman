import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useAuthStore } from '@/store/auth';
import { LogOut } from 'lucide-react';
import api from '@/lib/api';

export const PortaleDashboard: React.FC = () => {
  const { profile, signOut } = useAuthStore();
  const [progetti, setProgetti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDati = async () => {
      try {
        const resp = await api.get('/api/progetti');
        setProgetti(resp.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchDati();
  }, []);

  return (
    <div className="flex h-screen bg-bg">
      {/* Sidebar Semplificata */}
      <aside className="w-64 bg-bg-sidebar border-r border-color flex flex-col shrink-0">
        <div className="p-4 border-b border-color flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center font-bold">B</div>
          <div>
            <h2 className="font-semibold text-sm">BluMan Portal</h2>
            <p className="text-xs text-muted">Area Cliente</p>
          </div>
        </div>
        <div className="flex-1 p-4">
          <div className="bg-primary text-white rounded-md p-2 text-sm font-medium">Dashboard Progetti</div>
        </div>
        <div className="p-4 border-t border-color">
          <button className="flex items-center gap-2 text-muted hover:text-main text-sm w-full" onClick={signOut}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-bg-sidebar border-b border-color flex items-center px-6 shrink-0">
          <h1 className="font-semibold">Benvenuto, {profile?.nome || 'Cliente'}</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <h2 className="text-2xl mb-6">I Tuoi Progetti</h2>
          
          {loading ? (
            <div className="text-muted">Caricamento progetti...</div>
          ) : (
            <div className="flex flex-col gap-4">
              {progetti.map(p => (
                <Card key={p.id}>
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{p.nome}</h3>
                      <p className="text-sm text-muted">Apertura: {new Date(p.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">{p.avanzamento_pct || 0}%</div>
                      <div className="text-xs text-muted">completato</div>
                    </div>
                  </div>
                  <ProgressBar progress={p.avanzamento_pct || 0} />
                </Card>
              ))}
              {progetti.length === 0 && <p className="text-muted">Nessun progetto trovato.</p>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
