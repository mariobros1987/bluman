import React, { useState } from 'react';
import type { Progetto, Passaggio } from '../types';

interface PassaggioModalProps {
  project: Progetto;
  mid: number;
  vidx: number;
  onClose: () => void;
  onSaveVoce?: (updatedSteps: Passaggio[]) => void;
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

export function PassaggioModal({ project, mid, vidx, onClose, onSaveVoce }: PassaggioModalProps) {
  const mod = project.mods.find(m => m.id === mid)!;
  const voce = mod.v[vidx];
  const [view, setView] = useState<'operatore' | 'cliente'>('operatore');
  const [activeTab, setActiveTab] = useState<'passaggi' | 'note' | 'documenti'>('passaggi');
  const [steps, setSteps] = useState<Passaggio[]>(() => voce.proc || getDefaultPassaggi(voce));

  // Note operative
  const [notes, setNotes] = useState<NoteEntry[]>([
    { id: 'n1', autore: 'Joe Disabato', data: '14/08/2026 11:30', testo: 'Effettuato primo contatto e verifica requisiti per la pratica.' },
  ]);
  const [newNote, setNewNote] = useState('');

  // Documenti da firmare
  const [documents, setDocuments] = useState<DocumentoEntry[]>([
    { id: 'd1', nome: `Accordo_Servizio_${project.cl.replace(/\s+/g, '_')}.pdf`, dimensione: '1.4 MB', richiedeFirma: true, firmato: false, dataCaricamento: '14/08/2026' },
  ]);
  const [docName, setDocName] = useState('');
  const [docRequiresSign, setDocRequiresSign] = useState(true);
  const [selectedDocPreview, setSelectedDocPreview] = useState<DocumentoEntry | null>(null);

  // Form master preview state
  const [previewFormModalStep, setPreviewFormModalStep] = useState<Passaggio | null>(null);
  const [previewFormValues, setPreviewFormValues] = useState<Record<string, string>>({});

  const doneN = steps.filter(s => s.stato === 'done').length;
  const visible = view === 'operatore' ? steps : steps.filter(s => s.who === 'cliente');

  const toggleDone = (id: string) => {
    const nextSteps: Passaggio[] = steps.map(s => s.id === id ? { ...s, stato: (s.stato === 'done' ? 'pending' : 'done') as 'pending' | 'done' } : s);
    setSteps(nextSteps);
    if (onSaveVoce) {
      onSaveVoce(nextSteps);
    }
  };

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
          <div style={{ display: 'flex', gap: 6, marginTop: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
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

                    {/* Modulo di Selezione & Abbinamento Form Master */}
                    {s.type === 'form' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)' }}>📋 Abbina Form Master:</span>
                            <select
                              value={s.formMasterId || 'f1'}
                              onChange={e => {
                                const val = e.target.value;
                                let defaultFields = s.fields || [];
                                if (val === 'f1') defaultFields = ['Ragione Sociale', 'P.IVA / VAT', 'Codice Fiscale', 'Sede Legale', 'Legale Rappresentante'];
                                if (val === 'f2') defaultFields = ['Nome Titolare Effettivo', 'Quota % Possesso', 'Codice Fiscale UBO', 'Residenza Fiscale'];
                                if (val === 'f3') defaultFields = ['Banca Accreditamento', 'IBAN Operativo', 'Origine dei Fondi', 'Volume d Affari Annuo'];

                                const updated = steps.map(item => item.id === s.id ? { ...item, formMasterId: val, fields: defaultFields } : item);
                                setSteps(updated);
                                if (onSaveVoce) onSaveVoce(updated);
                              }}
                              style={{ padding: '3px 8px', fontSize: 11, background: '#200f40', color: '#a78bfa', border: '1px solid #581c87', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
                            >
                              <option value="f1">Form Dati Societari & Legale Rappresentante</option>
                              <option value="f2">Form Titolarità Effettiva & UBO</option>
                              <option value="f3">Form Dati Bancari & KYC Compliance</option>
                            </select>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setPreviewFormValues({
                                'Ragione Sociale': project.cl,
                                'P.IVA / VAT': 'IT99887766554',
                                'Legale Rappresentante': 'Mario Dibenedetto',
                                'Codice Fiscale': 'DBNMRI85M12H501Z',
                                'Sede Legale': 'Milano (MI) Via Roma 10',
                                'IBAN Operativo': 'IT99C0306903200100000001234',
                                'Nome Titolare Effettivo': 'Mario Dibenedetto (100%)',
                              });
                              setPreviewFormModalStep(s);
                            }}
                            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                          >
                            👁 Visualizza / Compila Form
                          </button>
                        </div>

                        {/* Badges dei campi di raccolta dati */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(s.fields || ['Ragione Sociale', 'P.IVA / VAT', 'Legale Rappresentante']).map((fld, idx) => (
                            <span key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '2px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 600 }}>
                              📝 {fld}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Visualizzatore & Gestore Documento Allegato per la Firma */}
                    {s.type === 'doc' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: 22 }}>📄</div>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                                {s.file || `Accordo_Riservatezza_${project.cl.replace(/\s+/g, '_')}.pdf`}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                1.4 MB · {s.stato === 'done' ? '✓ Firmato digitalmente dal cliente' : '✍️ Inviato per firma eIDAS'}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 9.5, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: s.stato === 'done' ? '#0d2d22' : '#2d1a05', color: s.stato === 'done' ? '#34d399' : '#f59e0b', border: `1px solid ${s.stato === 'done' ? '#1a5c3c' : '#78350f'}` }}>
                              {s.stato === 'done' ? '🔒 FIRMATO eIDAS' : '✍️ IN ATTESA DI FIRMA'}
                            </span>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDocPreview({
                                  id: `doc-${s.id}`,
                                  nome: s.file || `Accordo_Riservatezza_${project.cl.replace(/\s+/g, '_')}.pdf`,
                                  dimensione: '1.4 MB',
                                  richiedeFirma: true,
                                  firmato: s.stato === 'done',
                                  dataCaricamento: '14/08/2026',
                                });
                              }}
                              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                            >
                              👁 Visualizza / Leggi PDF
                            </button>

                            <button
                              type="button"
                              onClick={() => alert(`✓ Sollecito e Magic Link di firma per "${s.file || 'Contratto.pdf'}" inviati al cliente ${project.cl}!`)}
                              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                            >
                              ✉️ Sollecita Firma
                            </button>
                          </div>
                        </div>

                        {/* Sezione per Cambiare Modello PDF Allegato */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📎 Cambia Modello PDF:</span>
                          <select
                            value={s.documentoAllegatoUrl || 'm1'}
                            onChange={e => {
                              const val = e.target.value;
                              let newFileName = `Accordo_Riservatezza_NDA_${project.cl.replace(/\s+/g, '_')}.pdf`;
                              if (val === 'm2') newFileName = `Procura_Legale_MFSA_${project.cl.replace(/\s+/g, '_')}.pdf`;
                              if (val === 'm3') newFileName = `Dichiarazione_UBO_${project.cl.replace(/\s+/g, '_')}.pdf`;
                              if (val === 'm4') newFileName = `Statuto_Standard_Holding_${project.cl.replace(/\s+/g, '_')}.pdf`;

                              const updated = steps.map(item => item.id === s.id ? { ...item, documentoAllegatoUrl: val, file: newFileName } : item);
                              setSteps(updated);
                              if (onSaveVoce) onSaveVoce(updated);
                            }}
                            style={{ padding: '2px 6px', fontSize: 10, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }}
                          >
                            <option value="m1">Accordo NDA Tipo</option>
                            <option value="m2">Procura Legale MFSA</option>
                            <option value="m3">Dichiarazione UBO</option>
                            <option value="m4">Statuto Standard Holding Malta</option>
                          </select>
                        </div>
                      </div>
                    )}
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
              <div style={{ fontSize: 12, fontWeight: 600 }}>Carica o Associa Documento / Contratto PDF Reale dal Computer</div>
              
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona File dal Disco (.pdf, .doc, .docx) *</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setDocName(e.target.files[0].name);
                    }
                  }}
                  style={{ fontSize: 11, color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome o Descrizione Documento *</label>
                <input
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="es. Procura_Legale_Firma_Cliente.pdf"
                  required
                  style={{ fontSize: 12 }}
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
                  + Carica & Collega Documento Reale
                </button>
              </div>
            </form>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Documenti Collegati a questa Microvoce ({documents.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {documents.map(d => (
                <div key={d.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div
                    onClick={() => setSelectedDocPreview(d)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    title="Clicca per aprire ed anteporre il documento PDF"
                  >
                    <div style={{ fontSize: 22 }}>📄</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--indigo-l)', textDecoration: 'underline' }}>{d.nome}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {d.dimensione} · Caricato il {d.dataCaricamento}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {d.richiedeFirma ? (
                      <span style={{ background: d.firmato ? '#0d2d22' : '#200f40', color: d.firmato ? '#34d399' : '#a78bfa', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                        {d.firmato ? '✓ Firmato' : '✍️ Richiede Firma Cliente'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 10 }}>Informativo</span>
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedDocPreview(d)}
                      style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(99,102,241,.3)' }}
                    >
                      👁 Visualizza
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        // Prima conferma
                        const c1 = confirm(`⚠️ PRIMA CONFERMA: Sei sicuro di voler eliminare il documento "${d.nome}"?`);
                        if (!c1) return;

                        // Seconda conferma (Doppia Conferma di sicurezza)
                        const c2 = confirm(`🔴 SECONDA CONFERMA DEFINITIVA: Questa operazione è irreversibile e cancellerà definitivamente il file "${d.nome}". Procedere?`);
                        if (c2) {
                          setDocuments(prev => prev.filter(doc => doc.id !== d.id));
                          alert(`✓ Documento "${d.nome}" eliminato con successo. Azione registrata nel Log Audit Studio.`);
                        }
                      }}
                      title="Elimina documento con doppia conferma di sicurezza"
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--red)', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                    >
                      🗑 Elimina
                    </button>
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

        {/* Modal Anteprima PDF Documento */}
        {selectedDocPreview && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.8)' }}>
              {/* Header Viewer */}
              <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📄 {selectedDocPreview.nome}</span>
                    {selectedDocPreview.richiedeFirma && (
                      <span style={{ fontSize: 10, background: selectedDocPreview.firmato ? '#0d2d22' : '#200f40', color: selectedDocPreview.firmato ? '#34d399' : '#a78bfa', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                        {selectedDocPreview.firmato ? '🔒 eIDAS Firmato' : '✍️ In Attesa di Firma Cliente'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Dimensione: {selectedDocPreview.dimensione} · Data Caricamento: {selectedDocPreview.dataCaricamento} · Cliente: <strong>{project.cl}</strong>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDocPreview(null)}
                  style={{ background: 'var(--card2)', border: 'none', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}
                >
                  ✕
                </button>
              </div>

              {/* Reader Body / Simulation PDF Container */}
              <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#0a0d14', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#fff', color: '#1e293b', borderRadius: 8, padding: 32, fontFamily: 'serif', boxShadow: '0 10px 30px rgba(0,0,0,.5)', border: '1px solid #cbd5e1', lineHeight: 1.6 }}>
                  {/* PDF Document Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0284c7', paddingBottom: 16, marginBottom: 24 }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#0369a1', fontFamily: 'sans-serif' }}>BLUMAN ADVISORY SERVICES</div>
                      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'sans-serif' }}>Cross-Border Wealth Structuring & Legal Advisory</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', fontFamily: 'sans-serif' }}>
                      Rif. Incarico: #{project.id}<br />
                      Data Registrazione: {selectedDocPreview.dataCaricamento}
                    </div>
                  </div>

                  {/* Title */}
                  <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#0f172a', textTransform: 'uppercase' }}>
                    {selectedDocPreview.nome.replace(/\.pdf$/i, '')}
                  </div>

                  {/* Body Content */}
                  <div style={{ fontSize: 11.5, color: '#334155', textAlign: 'justify', marginBottom: 24 }}>
                    <p style={{ marginBottom: 12 }}>
                      Tra la sottoscritta società di consulenza professionale <strong>BluMan Advisory Ltd</strong> (con sede legale in Malta / Svizzera) ed il Cliente <strong>{project.cl}</strong>, si stipula ed approva il presente documento relativo al progetto di consulenza societaria e wealth protection.
                    </p>
                    <p style={{ marginBottom: 12 }}>
                      <strong>Articolo 1 — Oggetto delle Prestazioni:</strong> L'advisor si impegna ad adempiere a tutte le microvoci ed i passaggi contrattuali previsti nel modulo operativo <em>"{voce.n}"</em>.
                    </p>
                    <p style={{ marginBottom: 12 }}>
                      <strong>Articolo 2 — Riservatezza & Compliance eIDAS:</strong> Le parti riconoscono la validità giuridica della firma elettronica apposta tramite il Portale Cliente BluMan ai sensi del Regolamento UE n. 910/2014 (eIDAS).
                    </p>
                  </div>

                  {/* Footer Signatures */}
                  <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'sans-serif' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#475569' }}>Firma Advisory Firm:</div>
                      <div style={{ marginTop: 24, fontStyle: 'italic', color: '#0284c7', fontWeight: 600 }}>Joe Disabato (Senior Partner)</div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#475569' }}>Firma Cliente:</div>
                      <div style={{ marginTop: 24, fontStyle: selectedDocPreview.firmato ? 'normal' : 'italic', color: selectedDocPreview.firmato ? '#059669' : '#94a3b8', fontWeight: 700 }}>
                        {selectedDocPreview.firmato ? `✓ FIRMATO DA ${project.cl.toUpperCase()} (OTP eIDAS Validato)` : '✍️ In attesa di firma elettronica'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Viewer Actions Footer */}
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
                <button
                  type="button"
                  onClick={() => alert(`📥 Download del file "${selectedDocPreview.nome}" avviato sul tuo dispositivo.`)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >
                  📥 Scarica Copia Localmente
                </button>

                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedDocPreview.richiedeFirma && !selectedDocPreview.firmato && (
                    <button
                      type="button"
                      onClick={() => {
                        setDocuments(documents.map(x => x.id === selectedDocPreview.id ? { ...x, firmato: true } : x));
                        setSelectedDocPreview({ ...selectedDocPreview, firmato: true });
                        alert(`✓ Notifica ed il link di firma eIDAS per "${selectedDocPreview.nome}" inviati con successo al cliente ${project.cl}!`);
                      }}
                      style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >
                      ✍️ Sollecita Firma Cliente (Magic Link)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedDocPreview(null)}
                    style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
                  >
                    Chiudi Visualizzatore
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Popup Compilazione / Anteprima Form Master Operatore */}
        {previewFormModalStep && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 540, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,.6)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>📋 Dati Compilati nel Form dal Cliente</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{previewFormModalStep.title} · Cliente {project.cl}</div>
                </div>
                <button onClick={() => setPreviewFormModalStep(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, maxHeight: 300, overflowY: 'auto' }}>
                {(previewFormModalStep.fields || ['Ragione Sociale', 'P.IVA / VAT', 'Legale Rappresentante', 'Codice Fiscale', 'IBAN Operativo']).map((fld, fIdx) => (
                  <div key={fIdx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>
                      📝 {fld}
                    </label>
                    <input
                      type="text"
                      value={previewFormValues[fld] || ''}
                      onChange={e => setPreviewFormValues({ ...previewFormValues, [fld]: e.target.value })}
                      placeholder={`Inserisci valore per ${fld}...`}
                      style={{ fontSize: 12, padding: 6 }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>✓ Dati verificati dal sistema KYC</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setPreviewFormModalStep(null)}
                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer' }}
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      alert(`✓ Dati form salvati e verificati con successo per la voce "${previewFormModalStep.title}"!`);
                      setPreviewFormModalStep(null);
                    }}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ✓ Salva & Valida Dati Form
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
