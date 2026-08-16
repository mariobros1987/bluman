import React from 'react';
import { NavLink } from 'react-router-dom';
import { getFormattedLogoUrl } from '../../utils';
import styles from './Sidebar.module.css';

const NAV = [
  { path: '/',           label: 'Dashboard',             icon: '📊' },
  { path: '/projects',   label: 'Progetti',               icon: '📁' },
  { path: '/clients',    label: 'Clienti',                icon: '👥' },
  { path: '/calendar',   label: 'Calendario',             icon: '📅' },
  { path: '/invoices',   label: 'Fatture & SDI',          icon: '💶' },
  { path: '/scadenzario',label: 'Scadenzario Incassi',    icon: '📅' },
  { path: '/primanota',  label: 'Registro Prima Nota',    icon: '💰' },
  { path: '/retainers',  label: 'Contratti Retainer',    icon: '🔄' },
  { path: '/audit',      label: 'Log Audit Studio',       icon: '📋' },
  { path: '/library',    label: 'Libreria moduli',        icon: '📚' },
  { path: '/settings',   label: 'Impostazioni',           icon: '⚙️' },
];

interface SidebarProps {
  alertCount?: number;
  user?: any;
  onLogout?: () => void;
}

export function Sidebar({ alertCount = 0, user, onLogout }: SidebarProps) {
  const userName = user?.nome || user?.name || 'Joe Disabato';
  const initials = userName.substring(0, 2).toUpperCase();

  const isSuperAdmin = user?.ruolo === 'super_admin';
  const navItems = isSuperAdmin
    ? [...NAV, { path: '/admin/tenants', label: 'Multi-Tenant Admin', icon: '👑' }]
    : NAV;

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo} style={{ background: '#0f172a', padding: '10px 14px', borderRadius: 10, border: '1px solid #1e293b', marginBottom: 16 }}>
        <img
          src={getFormattedLogoUrl(localStorage.getItem('bluman_logo_url'))}
          alt="BLUECODE"
          style={{ height: 38, maxWidth: 170, objectFit: 'contain', display: 'block' }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/logo.png';
          }}
        />
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
      <div className={styles.user} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div className={styles.avatar} style={{ background: '#6366f1' }}>{initials}</div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <div className={styles.userName} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
            <div className={styles.userRole} style={{ fontSize: 10, color: 'var(--muted)' }}>{user?.ruolo || 'advisor'}</div>
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
