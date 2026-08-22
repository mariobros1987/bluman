import { NavLink } from 'react-router-dom';
import { getFormattedLogoUrl } from '../../utils';
import { getUserPermission } from '../../utils/rbac';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../../utils/tenant';
import styles from './Sidebar.module.css';

const NAV = [
  { path: '/',           moduleKey: 'dashboard',   label: 'Dashboard',             icon: '📊' },
  { path: '/projects',   moduleKey: 'projects',    label: 'Progetti',               icon: '📁' },
  { path: '/clients',    moduleKey: 'clients',     label: 'Clienti',                icon: '👥' },
  { path: '/calendar',   moduleKey: 'calendar',    label: 'Calendario',             icon: '📅' },
  { path: '/invoices',   moduleKey: 'invoices',    label: 'Fatture & SDI',          icon: '💶' },
  { path: '/scadenzario',moduleKey: 'scadenzario', label: 'Scadenzario Incassi',    icon: '📅' },
  { path: '/primanota',  moduleKey: 'primanota',   label: 'Registro Prima Nota',    icon: '💰' },
  { path: '/banks',      moduleKey: 'banks',       label: 'Banche & Conti',         icon: '🏦' },
  { path: '/retainers',  moduleKey: 'retainers',   label: 'Contratti Retainer',    icon: '🔄' },
  { path: '/documents',  moduleKey: 'documents',   label: 'Document Studio (Word)', icon: '📝' },
  { path: '/audit',      moduleKey: 'audit',       label: 'Log Audit Studio',       icon: '📋' },
  { path: '/library',    moduleKey: 'library',     label: 'Libreria moduli',        icon: '📚' },
  { path: '/settings',   moduleKey: 'settings',    label: 'Impostazioni',           icon: '⚙️' },
];

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

  const userName = user?.nome || user?.name || studioInfo.leadAdvisor || 'Operatore Studio';
  const initials = userName.substring(0, 2).toUpperCase();

  const isSuperAdmin = user?.ruolo === 'super_admin';
  const baseItems = isSuperAdmin
    ? [...NAV, { path: '/admin/tenants', moduleKey: 'admin', label: 'Multi-Tenant Admin', icon: '👑' }]
    : NAV;

  // Filtra i moduli bloccati per l'utente loggato in base alla Matrice Permessi RBAC
  const navItems = baseItems.filter(item => {
    if (item.path === '/') return true;
    if (item.path === '/admin/tenants') return isSuperAdmin;
    const perm = getUserPermission(user, item.moduleKey);
    return perm !== 'denied';
  });

  return (
    <aside className={styles.sidebar}>
      {/* Logo & Tenant Studio Badge */}
      <div className={styles.logo} style={{ background: '#0f172a', padding: '10px 14px', borderRadius: 10, border: '1px solid #1e293b', marginBottom: 16 }}>
        {effectiveLogo ? (
          <img
            src={getFormattedLogoUrl(effectiveLogo)}
            alt={studioInfo.ragioneSociale || 'Studio'}
            style={{ height: 32, maxWidth: 160, objectFit: 'contain', display: 'block' }}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#38bdf8', border: '1px solid #334155' }}>
              🏛
            </div>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 125 }}>
              {studioInfo.nomeBreve || 'Studio'}
            </div>
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          🏛 {studioInfo.nomeBreve || studioInfo.ragioneSociale || 'Studio Professionale'}
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span>{item.label}</span>
            {item.path === '/' && alertCount > 0 && (
              <span className={styles.navBadge}>{alertCount}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User Footer & Logout */}
      <div className={styles.user} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div
          onClick={onOpenProfile}
          title="👤 Clicca per aprire il tuo Profilo & Sicurezza Password"
          style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: onOpenProfile ? 'pointer' : 'default', flex: 1 }}
        >
          <div className={styles.avatar} style={{ background: '#6366f1' }}>{initials}</div>
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
