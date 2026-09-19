import styles from '../../pages/Settings.module.css';

interface TabUsersProps {
  setProfileModalOpen: (v: boolean) => void;
  setModalUserOpen: (v: boolean) => void;
  loadingUsers: boolean;
  users: any[];
  setSelectedOperator: (v: any) => void;
  setResetModalUser: (v: any) => void;
  setResetResult: (v: { email: string; passwordTemporanea: string; nome: string } | null) => void;
  setResetError: (v: string | null) => void;
  setCopiedResetPass: (v: boolean) => void;
}

// TAB 3: Gestione Team & Accessi
export function TabUsers({
  setProfileModalOpen,
  setModalUserOpen,
  loadingUsers,
  users,
  setSelectedOperator,
  setResetModalUser,
  setResetResult,
  setResetError,
  setCopiedResetPass,
}: TabUsersProps) {
  return (
        <div className={styles.sectionBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Utenti & Collaboratori dello Studio</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Definisci i ruoli ed i permessi di accesso per il personale dello studio</div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                style={{ background: 'var(--card2)', color: 'var(--indigo-l)', border: '1px solid var(--indigo-d)', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span>👤</span> Il Mio Profilo & Password
              </button>
              <button
                onClick={() => setModalUserOpen(true)}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                + Invita Collaboratore
              </button>
            </div>
          </div>

          {loadingUsers ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>Caricamento collaboratori...</div>
          ) : (
            <div className={styles.userGrid}>
              {users.map(u => (
                <div
                  key={u.id}
                  className={styles.userCard}
                  onClick={() => setSelectedOperator(u)}
                  style={{ cursor: 'pointer', transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 12 }}
                  title="Clicca per aprire la scheda dettagliata di performance ed ore lavorate"
                >
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: (u.ruolo || '').includes('super') ? 'var(--indigo-d)' : (u.specializzazione || '').toLowerCase().includes('legal') || (u.nome || '').toLowerCase().includes('avv') ? 'var(--green)' : (u.specializzazione || '').toLowerCase().includes('tax') || (u.specializzazione || '').toLowerCase().includes('fiscale') ? 'var(--amber)' : 'var(--cat-ip)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                    {(u.nome || u.name || 'U').substring(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{u.nome || u.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--indigo-l)' }}>🔍</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600, marginTop: 1 }}>{u.specializzazione || (u.ruolo === 'super_admin' ? 'Senior Partner & Lead Advisor' : 'Collaboratore')}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{u.email}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span className={styles.roleBadge} style={{ background: (u.ruolo || u.role || '').includes('super') ? 'var(--pill-indigo-bg)' : 'var(--surface-1)', color: (u.ruolo || u.role || '').includes('super') ? 'var(--purple)' : 'var(--indigo-l)', whiteSpace: 'nowrap' }}>
                      {u.ruolo === 'super_admin' ? '👑 Super Admin' : u.ruolo === 'advisor' ? '👨‍💼 Advisor' : '👷 Operatore'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResetModalUser(u);
                        setResetResult(null);
                        setResetError(null);
                        setCopiedResetPass(false);
                      }}
                      style={{
                        background: 'rgba(99, 102, 241, 0.12)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        color: 'var(--indigo-l, var(--indigo-l))',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 10.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="Rigenera password temporanea con cambio obbligatorio al 1° login"
                    >
                      <span>🔄</span> Reset Pass
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
  );
}
