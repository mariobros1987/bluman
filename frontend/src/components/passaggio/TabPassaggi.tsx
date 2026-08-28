import React from 'react';
import type { DocumentTemplate } from '../../utils/documentTemplates';
import type { Progetto, Passaggio } from '../../types';
import type { DocumentoEntry } from './types';
import type { RecommendationResult } from './catalogoModelliStudio';
import { TYPE_COLOR, TYPE_LABEL } from './passaggioUtils';

// ─── Tab 1: Checklist Passaggi ─────────────────────────────────────────
export function TabPassaggi({
  view,
  setView,
  visible,
  project,
  recommendation,
  toggleDone,
  handleDeleteStep,
  setShowAddStepModal,
  setPreviewFormValues,
  setPreviewFormModalStep,
  setSelectedDocPreview,
  handleUnlinkStepDoc,
  apriConfigFirmaTemplate,
  setShowCatalogModal,
}: {
  view: 'operatore' | 'cliente';
  setView: React.Dispatch<React.SetStateAction<'operatore' | 'cliente'>>;
  visible: Passaggio[];
  project: Progetto;
  recommendation: RecommendationResult;
  toggleDone: (id: string) => void;
  handleDeleteStep: (id: string) => void;
  setShowAddStepModal: React.Dispatch<React.SetStateAction<boolean>>;
  setPreviewFormValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPreviewFormModalStep: React.Dispatch<React.SetStateAction<Passaggio | null>>;
  setSelectedDocPreview: React.Dispatch<React.SetStateAction<DocumentoEntry | null>>;
  handleUnlinkStepDoc: (stepId: string) => void;
  apriConfigFirmaTemplate: (tmpl: DocumentTemplate, stepId?: string) => void;
  setShowCatalogModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* View Switcher & Add Step Button */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', flex: 1, gap: 8 }}>
                {(['operatore', 'cliente'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      flex: 1, padding: '7px', borderRadius: 8,
                      border: `1px solid ${view === v ? 'var(--indigo)' : 'var(--border)'}`,
                      background: view === v ? '#1a1f3d' : 'var(--card)',
                      color: view === v ? 'var(--indigo-l)' : 'var(--muted)',
                      fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {v === 'operatore' ? '👤 Vista Operatore Studio' : '🧑‍💼 Vista Portale Cliente'}
                  </button>
                ))}
              </div>

              {view === 'operatore' && (
                <button
                  type="button"
                  onClick={() => setShowAddStepModal(true)}
                  style={{
                    background: 'var(--indigo)', color: '#fff', border: 'none',
                    padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0
                  }}
                >
                  ➕ Aggiungi Azione
                </button>
              )}
            </div>

            {visible.map((s, i) => {
              const isLast = i === visible.length - 1;
              const tc = TYPE_COLOR[s.type] || TYPE_COLOR.info;
              return (
                <div key={s.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
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
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.desc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase', ...tc }}>
                          {TYPE_LABEL[s.type]}
                        </span>
                        {view === 'operatore' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              onClick={() => toggleDone(s.id)}
                              title="Segna come completato / da fare"
                              style={{ background: 'none', border: 'none', color: s.stato === 'done' ? 'var(--green)' : 'var(--hint)', cursor: 'pointer', fontSize: 15 }}
                            >
                              {s.stato === 'done' ? '✓' : '○'}
                            </button>
                            <button
                              onClick={() => handleDeleteStep(s.id)}
                              title="Elimina passaggio"
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, opacity: 0.7 }}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step Type = Form */}
                    {s.type === 'form' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa' }}>📋 Dati da raccogliere dal cliente:</span>
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
                            👁 Compila / Visualizza Form
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(s.fields || ['Ragione Sociale', 'P.IVA / VAT', 'Legale Rappresentante']).map((fld, idx) => (
                            <span key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '2px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 600 }}>
                              📝 {fld}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step Type = Doc (Mostra SOLO se c'è un documento, altrimenti propone il Pre-screening!) */}
                    {s.type === 'doc' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {s.file ? (
                          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ fontSize: 20 }}>📄</div>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                                  {s.file}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                                  {s.stato === 'done' ? '✓ Firmato dal cliente' : '✍️ Richiede firma con OTP'}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: s.stato === 'done' ? '#0d2d22' : '#2d1a05', color: s.stato === 'done' ? '#34d399' : '#f59e0b', border: `1px solid ${s.stato === 'done' ? '#1a5c3c' : '#78350f'}` }}>
                                {s.stato === 'done' ? '🔒 FIRMATO' : '✍️ DA FIRMARE'}
                              </span>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDocPreview({
                                    id: `doc-${s.id}`,
                                    nome: s.file || 'Documento.pdf',
                                    dimensione: '56 KB',
                                    richiedeFirma: true,
                                    firmato: s.stato === 'done',
                                    dataCaricamento: new Date().toLocaleDateString('it-IT'),
                                  });
                                }}
                                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                              >
                                👁 Leggi PDF
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUnlinkStepDoc(s.id)}
                                title="Scollega documento da questo passaggio"
                                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--red)', padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                              >
                                🗑 Scollega
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: '#1e1b4b20', border: '1px dashed #6366f1', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>
                                📁 Nessun documento collegato a questo passaggio
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                {recommendation.template ? `Modello consigliato: ${recommendation.template.titolo}` : 'Puoi associare un atto studio o lasciare l\'attività come procedura interna.'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {recommendation.template && (
                                <button
                                  type="button"
                                  onClick={() => apriConfigFirmaTemplate(recommendation.template!, s.id)}
                                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                                >
                                  ⚡ Collega Consigliato
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setShowCatalogModal(true)}
                                style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                              >
                                📂 Scegli Modello
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
  );
}
