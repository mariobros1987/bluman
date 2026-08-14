import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV = [
  { path: '/',         label: 'Dashboard',      icon: '📊' },
  { path: '/projects', label: 'Progetti',        icon: '📁' },
  { path: '/clients',  label: 'Clienti',         icon: '👥' },
  { path: '/calendar', label: 'Calendario',      icon: '📅' },
  { path: '/library',  label: 'Libreria moduli', icon: '📚' },
  { path: '/settings', label: 'Impostazioni',    icon: '⚙️' },
];

interface SidebarProps {
  alertCount?: number;
}

export function Sidebar({ alertCount = 0 }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>🛡</div>
        <div>
          <div className={styles.logoText}>Bluecode</div>
          <div className={styles.logoSub}>Advisory Platform</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {NAV.map(item => (
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

      {/* User */}
      <div className={styles.user}>
        <div className={styles.avatar} style={{ background: '#6366f1' }}>JD</div>
        <div>
          <div className={styles.userName}>Joe Disabato</div>
          <div className={styles.userRole}>Bluecode Ltd, Malta</div>
        </div>
      </div>
    </aside>
  );
}
