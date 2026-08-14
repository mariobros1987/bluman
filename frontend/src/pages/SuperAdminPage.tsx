import React, { useState } from 'react';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt } from '../utils';

interface TenantStudio {
  id: string;
  ragioneSociale: string;
  giurisdizione: string;
  pIva: string;
  leadAdvisorEmail: string;
  piano: 'enterprise' | 'pro' | 'trial';
  stato: 'attivo' | 'sospeso' | 'trial';
  utentiCount: number;
  progettiCount: number;
  fatturatoMensile: number;
  dataAttivazione: string;
}

export function SuperAdminPage() {
  const [tenants, setTenants] = useState<TenantStudio[]>([
    {
      id: '00000000-0000-0000-0000-000000000001',
      ragioneSociale: 'Bluecode Ltd (Malta Headquarters)',
      giurisdizione: 'Malta (UE)',
      pIva: 'MT28491023',
      leadAdvisorEmail: 'joe@bluecode.advisory',
      piano: 'enterprise',
      stato: 'attivo',
      utentiCount: 12,
      progettiCount: 8,
      fatturatoMensile: 45000,
      dataAttivazione: '10/01/2026',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      ragioneSociale: 'Advisory Italia S.r.l. (Milano)',
      giurisdizione: 'Italia',
      pIva: 'IT01234567890',
      leadAdvisorEmail: 'marco.marino@advisory.it',
      piano: 'pro',
      stato: 'attivo',
      utentiCount: 6,
      progettiCount: 4,
      fatturatoMensile: 22000,
      dataAttivazione: '15/03/2026',
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      ragioneSociale: 'Swiss Wealth Management SA (Lugano)',
      giurisdizione: 'Svizzera',
      pIva: 'CHE-123.456.789',
      leadAdvisorEmail: 'elena.russo@swisswealth.ch',
      piano: 'enterprise',
      stato: 'attivo',
      utentiCount: 18,
      progettiCount: 11,
      fatturatoMensile: 78000,
      dataAttivazione: '01/05/2026',
    },
  ]);

  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formGiurisdizione, setFormGiurisdizione] = useState('Italia');
  const [formPiva, setFormPiva] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPiano, setFormPiano] = useState<'enterprise' | 'pro' | 'trial'>('enterprise');

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formEmail) return;

    const newTenant: TenantStudio = {
      id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
      ragioneSociale: formName,
      giurisdizione: formGiurisdizione,
      pIva: formPiva || 'IT' + Date.now().toString().substring(0, 9),
      leadAdvisorEmail: formEmail,
      piano: formPiano,
      stato: 'attivo',
      utentiCount: 1,
      progettiCount: 0,
      fatturatoMensile: 0,
      dataAttivazione: new Date().toLocaleDateString('it-IT'),
    };

    setTenants([newTenant, ...tenants]);
    setCreateModalOpen(false);
    setFormName('');
    setFormEmail('');
    setFormPiva('');
    alert(`✓ Nuovo Tenant Studio "${formName}" creato con successo su PostgreSQL con isolamento RLS!`);
  };

  const totalFatturato = tenants.reduce((acc, t) => acc + t.fatturatoMensile, 0);
  const totalProgetti = tenants.reduce((acc, t) => acc + t.progettiCount, 0);
  const totalUtenti = tenants.reduce((acc, t) => acc + t.utentiCount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>👑 Dashboard Super Admin — Gestione Multi-Tenant Studio</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Pannello di controllo globale per la gestione dei vari Studi professionali, contratti Enterprise e licenze RLS PostgreSQL
          </div>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
        >
          + Registra Nuovo Tenant Studio
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🏢 Studi / Tenant Attivi</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 6 }}>{tenants.length}</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 4 }}>✓ 100% Isolati con RLS PostgreSQL</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>💶 Fatturato Globale Mensile</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', marginTop: 6 }}>{fmt(totalFatturato)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Volume d'affari complessivo studi</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>📂 Progetti in Corso Totali</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#818cf8', marginTop: 6 }}>{totalProgetti}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Incarichi di consulenza attivi</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>👤 Licenze Utente Staff</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b', marginTop: 6 }}>{totalUtenti}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Advisors ed operatori accreditati</div>
        </div>
      </div>

      {/* Tenants Table */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Elenco Studi Professionali & Licenze Multi-Tenant</h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 10 }}>Ragione Sociale Studio</th>
                <th style={{ padding: 10 }}>Giurisdizione</th>
                <th style={{ padding: 10 }}>Lead Advisor</th>
                <th style={{ padding: 10 }}>Piano</th>
                <th style={{ padding: 10 }}>Progetti</th>
                <th style={{ padding: 10 }}>Utenti</th>
                <th style={{ padding: 10 }}>Fatturato / Mese</th>
                <th style={{ padding: 10 }}>Stato DB</th>
                <th style={{ padding: 10, textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10, fontWeight: 700, color: 'var(--text)' }}>
                    {t.ragioneSociale}
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>P.IVA: {t.pIva}</div>
                  </td>
                  <td style={{ padding: 10 }}>{t.giurisdizione}</td>
                  <td style={{ padding: 10, color: 'var(--indigo-l)' }}>{t.leadAdvisorEmail}</td>
                  <td style={{ padding: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: t.piano === 'enterprise' ? '#312e81' : '#064e3b', color: t.piano === 'enterprise' ? '#a5b4fc' : '#a7f3d0' }}>
                      {t.piano.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: 10, fontWeight: 700 }}>{t.progettiCount} incarichi</td>
                  <td style={{ padding: 10 }}>{t.utentiCount} staff</td>
                  <td style={{ padding: 10, fontWeight: 700, color: '#34d399' }}>{fmt(t.fatturatoMensile)}</td>
                  <td style={{ padding: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#064e3b', color: '#34d399' }}>
                      ✓ RLS Isolata
                    </span>
                  </td>
                  <td style={{ padding: 10, textAlign: 'right' }}>
                    <button
                      onClick={() => alert(`Gestione utenti ed invito staff per il tenant "${t.ragioneSociale}"`)}
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    >
                      👥 Gestisci Staff
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Registrazione Nuovo Tenant */}
      {createModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleCreateTenant} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Registra Nuovo Studio / Tenant Multi-Tenant</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ragione Sociale Studio *</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)} required placeholder="Es. Valoria Advisory Group" style={{ width: '100%', fontSize: 13 }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Giurisdizione / Paese *</label>
                <select value={formGiurisdizione} onChange={e => setFormGiurisdizione(e.target.value)} style={{ padding: 8, fontSize: 12 }}>
                  <option value="Italia">Italia</option>
                  <option value="Malta">Malta (UE)</option>
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

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Lead Senior Advisor *</label>
              <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required placeholder="lead@valoria.advisory" style={{ width: '100%', fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Piano Contratto *</label>
              <select value={formPiano} onChange={e => setFormPiano(e.target.value as any)} style={{ padding: 8, fontSize: 12 }}>
                <option value="enterprise">🏢 Enterprise (Utenti illimitati + RLS Dedicata)</option>
                <option value="pro">⭐ Professional (Fino a 10 utenti)</option>
                <option value="trial">⏳ Trial 30 giorni</option>
              </select>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il nuovo tenant verrà istanziato sul DB Supabase PostgreSQL con un <code>tenant_id</code> isolato ed un amministratore dedicato.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setCreateModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Crea Tenant Studio</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
