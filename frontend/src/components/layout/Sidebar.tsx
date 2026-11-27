import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getFormattedLogoUrl } from '../../utils';
import { getUserPermission } from '../../utils/rbac';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, getModuliDisattivati, ANAGRAFICA_DA_COMPLETARE } from '../../utils/tenant';
import { useModuloKycAttivo } from '../../hooks/useModuloKycAttivo';
import styles from './Sidebar.module.css';

// Le voci del menu, per area. Dashboard e Aiuto stanno fuori dalle aree (sempre visibili); le
// altre si aprono e chiudono a tendina. `moduleKey` è la chiave della matrice permessi.
type VoceMenu = { path: string; moduleKey: string; label: string; icon: string; area?: string };

const AREE: ReadonlyArray<{ id: string; label: string; icon: string }> = [
  { id: 'lavoro', label: 'Lavoro', icon: '🗂' },
  { id: 'contabilita', label: 'Contabilità', icon: '💶' },
  { id: 'documenti', label: 'Documenti', icon: '📝' },
  { id: 'studio', label: 'Studio', icon: '🏛' },
];

const NAV: VoceMenu[] = [
  { path: '/',           moduleKey: 'dashboard',   label: 'Dashboard',             icon: '📊' },
  { path: '/projects',   moduleKey: 'projects',    label: 'Progetti',               icon: '📁', area: 'lavoro' },
  { path: '/clients',    moduleKey: 'clients',     label: 'Clienti',                icon: '👥', area: 'lavoro' },
  // Coda KYC — stessa chiave RBAC di Clienti: sono le pratiche dei clienti viste tutte insieme.
  { path: '/compliance', moduleKey: 'clients',     label: 'Coda KYC / AML',          icon: '🛡️', area: 'lavoro' },
  { path: '/calendar',   moduleKey: 'calendar',    label: 'Calendario',             icon: '📅', area: 'lavoro' },
  { path: '/timesheet',  moduleKey: 'timesheet',   label: 'Timesheet ore',          icon: '⏱️', area: 'lavoro' },
  { path: '/invoices',   moduleKey: 'invoices',    label: 'Fatture & SDI',          icon: '💶', area: 'contabilita' },
  { path: '/fornitori',  moduleKey: 'invoices',    label: 'Fornitori e acquisti',   icon: '🏢', area: 'contabilita' },
  { path: '/liquidazione-iva', moduleKey: 'invoices', label: 'Liquidazione IVA',   icon: '📑', area: 'contabilita' },
  { path: '/scadenzario',moduleKey: 'scadenzario', label: 'Scadenzario incassi',    icon: '📅', area: 'contabilita' },
  { path: '/primanota',  moduleKey: 'primanota',   label: 'Prima Nota',             icon: '💰', area: 'contabilita' },
  { path: '/banks',      moduleKey: 'banks',       label: 'Banche e conti',         icon: '🏦', area: 'contabilita' },
  { path: '/retainers',  moduleKey: 'retainers',   label: 'Contratti Retainer',     icon: '🔄', area: 'contabilita' },
  { path: '/documents',  moduleKey: 'documents',   label: 'Document Studio',        icon: '📝', area: 'documenti' },
  // §41 — la cartella dei modelli: stessa chiave RBAC, è la libreria da cui Document Studio pesca.
  { path: '/modelli',    moduleKey: 'documents',   label: 'Cartella Modelli',       icon: '🗂', area: 'documenti' },
  // §37 — stessa chiave RBAC di Document Studio: chi vede i documenti vede l'archivio.
  { path: '/archivio',   moduleKey: 'documents',   label: 'Archivio documentale',   icon: '📂', area: 'documenti' },
  { path: '/reports',    moduleKey: 'reports',     label: 'Report',                 icon: '📈', area: 'studio' },
  { path: '/library',    moduleKey: 'library',     label: 'Libreria moduli',        icon: '📚', area: 'studio' },
  { path: '/audit',      moduleKey: 'audit',       label: 'Log Audit',              icon: '📋', area: 'studio' },
  { path: '/settings',   moduleKey: 'settings',    label: 'Impostazioni',           icon: '⚙️', area: 'studio' },
  // Il manuale in-app (§docs/manuale). `moduleKey: 'settings'` è una scelta, non una svista: le
  // schede spiegano anche le sezioni, quindi l'aiuto non può essere spento dal modulo che spiega —
  // sarebbe come chiudersi la porta alle spalle. La voce non è un modulo e non si nega.
  { path: '/aiuto',      moduleKey: 'settings',    label: 'Aiuto',                  icon: '❓' },
];

const CHIAVE_AREE = 'bluman_menu_aree';

/** Quali aree l'utente ha lasciato aperte o chiuse: una comodità di questo browser, niente di più. */
function leggiAreeSalvate(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE_AREE) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** L'area a cui appartiene l'indirizzo corrente, se è una voce del menu. */
function areaDelPercorso(pathname: string): string | undefined {
  return NAV.find((v) => v.area && (pathname === v.path || pathname.startsWith(`${v.path}/`)))?.area;
}

interface SidebarProps {
  alertCount?: number;
  user?: any;
  onLogout?: () => void;
  onOpenProfile?: () => void;
}

export function Sidebar({ alertCount = 0, user, onLogout, onOpenProfile }: SidebarProps) {
  const currentTenantId = getCurrentTenantId(user);
  const studioInfo = getStudioInfoForTenant(currentTenantId);

  const tenantLogo = localStorage.getItem(getTenantStorageKey('bluman_logo_url'));
  const effectiveLogo = tenantLogo || '';

  const nomeStudio = studioInfo.nomeBreve || ANAGRAFICA_DA_COMPLETARE;
  const rigaSottoLogo = effectiveLogo
    ? (studioInfo.nomeBreve || studioInfo.ragioneSociale || ANAGRAFICA_DA_COMPLETARE)
    : (studioInfo.ragioneSociale && studioInfo.ragioneSociale !== nomeStudio ? studioInfo.ragioneSociale : '');

  const userName = user?.nome || user?.name || studioInfo.leadAdvisor || 'Operatore Studio';
  const initials = userName.substring(0, 2).toUpperCase();

  const isSuperAdmin = user?.ruolo === 'super_admin';
  const baseItems: VoceMenu[] = isSuperAdmin
    ? [...NAV.slice(0, -1), { path: '/admin/tenants', moduleKey: 'admin', label: 'Multi-Tenant Admin', icon: '👑', area: 'studio' }, NAV[NAV.length - 1]!]
    : NAV;

  // Aree a tendina. Regola: l'area della pagina in cui ci si trova è sempre aperta; per le altre
  // vale l'ultima scelta dell'utente, e alla prima visita è aperta solo «Lavoro».
  const { pathname } = useLocation();
  const areaCorrente = areaDelPercorso(pathname) ?? (pathname.startsWith('/admin') ? 'studio' : undefined);
  const [areeScelte, setAreeScelte] = useState<Record<string, boolean>>(leggiAreeSalvate);
  const areaAperta = (id: string) => id === areaCorrente || (areeScelte[id] ?? id === 'lavoro');
  const cambiaArea = (id: string) => {
    const nuove = { ...areeScelte, [id]: !areaAperta(id) };
    setAreeScelte(nuove);
    try { localStorage.setItem(CHIAVE_AREE, JSON.stringify(nuove)); } catch { /* solo una comodità */ }
  };

  // La Coda KYC ha senso solo a modulo acceso: a modulo spento la voce portava a una pagina che
  // dice soltanto «il modulo non è attivo». Si nasconde quando il server dice che è spento; se
  // non si sa (lettura in corso o fallita) resta, e la pagina spiega da sé.
  const kycAttivo = useModuloKycAttivo(Boolean(user));

  // Filtra i moduli bloccati per l'utente loggato in base alla Matrice Permessi RBAC
  const disattivati = getModuliDisattivati();
  const navItems = baseItems.filter(item => {
    if (item.path === '/') return true;
    if (item.path === '/admin/tenants') return isSuperAdmin;
    // L'aiuto non è un modulo: non ha una voce nella matrice permessi e non c'è niente da
    // disattivare. L'eccezione è esplicita per lo stesso motivo di `/` — un `moduleKey` messo lì
    // per far contento il filtro è una decisione che poi nessuno ritrova.
    if (item.path === '/aiuto') return true;
    if (item.path === '/compliance' && kycAttivo === false) return false;
    // Standby moduli deciso dallo studio (Impostazioni non si disattiva, per non chiudersi fuori).
    if (item.moduleKey !== 'settings' && disattivati.includes(item.moduleKey)) return false;
    const perm = getUserPermission(user, item.moduleKey);
    return perm !== 'denied';
  });

  const voce = (item: VoceMenu) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
    >
      <span className={styles.navIcon}>{item.icon}</span>
      <span>{item.label}</span>
      {item.path === '/' && alertCount > 0 && (
        <span className={styles.navBadge}>{alertCount}</span>
      )}
    </NavLink>
  );

  return (
    <aside className={styles.sidebar}>
      {/* Logo & Tenant Studio Badge */}
      <div className={styles.logo} style={{ background: 'var(--surface-2)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--pill-slate-bg)', marginBottom: 16 }}>
        {effectiveLogo ? (
          <img
            src={getFormattedLogoUrl(effectiveLogo)}
            alt={studioInfo.ragioneSociale || ANAGRAFICA_DA_COMPLETARE}
            style={{ height: 32, maxWidth: 160, objectFit: 'contain', display: 'block' }}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--pill-slate-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--cat-societario)', border: '1px solid var(--border)' }}>
              🏛
            </div>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 125 }}>
              {studioInfo.nomeBreve || ANAGRAFICA_DA_COMPLETARE}
            </div>
          </div>
        )}
        {/* Sotto il logo il nome dello studio. Senza logo il nome è già scritto qui sopra: si
            aggiunge la ragione sociale solo se dice qualcosa in più (prima: «Bluecode  Bluecode»). */}
        {rigaSottoLogo && (
          <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--cat-societario)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rigaSottoLogo}>
            {rigaSottoLogo}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={styles.nav} aria-label="Menu principale">
        {navItems.filter((v) => !v.area && v.path !== '/aiuto').map(voce)}
        {AREE.map((area) => {
          const voci = navItems.filter((v) => v.area === area.id);
          // Un'area senza nessuna voce accessibile non si mostra.
          if (voci.length === 0) return null;
          const aperta = areaAperta(area.id);
          return (
            <div key={area.id} className={styles.area}>
              <button
                type="button"
                className={`${styles.areaTitolo} ${area.id === areaCorrente ? styles.areaCorrente : ''}`}
                aria-expanded={aperta}
                aria-controls={`menu-area-${area.id}`}
                onClick={() => cambiaArea(area.id)}
                title={area.id === areaCorrente ? 'Sei in quest’area: resta aperta' : aperta ? 'Chiudi l’area' : 'Apri l’area'}
              >
                <span className={styles.navIcon}>{area.icon}</span>
                <span>{area.label}</span>
                <span className={styles.areaConta}>{voci.length}</span>
                <span className={`${styles.areaFreccia} ${aperta ? styles.areaFrecciaAperta : ''}`} aria-hidden="true">▸</span>
              </button>
              {aperta && (
                <div id={`menu-area-${area.id}`} role="group" aria-label={area.label} className={styles.areaVoci}>
                  {voci.map(voce)}
                </div>
              )}
            </div>
          );
        })}
        {navItems.filter((v) => v.path === '/aiuto').map(voce)}
      </nav>

      {/* User Footer & Logout */}
      <div className={styles.user} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div
          onClick={onOpenProfile}
          title="👤 Clicca per aprire il tuo Profilo & Sicurezza Password"
          style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: onOpenProfile ? 'pointer' : 'default', flex: 1 }}
        >
          <div className={styles.avatar} style={{ background: 'var(--indigo)' }}>{initials}</div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <div className={styles.userName} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
            <div className={styles.userRole} style={{ fontSize: 10, color: 'var(--muted)' }}>{user?.ruolo || 'advisor'} {onOpenProfile ? '· Profilo ⚙️' : ''}</div>
          </div>
        </div>

        {onLogout && (
          <button
            onClick={onLogout}
            title="Disconnetti utente (Logout)"
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🚪
          </button>
        )}
      </div>
    </aside>
  );
}
