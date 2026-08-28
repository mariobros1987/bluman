import React from 'react';
import { getFormattedLogoUrl } from '../../utils';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant } from '../../utils/tenant';
import { toolbarBtnStyle, dividerStyle } from './editorStyles';

export function EditorCanvas({
  executeFormat,
  editorRef,
  rawTemplateRef,
  tenantInfo,
  activeProgetto,
}: {
  executeFormat: (cmd: string, val?: string) => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
  rawTemplateRef: React.RefObject<string>;
  tenantInfo: any;
  activeProgetto: any;
}) {
  return (
    <>
        {/* Right Column: Word-like Editor Canvas with A4 Sheet */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Word Formatting Toolbar */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => executeFormat('undo')} style={toolbarBtnStyle} title="Annulla">↩ Annulla</button>
            <button type="button" onClick={() => executeFormat('redo')} style={toolbarBtnStyle} title="Ripristina">↪ Ripristina</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('formatBlock', '<h1>')} style={toolbarBtnStyle} title="Titolo 1">H1</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<h2>')} style={toolbarBtnStyle} title="Titolo 2">H2</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<h3>')} style={toolbarBtnStyle} title="Titolo 3">H3</button>
            <button type="button" onClick={() => executeFormat('formatBlock', '<p>')} style={toolbarBtnStyle} title="Paragrafo">P</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('bold')} style={{ ...toolbarBtnStyle, fontWeight: 900 }} title="Grassetto">B</button>
            <button type="button" onClick={() => executeFormat('italic')} style={{ ...toolbarBtnStyle, fontStyle: 'italic' }} title="Corsivo">I</button>
            <button type="button" onClick={() => executeFormat('underline')} style={{ ...toolbarBtnStyle, textDecoration: 'underline' }} title="Sottolineato">U</button>
            <button type="button" onClick={() => executeFormat('strikeThrough')} style={{ ...toolbarBtnStyle, textDecoration: 'line-through' }} title="Barrato">S</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('justifyLeft')} style={toolbarBtnStyle} title="Allinea Sinistra">⇤</button>
            <button type="button" onClick={() => executeFormat('justifyCenter')} style={toolbarBtnStyle} title="Allinea Centro">≡</button>
            <button type="button" onClick={() => executeFormat('justifyRight')} style={toolbarBtnStyle} title="Allinea Destra">⇥</button>
            <button type="button" onClick={() => executeFormat('justifyFull')} style={toolbarBtnStyle} title="Giustifica">≣</button>
            <div style={dividerStyle} />
            <button type="button" onClick={() => executeFormat('insertUnorderedList')} style={toolbarBtnStyle} title="Elenco Puntato">• List</button>
            <button type="button" onClick={() => executeFormat('insertOrderedList')} style={toolbarBtnStyle} title="Elenco Numerato">1. List</button>
            <button type="button" onClick={() => executeFormat('insertHorizontalRule')} style={toolbarBtnStyle} title="Linea Divisoria">— Line</button>
          </div>

          {/* Realistic A4 White Sheet Container */}
          <div style={{ background: '#334155', padding: '30px 20px', borderRadius: 14, display: 'flex', justifyContent: 'center', minHeight: '800px', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)' }}>
            <div style={{ background: '#ffffff', color: '#0f172a', width: '100%', maxWidth: '780px', minHeight: '1050px', padding: '50px 60px', borderRadius: 2, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: "'Inter', sans-serif" }}>
              {/* Sheet Header (Studio Logo & Info) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #4338ca', paddingBottom: 14, marginBottom: 30 }}>
                  {(() => {
                    const rawLogo = tenantInfo?.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url'));
                    if (rawLogo) {
                      return (
                        <img
                          src={getFormattedLogoUrl(rawLogo)}
                          alt="Logo"
                          style={{ height: 42, maxWidth: 180, objectFit: 'contain' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      );
                    }
                    return (
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#1e1b4b', display: 'flex', alignItems: 'center', gap: 8 }}>
                        🏛 {(tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'STUDIO PROFESSIONALE').toUpperCase()}
                      </div>
                    );
                  })()}
                  <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
                    <strong style={{ color: '#1e1b4b', fontSize: 11 }}>{tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'Studio Professionale'}</strong><br/>
                    {tenantInfo?.sedeLegale || getStudioInfoForTenant(getCurrentTenantId()).sedeLegale ? <>{tenantInfo?.sedeLegale || getStudioInfoForTenant(getCurrentTenantId()).sedeLegale}<br/></> : null}
                    {(tenantInfo?.piva || getStudioInfoForTenant(getCurrentTenantId()).piva) ? `P.IVA/TIN: ${tenantInfo?.piva || getStudioInfoForTenant(getCurrentTenantId()).piva}` : ''}{(tenantInfo?.telefono || getStudioInfoForTenant(getCurrentTenantId()).telefono) ? ` | Tel: ${tenantInfo?.telefono || getStudioInfoForTenant(getCurrentTenantId()).telefono}` : ''}
                  </div>
                </div>

                {/* Editable Content Area (Word-like Smooth Native Typing) */}
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => {
                    rawTemplateRef.current = (e.target as HTMLElement).innerHTML;
                  }}
                  style={{
                    outline: 'none',
                    minHeight: '800px',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    color: '#0f172a',
                  }}
                />
              </div>

              {/* Sheet Footer (Pagination & Legal) */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 40, display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#94a3b8' }}>
                <span>Documento Riservato • {tenantInfo?.ragioneSociale || getStudioInfoForTenant(getCurrentTenantId()).ragioneSociale || 'Studio Professionale'} • Pratica: {activeProgetto?.titolo || activeProgetto?.n || 'Incarico Professionale'}</span>
                <span>Pagina 1 di 1 • Firma Elettronica Semplice · art. 20 CAD</span>
              </div>
            </div>
          </div>
        </div>
    </>
  );
}
