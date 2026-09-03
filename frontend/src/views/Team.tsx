import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Mail, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/lib/api';

interface TeamMember {
  id: string;
  nome: string;
  email: string;
  ruolo: string;
  stato: string;
  avatar_ini: string;
  colore: string | null;
  created_at: string;
}

export const Team: React.FC = () => {
  const [utenti, setUtenti] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteNome, setInviteNome] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRuolo, setInviteRuolo] = useState('collaboratore_interno');
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchUtenti = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/tenant/utenti');
      setUtenti(res.data || []);
    } catch (err) {
      console.error('Errore caricamento utenti', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUtenti();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    try {
      await api.post('/api/tenant/utenti', null, {
        params: { nome: inviteNome, email: inviteEmail, ruolo: inviteRuolo }
      });
      setShowInviteForm(false);
      setInviteNome('');
      setInviteEmail('');
      fetchUtenti();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore durante l\'invito');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleToggleStato = async (user: TeamMember) => {
    const nuovoStato = user.stato === 'attivo' ? 'disattivato' : 'attivo';
    try {
      await api.patch(`/api/tenant/utenti/${user.id}`, null, {
        params: { stato: nuovoStato }
      });
      fetchUtenti();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore');
    }
  };

  const ruoloLabel = (ruolo: string) => {
    const map: Record<string, string> = {
      owner: 'Owner',
      admin: 'Admin',
      advisor: 'Advisor',
      collaboratore_interno: 'Collaboratore',
      collaboratore_esterno: 'Esterno',
    };
    return map[ruolo] || ruolo;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users size={24} className="text-primary" />
            Team
          </h1>
          <p className="text-xs text-muted mt-1">Gestisci i collaboratori del tuo studio</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => setShowInviteForm(!showInviteForm)}
        >
          <UserPlus size={16} />
          Invita Collaboratore
        </button>
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <Card>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Mail size={16} className="text-primary" />
            Invita un nuovo collaboratore
          </h3>
          <form onSubmit={handleInvite} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Nome completo</label>
                <input
                  type="text"
                  className="input-field"
                  value={inviteNome}
                  onChange={e => setInviteNome(e.target.value)}
                  required
                  placeholder="Mario Rossi"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Email</label>
                <input
                  type="email"
                  className="input-field"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                  placeholder="mario@studio.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Ruolo</label>
                <select
                  className="input-field"
                  value={inviteRuolo}
                  onChange={e => setInviteRuolo(e.target.value)}
                >
                  <option value="collaboratore_interno">Collaboratore Interno</option>
                  <option value="collaboratore_esterno">Collaboratore Esterno</option>
                  <option value="advisor">Advisor</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowInviteForm(false)}>
                Annulla
              </button>
              <button type="submit" className="btn-primary" disabled={inviteLoading}>
                {inviteLoading ? 'Invio...' : 'Invia Invito'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Lista utenti */}
      {loading ? (
        <div className="text-xs text-muted py-4">Caricamento team...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {utenti.map(u => (
            <div
              key={u.id}
              className={`bg-bg-card rounded-xl border border-color p-4 flex flex-col gap-3 transition-all hover:border-primary/40 ${
                u.stato === 'disattivato' ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: u.colore || 'var(--primary)', color: '#fff' }}
                >
                  {u.avatar_ini || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{u.nome}</div>
                  <div className="text-xs text-muted truncate">{u.email}</div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={u.ruolo === 'advisor' || u.ruolo === 'owner' ? 'info' : 'default'}>
                    {ruoloLabel(u.ruolo)}
                  </Badge>
                  <Badge variant={u.stato === 'attivo' ? 'success' : u.stato === 'invitato' ? 'warning' : 'error'}>
                    {u.stato}
                  </Badge>
                </div>
                {u.ruolo !== 'owner' && (
                  <button
                    onClick={() => handleToggleStato(u)}
                    className="text-xs text-muted hover:text-text-main transition-colors flex items-center gap-1"
                    title={u.stato === 'attivo' ? 'Disattiva' : 'Riattiva'}
                  >
                    {u.stato === 'attivo' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                )}
              </div>

              <div className="text-[10px] text-muted flex items-center gap-1">
                <Clock size={10} />
                Aggiunto il {new Date(u.created_at).toLocaleDateString('it-IT')}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && utenti.length === 0 && (
        <Card>
          <p className="text-xs text-muted text-center py-4">Nessun collaboratore. Invita il primo membro del team!</p>
        </Card>
      )}
    </div>
  );
};
