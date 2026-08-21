import React, { useState, useEffect } from 'react';
import { fetchClienti, creaClienteApi, aggiornaClienteApi, generaMagicLinkApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Cliente } from '../types';
import styles from './ClientsPage.module.css';

import { useSearchParams } from 'react-router-dom';

export function ClientsPage() {
  const [searchParams] = useSearchParams();
  const targetClientQuery = searchParams.get('client') || '';

  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(targetClientQuery);
  const [filterType, setFilterType] = useState<'all' | 'individual' | 'company'>('all');
  const [editClientModal, setEditClientModal] = useState<Cliente | null>(null);
  const [editClientName, setEditClientName] = useState('');
  const [editClientType, setEditClientType] = useState<'individual' | 'company'>('company');

  const openEditModal = (c: Cliente) => {
    setEditClientModal(c);
    setEditClientName(c.nome);
    setEditClientType(c.tipo);
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [magicLinkModal, setMagicLinkModal] = useState<Cliente | null>(null);

  // Form state
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'individual' | 'company'>('individual');
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);

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
          piva: p.piva || 'IT09876543210',
          codiceFiscale: p.codFisc || 'BLUCD90A01H501X',
          sedeLegale: p.sede || 'Via Montenapoleone 8, Milano',
          codiceSdi: 'SUBM70N',
          email: 'client@holdingbeta.advisory',
          telefono: '+39 02 889900',
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
      codiceSdi: 'SUBM70N',
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
            <div key={c.id} className={styles.clientCard}>
              <div>
                <div className={styles.clientHeader}>
                  <div className={styles.avatarBox} style={{ background: c.tipo === 'company' ? '#200f40' : '#1a1f3d', color: c.tipo === 'company' ? '#a78bfa' : '#818cf8' }}>
                    {c.tipo === 'company' ? '🏢' : '👤'}
                  </div>
                  <div>
                    <div className={styles.clientName}>{c.nome}</div>
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
                    <span>Stato Accesso:</span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>Passwordless (Magic Link)</span>
                  </div>
                </div>
              </div>

              <div className={styles.clientActions}>
                <button className={styles.btnAction} onClick={() => openEditModal(c)} title="Modifica Anagrafica (Admin)">
                  ✏️ Modifica
                </button>
                <button className={styles.btnAction} onClick={() => setMagicLinkModal(c)}>
                  🔑 Genera Magic Link
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
    </div>
  );
}

// ─── Componente Anagrafica Completa Cliente ERP ────────────────────
function AnagraficaErpModal({ client, onClose, onSaved }: { client: Cliente; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'generale' | 'sede' | 'sdi' | 'compliance'>('generale');
  
  const refJson: any = client.referentiJson && typeof client.referentiJson === 'object' ? client.referentiJson : {};

  const [nome, setNome] = useState(client.nome || '');
  const [tipo, setTipo] = useState(client.tipo || 'company');
  const [piva, setPiva] = useState(client.piva || (client as any).partitaIva || refJson.piva || '');
  const [codFisc, setCodFisc] = useState(client.codiceFiscale || (client as any).codFisc || refJson.codiceFiscale || '');
  const [giurisdizione, setGiurisdizione] = useState(client.giurisdizione || refJson.giurisdizione || 'Italia');
  const [capitale, setCapitale] = useState<number>((client as any).capitale || refJson.capitale || 10000);
  const [regImprese, setRegImprese] = useState((client as any).regImprese || refJson.regImprese || '');

  // Tab 2: Sede & Contatti
  const [indirizzo, setIndirizzo] = useState((client as any).indirizzo || refJson.indirizzo || client.sedeLegale || '');
  const [citta, setCitta] = useState((client as any).citta || refJson.citta || '');
  const [cap, setCap] = useState((client as any).cap || refJson.cap || '');
  const [nazione, setNazione] = useState((client as any).nazione || refJson.nazione || 'Italia');
  const [email, setEmail] = useState(client.email || refJson.email || '');
  const [pec, setPec] = useState((client as any).pec || refJson.pec || '');
  const [telefono, setTelefono] = useState(client.telefono || refJson.telefono || '');
  const [cellulare, setCellulare] = useState((client as any).cellulare || refJson.cellulare || refJson.whatsapp || client.telefono || '');
  const [telegram, setTelegram] = useState((client as any).telegram || refJson.telegram || '');
  const [signal, setSignal] = useState((client as any).signal || refJson.signal || '');
  const [referenteNome, setReferenteNome] = useState((client as any).referenteNome || refJson.referenteNome || refJson.referente || '');

  // Tab 3: SDI & Fatturazione
  const [sdiCode, setSdiCode] = useState(client.sdiCode || (client as any).codiceSdi || refJson.sdiCode || '0000000');
  const [regimeFiscale, setRegimeFiscale] = useState((client as any).regimeFiscale || refJson.regimeFiscale || 'RF01 - Ordinario');
  const [iban, setIban] = useState(client.iban || refJson.iban || '');

  // Tab 4: Compliance & KYC
  const [rischioAml, setRischioAml] = useState<'basso' | 'medio' | 'alto'>(client.rischioAml || refJson.rischioAml || 'basso');
  const [ubo, setUbo] = useState(client.ubo || refJson.ubo || '');
  const [fontePatrimonio, setFontePatrimonio] = useState(client.fontePatrimonio || refJson.fontePatrimonio || '');
  const [dataKyc, setDataKyc] = useState(client.dataKyc || refJson.dataKyc || '');

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const referentiObj = {
      capitale,
      regImprese,
      indirizzo,
      citta,
      cap,
      nazione,
      pec,
      telefono,
      cellulare,
      whatsapp: cellulare,
      telegram,
      signal,
      referenteNome,
      referente: referenteNome,
      email,
      regimeFiscale,
      sdiCode,
      codiceSdi: sdiCode,
      iban,
      rischioAml,
      ubo,
      fontePatrimonio,
      dataKyc,
    };

    const clientPayload: Record<string, any> = {
      id: client.id,
      nome,
      tipo,
      piva,
      codiceFiscale: codFisc,
      codFisc,
      giurisdizione,
      sedeLegale: `${indirizzo}, ${citta} (${cap}) - ${nazione}`,
      sdiCode,
      codiceSdi: sdiCode,
      iban,
      rischioAml,
      ubo,
      fontePatrimonio,
      dataKyc,
      email,
      pec,
      telefono,
      cellulare,
      telegram,
      signal,
      referenteNome,
      capitale,
      regImprese,
      indirizzo,
      citta,
      cap,
      nazione,
      regimeFiscale,
      referentiJson: referentiObj,
    };

    // 1. Aggiorna oggetto in memoria corrente
    Object.assign(client, clientPayload);

    // 2. Persisti in localStorage bluman_custom_clients isolato per tenant
    const currentTenantId = getCurrentTenantId();
    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    const savedStr = localStorage.getItem(clientStorageKey);
    const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [
      clientPayload,
      ...savedArr.filter((c: any) => c.id !== client.id && c.nome?.toLowerCase() !== client.nome?.toLowerCase()),
    ];
    localStorage.setItem(clientStorageKey, JSON.stringify(updatedArr));

    // 3. Persisti in PostgreSQL tramite API Fastify
    try {
      if (client.id && !client.id.startsWith('cl-0') && !client.id.startsWith('cl-proj-')) {
        await aggiornaClienteApi(client.id, clientPayload);
      } else {
        const nuovo = await creaClienteApi(clientPayload);
        if (nuovo && nuovo.id) {
          client.id = nuovo.id;
          clientPayload.id = nuovo.id;
          localStorage.setItem(clientStorageKey, JSON.stringify([
            clientPayload,
            ...savedArr.filter((c: any) => c.nome?.toLowerCase() !== client.nome?.toLowerCase()),
          ]));
        }
      }
    } catch (apiErr) {
      console.warn('Salvataggio API DB cliente fallback:', apiErr);
    } finally {
      setSaving(false);
      onSaved();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
        {/* Header Modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)' }}>
              📑 Anagrafica Master Cliente ERP (§Gestionale)
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Dati anagrafici, fiscali, recapiti multicanale (WhatsApp, Telegram, Signal) e fascicolo KYC/AML
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Sub Navigation Tabs */}
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          <button type="button" onClick={() => setTab('generale')} style={tabBtn(tab === 'generale')}>📋 1. Dati Legali</button>
          <button type="button" onClick={() => setTab('sede')} style={tabBtn(tab === 'sede')}>📍 2. Sede & Contatti</button>
          <button type="button" onClick={() => setTab('sdi')} style={tabBtn(tab === 'sdi')}>🧾 3. Fatturazione SDI</button>
          <button type="button" onClick={() => setTab('compliance')} style={tabBtn(tab === 'compliance')}>🛡 4. Compliance KYC</button>
        </div>

        {/* TAB 1: Dati Legali */}
        {tab === 'generale' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale *</label>
                <input value={nome} onChange={e => setNome(e.target.value)} required style={{ fontSize: 13, fontWeight: 600 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Soggetto *</label>
                <select value={tipo} onChange={e => setTipo(e.target.value as any)}>
                  <option value="company">🏢 Società / Entità (Company)</option>
                  <option value="individual">👤 Persona Fisica (Individual)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / VAT Number *</label>
                <input value={piva} onChange={e => setPiva(e.target.value)} placeholder="IT01234567890" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Fiscale *</label>
                <input value={codFisc} onChange={e => setCodFisc(e.target.value)} placeholder="Codice Fiscale..." />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Giurisdizione Costituzione *</label>
                <input value={giurisdizione} onChange={e => setGiurisdizione(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Registro Imprese / REA *</label>
                <input value={regImprese} onChange={e => setRegImprese(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Capitale Sociale (€)</label>
                <input type="number" value={capitale} onChange={e => setCapitale(Number(e.target.value))} />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Sede & Contatti */}
        {tab === 'sede' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Indirizzo Sede Legale / Domicilio *</label>
              <input value={indirizzo} onChange={e => setIndirizzo(e.target.value)} required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Città *</label>
                <input value={citta} onChange={e => setCitta(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CAP *</label>
                <input value={cap} onChange={e => setCap(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nazione *</label>
                <input value={nazione} onChange={e => setNazione(e.target.value)} required />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Professionale *</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email PEC Ufficiale *</label>
                <input type="email" value={pec} onChange={e => setPec(e.target.value)} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Telefono Centralino / Ufficio</label>
                <input value={telefono} onChange={e => setTelefono(e.target.value)} />
              </div>
            </div>

            {/* Sezione Canali Diretti Omnichannel */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>💬 Recapiti Diretti Comunicazioni (WhatsApp, Telegram, Signal)</span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🟢 Cellulare / WhatsApp Diretto *</label>
                  <input value={cellulare} onChange={e => setCellulare(e.target.value)} placeholder="+39 333 5936278" required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>✈️ Account Telegram (Username / Link)</label>
                  <input value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="@RobertoRossi" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔒 Numero Signal Cifrato</label>
                  <input value={signal} onChange={e => setSignal(e.target.value)} placeholder="+39 333 5936278" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>👤 Nome Referente / Contatto Diretto</label>
                  <input value={referenteNome} onChange={e => setReferenteNome(e.target.value)} placeholder="es. Ing. Roberto Rossi (CEO)" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SDI & Fatturazione */}
        {tab === 'sdi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Destinatario SDI (7 caratteri) *</label>
                <input value={sdiCode} onChange={e => setSdiCode(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }} required />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Regime Fiscale *</label>
                <input value={regimeFiscale} onChange={e => setRegimeFiscale(e.target.value)} required />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN Accrediti / Addebiti del Cliente *</label>
              <input value={iban} onChange={e => setIban(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12.5 }} required />
            </div>

            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 10, padding: 12, fontSize: 11, color: '#34d399' }}>
              ✓ Collegato al nodo di trasmissione <strong>Comped Servizi FPA (SDI)</strong>.
            </div>
          </div>
        )}

        {/* TAB 4: Compliance & KYC */}
        {tab === 'compliance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Classe di Rischio Antiriciclaggio (AML) *</label>
                <select value={rischioAml} onChange={e => setRischioAml(e.target.value as any)}>
                  <option value="basso">🟢 Basso Rischio</option>
                  <option value="medio">🟡 Medio Rischio</option>
                  <option value="alto">🔴 Alto Rischio / Persona Politicamente Esposta (PEP)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Ultimo Rinnovo KYC *</label>
                <input value={dataKyc} onChange={e => setDataKyc(e.target.value)} required />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolare Effettivo (UBO) & Struttura di Controllo *</label>
              <input value={ubo} onChange={e => setUbo(e.target.value)} required />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Provenienza dei Fondi / Origine Patrimonio *</label>
              <input value={fontePatrimonio} onChange={e => setFontePatrimonio(e.target.value)} required />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={saving} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 16px rgba(99,102,241,.4)' }}>
            {saving ? 'Salvataggio...' : '✓ Salva Anagrafica ERP Cliente'}
          </button>
        </div>
      </form>
    </div>
  );
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a1f3d' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--indigo-l)' : '2px solid transparent',
  color: active ? 'var(--indigo-l)' : 'var(--muted)',
  fontSize: 11.5,
  fontWeight: 600,
  padding: '6px 12px',
  cursor: 'pointer',
});

function MagicLinkExplainModal({ client, onClose }: { client: Cliente; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [generando, setGenerando] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Il link non esiste finché il server non lo ha emesso. Prima questa riga era
  // `client_${client.id.substring(0, 8)}`, costruita qui nel browser: un token che nessuno
  // aveva registrato e che quindi non era verificabile da nessuna parte.
  const [risultato, setRisultato] = useState<{ magicUrl: string; sent: boolean; scadenza: string } | null>(null);
  const magicUrl = risultato?.magicUrl ?? '';

  const genera = async () => {
    setErrore(null);
    setGenerando(true);
    try {
      const res = await generaMagicLinkApi(client.id, email.trim());
      setRisultato({ magicUrl: res.magicUrl, sent: res.sent, scadenza: res.scadenza });
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Errore generazione Magic Link');
    } finally {
      setGenerando(false);
    }
  };

  const copyToClipboard = () => {
    if (!magicUrl) return;
    navigator.clipboard.writeText(magicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Accesso Cliente Passwordless & Accettazione</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {client.nome} ({client.tipo === 'company' ? 'Società' : 'Persona Fisica'})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--card2)', border: 'none', width: 26, height: 26, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ background: '#1a1f3d', border: '1px solid #2d3260', borderRadius: 10, padding: 14, fontSize: 11.5, color: '#818cf8', lineHeight: 1.5 }}>
          ℹ️ <strong>Come avviene l'accettazione del cliente (§15, §23):</strong>
          <ul style={{ paddingLeft: 18, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Il cliente <strong>non usa password</strong>: accede tramite un <strong>Magic Link sicuro</strong> univoco.</li>
            <li>Aprendo il link, il cliente visualizza l'<strong>Engagement Letter</strong> con il dettaglio dei moduli scelti.</li>
            <li>Apposta la firma (o conferma OTP), il backend esegue l'<strong>istanziazione automatica atomica</strong> del progetto (passando lo stato a <em>in_progress</em>).</li>
          </ul>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email del cliente a cui inviare il link *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="cliente@esempio.it"
              disabled={generando}
              style={{ fontSize: 11.5 }}
            />
            <button
              onClick={genera}
              disabled={generando || !email.trim()}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: generando || !email.trim() ? 'not-allowed' : 'pointer', opacity: generando || !email.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >
              {generando ? 'Generazione...' : 'Genera e invia'}
            </button>
          </div>
        </div>

        {errore && (
          <div style={{ background: '#3d1a1f', border: '1px solid #602d32', borderRadius: 10, padding: 12, fontSize: 11.5, color: '#f87171' }}>
            ⚠️ {errore}
          </div>
        )}

        {risultato && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Link di accesso cliente generato{risultato.sent ? ' e inviato per email' : ' (invio email non riuscito: consegnalo a mano)'} — valido fino al{' '}
              {new Date(risultato.scadenza).toLocaleDateString('it-IT')}:
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={magicUrl} readOnly style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--indigo-l)' }} />
              <button
                onClick={copyToClipboard}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {copied ? '✓ Copiato!' : 'Copia Link'}
              </button>
            </div>
            {/* Il token in chiaro esiste solo in questa risposta e nell'email: in tabella c'è
                il suo SHA-256, quindi riaprendo il modale non si recupera più. */}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>
              Copialo ora se serve: il link non è più recuperabile dopo la chiusura di questa finestra.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
