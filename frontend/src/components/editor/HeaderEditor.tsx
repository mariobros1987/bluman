import React from 'react';
import type { NavigateFunction } from 'react-router-dom';

export function HeaderEditor({
  navigate,
  tagDisplayMode,
  setTagDisplayMode,
  handleExportPdf,
  handleExportWord,
  handleDeleteTemplate,
  selectedTemplateId,
  titoloDocumento,
  handleSaveToVault,
  salvando,
  feedback,
}: {
  navigate: NavigateFunction;
  tagDisplayMode: 'highlight' | 'plain' | 'raw';
  setTagDisplayMode: React.Dispatch<React.SetStateAction<'highlight' | 'plain' | 'raw'>>;
  handleExportPdf: () => void;
  handleExportWord: () => void;
  handleDeleteTemplate: (tmplId: string, tmplTitolo: string, e: React.MouseEvent) => void;
  selectedTemplateId: string;
  titoloDocumento: string;
  handleSaveToVault: () => void;
  salvando: boolean;
  feedback: string | null;
}) {
  return (
    <>
      {/* Top Header Bar */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
            title="Torna alla pagina precedente"
          >
            <span>← Indietro</span>
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📝 Studio Document Studio & Contract Builder</span>
              <span style={{ fontSize: 10, background: 'var(--pill-indigo-bg)', color: 'var(--indigo-l)', padding: '3px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase' }}>
                Word WYSIWYG + Smart Tags ERP
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              Crea, personalizza ed esporta contratti, NDA, deleghe e engagement letter con intestazione studio, piè di pagina e segnaposto anagrafica live.
            </div>
          </div>
        </div>

        {/* Action Buttons & Tag Display Switcher */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setTagDisplayMode('highlight')}
              style={{
                background: tagDisplayMode === 'highlight' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: tagDisplayMode === 'highlight' ? 'var(--indigo-l)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i dati anagrafici reali evidenziati come Smart Chip dinamico"
            >
              🏷️ Dati Reali (Smart Chip)
            </button>
            <button
              onClick={() => setTagDisplayMode('plain')}
              style={{
                background: tagDisplayMode === 'plain' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: tagDisplayMode === 'plain' ? 'var(--indigo-l)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i dati anagrafici in testo normale non evidenziato"
            >
              📄 Testo Naturale
            </button>
            <button
              onClick={() => setTagDisplayMode('raw')}
              style={{
                background: tagDisplayMode === 'raw' ? 'var(--pill-indigo-bg)' : 'transparent',
                color: tagDisplayMode === 'raw' ? 'var(--indigo-l)' : 'var(--muted)',
                border: 'none',
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Mostra i codici grezzi {{tag}}"
            >
              🔍 Codici &#123;&#123;Tag&#125;&#125;
            </button>
          </div>

          <button
            onClick={handleExportPdf}
            style={{ background: 'var(--pill-green-bg)', color: 'var(--green)', border: '1px solid var(--green)', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Esporta in formato PDF A4 vettoriale"
          >
            <span>📥 Esporta PDF A4</span>
          </button>

          <button
            onClick={handleExportWord}
            style={{ background: 'var(--pill-indigo-bg)', color: 'var(--pill-blue-fg)', border: '1px solid var(--indigo-l)', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Esporta in formato Microsoft Word (.doc) apribile"
          >
            <span>📝 Esporta Word (.doc)</span>
          </button>

          <button
            onClick={(e) => handleDeleteTemplate(selectedTemplateId, titoloDocumento, e)}
            style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--pill-red-fg)', border: '1px solid var(--red)', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Elimina questo modello master dalla libreria"
          >
            <span>🗑️ Elimina Modello Master</span>
          </button>

          <button
            onClick={handleSaveToVault}
            disabled={salvando}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            {salvando ? 'Salvataggio...' : '📁 Salva nel Vault Progetto'}
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ padding: '12px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: 'var(--pill-green-bg)', color: 'var(--green)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{feedback}</span>
        </div>
      )}
    </>
  );
}
