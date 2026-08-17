import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationModal, type NotificationItem } from '../NotificationModal';
import { fetchNotificheApi, markNotificheReadApi } from '../../api/client';
import { QuickTimeTracker } from '../QuickTimeTracker';
import styles from './AppLayout.module.css';

const TITLES: Record<string, string> = {
  '/':          'Dashboard',
  '/projects':  'Progetti',
  '/clients':   'Clienti',
  '/calendar':  'Calendario',
  '/library':   'Libreria moduli',
  '/settings':  'Impostazioni',
  '/invoices':  'Fatture & Pagamenti',
  '/documents': 'Document Studio (Word & Contratti)',
  '/audit':     'Log Audit Studio',
};

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n1',
    title: 'Struttura Trust (Famiglia Ricci)',
    body: 'In attesa documentazione fiduciaria dal trustee designato.',
    time: '10 min fa',
    read: false,
    type: 'delay',
    link: '/projects/proj-01',
  },
  {
    id: 'n2',
    title: 'Apertura Conti (Famiglia Ricci)',
    body: 'KYC respinto da Bank of Valletta — documentazione integrativa urgente.',
    time: '1 ora fa',
    read: false,
    type: 'blocked',
    link: '/projects/proj-01',
  },
  {
    id: 'n3',
    title: 'Engagement Letter Firmata',
    body: 'Marco Ricci ha firmato la proposta d ordine 1-click dal Portale.',
    time: '3 ore fa',
    read: true,
    type: 'signature',
    link: '/clients',
  },
];

interface AppLayoutProps {
  children: React.ReactNode;
  alertCount?: number;
  user?: any;
  onLogout?: () => void;
}

export function AppLayout({ children, alertCount: _alertCount = 2, user, onLogout }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

  useEffect(() => {
    const loadDbNotifs = async () => {
      const dbNotifs = await fetchNotificheApi();
      if (dbNotifs && Array.isArray(dbNotifs) && dbNotifs.length > 0) {
        const mapped: NotificationItem[] = dbNotifs.map((n: any) => ({
          id: n.id,
          title: n.oggetto || 'Notifica Studio',
          body: n.corpo || '',
          time: n.inviataAt ? new Date(n.inviataAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'Ora',
          read: n.statoLettura === 'letta',
          type: n.oggetto?.includes('KYC') ? 'blocked' : n.oggetto?.includes('Firma') ? 'signature' : 'delay',
        }));
        setNotifications(mapped);
      }
    };
    loadDbNotifs();
  }, []);

  const title = TITLES[location.pathname] || (location.pathname.startsWith('/projects/') ? 'Dettaglio Progetto' : 'BluMan');
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await markNotificheReadApi();
  };

  const handleSelectNotif = (notif: NotificationItem) => {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setNotifOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  return (
    <div className={styles.app}>
      <div className={`${styles.sidebarWrapper} ${mobileOpen ? styles.sidebarMobileOpen : ''}`}>
        <Sidebar alertCount={unreadCount} user={user} onLogout={onLogout} />
      </div>

      {mobileOpen && (
        <div className={styles.backdrop} onClick={() => setMobileOpen(false)} />
      )}

      <div className={styles.main}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.menuToggle} onClick={() => setMobileOpen(!mobileOpen)}>
              ☰
            </button>
            <div className={styles.topbarTitle}>{title}</div>
          </div>
          <div className={styles.topbarRight}>
            <QuickTimeTracker user={user} />
            {user && (
              <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)' }}>
                👤 {user.nome || user.name} ({user.ruolo || 'advisor'})
              </div>
            )}
            {unreadCount > 0 && (
              <div className={styles.alertPill} onClick={() => setNotifOpen(true)} style={{ cursor: 'pointer' }}>
                ⚠ {unreadCount} ritard{unreadCount === 1 ? 'o' : 'i'}
              </div>
            )}
            <button
              className={styles.notifBtn}
              title="Notifiche Studio"
              onClick={() => setNotifOpen(!notifOpen)}
              style={{ position: 'relative' }}
            >
              🔔
              {unreadCount > 0 && (
                <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
              )}
            </button>
          </div>
        </div>

        {notifOpen && (
          <NotificationModal
            notifications={notifications}
            onClose={() => setNotifOpen(false)}
            onMarkAllRead={handleMarkAllRead}
            onSelectNotif={handleSelectNotif}
          />
        )}

        {/* Page content */}
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
