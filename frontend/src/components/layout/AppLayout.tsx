import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationModal, type NotificationItem } from '../NotificationModal';
import { fetchNotificheApi, markNotificheReadApi } from '../../api/client';
import { QuickTimeTracker } from '../QuickTimeTracker';
import { getCurrentTenantId, getAllAvailableTenants, setActiveTenantId } from '../../utils/tenant';
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

const INITIAL_NOTIFICATIONS: NotificationItem[] = [];

interface AppLayoutProps {
  children: React.ReactNode;
  alertCount?: number;
  user?: any;
  onLogout?: () => void;
}

export function AppLayout({ children, alertCount: _alertCount = 0, user, onLogout }: AppLayoutProps) {
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

        // Se l'utente ha abilitato le notifiche desktop nel browser, invia la notifica push per quelle non lette
        const unread = mapped.filter(n => !n.read);
        if (unread.length > 0 && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`🔔 BluMan Studio: ${unread[0].title}`, {
            body: unread[0].body,
            icon: '/favicon.ico',
          });
        }
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
            {/* Selettore Studio / Tenant Switcher — RISERVATO AL SUPER ADMIN */}
            {(() => {
              const currentTid = getCurrentTenantId(user);
              const allTenants = getAllAvailableTenants();
              const isSuperAdmin = user?.ruolo === 'super_admin' || user?.role === 'super_admin';
              const currentTenantObj = allTenants.find(t => t.id === currentTid) || { id: currentTid, ragioneSociale: 'Studio Advisory' };

              if (!isSuperAdmin) {
                return (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#111827',
                      border: '1px solid #374151',
                      borderRadius: 20,
                      padding: '4px 12px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }}
                    title={`Studio Professionale Assegnato: ${currentTenantObj.ragioneSociale}`}
                  >
                    <span style={{ fontSize: 13 }}>🏛</span>
                    <span style={{ color: '#93c5fd', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {currentTenantObj.ragioneSociale}
                    </span>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 20, padding: '3px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
                  <span style={{ fontSize: 13 }} title="👑 Super Admin Multi-Tenant Switcher">🏛</span>
                  <select
                    value={currentTid}
                    onChange={(e) => {
                      setActiveTenantId(e.target.value);
                      window.location.reload();
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#c7d2fe', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', outline: 'none', maxWidth: 190 }}
                    title="👑 Cambia Studio Professionale Attivo (Super Admin)"
                  >
                    {allTenants.map(t => (
                      <option key={t.id} value={t.id} style={{ background: '#0f172a', color: '#f8fafc' }}>
                        {t.ragioneSociale}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

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
