import type React from 'react';
import type { StudioInfo } from '../../utils/tenant';

export interface PortalLoginProps {
  currentStudioInfo: StudioInfo;
  authMode: 'credentials' | 'magic';
  setAuthMode: (mode: 'credentials' | 'magic') => void;
  accessoNegato: string | null;
  loginError: string | null;
  setLoginError: (errore: string | null) => void;
  loginEmail: string;
  setLoginEmail: (valore: string) => void;
  loginPassword: string;
  setLoginPassword: (valore: string) => void;
  loginLoading: boolean;
  manualMagicToken: string;
  setManualMagicToken: (valore: string) => void;
  handleClientLogin: (e: React.FormEvent) => void;
  handleManualMagicSubmit: (e: React.FormEvent) => void;
}

export function PortalLogin({
  currentStudioInfo,
  authMode,
  setAuthMode,
  accessoNegato,
  loginError,
  setLoginError,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  loginLoading,
  manualMagicToken,
  setManualMagicToken,
  handleClientLogin,
  handleManualMagicSubmit,
}: PortalLoginProps) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'var(--indigo)', color: 'var(--on-accent)', fontSize: 26, marginBottom: 12 }}>
            🛡
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {currentStudioInfo.ragioneSociale || 'BluMan Advisory'}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Portale Riservato Clienti • Consultazione Incarichi & Firma Elettronica Semplice
          </p>
        </div>

        {/* Switcher Modalità Accesso */}
        <div style={{ background: 'var(--card2)', padding: 4, borderRadius: 12, display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => { setAuthMode('credentials'); setLoginError(null); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: authMode === 'credentials' ? 'var(--indigo)' : 'transparent',
              color: authMode === 'credentials' ? 'var(--on-accent)' : 'var(--muted)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all .2s ease',
            }}
          >
            🔑 Email e Password
          </button>
          <button
            type="button"
            onClick={() => { setAuthMode('magic'); setLoginError(null); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: authMode === 'magic' ? 'var(--indigo)' : 'transparent',
              color: authMode === 'magic' ? 'var(--on-accent)' : 'var(--muted)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all .2s ease',
            }}
          >
            🔗 Magic Link
          </button>
        </div>

        {accessoNegato && (
          <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠️ {accessoNegato}
          </div>
        )}

        {loginError && (
          <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠️ {loginError}
          </div>
        )}

        {/* Form Credenziali Classico */}
        {authMode === 'credentials' ? (
          <form onSubmit={handleClientLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email di Registrazione Cliente *</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                placeholder="es. mario.rossi@holding.it"
                required
                style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password Riservata *</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                background: 'var(--indigo)',
                color: 'var(--on-accent)',
                border: 'none',
                padding: '12px 20px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: loginLoading ? 'wait' : 'pointer',
                marginTop: 6,
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              }}
            >
              {loginLoading ? 'Verifica credenziali in corso...' : 'Accedi al Portale Riservato ➔'}
            </button>
          </form>
        ) : (
          /* Form Magic Token */
          <form onSubmit={handleManualMagicSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice o Token Magic Link</label>
              <input
                type="text"
                value={manualMagicToken}
                onChange={e => setManualMagicToken(e.target.value)}
                placeholder="es. client_12345678_abcdef..."
                required
                style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              />
              <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Incolla il codice Magic Token che hai ricevuto per email o WhatsApp dal tuo Advisor.
              </span>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                background: 'var(--indigo)',
                color: 'var(--on-accent)',
                border: 'none',
                padding: '12px 20px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: loginLoading ? 'wait' : 'pointer',
                marginTop: 6,
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              }}
            >
              {loginLoading ? 'Verifica Magic Token...' : 'Accedi con Magic Token ➔'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            🔒 Connessione protetta con crittografia end-to-end · Firma elettronica semplice (OTP verificata) · art. 20 CAD
          </span>
        </div>
      </div>
    </div>
  );
}
