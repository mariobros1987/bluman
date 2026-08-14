import React, { useState } from 'react';
import { loginApi } from '../api/client';

interface LoginPageProps {
  onLoginSuccess: (user: any, token: string) => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('joe@bluecode.advisory');
  const [password, setPassword] = useState('••••••••');
  const [selectedRole, setSelectedRole] = useState<'advisor' | 'super_admin' | 'collaboratore_interno'>('advisor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let emailToUse = email;
      if (selectedRole === 'super_admin') emailToUse = 'admin@bluecode.advisory';
      if (selectedRole === 'collaboratore_interno') emailToUse = 'operator@bluecode.advisory';

      const res = await loginApi(emailToUse, password);
      if (res && res.token) {
        localStorage.setItem('bluman_token', res.token);
        localStorage.setItem('bluman_user', JSON.stringify(res.user));
        onLoginSuccess(res.user, res.token);
      } else {
        setError('Credenziali non valide o utente non autorizzato.');
      }
    } catch (err: any) {
      setError(err.message || 'Errore durante il tentativo di login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'var(--indigo)', color: '#fff', fontSize: 26, marginBottom: 12 }}>
            🛡
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>BluMan Advisory</h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Piattaforma ERP per Studi di Consulenza & Wealth Protection</p>
        </div>

        {/* Quick Role Selector */}
        <div style={{ background: 'var(--card2)', padding: 4, borderRadius: 12, display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => { setSelectedRole('advisor'); setEmail('joe@bluecode.advisory'); }}
            style={roleBtnStyle(selectedRole === 'advisor')}
          >
            👨‍💼 Advisor
          </button>
          <button
            type="button"
            onClick={() => { setSelectedRole('collaboratore_interno'); setEmail('operator@bluecode.advisory'); }}
            style={roleBtnStyle(selectedRole === 'collaboratore_interno')}
          >
            👷 Operatore
          </button>
          <button
            type="button"
            onClick={() => { setSelectedRole('super_admin'); setEmail('admin@bluecode.advisory'); }}
            style={roleBtnStyle(selectedRole === 'super_admin')}
          >
            👑 SuperAdmin
          </button>
        </div>

        {error && (
          <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Form Login */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Aziendale Studio *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ width: '100%', fontSize: 13, fontWeight: 600 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password di Accesso *</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ width: '100%', fontSize: 13 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked /> Ricordami su questo dispositivo
            </label>
            <a href="#forgot" onClick={e => { e.preventDefault(); alert('Contatta il Super Admin per il reset password.'); }} style={{ color: 'var(--indigo-l)', textDecoration: 'none' }}>
              Password dimenticata?
            </a>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'var(--indigo)',
              color: '#fff',
              border: 'none',
              padding: '11px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: 6,
              boxShadow: '0 4px 16px rgba(99,102,241,.4)',
            }}
          >
            {loading ? 'Autenticazione in corso...' : '🔒 Accedi alla Piattaforma'}
          </button>
        </form>

        {/* Footer Info */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
          🔒 Connessione cifrata TLS · Multi-tenant RLS PostgreSQL
        </div>
      </div>
    </div>
  );
}

const roleBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px 8px',
  borderRadius: 8,
  border: 'none',
  background: active ? 'var(--indigo)' : 'transparent',
  color: active ? '#fff' : 'var(--muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all .15s',
});
