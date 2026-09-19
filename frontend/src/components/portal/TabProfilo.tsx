import type React from 'react';
import { docBoxStyle } from './styles';

export interface TabProfiloProps {
  clientName: string;
  clientObj: any;
  loginEmail: string;
  handleSaveClientPassword: (e: React.FormEvent) => Promise<void>;
  clientPassMsg: { text: string; type: 'success' | 'error' } | null;
  clientPassShow: boolean;
  setClientPassShow: (valore: boolean) => void;
  clientPassCurrent: string;
  setClientPassCurrent: (valore: string) => void;
  clientPassNew: string;
  setClientPassNew: (valore: string) => void;
  clientPassConfirm: string;
  setClientPassConfirm: (valore: string) => void;
  clientPassLoading: boolean;
}

export function TabProfilo({
  clientName,
  clientObj,
  loginEmail,
  handleSaveClientPassword,
  clientPassMsg,
  clientPassShow,
  setClientPassShow,
  clientPassCurrent,
  setClientPassCurrent,
  clientPassNew,
  setClientPassNew,
  clientPassConfirm,
  setClientPassConfirm,
  clientPassLoading,
}: TabProfiloProps) {
  return (
    <div style={docBoxStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>👤 Profilo Riservato & Sicurezza Accesso</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
        Gestisci i dati anagrafici del tuo account, i recapiti per le notifiche di sicurezza e imposta la tua password personale per accedere direttamente al portale.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Card Dati Anagrafici & Contatti */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🏛</span> Dati Intestatario & Recapiti
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Ragione Sociale / Intestatario</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>{clientName}</div>
            </div>

            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Email Principale Notifiche & OTP</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{clientObj?.email || loginEmail || 'Non specificata'}</div>
            </div>

            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Telefono & WhatsApp di Sicurezza</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>
                {clientObj?.cellulare || (clientObj as any)?.referentiJson?.whatsapp || clientObj?.telefono || 'Non configurato'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Giurisdizione Incarico</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>{clientObj?.giurisdizione || 'Malta'}</div>
              </div>
              <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Stato Accesso Portale</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: clientObj?.hasPassword ? 'var(--green)' : 'var(--amber)', marginTop: 2 }}>
                  {clientObj?.hasPassword ? '🟢 Password Attiva' : '⚪ Solo Magic Link'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            ℹ️ Per modificare i dati anagrafici fiscali (P.IVA, SDI, Sede), puoi compilare la scheda <strong>📋 3. Form Dati Societari</strong> o richiedere l'aggiornamento all'Advisor.
          </div>
        </div>

        {/* Card Imposta / Cambia Password Portale */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔐</span> Imposta / Modifica Password Portale
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
            Impostando una password personale potrai accedere direttamente al portale con la tua email (<strong>{clientObj?.email || loginEmail || clientName}</strong>) in qualsiasi momento, senza dover richiedere un nuovo Magic Link via email.
          </div>

          <form onSubmit={handleSaveClientPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {clientPassMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: clientPassMsg.type === 'success' ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
                  color: clientPassMsg.type === 'success' ? 'var(--green)' : 'var(--pill-red-fg)',
                  border: `1px solid ${clientPassMsg.type === 'success' ? 'var(--green)' : 'var(--red)'}`,
                }}
              >
                {clientPassMsg.text}
              </div>
            )}

            {clientObj?.hasPassword && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Password Attuale (se già impostata)
                </label>
                <input
                  type={clientPassShow ? 'text' : 'password'}
                  value={clientPassCurrent}
                  onChange={e => setClientPassCurrent(e.target.value)}
                  placeholder="Inserisci password attuale se la stai modificando"
                  style={{
                    width: '100%',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                  Nuova Password Portale * (min. 6 caratteri)
                </label>
                <button
                  type="button"
                  onClick={() => setClientPassShow(!clientPassShow)}
                  style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontSize: 10.5, cursor: 'pointer', padding: 0 }}
                >
                  {clientPassShow ? '🙈 Nascondi' : '👁 Mostra'}
                </button>
              </div>
              <input
                type={clientPassShow ? 'text' : 'password'}
                value={clientPassNew}
                onChange={e => setClientPassNew(e.target.value)}
                placeholder="es. PasswordSicura2026!"
                required
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  color: 'var(--text)',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                Conferma Nuova Password *
              </label>
              <input
                type={clientPassShow ? 'text' : 'password'}
                value={clientPassConfirm}
                onChange={e => setClientPassConfirm(e.target.value)}
                placeholder="Ripeti la nuova password"
                required
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '9px 12px',
                  color: 'var(--text)',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              />
              {clientPassConfirm && clientPassNew !== clientPassConfirm && (
                <span style={{ fontSize: 10, color: 'var(--pill-red-fg)', marginTop: 4, display: 'block' }}>
                  ⚠ Le due password non coincidono.
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={clientPassLoading || !clientPassNew || clientPassNew !== clientPassConfirm}
              style={{
                background: 'var(--indigo)',
                color: '#fff',
                border: 'none',
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                opacity: (!clientPassNew || clientPassNew !== clientPassConfirm || clientPassLoading) ? 0.6 : 1,
                marginTop: 6,
              }}
            >
              {clientPassLoading ? 'Salvataggio in corso...' : '🔒 Salva Password Portale'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
