import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check, CheckCircle2, User, Building2, UserPlus, Search, Receipt } from 'lucide-react';
import api from '@/lib/api';

export const PreventivoWizard: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [clienti, setClienti] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  
  // State: Cliente
  const [isNewCliente, setIsNewCliente] = useState(false);
  const [selectedClienteId, setSelectedClienteId] = useState<string>('');
  const [clienteNome, setClienteNome] = useState('');
  const [tipoCliente, setTipoCliente] = useState<'individual' | 'company'>('company');
  const [clientSearch, setClientSearch] = useState('');

  // State: Progetto & Moduli
  const [progettoNome, setProgettoNome] = useState('');
  const [selectedModules, setSelectedModules] = useState<any[]>([]);
  
  // Meta
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [cliRes, tplRes] = await Promise.all([
          api.get('/api/clienti'),
          api.get('/api/libreria')
        ]);
        setClienti(cliRes.data || []);
        setTemplates(tplRes.data || []);
      } catch (e) {
        console.error(e);
      }
    };
    fetchData();
  }, []);

  const toggleModule = (t: any) => {
    const exists = selectedModules.find(m => m.modulo_template_id === t.id);
    if (exists) {
      setSelectedModules(prev => prev.filter(m => m.modulo_template_id !== t.id));
    } else {
      setSelectedModules(prev => [...prev, {
        modulo_template_id: t.id,
        modulo_template_versione: t.versione || 1,
        nome: t.nome,
        categoria: t.categoria,
        ore: t.ore_default || 0,
        prezzo_proposto: t.prezzo_default || 0
      }]);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      let targetClienteId = selectedClienteId;

      // Se è un nuovo cliente, crealo al volo
      if (isNewCliente) {
        const cliResp = await api.post('/api/clienti', {
          nome: clienteNome,
          tipo: tipoCliente
        });
        targetClienteId = cliResp.data.id;
      }
      
      // Crea il preventivo/progetto
      await api.post('/api/preventivi', {
        cliente_id: targetClienteId,
        titolo: progettoNome,
        note: isNewCliente ? `Cliente generato automaticamente: ${clienteNome} (${tipoCliente})` : 'Generato da Wizard',
        righe: selectedModules
      });
      navigate('/app/preventivi');
    } catch (e) {
      console.error(e);
      alert('Errore durante la creazione del progetto. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  const isStep1Valid = () => {
    if (!progettoNome.trim()) return false;
    if (isNewCliente) {
      return clienteNome.trim().length > 0;
    }
    return selectedClienteId !== '';
  };

  const totalePrezzo = selectedModules.reduce((acc, curr) => acc + curr.prezzo_proposto, 0);
  const totaleOre = selectedModules.reduce((acc, curr) => acc + curr.ore, 0);

  const filteredClients = clienti.filter(c => c.nome.toLowerCase().includes(clientSearch.toLowerCase()));

  // Componente Progresso
  const renderStepper = () => (
    <div className="bg-bg-sidebar border border-color rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-in shadow-sm">
      <div>
        <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary-light">
          Nuovo Progetto & Preventivo
        </h2>
        <p className="text-xs text-muted mt-1">Configura il cliente, i moduli e invia l'engagement letter.</p>
      </div>
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(n => (
          <React.Fragment key={n}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              step > n ? 'bg-success text-white shadow-lg shadow-success/20' : 
              step === n ? 'bg-primary text-white ring-4 ring-primary/20 shadow-lg shadow-primary/30' : 
              'bg-bg-card text-muted border border-color'
            }`}>
              {step > n ? <Check size={16} /> : n}
            </div>
            {n < 3 && (
              <div className="w-12 h-1 rounded-full bg-bg-card relative overflow-hidden">
                <div className={`absolute top-0 left-0 h-full transition-all duration-500 ease-in-out ${step > n ? 'w-full bg-success' : 'w-0 bg-primary'}`} />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6 pb-20">
      {renderStepper()}

      <Card className="animate-fade-in border-t-4 border-t-primary shadow-xl">
        
        {/* STEP 1: CLIENTE E PROGETTO */}
        {step === 1 && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex items-center gap-3 border-b border-color pb-4">
              <div className="p-2 bg-primary/10 text-primary rounded-lg">
                <UserPlus size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg">1. Dettagli Cliente & Progetto</h3>
                <p className="text-xs text-muted">A chi è rivolto questo progetto?</p>
              </div>
            </div>

            {/* Scelta Cliente */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-2 p-1 bg-bg-sidebar rounded-lg border border-color w-fit">
                <button 
                  className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${!isNewCliente ? 'bg-bg-card text-main shadow border border-color' : 'text-muted hover:text-main'}`}
                  onClick={() => setIsNewCliente(false)}
                >
                  Seleziona Esistente
                </button>
                <button 
                  className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${isNewCliente ? 'bg-primary text-white shadow border border-primary' : 'text-muted hover:text-main'}`}
                  onClick={() => setIsNewCliente(true)}
                >
                  + Crea Nuovo
                </button>
              </div>

              {!isNewCliente ? (
                <div className="flex flex-col gap-3 p-4 bg-bg-sidebar border border-color rounded-xl animate-fade-in">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input 
                      className="input-field pl-9 w-full bg-bg-card" 
                      placeholder="Cerca cliente..." 
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-2">
                    {filteredClients.map(c => (
                      <div 
                        key={c.id}
                        onClick={() => setSelectedClienteId(c.id)}
                        className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 transition-all ${selectedClienteId === c.id ? 'border-primary bg-primary/10 shadow-sm' : 'border-color hover:border-primary/50 bg-bg-card'}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${selectedClienteId === c.id ? 'bg-primary text-white' : 'bg-bg-sidebar text-muted'}`}>
                          {c.tipo === 'company' ? <Building2 size={16} /> : <User size={16} />}
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${selectedClienteId === c.id ? 'text-primary' : 'text-main'}`}>{c.nome}</p>
                          <p className="text-[10px] text-muted">{c.tipo === 'company' ? 'Società' : 'Persona Fisica'}</p>
                        </div>
                        {selectedClienteId === c.id && <CheckCircle2 className="ml-auto text-primary" size={20} />}
                      </div>
                    ))}
                    {filteredClients.length === 0 && (
                      <p className="text-xs text-muted text-center py-4">Nessun cliente trovato.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4 p-5 bg-primary/5 border border-primary/20 rounded-xl animate-fade-in">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${tipoCliente === 'company' ? 'border-primary bg-bg-card text-primary shadow-sm' : 'border-color/50 text-muted hover:border-primary/50 bg-bg-sidebar/50'}`}
                      onClick={() => setTipoCliente('company')}
                    >
                      <Building2 size={24} />
                      <span className="text-sm font-semibold">Società</span>
                    </button>
                    <button
                      type="button"
                      className={`p-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${tipoCliente === 'individual' ? 'border-primary bg-bg-card text-primary shadow-sm' : 'border-color/50 text-muted hover:border-primary/50 bg-bg-sidebar/50'}`}
                      onClick={() => setTipoCliente('individual')}
                    >
                      <User size={24} />
                      <span className="text-sm font-semibold">Persona Fisica</span>
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted uppercase block mb-1">
                      {tipoCliente === 'company' ? 'Ragione Sociale' : 'Nome e Cognome'} *
                    </label>
                    <input 
                      className="input-field text-sm focus:ring-2 focus:ring-primary/50 bg-bg-card" 
                      placeholder="es. Acme S.r.l." 
                      value={clienteNome} 
                      onChange={e => setClienteNome(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Dettagli Progetto */}
            <div className="pt-2 border-t border-color">
              <label className="text-xs font-semibold text-muted uppercase block mb-1">Nome del Progetto *</label>
              <input 
                className="input-field text-sm focus:ring-2 focus:ring-primary/50" 
                placeholder="es. Consulenza Holding 2026" 
                value={progettoNome} 
                onChange={e => setProgettoNome(e.target.value)}
              />
            </div>

            <div className="flex justify-end mt-2 pt-4 border-t border-color">
              <Button onClick={() => setStep(2)} disabled={!isStep1Valid()} className="px-6 py-2">
                Prosegui ai Moduli →
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: SELEZIONE MODULI */}
        {step === 2 && (
          <div className="flex flex-col gap-6 animate-fade-in">
             <div className="flex items-center gap-3 border-b border-color pb-4">
              <div className="p-2 bg-primary/10 text-primary rounded-lg">
                <Receipt size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg">2. Selezione Moduli</h3>
                <p className="text-xs text-muted">Scegli dalla libreria i moduli da includere nel preventivo.</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
              {templates.map(t => {
                const isSelected = selectedModules.some(m => m.modulo_template_id === t.id);

                return (
                  <div 
                    key={t.id} 
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 group flex flex-col justify-between min-h-[100px] ${
                      isSelected 
                        ? 'border-primary bg-primary/5 shadow-md shadow-primary/10 scale-[1.02]' 
                        : 'border-color hover:border-primary/40 hover:bg-bg-sidebar bg-bg-card'
                    }`}
                    onClick={() => toggleModule(t)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center text-xs transition-colors ${
                        isSelected ? 'bg-primary text-white' : 'border-2 border-color group-hover:border-primary/50'
                      }`}>
                        {isSelected && <Check size={14} strokeWidth={3} />}
                      </div>
                      <div className="flex-1">
                        <h4 className={`text-sm font-bold leading-tight mb-1 transition-colors ${isSelected ? 'text-primary' : 'text-main'}`}>
                          {t.nome}
                        </h4>
                        <div className="inline-block px-2 py-0.5 rounded-full bg-bg-sidebar border border-color text-[10px] text-muted mb-2">
                          {t.categoria}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-end justify-between mt-2 pt-2 border-t border-color/50">
                      <span className="text-xs text-muted font-medium">{t.ore_default || 0}h previste</span>
                      <span className="text-sm font-black">€ {t.prezzo_default?.toLocaleString('it-IT')}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer Step 2 con Contatore Flottante */}
            <div className="flex justify-between items-center mt-2 pt-4 border-t border-color">
              <Button variant="ghost" onClick={() => setStep(1)}>← Torna indietro</Button>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Parziale</p>
                  <p className="text-lg font-black text-primary">€ {totalePrezzo.toLocaleString('it-IT')}</p>
                </div>
                <Button onClick={() => setStep(3)} disabled={selectedModules.length === 0} className="px-6">
                  Vai al Riepilogo →
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: RIEPILOGO & ENGAGEMENT LETTER */}
        {step === 3 && (
          <div className="flex flex-col gap-6 animate-fade-in">
             <div className="flex items-center gap-3 border-b border-color pb-4">
              <div className="p-2 bg-success/10 text-success rounded-lg">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg">3. Conferma ed Emissione</h3>
                <p className="text-xs text-muted">Controlla i dati prima di generare l'Engagement Letter.</p>
              </div>
            </div>

            {/* Receipt Style Container */}
            <div className="bg-bg-sidebar border border-color rounded-2xl p-6 shadow-inner relative overflow-hidden">
              {/* Deco elements for receipt */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-success to-primary opacity-50" />
              
              <div className="flex flex-col md:flex-row gap-8">
                
                {/* Meta */}
                <div className="flex-1 flex flex-col gap-4">
                  <div>
                    <p className="text-[10px] uppercase text-muted font-bold tracking-wider mb-1">Cliente Intestatario</p>
                    <p className="text-sm font-semibold">
                      {isNewCliente ? clienteNome : (clienti.find(c => c.id === selectedClienteId)?.nome || '—')}
                    </p>
                    <p className="text-xs text-muted">
                      {isNewCliente ? (tipoCliente === 'company' ? 'Società' : 'Persona Fisica') : (clienti.find(c => c.id === selectedClienteId)?.tipo === 'company' ? 'Società' : 'Persona Fisica')}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-[10px] uppercase text-muted font-bold tracking-wider mb-1">Progetto</p>
                    <p className="text-sm font-semibold">{progettoNome}</p>
                    <p className="text-xs text-muted">{selectedModules.length} Moduli • {totaleOre}h Stimate</p>
                  </div>
                </div>

                {/* Moduli */}
                <div className="flex-[2] flex flex-col gap-2">
                  <p className="text-[10px] uppercase text-muted font-bold tracking-wider mb-1 border-b border-color pb-2">Dettaglio Servizi</p>
                  {selectedModules.map((m, idx) => (
                    <div key={m.modulo_template_id} className="flex justify-between items-center text-xs py-1.5 border-b border-color/30 border-dashed">
                      <div className="flex items-center gap-2">
                        <span className="text-muted w-4">{idx + 1}.</span>
                        <span className="font-medium text-main">{m.nome}</span>
                      </div>
                      <span className="font-bold">€ {m.prezzo_proposto?.toLocaleString('it-IT')}</span>
                    </div>
                  ))}
                  
                  <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-bg-card to-primary/10 border border-primary/30 flex justify-between items-center shadow-lg">
                    <div>
                      <div className="text-xs text-primary font-bold uppercase tracking-wider">Totale Preventivo</div>
                      <div className="text-[10px] text-muted mt-0.5">Escluso IVA ed eventuali spese</div>
                    </div>
                    <div className="text-2xl font-black text-primary">€ {totalePrezzo.toLocaleString('it-IT')}</div>
                  </div>
                </div>

              </div>
            </div>

            <div className="bg-success/10 border border-success/30 p-4 rounded-xl text-sm text-success-dark flex items-center gap-3">
              <div className="p-2 bg-success text-white rounded-full">
                <CheckCircle2 size={16} />
              </div>
              <div>
                <strong>Tutto pronto!</strong> Cliccando su conferma, il progetto verrà inizializzato in stato <em>Pre-Project</em> e verrà generata la Lettera di Incarico.
              </div>
            </div>

            <div className="flex justify-between items-center mt-2 pt-4 border-t border-color">
              <Button variant="ghost" onClick={() => setStep(2)}>← Torna indietro</Button>
              <Button variant="primary" isLoading={loading} onClick={handleSave} className="px-8 py-2 text-sm shadow-xl shadow-primary/20">
                Conferma e Crea Progetto
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
