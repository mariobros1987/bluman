import React from 'react';
import { Modal } from '../ui/Modal';

interface InviteUserModalProps {
  handleAddUser: (e: React.FormEvent) => void;
  newUserName: string;
  setNewUserName: (v: string) => void;
  newUserSpecializzazione: string;
  setNewUserSpecializzazione: (v: string) => void;
  newUserEmail: string;
  setNewUserEmail: (v: string) => void;
  newUserRole: 'super_admin' | 'advisor' | 'operator';
  setNewUserRole: (v: 'super_admin' | 'advisor' | 'operator') => void;
  setModalUserOpen: (v: boolean) => void;
  submittingUser: boolean;
}

// Modal Aggiungi Utente
export function InviteUserModal({
  handleAddUser,
  newUserName,
  setNewUserName,
  newUserSpecializzazione,
  setNewUserSpecializzazione,
  newUserEmail,
  setNewUserEmail,
  newUserRole,
  setNewUserRole,
  setModalUserOpen,
  submittingUser,
}: InviteUserModalProps) {
  return (
        <Modal onClose={() => setModalUserOpen(false)} zIndex={100} labelledBy="invite-user-titolo">
          {(richiediChiusura) => (
          <form onSubmit={handleAddUser} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div id="invite-user-titolo" style={{ fontSize: 16, fontWeight: 700 }}>+ Invita Nuovo Collaboratore Studio</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Crea un utente operatore o professionista esterno (Avvocato, Commercialista, Back Office).</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome e Titolo Professionale *</label>
              <input value={newUserName} onChange={e => setNewUserName(e.target.value)} required placeholder="es. Avv. Lorenzo Marino" style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Specializzazione / Area di Competenza</label>
              <input value={newUserSpecializzazione} onChange={e => setNewUserSpecializzazione(e.target.value)} placeholder="es. Legal Counsel — Diritto Societario & IP" style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email Aziendale / PEC *</label>
              <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} required placeholder="es. lorenzo.marino@bluecode.advisory" style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ruolo & Permessi Accesso *</label>
              <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as any)} style={{ padding: 10, fontSize: 12 }}>
                <option value="advisor">👨‍💼 Advisor Senior / Legal Counsel (Gestione Progetti & Contratti)</option>
                <option value="operator">👷 Operatore Studio / Back Office (Consuntivazione Ore & Microvoci)</option>
                <option value="super_admin">👑 Super Admin (Tutti i permessi Multi-Tenant)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submittingUser} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {submittingUser ? 'Creazione in corso...' : '✓ Invita Collaboratore'}
              </button>
            </div>
          </form>
          )}
        </Modal>
  );
}
