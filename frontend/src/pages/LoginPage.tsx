import React, { useState, useEffect, useRef } from 'react';
import { loginApi, verificaTotpApi } from '../api/auth';

interface LoginPageProps {
  onLoginSuccess: (user: any, token: string) => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  // §23 — campi vuoti. Erano precompilati con `joe@bluecode.advisory` e otto puntini:
  // i puntini venivano inviati come password letterale, quindi il campo sembrava già
  // compilato e non lo era.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // §6.1 — Step 2FA: quando il backend risponde { totpRequired: true, preToken }
  // il login non è ancora completato. Salviamo il preToken e mostriamo il form TOTP.
  const [totpStep, setTotpStep] = useState(false);
  const [preToken, setPreToken] = useState('');
  const [codiceTotp, setCodiceTotp] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);

  // Countdown validità preToken (2 minuti)
  const [secondiRimanenti, setSecondiRimanenti] = useState(120);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!totpStep) return;
    setSecondiRimanenti(120);
    countdownRef.current = setInterval(() => {
      setSecondiRimanenti(s => {
        if (s <= 1) {
          clearInterval(countdownRef.current!);
          setTotpStep(false);
          setPreToken('');
          setError('La sessione temporanea è scaduta. Effettua nuovamente il login.');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current!);
  }, [totpStep]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await loginApi(email, password);

      // §6.1 — Il super_admin con TOTP abilitato riceve { totpRequired: true, preToken }.
      // Non c'è ancora un JWT definitivo: mostriamo lo Step-2.
      if (res?.totpRequired && res?.preToken) {
        setPreToken(res.preToken);
        setTotpStep(true);
        setCodiceTotp('');
        setUseBackupCode(false);
        return;
      }

      if (res && res.token) {
        localStorage.setItem('bluman_jwt_token', res.token);
        localStorage.setItem('bluman_user', JSON.stringify(res.user));
        if (res.user?.tenantId) {
          localStorage.setItem('bluman_tenant_id', res.user.tenantId);
        }
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

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codiceTotp.trim()) return;
    setError('');
    setTotpLoading(true);

    try {
      const res = await verificaTotpApi(preToken, codiceTotp.trim());
      if (res && res.token) {
        clearInterval(countdownRef.current!);
        localStorage.setItem('bluman_jwt_token', res.token);
        localStorage.setItem('bluman_user', JSON.stringify(res.user));
        if (res.user?.tenantId) {
          localStorage.setItem('bluman_tenant_id', res.user.tenantId);
        }
        onLoginSuccess(res.user, res.token);
      } else {
        setError('Codice non valido o sessione scaduta. Riprova.');
      }
    } catch (err: any) {
      setError(err.message || 'Codice non valido o sessione scaduta.');
    } finally {
      setTotpLoading(false);
    }
  };

  const mm = String(Math.floor(secondiRimanenti / 60)).padStart(2, '0');
  const ss = String(secondiRimanenti % 60).padStart(2, '0');

  const cardStyle: React.CSSProperties = {
    background: 'var(--sidebar)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 440,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    boxShadow: '0 24px 60px rgba(0,0,0,.6)',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'var(--indigo)', color: '#fff', fontSize: 26, marginBottom: 12 }}>
            🛡
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>BluMan Advisory</h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Piattaforma ERP per Studi di Consulenza & Wealth Protection</p>
        </div>

        {/*
          §23 — qui c'erano tre scorciatoie "Advisor / Operatore / SuperAdmin" che
          precompilavano email e password di tre account reali dello studio. Erano
          credenziali servite in chiaro dal bundle a chiunque aprisse la pagina di login
          (l'elenco esatto è nel test `src/credenziali.test.ts`, che ne presidia
          l'assenza). Il ruolo, del resto, non si sceglie: lo determina il backend
          leggendo la riga `user` del database.
        */}

        {error && (
          <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── STEP 1: Form Login Normale ── */}
        {!totpStep && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Aziendale Studio *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="nome.cognome@studio.it"
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
                autoComplete="current-password"
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
        )}

        {/* ── STEP 2: Verifica Codice TOTP (§6.1) ── */}
        {totpStep && (
          <form onSubmit={handleTotpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Indicatore Step */}
            <div style={{ background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🔐</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Autenticazione a Due Fattori</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {useBackupCode
                  ? 'Inserisci uno dei tuoi codici di recupero a 8 caratteri'
                  : 'Apri la tua app authenticator (Google Authenticator, 1Password, Bitwarden) e inserisci il codice a 6 cifre'}
              </div>
            </div>

            {/* Countdown */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, fontSize: 12, color: secondiRimanenti < 30 ? '#f87171' : 'var(--muted)' }}>
              <span>⏱ Sessione temporanea scade tra:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: secondiRimanenti < 30 ? '#f87171' : 'var(--text)' }}>{mm}:{ss}</span>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                {useBackupCode ? 'Codice di Recupero (8 caratteri) *' : 'Codice Authenticator (6 cifre) *'}
              </label>
              <input
                type="text"
                value={codiceTotp}
                onChange={e => setCodiceTotp(e.target.value.replace(/\s/g, '').toUpperCase())}
                required
                autoComplete="one-time-code"
                placeholder={useBackupCode ? 'XXXXXXXX' : '000000'}
                maxLength={useBackupCode ? 8 : 6}
                autoFocus
                style={{
                  width: '100%',
                  fontSize: 26,
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  letterSpacing: useBackupCode ? 4 : 8,
                  textAlign: 'center',
                  padding: '14px 0',
                  background: 'var(--bg)',
                  border: '2px solid var(--indigo)',
                  borderRadius: 10,
                  color: 'var(--text)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={totpLoading || (useBackupCode ? codiceTotp.length < 8 : codiceTotp.length < 6)}
              style={{
                background: 'var(--indigo)',
                color: '#fff',
                border: 'none',
                padding: '12px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(99,102,241,.4)',
                opacity: (totpLoading || (useBackupCode ? codiceTotp.length < 8 : codiceTotp.length < 6)) ? 0.6 : 1,
              }}
            >
              {totpLoading ? 'Verifica in corso...' : '✅ Verifica e Accedi'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              {/* Passa a codice di backup */}
              <button
                type="button"
                onClick={() => { setUseBackupCode(!useBackupCode); setCodiceTotp(''); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {useBackupCode ? '← Torna al codice authenticator' : '🔑 Usa un codice di recupero'}
              </button>
              {/* Torna al login */}
              <button
                type="button"
                onClick={() => { setTotpStep(false); setPreToken(''); setCodiceTotp(''); setError(''); clearInterval(countdownRef.current!); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}
              >
                ← Torna al login
              </button>
            </div>
          </form>
        )}

        {/* Footer Info */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
          🔒 Connessione cifrata TLS · Multi-tenant RLS PostgreSQL
        </div>
      </div>
    </div>
  );
}
