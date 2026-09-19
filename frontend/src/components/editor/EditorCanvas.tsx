import React from 'react';
import { toolbarBtnStyle, dividerStyle } from './editorStyles';
import { FoglioA4 } from '../documenti/FoglioA4';

/**
 * §39 — Il canvas non disegna più un foglio suo.
 *
 * Le misure del foglio, i margini e il punto di fine pagina stanno in `FoglioA4`, che le prende da
 * `src/util/paginaA4.ts` — le stesse del PDF. Intestazione e piè di pagina non sono più JSX cablato
 * qui: arrivano come HTML dalla pagina, che li tiene nello stato e li salva. È quello che rende
 * possibile sbloccarli con un doppio clic e non perdere la modifica (regola 3).
 */
export function EditorCanvas({
  executeFormat,
  editorRef,
  rawTemplateRef,
  intestazioneHtml,
  setIntestazioneHtml,
  piedeHtml,
  setPiedeHtml,
}: {
  executeFormat: (cmd: string, val?: string) => void;
  editorRef: React.RefObject<HTMLDivElement | null>;
  rawTemplateRef: React.RefObject<string>;
  intestazioneHtml: string;
  setIntestazioneHtml: (html: string) => void;
  piedeHtml: string;
  setPiedeHtml: (html: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Barra di formattazione stile Word */}
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

      <FoglioA4
        intestazione={{ html: intestazioneHtml, onModifica: setIntestazioneHtml, etichetta: 'Intestazione' }}
        piede={{ html: piedeHtml, onModifica: setPiedeHtml, etichetta: 'Piè di pagina' }}
      >
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => {
            rawTemplateRef.current = (e.target as HTMLElement).innerHTML;
          }}
          style={{
            outline: 'none',
            minHeight: 520,
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--surface-2)',
          }}
        />
      </FoglioA4>
    </div>
  );
}
