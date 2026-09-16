import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { GlobalSearch } from './GlobalSearch';
import { NotificationModal, type NotificationItem } from '../NotificationModal';
import { UserProfileModal } from '../UserProfileModal';
import { MustChangePasswordModal } from '../MustChangePasswordModal';
import { fetchNotificheApi, markNotificheReadApi, apriStreamNotifiche, type NotificaStreamEvent } from '../../api/client';
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
  '/modelli':   'Cartella Modelli dello Studio',
  '/archivio':  'Archivio Documentale',
  '/audit':     'Log Audit Studio',
  '/timesheet': 'Timesheet Settimanale Ore',
};

const INITIAL_NOTIFICATIONS: NotificationItem[] = [];

// Blocco 3 — il backend classifica ogni notifica con `tipoEvento`; la campanella la
// traduce nel tipo visivo del pannello. Le righe vecchie (senza tipoEvento) ripiegano
// sull'euristica basata sull'oggetto.
const TIPO_PER_EVENTO: Record<string, NotificationItem['type']> = {
  modulo_completato: 'system',
  fattura_incassata: 'system',
  messaggio_cliente: 'system',
  documento_da_firmare: 'signature',
  firma_apposta: 'signature',
  verbale_disponibile: 'signature',
  scadenza_imminente: 'delay',
  // Un messaggio che non è potuto entrare in nessun fascicolo è un guasto, non una
  // scadenza: senza questa riga ricadeva nell'euristica qui sotto e si colorava come
  // un ritardo, cioè con l'icona che dice «aspetta», su una cosa che chiede di agire.
  messaggio_non_instradabile: 'blocked',
  chat_collegata_progetto: 'system',
};

function mapNotificaBackend(n: any): NotificationItem {
  const tsRaw = n.createdAt || n.inviataAt;
  const tipo: NotificationItem['type'] =
    (n.tipoEvento && TIPO_PER_EVENTO[n.tipoEvento]) ||
    (n.oggetto?.includes('KYC') ? 'blocked' : n.oggetto?.includes('Firma') || n.oggetto?.includes('firma') ? 'signature' : 'delay');
  return {
    id: n.id,
    title: n.oggetto || 'Notifica Studio',
    body: n.corpo || '',
    time: n.inviataAt ? new Date(n.inviataAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'Ora',
    read: n.statoLettura === 'letta',
    type: tipo,
    link: n.link || undefined,
    timestamp: tsRaw ? new Date(tsRaw).getTime() : undefined,
  };
}

function notificaDesktop(titolo: string, corpo: string) {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`🔔 BluMan Studio: ${titolo}`, { body: corpo, icon: '/favicon.ico' });
  }
}

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
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);

  useEffect(() => {
    setCurrentUser(user);
  }, [user]);

  useEffect(() => {
    const loadDbNotifs = async () => {
      const dbNotifs = await fetchNotificheApi();
      if (dbNotifs && Array.isArray(dbNotifs) && dbNotifs.length > 0) {
        const mapped: NotificationItem[] = dbNotifs.map(mapNotificaBackend);
        setNotifications(mapped);

        // Se l'utente ha abilitato le notifiche desktop nel browser, avvisa per la più recente non letta
        const unread = mapped.filter(n => !n.read);
        if (unread.length > 0) {
          notificaDesktop(unread[0].title, unread[0].body);
        }
      }
    };
    loadDbNotifs();
  }, []);

  // Blocco 3 — stream SSE: le notifiche create dal backend arrivano in tempo reale
  // senza ricaricare la pagina. Ogni evento viene inserito in testa alla lista.
  useEffect(() => {
    const chiudi = apriStreamNotifiche((evento: NotificaStreamEvent) => {
      const item = mapNotificaBackend({ ...evento, statoLettura: 'non_letta' });
      setNotifications(prev => {
        if (prev.some(n => n.id === item.id)) return prev; // già ricevuta (ricarica o doppio stream)
        return [item, ...prev].slice(0, 100);
      });
      notificaDesktop(item.title, item.body);
    });
    return chiudi;
  }, []);

  const title = TITLES[location.pathname] || (location.pathname.startsWith('/projects/') ? 'Dettaglio Progetto' : 'BluMan');
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    // §3.3 — come nel portale cliente: il badge si azzera subito (stato visuale), la
    // persistenza sul server è best-effort; un eventuale errore non deve rompere la UI.
    try {
      await markNotificheReadApi();
    } catch (err) {
      console.warn('markNotificheRead non persistito sul server:', err);
    }
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
        <Sidebar
          alertCount={unreadCount}
          user={currentUser}
          onLogout={onLogout}
          onOpenProfile={() => setProfileModalOpen(true)}
        />
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
            <GlobalSearch />
          </div>
          <div className={styles.topbarRight}>
            {/* Selettore Studio / Tenant Switcher — RISERVATO AL SUPER ADMIN */}
            {(() => {
              const currentTid = getCurrentTenantId(currentUser);
              const allTenants = getAllAvailableTenants();
              const isSuperAdmin = currentUser?.ruolo === 'super_admin' || currentUser?.role === 'super_admin';
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

            <QuickTimeTracker user={currentUser} />
            {currentUser && (
              <button
                onClick={() => setProfileModalOpen(true)}
                title="👤 Il Mio Profilo & Sicurezza Password"
                style={{
                  fontSize: 11,
                  color: 'var(--text)',
                  background: 'var(--card2)',
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: '1px solid #4338ca',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all .2s ease',
                }}
              >
                <span>👤</span>
                <span style={{ fontWeight: 700, color: 'var(--indigo-l)' }}>{currentUser.nome || currentUser.name}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>({currentUser.ruolo || 'advisor'})</span>
                <span style={{ fontSize: 10, color: '#a5b4fc', marginLeft: 2 }}>⚙️</span>
              </button>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                title="Disconnetti ed esci (Logout)"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: '#f87171',
                  borderRadius: 20,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all .2s ease',
                }}
              >
                <span>🚪</span> Esci
              </button>
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

        {profileModalOpen && (
          <UserProfileModal
            user={currentUser}
            onClose={() => setProfileModalOpen(false)}
            onUserUpdated={(updated) => setCurrentUser(updated)}
          />
        )}

        {/* 🔒 Modale Obbligatorio di Cambio Password al Primo Accesso (§23, §27) */}
        {(currentUser?.mustChangePassword || currentUser?.stato === 'invitato') && (
          <MustChangePasswordModal
            user={currentUser}
            onSuccess={() => {
              setCurrentUser((prev: any) => prev ? { ...prev, mustChangePassword: false, stato: 'attivo' } : null);
            }}
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
