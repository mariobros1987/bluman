// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Top Navbar del portale — logo studio, selettore multi-progetto, campanella
// notifiche del cliente, badge di accesso riservato e pulsante di uscita.

import { topNavStyle } from './styles';
import { tempoRelativo } from '../NotificationModal';
import type { NotificaPortale } from './types';
import type { StudioInfo } from '../../utils/tenant';

export interface PortalTopNavProps {
  currentStudioInfo: StudioInfo;
  clientName: string;
  clientProjects: any[];
  selectedProjectId: string;
  notifPortaleOpen: boolean;
  setNotifPortaleOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  notificheNonLette: number;
  handleSegnaNotificheLette: () => Promise<void>;
  notifichePortale: NotificaPortale[];
  handleSelezionaNotificaPortale: (n: NotificaPortale) => void;
  handleSelectProject: (pId: string, availableProjects?: any[]) => void;
  handleClientLogout: () => void;
}

export function PortalTopNav({
  currentStudioInfo,
  clientName,
  clientProjects,
  selectedProjectId,
  notifPortaleOpen,
  setNotifPortaleOpen,
  notificheNonLette,
  handleSegnaNotificheLette,
  notifichePortale,
  handleSelezionaNotificaPortale,
  handleSelectProject,
  handleClientLogout,
}: PortalTopNavProps) {
  return (
    <div style={topNavStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, background: 'var(--indigo)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 800 }}>🛡</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {currentStudioInfo.ragioneSociale || 'BluMan Advisory Platform'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Portale Riservato Cliente · <strong>{clientName}</strong>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* 📁 SELETTORE MULTI-PROGETTO CLIENTE */}
        {clientProjects.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', padding: '4px 12px', borderRadius: 10, border: '1px solid #4338ca' }}>
            <span style={{ fontSize: 14 }}>📁</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 9, color: '#a5b4fc', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '.3px' }}>
                Progetto Attivo ({clientProjects.length} disponibili)
              </span>
              <select
                value={selectedProjectId || clientProjects[0]?.id || ''}
                onChange={(e) => handleSelectProject(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 12,
                  padding: '2px 0',
                  cursor: 'pointer',
                  outline: 'none',
                  maxWidth: 240,
                }}
              >
                {clientProjects.map((p: any) => {
                  // Due progetti dello stesso cliente possono avere il nome identico (a
                  // database ce ne sono: "Struttura Holding — Famiglia Ricci" ×2, uno con
                  // moduli e uno vuoto). Col solo nome le due voci sono indistinguibili e
                  // non si capisce quale si è scelto: l'etichetta porta anche il conteggio
                  // dei moduli e l'avanzamento calcolato.
                  const nModuli = Array.isArray(p.moduli) ? p.moduli.length : 0;
                  const pct = p.avanzamento?.percentuale;
                  const dettaglio = [
                    p.giurisdizione ? `(${p.giurisdizione})` : null,
                    `${nModuli} ${nModuli === 1 ? 'modulo' : 'moduli'}`,
                    typeof pct === 'number' ? `${pct}%` : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <option key={p.id} value={p.id} style={{ background: '#161822', color: '#fff' }}>
                      {p.nome} — {dettaglio}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* 🔔 Blocco 3 — Campanella notifiche del cliente (documenti da firmare, pagamenti, firme) */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setNotifPortaleOpen((v) => !v)}
            title="Le mie notifiche"
            style={{
              position: 'relative',
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            🔔
            {notificheNonLette > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 800,
                  minWidth: 15,
                  height: 15,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 3px',
                }}
              >
                {notificheNonLette}
              </span>
            )}
          </button>

          {notifPortaleOpen && (
            <div
              style={{
                position: 'absolute',
                top: 40,
                right: 0,
                width: 340,
                maxWidth: '90vw',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 12,
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
                zIndex: 1200,
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>🔔 Le mie notifiche</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {notificheNonLette > 0 && (
                    <button
                      onClick={handleSegnaNotificheLette}
                      style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      ✓ Segna lette
                    </button>
                  )}
                  <button onClick={() => setNotifPortaleOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}>
                {notifichePortale.length === 0 ? (
                  <div style={{ padding: 22, textAlign: 'center', color: '#94a3b8', fontSize: 11.5 }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📭</div>
                    Nessuna notifica
                  </div>
                ) : (
                  notifichePortale.map((n) => {
                    const icona = n.tipoEvento === 'documento_da_firmare' ? '✍️'
                      : n.tipoEvento === 'firma_apposta' ? '✅'
                      : n.tipoEvento === 'fattura_incassata' ? '💶'
                      : n.tipoEvento === 'risposta_addendum' ? '📄'
                      : n.tipoEvento === 'risposta_proposta_dati' ? '🗂️'
                      : 'ℹ️';
                    const ts = n.createdAt ? new Date(n.createdAt).getTime() : 0;
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleSelezionaNotificaPortale(n)}
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          marginBottom: 5,
                          background: n.letto ? '#1e293b40' : '#1e293b',
                          borderLeft: n.letto ? '3px solid #334155' : '3px solid #6366f1',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 11.5, color: n.letto ? '#94a3b8' : '#f8fafc' }}>
                            {icona} {n.oggetto}
                          </span>
                          {ts > 0 && (
                            <span style={{ fontSize: 9.5, color: '#64748b', whiteSpace: 'nowrap' }}>{tempoRelativo(ts)}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#cbd5e1', lineHeight: 1.4 }}>{n.corpo}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', fontSize: 11, padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
          🔒 Accesso Riservato Cliente
        </div>
        <button
          onClick={handleClientLogout}
          style={{
            background: 'var(--card2)',
            border: '1px solid var(--border)',
            color: '#f87171',
            padding: '5px 12px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          title="Disconnettiti dal portale"
        >
          🚪 Esci
        </button>
      </div>
    </div>
  );
}
