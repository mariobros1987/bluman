import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CatBadge } from '../ui/CatBadge';
import { downloadRealPdf } from '../../utils/pdfGenerator';
import { PREBUILT_TEMPLATES, exportTemplatesAsJson } from '../../utils/documentTemplates';
import { getStudioInfoForTenant } from '../../utils/tenant';
import { uploadFileApi, fetchClienti, fetchProgetti } from '../../api/client';
// §41 — l'elenco dei modelli e i gesti su di essi passano dalla cartella dello studio
// (database). Prima archiviazione ed eliminazione scrivevano in `localStorage`: valevano per
// questo browser, e un modello archiviato dal titolare restava attivo per tutti gli altri.
import { useCartellaTemplate } from '../../hooks/useCartellaTemplate';

// ─── Componente Libreria Documenti in Bianco & Form Master ────────
export function LibreriaDocumentiEForm() {
  const navigate = useNavigate();
  const libImportFileRef = useRef<HTMLInputElement>(null);

  const [searchDocQuery, setSearchDocQuery] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState('TUTTI');
  const [statusFilter, setStatusFilter] = useState<'attivi' | 'archiviati' | 'tutti'>('attivi');

  // §41 — la libreria dei modelli è quella dello studio, letta dal database. `docModels` era
  // uno stato riempito da `localStorage`; ora è derivato dalla cartella, così un modello creato
  // o archiviato altrove si vede anche qui senza ricaricare la pagina.
  const cartella = useCartellaTemplate();
  const docModels = React.useMemo(
    () =>
      cartella.modelli.map((t) => ({
        id: t.id,
        templateId: t.id,
        nome: `${t.titolo}.docx`,
        cat: t.categoria === 'engagement' || t.categoria === 'nda' ? 'Contratti' :
             t.categoria === 'societario' ? 'Societario' :
             t.categoria === 'trust' ? 'Trust' :
             t.categoria === 'compliance' ? 'Compliance' :
             t.categoria === 'delega' ? 'Societario' : 'Contratti',
        firma: t.riferimentoSerie === 'tmpl-engagement' || t.riferimentoSerie === 'tmpl-nda' ||
               t.riferimentoSerie === 'tmpl-delega' || t.riferimentoSerie === 'tmpl-compliance' ||
               t.id === 'tmpl-engagement' || t.id === 'tmpl-nda' || t.id === 'tmpl-delega' || t.id === 'tmpl-compliance',
        desc: t.descrizione,
        url: undefined as string | undefined,
        archiviato: !!t.archiviato,
      })),
    [cartella.modelli],
  );

  const [formMasters, setFormMasters] = useState([
    { id: 'f1', nome: 'Form Dati Societari & Legale Rappresentante', campi: ['Ragione Sociale', 'P.IVA / VAT', 'Codice Fiscale', 'Indirizzo Sede Legale', 'Legale Rappresentante'] },
    { id: 'f2', nome: 'Form Titolarità Effettiva & Struttura di Controllo', campi: ['Nome Titolare Effettivo', 'Percentuale Quote', 'Dati Passaporto', 'Residenza Fiscale'] },
    { id: 'f3', nome: 'Form Dati Bancari & KYC Compliance', campi: ['Banca di Riferimento', 'IBAN', 'Origine dei Fondi', 'Volume Affari Annuo'] },
  ]);

  const [newDocOpen, setNewDocOpen] = useState(false);
  const [docName, setDocName] = useState('');
  const [docCat, setDocCat] = useState('Societario');
  const [docDesc, setDocDesc] = useState('');
  const [docSign, setDocSign] = useState(true);

  const [newFormOpen, setNewFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formFieldsText, setFormFieldsText] = useState('');

  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleArchiveDoc = async (templateId: string, nome: string) => {
    const tmpl = cartella.modelli.find((t) => t.id === templateId);
    if (!tmpl) {
      alert(`Il modello "${nome}" non è più in elenco: ricarica la libreria.`);
      return;
    }
    // §41 — l'archiviazione va a database: vale per tutto lo studio, non per questo browser.
    const esito = await cartella.archivia(tmpl, true);
    alert(
      esito.ok
        ? `📦 ${esito.messaggio} (I documenti storici già presenti nei progetti rimangono inalterati).`
        : `⚠️ ${esito.messaggio}`,
    );
  };

  const handleRestoreDoc = async (templateId: string, nome: string) => {
    const tmpl = cartella.modelli.find((t) => t.id === templateId);
    if (!tmpl) {
      alert(`Il modello "${nome}" non è più in elenco: ricarica la libreria.`);
      return;
    }
    const esito = await cartella.archivia(tmpl, false);
    alert(`${esito.ok ? '♻️' : '⚠️'} ${esito.messaggio}`);
  };

  const handleDeleteDoc = async (templateId: string, nome: string) => {
    const tmpl = cartella.modelli.find((t) => t.id === templateId);
    if (!tmpl) {
      alert(`Il modello "${nome}" non è più in elenco: ricarica la libreria.`);
      return;
    }
    if (!confirm(`Sei sicuro di voler eliminare definitivamente il modello master "${nome}"?\n\nI documenti già firmati o salvati nei progetti del cliente rimarranno comunque congelati e perfettamente integri.`)) return;
    // §3.3 / §41 — prima il server, poi l'elenco: il modello sparisce dalla libreria solo a
    // eliminazione confermata. Prima si cancellava in locale e il `catch {}` vuoto annunciava
    // comunque «eliminato», con il modello che riappariva al reload.
    const esito = await cartella.elimina(tmpl);
    alert(`${esito.ok ? '🗑️' : '⚠️'} ${esito.messaggio}`);
  };

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() && !fileToUpload) return;
    setUploading(true);
    const nameToUse = docName.trim() || (fileToUpload ? fileToUpload.name : 'Documento.docx');

    try {
      if (fileToUpload) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(fileToUpload);
        });
        const base64Data = await base64Promise;
        await uploadFileApi(nameToUse, base64Data);
      }

      // §41 — nessun id inventato dal browser e nessuna scrittura in `localStorage`: l'id è
      // quello della riga creata dal server, che è anche l'unico con cui si potrà archiviarlo
      // o eliminarlo dopo.
      const esito = await cartella.crea({
        titolo: nameToUse.replace(/\.[^/.]+$/, ""),
        categoria: (docCat.toLowerCase() as any) || 'societario',
        descrizione: docDesc || 'Modello master personalizzato caricato nella libreria studio.',
        contenutoHtml: `<h1>${nameToUse}</h1><p>Bozza modello master studio...</p>`,
      });
      if (esito.ok) {
        setDocName('');
        setDocDesc('');
        setFileToUpload(null);
        setNewDocOpen(false);
      }
      alert(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
    } catch (err: any) {
      // Upload del file fallito: niente è stato salvato, né in locale né sul server.
      alert(`Caricamento del documento non riuscito: ${err?.message || 'errore di rete'}. Il file NON è stato salvato.`);
    } finally {
      setUploading(false);
    }
  };

  const handleImportBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (file.name.endsWith('.json')) {
        // §41 — ogni modello del bundle passa dal server: il conteggio dice quanti sono
        // arrivati nell'archivio dello studio, non quanti erano nel file.
        const esito = await cartella.importaDaJson(content);
        alert(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
      } else {
        const esito = await cartella.crea({
          titolo: file.name.replace(/\.[^/.]+$/, ""),
          categoria: 'societario',
          descrizione: `Modello importato da "${file.name}"`,
          contenutoHtml: content,
        });
        alert(`${esito.ok ? '✓' : '⚠️'} ${esito.messaggio}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportBundle = () => {
    const jsonStr = exportTemplatesAsJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluman_master_templates_bundle_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleAddForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const campiArr = formFieldsText.split(',').map(s => s.trim()).filter(Boolean);
    setFormMasters([
      ...formMasters,
      {
        id: `f-${Date.now()}`,
        nome: formName,
        campi: campiArr.length > 0 ? campiArr : ['Campo 1', 'Campo 2'],
      },
    ]);
    setFormName('');
    setFormFieldsText('');
    setNewFormOpen(false);
  };

  const [linkingDocModel, setLinkingDocModel] = useState<any | null>(null);
  const [clientiList, setClientiList] = useState<any[]>([]);
  const [progettiList, setProgettiList] = useState<any[]>([]);
  const [selectedLinkClientId, setSelectedLinkClientId] = useState<string>('');
  const [selectedLinkProjId, setSelectedLinkProjId] = useState<string>('');
  const [clientModalSearch, setClientModalSearch] = useState<string>('');
  const [linkingSuccessMsg, setLinkingSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadLinkageData() {
      const dbClienti = await fetchClienti();
      if (dbClienti && Array.isArray(dbClienti) && dbClienti.length > 0) {
        setClientiList(dbClienti);
        setSelectedLinkClientId(String(dbClienti[0].id));
      }
      const dbProgetti = await fetchProgetti();
      if (dbProgetti && Array.isArray(dbProgetti)) {
        setProgettiList(dbProgetti);
      }
    }
    loadLinkageData();
  }, []);

  const handleDownloadTemplatePdf = async (m: any) => {
    const studio = getStudioInfoForTenant();
    const tmpl = cartella.modelli.find(t => t.id === m.templateId || t.id === m.id) || PREBUILT_TEMPLATES[0];
    const htmlContent = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #0f172a;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
          <div>
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">${studio.sedeLegale} · P.IVA ${studio.piva}</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Modello: #${m.cat}<br />
            Data: ${new Date().toLocaleDateString('it-IT')}
          </div>
        </div>
        <div>${tmpl.contenutoHtml}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>${studio.ragioneSociale} • Modello Ufficiale Studio</span>
          <span>Firma Elettronica Semplice • art. 20 CAD</span>
        </div>
      </div>
    `;
    await downloadRealPdf(m.nome.replace(/\.[^/.]+$/, "") + '.pdf', htmlContent);
  };

  const handleConfirmLinkToClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingDocModel || !selectedLinkClientId) return;
    const clientObj = clientiList.find(c => String(c.id) === String(selectedLinkClientId));
    const projObj = progettiList.find(p => String(p.id) === String(selectedLinkProjId));
    const targetName = projObj ? `nel Progetto "${projObj.n || projObj.nome}"` : 'nell Anagrafica del Cliente';

    setLinkingSuccessMsg(`✓ Modello "${linkingDocModel.nome}" collegato con successo a ${clientObj?.nome || 'Cliente'} ${targetName}!`);
    setTimeout(() => {
      setLinkingSuccessMsg(null);
      setLinkingDocModel(null);
    }, 2500);
  };

  // Filtraggio dinamico Modelli
  const filteredDocModels = docModels.filter(m => {
    const matchSearch = m.nome.toLowerCase().includes(searchDocQuery.toLowerCase()) || m.desc.toLowerCase().includes(searchDocQuery.toLowerCase());
    const matchCat = selectedCatFilter === 'TUTTI' || m.cat.toLowerCase() === selectedCatFilter.toLowerCase();
    const matchStatus = statusFilter === 'tutti' || (statusFilter === 'archiviati' ? !!m.archiviato : !m.archiviato);
    return matchSearch && matchCat && matchStatus;
  });

  const countAttivi = docModels.filter(m => !m.archiviato).length;
  const countArchiviati = docModels.filter(m => !!m.archiviato).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sezione 1: Modelli Documenti in Bianco */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📄 Modelli Documenti & Contratti Master ({filteredDocModels.length})</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Crea, importa, archivia o elimina modelli in bianco riutilizzabili dello studio</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={libImportFileRef}
              accept=".json,.html,.htm"
              style={{ display: 'none' }}
              onChange={handleImportBundle}
            />
            <button
              onClick={() => libImportFileRef.current?.click()}
              style={{ background: '#1e1b4b', color: '#818cf8', border: '1px solid #4338ca', padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              📥 Importa Modello / Bundle
            </button>
            <button
              onClick={handleExportBundle}
              style={{ background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              📤 Esporta (.json)
            </button>
            <button
              onClick={() => navigate('/documents')}
              style={{ background: '#312e81', color: '#c7d2fe', border: '1px solid #4f46e5', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              📝 Apri Document Studio
            </button>
            <button
              onClick={() => setNewDocOpen(true)}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              + Nuovo Modello Master
            </button>
          </div>
        </div>

        {/* 🛡️ Banner Immutabilità Documenti Progetto */}
        <div style={{ background: '#0d221c', border: '1px solid #059669', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: '#34d399' }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <div>
            <strong>Garanzia di Immutabilità Fascicoli & Progetti:</strong> L'archiviazione o l'eliminazione dei modelli master riguarda esclusivamente i nuovi utilizzi. I documenti già generati, firmati con firma elettronica semplice (OTP verificata) e archiviati all'interno dei singoli Progetti del Cliente <strong>rimangono conservati e congelati alla data di firma</strong>.
          </div>
        </div>

        {/* Barra Filtri di Ricerca & Stato */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card2)', padding: 10, borderRadius: 12, border: '1px solid var(--border)' }}>
          {/* Categorie */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['TUTTI', 'Contratti', 'Societario', 'Trust', 'Compliance'].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCatFilter(cat)}
                style={{
                  background: selectedCatFilter === cat ? 'var(--indigo)' : 'var(--card)',
                  color: selectedCatFilter === cat ? '#fff' : 'var(--muted)',
                  border: `1px solid ${selectedCatFilter === cat ? 'var(--indigo-l)' : 'var(--border)'}`,
                  padding: '4px 10px',
                  borderRadius: 16,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Stato Toggle & Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setStatusFilter('attivi')}
                style={{
                  background: statusFilter === 'attivi' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'attivi' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🟢 Attivi ({countAttivi})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('archiviati')}
                style={{
                  background: statusFilter === 'archiviati' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'archiviati' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                📦 Archiviati ({countArchiviati})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('tutti')}
                style={{
                  background: statusFilter === 'tutti' ? '#1e1b4b' : 'transparent',
                  color: statusFilter === 'tutti' ? '#818cf8' : 'var(--muted)',
                  border: 'none',
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Tutti ({docModels.length})
              </button>
            </div>

            <input
              type="text"
              placeholder="🔍 Cerca modello..."
              value={searchDocQuery}
              onChange={e => setSearchDocQuery(e.target.value)}
              style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 8, width: 180 }}
            />
          </div>
        </div>

        {/* Griglia Modelli */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
          {filteredDocModels.map(m => (
            <div
              key={m.id}
              style={{
                background: m.archiviato ? 'rgba(30, 27, 75, 0.25)' : 'var(--card2)',
                border: `1px solid ${m.archiviato ? '#4338ca' : 'var(--border)'}`,
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 10,
                opacity: m.archiviato ? 0.8 : 1,
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{m.nome}</span>
                    {m.archiviato && (
                      <span style={{ fontSize: 9, background: '#312e81', color: '#c7d2fe', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                        📦 Archiviato
                      </span>
                    )}
                  </div>
                  <CatBadge cat={m.cat as any} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{m.desc}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 10, color: m.firma ? '#a78bfa' : 'var(--muted)', fontWeight: 600 }}>
                  {m.firma ? '✍️ Firma semplice (OTP)' : 'ℹ️ Informativo'}
                </span>
                
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Pulsanti Archiviazione & Ripristino */}
                  {m.archiviato ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreDoc(m.id, m.nome)}
                      style={{ background: '#064e3b', border: '1px solid #059669', color: '#34d399', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Ripristina modello tra quelli attivi"
                    >
                      <span>♻️</span>
                      <span>Ripristina</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleArchiveDoc(m.id, m.nome)}
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Archivia modello master"
                    >
                      <span>📦</span>
                      <span>Archivia</span>
                    </button>
                  )}

                  {/* Pulsante Eliminazione Ben Visibile */}
                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(m.id, m.nome)}
                    style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Elimina definitivamente modello master dalla libreria"
                  >
                    <span>🗑️</span>
                    <span>Elimina</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/documents?tmplId=${m.templateId || m.id}`)}
                    style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✏️ Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplatePdf(m)}
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600 }}
                  >
                    📥 PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkingDocModel(m);
                      setClientModalSearch('');
                    }}
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 600 }}
                  >
                    🔗 Collega
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sezione 2: Form Master Dinamici */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>📋 Form Master Dinamici ({formMasters.length})</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Definisci la struttura dei moduli di raccolta dati da guidare al cliente nel suo portale</div>
          </div>
          <button
            onClick={() => setNewFormOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            + Crea Nuovo Form Master
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {formMasters.map(f => (
            <div key={f.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>📋 {f.nome}</div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Eliminare il Form Master "${f.nome}"?`)) {
                        setFormMasters(formMasters.filter(x => x.id !== f.id));
                      }
                    }}
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#f87171', padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Elimina Form Master"
                  >
                    <span>🗑️</span>
                    <span>Elimina</span>
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Campi di raccolta dati incorporati ({f.campi.length}):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {f.campi.map((c, i) => (
                    <span key={i} style={{ background: '#200f40', color: '#a78bfa', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Nuovo Modello Documento */}
      {newDocOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddDoc} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Carica Nuovo Modello Documento in Bianco</div>
            
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona File Documento (PDF/Word) *</label>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setFileToUpload(e.target.files[0]);
                    if (!docName) setDocName(e.target.files[0].name);
                  }
                }}
                style={{ background: 'var(--card2)', padding: 8, borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome File Modello *</label>
              <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="es. Procura_Legale_MFSA_In_Bianco.pdf" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
              <select value={docCat} onChange={e => setDocCat(e.target.value)}>
                <option value="Societario">Societario</option>
                <option value="Compliance">Compliance</option>
                <option value="Banking">Banking</option>
                <option value="Analisi">Analisi</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione / Scopo *</label>
              <input value={docDesc} onChange={e => setDocDesc(e.target.value)} placeholder="es. Procura per deposito atti societari presso MFSA" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="chkSignDoc" checked={docSign} onChange={e => setDocSign(e.target.checked)} />
              <label htmlFor="chkSignDoc" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>Richiede Firma del Cliente con OTP (§22)</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setNewDocOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={uploading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{uploading ? 'Caricamento file...' : '+ Upload & Carica in Libreria'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Nuovo Form Master */}
      {newFormOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddForm} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Crea Nuovo Form Master Dinamico</div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Form Master *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="es. Form Adeguata Verifica & Profilo KYC" required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Campi del Form (separati da virgola) *</label>
              <textarea
                value={formFieldsText}
                onChange={e => setFormFieldsText(e.target.value)}
                placeholder="es. Nome Completo, Codice Fiscale, Indirizzo Residenza, Origine Patrimoniale, IBAN"
                rows={4}
                required
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setNewFormOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Crea Form Master</button>
            </div>
          </form>
        </div>
      )}
      {/* Modal Collega Modello Documento a Cliente */}
      {linkingDocModel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <form onSubmit={handleConfirmLinkToClient} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔗 Collega Modello Documento a Cliente</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Associa il modello <strong>"{linkingDocModel.nome}"</strong> all'anagrafica ed al portale cliente
            </div>

            {linkingSuccessMsg ? (
              <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: 14, borderRadius: 10, fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
                {linkingSuccessMsg}
              </div>
            ) : (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona Cliente ERP Target *</label>
                    <input
                      type="text"
                      placeholder="🔍 Filtra cliente..."
                      value={clientModalSearch}
                      onChange={e => setClientModalSearch(e.target.value)}
                      style={{ fontSize: 10.5, padding: '3px 8px', width: 140, borderRadius: 6 }}
                    />
                  </div>
                  <select
                    value={selectedLinkClientId}
                    onChange={e => setSelectedLinkClientId(e.target.value)}
                    style={{ padding: 10, fontSize: 12, width: '100%' }}
                    required
                  >
                    {clientiList
                      .filter(c => !clientModalSearch || c.nome.toLowerCase().includes(clientModalSearch.toLowerCase()) || (c.partitaIva || c.piva || '').toLowerCase().includes(clientModalSearch.toLowerCase()))
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          🏢 {c.nome} ({c.partitaIva || c.piva || c.codiceFiscale || 'P.IVA N/D'})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Incarico / Progetto Destinazione (Opzionale)</label>
                  <select
                    value={selectedLinkProjId}
                    onChange={e => setSelectedLinkProjId(e.target.value)}
                    style={{ padding: 10, fontSize: 12 }}
                  >
                    <option value="">-- Inserisci nel Vault Anagrafica Generale Cliente --</option>
                    {progettiList.filter(p => String(p.clienteId || p.clId) === String(selectedLinkClientId)).map(p => (
                      <option key={p.id} value={p.id}>
                        📁 Progetto #{p.id} — {p.n || p.nome || 'Incarico'}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
                  ℹ️ Una volta collegato, il cliente visualizzerà il modello nel proprio <strong>Portale Riservato Cliente</strong> e potrà procedere con la compilazione e firma elettronica semplice (OTP verificata) o re-upload del PDF.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => setLinkingDocModel(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
                  <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Conferma & Collega Documento</button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
