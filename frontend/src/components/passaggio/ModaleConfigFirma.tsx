import React from 'react';
import type { ConfigFirmaModalState } from './types';
import { closeBtnStyle } from './passaggioStyles';

// ─── Modale Configurazione Documento (Upload / Genera da Template) ─────
export function ModaleConfigFirma({
  configFirmaModal,
  setConfigFirmaModal,
  eseguiSalvataggioConfigurato,
}: {
  configFirmaModal: ConfigFirmaModalState;
  setConfigFirmaModal: React.Dispatch<React.SetStateAction<ConfigFirmaModalState | null>>;
  eseguiSalvataggioConfigurato: () => void;
}) {
  return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000, padding: 16 }}>
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.8)' }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>✍️</span> Configurazione Documento & Metodo di Firma
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Definisci se questo atto richiede la firma del cliente e con quale modalità legale.
                  </div>
                </div>
                <button type="button" onClick={() => setConfigFirmaModal(null)} style={closeBtnStyle}>✕</button>
              </div>

              {/* Body */}
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Titolo Atto */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                    📄 Titolo / Nome Documento:
                  </label>
                  <input
                    type="text"
                    value={configFirmaModal.titolo}
                    onChange={(e) => setConfigFirmaModal({ ...configFirmaModal, titolo: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12, outline: 'none' }}
                  />
                </div>

                {/* Scelta Richiede Firma */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                    🔒 Obbligo di Firma del Cliente:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, richiedeFirma: true })}
                      style={{
                        background: configFirmaModal.richiedeFirma ? '#1e1b4b' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.richiedeFirma ? 'var(--indigo)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.richiedeFirma ? '#a5b4fc' : 'var(--text)' }}>
                        ✍️ Richiede Firma
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Il cliente deve apporre la firma prima di considerare l'atto completato.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, richiedeFirma: false })}
                      style={{
                        background: !configFirmaModal.richiedeFirma ? '#1e1b4b' : 'var(--card)',
                        border: `1.5px solid ${!configFirmaModal.richiedeFirma ? 'var(--indigo)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: !configFirmaModal.richiedeFirma ? '#a5b4fc' : 'var(--text)' }}>
                        📄 Sola Consultazione
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Atto informativo, verbale o visura depositata (non richiede firma).
                      </div>
                    </button>
                  </div>
                </div>

                {/* Metodi di Firma Ammessi (visibile solo se richiede firma) */}
                {configFirmaModal.richiedeFirma && (
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                      🖊️ Seleziona il Metodo di Firma Ammesso per il Cliente:
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        {
                          id: 'fea_otp' as const,
                          icon: '📱',
                          titolo: 'Firma Elettronica Semplice (OTP + Pad grafometrico)',
                          desc: 'Codice OTP via SMS/Email/WhatsApp + Firma Grafometrica ai sensi dell\'art. 20 del CAD. Istantanea e guidata.',
                          tag: 'CONSIGLIATO',
                          tagColor: '#34d399',
                        },
                        {
                          id: 'manuale_scansionata' as const,
                          icon: '🖊️',
                          titolo: 'Firma Olografa Tradizionale (Scarica, Firma e Ricarica)',
                          desc: 'Il cliente scarica il PDF generato, lo stampa, lo firma a penna e ricarica la scansione o foto nel portale.',
                          tag: 'TRADIZIONALE',
                          tagColor: '#94a3b8',
                        },
                        {
                          id: 'qualificata_esterna' as const,
                          icon: '🔐',
                          titolo: 'Firma Digitale Qualificata (QES / Token SmartCard / SPID)',
                          desc: 'Il cliente appone la propria firma qualificata tramite dispositivo personale (Aruba, InfoCert, Namirial, SPID) e carica il file .p7m.',
                          tag: 'ALTA SICUREZZA',
                          tagColor: '#818cf8',
                        },
                        {
                          id: 'tutte' as const,
                          icon: '🌐',
                          titolo: 'Tutte le modalità abilitate (Scelta libera del Cliente)',
                          desc: 'Il cliente potrà scegliere in autonomia la modalità di sottoscrizione preferita direttamente dal Portale.',
                          tag: 'FLESSIBILE',
                          tagColor: '#f59e0b',
                        },
                      ].map((m) => (
                        <div
                          key={m.id}
                          onClick={() => setConfigFirmaModal({ ...configFirmaModal, metodoFirma: m.id })}
                          style={{
                            background: configFirmaModal.metodoFirma === m.id ? '#1e1b4b' : 'var(--card)',
                            border: `1.5px solid ${configFirmaModal.metodoFirma === m.id ? 'var(--indigo)' : 'var(--border)'}`,
                            borderRadius: 10, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{m.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.metodoFirma === m.id ? '#c7d2fe' : 'var(--text)' }}>
                                {m.titolo}
                              </span>
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: '#00000040', color: m.tagColor, border: `1px solid ${m.tagColor}40` }}>
                                {m.tag}
                              </span>
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.35 }}>
                              {m.desc}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Visibilità Iniziale Workflow */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                    🚀 Visibilità Iniziale nel Portale Cliente:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, statoDoc: 'bozza' })}
                      style={{
                        background: configFirmaModal.statoDoc === 'bozza' ? '#2d1a05' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.statoDoc === 'bozza' ? '#f59e0b' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.statoDoc === 'bozza' ? '#fcd34d' : 'var(--text)' }}>
                        🔒 Bozza Interna
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Salvato per revisione interna studio. Cliccherai "Pubblica" quando pronto.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, statoDoc: 'pubblicato' })}
                      style={{
                        background: configFirmaModal.statoDoc === 'pubblicato' ? '#064e3b' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.statoDoc === 'pubblicato' ? '#10b981' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.statoDoc === 'pubblicato' ? '#6ee7b7' : 'var(--text)' }}>
                        🚀 Pubblica Subito
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Subito visibile al cliente nel portale con notifica automatica.
                      </div>
                    </button>
                  </div>
                </div>

                {/* Data Scadenza Opzionale */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    📅 Scadenza / Termine Firma (Opzionale):
                  </label>
                  <input
                    type="date"
                    value={configFirmaModal.dataScadenzaDoc || ''}
                    onChange={(e) => setConfigFirmaModal({ ...configFirmaModal, dataScadenzaDoc: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 11.5 }}
                  />
                </div>
              </div>

              {/* Footer Modal */}
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setConfigFirmaModal(null)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => eseguiSalvataggioConfigurato()}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  ✓ Salva e Collega Atto
                </button>
              </div>
            </div>
          </div>
  );
}
