import React, { useEffect, useState } from 'react';
import { Shield, Building2, Plus, BarChart3, RefreshCw, Pause, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import api from '@/lib/api';

interface Tenant {
  id: string;
  ragione_sociale: string;
  piano: string;
  stato: string;
  created_at: string;
}

interface TenantMetriche {
  tenant: any;
  utenti: number;
  clienti: number;
  progetti: number;
  fatture_emesse: number;
  totale_fatturato: number;
}

export const SuperAdmin: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [metriche, setMetriche] = useState<TenantMetriche | null>(null);
  const [metricheLoading, setMetricheLoading] = useState(false);

  // Create form
  const [formRagSoc, setFormRagSoc] = useState('');
  const [formPiano, setFormPiano] = useState('trial');
  const [formAdvisorNome, setFormAdvisorNome] = useState('');
  const [formAdvisorEmail, setFormAdvisorEmail] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/tenants');
      setTenants(res.data || []);
    } catch (err) {
      console.error('Errore caricamento tenant', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchMetriche = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setMetricheLoading(true);
    try {
      const res = await api.get(`/api/admin/tenants/${tenantId}/metriche`);
      setMetriche(res.data);
    } catch (err) {
      console.error('Errore caricamento metriche', err);
      setMetriche(null);
    } finally {
      setMetricheLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      await api.post('/api/admin/tenants', {
        ragione_sociale: formRagSoc,
        piano: formPiano,
        advisor_nome: formAdvisorNome,
        advisor_email: formAdvisorEmail,
      });
      setShowCreateForm(false);
      setFormRagSoc('');
      setFormAdvisorNome('');
      setFormAdvisorEmail('');
      fetchTenants();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore creazione tenant');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleSospendi = async (tenantId: string) => {
    try {
      await api.post(`/api/admin/tenants/${tenantId}/sospendi`);
      fetchTenants();
      if (selectedTenantId === tenantId) fetchMetriche(tenantId);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore');
    }
  };

  const handleRiattiva = async (tenantId: string) => {
    try {
      await api.post(`/api/admin/tenants/${tenantId}/riattiva`);
      fetchTenants();
      if (selectedTenantId === tenantId) fetchMetriche(tenantId);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore');
    }
  };

  const handleResetOwner = async (tenantId: string) => {
    if (!confirm('Reinviare l\'invito all\'owner di questo tenant?')) return;
    try {
      const res = await api.post(`/api/admin/tenants/${tenantId}/reset-owner-access`);
      alert(`Invito reinviato a: ${res.data.email}`);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield size={24} className="text-primary" />
            Super Admin
          </h1>
          <p className="text-xs text-muted mt-1">Gestione globale di tutti i tenant della piattaforma</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus size={16} />
          Nuovo Tenant
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <Card>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Building2 size={16} className="text-primary" />
            Crea un nuovo Tenant
          </h3>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Ragione Sociale</label>
                <input type="text" className="input-field" value={formRagSoc} onChange={e => setFormRagSoc(e.target.value)} required placeholder="Bluecode Ltd" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Piano</label>
                <select className="input-field" value={formPiano} onChange={e => setFormPiano(e.target.value)}>
                  <option value="trial">Trial</option>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Nome Advisor</label>
                <input type="text" className="input-field" value={formAdvisorNome} onChange={e => setFormAdvisorNome(e.target.value)} required placeholder="Mario Rossi" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Email Advisor</label>
                <input type="email" className="input-field" value={formAdvisorEmail} onChange={e => setFormAdvisorEmail(e.target.value)} required placeholder="advisor@studio.com" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateForm(false)}>Annulla</button>
              <button type="submit" className="btn-primary" disabled={createLoading}>{createLoading ? 'Creazione...' : 'Crea Tenant'}</button>
            </div>
          </form>
        </Card>
      )}

      {/* Tenant List + Metriche */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lista */}
        <div className="lg:col-span-2">
          <Card title="Tenant Registrati">
            {loading ? (
              <div className="text-xs text-muted py-4">Caricamento...</div>
            ) : (
              <table className="w-full text-left text-xs border-collapse mt-2">
                <thead>
                  <tr className="bg-bg-sidebar text-muted border-b border-color">
                    <th className="p-2 font-semibold">Ragione Sociale</th>
                    <th className="p-2 font-semibold text-center">Piano</th>
                    <th className="p-2 font-semibold text-center">Stato</th>
                    <th className="p-2 font-semibold text-center">Creato</th>
                    <th className="p-2 font-semibold text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(t => (
                    <tr
                      key={t.id}
                      className={`border-b border-color/50 hover:bg-bg-card-hover cursor-pointer transition-colors ${
                        selectedTenantId === t.id ? 'bg-primary-light' : ''
                      }`}
                      onClick={() => fetchMetriche(t.id)}
                    >
                      <td className="p-2 font-semibold">{t.ragione_sociale}</td>
                      <td className="p-2 text-center"><Badge variant="info">{t.piano}</Badge></td>
                      <td className="p-2 text-center">
                        <Badge variant={t.stato === 'attivo' || t.stato === 'trial' ? 'success' : 'error'}>{t.stato}</Badge>
                      </td>
                      <td className="p-2 text-center text-muted">{new Date(t.created_at).toLocaleDateString('it-IT')}</td>
                      <td className="p-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {t.stato === 'sospeso' ? (
                            <button onClick={(e) => { e.stopPropagation(); handleRiattiva(t.id); }} className="p-1 rounded hover:bg-success-light text-success transition-colors" title="Riattiva">
                              <Play size={14} />
                            </button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); handleSospendi(t.id); }} className="p-1 rounded hover:bg-error-light text-error transition-colors" title="Sospendi">
                              <Pause size={14} />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); handleResetOwner(t.id); }} className="p-1 rounded hover:bg-warning-light text-warning transition-colors" title="Reset Owner">
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Metriche */}
        <div className="lg:col-span-1">
          {selectedTenantId && (
            <Card>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 size={16} className="text-primary" />
                Metriche Tenant
              </h3>
              {metricheLoading ? (
                <div className="text-xs text-muted">Caricamento metriche...</div>
              ) : metriche ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg bg-bg-sidebar">
                      <div className="text-[10px] text-muted">Utenti</div>
                      <div className="text-lg font-bold text-primary">{metriche.utenti}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-bg-sidebar">
                      <div className="text-[10px] text-muted">Clienti</div>
                      <div className="text-lg font-bold text-primary">{metriche.clienti}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-bg-sidebar">
                      <div className="text-[10px] text-muted">Progetti</div>
                      <div className="text-lg font-bold text-primary">{metriche.progetti}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-bg-sidebar">
                      <div className="text-[10px] text-muted">Fatture</div>
                      <div className="text-lg font-bold text-primary">{metriche.fatture_emesse}</div>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-gradient-to-r from-bg-card to-primary-light/20 border border-primary/30">
                    <div className="text-[10px] text-primary font-medium">Totale Fatturato</div>
                    <div className="text-xl font-black">€ {metriche.totale_fatturato.toLocaleString('it-IT')}</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted italic">Seleziona un tenant per visualizzare le metriche.</p>
              )}
            </Card>
          )}

          {!selectedTenantId && (
            <Card>
              <p className="text-xs text-muted text-center py-4">Clicca su un tenant per visualizzare le metriche</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
