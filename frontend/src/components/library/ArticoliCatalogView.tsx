import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CatBadge } from '../ui/CatBadge';
import { BadgeRevisione } from '../ui/BadgeRevisione';
import { fmt } from '../../utils';
import { updateArticoloPrezzoApi } from '../../api/client';
// §41 — i modelli allacciabili sono quelli della cartella dello studio, letta dal database.
// Prima l'elenco veniva da `localStorage` e un modello nuovo nasceva con un id inventato dal
// browser (`tmpl-custom-<timestamp>`) che il server scartava: l'articolo restava allacciato a
// un identificativo che a database non esisteva, e da un altro computer non si vedeva niente.
import { useCartellaTemplate } from '../../hooks/useCartellaTemplate';
import type { Articolo } from '../../types';

// ─── Componente Catalogo Articoli & Distinta Base ──────────────────
export function ArticoliCatalogView({ articoliList, onOpenNew, onDisattiva }: { articoliList: Articolo[]; onOpenNew: () => void; onDisattiva: (id: string, nome: string) => void }) {
  const [selectedCat, setSelectedCat] = useState<string>('TUTTI');
  const navigate = useNavigate();
  const editArtFileImportRef = useRef<HTMLInputElement>(null);
  const cartella = useCartellaTemplate();
  // Gli archiviati non si allacciano: sono carte che lo studio ha messo da parte.
  const allMasterTemplates = React.useMemo(
    () => cartella.modelli.filter(t => !t.archiviato),
    [cartella.modelli],
  );

  const resolveTemplateName = (mId: string) => {
    if (mId === 'm1') return 'Accordo NDA Riservatezza';
    if (mId === 'm2') return 'Procura Legale & Delega';
    if (mId === 'm3') return 'Dichiarazione UBO';
    if (mId === 'm4') return 'Statuto & Memorandum';
    const found = allMasterTemplates.find(t => t.id === mId);
    return found ? found.titolo : mId;
  };

  const handleCreateNewWordForArticle = async () => {
    const title = prompt('Inserisci il nome del nuovo Modello Word per questa prestazione:', `${editName || 'Documento'} - Modello Word`);
    if (!title || !title.trim()) return;

    // §41 — il modello nasce a database e l'id da allacciare è quello che torna dal server.
    const esito = await cartella.crea({
      titolo: title.trim(),
      categoria: (editingArt?.cat.toLowerCase() as any) || 'societario',
      descrizione: `Modello Word personalizzato creato per la prestazione "${editName}".`,
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; font-size: 18px; margin-bottom: 20px;">${title.trim().toUpperCase()}</h1>
<p style="text-align: right; color: #64748b; font-size: 11px;"><strong>Data:</strong> {{data_odierna}} | <strong>Pratica:</strong> {{progetto.titolo}}</p>
<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px; margin: 20px 0; font-size: 11.5px;">
  <strong>Cliente:</strong> {{cliente.ragione_sociale}} (P.IVA {{cliente.partita_iva}})<br/>
  <strong>Studio:</strong> {{studio.ragione_sociale}}
</div>
<p style="font-size: 11.5px; line-height: 1.6;">Testo e condizioni operative per la prestazione ${editName}...</p>
      `,
    });

    if (!esito.ok || !esito.modello) {
      alert(`⚠️ ${esito.messaggio}\n\nNessun modello è stato allacciato alla prestazione.`);
      return;
    }
    setEditDocModels(prev => [...prev, esito.modello!.id]);
    alert(`✓ ${esito.messaggio}\nAllacciato a questa prestazione.`);
  };

  const handleImportDocFileForArticle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;

      if (file.name.endsWith('.json')) {
        // §41 — l'importazione porta ogni modello a database e allaccia SOLO quelli confermati.
        const esito = await cartella.importaDaJson(content);
        const creati = esito.modelli || [];
        if (creati.length > 0) setEditDocModels(prev => [...prev, ...creati.map(m => m.id)]);
        alert(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}${creati.length > 0 ? `\n${creati.length} allacciati a questa prestazione.` : ''}`);
        return;
      }

      const htmlBody = content || `<h1>${file.name}</h1><p>Documento importato da PC per ${editName}...</p>`;
      const docNameClean = file.name.replace(/\.[^/.]+$/, "");
      const esito = await cartella.crea({
        titolo: docNameClean,
        categoria: (editingArt?.cat.toLowerCase() as any) || 'societario',
        descrizione: `Documento caricato da PC (${file.name}) per la prestazione "${editName}".`,
        contenutoHtml: htmlBody,
      });

      if (!esito.ok || !esito.modello) {
        alert(`⚠️ ${esito.messaggio}\n\nIl file "${file.name}" NON è stato allacciato.`);
        return;
      }
      setEditDocModels(prev => [...prev, esito.modello!.id]);
      alert(`✓ File "${file.name}" importato nell'archivio dello studio e allacciato alla prestazione.`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchEditArtTmpl, setSearchEditArtTmpl] = useState<string>('');
  const [editingArt, setEditingArt] = useState<Articolo | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editHours, setEditHours] = useState<number>(0);
  const [editName, setEditName] = useState<string>('');
  const [editFormMasterId, setEditFormMasterId] = useState<string>('f1');
  const [editDocModels, setEditDocModels] = useState<string[]>(['m1']);
  const [savingEdit, setSavingEdit] = useState(false);

  const categories = ['TUTTI', 'Analisi', 'Societario', 'Compliance', 'Banking', 'Trust', 'IP & Tax'];

  const filtered = articoliList.filter(a => {
    const matchCat = selectedCat === 'TUTTI' || a.cat === selectedCat;
    const matchQuery = a.n.toLowerCase().includes(searchQuery.toLowerCase()) || a.cat.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchQuery;
  });

  const totalOre = articoliList.reduce((sum, a) => sum + a.h, 0);
  const avgPrezzo = articoliList.length > 0 ? Math.round(articoliList.reduce((sum, a) => sum + a.p, 0) / articoliList.length) : 0;

  const handleStartEdit = (art: Articolo) => {
    // §41 — si rilegge la cartella dello studio, non la copia di questo browser: se un collega
    // ha aggiunto o archiviato un modello, l'elenco allacciabile lo mostra già aggiornato.
    void cartella.sincronizza();
    setEditingArt(art);
    setEditPrice(art.p);
    setEditHours(art.h);
    setEditName(art.n);
    setEditFormMasterId(art.formMasterId || 'f1');
    setEditDocModels(art.documentiRichiesti || ['m1']);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingArt) return;
    setSavingEdit(true);
    try {
      await updateArticoloPrezzoApi(editingArt.id, {
        prezzoDefault: editPrice * 100,
        oreDefault: editHours,
        nome: editName,
      });
      // §3.3 — aggiorna locale SOLO dopo la conferma del server. Prima anche il ramo
      // catch applicava le modifiche in locale e chiudeva il modal in silenzio: prezzo
      // e ore sembravano salvati mentre il database conservava i valori vecchi.
      editingArt.p = editPrice;
      editingArt.h = editHours;
      editingArt.n = editName;
      editingArt.documentiRichiesti = editDocModels;
      editingArt.formMasterId = editFormMasterId;
      setEditingArt(null);
    } catch (err: any) {
      alert(`Salvataggio articolo non riuscito: ${err?.message || 'errore di rete'}. Le modifiche NON sono state applicate, riprova.`);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Bar KPI & Toolbar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🧩</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Totale Articoli in Libreria</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{articoliList.length} Prestazioni</div>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--pill-indigo-bg)', color: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>⏱</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Monte Ore operative stimate</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{totalOre}h Complessive</div>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>💶</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Valore Medio Prestazione</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{fmt(avgPrezzo)}</div>
          </div>
        </div>
      </div>

      {/* Header Controlli: Filtri Categoria & Ricerca & Pulsante Nuovo */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        {/* Pills Categorie */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCat(c)}
              style={{
                background: selectedCat === c ? 'var(--indigo)' : 'var(--card2)',
                color: selectedCat === c ? 'var(--on-accent)' : 'var(--muted)',
                border: `1px solid ${selectedCat === c ? 'var(--indigo-l)' : 'var(--border)'}`,
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {c === 'TUTTI' ? 'Tutti gli Articoli' : c}
            </button>
          ))}
        </div>

        {/* Input Ricerca e Pulsante Nuovo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 Cerca per nome o categoria..."
            style={{ width: 220, fontSize: 12 }}
          />
          <button
            onClick={onOpenNew}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Nuovo Articolo Prestazione
          </button>
        </div>
      </div>

      {/* Grid Cards Articoli */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {filtered.map(a => (
          <div
            key={a.id}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
              boxShadow: '0 6px 24px rgba(0,0,0,.2)',
              transition: 'all .2s',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <CatBadge cat={a.cat} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => handleStartEdit(a)}
                    title="Modifica Prezzo, Ore e Documenti Allacciati"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--card2)', color: 'var(--indigo-l)', padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✏️ Modifica
                  </button>
                  <button
                    onClick={() => onDisattiva(a.id, a.n)}
                    title="§30 — Disattivazione: sparisce dal catalogo, distinte e progetti esistenti restano validi"
                    style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                  >
                    🗑
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)', background: 'var(--surface-1)', border: '1px solid var(--card2)', padding: '2px 8px', borderRadius: 20 }}>
                    v{a.ver || 1}.0
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: 'var(--text)' }}>{a.n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📄 Documenti Allacciati:</span>
                  {(a.documentiRichiesti && a.documentiRichiesti.length > 0) ? (
                    a.documentiRichiesti.map(mId => (
                      <span
                        key={mId}
                        onClick={() => navigate(`/documents?tmplId=${mId}`)}
                        title="Clicca per aprire in Document Studio (Word)"
                        style={{ background: 'var(--surface-1)', color: 'var(--indigo-l)', padding: '2px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, border: '1px solid var(--indigo-d)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <span>📎 {resolveTemplateName(mId)}</span>
                        <span style={{ fontSize: 8.5, opacity: 0.8 }}>↗</span>
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 10, fontStyle: 'italic' }}>Nessun documento allacciato</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>📋 Form Cliente:</span>
                  {a.formMasterId ? (
                    <span style={{ background: 'var(--pill-indigo-bg)', color: 'var(--purple)', padding: '2px 6px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, border: '1px solid var(--pill-purple-bg)' }}>
                      {a.formMasterId === 'f1' ? 'Form Dati Societari' : a.formMasterId === 'f2' ? 'Form UBO & Controllo' : 'Form Dati Bancari & KYC'}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: 10, fontStyle: 'italic' }}>Nessun form richiesto</span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Ore operative</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>⏱ {a.h}h stimate</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Prezzo Listino</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)', marginTop: 2 }}>{fmt(a.p)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Modifica Prezzo & Ore Articolo (§Admin) con 3 Opzioni Documento */}
      {editingArt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleSaveEdit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✏️ Modifica Listino & Documenti Allacciati</span>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Prestazione *</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Prezzo Listino (€) *</label>
                <input type="number" value={editPrice} onChange={e => setEditPrice(Number(e.target.value))} min={0} step={50} required style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore Stimate (h) *</label>
                <input type="number" value={editHours} onChange={e => setEditHours(Number(e.target.value))} min={1} required />
              </div>
            </div>

            {/* Sezione Documenti Allacciati: 1. In Memoria, 2. Crea Nuovo Word, 3. Importa da PC */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>📄 Documenti & Modelli Allacciati ({editDocModels.length})</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Seleziona dalla memoria, crea un nuovo modello Word o importalo dal PC</div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="file"
                    ref={editArtFileImportRef}
                    accept=".docx,.doc,.pdf,.html,.htm,.json"
                    style={{ display: 'none' }}
                    onChange={handleImportDocFileForArticle}
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewWordForArticle}
                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Crea un nuovo modello Word dedicato a questa prestazione"
                  >
                    ➕ Nuovo Word
                  </button>
                  <button
                    type="button"
                    onClick={() => editArtFileImportRef.current?.click()}
                    style={{ background: 'var(--pill-indigo-bg)', color: 'var(--indigo-l)', border: '1px solid var(--indigo-d)', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    title="Importa file .docx, .pdf, .html o .json dal tuo computer"
                  >
                    📁 Importa da PC
                  </button>
                </div>
              </div>

              {/* Search Filter per i Modelli nel modale */}
              <input
                type="text"
                placeholder="🔍 Cerca modello da allacciare..."
                value={searchEditArtTmpl}
                onChange={e => setSearchEditArtTmpl(e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', width: '100%' }}
              />

              {/* Grid di selezione dei modelli della cartella dello studio */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxHeight: 180, overflowY: 'auto', background: 'var(--card)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                {/* §41 — se la lettura dal server non è riuscita l'elenco può essere incompleto:
                    si dice, invece di far passare i modelli di serie per la libreria dello studio. */}
                {cartella.erroreLettura && (
                  <div style={{ fontSize: 10, color: 'var(--pill-red-fg)', background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', borderRadius: 6, padding: '4px 6px' }}>
                    ⚠️ Elenco possibilmente incompleto: {cartella.erroreLettura}
                  </div>
                )}
                {allMasterTemplates
                  .filter(item => !searchEditArtTmpl || item.titolo.toLowerCase().includes(searchEditArtTmpl.toLowerCase()) || item.categoria.toLowerCase().includes(searchEditArtTmpl.toLowerCase()))
                  .map(item => {
                  const checked = editDocModels.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        fontSize: 11,
                        cursor: 'pointer',
                        padding: '4px 6px',
                        borderRadius: 6,
                        background: checked ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                        color: checked ? 'var(--pill-indigo-fg)' : 'var(--text)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            if (e.target.checked) {
                              setEditDocModels([...editDocModels, item.id]);
                            } else {
                              setEditDocModels(editDocModels.filter(x => x !== item.id));
                            }
                          }}
                        />
                        <span style={{ fontWeight: checked ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.titolo}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {/* §41 — lo stato di revisione sta accanto al modello: chi allaccia una
                            carta a una prestazione sa se quella carta è stata riletta. */}
                        <BadgeRevisione modello={item} compatto />
                        <span style={{ fontSize: 8.5, background: 'var(--card2)', color: 'var(--muted)', padding: '1px 4px', borderRadius: 4, textTransform: 'uppercase' }}>
                          {item.categoria}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Form Master Dinamico */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📋 Form Master Dati da far Compilare al Cliente</label>
              <select
                value={editFormMasterId}
                onChange={e => setEditFormMasterId(e.target.value)}
                style={{ padding: 8, fontSize: 12 }}
              >
                <option value="">-- Nessun Form Richiesto --</option>
                <option value="f1">Form Dati Societari & Legale Rappresentante</option>
                <option value="f2">Form Titolarità Effettiva & UBO</option>
                <option value="f3">Form Dati Bancari & KYC Compliance</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🔗 Link Istruzioni per il Cliente (URL / Guida)</label>
              <input
                type="url"
                placeholder="es. https://gov.mt/adempimenti-notarili-guida"
                value={editingArt?.linkIstruzioni || ''}
                onChange={e => setEditingArt({ ...editingArt!, linkIstruzioni: e.target.value })}
                style={{ fontSize: 12 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setEditingArt(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={savingEdit} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{savingEdit ? 'Salvataggio...' : '✓ Salva Modifiche Prestazione'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
