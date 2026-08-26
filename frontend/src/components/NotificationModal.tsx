import { useState, useEffect } from 'react';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  type: 'delay' | 'blocked' | 'system' | 'signature';
  link?: string;
  /** Epoch ms: quando presente il pannello mostra il tempo relativo ("5 min fa"). */
  timestamp?: number;
}

/** "adesso", "5 min fa", "2 h fa", "ieri", "18 ago" — per la timeline delle notifiche. */
export function tempoRelativo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'adesso';
  const minuti = Math.floor(diffMs / 60_000);
  if (minuti < 60) return `${minuti} min fa`;
  const ore = Math.floor(minuti / 60);
  if (ore < 24) return `${ore} h fa`;
  const giorni = Math.floor(ore / 24);
  if (giorni === 1) return 'ieri';
  if (giorni < 7) return `${giorni} giorni fa`;
  return new Date(timestamp).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/** Etichetta del separatore di giorno nella timeline: Oggi / Ieri / data estesa. */
export function etichettaGiorno(timestamp: number): string {
  const d = new Date(timestamp);
  const oggi = new Date();
  const inizioOggi = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()).getTime();
  if (timestamp >= inizioOggi) return 'Oggi';
  if (timestamp >= inizioOggi - 24 * 60 * 60 * 1000) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

const STILE_TIPO: Record<NotificationItem['type'], { icona: string; colore: string }> = {
  blocked: { icona: '🚫', colore: '#ef4444' },
  delay: { icona: '⚠️', colore: '#f59e0b' },
  signature: { icona: '✍️', colore: '#8b5cf6' },
  system: { icona: 'ℹ️', colore: '#6366f1' },
};

interface NotificationModalProps {
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onSelectNotif?: (notif: NotificationItem) => void;
}

export function NotificationModal({ notifications, onClose, onMarkAllRead, onSelectNotif }: NotificationModalProps) {
  const unreadCount = notifications.filter(n => !n.read).length;
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  const handleRequestPushPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      if (perm === 'granted') {
        new Notification('🔔 Notifiche Push Studio BluMan Attive', {
          body: 'Riceverai avvisi in tempo reale per firme FEA, ritardi e aggiornamenti pratiche.',
          icon: '/favicon.ico',
        });
      } else if (perm === 'denied') {
        alert('Le notifiche push sono state bloccate nel browser. Abilitale nelle impostazioni del sito per ricevere gli avvisi.');
      }
    } else {
      alert('Il tuo browser non supporta le notifiche push desktop.');
    }
  };

  const handleSendTestPush = () => {
    if (pushPermission === 'granted') {
      new Notification('⚡ Test Notifica Push Desktop BluMan', {
        body: 'Le notifiche di sistema sono perfettamente collegate e operative!',
        icon: '/favicon.ico',
      });
    } else {
      handleRequestPushPermission();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        right: 20,
        width: 390,
        maxWidth: '92vw',
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 14,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Centro Notifiche Studio</span>
          {unreadCount > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>
              {unreadCount} nuove
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              ✓ Segna lette
            </button>
          )}
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Push Notification Banner */}
      <div style={{ background: '#172554', borderBottom: '1px solid #1e3a8a', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#93c5fd' }}>
          <span>📲</span>
          <span>
            {pushPermission === 'granted' ? 'Notifiche Push Browser: Attive' : 'Ricevi avvisi desktop istantanei'}
          </span>
        </div>
        {pushPermission === 'granted' ? (
          <button
            type="button"
            onClick={handleSendTestPush}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
          >
            Invia Test
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRequestPushPermission}
            style={{ background: '#22c55e', color: '#0f172a', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
          >
            Attiva Push
          </button>
        )}
      </div>

      {/* Notifiche List — timeline raggruppata per giorno */}
      <div style={{ maxHeight: 360, overflowY: 'auto', padding: 8 }}>
        {notifications.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📭</div>
            Nessuna notifica in sospeso
          </div>
        ) : (
          (() => {
            let ultimoGiorno = '';
            return notifications.map((n) => {
              const stile = STILE_TIPO[n.type] || STILE_TIPO.system;
              // Separatore di giorno: compare quando si cambia data rispetto alla notifica sopra.
              let separatore: string | null = null;
              if (n.timestamp) {
                const giorno = etichettaGiorno(n.timestamp);
                if (giorno !== ultimoGiorno) {
                  ultimoGiorno = giorno;
                  separatore = giorno;
                }
              }
              return (
                <div key={n.id}>
                  {separatore && (
                    <div style={{ fontSize: 9.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', padding: '8px 4px 4px' }}>
                      {separatore}
                    </div>
                  )}
                  <div
                    onClick={() => onSelectNotif && onSelectNotif(n)}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      marginBottom: 6,
                      background: n.read ? '#1e293b40' : '#1e293b',
                      borderLeft: `3px solid ${stile.colore}`,
                      cursor: 'pointer',
                      transition: 'all .15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: n.read ? '#94a3b8' : '#f8fafc' }}>
                        {stile.icona} {n.title}
                      </span>
                      <span style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap', marginLeft: 8 }}>
                        {n.timestamp ? tempoRelativo(n.timestamp) : n.time}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>{n.body}</div>
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>
    </div>
  );
}
