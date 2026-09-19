import type { TeamMember } from '../../types';

// ─── Modal Gestione Accessi Collegati al Progetto (§19) ───────────
export function ModalAccessiProgetto({
  teamList,
  selectedUser,
  onSelectedUserChange,
  livello,
  onLivelloChange,
  idMembro,
  onChiudi,
  onAssegna,
}: {
  teamList: TeamMember[];
  selectedUser: string;
  onSelectedUserChange: (v: string) => void;
  livello: string;
  onLivelloChange: (v: string) => void;
  idMembro: (u: TeamMember) => string;
  onChiudi: () => void;
  onAssegna: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Gestione Accessi Collegati al Progetto (§19)</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Associa collaboratori ed advisor al progetto con permessi specifici di accesso</div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', textTransform: 'uppercase', marginBottom: 6 }}>Collaboratori Attualmente Assegnati:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {teamList.slice(0, 2).map((u, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                <span>👤 <strong>{u.n || (u as any).name}</strong> ({u.r || (u as any).role})</span>
                <span style={{ background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>Permesso: Operativo (Scrittura)</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona Collaboratore dello Studio *</label>
          <select value={selectedUser} onChange={e => onSelectedUserChange(e.target.value)}>
            {teamList.map(u => (
              <option key={u.id} value={idMembro(u)}>{u.n || (u as any).name} — {u.r || (u as any).role}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Livello Accesso Risorsa *</label>
          <select value={livello} onChange={e => onLivelloChange(e.target.value)}>
            <option value="write">✏️ Scrittura / Operativo (Write)</option>
            <option value="read">👁 Solo Lettura (Read)</option>
            <option value="admin">👑 Amministratore Progetto (Admin)</option>
          </select>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onChiudi} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
          <button
            onClick={onAssegna}
            style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            + Assegna Accesso Progetto
          </button>
        </div>
      </div>
    </div>
  );
}
