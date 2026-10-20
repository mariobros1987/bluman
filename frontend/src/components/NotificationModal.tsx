import { useState, useEffect } from 'react';
import { useToast } from './ui/ToastProvider';
import {
  haNotificheSenzaFascicolo,
  nonLetteVisibili,
  notificheVisibili,
  type FiltroNotifiche,
} from '../utils/notificheFiltro';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  type: 'delay' | 'blocked' | 'system' | 'signature';
  link?: string;
  /**
   * Il tipo d'evento del backend (`modulo_completato`, `messaggio_non_instradabile`, …).
   * `type` è il tipo *visivo*: due eventi diversi possono condividerlo, quindi per filtrare
   * serve questo. Assente sulle notifiche vecchie. Vedi `utils/notificheFiltro.ts`.
   */
  tipoEvento?: string;
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
  blocked: { icona: '🚫', colore: 'var(--red)' },
  delay: { icona: '⚠️', colore: 'var(--amber)' },
  signature: { icona: '✍️', colore: 'var(--purple)' },
  system: { icona: 'ℹ️', colore: 'var(--indigo)' },
};

interface NotificationModalProps {
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onSelectNotif?: (notif: NotificationItem) => void;
}

export function NotificationModal({ notifications, onClose, onMarkAllRead, onSelectNotif }: NotificationModalProps) {
  const toast = useToast();
  const unreadCount = notifications.filter(n => !n.read).length;
  // Voce 9(c), 09/10/2026 — «senza fascicolo»: isola gli avvisi di messaggio non archiviato.
  // Il filtro è locale al pannello e riparte da «tutte» a ogni apertura, come il resto dello
  // stato del pannello: nessuna memoria nascosta da qualche altra parte.
  const [filtro, setFiltro] = useState<FiltroNotifiche>('tutte');
  const mostraFiltro = haNotificheSenzaFascicolo(notifications);
  // Se il filtro è attivo e l'ultimo avviso non instradabile sparisce (letto e rimosso dalla
  // lista), il filtro tornerebbe a puntare su una lista vuota con il comando nascosto: nessun
  // modo di uscirne. Si rientra su «tutte».
  useEffect(() => {
    if (filtro === 'senza_fascicolo' && !mostraFiltro) setFiltro('tutte');
  }, [filtro, mostraFiltro]);
  const visibili = notificheVisibili(notifications, filtro);
  const nonLetteNelFiltro = nonLetteVisibili(notifications, filtro);
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
          body: 'Riceverai avvisi in tempo reale per firme, ritardi e aggiornamenti pratiche.',
          icon: '/favicon.ico',
        });
      } else if (perm === 'denied') {
        toast.attenzione('Le notifiche push sono state bloccate nel browser. Abilitale nelle impostazioni del sito per ricevere gli avvisi.');
      }
    } else {
      toast.attenzione('Il tuo browser non supporta le notifiche push desktop.');
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
        background: 'var(--surface-2)',
        border: '1px solid var(--pill-slate-bd)',
        borderRadius: 14,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        color: 'var(--pill-sky-fg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'var(--pill-slate-bg)', borderBottom: '1px solid var(--pill-slate-bd)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Centro Notifiche Studio</span>
          {nonLetteNelFiltro > 0 && (
            <span style={{ background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>
              {nonLetteNelFiltro} nuove
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              style={{ background: 'transparent', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              ✓ Segna lette
            </button>
          )}
          <button onClick={onClose} aria-label="Chiudi le notifiche" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Push Notification Banner */}
      <div style={{ background: 'var(--pill-blue-bg)', borderBottom: '1px solid var(--pill-blue-bg)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--pill-blue-fg)' }}>
          <span>📲</span>
          <span>
            {pushPermission === 'granted' ? 'Notifiche Push Browser: Attive' : 'Ricevi avvisi desktop istantanei'}
          </span>
        </div>
        {pushPermission === 'granted' ? (
          <button
            type="button"
            onClick={handleSendTestPush}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
          >
            Invia Test
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRequestPushPermission}
            style={{ background: 'var(--green)', color: 'var(--surface-2)', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
          >
            Attiva Push
          </button>
        )}
      </div>

      {/* Filtro «senza fascicolo» (voce 9(c), 09/10/2026).
          Compare solo quando c'è almeno un avviso da isolare: un filtro che porta al vuoto
          è peggio di un filtro assente. */}
      {mostraFiltro && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--pill-slate-bd)', background: 'var(--surface-2)' }}>
          {([
            { chiave: 'tutte' as const, etichetta: `Tutte (${notifications.length})` },
            { chiave: 'senza_fascicolo' as const, etichetta: `Senza fascicolo (${notificheVisibili(notifications, 'senza_fascicolo').length})` },
          ]).map(({ chiave, etichetta }) => {
            const attivo = filtro === chiave;
            return (
              <button
                key={chiave}
                type="button"
                onClick={() => setFiltro(chiave)}
                style={{
                  background: attivo ? 'var(--indigo)' : 'var(--pill-slate-bg)',
                  color: attivo ? '#fff' : 'var(--pill-slate-fg)',
                  border: `1px solid ${attivo ? 'var(--indigo)' : 'var(--pill-slate-bd)'}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                  fontSize: 10.5,
                  fontWeight: attivo ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {etichetta}
              </button>
            );
          })}
        </div>
      )}

      {/* Notifiche List — timeline raggruppata per giorno */}
      <div style={{ maxHeight: 360, overflowY: 'auto', padding: 8 }}>
        {visibili.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📭</div>
            {/* Il vuoto del filtro non è il vuoto della campanella: dirlo aiuta a capire che
                non manca niente, è che si sta guardando un sottoinsieme. */}
            {filtro === 'senza_fascicolo'
              ? 'Nessun messaggio in attesa di fascicolo'
              : 'Nessuna notifica in sospeso'}
          </div>
        ) : (
          (() => {
            let ultimoGiorno = '';
            return visibili.map((n) => {
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
                    <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '8px 4px 4px' }}>
                      {separatore}
                    </div>
                  )}
                  <div
                    onClick={() => onSelectNotif && onSelectNotif(n)}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      marginBottom: 6,
                      background: n.read ? '#1e293b40' : 'var(--pill-slate-bg)',
                      borderLeft: `3px solid ${stile.colore}`,
                      cursor: 'pointer',
                      transition: 'all .15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: n.read ? 'var(--muted)' : 'var(--pill-sky-fg)' }}>
                        {stile.icona} {n.title}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                        {n.timestamp ? tempoRelativo(n.timestamp) : n.time}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pill-slate-fg)', lineHeight: 1.4 }}>{n.body}</div>
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
