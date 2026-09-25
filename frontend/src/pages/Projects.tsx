import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup } from '../components/ui/Avatar';
import { fmt, progressColor } from '../utils';
import { fetchProgetti } from '../api/client';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { NewProjectWizard } from '../components/NewProjectWizard';
import { getTenantStorageKey, getTenantSeedData, getCurrentTenantId, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Progetto } from '../types';
import { Paginatore } from '../components/ui/Paginatore';
import { isRispostaPaginata, type MetaPaginazione } from '../api/paginazione';

const META_INIZIALE: MetaPaginazione = { page: 1, limit: 50, totale: 0, pagine: 0 };

type ViewMode = 'cards' | 'table' | 'kanban';
type FilterStatus = 'all' | 'in_progress' | 'delayed' | 'pending_signature' | 'completed' | 'archived';

export function Projects() {
  const navigate = useNavigate();
  const { team: teamList } = useTeamMembers();
  const [projectList, setProjectList] = useState<Progetto[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [meta, setMeta] = useState<MetaPaginazione>(META_INIZIALE);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Filtri e visualizzazione
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [sortBy, setSortBy] = useState<'due' | 'pct' | 'val' | 'name'>('due');

  const loadProjects = async () => {
    setLoading(true);
    setErrore('');
    let combined: Progetto[] = [];
    let apiDisponibile = false;
    const currentTenantId = getCurrentTenantId();
    const storageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);

    // 1. Carica progetti salvati localmente per questo specifico Tenant
    const localStr = localStorage.getItem(storageKey);
    if (localStr) {
      try {
        const localProjs = JSON.parse(localStr);
        if (Array.isArray(localProjs)) combined.push(...localProjs);
      } catch (err) {
        console.warn('Errore parsing custom projects:', err);
      }
    }

    // 2. Carica progetti remoti dal backend Fastify/DB se presenti (filtrati per tenantId)
    //
    // L'avanzamento arriva già calcolato dal server (§16, `arricchisciProgetti`): percentuale e
    // stato di ogni modulo e del progetto nascono dalle ore consuntivate sulle micro-voci. Qui
    // prima venivano ignorati e sostituiti da costanti — 45% per ogni progetto, 50% per ogni
    // modulo, 20 ore preventivate, 3.500 € di prezzo, due persone in squadra. Le barre di
    // avanzamento erano quindi immobili per costruzione: consuntivare ore o chiudere una
    // micro-voce non poteva cambiare un numero scritto a mano nel frontend. È il «i grafici non
    // si aggiornano» segnalato. Dove il dato non c'è si mostra zero: un preventivo mai fatto
    // vale zero, non 15.000 €.
    try {
      const remote = await fetchProgetti({ page, limit, search: searchDebounced, sortBy: 'createdAt', sortOrder: 'desc' });
      if (isRispostaPaginata<any>(remote)) {
        apiDisponibile = true;
        setMeta(remote.meta);
        if (remote.meta.pagine > 0 && page > remote.meta.pagine) setPage(remote.meta.pagine);
        const dbProjs: Progetto[] = remote.data
          .filter((rp: any) => rp.tenantId === currentTenantId)
          .map((rp: any) => {
            const avanzamento = rp.avanzamento;
            // L'avanzamento dei moduli è indicizzato per id di database, non per posizione.
            const avModuli = new Map<string, any>(
              (avanzamento?.moduli || []).map((am: any) => [String(am.id), am]),
            );

            let rpMods = (rp.moduli || []).map((m: any, mIdx: number) => {
              const av = avModuli.get(String(m.id));
              return {
                id: mIdx + 100,
                dbId: m.id,
                n: m.nome,
                cat: m.categoria ?? 'Senza categoria',
                st: av?.stato || m.stato || 'pending',
                pct: av?.percentuale ?? 0,
                h: m.orePreventivate ?? 0,
                a: m.oreConsuntivate ?? 0,
                p: m.prezzo ? m.prezzo / 100 : 0,
                // La squadra vera sono le risorse assegnate alle micro-voci: finché non
                // arrivano da qui, meglio nessun volto che due volti inventati.
                team: [],
                segnaleRischio: av?.segnaleRischio ?? m.segnaleRischio ?? false,
                oreExtra: av?.oreExtra ?? 0,
                delay: (av?.stato || m.stato) === 'delayed',
                v: (m.microvoci || []).map((v: any) => ({
                  dbId: v.id,
                  n: v.nome || v.titolo,
                  hE: v.orePreventivate ?? 0,
                  hA: v.oreConsuntivate ?? 0,
                  s: v.stato || 'pending',
                  as: v.risorsaId ?? null,
                  d: v.ordine ?? 1,
                })),
              };
            });
            return {
              id: rp.id,
              n: rp.nome,
              cl: rp.cliente?.nome || 'Cliente',
              ct: (rp.cliente?.tipo as any) || 'individual',
              st: avanzamento?.stato || rp.stato || 'pre_project',
              pct: avanzamento?.percentuale ?? 0,
              start: rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : '—',
              due: rp.dataScadenza || rp.scadenza
                ? new Date(rp.dataScadenza || rp.scadenza).toLocaleDateString('it-IT')
                : '—',
              val: rp.valoreTotale ? rp.valoreTotale / 100 : 0,
              delay: (avanzamento?.stato || rp.stato) === 'delayed' || rp.inRitardo || false,
              // regimeFiscale vive sul Tenant, non arriva da /progetti: 'n/d' invece di
              // un valore di comodo (Regola 7). Il campo non è comunque letto in pagina.
              fisc: 'n/d',
              fatture: rp.fatture || [],
              mods: rpMods,
            };
          });
        // Una risposta paginata valida è l'intero dataset della pagina: non va fusa con
        // copie locali o seed, altrimenti limite, totale e navigazione non coincidono.
        combined = dbProjs;
      } else {
        throw new Error('Risposta progetti non valida');
      }
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Errore caricamento progetti');
      console.warn('Fetch DB fallback:', err);
    }

    // 3. Se e solo se è il tenant demo Bluecode Ltd e non ci sono progetti salvati, carica i progetti di seed
    if (!apiDisponibile && combined.length === 0 && currentTenantId === BLUECODE_TENANT_ID) {
      const seedData = getTenantSeedData(currentTenantId);
      combined.push(...seedData.projects);
    }

    if (!apiDisponibile) {
      const filtroLocale = searchDebounced.toLowerCase();
      combined = combined.filter(p =>
        !filtroLocale ||
        p.n?.toLowerCase().includes(filtroLocale) ||
        p.cl?.toLowerCase().includes(filtroLocale) ||
        (p.mods || []).some(m => m.n?.toLowerCase().includes(filtroLocale)),
      );
      const totale = combined.length;
      const pagine = totale === 0 ? 0 : Math.ceil(totale / limit);
      const paginaEffettiva = pagine === 0 ? 1 : Math.min(page, pagine);
      if (paginaEffettiva !== page) setPage(paginaEffettiva);
      setMeta({ page: paginaEffettiva, limit, totale, pagine });
      combined = combined.slice((paginaEffettiva - 1) * limit, paginaEffettiva * limit);
    }

    setProjectList(combined);
    setLoading(false);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchDebounced(searchTerm.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    loadProjects();
  }, [page, limit, searchDebounced]);

  // ── Statistiche KPI Operative ─────────────────────────────────────────
  const totalProjects = meta.totale || projectList.length;
  const activeProjects = projectList.filter(p => p.st === 'in_progress' || (p.st as any) === 'active').length;
  const delayedProjects = projectList.filter(p => p.delay || (p.st as any) === 'delayed' || (p.st as any) === 'blocked').length;
  const completedProjects = projectList.filter(p => p.st === 'completed' || (p.st as any) === 'done').length;

  const totalPortafoglioVal = projectList.reduce((sum, p) => sum + (p.val || 0), 0);
  
  // Calcolo ore complessive
  let totalOreConsuntivate = 0;
  let totalOrePreventivate = 0;
  let totalMicrovociDone = 0;
  let totalMicrovociCount = 0;

  projectList.forEach(p => {
    (p.mods || []).forEach(m => {
      totalOreConsuntivate += (m.a || 0);
      totalOrePreventivate += (m.h || 0);
      (m.v || []).forEach(v => {
        totalMicrovociCount++;
        if (v.s === 'done') totalMicrovociDone++;
      });
    });
  });

  // ── Filtraggio e Ordinamento ──────────────────────────────────────────
  const filteredProjects = projectList.filter(p => {
    // 1. La ricerca testuale è applicata dal server prima della paginazione.
    const matchSearch = true;

    // 2. Filtro Stato
    let matchStatus = true;
    if (statusFilter === 'in_progress') matchStatus = p.st === 'in_progress' || (p.st as any) === 'active';
    else if (statusFilter === 'delayed') matchStatus = p.delay || (p.st as any) === 'delayed' || (p.st as any) === 'blocked';
    else if (statusFilter === 'pending_signature') matchStatus = p.pct < 20 || p.st === 'pre_project';
    else if (statusFilter === 'completed') matchStatus = p.st === 'completed' || (p.st as any) === 'done';
    else if (statusFilter === 'archived') matchStatus = p.st === 'archived';

    // 3. Filtro Categoria Modulo
    let matchCat = true;
    if (catFilter !== 'ALL') {
      matchCat = (p.mods || []).some(m => m.cat.toLowerCase() === catFilter.toLowerCase());
    }

    // 4. Filtro Advisor
    let matchAdvisor = true;
    if (selectedAdvisorId !== 'ALL') {
      matchAdvisor = (p.mods || []).some(m =>
        (m.v || []).some(v => String(v.as ?? '') === selectedAdvisorId),
      );
    }

    return matchSearch && matchStatus && matchCat && matchAdvisor;
  }).sort((a, b) => {
    if (sortBy === 'val') return (b.val || 0) - (a.val || 0);
    if (sortBy === 'pct') return (b.pct || 0) - (a.pct || 0);
    if (sortBy === 'name') return a.n.localeCompare(b.n);
    return (a.due || '').localeCompare(b.due || '');
  });

  // ── Calcolo Giorni Rimanenti ──────────────────────────────────────────
  const calculateDaysRemaining = (dueStr?: string) => {
    if (!dueStr || dueStr === 'In corso') return null;
    const parts = dueStr.split('/');
    if (parts.length === 3) {
      const dueDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      const diffMs = dueDate.getTime() - new Date().getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays;
    }
    return null;
  };

  // ── Stato: Caricamento ───────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--indigo)',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ color: 'var(--muted)', fontSize: 14, fontWeight: 600 }}>Caricamento fascicoli operativi dello studio...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── 1. Header & KPI Strip Operativa ────────────────────────────── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📁 Registro Pratiche & Fascicoli Studio</span>
              <span style={{ fontSize: 11, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
                OPERATOR HUB
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              Gestione operativa delle pratiche, consuntivazione ore, checklist microvoci, scadenze e contratti fiduciari.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/documents')}
              className="btn btn-secondary"
            >
              <span>📝 Document Studio</span>
            </button>
            <button
              id="btn-nuovo-progetto"
              onClick={() => setWizardOpen(true)}
              className="btn btn-primary"
            >
              <span>+ Nuovo Progetto Incarico</span>
            </button>
          </div>
        </div>

        {/* KPI Cards per l'Operatore */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ background: 'var(--card2)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>💼 Pratiche Attive (pagina corrente)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>
              {activeProjects} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>/ {totalProjects} totali</span>
            </div>
          </div>

          <div style={{ background: 'var(--card2)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>⏱ Consuntivo Ore (pagina corrente)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 4 }}>
              {totalOreConsuntivate.toFixed(1)}h <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>/ {totalOrePreventivate}h stimate</span>
            </div>
          </div>

          <div style={{ background: 'var(--card2)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>📋 Checklist Microvoci (pagina corrente)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>
              {totalMicrovociDone} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>/ {totalMicrovociCount} step eseguiti</span>
            </div>
          </div>

          <div style={{ background: 'var(--card2)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>💶 Valore Portafoglio (pagina corrente)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 4 }}>
              {fmt(totalPortafoglioVal)}
            </div>
          </div>

          <div style={{ background: delayedProjects > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--card2)', padding: '12px 14px', borderRadius: 10, border: `1px solid ${delayedProjects > 0 ? 'var(--red)' : 'var(--border)'}` }}>
            <div style={{ fontSize: 11, color: delayedProjects > 0 ? 'var(--red)' : 'var(--muted)', fontWeight: 600 }}>⚠️ Alert Ritardi (pagina corrente)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: delayedProjects > 0 ? 'var(--red)' : 'var(--text)', marginTop: 4 }}>
              {delayedProjects} pratiche critiche
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Toolbar Filtri, Ricerca & Switch Viste ───────────────────── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {/* Tabs Stato */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `Tutti (${projectList.length} nella pagina)` },
              { id: 'in_progress', label: `🚀 In Corso (${activeProjects} nella pagina)` },
              { id: 'delayed', label: `⚠️ In Ritardo (${delayedProjects} nella pagina)` },
              { id: 'completed', label: `✅ Conclusi (${completedProjects} nella pagina)` },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as FilterStatus)}
                style={{
                  background: statusFilter === tab.id ? 'var(--indigo)' : 'var(--card2)',
                  color: statusFilter === tab.id ? 'var(--on-accent)' : 'var(--muted)',
                  border: `1px solid ${statusFilter === tab.id ? 'var(--indigo-l)' : 'var(--border)'}`,
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Switch Viste (Schede / Tabella / Kanban) */}
          <div style={{ display: 'flex', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              style={{
                background: viewMode === 'cards' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: viewMode === 'cards' ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>🎴</span>
              <span>Schede</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              style={{
                background: viewMode === 'table' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: viewMode === 'table' ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>📋</span>
              <span>Tabella ERP</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              style={{
                background: viewMode === 'kanban' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: viewMode === 'kanban' ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>📊</span>
              <span>Kanban</span>
            </button>
          </div>
        </div>

        {/* Barra Secondaria: Ricerca, Filtro Categoria e Ordinamento */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
            <input
              type="text"
              placeholder="🔍 Cerca pratica per titolo, cliente o modulo..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--card2)', color: 'var(--text)', fontSize: 12, width: 280,
              }}
            />

            <select
              value={catFilter}
              onChange={e => setCatFilter(e.target.value)}
              style={{ fontSize: 11.5, padding: '6px 10px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="ALL">🌐 Tutte le Aree / Categorie (pagina corrente)</option>
              <option value="Societario">🏛️ Societario & Holding</option>
              <option value="Analisi">📊 Analisi & Advisory</option>
              <option value="Trust">🛡️ Trust & Fiduciario</option>
              <option value="Banking">🏦 Banking & Conti</option>
              <option value="Fiscale">💶 Fiscale & Tax Planning</option>
              <option value="Compliance">⚖️ Compliance & KYC</option>
              <option value="Legale">📜 Legale & Contratti</option>
              <option value="IP">®️ Proprietà Intellettuale</option>
            </select>

            <select
              value={selectedAdvisorId}
              onChange={e => setSelectedAdvisorId(e.target.value)}
              style={{ fontSize: 11.5, padding: '6px 10px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="ALL">👤 Tutti gli Operatori (pagina corrente)</option>
              {teamList.map(t => (
                <option key={t.id} value={t.id}>{t.n} ({t.r})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Ordina la pagina:</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 6, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="due">📅 Per Scadenza</option>
              <option value="pct">📈 Per Avanzamento %</option>
              <option value="val">💶 Per Valore Economico</option>
              <option value="name">🔤 Alfabetico</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── 3. Contenuto Principale: Visualizzazione Selezionata ─────────── */}
      {errore && <div style={{ padding: 12, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' }}>{errore}</div>}
      {filteredProjects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Nessuna pratica corrisponde ai filtri</div>
          <div style={{ fontSize: 12.5, marginBottom: 18 }}>Prova a modificare la ricerca o seleziona un'altra categoria.</div>
          <button
            onClick={() => { setSearchTerm(''); setStatusFilter('all'); setCatFilter('ALL'); setSelectedAdvisorId('ALL'); }}
            className="btn btn-primary"
          >
            Reset Filtri
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* ── Vista 1: Schede Operative Dettagliate ───────────────────── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
          {filteredProjects.map(p => {
            const daysRemaining = calculateDaysRemaining(p.due);
            const totalMods = (p.mods || []).length;
            
            // Consuntivo ore progetto
            const oreCons = (p.mods || []).reduce((sum, m) => sum + (m.a || 0), 0);
            const orePrev = (p.mods || []).reduce((sum, m) => sum + (m.h || 0), 0);
            const orePct = orePrev > 0 ? Math.min(Math.round((oreCons / orePrev) * 100), 100) : 0;

            // Microvoci completate
            let microDone = 0;
            let microTotal = 0;
            (p.mods || []).forEach(m => {
              (m.v || []).forEach(v => {
                microTotal++;
                if (v.s === 'done') microDone++;
              });
            });

            // Incassato
            const incassato = (p.fatture || [])
              .filter(f => f.stato === 'incassata')
              .reduce((sum, f) => sum + (f.importo || 0), 0);

            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--card)',
                  border: `1px solid ${p.delay ? 'var(--red)' : 'var(--border)'}`,
                  borderRadius: 14,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 14,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                  transition: 'transform 0.15s ease, border-color 0.15s ease',
                }}
              >
                {/* Card Header */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '2px 6px', borderRadius: 4 }}>
                        #{p.id}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {p.ct === 'company' ? '🏢' : '👤'} {p.cl}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {p.delay && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span>⚠️</span> In Ritardo
                        </span>
                      )}
                      <Badge stato={p.st} />
                    </div>
                  </div>

                  {/* Titolo Pratica */}
                  <div
                    onClick={() => navigate(`/projects/${p.id}`)}
                    style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', cursor: 'pointer', lineHeight: 1.35 }}
                    title="Apri fascicolo pratico"
                  >
                    {p.n}
                  </div>
                </div>

                {/* Avanzamento % e Checklist Moduli */}
                <div style={{ background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>Avanzamento Fascicolo</span>
                    <span style={{ fontWeight: 800, color: progressColor(p) }}>{p.pct}%</span>
                  </div>
                  <ProgressBar value={p.pct} color={progressColor(p)} />

                  {/* Mini Pills dei Moduli */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {(p.mods || []).slice(0, 4).map(m => (
                      <span
                        key={m.id}
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: m.st === 'done' ? 'var(--pill-green-bg)' : m.st === 'in_progress' ? 'var(--pill-indigo-bg)' : 'rgba(255,255,255,0.05)',
                          color: m.st === 'done' ? 'var(--pill-green-fg)' : m.st === 'in_progress' ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                          border: `1px solid ${m.st === 'done' ? 'var(--pill-green-bd)' : m.st === 'in_progress' ? 'var(--pill-indigo-bd)' : 'transparent'}`,
                        }}
                      >
                        {m.n.length > 22 ? m.n.substring(0, 20) + '...' : m.n} ({m.pct}%)
                      </span>
                    ))}
                    {totalMods > 4 && (
                      <span style={{ fontSize: 9.5, color: 'var(--muted)', alignSelf: 'center' }}>
                        +{totalMods - 4} altri
                      </span>
                    )}
                  </div>
                </div>

                {/* Dati Operativi: Ore, Microvoci, Economico & Scadenza */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11.5 }}>
                  <div style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>⏱ Consuntivo Ore</div>
                    <div style={{ fontWeight: 700, marginTop: 2, color: orePct > 90 ? 'var(--red)' : 'var(--text)' }}>
                      {oreCons.toFixed(1)}h <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>/ {orePrev}h ({orePct}%)</span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>📋 Microvoci</div>
                    <div style={{ fontWeight: 700, marginTop: 2, color: 'var(--green)' }}>
                      {microDone} / {microTotal} step
                    </div>
                  </div>

                  <div style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>💶 Valore Incarico</div>
                    <div style={{ fontWeight: 800, color: 'var(--indigo-l)', marginTop: 2 }}>
                      {fmt(p.val)}
                      {incassato > 0 && (
                        <span style={{ fontSize: 9.5, color: 'var(--green)', fontWeight: 600, display: 'block' }}>
                          ✓ Incassati {fmt(incassato)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>📅 Target Scadenza</div>
                    <div style={{ fontWeight: 700, marginTop: 2, color: daysRemaining !== null && daysRemaining < 7 ? 'var(--red)' : 'var(--text)' }}>
                      {p.due || 'In corso'}
                      {daysRemaining !== null && (
                        <span style={{ fontSize: 9.5, display: 'block', color: daysRemaining < 0 ? 'var(--red)' : daysRemaining < 10 ? 'var(--amber)' : 'var(--muted)' }}>
                          {daysRemaining < 0 ? `Scaduto da ${Math.abs(daysRemaining)} gg` : `${daysRemaining} gg rimanenti`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer Card: Advisor Assegnati & Quick Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Regola 7: nessun volto inventato — se il progetto non ha un team
                        assegnato il gruppo avatar resta vuoto. */}
                    <AvatarGroup ids={p.mods?.[0]?.team || []} />
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Team Lead</span>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/documents?projId=${p.id}`)}
                      className="btn btn-secondary btn-sm"
                      title="Genera documento Word per questa pratica"
                    >
                      📝 Doc
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="btn btn-primary btn-sm"
                    >
                      Apri Fascicolo ➔
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'table' ? (
        /* ── Vista 2: Tabella ERP Matrice Compatta ──────────────────── */
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>ID / Titolo Pratica</th>
                  <th style={{ padding: '12px 14px' }}>Cliente Committente</th>
                  <th style={{ padding: '12px 14px' }}>Stato & Scadenza</th>
                  <th style={{ padding: '12px 14px', width: 180 }}>Avanzamento & Moduli</th>
                  <th style={{ padding: '12px 14px' }}>Ore Cons. / Prev.</th>
                  <th style={{ padding: '12px 14px' }}>Valore Incarico</th>
                  <th style={{ padding: '12px 14px' }}>Team</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map(p => {
                  const oreCons = (p.mods || []).reduce((sum, m) => sum + (m.a || 0), 0);
                  const orePrev = (p.mods || []).reduce((sum, m) => sum + (m.h || 0), 0);

                  return (
                    <tr
                      key={p.id}
                      style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 800, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '1px 5px', borderRadius: 4 }}>
                            #{p.id}
                          </span>
                          <span
                            onClick={() => navigate(`/projects/${p.id}`)}
                            style={{ fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}
                          >
                            {p.n}
                          </span>
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--muted)' }}>
                          {p.ct === 'company' ? '🏢' : '👤'} {p.cl}
                        </span>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {p.delay && <span style={{ fontSize: 9, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>⚠ Ritardo</span>}
                            <Badge stato={p.st} />
                          </div>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>📅 {p.due || 'In corso'}</span>
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700 }}>
                            <span>{(p.mods || []).length} moduli</span>
                            <span>{p.pct}%</span>
                          </div>
                          <ProgressBar value={p.pct} color={progressColor(p)} />
                        </div>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{oreCons.toFixed(1)}h</span>
                        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}> / {orePrev}h</span>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(p.val)}</span>
                      </td>

                      <td style={{ padding: '12px 14px' }}>
                        <AvatarGroup ids={p.mods?.[0]?.team || []} />
                      </td>

                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => navigate(`/documents?projId=${p.id}`)}
                            className="btn btn-secondary btn-sm"
                            title="Genera documento Word"
                          >
                            📝 Doc
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/projects/${p.id}`)}
                            className="btn btn-primary btn-sm"
                          >
                            Fascicolo ➔
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
      ) : (
        /* ── Vista 3: Kanban Pipeline Fasi di Lavoro ───────────────── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
          {[
            { key: 'onboarding', title: '1. Onboarding & KYC', count: filteredProjects.filter(p => p.pct <= 25 && p.st !== 'completed').length, projs: filteredProjects.filter(p => p.pct <= 25 && p.st !== 'completed') },
            { key: 'working', title: '2. In Lavorazione Attiva', count: filteredProjects.filter(p => p.pct > 25 && p.pct < 75 && p.st !== 'completed').length, projs: filteredProjects.filter(p => p.pct > 25 && p.pct < 75 && p.st !== 'completed') },
            { key: 'review', title: '3. Revisione & Deposito', count: filteredProjects.filter(p => p.pct >= 75 && p.pct < 100 && p.st !== 'completed').length, projs: filteredProjects.filter(p => p.pct >= 75 && p.pct < 100 && p.st !== 'completed') },
            { key: 'done', title: '4. Conclusi & Archiviati', count: filteredProjects.filter(p => p.pct === 100 || p.st === 'completed').length, projs: filteredProjects.filter(p => p.pct === 100 || p.st === 'completed') },
          ].map(col => (
            <div key={col.key} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{col.title}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, background: 'var(--card2)', color: 'var(--muted)', padding: '2px 8px', borderRadius: 12 }}>
                  {col.count}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 150 }}>
                {col.projs.map(p => (
                  <div
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    style={{
                      background: 'var(--card2)',
                      border: `1px solid ${p.delay ? 'var(--red)' : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--indigo-l)' }}>#{p.id}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{p.due || 'In corso'}</span>
                    </div>

                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{p.n}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>🏢 {p.cl}</div>

                    <ProgressBar value={p.pct} color={progressColor(p)} />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2, fontSize: 10.5 }}>
                      <span style={{ fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(p.val)}</span>
                      <AvatarGroup ids={p.mods?.[0]?.team || []} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Paginatore
        meta={meta}
        onPageChange={setPage}
        onLimitChange={(nuovoLimite) => { setLimit(nuovoLimite); setPage(1); }}
      />

      {/* ── Modal Nuovo Progetto Wizard ────────────────────────────────── */}
      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onProjectCreated={() => { setWizardOpen(false); loadProjects(); }}
        />
      )}
    </div>
  );
}
