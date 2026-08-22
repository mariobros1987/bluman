import React, { useState, useEffect } from 'react';
import { cambiaPasswordStaffApi, fetchProfiloUtenteApi, aggiornaProfiloUtenteApi } from '../api/client';
import { getCurrentTenantId, getStudioInfoForTenant } from '../utils/tenant';

interface UserProfileModalProps {
  user: any;
  onClose: () => void;
  onUserUpdated?: (updatedUser: any) => void;
}

export function UserProfileModal({ user, onClose, onUserUpdated }: UserProfileModalProps) {
  const [tab, setTab] = useState<'profilo' | 'password' | 'sessione'>('profilo');

  // Profilo state
  const [nome, setNome] = useState(user?.nome || user?.name || '');
  const [email] = useState(user?.email || '');
  const [specializzazione, setSpecializzazione] = useState(user?.specializzazione || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchProfiloUtenteApi()
      .then(dbUser => {
        if (dbUser) {
          if (dbUser.nome) setNome(dbUser.nome);
          if (dbUser.specializzazione) setSpecializzazione(dbUser.specializzazione);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const updated = await aggiornaProfiloUtenteApi({ nome, specializzazione });
      setProfileMsg({ text: '✓ Dati profilo aggiornati con successo!', type: 'success' });
      if (onUserUpdated) onUserUpdated({ ...user, ...updated });
    } catch (err: any) {
      setProfileMsg({ text: err.message || 'Errore durante il salvataggio del profilo', type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);

    if (newPassword.length < 8) {
      setPassMsg({ text: 'La nuova password deve contenere almeno 8 caratteri.', type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassMsg({ text: 'Le due password inserite non coincidono.', type: 'error' });
      return;
    }

    setSavingPass(true);
    try {
      await cambiaPasswordStaffApi(currentPassword, newPassword);
      setPassMsg({ text: '✓ Password aggiornata con successo! La nuova password è ora attiva.', type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPassMsg({ text: err.message || 'Errore durante il cambio password', type: 'error' });
    } finally {
      setSavingPass(false);
    }
  };

  // Calcolo forza password
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: 'Inserisci password', color: 'var(--muted)' };
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.length >= 12) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 2) return { score: 25, label: 'Semplice (consigliati simboli o 8+ char)', color: '#f87171' };
    if (score <= 3) return { score: 65, label: 'Media', color: '#fbbf24' };
    if (score <= 4) return { score: 85, label: 'Buona / Sicura', color: '#60a5fa' };
    return { score: 100, label: 'Molto Forte & Conforme ISO/IEC 27001', color: '#34d399' };
  };

  const passStrength = getPasswordStrength(newPassword);
  const currentTenantId = getCurrentTenantId(user);
  const studio = getStudioInfoForTenant();

  const getRoleBadge = (ruolo: string) => {
    switch (ruolo) {
      case 'super_admin':
        return { label: '👑 Super Admin Piattaforma', bg: '#311042', color: '#e879f9', border: '#86198f' };
      case 'advisor':
        return { label: '👨‍💼 Lead Advisor / Titolare Studio', bg: '#1e1b4b', color: '#818cf8', border: '#4338ca' };
      case 'collaboratore_interno':
        return { label: '👷 Collaboratore Interno / Senior Partner', bg: '#0d2d22', color: '#34d399', border: '#059669' };
      case 'collaboratore_esterno':
        return { label: '🤝 Collaboratore Esterno', bg: '#2d1f0d', color: '#fbbf24', border: '#d97706' };
      default:
        return { label: `👤 ${ruolo || 'Operatore'}`, bg: 'var(--card)', color: 'var(--text)', border: 'var(--border)' };
    }
  };

  const roleInfo = getRoleBadge(user?.ruolo || user?.role || 'advisor');
  const userInitials = (nome || user?.name || 'AD')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('') || 'AD';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--sidebar)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header Modale con Avatar e Ruolo */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.45), rgba(15, 23, 42, 0.7))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4338ca, #6366f1)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 800,
                boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
              }}
            >
              {userInitials}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{nome || 'Utente Studio'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{email}</div>
              <div style={{ marginTop: 4 }}>
                <span
                  style={{
                    background: roleInfo.bg,
                    color: roleInfo.color,
                    border: `1px solid ${roleInfo.border}`,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 12,
                  }}
                >
                  {roleInfo.label}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontSize: 20,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✖
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--card)' }}>
          <button
            onClick={() => setTab('profilo')}
            style={{
              flex: 1,
              padding: '12px 8px',
              border: 'none',
              background: tab === 'profilo' ? 'var(--card2)' : 'transparent',
              color: tab === 'profilo' ? 'var(--indigo-l)' : 'var(--muted)',
              fontWeight: tab === 'profilo' ? 700 : 500,
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: tab === 'profilo' ? '2px solid var(--indigo)' : 'none',
            }}
          >
            👤 Dati Profilo
          </button>
          <button
            onClick={() => setTab('password')}
            style={{
              flex: 1,
              padding: '12px 8px',
              border: 'none',
              background: tab === 'password' ? 'var(--card2)' : 'transparent',
              color: tab === 'password' ? 'var(--indigo-l)' : 'var(--muted)',
              fontWeight: tab === 'password' ? 700 : 500,
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: tab === 'password' ? '2px solid var(--indigo)' : 'none',
            }}
          >
            🔐 Sicurezza & Password
          </button>
          <button
            onClick={() => setTab('sessione')}
            style={{
              flex: 1,
              padding: '12px 8px',
              border: 'none',
              background: tab === 'sessione' ? 'var(--card2)' : 'transparent',
              color: tab === 'sessione' ? 'var(--indigo-l)' : 'var(--muted)',
              fontWeight: tab === 'sessione' ? 700 : 500,
              fontSize: 12,
              cursor: 'pointer',
              borderBottom: tab === 'sessione' ? '2px solid var(--indigo)' : 'none',
            }}
          >
            🏛 Studio & Sessione
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          {/* TAB 1: Profilo & Dati */}
          {tab === 'profilo' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {profileMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: profileMsg.type === 'success' ? '#0d2d22' : '#3b1c1c',
                    color: profileMsg.type === 'success' ? '#34d399' : '#f87171',
                    border: `1px solid ${profileMsg.type === 'success' ? '#059669' : '#ef4444'}`,
                  }}
                >
                  {profileMsg.text}
                </div>
              )}

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Nome Completo / Ragione Sociale *
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="es. Mario Rossi"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Indirizzo Email Ufficiale (Identificativo Univoco)
                </label>
                <input
                  type="email"
                  value={email}
                  disabled
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--muted)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    cursor: 'not-allowed',
                  }}
                />
                <span style={{ fontSize: 10, color: 'var(--hint)', marginTop: 4, display: 'block' }}>
                  🔒 L'email di accesso è gestita dall'amministratore dello studio o definita in fase di registrazione.
                </span>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Specializzazione & Qualifica Professionale
                </label>
                <input
                  type="text"
                  value={specializzazione}
                  onChange={e => setSpecializzazione(e.target.value)}
                  placeholder="es. Senior Advisor Trust Svizzera & Diritto Societario"
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Chiudi
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                  }}
                >
                  {savingProfile ? 'Salvataggio...' : '💾 Salva Modifiche Profilo'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: Sicurezza & Password */}
          {tab === 'password' && (
            <form onSubmit={handleSavePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {passMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: passMsg.type === 'success' ? '#0d2d22' : '#3b1c1c',
                    color: passMsg.type === 'success' ? '#34d399' : '#f87171',
                    border: `1px solid ${passMsg.type === 'success' ? '#059669' : '#ef4444'}`,
                  }}
                >
                  {passMsg.text}
                </div>
              )}

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Password Attuale (per verifica identità) *
                </label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Inserisci la password attualmente in uso"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                    Nuova Password * (min. 8 caratteri)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                  >
                    {showPass ? '🙈 Nascondi' : '👁 Mostra Password'}
                  </button>
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Inserisci nuova password sicura"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />

                {/* Password Strength Indicator */}
                {newPassword && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: passStrength.color, fontWeight: 600, marginBottom: 4 }}>
                      <span>Sicurezza: {passStrength.label}</span>
                      <span>{passStrength.score}%</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${passStrength.score}%`, height: '100%', background: passStrength.color, transition: 'width .2s ease' }} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                  Conferma Nuova Password *
                </label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Ripeti la nuova password"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    color: 'var(--text)',
                    fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <span style={{ fontSize: 10, color: '#f87171', marginTop: 4, display: 'block' }}>
                    ⚠ Le due password non coincidono.
                  </span>
                )}
              </div>

              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid #312e81', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#a5b4fc', lineHeight: 1.4 }}>
                ℹ️ La nuova password verrà cifrata con algoritmo crittografico sicuro <strong>scrypt</strong> e sarà attiva immediatamente per i successivi accessi.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={savingPass || !newPassword || newPassword !== confirmPassword}
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    opacity: (!newPassword || newPassword !== confirmPassword) ? 0.6 : 1,
                  }}
                >
                  {savingPass ? 'Aggiornamento...' : '🔒 Salva Nuova Password'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Studio & Sessione */}
          {tab === 'sessione' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🏛 Studio Professionale di Riferimento</div>
                <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{studio.ragioneSociale}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{studio.sedeLegale}</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--hint)', marginTop: 8 }}>
                  Tenant ID: {currentTenantId}
                </div>
              </div>

              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🛡️ Sicurezza & Conformità RBAC</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Il tuo account è protetto con autenticazione crittografica JWT (JSON Web Token) a 15 minuti e controllo granulare dei permessi per modulo. Tutte le operazioni di scrittura sono tracciate nell'Audit Log di piattaforma.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
