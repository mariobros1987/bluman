import React, { useState } from 'react';
import type { Progetto, Passaggio } from '../types';

interface PassaggioModalProps {
  project: Progetto;
  mid: number;
  vidx: number;
  onClose: () => void;
}

interface NoteEntry {
  id: string;
  autore: string;
  data: string;
  testo: string;
}

interface DocumentoEntry {
  id: string;
  nome: string;
  dimensione: string;
  richiedeFirma: boolean;
  firmato: boolean;
  dataCaricamento: string;
}

function getDefaultPassaggi(v: { s: string; d: number }): Passaggio[] {
  return [
    { id: 's1', title: 'Informazioni preliminari & Briefing', type: 'info', who: 'operatore', stato: v.s !== 'pending' ? 'done' : 'pending', desc: 'Briefing interno del team prima di avviare l\'attività.' },
    { id: 's2', title: 'Documentazione richiesta al cliente', type: 'doc', who: 'cliente', stato: v.d > 0 ? 'done' : 'pending', desc: 'Il cliente carica i documenti o firma l\'accordo.', file: v.d > 0 ? 'Contratto_Firma_Cliente.pdf' : null },
    { id: 's3', title: 'Dati aggiuntivi dal cliente', type: 'form', who: 'cliente', stato: 'pending', desc: 'Il cliente compila il form con i dati societari.', fields: ['Nome completo', 'Recapito preferito'] },
    { id: 's4', title: 'Conferma e validazione finale', type: 'check', who: 'operatore', stato: v.s === 'done' ? 'done' : 'pending', desc: 'Verifica finale del team prima di chiudere la voce.' },
  ];
}

const TYPE_LABEL: Record<string, string> = { doc: 'Documento', form: 'Form', info: 'Info', check: 'Verifica' };
const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
  doc:   { bg: '#1a1f3d', color: '#818cf8' },
  form:  { bg: '#200f40', color: '#a78bfa' },
  info:  { bg: '#1e2030', color: '#94a3b8' },
  check: { bg: '#0d2d22', color: '#34d399' },
};

export function PassaggioModal({ project, mid, vidx, onClose }: PassaggioModalProps) {
  const mod = project.mods.find(m => m.id === mid)!;
  const voce = mod.v[vidx];
  const [view, setView] = useState<'operatore' | 'cliente'>('operatore');
  const [activeTab, setActiveTab] = useState<'passaggi' | 'note' | 'documenti'>('passaggi');
  const [steps, setSteps] = useState<Passaggio[]>(() => voce.proc || getDefaultPassaggi(voce));

  // Note operative
  const [notes, setNotes] = useState<NoteEntry[]>([
    { id: 'n1', autore: 'Joe Disabato', data: '14/08/2026 11:30', testo: 'Effettuato primo contatto e verifica requisiti per la pra pratica.' },
  ]);
  const [newNote, setNewNote] = useState('');

  // Documenti da firmare
  const [documents, setDocuments] = useState<DocumentoEntry[]>([
    { id: 'd1', nome: `Accordo_Servizio_${project.cl.replace(/\s+/g, '_')}.pdf`, dimensione: '1.4 MB', richiedeFirma: true, firmato: false, dataCaricamento: '14/08/2026' },
  ]);
  const [docName, setDocName] = useState('');
  const [docRequiresSign, setDocRequiresSign] = useState(true);

  const doneN = steps.filter(s => s.stato === 'done').length;
  const visible = view === 'operatore' ? steps : steps.filter(s => s.who === 'cliente');

  const toggleDone = (id: string) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, stato: s.stato === 'done' ? 'pending' : 'done' } : s));

  const removeStep = (id: string) => setSteps(prev => prev.filter(s => s.id !== id));

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    const entry: NoteEntry = {
      id: `n-${Date.now()}`,
      autore: 'Joe Disabato (Advisor)',
      data: new Date().toLocaleString('it-IT'),
      testo: newNote,
    };
    setNotes([entry, ...notes]);
    setNewNote('');
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) return;
    const docEntry: DocumentoEntry = {
      id: `d-${Date.now()}`,
      nome: docName.endsWith('.pdf') ? docName : `${docName}.pdf`,
      dimensione: '850 KB',
      richiedeFirma: docRequiresSign,
      firmato: false,
      dataCaricamento: new Date().toLocaleDateString('it-IT'),
    };
    setDocuments([...documents, docEntry]);
    setDocName('');
  };

  return (
    <div style={overlayStyle} onClick={e => { if ((e.target as HTMLElement).id === 'proc-ov') onClose(); }} id="proc-ov">
      <div style={modalStyle}>
        {/* Head */}
        <div style={headStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{voce.n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {mod.n} · {project.n}
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle}>✕</button>
          </div>

          {/* Sub Navigation */}
          <div style={{ display: 'flex', gap: 6, marginTop: 14, borderBottom: '1px solid var(--border)', pb: 8 }}>
            <button
              onClick={() => setActiveTab('passaggi')}
              style={tabBtnStyle(activeTab === 'passaggi')}
            >
              📋 Checklist Passaggi ({doneN}/{steps.length})
            </button>
            <button
              onClick={() => setActiveTab('note')}
              style={tabBtnStyle(activeTab === 'note')}
            >
              📝 Note & Registro Attività ({notes.length})
            </button>
            <button
              onClick={() => setActiveTab('documenti')}
              style={tabBtnStyle(activeTab === 'documenti')}
            >
              📎 Documenti per Firma ({documents.length})
            </button>
          </div>
        </div>

        {/* Body TAB 1: Passaggi */}
        {activeTab === 'passaggi' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* View Switcher */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['operatore', 'cliente'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    flex: 1, padding: '7px', borderRadius: 8,
                    border: `1px solid ${view === v ? 'var(--indigo)' : 'var(--border)'}`,
                    background: view === v ? '#1a1f3d' : 'var(--card)',
                    color: view === v ? 'var(--indigo-l)' : 'var(--muted)',
                    fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {v === 'operatore' ? '👤 Vista Operatore' : '🧑‍💼 Vista Cliente'}
                </button>
              ))}
            </div>

            {visible.map((s, i) => {
              const isLast = i === visible.length - 1;
              const tc = TYPE_COLOR[s.type] || TYPE_COLOR.info;
              return (
                <div key={s.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 22 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: s.stato === 'done' ? 'var(--green)' : 'var(--card2)',
                      color: s.stato === 'done' ? '#fff' : 'var(--muted)',
                      border: s.stato !== 'done' ? '1.5px solid var(--border)' : 'none',
                    }}>
                      {s.stato === 'done' ? '✓' : i + 1}
                    </div>
                    {!isLast && <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4, minHeight: 14 }} />}
                  </div>

                  <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.desc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase', ...tc }}>
                          {TYPE_LABEL[s.type]}
                        </span>
                        {view === 'operatore' && (
                          <button
                            onClick={() => toggleDone(s.id)}
                            style={{ background: 'none', border: 'none', color: s.stato === 'done' ? 'var(--green)' : 'var(--hint)', cursor: 'pointer', fontSize: 14 }}
                          >
                            {s.stato === 'done' ? '✓' : '○'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Body TAB 2: Note Operatore */}
        {activeTab === 'note' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Aggiungi Nota di Lavoro / Report *</label>
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Scrivi cosa è stato fatto per questa attività (es. Verificato atto costitutivo e inviata bozza al notaio)..."
                rows={3}
                required
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 12, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  + Registra Nota
                </button>
              </div>
            </form>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Storico Note & Attività ({notes.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => (
                <div key={n.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                    <strong style={{ color: 'var(--indigo-l)' }}>👤 {n.autore}</strong>
                    <span style={{ color: 'var(--muted)' }}>📅 {n.data}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{n.testo}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body TAB 3: Documenti da Firmare */}
        {activeTab === 'documenti' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form onSubmit={handleAddDocument} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Carica Documento o Contratto da Firmare</div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome File Documento *</label>
                <input
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="es. Procura_Legale_Firma_Cliente.pdf"
                  required
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="signChk"
                  checked={docRequiresSign}
                  onChange={e => setDocRequiresSign(e.target.checked)}
                />
                <label htmlFor="signChk" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                  <strong>Richiede Firma Digitale del Cliente (§22)</strong>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  + Carica Documento
                </button>
              </div>
            </form>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Documenti Collegati a questa Microvoce ({documents.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {documents.map(d => (
                <div key={d.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 20 }}>📄</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.nome}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {d.dimensione} · Caricato il {d.dataCaricamento}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {d.richiedeFirma ? (
                      <span style={{ background: d.firmato ? '#0d2d22' : '#200f40', color: d.firmato ? '#34d399' : '#a78bfa', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                        {d.firmato ? '✓ Firmato' : '✍️ Richiede Firma Cliente'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 10 }}>Informativo</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Registra le note operative ed i documenti da far firmare al cliente per questa micro-voce.
          </span>
          <button onClick={onClose} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a1f3d' : 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--indigo-l)' : '2px solid transparent',
  color: active ? 'var(--indigo-l)' : 'var(--muted)',
  fontSize: 11.5,
  fontWeight: 600,
  padding: '6px 12px',
  cursor: 'pointer',
});

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--sidebar)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  width: '100%', maxWidth: 660, maxHeight: '88vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 24px 60px rgba(0,0,0,.6)',
};

const headStyle: React.CSSProperties = {
  padding: 20,
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'var(--card2)', border: 'none',
  width: 28, height: 28, borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: 'var(--muted)', fontSize: 14,
};
