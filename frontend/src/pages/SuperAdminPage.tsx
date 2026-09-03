import React, { useState, useEffect } from 'react';
import { fmt } from '../utils';
import { setActiveTenantId } from '../utils/tenant';
import { fetchAdminTenantsApi, createAdminTenantApi, updateAdminTenantApi, deleteAdminTenantApi, resetPasswordTenantApi } from '../api/client';

interface TenantStudio {
  id: string;
  ragioneSociale: string;
  giurisdizione: string;
  pIva: string;
  leadAdvisorNome: string;
  leadAdvisorEmail: string;
  piano: 'enterprise' | 'pro' | 'trial';
  stato: 'attivo' | 'sospeso' | 'scaduto';
  durataMesi: number;
  dataAttivazione: string;
  dataScadenza: string;
  utentiCount: number;
  progettiCount: number;
  fatturatoMensile: number;
}

// §23 — nessun campo `leadAdvisorPassword`. Era una password in chiaro nel tipo, nel
// bundle, nel localStorage e nella colonna `tenant.lead_advisor_password` del database.
// La password iniziale la genera il server e si vede una volta sola: vive in
// `passwordEmessa` qui sotto, che è stato di componente e non viene mai persistito.

const DEFAULT_TENANTS: TenantStudio[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    ragioneSociale: 'Bluecode Ltd (Malta Headquarters)',
    giurisdizione: 'Malta (UE)',
    pIva: 'MT28491023',
    leadAdvisorNome: 'Joe Disabato',
    leadAdvisorEmail: 'joe@bluecode.advisory',
    piano: 'enterprise',
    stato: 'attivo',
    durataMesi: 12,
    dataAttivazione: '10/01/2026',
    dataScadenza: '10/01/2027',
    utentiCount: 12,
    progettiCount: 8,
    fatturatoMensile: 45000,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    ragioneSociale: 'Advisory Italia S.r.l. (Milano)',
    giurisdizione: 'Italia',
    pIva: 'IT01234567890',
    leadAdvisorNome: 'Avv. Lorenzo Marino',
    leadAdvisorEmail: 'lorenzo.marino@bluecode.advisory',
    piano: 'pro',
    stato: 'attivo',
    durataMesi: 6,
    dataAttivazione: '15/03/2026',
    dataScadenza: '15/09/2026',
    utentiCount: 6,
    progettiCount: 4,
    fatturatoMensile: 22000,
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    ragioneSociale: 'Swiss Wealth Management SA (Lugano)',
    giurisdizione: 'Svizzera',
    pIva: 'CHE-123.456.789',
    leadAdvisorNome: 'Dr. Elena Russo',
    leadAdvisorEmail: 'elena.russo@bluecode.advisory',
    piano: 'enterprise',
    stato: 'attivo',
    durataMesi: 12,
    dataAttivazione: '01/05/2026',
    dataScadenza: '01/05/2027',
    utentiCount: 18,
    progettiCount: 11,
    fatturatoMensile: 78000,
  },
];

export function SuperAdminPage() {
  const [tenants, setTenants] = useState<TenantStudio[]>(() => {
    const saved = localStorage.getItem('bluman_all_tenants_admin');
    return saved ? JSON.parse(saved) : DEFAULT_TENANTS;
  });

  useEffect(() => {
    fetchAdminTenantsApi().then(dbTenants => {
      if (dbTenants && Array.isArray(dbTenants) && dbTenants.length > 0) {
        setTenants(dbTenants);
      }
    });
  }, []);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [credentialsModalTenant, setCredentialsModalTenant] = useState<TenantStudio | null>(null);
  /**
   * §23 — la password del responsabile, così come l'ha appena emessa il server. Vive solo
   * qui, in memoria, finché il modale resta aperto: non va nel localStorage, non torna
   * dall'API di elenco, non è recuperabile dopo. Se il super admin la perde, la rigenera.
   */
  const [passwordEmessa, setPasswordEmessa] = useState<string | null>(null);
  const [rigenerandoPassword, setRigenerandoPassword] = useState(false);
  const [durationModalTenant, setDurationModalTenant] = useState<TenantStudio | null>(null);
  const [deleteModalTenant, setDeleteModalTenant] = useState<TenantStudio | null>(null);
  const [customExpiryInput, setCustomExpiryInput] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Form State Registrazione
  const [formName, setFormName] = useState('');
  const [formGiurisdizione, setFormGiurisdizione] = useState('Italia');
  const [formPiva, setFormPiva] = useState('');
  const [formAdvisorNome, setFormAdvisorNome] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPiano, setFormPiano] = useState<'enterprise' | 'pro' | 'trial'>('enterprise');
  const [formDurataMesi, setFormDurataMesi] = useState<number>(12);

  // Salva ogni variazione su localStorage
  useEffect(() => {
    localStorage.setItem('bluman_all_tenants_admin', JSON.stringify(tenants));
  }, [tenants]);

  // Calcola giorni rimanenti alla scadenza
  const calculateDaysRemaining = (dataScadenzaStr: string): number => {
    if (!dataScadenzaStr) return 0;
    try {
      const parts = dataScadenzaStr.split('/');
      if (parts.length === 3) {
        const expDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        const today = new Date();
        const diffMs = expDate.getTime() - today.getTime();
        return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }
    } catch (e) {
      console.warn('Errore calcolo scadenza:', e);
    }
    return 0;
  };

  // Creazione Nuovo Tenant
  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formEmail) return;

    const today = new Date();
    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + Number(formDurataMesi));

    const nuovoStudio = {
      id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
      ragioneSociale: formName,
      giurisdizione: formGiurisdizione,
      pIva: formPiva || 'IT' + Date.now().toString().substring(0, 9),
      leadAdvisorNome: formAdvisorNome || 'Lead Senior Advisor',
      leadAdvisorEmail: formEmail,
      piano: formPiano,
      stato: 'attivo' as const,
      durataMesi: Number(formDurataMesi),
      dataAttivazione: today.toLocaleDateString('it-IT'),
      dataScadenza: expDate.toLocaleDateString('it-IT'),
    };

    // Il database decide per primo: è lui a creare anche l'utente `advisor` responsabile
    // e a generare la password iniziale. Prima l'ordine era invertito — si aggiungeva lo
    // studio alla lista e poi si tentava la scrittura ignorandone l'esito, quindi un
    // rifiuto del server lasciava in interfaccia uno studio inesistente.
    let creato: any;
    try {
      creato = await createAdminTenantApi(nuovoStudio);
    } catch (err: any) {
      alert(`⚠️ Registrazione non riuscita: ${err.message}`);
      return;
    }

    const newTenant: TenantStudio = {
      ...nuovoStudio,
      id: creato?.id || nuovoStudio.id,
      utentiCount: 1,
      progettiCount: 0,
      fatturatoMensile: 0,
    };

    setTenants([newTenant, ...tenants]);
    setCreateModalOpen(false);

    // Reset Form
    setFormName('');
    setFormAdvisorNome('');
    setFormEmail('');
    setFormPiva('');

    // Mostra subito il modale con le credenziali: è l'unica occasione in cui la password
    // emessa dal server è leggibile.
    setPasswordEmessa(creato?.passwordTemporanea || null);
    setCredentialsModalTenant(newTenant);
  };

  // Toggle Sospensione / Riattivazione
  const handleToggleSuspend = async (tenant: TenantStudio) => {
    // §3.3 — prima l'update ottimistico veniva applicato PRIMA della risposta e l'alert
    // dichiarava successo a prescindere: uno studio restava «attivo» a database mentre
    // la console lo mostrava sospeso (e viceversa). Ora la UI segue il server.
    const nextState: 'attivo' | 'sospeso' = tenant.stato === 'attivo' ? 'sospeso' : 'attivo';
    try {
      await updateAdminTenantApi(tenant.id, { stato: nextState });
      setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, stato: nextState } : t));
      alert(`✓ Tenant "${tenant.ragioneSociale}" impostato sullo stato: ${nextState.toUpperCase()}`);
    } catch (err: any) {
      alert(`⚠️ Cambio stato NON riuscito: ${err?.message || 'errore di rete'}. Il tenant "${tenant.ragioneSociale}" resta ${tenant.stato.toUpperCase()} sul server.`);
    }
  };

  // Eliminazione Definitiva Tenant
  const handleDeleteTenant = async (tenant: TenantStudio) => {
    // §3.3 — eliminazione distruttiva: si toglie dalla lista solo a conferma avvenuta.
    // Prima il tenant spariva dall'interfaccia anche se la DELETE non era mai partita.
    try {
      await deleteAdminTenantApi(tenant.id);
      setTenants(prev => prev.filter(t => t.id !== tenant.id));
      setDeleteModalTenant(null);
      alert(`✓ Tenant "${tenant.ragioneSociale}" eliminato definitivamente dalla piattaforma.`);
    } catch (err: any) {
      alert(`⚠️ Eliminazione NON riuscita: ${err?.message || 'errore di rete'}. Il tenant "${tenant.ragioneSociale}" esiste ancora sul server.`);
    }
  };

  // Aggiornamento Durata Licenza
  const handleExtendDuration = async (tenant: TenantStudio, aggiungiGiorni: number) => {
    let baseDate = new Date();
    try {
      const parts = tenant.dataScadenza.split('/');
      if (parts.length === 3) {
        const parsed = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        if (parsed.getTime() > baseDate.getTime()) {
          baseDate = parsed;
        }
      }
    } catch (e) {}

    baseDate.setDate(baseDate.getDate() + aggiungiGiorni);
    const newScadenza = baseDate.toLocaleDateString('it-IT');

    // §3.3 — la proroga di una licenza ha valore contrattuale: la nuova data si mostra
    // solo dopo che il server l'ha registrata, altrimenti sembrava estesa e non lo era.
    try {
      await updateAdminTenantApi(tenant.id, { dataScadenza: newScadenza, stato: 'attivo' });
      setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, dataScadenza: newScadenza, stato: 'attivo' as const } : t));
      if (durationModalTenant && durationModalTenant.id === tenant.id) {
        setDurationModalTenant({ ...durationModalTenant, dataScadenza: newScadenza, stato: 'attivo' });
      }
      alert(`✓ Licenza per "${tenant.ragioneSociale}" estesa con successo fino al ${newScadenza}!`);
    } catch (err: any) {
      alert(`⚠️ Estensione licenza NON riuscita: ${err?.message || 'errore di rete'}. La scadenza resta ${tenant.dataScadenza}.`);
    }
  };

  const handleSetCustomExpiry = async (tenant: TenantStudio) => {
    if (!customExpiryInput) return;
    const parts = customExpiryInput.split('-');
    if (parts.length !== 3) {
      alert('Inserisci una data valida');
      return;
    }
    const formatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
    // §3.3 — come per l'estensione: prima la conferma del server, poi la UI.
    try {
      await updateAdminTenantApi(tenant.id, { dataScadenza: formatted, stato: 'attivo' });
      setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, dataScadenza: formatted, stato: 'attivo' as const } : t));
      if (durationModalTenant && durationModalTenant.id === tenant.id) {
        setDurationModalTenant({ ...durationModalTenant, dataScadenza: formatted, stato: 'attivo' });
      }
      alert(`✓ Nuova data di scadenza per "${tenant.ragioneSociale}" impostata al: ${formatted}`);
    } catch (err: any) {
      alert(`⚠️ Aggiornamento scadenza NON riuscito: ${err?.message || 'errore di rete'}. La data resta ${tenant.dataScadenza}.`);
    }
  };

  /**
   * Rigenera la password del responsabile. Serve quando il super admin riapre il modale
   * di uno studio già registrato: la password iniziale non è più leggibile da nessuna
   * parte, quindi l'unica strada è emetterne una nuova.
   */
  const handleRigeneraPassword = async (t: TenantStudio) => {
    if (!confirm(`Rigenerare la password di accesso per ${t.leadAdvisorEmail}?\n\nLa password attuale smetterà di funzionare immediatamente.`)) return;
    setRigenerandoPassword(true);
    try {
      const res = await resetPasswordTenantApi(t.id);
      setPasswordEmessa(res.passwordTemporanea);
    } catch (err: any) {
      alert(`⚠️ ${err.message}`);
    } finally {
      setRigenerandoPassword(false);
    }
  };

  // Invio Email di Benvenuto con Credenziali
  const handleSendCredentialsEmail = async (t: TenantStudio) => {
    // §35 — prima il browser chiamava direttamente `/api/send-email` con
    // `action: 'invite-collaborator'` e nessuna credenziale, contando sul fatto che la
    // funzione Vercel usasse le variabili d'ambiente della piattaforma: chiunque conoscesse
    // l'URL poteva spedire email a nome dello studio. Ora è il backend autenticato che
    // rigenera la password E la spedisce nella stessa chiamata: la password non passa mai
    // dal browser e l'esito riportato è quello vero (regola 7).
    if (!confirm(`Inviare le credenziali di accesso a ${t.leadAdvisorEmail}?\n\nViene emessa una nuova password: quella attuale smetterà di funzionare immediatamente.`)) return;
    setSendingInvite(true);
    try {
      const res = await resetPasswordTenantApi(t.id, { invia: true });
      setPasswordEmessa(res.passwordTemporanea);
      if (res.invitoInviato) {
        alert(`✓ Email di attivazione e credenziali inviata a ${res.email || t.leadAdvisorEmail}.`);
      } else {
        alert(`⚠️ Password rigenerata ma email non inviata: ${res.invitoErrore || 'errore SMTP'}.\n\nConsegna le credenziali manualmente: ${res.passwordTemporanea}`);
      }
    } catch (e: any) {
      alert(`⚠️ Operazione non riuscita: ${e.message}. Nessuna password è stata emessa.`);
    } finally {
      setSendingInvite(false);
    }
  };

  const totalFatturato = tenants.reduce((acc, t) => acc + t.fatturatoMensile, 0);
  const totalProgetti = tenants.reduce((acc, t) => acc + t.progettiCount, 0);
  const totalUtenti = tenants.reduce((acc, t) => acc + t.utentiCount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Super Admin */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>👑 Dashboard Super Admin — Gestione Multi-Tenant & Licenze Studio</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Pannello globale per registrazione nuovi Studi, gestione del tempo e scadenze, sospensione/riattivazione e generazione credenziali gestori
          </div>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span>+</span> Registra Nuovo Tenant Studio
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🏢 Studi / Tenant Registrati</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 6 }}>{tenants.length}</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 4 }}>
            ✓ {tenants.filter(t => t.stato === 'attivo').length} Attivi · {tenants.filter(t => t.stato === 'sospeso').length} Sospesi
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>💶 Fatturato Mensile Gestito</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', marginTop: 6 }}>{fmt(totalFatturato)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Volume d'affari complessivo studi</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>📂 Fascicoli e Incarichi Attivi</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#818cf8', marginTop: 6 }}>{totalProgetti}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Pratiche di consulenza in corso</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>👤 Utenti Staff Totali</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b', marginTop: 6 }}>{totalUtenti}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Professionisti ed operatori accreditati</div>
        </div>
      </div>

      {/* Tenants Table */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Elenco Studi Professionali & Controllo Licenze</h3>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>PostgreSQL RLS Multi-Tenant Isolation: <strong>ATTIVA</strong></span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px' }}>Ragione Sociale Studio</th>
                <th style={{ padding: '10px 8px' }}>Giurisdizione</th>
                <th style={{ padding: '10px 8px' }}>Lead Advisor (Gestore)</th>
                <th style={{ padding: '10px 8px' }}>Piano</th>
                <th style={{ padding: '10px 8px' }}>Scadenza Licenza (Tempo)</th>
                <th style={{ padding: '10px 8px' }}>Stato</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Azioni di Controllo</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const daysLeft = calculateDaysRemaining(t.dataScadenza);
                const isExpired = daysLeft <= 0;
                const isWarning = daysLeft > 0 && daysLeft <= 15;

                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', opacity: t.stato === 'sospeso' ? 0.7 : 1 }}>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: 'var(--text)' }}>
                      <div style={{ fontSize: 13 }}>{t.ragioneSociale}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>P.IVA: {t.pIva} · ID: {t.id.substring(0, 8)}...</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{t.giurisdizione}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{t.leadAdvisorNome || 'Lead Advisor'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--indigo-l)' }}>{t.leadAdvisorEmail}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: t.piano === 'enterprise' ? '#312e81' : t.piano === 'pro' ? '#064e3b' : '#3b2505', color: t.piano === 'enterprise' ? '#a5b4fc' : t.piano === 'pro' ? '#a7f3d0' : '#fde047' }}>
                        {t.piano.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600, fontSize: 11.5 }}>{t.dataScadenza}</div>
                      <div style={{ fontSize: 10, marginTop: 2, fontWeight: 700, color: isExpired ? '#ef4444' : isWarning ? '#eab308' : '#10b981' }}>
                        {isExpired ? '🔴 Scaduto' : isWarning ? `🟡 In Scadenza (${daysLeft} gg)` : `🟢 ${daysLeft} gg rimanenti`}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {t.stato === 'sospeso' ? (
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
                          ⏸ SOSPESO
                        </span>
                      ) : isExpired ? (
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
                          🔴 SCADUTO
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: '#064e3b', color: '#34d399', border: '1px solid #059669' }}>
                          ✓ ATTIVO
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Accesso Immediato / Entra nello Studio */}
                        <button
                          onClick={() => {
                            setActiveTenantId(t.id);
                            window.location.href = '/documents';
                          }}
                          title={`Imposta "${t.ragioneSociale}" come Studio Attivo e apri Document Studio`}
                          style={{ background: '#047857', border: '1px solid #10b981', color: '#ecfdf5', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                        >
                          🚀 Entra
                        </button>

                        {/* Credenziali e Link Accesso Gestore */}
                        <button
                          onClick={() => { setPasswordEmessa(null); setCredentialsModalTenant(t); }}
                          title="Visualizza Link di Accesso e Credenziali Gestore"
                          style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          🔑 Link & Password
                        </button>

                        {/* Imposta Scadenza / Tempo */}
                        <button
                          onClick={() => setDurationModalTenant(t)}
                          title="Imposta o Prolunga il Tempo della Licenza"
                          style={{ background: '#1c1917', border: '1px solid #44403c', color: '#f59e0b', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          ⏱ Tempo
                        </button>

                        {/* Sospendi / Riattiva */}
                        <button
                          onClick={() => handleToggleSuspend(t)}
                          title={t.stato === 'attivo' ? 'Sospendi Accesso Studio' : 'Riattiva Accesso Studio'}
                          style={{
                            background: t.stato === 'attivo' ? '#27272a' : '#064e3b',
                            border: `1px solid ${t.stato === 'attivo' ? '#52525b' : '#10b981'}`,
                            color: t.stato === 'attivo' ? '#e4e4e7' : '#6ee7b7',
                            padding: '5px 10px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {t.stato === 'attivo' ? '⏸ Sospendi' : '▶️ Riattiva'}
                        </button>

                        {/* Elimina Tenant */}
                        <button
                          onClick={() => setDeleteModalTenant(t)}
                          title="Elimina Definitivamente il Tenant"
                          style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🔑 MODALE CREDENZIALI & LINK DI ACCESSO NUOVO GESTORE */}
      {credentialsModalTenant && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 50px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🔑 Link di Accesso & Credenziali Gestore Studio</span>
              </div>
              <button onClick={() => { setCredentialsModalTenant(null); setPasswordEmessa(null); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Studio Professionale:</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{credentialsModalTenant.ragioneSociale}</div>
            </div>

            {/* Dettaglio Credenziali */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>🔗 LINK DI ACCESSO PIATTAFORMA:</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <code style={{ fontSize: 12, color: 'var(--indigo-l)' }}>{window.location.origin}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin);
                      alert('✓ Link di accesso copiato negli appunti!');
                    }}
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                  >
                    📋 Copia Link
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>👤 EMAIL GESTORE (LEAD SENIOR ADVISOR):</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{credentialsModalTenant.leadAdvisorEmail}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(credentialsModalTenant.leadAdvisorEmail);
                      alert('✓ Email copiata!');
                    }}
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                  >
                    📋 Copia Email
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>🔒 PASSWORD DI PRIMO ACCESSO:</div>
                {passwordEmessa ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <code style={{ fontSize: 13, fontWeight: 800, color: '#34d399', letterSpacing: '1px' }}>{passwordEmessa}</code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(passwordEmessa);
                          alert('✓ Password copiata!');
                        }}
                        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                      >
                        📋 Copia Password
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 6 }}>
                      ⚠️ Visibile solo ora: il database ne conserva soltanto l'hash. Copiala prima di chiudere.
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Non leggibile: il database conserva solo l'hash scrypt della password. Per consegnarne una nuova al gestore, rigenerala.
                    </div>
                    <button
                      onClick={() => handleRigeneraPassword(credentialsModalTenant)}
                      disabled={rigenerandoPassword}
                      style={{ marginTop: 8, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                    >
                      {rigenerandoPassword ? '⏳ Generazione...' : '🔄 Rigenera Password di Accesso'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 10, padding: 12, fontSize: 11, color: '#a7f3d0' }}>
              ✓ Al primo accesso il gestore potrà personalizzare logo, anagrafica studio, matrice permessi RBAC e invitare i propri collaboratori da <strong>Impostazioni Studio (/settings)</strong>.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => {
                  if (!passwordEmessa) {
                    alert('ℹ️ Rigenera prima la password: non è leggibile dal database.');
                    return;
                  }
                  const summary = `Gentile ${credentialsModalTenant.leadAdvisorNome || 'Gestore'},\nÈ stato attivato il tuo Studio "${credentialsModalTenant.ragioneSociale}" su BluMan Advisory Platform.\n\nLink Accesso: ${window.location.origin}\nEmail: ${credentialsModalTenant.leadAdvisorEmail}\nPassword: ${passwordEmessa}\n\nScadenza Licenza: ${credentialsModalTenant.dataScadenza}`;
                  navigator.clipboard.writeText(summary);
                  alert('✓ Messaggio riepilogativo completo copiato negli appunti!');
                }}
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
              >
                📋 Copia Riepilogo per WhatsApp/Email
              </button>

              <button
                type="button"
                onClick={() => handleSendCredentialsEmail(credentialsModalTenant)}
                disabled={sendingInvite}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span>✉️</span> {sendingInvite ? 'Invio in Corso...' : 'Rigenera e Invia Credenziali al Gestore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⏱ MODALE GESTIONE TEMPO & SCADENZA LICENZA */}
      {durationModalTenant && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 50px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⏱ Imposta Tempo & Scadenza Abbonamento</span>
              </div>
              <button onClick={() => setDurationModalTenant(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{durationModalTenant.ragioneSociale}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Data Attivazione: <strong>{durationModalTenant.dataAttivazione}</strong> · Data Scadenza Attuale: <strong style={{ color: 'var(--indigo-l)' }}>{durationModalTenant.dataScadenza}</strong>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>PROLUNGA TEMPO RAPIDO (1-CLICK):</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleExtendDuration(durationModalTenant, 30)}
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
                >
                  +30 Giorni (Trial / Mese)
                </button>
                <button
                  type="button"
                  onClick={() => handleExtendDuration(durationModalTenant, 90)}
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
                >
                  +90 Giorni (Trimestre)
                </button>
                <button
                  type="button"
                  onClick={() => handleExtendDuration(durationModalTenant, 180)}
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}
                >
                  +180 Giorni (Semestre)
                </button>
                <button
                  type="button"
                  onClick={() => handleExtendDuration(durationModalTenant, 365)}
                  style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#c7d2fe', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'center' }}
                >
                  +365 Giorni (1 Anno)
                </button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>OPPURE IMPOSTA DATA SCADENZA PRECISA:</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="date"
                  value={customExpiryInput}
                  onChange={e => setCustomExpiryInput(e.target.value)}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}
                />
                <button
                  type="button"
                  onClick={() => handleSetCustomExpiry(durationModalTenant)}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Salva Data
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setDurationModalTenant(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑 MODALE CONFERMA ELIMINAZIONE TENANT */}
      {deleteModalTenant && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid #7f1d1d', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#f87171', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️ Conferma Eliminazione Tenant Studio</span>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6 }}>
              Sei sicuro di voler eliminare definitivamente lo Studio <strong>"{deleteModalTenant.ragioneSociale}"</strong>?
              <div style={{ marginTop: 8, color: '#fca5a5', fontSize: 11.5, background: '#450a0a', padding: 10, borderRadius: 8, border: '1px solid #7f1d1d' }}>
                Questa azione revocherà tutte le licenze staff, bloccherà l'accesso al gestore e disattiverà il tenant dal database isolato.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setDeleteModalTenant(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTenant(deleteModalTenant)}
                style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                ✓ Elimina Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🏢 MODAL REGISTRAZIONE NUOVO TENANT */}
      {createModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleCreateTenant} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>+ Registra Nuovo Studio Professionale (Tenant)</span>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ragione Sociale Studio *</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} required placeholder="Es. Valoria Advisory Group" style={{ width: '100%', fontSize: 13 }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Giurisdizione / Paese *</label>
                <select value={formGiurisdizione} onChange={e => setFormGiurisdizione(e.target.value)} style={{ padding: 8, fontSize: 12, width: '100%' }}>
                  <option value="Italia">Italia</option>
                  <option value="Malta (UE)">Malta (UE)</option>
                  <option value="Svizzera">Svizzera</option>
                  <option value="Lussemburgo">Lussemburgo</option>
                  <option value="Regno Unito">Regno Unito</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / Tax ID</label>
                <input type="text" value={formPiva} onChange={e => setFormPiva(e.target.value)} placeholder="IT01234567890" style={{ width: '100%', fontSize: 12 }} />
              </div>
            </div>

            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--indigo-l)', textTransform: 'uppercase', marginBottom: 8 }}>
                👤 Dati Gestore Incaricato (Lead Senior Advisor)
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome e Cognome Gestore *</label>
                  <input type="text" value={formAdvisorNome} onChange={e => setFormAdvisorNome(e.target.value)} required placeholder="Es. Mario Rossi" style={{ width: '100%', fontSize: 12 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email di Accesso Gestore *</label>
                  <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required placeholder="mario.rossi@valoria.advisory" style={{ width: '100%', fontSize: 12 }} />
                </div>
              </div>

              {/*
                §23 — il campo "Password Iniziale per il Gestore" è stato rimosso. Era un
                `type="text"` con una password di default precompilata: viaggiava dal
                browser al server e finiva in chiaro nella colonna
                `tenant.lead_advisor_password`. Ora la genera il server alla creazione e la
                restituisce una volta sola, nel modale che si apre subito dopo.
              */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 10.5, color: 'var(--muted)' }}>
                🔒 La password di primo accesso viene generata dal server alla creazione e mostrata una volta sola nel riquadro successivo.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Piano Contratto *</label>
                <select value={formPiano} onChange={e => setFormPiano(e.target.value as any)} style={{ padding: 8, fontSize: 12, width: '100%' }}>
                  <option value="enterprise">🏢 Enterprise (Utenti illimitati)</option>
                  <option value="pro">⭐ Professional (Fino a 10 utenti)</option>
                  <option value="trial">⏳ Trial 30 giorni</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Durata Iniziale Licenza *</label>
                <select value={formDurataMesi} onChange={e => setFormDurataMesi(Number(e.target.value))} style={{ padding: 8, fontSize: 12, width: '100%' }}>
                  <option value={1}>1 Mese (Trial 30 gg)</option>
                  <option value={3}>3 Mesi (Trimestrale)</option>
                  <option value={6}>6 Mesi (Semestrale)</option>
                  <option value={12}>12 Mesi (1 Anno - Standard)</option>
                  <option value={24}>24 Mesi (2 Anni)</option>
                </select>
              </div>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il nuovo tenant verrà istanziato sul DB PostgreSQL con isolamento Row-Level Security (RLS). Alla creazione potrai copiare o inviare via email le credenziali al gestore.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setCreateModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Crea Tenant & Genera Credenziali</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
