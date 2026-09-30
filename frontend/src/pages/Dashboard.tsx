import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup } from '../components/ui/Avatar';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt, progressColor } from '../utils';
import { NewProjectWizard } from '../components/NewProjectWizard';
import { fetchProgetti, isRispostaPaginata } from '../api/client';
import { usePeriodo } from '../context/PeriodoContext';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Progetto } from '../types';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const navigate = useNavigate();
  // La Dashboard rispetta lo stesso «Periodo» globale della pagina Progetti, altrimenti i due
  // conteggi divergono (Dashboard mostrava tutti i progetti, Progetti solo quelli del periodo).
  const { dataDa: gDataDa, dataA: gDataA } = usePeriodo();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [projectList, setProjectList] = useState<Progetto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'attivi' | 'archiviati'>('attivi');
  const [searchTerm, setSearchTerm] = useState('');

  const loadProjects = async () => {
    let combined: Progetto[] = [];
    let apiDisponibile = false;
    const currentTenantId = getCurrentTenantId();
    const storageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);

    // 1. Progetti salvati localmente per questo specifico Tenant. Valgono solo come ripiego
    // quando il backend non risponde: se l'API risponde, il suo elenco è l'intero dataset
    // (vedi passo 2). Era questa la causa del «2 in Dashboard, 1 in Progetti»: una copia
    // rimasta in localStorage veniva sommata ai progetti del database solo qui.
    const localStr = localStorage.getItem(storageKey);
    if (localStr) {
      try {
        const localProjs = JSON.parse(localStr);
        if (Array.isArray(localProjs)) combined.push(...localProjs);
      } catch (err) {
        console.warn('Errore parsing custom projects in Dashboard:', err);
      }
    }

    // 2. Carica progetti remoti dal backend Fastify/DB se presenti (filtrati per tenantId e
    //    per il Periodo globale, come la pagina Progetti)
    try {
      const remote = await fetchProgetti({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc', dataDa: gDataDa || undefined, dataA: gDataA || undefined });
      if (isRispostaPaginata<any>(remote)) {
        apiDisponibile = true;
        const dbProjs: Progetto[] = remote.data
          .filter((rp: any) => rp.tenantId === currentTenantId)
          .map((rp: any) => {
            // §16 — stato e percentuali arrivano calcolati dal backend (`avanzamento`), che è
            // l'unico a conoscere le regole del motore. Qui non si deduce nulla: prima queste
            // righe assegnavano percentuali fisse per stato (45% a ogni progetto in corso,
            // 50% a ogni modulo), numeri che non avevano alcun rapporto con le ore lavorate.
            const av = rp.avanzamento;
            const avModuli = new Map<string, any>(
              (av?.moduli || []).map((m: any) => [m.id, m]),
            );

            return {
              id: rp.id,
              n: rp.nome,
              cl: rp.cliente?.nome || 'Cliente',
              ct: (rp.cliente?.tipo as any) || 'individual',
              st: av?.stato || rp.stato || 'in_progress',
              pct: av?.percentuale ?? 0,
              // Regola 7: le date si mostrano solo se il progetto le ha davvero; 'n/d'
              // dichiara l'assenza del dato invece di inventare "Oggi" o un'etichetta.
              start: rp.dataInizio
                ? new Date(rp.dataInizio).toLocaleDateString('it-IT')
                : rp.createdAt ? new Date(rp.createdAt).toLocaleDateString('it-IT') : 'n/d',
              due: rp.dataScadenza ? new Date(rp.dataScadenza).toLocaleDateString('it-IT') : 'n/d',
              // Regola 7: il valore arriva dal DB (centesimi); se manca o è zero il progetto
              // non contribuisce al portafoglio — mai inventare una cifra verosimile.
              val: rp.valoreTotale != null ? rp.valoreTotale / 100 : 0,
              // Il progetto è "in allarme" se un suo modulo è in ritardo o bloccato, oppure se
              // il motore ha alzato un segnale di rischio su una micro-voce (§16.5): ore
              // consuntivate oltre il preventivo. È ciò che alimenta il contatore `alerts`.
              delay:
                (av?.moduli || []).some((m: any) => m.stato === 'delayed' || m.stato === 'blocked') ||
                Boolean(av?.segnaleRischio),
              // Regola 7: il regime fiscale non è valorizzato in questa pagina (non serve
              // alla Dashboard): 'n/d' invece di un valore di comodo.
              fisc: 'n/d',
              fatture: [],
              mods: (rp.moduli || []).map((m: any, mIdx: number) => {
                const avM = avModuli.get(m.id);
                return {
                  id: mIdx + 100,
                  n: m.nome,
                  // Regola 7: categoria, ore e prezzo arrivano dal DB (campi obbligatori
                  // nello schema Prisma). Nessuna cifra o etichetta di ripiego: se un dato
                  // manca si mostra zero/vuoto, non un valore verosimile inventato.
                  cat: m.categoria ?? 'Senza categoria',
                  st: avM?.stato || m.stato || 'pending',
                  pct: avM?.percentuale ?? 0,
                  h: m.orePreventivate ?? 0,
                  a: m.oreConsuntivate ?? 0,
                  p: m.prezzo != null ? m.prezzo / 100 : 0,
                  // Le assegnazioni vivono sul server (risorse per micro-voce): il DB non
                  // espone un "team" numerico del modulo, quindi l'array resta vuoto e la
                  // UI non mostra avatar inventati (riga con AvatarGroup più sotto).
                  team: [],
                  delay: avM ? avM.stato === 'delayed' || avM.stato === 'blocked' : false,
                  // §16.1 — sforamento ore: distinto dal ritardo di calendario. Il modulo
                  // avanza, ma sta costando più del preventivo, e il banner lo dice a parte.
                  rischio: Boolean(avM?.segnaleRischio),
                  oreExtra: avM?.oreExtra ?? 0,
                  v: (m.microvoci || []).map((mv: any) => ({
                    n: mv.nome,
                    hE: mv.orePreventivate ?? 0,
                    hA: mv.oreConsuntivate ?? 0,
                    s: mv.stato || 'pending',
                    vn: mv.causaNota || undefined,
                  })),
                };
              }),
            };
          });
        // Una risposta paginata valida è l'intero dataset: non va fusa con le copie locali,
        // altrimenti un progetto rimasto solo in localStorage comparirebbe qui e non in
        // Progetti. Stessa regola della pagina Progetti.
        combined = dbProjs;
      }
    } catch (err) {
      console.warn('Fetch DB fallback:', err);
    }

    // 3. Se e solo se è il tenant demo Bluecode Ltd, l'API non ha risposto e non c'è nulla in
    //    locale, carica i progetti di seed
    if (!apiDisponibile && combined.length === 0 && currentTenantId === BLUECODE_TENANT_ID) {
      const seedData = getTenantSeedData(currentTenantId);
      combined.push(...seedData.projects);
    }

    setProjectList(combined);
    setLoading(false);
  };

  useEffect(() => {
    loadProjects();
  }, [gDataDa, gDataA]);

  const currentUserStr = localStorage.getItem('bluman_user');
  const currentUser = currentUserStr ? JSON.parse(currentUserStr) : { ruolo: 'advisor' };
  const isSuperAdminOrAdvisor = ['super_admin', 'advisor'].includes(currentUser.ruolo);

  const active   = projectList.filter(p => p.st === 'in_progress').length;
  const alerts   = projectList.filter(p => p.delay).length;
  const totalVal = projectList.reduce((a, p) => a + p.val, 0);
  const avgPct   = Math.round(projectList.reduce((a, p) => a + p.pct, 0) / (projectList.length || 1));

  const delayedProjects = projectList.filter(p => {
    const hasDelay = p.delay || p.mods?.some(m => m.st === 'blocked' || m.st === 'delayed' || m.rischio);
    if (!hasDelay) return false;
    if (isSuperAdminOrAdvisor) return true;
    const uid = currentUser?.id != null ? Number(currentUser.id) : NaN;
    return (p.mods || []).some(m => {
      const team = m.team || [];
      // Regola 7: se il backend non fornisce informazioni di assegnazione (progetti DB),
      // l'allarme è visibile a tutti — è meglio segnalare una situazione urgente in più
      // che nasconderla in base a dati che non abbiamo.
      if (team.length === 0) return true;
      return Number.isFinite(uid) && team.includes(uid);
    });
  });

  /**
   * §16 — le righe del banner, una per motivo di allarme.
   *
   * Prima il banner filtrava `m.delay || m.st === 'blocked'`, mentre il contatore `alerts`
   * conta anche `segnaleRischio`: un progetto in allarme per sole ore sforate entrava
   * nell'elenco ma non produceva nessuna riga, e il titolo compariva sopra il vuoto.
   *
   * Ritardo e sforamento restano due righe distinte perché sono due problemi diversi con due
   * rimedi diversi: un ritardo si recupera con il calendario, uno sforamento di ore si
   * recupera solo rinegoziando o assorbendo il costo. Riassumerli in "Ritardo rilevato"
   * significherebbe cercare la causa nel posto sbagliato.
   */
  const alertRows = delayedProjects.flatMap(p =>
    (p.mods || []).flatMap(m => {
      const righe: Array<{ key: string; testo: string }> = [];
      if (m.delay || m.st === 'blocked') {
        righe.push({
          key: `${p.id}-${m.id}-ritardo`,
          testo: m.dn || (m.st === 'blocked' ? 'Modulo bloccato' : 'Ritardo rilevato'),
        });
      }
      if (m.rischio) {
        const extra = m.oreExtra ? ` (+${m.oreExtra}h oltre il preventivo)` : '';
        righe.push({
          key: `${p.id}-${m.id}-rischio`,
          testo: `Ore sforate${extra}`,
        });
      }
      return righe.map(r => ({ ...r, progetto: p.n, modulo: m.n }));
    }),
  );

  const filteredProjects = projectList.filter(p => {
    if (activeTab === 'attivi' && p.st === 'archived') return false;
    if (activeTab === 'archiviati' && p.st !== 'archived') return false;
    const query = searchTerm.toLowerCase();
    if (query && !p.n.toLowerCase().includes(query) && !p.cl.toLowerCase().includes(query)) return false;
    return true;
  });

  // ── Stato: Caricamento ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Connessione al database in corso...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Stato: Errore DB ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 20 }}>
        <div style={{ fontSize: 48 }}>🔴</div>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', marginBottom: 8 }}>
            Errore di connessione al database
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
            {error}
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={loadProjects}
              className="btn btn-primary"
            >
              🔄 Riprova
            </button>
            <button
              onClick={() => window.open('mailto:admin@bluecode.advisory?subject=Errore%20Database%20BluMan', '_blank')}
              className="btn btn-secondary"
            >
              📧 Contatta Amministratore
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* DB Connection Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
          🟢 Enterprise Cloud Database Collegato
        </div>
      </div>

      {/* KPI */}
      <div className={styles.kpiGrid}>
        <KpiCard icon="📁" iconBg="var(--pill-indigo-bg)" value={projectList.length} label="Progetti attivi" sub={`${active} in lavorazione`} />
        <KpiCard icon="⚠️" iconBg="var(--pill-amber-bg)" value={alerts} label="Ritardi attivi" sub="Richiedono attenzione" valueColor={alerts > 0 ? 'var(--amber)' : undefined} />
        <KpiCard icon="💶" iconBg="var(--pill-green-bg)" value={fmt(totalVal)} label="Valore portafoglio" sub="Progetti in corso" />
        <KpiCard icon="📈" iconBg="var(--pill-indigo-bg)" value={`${avgPct}%`} label="Avanzamento medio" sub="Tutti i progetti" />
      </div>

      {/* Alert banner */}
      {alertRows.length > 0 && (
        <div className={styles.alertBanner}>
          <div className={styles.alertTitle}>⚠ Situazioni che richiedono attenzione immediata</div>
          {alertRows.map(r => (
            <div key={r.key} className={styles.alertRow}>
              <span className={styles.alertDot} />
              <span><strong>{r.progetto}</strong> — {r.modulo}: {r.testo}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filtro Ricerca Live & Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <button
            onClick={() => setActiveTab('attivi')}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'attivi' ? '2px solid var(--indigo-l)' : '2px solid transparent', color: activeTab === 'attivi' ? 'var(--indigo-l)' : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}
          >
            Progetti in Corso ({projectList.filter(p => p.st !== 'archived').length})
          </button>
          <button
            onClick={() => setActiveTab('archiviati')}
            style={{ padding: '8px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'archiviati' ? '2px solid var(--indigo-l)' : '2px solid transparent', color: activeTab === 'archiviati' ? 'var(--indigo-l)' : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}
          >
            🗄 Archivio Progetti ({projectList.filter(p => p.st === 'archived').length})
          </button>
        </div>

        <input
          type="text"
          placeholder="🔍 Cerca progetto o cliente..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--text)', fontSize: 13, width: 250 }}
        />
      </div>

      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>{activeTab === 'attivi' ? 'Progetti in corso' : 'Archivio Storico'}</div>
        <button className={styles.btnPrimary} onClick={() => setWizardOpen(true)}>
          + Nuovo progetto
        </button>
      </div>

      <div className={styles.projectList}>
        {filteredProjects.length === 0 ? (
          <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--muted)', width: '100%' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Nessun progetto in corso</div>
            <div style={{ fontSize: 13 }}>Crea il primo progetto per il tuo studio cliccando su "+ Nuovo progetto"</div>
          </div>
        ) : (
          filteredProjects.map(p => {
            const color = progressColor(p);
            const allTeam = [...new Set((p.mods || []).flatMap(m => m.team || []).filter(Boolean))];
            return (
              <div
                key={p.id}
                className={`${styles.projectCard} ${p.delay ? styles.hasDelay : ''}`}
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className={styles.projectTop}>
                  <div>
                    <div className={styles.projectName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{p.n}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }} title="Apri / Modifica Dettagli Progetto">✏️</span>
                    </div>
                    <div className={styles.projectMeta}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/clients?client=${encodeURIComponent(p.cl)}`);
                        }}
                        style={{ cursor: 'pointer', color: 'var(--indigo-l)', textDecoration: 'underline' }}
                        title="Apri Anagrafica Specifica Cliente"
                      >
                        {p.ct === 'individual' ? '👤' : '🏢'} {p.cl}
                      </span>
                      <span>📅 {p.start} → {p.due}</span>
                      {/* Regola 7: il valore si mostra solo se il progetto lo porta davvero;
                          mai esporre una cifra per un progetto senza valore registrato. */}
                      {p.val > 0 && <span>💶 {fmt(p.val)}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {/* Regola 7: nessun avatar inventato — il gruppo si mostra solo se ci
                        sono membri reali assegnati ai moduli del progetto. */}
                    {allTeam.length > 0 && <AvatarGroup ids={allTeam} size={22} />}
                    <Badge stato={p.st} />
                  </div>
                </div>

                <div className={styles.modsSummary}>
                  {(p.mods || []).map((m, idx) => (
                    <CatBadge key={idx} cat={m.cat} />
                  ))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                    <span>Avanzamento</span>
                    <span style={{ color, fontWeight: 600 }}>{p.pct}%</span>
                  </div>
                  <ProgressBar value={p.pct} color={color} height={5} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onProjectCreated={() => loadProjects()}
        />
      )}
    </>
  );
}

interface KpiCardProps {
  icon: string; iconBg: string;
  value: string | number; label: string; sub?: string;
  valueColor?: string;
}

function KpiCard({ icon, iconBg, value, label, sub, valueColor }: KpiCardProps) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiIcon} style={{ background: iconBg }}>{icon}</div>
      <div className={styles.kpiValue} style={{ color: valueColor }}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}
