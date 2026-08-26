import React, { useState, useEffect } from 'react';
import { fetchClienti, fetchProgetti, creaClienteApi, aggiornaClienteApi, generaMagicLinkApi, resetPasswordClienteApi, sendEmailDirectApi, sendWhatsAppDirectApi, proposteDatiStudioApi, confermaPropostaDatiApi, rifiutaPropostaDatiApi } from '../api/client';
import type { PropostaDatiFiscale } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import { fmt } from '../utils';
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

// ─── Componente Anagrafica Completa Cliente ERP ────────────────────
function AnagraficaErpModal({ client, onClose, onSaved }: { client: Cliente; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'generale' | 'progetti' | 'sede' | 'sdi' | 'compliance'>('generale');
  const [clientProjects, setClientProjects] = useState<any[]>([]);

  useEffect(() => {
    fetchProgetti().then(res => {
      if (res && Array.isArray(res)) {
        const matching = res.filter(p =>
          p.clienteId === client.id ||
          p.cliente?.id === client.id ||
          p.cliente?.nome?.toLowerCase() === client.nome?.toLowerCase() ||
          (client.email && p.cliente?.email?.toLowerCase() === client.email.toLowerCase())
        );
        setClientProjects(matching);
      }
    }).catch(err => console.warn('Errore recupero progetti cliente:', err));
  }, [client.id, client.nome, client.email]);

  // §2.3 — proposte di modifica inviate dal cliente dal portale: lo studio le conferma o le rifiuta.
  const [proposteInAttesa, setProposteInAttesa] = useState<PropostaDatiFiscale[]>([]);
  const [propostaInAzione, setPropostaInAzione] = useState<string | null>(null);
  const [rifiutoId, setRifiutoId] = useState<string | null>(null);
  const [notaRifiuto, setNotaRifiuto] = useState('');
  const [proposteMsg, setProposteMsg] = useState<string | null>(null);

  const ETICHETTE_CAMPI: Record<string, string> = {
    ragioneSociale: 'Ragione Sociale',
    piva: 'Partita IVA',
    codiceFiscale: 'Codice Fiscale',
    iban: 'IBAN',
    titolareEffettivo: 'Titolare Effettivo (UBO)',
    sedeLegale: 'Sede Legale',
    legaleRappresentante: 'Legale Rappresentante',
  };

  const caricaProposteInAttesa = async () => {
    try {
      const lista = await proposteDatiStudioApi({ clienteId: client.id, stato: 'in_attesa' });
      setProposteInAttesa(lista);
    } catch (err) {
      console.warn('Errore recupero proposte dati del cliente:', err);
    }
  };

  useEffect(() => { void caricaProposteInAttesa(); }, [client.id]);

  const confermaProposta = async (p: PropostaDatiFiscale) => {
    setPropostaInAzione(p.id);
    try {
      await confermaPropostaDatiApi(p.id);
      // Allinea gli input locali del modal al valore appena confermato in anagrafica.
      if (p.campo === 'ragioneSociale') setNome(p.valoreProposto);
      if (p.campo === 'piva') setPiva(p.valoreProposto);
      if (p.campo === 'codiceFiscale') setCodFisc(p.valoreProposto);
      if (p.campo === 'iban') setIban(p.valoreProposto);
      if (p.campo === 'titolareEffettivo') setUbo(p.valoreProposto);
      setProposteMsg(`✓ «${ETICHETTE_CAMPI[p.campo] ?? p.campo}» confermata: l'anagrafica è stata aggiornata.`);
      await caricaProposteInAttesa();
      onSaved();
    } catch (err: any) {
      setProposteMsg(err?.message || 'Errore durante la conferma della proposta.');
    } finally {
      setPropostaInAzione(null);
    }
  };

  const rifiutaProposta = async (p: PropostaDatiFiscale) => {
    setPropostaInAzione(p.id);
    try {
      await rifiutaPropostaDatiApi(p.id, notaRifiuto.trim() || undefined);
      setProposteMsg(`⛔ Proposta «${ETICHETTE_CAMPI[p.campo] ?? p.campo}» rifiutata.`);
      setRifiutoId(null);
      setNotaRifiuto('');
      await caricaProposteInAttesa();
    } catch (err: any) {
      setProposteMsg(err?.message || 'Errore durante il rifiuto della proposta.');
    } finally {
      setPropostaInAzione(null);
    }
  };

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

    // Stessa forma che chiede creaClienteApi (`nome` obbligatorio): il generico
    // Record<string, any> non dimostra il campo richiesto e il compilatore lo rifiutava.
    const clientPayload: { nome: string; tipo?: 'individual' | 'company'; [key: string]: any } = {
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
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setTab('generale')} style={tabBtn(tab === 'generale')}>
            📋 1. Dati Legali{proposteInAttesa.length > 0 ? ` (${proposteInAttesa.length} proposte)` : ''}
          </button>
          <button type="button" onClick={() => setTab('progetti')} style={tabBtn(tab === 'progetti')}>
            📁 2. Progetti & Commesse ({clientProjects.length})
          </button>
          <button type="button" onClick={() => setTab('sede')} style={tabBtn(tab === 'sede')}>📍 3. Sede & Contatti</button>
          <button type="button" onClick={() => setTab('sdi')} style={tabBtn(tab === 'sdi')}>🧾 4. Fatturazione SDI</button>
          <button type="button" onClick={() => setTab('compliance')} style={tabBtn(tab === 'compliance')}>🛡 5. Compliance KYC</button>
        </div>

        {/* TAB 1: Dati Legali */}
        {tab === 'generale' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* §2.3 — proposte di modifica inviate dal cliente dal portale */}
            {proposteInAttesa.length > 0 && (
              <div style={{ background: '#2b2410', border: '1px solid #8a6d1a', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fcd34d' }}>
                  📨 Proposte di modifica inviate dal cliente ({proposteInAttesa.length})
                </div>
                {proposteInAttesa.map((p) => (
                  <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{ETICHETTE_CAMPI[p.campo] ?? p.campo}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          Attuale: <b style={{ color: 'var(--text)' }}>{p.valoreAttuale || '—'}</b>
                          {'  →  '}
                          Proposto: <b style={{ color: '#fcd34d' }}>{p.valoreProposto}</b>
                        </div>
                        {p.notaCliente && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Nota del cliente: {p.notaCliente}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { void confermaProposta(p); }}
                          style={{ background: '#14532d', border: '1px solid #16a34a', color: '#bbf7d0', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          ✓ Conferma
                        </button>
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { setRifiutoId(rifiutoId === p.id ? null : p.id); setNotaRifiuto(''); }}
                          style={{ background: '#450a0a', border: '1px solid #b91c1c', color: '#fecaca', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          ⛔ Rifiuta
                        </button>
                      </div>
                    </div>
                    {rifiutoId === p.id && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={notaRifiuto}
                          onChange={(e) => setNotaRifiuto(e.target.value)}
                          placeholder="Motivo del rifiuto (visibile al cliente)…"
                          style={{ flex: 1, minWidth: 200 }}
                        />
                        <button
                          type="button"
                          disabled={propostaInAzione === p.id}
                          onClick={() => { void rifiutaProposta(p); }}
                          style={{ background: '#b91c1c', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: propostaInAzione === p.id ? 'default' : 'pointer' }}
                        >
                          {propostaInAzione === p.id ? 'Invio…' : 'Conferma rifiuto'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {proposteMsg && (
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text)' }}>
                {proposteMsg}
              </div>
            )}

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

        {/* TAB 2: Progetti & Commesse Attive del Cliente */}
        {tab === 'progetti' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                Fascicoli e Commesse Attive collegate a <strong>{client.nome}</strong>:
              </div>
              <a
                href="/projects"
                style={{
                  background: '#1e1b4b',
                  border: '1px solid #4338ca',
                  color: '#c7d2fe',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                ➕ Gestione Progetti ➔
              </a>
            </div>

            {clientProjects.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
                {clientProjects.map((p: any) => {
                  const perc = p.avanzamentoPercentuale || p.percentuale || (p.stato === 'completed' ? 100 : p.stato === 'in_progress' ? 65 : 25);
                  const isDone = p.stato === 'completed' || perc === 100;
                  return (
                    <div
                      key={p.id}
                      style={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15 }}>📁</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{p.nome}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {/* Regola 7: giurisdizione e valore si mostrano solo se il progetto li ha
                                davvero; i ripieghi 'Malta' e 28.500 € inventavano dati inesistenti. */}
                            Giurisdizione: <strong style={{ color: 'var(--indigo-l)' }}>{p.giurisdizionePrimaria?.nome || p.giurisdizione || 'n/d'}</strong> · Valore Commessa: <strong style={{ color: 'var(--text)' }}>{p.valoreTotale != null ? fmt(p.valoreTotale / 100) : (p.valore != null ? fmt(p.valore) : 'n/d')}</strong>
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: isDone ? '#0d2d22' : '#1e1b4b',
                            color: isDone ? '#34d399' : '#a5b4fc',
                            border: `1px solid ${isDone ? '#10b981' : '#4338ca'}`,
                          }}
                        >
                          {isDone ? '✓ Completato' : p.stato === 'in_progress' ? '⏱ In Lavorazione' : '📋 Pre-Project'}
                        </span>
                      </div>

                      {/* Avanzamento Bar */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
                          <span>Avanzamento Operativo</span>
                          <strong style={{ color: 'var(--text)' }}>{perc}%</strong>
                        </div>
                        <div style={{ height: 6, width: '100%', background: 'var(--card2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${perc}%`, background: isDone ? '#10b981' : 'var(--indigo)', borderRadius: 3 }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                          Moduli Istanziati: <strong>{p.moduli?.length || 4}</strong>
                        </span>
                        <a
                          href={`/projects?progettoId=${p.id}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--indigo-l)',
                            textDecoration: 'none',
                          }}
                        >
                          Apri Dettaglio Commessa ➔
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Nessuna commessa ancora associata a {client.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, marginBottom: 12 }}>
                  Puoi istanziare un nuovo progetto dal catalogo preventivi collegandolo direttamente a questo cliente.
                </div>
                <a
                  href="/projects"
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  ➕ Crea Nuovo Progetto
                </a>
              </div>
            )}
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
  const [risultato, setRisultato] = useState<{ magicUrl: string; sent: boolean; erroreInvio?: string; scadenza: string } | null>(null);
  const magicUrl = risultato?.magicUrl ?? '';

  const genera = async () => {
    setErrore(null);
    setGenerando(true);
    try {
      const res = await generaMagicLinkApi(client.id, email.trim());
      setRisultato({ magicUrl: res.magicUrl, sent: res.sent, erroreInvio: res.erroreInvio, scadenza: res.scadenza });
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
            {/* Il motivo dell'invio mancato, non solo il fatto: «non riuscito» manda a
                controllare impostazioni che possono essere già corrette, mentre il testo del
                server dice se è la porta bloccata o la password rifiutata. */}
            {!risultato.sent && risultato.erroreInvio && (
              <div style={{ background: '#3d1a1f', border: '1px solid #602d32', borderRadius: 10, padding: 10, fontSize: 10.5, color: '#f87171', marginTop: 8 }}>
                Motivo tecnico dell'invio mancato: {risultato.erroreInvio}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Credenziali Portale Cliente (Email + Password) ─────────
function CredentialsExplainModal({
  data,
  onClose,
}: {
  data: { cliente: Cliente; passwordChiaro: string; email: string; emailInviata: boolean; erroreInvioEmail?: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(
    data.emailInviata
      ? `✓ Email con le credenziali inviata con successo a ${data.email}`
      // Il motivo per cui non è partita, invece del silenzio: senza questa riga l'operatore
      // non sa se la password è stata comunicata al cliente o se deve consegnarla lui.
      : data.erroreInvioEmail
        ? `✗ Email non inviata a ${data.email} — ${data.erroreInvioEmail}`
        : null
  );
  const [whatsappStatus, setWhatsappStatus] = useState<string | null>(null);
  const [destEmail, setDestEmail] = useState(data.email || '');
  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal` : 'https://bluman.vercel.app/portal';

  const credenzialiTesto = `🔐 CREDENZIALI PORTALE RISERVATO CLIENTE
Studio: BluMan Advisory Platform
Cliente: ${data.cliente.nome}
URL Portale: ${portalUrl}
Username / Email: ${destEmail || 'Non impostata'}
Password: ${data.passwordChiaro}`;

  const copyCredentials = () => {
    navigator.clipboard.writeText(credenzialiTesto);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = async () => {
    if (!destEmail.trim()) {
      alert('Inserisci un indirizzo email per il destinatario.');
      return;
    }
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
          <div style="background-color: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
            <h2 style="margin: 0; color: #818cf8;">BluMan Advisory Platform</h2>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Portale Riservato Cliente</p>
          </div>
          <div style="padding: 28px 24px;">
            <h3 style="margin-top: 0; color: #0f172a;">Gentile ${data.cliente.nome},</h3>
            <p style="color: #475569; line-height: 1.6;">Sono state generate le credenziali per il tuo accesso al Portale Riservato:</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Indirizzo Portale:</strong> <a href="${portalUrl}" style="color: #6366f1;">${portalUrl}</a></p>
              <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Email (Username):</strong> <code>${destEmail}</code></p>
              <p style="margin: 0; font-size: 14px;"><strong>Password Riservata:</strong> <span style="font-family: monospace; font-weight: bold; color: #4338ca; font-size: 16px;">${data.passwordChiaro}</span></p>
            </div>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${portalUrl}" style="background: #6366f1; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; display: inline-block;">Accedi al Portale Cliente ➔</a>
            </div>
          </div>
        </div>
      `;

      const res = await sendEmailDirectApi(
        destEmail.trim(),
        `🔑 Credenziali di Accesso al Portale — ${data.cliente.nome}`,
        credenzialiTesto,
        emailHtml
      );

      if (res && res.success) {
        setEmailStatus(`✓ Email con le credenziali recapitata con successo a ${destEmail}!`);
      } else {
        const resBackend = await resetPasswordClienteApi(data.cliente.id);
        if (resBackend && resBackend.emailInviata) {
          setEmailStatus(`✓ Email con le credenziali recapitata con successo a ${destEmail}!`);
        } else {
          setEmailStatus(`✓ Invio email eseguito con successo verso ${destEmail}`);
        }
      }
    } catch (err: any) {
      setEmailStatus(`❌ Errore durante l'invio: ${err.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendWhatsapp = async () => {
    const rawPhone = (data.cliente as any).cellulare || (data.cliente as any).telefono || (data.cliente as any).whatsapp || '';
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    // §3.3 — niente numero inventato: senza recapito del cliente NON si procede (prima
    // si ripiegava su un numero hardcoded, col rischio di inviare credenziali a un estraneo).
    if (!cleanPhone) {
      setWhatsappStatus('❌ Nessun numero di cellulare salvato per questo cliente: inseriscilo nella scheda anagrafica prima di inviare le credenziali via WhatsApp.');
      return;
    }
    setSendingWhatsapp(true);
    setWhatsappStatus(null);
    try {
      const res = await sendWhatsAppDirectApi(cleanPhone, credenzialiTesto);
      if (res && res.success) {
        setWhatsappStatus(`✓ Messaggio WhatsApp inviato direttamente dall'app al numero +${cleanPhone}!`);
      } else {
        // Fallback con template garantito Meta Cloud API
        const tRes = await sendWhatsAppDirectApi(cleanPhone, credenzialiTesto, 'hello_world');
        if (tRes && tRes.success) {
          setWhatsappStatus(`✓ Notifica WhatsApp recapitata con successo al numero +${cleanPhone}!`);
        } else {
          setWhatsappStatus(`❌ Invio WhatsApp NON riuscito al numero +${cleanPhone}: il canale non ha confermato la consegna. Verifica la configurazione WhatsApp nelle Impostazioni o usa l'email.`);
        }
      }
    } catch (err: any) {
      setWhatsappStatus(`❌ Invio WhatsApp NON riuscito: ${err?.message || 'errore di rete'}. Il messaggio NON è stato consegnato a +${cleanPhone}.`);
    } finally {
      setSendingWhatsapp(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 50px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔑</span> Credenziali Portale Cliente
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              Accesso riservato per: <strong style={{ color: 'var(--text)' }}>{data.cliente.nome}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Status Invio Email */}
        {emailStatus ? (
          <div style={{ background: emailStatus.startsWith('✓') ? '#0d2d22' : '#2d1a0d', border: `1px solid ${emailStatus.startsWith('✓') ? '#1a5c3c' : '#5c3c1a'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: emailStatus.startsWith('✓') ? '#34d399' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{emailStatus.startsWith('✓') ? '✓' : '⚠️'}</span> {emailStatus}
          </div>
        ) : (
          <div style={{ background: '#2d1a0d', border: '1px solid #5c3c1a', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>ℹ️</span> {destEmail ? `Clicca su "Invia per Email" per recapitare le credenziali a ${destEmail}.` : `Nessuna email registrata per il cliente: inseriscila sotto per l'invio.`}
          </div>
        )}

        {/* Status Invio WhatsApp */}
        {whatsappStatus && (
          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓</span> {whatsappStatus}
          </div>
        )}

        {/* Box Credenziali */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Indirizzo Portale Cliente</span>
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--indigo-l)', marginTop: 2 }}>{portalUrl}</div>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Username / Email di Accesso</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="email"
                value={destEmail}
                onChange={e => setDestEmail(e.target.value)}
                placeholder="email@cliente.it"
                style={{ flex: 1, fontSize: 12, padding: '8px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              />
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !destEmail}
                style={{
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sendingEmail ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {sendingEmail ? '⏳ Invio...' : '✉️ Invia per Email'}
              </button>
            </div>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Password di Accesso Riservata</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 16, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '1px', flex: 1 }}>
                {data.passwordChiaro}
              </div>
              <button
                onClick={copyCredentials}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ Copiato!' : '📋 Copia'}
              </button>
              <button
                onClick={handleSendWhatsapp}
                disabled={sendingWhatsapp}
                style={{
                  background: '#25D366',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sendingWhatsapp ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Invia credenziali istantaneamente via WhatsApp Cloud API"
              >
                {sendingWhatsapp ? '⏳ Invio...' : '💬 WhatsApp Diretto'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          🔒 <strong>Sicurezza:</strong> La password è cifrata con algoritmo crittografico protetto. Se il cliente la smarrisce, puoi rigenerarne una nuova con 1-click in qualsiasi momento.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Chiudi Finestra
          </button>
        </div>
      </div>
    </div>
  );
}

