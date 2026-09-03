interface ResetPasswordModalProps {
  resetModalUser: any;
  setResetModalUser: (v: any) => void;
  resetError: string | null;
  resetResult: { email: string; passwordTemporanea: string; nome: string } | null;
  resettingPassword: boolean;
  handleResetUserPassword: () => void;
  copiedResetPass: boolean;
  setCopiedResetPass: (v: boolean) => void;
}

// Modal Reset Password Utente
export function ResetPasswordModal({
  resetModalUser,
  setResetModalUser,
  resetError,
  resetResult,
  resettingPassword,
  handleResetUserPassword,
  copiedResetPass,
  setCopiedResetPass,
}: ResetPasswordModalProps) {
  return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--sidebar, #111827)',
              border: '1px solid var(--border, #374151)',
              borderRadius: 18,
              width: '100%',
              maxWidth: 480,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1e1b4b', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  🔄
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                    Reset Password Utente
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {resetModalUser.nome || resetModalUser.name} ({resetModalUser.email})
                  </div>
                </div>
              </div>
              <button
                onClick={() => setResetModalUser(null)}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {resetError && (
              <div style={{ background: '#450a0a', border: '1px solid #dc2626', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
                ⚠️ {resetError}
              </div>
            )}

            {!resetResult ? (
              <>
                <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                  Generando una nuova password temporanea, la password precedente verrà immediatamente revocata.
                  Al suo prossimo login, l'utente sarà <strong>obbligato a impostare una nuova password personale</strong> prima di accedere alle funzioni dello studio.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={handleResetUserPassword}
                    disabled={resettingPassword}
                    style={{
                      background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 18px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(79, 70, 229, 0.35)',
                      opacity: resettingPassword ? 0.6 : 1,
                    }}
                  >
                    {resettingPassword ? 'Generazione in corso...' : '🔄 Genera Password Temporanea'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: '#0d2d22', border: '1px solid #059669', borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 6 }}>
                    ✓ Password Temporanea Generata con Successo
                  </div>
                  <div style={{ fontSize: 11, color: '#a7f3d0', lineHeight: 1.4 }}>
                    Consegna questa password a <strong>{resetResult.nome}</strong>. Al primo accesso gli verrà richiesto obbligatoriamente di impostarne una nuova.
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: 8, border: '1px solid #10b981' }}>
                    <code style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.05em', flex: 1, fontFamily: 'monospace' }}>
                      {resetResult.passwordTemporanea}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(resetResult.passwordTemporanea);
                        setCopiedResetPass(true);
                        setTimeout(() => setCopiedResetPass(false), 3000);
                      }}
                      style={{
                        background: copiedResetPass ? '#059669' : '#1e1b4b',
                        color: '#fff',
                        border: '1px solid #4338ca',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {copiedResetPass ? '✓ Copiata!' : '📋 Copia'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Fatto
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
  );
}
