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
  /** Apre il modale di archiviazione o riattivazione. */
  onArchivia: (persona: any, verso: 'archivia' | 'riattiva') => void;
  /** Vero per i ruoli che possono archiviare: super admin e responsabile dello studio. */
  puoGestire: boolean;
}

/** `AAAA-MM-GG` o istante ISO → `GG/MM/AAAA`, riletto nel fuso locale (vedi il modale). */
function inItaliano(iso?: string | null): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [anno, mese, giorno] = iso.split('-');
    return `${giorno}/${mese}/${anno}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const mese = String(d.getMonth() + 1).padStart(2, '0');
  const giorno = String(d.getDate()).padStart(2, '0');
  return `${giorno}/${mese}/${d.getFullYear()}`;
}

/** Il periodo aperto, se la persona è in forza. */
function periodoAperto(u: any): any | null {
  const periodi: any[] = Array.isArray(u?.periodiCollaborazione) ? u.periodiCollaborazione : [];
  return periodi.find(p => p.al === null) ?? null;
}

/** L'ultimo periodo concluso: la data in cui la persona ha smesso. */
function ultimoPeriodoChiuso(u: any): any | null {
  const periodi: any[] = Array.isArray(u?.periodiCollaborazione) ? u.periodiCollaborazione : [];
  return [...periodi].reverse().find(p => p.al !== null) ?? null;
}

const COLORE_ARCHIVIATO = 'var(--muted)';

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
  onArchivia,
  puoGestire,
}: TabUsersProps) {
  // Gli archiviati non sono più persone dello studio: restano leggibili (i progetti a cui hanno
  // lavorato li citano, ed è la ragione per cui non si cancellano) ma stanno in una sezione
  // a parte, con l'unica azione che ha senso su di loro — riportarli in forza. Mescolati agli
  // attivi, un archivio che cresce renderebbe illeggibile l'elenco di chi lavora qui oggi.
  const attivi = users.filter(u => u.stato !== 'disattivato');
  const archiviati = users.filter(u => u.stato === 'disattivato');

  return (
    <>
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
              {attivi.map(u => {
                const aperto = periodoAperto(u);
                // Un super admin di piattaforma non appartiene a nessuno studio (`tenantId`
                // nullo): non ha periodi e non si archivia da qui.
                const archiviabile = puoGestire && u.tenantId !== null;
                return (
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
                      {aperto && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          In forza dal {inItaliano(aperto.dal)}
                        </div>
                      )}
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
                      {archiviabile && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchivia(u, 'archivia');
                          }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--muted)',
                            borderRadius: 6,
                            padding: '3px 8px',
                            fontSize: 10.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                          title="La persona ha smesso di lavorare con lo studio: si registra la data di fine e l'utenza viene spenta. Nulla viene cancellato."
                        >
                          <span>📦</span> Archivia
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loadingUsers && archiviati.length > 0 && (
          <div className={styles.sectionBox} style={{ marginTop: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Operatori archiviati ({archiviati.length})</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, marginBottom: 12 }}>
              Non lavorano più con lo studio: l'utenza è spenta e non compaiono tra gli operatori assegnabili.
              Nulla è stato cancellato — se una persona rientra, si riattiva con un nuovo periodo.
            </div>
            <div className={styles.userGrid}>
              {archiviati.map(u => {
                const chiuso = ultimoPeriodoChiuso(u);
                const aperto = periodoAperto(u);
                return (
                  <div
                    key={u.id}
                    className={styles.userCard}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.72 }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: COLORE_ARCHIVIATO, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                      {(u.nome || u.name || 'U').substring(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{u.nome || u.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{u.email}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {aperto
                          ? `In forza dal ${inItaliano(aperto.dal)}`
                          : chiuso
                            ? `Dal ${inItaliano(chiuso.dal)} al ${inItaliano(chiuso.al)}`
                            : 'Nessun periodo registrato'}
                      </div>
                      {chiuso?.motivo && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontStyle: 'italic' }}>
                          {chiuso.motivo}
                        </div>
                      )}
                    </div>
                    {puoGestire && u.tenantId !== null && (
                      <button
                        type="button"
                        onClick={() => onArchivia(u, 'riattiva')}
                        style={{
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid var(--green)',
                          color: 'var(--green)',
                          borderRadius: 6,
                          padding: '4px 10px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                        }}
                        title="La persona è tornata a lavorare con lo studio: si apre un nuovo periodo di collaborazione"
                      >
                        <span>↩️</span> Riattiva
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </>
  );
}
