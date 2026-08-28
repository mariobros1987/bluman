import React from 'react';
import type { DocumentTemplate } from '../../utils/documentTemplates';

export function LibreriaTemplate({
  templatesList,
  setShowNewTmplModal,
  fileImportRef,
  handleExportTemplatesJson,
  handleImportFileTrigger,
  handleSaveCurrentAsMasterTemplate,
  searchMasterTmplQuery,
  setSearchMasterTmplQuery,
  tmplStatusSidebar,
  setTmplStatusSidebar,
  selectedTemplateId,
  handleSelectTemplate,
  handleRestoreTemplate,
  handleArchiveTemplate,
  handleDeleteTemplate,
}: {
  templatesList: DocumentTemplate[];
  setShowNewTmplModal: React.Dispatch<React.SetStateAction<boolean>>;
  fileImportRef: React.RefObject<HTMLInputElement | null>;
  handleExportTemplatesJson: () => void;
  handleImportFileTrigger: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveCurrentAsMasterTemplate: () => void;
  searchMasterTmplQuery: string;
  setSearchMasterTmplQuery: React.Dispatch<React.SetStateAction<string>>;
  tmplStatusSidebar: 'attivi' | 'archiviati' | 'tutti';
  setTmplStatusSidebar: React.Dispatch<React.SetStateAction<'attivi' | 'archiviati' | 'tutti'>>;
  selectedTemplateId: string;
  handleSelectTemplate: (tmpl: DocumentTemplate) => void;
  handleRestoreTemplate: (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => void;
  handleArchiveTemplate: (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => void;
  handleDeleteTemplate: (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => void;
}) {
  return (
    <>
            {/* Master Templates Studio Library with Import / Export / Creation */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>📚 Modelli Master ({templatesList.length})</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Libreria template studio</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => setShowNewTmplModal(true)}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Crea Nuovo Modello Master da Zero"
                  >
                    ➕ Nuovo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileImportRef.current?.click()}
                    style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Importa Modello Master da file JSON o HTML"
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    onClick={handleExportTemplatesJson}
                    style={{ background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '4px 6px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer' }}
                    title="Esporta Bundle Modelli Master in JSON"
                  >
                    📤
                  </button>
                </div>
              </div>

              <input
                type="file"
                ref={fileImportRef}
                accept=".json,.html,.htm,.pdf"
                style={{ display: 'none' }}
                onChange={handleImportFileTrigger}
              />

              <button
                type="button"
                onClick={handleSaveCurrentAsMasterTemplate}
                style={{ width: '100%', background: 'rgba(99, 102, 241, 0.1)', border: '1px dashed #6366f1', color: '#818cf8', padding: '6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                title="Salva l'attuale bozza dell'editor come nuovo modello master riutilizzabile"
              >
                💾 Salva Bozza Attuale come Master
              </button>

              {/* Filtri di Ricerca & Stato Sidebar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  placeholder="🔍 Cerca modello master..."
                  value={searchMasterTmplQuery}
                  onChange={e => setSearchMasterTmplQuery(e.target.value)}
                  style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--card2)', border: '1px solid var(--border)', width: '100%' }}
                />

                <div style={{ display: 'flex', gap: 4, background: 'var(--card2)', padding: 2, borderRadius: 6 }}>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('attivi')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'attivi' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'attivi' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Attivi ({templatesList.filter(t => !t.archiviato).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('archiviati')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'archiviati' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'archiviati' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Archiviati ({templatesList.filter(t => !!t.archiviato).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTmplStatusSidebar('tutti')}
                    style={{
                      flex: 1,
                      background: tmplStatusSidebar === 'tutti' ? '#1e1b4b' : 'transparent',
                      color: tmplStatusSidebar === 'tutti' ? '#818cf8' : 'var(--muted)',
                      border: 'none',
                      padding: '3px 0',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Tutti ({templatesList.length})
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
                {templatesList
                  .filter(t => {
                    const matchSearch = !searchMasterTmplQuery || t.titolo.toLowerCase().includes(searchMasterTmplQuery.toLowerCase()) || t.descrizione.toLowerCase().includes(searchMasterTmplQuery.toLowerCase());
                    const matchStatus = tmplStatusSidebar === 'tutti' || (tmplStatusSidebar === 'archiviati' ? !!t.archiviato : !t.archiviato);
                    return matchSearch && matchStatus;
                  })
                  .map(t => {
                  const isCustom = t.id.startsWith('tmpl-custom');
                  const isSelected = selectedTemplateId === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => handleSelectTemplate(t)}
                      style={{
                        background: isSelected ? '#1e1b4b' : 'var(--card2)',
                        border: `1px solid ${isSelected ? '#6366f1' : t.archiviato ? '#4338ca' : 'var(--border)'}`,
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 6,
                        opacity: t.archiviato ? 0.8 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 11, color: isSelected ? '#a5b4fc' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.titolo}
                          </span>
                          {t.archiviato && (
                            <span style={{ fontSize: 8.5, background: '#312e81', color: '#c7d2fe', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                              📦
                            </span>
                          )}
                          {isCustom && (
                            <span style={{ fontSize: 8.5, background: '#064e3b', color: '#34d399', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                              Custom
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.descrizione}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {t.archiviato ? (
                          <button
                            type="button"
                            onClick={(e) => handleRestoreTemplate(t.id, t.titolo, e)}
                            style={{ background: '#064e3b', border: '1px solid #059669', color: '#34d399', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}
                            title="Ripristina modello tra gli attivi"
                          >
                            <span>♻️</span>
                            <span>Ripristina</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleArchiveTemplate(t.id, t.titolo, e)}
                            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}
                            title="Archivia modello master"
                          >
                            <span>📦</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => handleDeleteTemplate(t.id, t.titolo, e)}
                          style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', fontSize: 10, cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}
                          title="Elimina definitivamente modello master"
                        >
                          <span>🗑️</span>
                          <span>Elimina</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
    </>
  );
}
