import React from 'react';
import type { NoteEntry } from './types';

// ─── Tab 2: Note Operatore ─────────────────────────────────────────────
export function TabNote({
  handleAddNote,
  newNote,
  setNewNote,
  notes,
}: {
  handleAddNote: (e: React.FormEvent) => void;
  newNote: string;
  setNewNote: React.Dispatch<React.SetStateAction<string>>;
  notes: NoteEntry[];
}) {
  return (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                Aggiungi Nota Operativa o Aggiornamento:
              </label>
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Inserisci dettagli sull'avanzamento, note di riunione, riscontri dal cliente..."
                rows={3}
                style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                  + Registra Nota
                </button>
              </div>
            </form>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Storico Note Operative ({notes.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => (
                <div key={n.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
                    <strong style={{ color: 'var(--indigo-l)' }}>👤 {n.autore}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>{n.data}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5 }}>
                    {n.testo}
                  </div>
                </div>
              ))}
            </div>
          </div>
  );
}
