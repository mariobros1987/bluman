import React, { useState, useEffect } from 'react';
import { fetchClienti, creaClienteApi, resetPasswordClienteApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Cliente } from '../types';
import styles from './ClientsPage.module.css';
import { AnagraficaErpModal } from '../components/clients/AnagraficaErpModal';
import { MagicLinkExplainModal } from '../components/clients/MagicLinkExplainModal';
import { CredentialsExplainModal } from '../components/clients/CredentialsExplainModal';

import { useSearchParams } from 'react-router-dom';

export function ClientsPage() {
  const [searchParams] = useSearchParams();
  const targetClientQuery = searchParams.get('client') || '';

  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(targetClientQuery);
  const [filterType, setFilterType] = useState<'all' | 'individual' | 'company'>('all');
  const [editClientModal, setEditClientModal] = useState<Cliente | null>(null);
  const [, setEditClientName] = useState('');
  const [, setEditClientType] = useState<'individual' | 'company'>('company');

  const openEditModal = (c: Cliente) => {
    setEditClientModal(c);
    setEditClientName(c.nome);
    setEditClientType(c.tipo);
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [magicLinkModal, setMagicLinkModal] = useState<Cliente | null>(null);
  const [credentialsModal, setCredentialsModal] = useState<{
    cliente: Cliente;
    passwordChiaro: string;
    email: string;
    emailInviata: boolean;
    erroreInvioEmail?: string;
  } | null>(null);
  const [generatingCredentials, setGeneratingCredentials] = useState<string | null>(null);

  const handleGenerateCredentials = async (c: Cliente) => {
    setGeneratingCredentials(c.id);
    try {
      const res = await resetPasswordClienteApi(c.id);
      if (res && res.ok) {
        setCredentialsModal({
          cliente: c,
          passwordChiaro: res.passwordChiaro,
          email: res.email || (c as any).email || '',
          emailInviata: res.emailInviata,
          erroreInvioEmail: res.erroreInvioEmail,
        });
        setClienti(prev => prev.map(item => item.id === c.id ? { ...item, hasPassword: true } : item));
      }
    } catch (err: any) {
      alert(`Errore generazione credenziali: ${err.message}`);
    } finally {
      setGeneratingCredentials(null);
    }
  };

  // Form state
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'individual' | 'company'>('individual');
  const [submitting, setSubmitting] = useState(false);

  const loadClienti = async () => {
    setLoading(true);
    const currentTenantId = getCurrentTenantId();
    let apiList: Cliente[] = [];
    try {
      const res = await fetchClienti();
      if (res && Array.isArray(res)) {
        apiList = res.filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);
      }
    } catch (err) {
      console.warn('Errore fetch clienti DB:', err);
    }

    // Estrai clienti dai progetti del tenant
    const projStorageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);
    const localProjStr = localStorage.getItem(projStorageKey);
    const localProjs: any[] = localProjStr ? JSON.parse(localProjStr) : [];
    const extractedClients: Cliente[] = [];

    localProjs.forEach((p: any) => {
      if (p.cl) {
        extractedClients.push({
          id: `cl-proj-${p.id}`,
          nome: p.cl,
          tipo: p.ct || 'company',
          // Campi vuoti quando il progetto non li porta, non valori inventati. Qui c'erano
          // una P.IVA, un codice fiscale, una sede a Milano, un codice SDI, un telefono e
          // un'email (`client@holdingbeta.advisory`) scritti nel codice: comparivano
          // nell'anagrafica di ogni cliente ricavato da un progetto, e quell'email finiva
          // precompilata nella finestra del Magic Link — cioè il link di accesso al portale
          // partiva verso una casella che non esiste.
          piva: p.piva || '',
          codiceFiscale: p.codFisc || '',
          sedeLegale: p.sede || '',
          codiceSdi: p.codiceSdi || '',
          email: p.email || '',
          telefono: p.telefono || '',
          isAttivo: true,
        });
      }
    });

    // Includi clienti demo SOLO se è il tenant demo Bluecode Ltd
    const defaultClients: Cliente[] = currentTenantId === BLUECODE_TENANT_ID ? getTenantSeedData(currentTenantId).clients : [];

    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    const localClientsStr = localStorage.getItem(clientStorageKey);
    const localClients: Cliente[] = localClientsStr ? JSON.parse(localClientsStr) : [];

    const mergedMap = new Map();
    // Inserisci prima i default e i progetti estratti, poi apiList (DB) e localClients SOVRASCRIVONO tutto garantendo persistenza totale!
    [...defaultClients, ...extractedClients, ...apiList, ...localClients].forEach(c => {
      if (c && c.nome) {
        const key = c.nome.toLowerCase().trim();
        const existing = mergedMap.get(key) || {};
        mergedMap.set(key, { ...existing, ...c });
      }
    });

    const finalClients = Array.from(mergedMap.values());
    setClienti(finalClients);

    if (targetClientQuery) {
      const found = finalClients.find(c => c.nome.toLowerCase().includes(targetClientQuery.toLowerCase()) || c.id.includes(targetClientQuery));
      if (found) {
        setMagicLinkModal(found);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadClienti();
  }, [targetClientQuery]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setSubmitting(true);
    const newClientObj: Cliente = {
      id: `cl-${Date.now()}`,
      nome: nome.trim(),
      tipo,
      piva: '',
      codiceFiscale: '',
      sedeLegale: '',
      // 'SUBM70N' era il codice destinatario SDI di un'altra azienda, assegnato a ogni nuovo
      // cliente creato: una fattura elettronica indirizzata lì sarebbe finita a loro.
      codiceSdi: '',
      email: '',
      telefono: '',
      isAttivo: true,
    };
    try {
      const res = await creaClienteApi({ nome: nome.trim(), tipo });
      if (res && res.id) newClientObj.id = res.id;
    } catch (err) {
      console.error('API create fallback:', err);
    }

    const currentTenantId = getCurrentTenantId();
    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    const savedStr = localStorage.getItem(clientStorageKey);
    const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
    localStorage.setItem(clientStorageKey, JSON.stringify([newClientObj, ...savedArr]));

    setNome('');
    setModalOpen(false);
    setSubmitting(false);
    loadClienti();
  };

  const filtered = clienti.filter(c => {
    const matchSearch = c.nome.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === 'all' || c.tipo === filterType;
    return matchSearch && matchType;
  });

  const totalCompanies = clienti.filter(c => c.tipo === 'company').length;
  const totalIndividuals = clienti.filter(c => c.tipo === 'individual').length;

  return (
    <div className={styles.wrapper}>
      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: '#1a1f3d' }}>👥</div>
          <div className={styles.kpiValue}>{clienti.length}</div>
          <div className={styles.kpiLabel}>Totale Clienti in Anagrafica</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: '#200f40' }}>🏢</div>
          <div className={styles.kpiValue}>{totalCompanies}</div>
          <div className={styles.kpiLabel}>Società & Entities</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: '#0d2d22' }}>👤</div>
          <div className={styles.kpiValue}>{totalIndividuals}</div>
          <div className={styles.kpiLabel}>Persone Fisiche / UBO</div>
        </div>
      </div>

      {/* Toolbar & Search */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <span>🔍</span>
          <input
            type="text"
            placeholder="Cerca cliente per nome o ragione sociale..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className={styles.filterGroup}>
            <button
              className={`${styles.filterBtn} ${filterType === 'all' ? styles.filterBtnActive : ''}`}
              onClick={() => setFilterType('all')}
            >
              Tutti
            </button>
            <button
              className={`${styles.filterBtn} ${filterType === 'individual' ? styles.filterBtnActive : ''}`}
              onClick={() => setFilterType('individual')}
            >
              👤 Persone Fisiche
            </button>
            <button
              className={`${styles.filterBtn} ${filterType === 'company' ? styles.filterBtnActive : ''}`}
              onClick={() => setFilterType('company')}
            >
              🏢 Società
            </button>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            + Nuovo Cliente
          </button>
        </div>
      </div>

      {/* Client Cards Grid */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Caricamento anagrafica clienti...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div>Nessun cliente trovato con i filtri correnti ({clienti.length} totali in anagrafica).</div>
          <button
            onClick={() => { setSearch(''); setFilterType('all'); }}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,.3)' }}
          >
            ✖ Azzera Filtro Ricerca
          </button>
        </div>
      ) : (
        <div className={styles.clientGrid}>
          {filtered.map(c => (
            <div
              key={c.id}
              className={styles.clientCard}
              onClick={() => openEditModal(c)}
              style={{ cursor: 'pointer', transition: 'all .2s ease' }}
            >
              <div>
                <div className={styles.clientHeader}>
                  <div className={styles.avatarBox} style={{ background: c.tipo === 'company' ? '#200f40' : '#1a1f3d', color: c.tipo === 'company' ? '#a78bfa' : '#818cf8' }}>
                    {c.tipo === 'company' ? '🏢' : '👤'}
                  </div>
                  <div>
                    <div className={styles.clientName} style={{ color: 'var(--indigo-l)' }}>{c.nome}</div>
                    <span className={styles.clientTypeBadge} style={{ background: c.tipo === 'company' ? '#200f40' : '#1a1f3d', color: c.tipo === 'company' ? '#a78bfa' : '#818cf8' }}>
                      {c.tipo === 'company' ? 'Società / Entity' : 'Persona Fisica'}
                    </span>
                  </div>
                </div>

                <div className={styles.clientMeta}>
                  <div className={styles.metaRow}>
                    <span>ID Cliente:</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--hint)' }}>{c.id.substring(0, 13)}...</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>Accesso Portale:</span>
                    <span style={{ color: (c as any).hasPassword ? '#34d399' : 'var(--amber)', fontWeight: 600, fontSize: 11 }}>
                      {(c as any).hasPassword ? '🟢 Password Attiva' : '⚪ Da Assegnare'}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.clientActions} onClick={e => e.stopPropagation()}>
                <button className={styles.btnAction} onClick={() => openEditModal(c)} style={{ background: '#1e1b4b', borderColor: '#4338ca', color: '#c7d2fe', fontWeight: 700 }} title="Apri Fascicolo Anagrafica & Commesse">
                  📂 Apri
                </button>
                <button
                  className={styles.btnAction}
                  onClick={() => handleGenerateCredentials(c)}
                  disabled={generatingCredentials === c.id}
                  style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  title="Genera username e password per il portale cliente"
                >
                  {generatingCredentials === c.id ? '⏳ Generazione...' : '🔑 Credenziali Portale'}
                </button>
                <button className={styles.btnAction} onClick={() => setMagicLinkModal(c)}>
                  🔗 Magic Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Nuovo Cliente */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleCreate} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Nuovo Cliente Anagrafica</div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale *</label>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Giuseppe Rossi / Acme S.r.l." required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo Cliente *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['individual', 'company'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setTipo(t)} style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${tipo === t ? 'var(--indigo)' : 'var(--border)'}`, background: tipo === t ? '#1a1f3d' : 'var(--card)', color: tipo === t ? 'var(--indigo-l)' : 'var(--muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    {t === 'individual' ? '👤 Persona fisica' : '🏢 Società'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{submitting ? 'Salvataggio...' : '✓ Salva Cliente'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Anagrafica Completa Cliente ERP (§Gestionale) */}
      {editClientModal && (
        <AnagraficaErpModal
          client={editClientModal}
          onClose={() => setEditClientModal(null)}
          onSaved={() => {
            setEditClientModal(null);
            loadClienti();
          }}
        />
      )}

      {/* Modal Magic Link & Accettazione Cliente */}
      {magicLinkModal && (
        <MagicLinkExplainModal client={magicLinkModal} onClose={() => setMagicLinkModal(null)} />
      )}

      {/* Modal Credenziali Portale Cliente (Email + Password) */}
      {credentialsModal && (
        <CredentialsExplainModal
          data={credentialsModal}
          onClose={() => setCredentialsModal(null)}
        />
      )}
    </div>
  );
}

