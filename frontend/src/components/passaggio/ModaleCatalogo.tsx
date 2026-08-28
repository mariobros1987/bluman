import React from 'react';
import type { DocumentTemplate } from '../../utils/documentTemplates';
import type { MicroVoce } from '../../types';
import { ALL_STUDIO_TEMPLATES } from './catalogoModelliStudio';
import { closeBtnStyle } from './passaggioStyles';

// ─── Modale Catalogo Completo 30 Modelli Studio ────────────────────────
export function ModaleCatalogo({
  voce,
  setShowCatalogModal,
  selectedCatalogCategory,
  setSelectedCatalogCategory,
  filteredCatalog,
  handleApplyTemplate,
}: {
  voce: MicroVoce;
  setShowCatalogModal: React.Dispatch<React.SetStateAction<boolean>>;
  selectedCatalogCategory: string;
  setSelectedCatalogCategory: React.Dispatch<React.SetStateAction<string>>;
  filteredCatalog: DocumentTemplate[];
  handleApplyTemplate: (tmpl: DocumentTemplate, stepId?: string) => void;
}) {
  return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 740, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--indigo-l)' }}>📂 Catalogo Completo Modelli Studio ({ALL_STUDIO_TEMPLATES.length} Atti)</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Seleziona l'atto societario, tributario o contrattuale da associare alla voce "{voce.n}"</div>
                </div>
                <button onClick={() => setShowCatalogModal(false)} style={closeBtnStyle}>✕</button>
              </div>

              {/* Filtri Categoria */}
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, overflowX: 'auto', background: 'var(--card)' }}>
                {['ALL', 'societario', 'fiscale', 'trust', 'compliance', 'engagement', 'nda'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCatalogCategory(cat)}
                    style={{
                      padding: '4px 10px', borderRadius: 14, fontSize: 10.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: selectedCatalogCategory === cat ? 'var(--indigo)' : 'var(--card2)',
                      color: selectedCatalogCategory === cat ? '#fff' : 'var(--muted)',
                    }}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Lista Modelli */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {filteredCatalog.map(t => (
                  <div key={t.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>📄 {t.titolo}</span>
                        <span style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 8, background: '#312e81', color: '#c7d2fe', textTransform: 'uppercase', fontWeight: 700 }}>
                          {t.categoria}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.3 }}>
                        {t.descrizione}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyTemplate(t)}
                      style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      ⚡ Collega alla Voce
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
  );
}
