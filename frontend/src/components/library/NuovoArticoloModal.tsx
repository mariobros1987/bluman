import React, { useState, useRef } from 'react';
import { getAllTemplates, saveCustomTemplate, importTemplatesFromJson, type DocumentTemplate } from '../../utils/documentTemplates';
import { creaArticoloApi, creaDocumentoTemplateApi } from '../../api/client';
import type { CategoriaModulo, Giurisdizione } from '../../types';

// ─── Componente Nuovo Articolo Modal ──────────────────────────────
export function NuovoArticoloModal({ giurList, onClose, onCreated }: { giurList: Giurisdizione[]; onClose: () => void; onCreated: () => void }) {
  const [nome, setNome] = useState('');
  const [cat, setCat] = useState<CategoriaModulo>('Analisi');
  const [giurisdizioneId, setGiurisdizioneId] = useState<string>('');
  const [ore, setOre] = useState(4);
  const [prezzo, setPrezzo] = useState(1200);
  const [loading, setLoading] = useState(false);

  const fileInputNewArtRef = useRef<HTMLInputElement>(null);
  const [searchNewArtTmpl, setSearchNewArtTmpl] = useState('');
  const [allMasterTemplates, setAllMasterTemplates] = useState<DocumentTemplate[]>(() => getAllTemplates());
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(['tmpl-engagement']);

  const reloadMasterTemplates = () => {
    setAllMasterTemplates(getAllTemplates());
  };

  const handleCreateNewWordForNewArt = async () => {
    const title = prompt('Inserisci il nome del nuovo Modello Word per questo articolo:', `${nome || 'Documento'} - Modello Word`);
    if (!title || !title.trim()) return;

    const newTmpl: DocumentTemplate = {
      id: `tmpl-custom-${Date.now()}`,
      titolo: title.trim(),
      categoria: (cat.toLowerCase() as any) || 'societario',
      descrizione: `Modello Word personalizzato per la nuova prestazione "${nome}".`,
      contenutoHtml: `
<h1 style="text-align: center; color: #1e1b4b; font-size: 18px; margin-bottom: 20px;">${title.trim().toUpperCase()}</h1>
<p style="text-align: right; color: #64748b; font-size: 11px;"><strong>Data:</strong> {{data_odierna}} | <strong>Pratica:</strong> {{progetto.titolo}}</p>
<div style="background: #f8fafc; border-left: 4px solid #4338ca; padding: 12px; margin: 20px 0; font-size: 11.5px;">
  <strong>Cliente:</strong> {{cliente.ragione_sociale}} (P.IVA {{cliente.partita_iva}})<br/>
  <strong>Studio:</strong> {{studio.ragione_sociale}}
</div>
<p style="font-size: 11.5px; line-height: 1.6;">Testo e condizioni operative per la prestazione ${nome}...</p>
      `,
    };

    saveCustomTemplate(newTmpl);
    // §3.3 — salvataggio locale immediato, esito del sync col server comunicato onestamente.
    try {
      await creaDocumentoTemplateApi(newTmpl);
      reloadMasterTemplates();
      setSelectedDocIds(prev => [...prev, newTmpl.id]);
      alert(`✓ Nuovo Modello Word "${newTmpl.titolo}" creato e collegato all'articolo!`);
    } catch (err: any) {
      alert(`Modello "${newTmpl.titolo}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
      setSelectedDocIds(prev => [...prev, newTmpl.id]);
    }
  };

  const handleImportDocFileForNewArt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      let htmlBody = '';
      if (file.name.endsWith('.json')) {
        const res = importTemplatesFromJson(content);
        if (res.success) {
          reloadMasterTemplates();
          const first = getAllTemplates()[0];
          if (first) setSelectedDocIds(prev => [...prev, first.id]);
          alert(`✓ Modello importato da file JSON e allacciato all'articolo!`);
          return;
        }
      } else {
        htmlBody = content || `<h1>${file.name}</h1><p>Documento importato da PC per ${nome}...</p>`;
      }

      const docNameClean = file.name.replace(/\.[^/.]+$/, "");
      const newTmpl: DocumentTemplate = {
        id: `tmpl-custom-${Date.now()}`,
        titolo: docNameClean,
        categoria: (cat.toLowerCase() as any) || 'societario',
        descrizione: `Documento caricato da PC (${file.name}) per la prestazione "${nome}".`,
        contenutoHtml: htmlBody,
      };

      saveCustomTemplate(newTmpl);
      // §3.3 — stesso pattern: locale subito, sync col server dichiarato onestamente.
      try {
        await creaDocumentoTemplateApi(newTmpl);
        reloadMasterTemplates();
        setSelectedDocIds(prev => [...prev, newTmpl.id]);
        alert(`✓ File "${file.name}" importato dal PC e allacciato con successo!`);
      } catch (err: any) {
        alert(`File "${file.name}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}.`);
        setSelectedDocIds(prev => [...prev, newTmpl.id]);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Passaggi dinamici con Form e Documenti
  const [passaggi, setPassaggi] = useState<Array<{
    titolo: string;
    tipo: 'info' | 'documento' | 'form' | 'verifica';
    chi: 'operatore' | 'cliente';
    descrizione: string;
    campiFormText?: string;
    fileNome?: string;
  }>>([
    { titolo: 'Raccolta dati ed anagrafica', tipo: 'form', chi: 'cliente', descrizione: 'Il cliente compila il modulo con i dati societari.', campiFormText: 'Ragione Sociale, Partita IVA, Legale Rappresentante' },
    { titolo: 'Caricamento Contratto & Firma', tipo: 'documento', chi: 'cliente', descrizione: 'Il cliente scarica e firma digitalmente il documento.', fileNome: 'Accordo_Servizi_Advisory.pdf' },
    { titolo: 'Verifica ed approvazione operatoria', tipo: 'verifica', chi: 'operatore', descrizione: 'L\'operatore verifica la conformità dei dati inviati.' },
  ]);

  const addPassaggio = () => {
    setPassaggi([
      ...passaggi,
      { titolo: 'Nuovo passaggio', tipo: 'info', chi: 'operatore', descrizione: 'Descrizione delle attività previste' },
    ]);
  };

  const removePassaggio = (index: number) => {
    setPassaggi(passaggi.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setLoading(true);
    try {
      await creaArticoloApi({
        nome,
        categoria: cat,
        oreDefault: Number(ore),
        prezzoDefault: Number(prezzo) * 100,
        documentiRichiesti: selectedDocIds,
        passaggi: passaggi.map(p => ({
          titolo: p.titolo,
          tipo: p.tipo,
          chi: p.chi,
          descrizione: p.tipo === 'form'
            ? `${p.descrizione} (Campi: ${p.campiFormText || 'Nessuno'})`
            : p.tipo === 'documento'
            ? `${p.descrizione} [Allegato: ${p.fileNome || 'Documento.pdf'}]`
            : p.descrizione,
        })),
      });
      onCreated();
      onClose();
    } catch (err: any) {
      // §3.3 — creazione articolo fallita: va detto, non solo loggato in console.
      alert(`Creazione prestazione non riuscita: ${err?.message || 'errore di rete'}. Riprova.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <form onSubmit={handleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🧩 Nuovo Articolo Prestazione con Documenti & Procedura</span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome prestazione / articolo *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Redazione Parere Fiscale Malta" required />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
            <select value={cat} onChange={e => setCat(e.target.value as CategoriaModulo)}>
              {['Analisi', 'Societario', 'Trust', 'Banking', 'Fiscale', 'Legale', 'IP', 'Compliance'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🌍 Giurisdizione Target *</label>
          <select value={giurisdizioneId} onChange={e => setGiurisdizioneId(e.target.value)}>
            <option value="">🌐 Generico / Tutte le Giurisdizioni</option>
            {giurList.map(g => {
              const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
              return <option key={g.id} value={g.id}>{flag} {g.nome} ({g.codice})</option>;
            })}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore previste (default)</label>
            <input type="number" value={ore} onChange={e => setOre(Number(e.target.value))} min={1} required />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Prezzo listino (€)</label>
            <input type="number" value={prezzo} onChange={e => setPrezzo(Number(e.target.value))} min={0} step={50} required />
          </div>
        </div>

        {/* Sezione Documenti & Modelli Allacciati (In Memoria, Crea Word, Importa da PC) */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>📄 Documenti & Modelli Allacciati ({selectedDocIds.length})</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Allaccia modelli dalla memoria, creane uno nuovo in Word o importalo dal PC</div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="file"
                ref={fileInputNewArtRef}
                accept=".docx,.doc,.pdf,.html,.htm,.json"
                style={{ display: 'none' }}
                onChange={handleImportDocFileForNewArt}
              />
              <button
                type="button"
                onClick={handleCreateNewWordForNewArt}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                title="Crea un nuovo modello Word dedicato a questa prestazione"
              >
                ➕ Nuovo Word
              </button>
              <button
                type="button"
                onClick={() => fileInputNewArtRef.current?.click()}
                style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                title="Importa file .docx, .pdf, .html o .json dal tuo computer"
              >
                📁 Importa da PC
              </button>
            </div>
          </div>

          {/* Search filter nel modale */}
          <input
            type="text"
            placeholder="🔍 Cerca modello da allacciare..."
            value={searchNewArtTmpl}
            onChange={e => setSearchNewArtTmpl(e.target.value)}
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)', width: '100%' }}
          />

          {/* Lista Modelli in Memoria */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxHeight: 150, overflowY: 'auto', background: 'var(--card)', padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
            {allMasterTemplates
              .filter(item => !searchNewArtTmpl || item.titolo.toLowerCase().includes(searchNewArtTmpl.toLowerCase()) || item.categoria.toLowerCase().includes(searchNewArtTmpl.toLowerCase()))
              .map(item => {
              const checked = selectedDocIds.includes(item.id);
              const isCustom = item.id.startsWith('tmpl-custom');
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
                    color: checked ? '#a5b4fc' : 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedDocIds([...selectedDocIds, item.id]);
                        } else {
                          setSelectedDocIds(selectedDocIds.filter(x => x !== item.id));
                        }
                      }}
                    />
                    <span style={{ fontWeight: checked ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.titolo}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {isCustom && (
                      <span style={{ fontSize: 8.5, background: '#064e3b', color: '#34d399', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                        Custom
                      </span>
                    )}
                    <span style={{ fontSize: 8.5, background: 'var(--card2)', color: 'var(--muted)', padding: '1px 4px', borderRadius: 4, textTransform: 'uppercase' }}>
                      {item.categoria}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Costruttore Passaggi (Form & Documenti) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)' }}>
              ⚙️ Procedura Guidata Passaggi (Form, Documenti & Firma)
            </span>
            <button type="button" onClick={addPassaggio} style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
              + Aggiungi Passaggio
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {passaggi.map((p, i) => (
              <div key={i} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', width: 20 }}>#{i + 1}</span>
                  <input
                    style={{ flex: 2, fontSize: 12 }}
                    value={p.titolo}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].titolo = e.target.value;
                      setPassaggi(updated);
                    }}
                    placeholder="Titolo passaggio..."
                    required
                  />
                  <select
                    style={{ flex: 1, fontSize: 11 }}
                    value={p.tipo}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].tipo = e.target.value as any;
                      setPassaggi(updated);
                    }}
                  >
                    <option value="info">ℹ️ Testo Info</option>
                    <option value="form">📋 Form Dati</option>
                    <option value="documento">📎 Doc Firma</option>
                    <option value="verifica">✓ Verifica</option>
                  </select>
                  <select
                    style={{ flex: 1, fontSize: 11 }}
                    value={p.chi}
                    onChange={e => {
                      const updated = [...passaggi];
                      updated[i].chi = e.target.value as any;
                      setPassaggi(updated);
                    }}
                  >
                    <option value="cliente">🧑‍💼 Cliente</option>
                    <option value="operatore">👤 Operatore</option>
                  </select>
                  <button type="button" onClick={() => removePassaggio(i)} style={{ background: 'none', border: 'none', color: 'var(--hint)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                </div>

                {/* Campi specifici per FORM */}
                {p.tipo === 'form' && (
                  <div style={{ marginTop: 2 }}>
                    <label style={{ fontSize: 10, color: '#a78bfa', display: 'block', marginBottom: 2 }}>📋 Campi del Form richiesti al cliente (separati da virgola):</label>
                    <input
                      style={{ fontSize: 11, background: '#200f40', borderColor: '#4c1d95' }}
                      value={p.campiFormText || ''}
                      onChange={e => {
                        const updated = [...passaggi];
                        updated[i].campiFormText = e.target.value;
                        setPassaggi(updated);
                      }}
                      placeholder="es. Ragione Sociale, P.IVA, Titolare Effettivo, IBAN"
                    />
                  </div>
                )}

                {/* Campi specifici per DOCUMENTO */}
                {p.tipo === 'documento' && (
                  <div style={{ marginTop: 2 }}>
                    <label style={{ fontSize: 10, color: '#818cf8', display: 'block', marginBottom: 2 }}>📎 Nome File PDF da caricare per Firma Cliente:</label>
                    <input
                      style={{ fontSize: 11, background: '#1a1f3d', borderColor: '#2d3260' }}
                      value={p.fileNome || ''}
                      onChange={e => {
                        const updated = [...passaggi];
                        updated[i].fileNome = e.target.value;
                        setPassaggi(updated);
                      }}
                      placeholder="es. Contratto_Firma_Cliente.pdf"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={loading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{loading ? 'Salvataggio...' : '✓ Salva Articolo & Procedura'}</button>
        </div>
      </form>
    </div>
  );
}
