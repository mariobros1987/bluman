import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../../utils';
import { downloadRealPdf, downloadRealWordDoc } from '../../utils/pdfGenerator';
import { SimpleZipBuilder } from '../../utils/zipBuilder';
import { PREBUILT_TEMPLATES, resolveDocumentTemplateHtml } from '../../utils/documentTemplates';
// `scaricaDocumentoClient`/`scaricaDocumentoWordClient` erano usate in
// handleDownloadDocumentPdf/Word senza essere importate: sul ramo `doc.dbDoc` — cioè
// proprio i documenti archiviati a database — il click lanciava ReferenceError. Il
// typecheck del frontend non lo vedeva perché girava su zero file (vedi tsconfig.json).
import { listaDocumentiProgetto, salvaDocumentoApi, eliminaDocumentoApi, archiviaDocumentoApi, scaricaDocumentoClient, scaricaDocumentoWordClient } from '../../api/client';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID, isAdminStudio } from '../../utils/tenant';
import { FoglioA4 } from '../documenti/FoglioA4';
import { scomponiDocumento } from '../../../../src/util/intestazionePiede';
import type { Progetto } from '../../types';
import { documentoApiAVista, documentiRimossi, ricordaDocumentoRimosso } from './documentiUtils';

// ─── Componente Documenti & Vault Legale Progetto ──────────────────
// ─── Componente Documenti & Vault Legale Progetto (Google Drive / Cloud Vault) ───
export function DocumentiTab({ project }: { project: Progetto }) {
  const navigate = useNavigate();
  const [docCategory, setDocCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<any | null>(null);

  // §39 — l'HTML archiviato può portare intestazione e piede propri, marcati dentro il documento
  // al salvataggio: qui si separano per rimetterli al loro posto sul foglio A4 dell'anteprima.
  // Un documento salvato prima di §39 non li ha: torna tutto come corpo, come si vedeva prima.
  const partiAnteprima = selectedPreviewDoc?.contenutoHtml
    ? scomponiDocumento(selectedPreviewDoc.contenutoHtml)
    : null;

  // Caricamento Documenti dal Vault Locale e Cloud (Sincronizzati 1-a-1 con i Modelli Word Studio)
  const [docList, setDocList] = useState<any[]>(() => {
    const isBluecode = getCurrentTenantId() === BLUECODE_TENANT_ID;
    const isDemoProj = String(project.id) === 'proj-001' || String(project.id) === 'proj-002' || String(project.id) === '1' || String(project.id) === '2';
    const studio = getStudioInfoForTenant();
    
    const defaultDocs = (isBluecode && isDemoProj) ? PREBUILT_TEMPLATES.map(t => {
      const isSigned = t.id === 'tmpl-engagement' || t.id === 'tmpl-nda';
      const catLabel = t.categoria === 'engagement' ? 'Contratti' :
                       t.categoria === 'nda' ? 'Contratti' :
                       t.categoria === 'societario' ? 'Societario' :
                       t.categoria === 'trust' ? 'Trust' :
                       t.categoria === 'compliance' ? 'Compliance' :
                       t.categoria === 'delega' ? 'Societario' : 'Contratti';
      return {
        id: `doc-${t.id}`,
        templateId: t.id,
        nome: `${t.titolo} — ${project.cl}.pdf`,
        titolo: t.titolo,
        cat: catLabel,
        dimensione: '54 KB',
        data: '15/08/2026',
        dataCaricamento: '15/08/2026',
        firmato: isSigned,
        formato: 'pdf',
        contenutoHtml: resolveDocumentTemplateHtml(t.contenutoHtml, {
          cliente: { nome: project.cl, ragione_sociale: project.cl },
          progetto: { titolo: project.n, importo_totale: fmt(project.val) },
          studio: { ragioneSociale: studio.ragioneSociale, sedeLegale: studio.sedeLegale, piva: studio.piva },
          isForPrintOrExport: false,
          tagMode: 'plain',
        }),
      };
    }) : [];

    try {
      const storageKey = getTenantStorageKey(`bluman_project_documents_${project.id}`);
      const savedProjDocsStr = localStorage.getItem(storageKey);
      const savedProjDocs: any[] = savedProjDocsStr ? JSON.parse(savedProjDocsStr) : [];

      const allVaultStr = localStorage.getItem(getTenantStorageKey('bluman_all_vault_documents'));
      const allVault: any[] = allVaultStr ? JSON.parse(allVaultStr) : [];
      const matchingGlobalDocs = allVault.filter((d: any) => String(d.progettoId) === String(project.id));

      const mergedMap = new Map<string, any>();
      [...defaultDocs, ...savedProjDocs, ...matchingGlobalDocs].forEach(d => {
        if (d && (d.id || d.nome)) {
          mergedMap.set(d.id || d.nome, d);
        }
      });
      // I documenti già rimossi non tornano: `defaultDocs` e il registro globale li
      // riproporrebbero comunque, ed è questo che rendeva la cancellazione solo apparente.
      const rimossi = documentiRimossi(project.id);
      return Array.from(mergedMap.values()).filter(d => !rimossi.has(d.id));
    } catch {
      const rimossi = documentiRimossi(project.id);
      return defaultDocs.filter(d => !rimossi.has(d.id));
    }
  });

  // §2.9 — i file caricati dallo studio vivono nella tabella `documento`, agganciati al
  // progetto: qui li leggiamo dal database e li aggiungiamo alla lista (i template Word
  // generati in locale restano, i doppioni eventualmente già presenti vengono vinti dal DB).
  useEffect(() => {
    let attivo = true;
    listaDocumentiProgetto(String(project.id))
      .then((dbDocs) => {
        if (!attivo) return;
        const vista = dbDocs.map((d) => documentoApiAVista(d, String(project.id)));
        setDocList((prev) => {
          const idsDb = new Set(vista.map((d) => d.id));
          return [...vista, ...prev.filter((d) => !idsDb.has(d.id))];
        });
      })
      .catch((err) => console.warn('Lettura documenti progetto non riuscita', err));
    return () => { attivo = false; };
  }, [project.id]);

  // Helper per costruire il layout HTML A4 formattato con Header/Footer Studio
  const buildDocumentHtml = (doc: any) => {
    const studio = getStudioInfoForTenant();
    const rawContent = doc.contenutoHtml || `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt; padding: 10px;">
        <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
          ${doc.titolo || doc.nome}
        </h1>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
          <strong>Studio Professionale:</strong> ${studio.ragioneSociale}<br/>
          <strong>Cliente Committente:</strong> ${project.cl} (${project.n})<br/>
          <strong>Categoria Vault:</strong> ${doc.cat || doc.categoria || 'Generale'}<br/>
          <strong>Stato Firma:</strong> ${doc.firmato ? '🔒 Sottoscritto con Firma Elettronica Semplice (OTP verificata · art. 20 CAD)' : 'Bozza Documentale Studio'}
        </div>
      </div>
    `;

    return `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
          <div>
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">${studio.sedeLegale} · P.IVA ${studio.piva}</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Rif. Incarico: #${project.id}<br/>Data: ${doc.data || doc.dataCaricamento || '2026'}
          </div>
        </div>
        <div>${rawContent}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>${studio.ragioneSociale} • Pratica: ${project.n}</span>
          <span>Firma Elettronica Semplice • art. 20 CAD</span>
        </div>
      </div>
    `;
  };

  // Scarica Copia VERA in PDF A4
  const handleDownloadDocumentPdf = async (doc: any) => {
    if (doc.dbDoc && doc.url && doc.url !== '#') {
      await scaricaDocumentoClient(doc.url, doc.nome || doc.titolo);
      return;
    }
    const fullPrintHtml = buildDocumentHtml(doc);
    const safePdfName = `${(doc.titolo || doc.nome || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    await downloadRealPdf(safePdfName, fullPrintHtml);
  };

  // Scarica Copia VERA in Word (.doc) Microsoft Office compatibile al 100%
  const handleDownloadDocumentWord = async (doc: any) => {
    // Punto 1 — se il documento è stato generato lato server ha un .docx reale: scarica
    // quello invece di fabbricare uno stub .doc dal contenuto ricostruito in locale.
    if (doc.dbDoc && doc.fileDocxUrl) {
      const wordName = `${(doc.titolo || doc.nome || 'Documento').replace(/\.(pdf|docx?)$/i, '')}.docx`;
      await scaricaDocumentoClient(doc.fileDocxUrl, wordName);
      return;
    }
    const fullPrintHtml = buildDocumentHtml(doc);
    const safeWordName = `${(doc.titolo || doc.nome || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_')}.doc`;
    if (doc.dbDoc && doc.url && doc.url !== '#') {
      await scaricaDocumentoWordClient(doc.url, doc.nome || doc.titolo, fullPrintHtml);
      return;
    }
    downloadRealWordDoc(safeWordName, fullPrintHtml);
  };

  // Caricamento File da Disco nel Vault Progetto
  // §2.9 — il file va nel fascicolo del progetto a database (tabella `documento`): prima
  // la scansione lato server (§28), poi la riga visibile al portale cliente e agli altri
  // operatori. Niente più localStorage, che era invisibile a chiunque altro.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Lettura del file non riuscita'));
        reader.readAsDataURL(file);
      });

      const salvato = await salvaDocumentoApi({
        progettoId: String(project.id),
        filename: file.name,
        contentBase64: base64,
        categoriaDoc: 'Allegati Progetto',
      });

      setDocList((prev) => [documentoApiAVista(salvato, String(project.id)), ...prev]);
      alert(`✓ File "${file.name}" archiviato nel fascicolo del progetto con successo!`);
    } catch (err) {
      console.error(err);
      const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
      alert(`Caricamento non riuscito${motivo}`);
    } finally {
      setUploading(false);
      e.target.value = ''; // permette di ricaricare lo stesso file
    }
  };

  // Eliminazione Documento dal Vault — Punto 3 piano gap: un documento firmato dal cliente
  // non si cancella MAI (il server rifiuta la DELETE con 409). Lo anticipiamo qui: chi gestisce
  // lo studio può archiviarlo (sparisce dalle liste operative, file e firma restano nello
  // storico); per tutti gli altri il documento è intoccabile.
  const handleDeleteDoc = async (docId: string) => {
    const doc = docList.find(d => d.id === docId);
    const firmato = Boolean(doc?.firmato);

    if (firmato) {
      if (!isAdminStudio()) {
        alert('Questo documento è firmato dal cliente: non può essere eliminato.\nSolo l\'amministratore dello studio può archiviarlo.');
        return;
      }
      if (!confirm(
        'Questo documento è firmato dal cliente e non può essere eliminato.\n' +
        'Vuoi archiviarlo? Scomparirà dalle liste operative ma il file e la firma restano conservati nello storico.'
      )) return;
      try {
        await archiviaDocumentoApi(docId);
      } catch (err) {
        console.error(err);
        const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
        alert(`Archiviazione non riuscita${motivo}`);
        return;
      }
    } else {
      if (!confirm('Vuoi rimuovere questo documento dal Vault del progetto?')) return;
      try {
        const isLocalTemp = docId.startsWith('doc-tmpl-') || docId.startsWith('d-') || docId.startsWith('local-');
        if (!isLocalTemp || doc?.dbDoc) {
          await eliminaDocumentoApi(docId);
        }
      } catch (err) {
        console.error(err);
        const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
        alert(`Eliminazione non riuscita${motivo}`);
        return;
      }
    }

    const updated = docList.filter(d => d.id !== docId);
    setDocList(updated);

    // La riga va togliata da TUTTE le sorgenti da cui la lista si ricostruisce al mount, non
    // solo dalla chiave di progetto: prima il registro globale del Vault (scritto da
    // DocumentEditorPage) e i modelli generati dal codice la riproponevano, quindi il
    // documento riappariva e la conferma qui sotto era falsa.
    const storageKey = getTenantStorageKey(`bluman_project_documents_${project.id}`);
    localStorage.setItem(storageKey, JSON.stringify(updated.filter(d => !d.dbDoc)));

    const allVaultKey = getTenantStorageKey('bluman_all_vault_documents');
    try {
      const allVault: unknown = JSON.parse(localStorage.getItem(allVaultKey) || '[]');
      if (Array.isArray(allVault)) {
        localStorage.setItem(allVaultKey, JSON.stringify(allVault.filter((d: any) => d?.id !== docId)));
      }
    } catch {
      // Registro globale illeggibile: la chiave di progetto è già stata riscritta e il
      // documento resta comunque escluso dall'elenco delle rimozioni.
    }

    if (!doc?.dbDoc) ricordaDocumentoRimosso(project.id, docId);

    if (selectedPreviewDoc?.id === docId) setSelectedPreviewDoc(null);
    alert(firmato
      ? '✓ Documento archiviato: resta nello storico con la sua firma.'
      : '✓ Documento rimosso con successo dal Vault.');
  };

  // Filtraggio dinamico
  const filteredDocs = docList.filter(d => {
    const matchCat = docCategory === 'ALL' || d.cat === docCategory || (docCategory === 'Contratti' && d.formato === 'word');
    const matchSearch = !searchQuery || (d.nome || d.titolo || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header Document Vault Google Drive Style */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📁 Google Drive & Cloud Vault Documenti</span>
            <span style={{ fontSize: 10, background: '#1e1b4b', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase' }}>
              Word Studio + PDF Vault
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Fascicolo digitale per <strong>{project.cl}</strong> · <strong>{project.n}</strong> ({docList.length} file archiviati)
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              const zip = new SimpleZipBuilder();
              const safeProjName = (project.n || 'Pratica').replace(/[^a-zA-Z0-9_-]/g, '_');
              const safeClientName = (project.cl || 'Cliente').replace(/[^a-zA-Z0-9_-]/g, '_');

              // Indice del fascicolo
              const studio = getStudioInfoForTenant();
              const indiceText = `================================================================================
${studio.ragioneSociale.toUpperCase()} — ADVISORY PLATFORM
FASCICOLO COMMESSA: ${project.n}
COMMITTENTE: ${project.cl}
DATA EXPORT: ${new Date().toLocaleString('it-IT')}
VALORE COMMESSA: € ${project.val || 0}
STATO PRATICA: ${project.st}
================================================================================

ELENCO DEI DOCUMENTI PRESENTI NEL FASCICOLO DIGITALE:

${docList.map((d, i) => `${i + 1}. [${d.cat || 'Documento'}] ${d.nome || d.titolo} (${d.firmato ? 'Firma OTP verificata · art. 20 CAD' : 'Bozza Documentale Studio'})`).join('\n')}

================================================================================
Note di Conformita:
I documenti contrattuali sono sottoscritti con Firma Elettronica Semplice
mediante codice OTP verificato, ai sensi dell'art. 20 del CAD. Il sigillo
di firma registra data e ora di sottoscrizione e impronta crittografica
SHA-256 del documento.
================================================================================
`;

              zip.addTextFile('INDICE_FASCICOLO.txt', indiceText);

              // Inserisci i documenti nelle cartelle ordinate
              docList.forEach(d => {
                let folder = '01_Contratti_e_Incarico';
                const catLower = (d.cat || '').toLowerCase();
                if (catLower.includes('societario') || catLower.includes('mfsa') || catLower.includes('statuto')) {
                  folder = '02_Societario_e_Delibere';
                } else if (catLower.includes('compliance') || catLower.includes('kyc') || catLower.includes('aml') || catLower.includes('allegati')) {
                  folder = '03_KYC_Compliance_e_Visure';
                } else if (catLower.includes('fattur') || catLower.includes('ricevut')) {
                  folder = '04_Fatture_e_Ricevute';
                }

                const fileName = (d.nome || `${d.titolo}.html`).replace(/[^a-zA-Z0-9._-]/g, '_');
                const docHtmlContent = d.contenutoHtml || `<h1>${d.titolo || d.nome}</h1><p>Documento del fascicolo ${project.n} - ${project.cl}</p>`;
                zip.addTextFile(`${folder}/${fileName.replace(/\.docx?$/, '.html')}`, docHtmlContent);
              });

              zip.download(`Fascicolo_Completo_${safeProjName}_${safeClientName}.zip`);
            }}
            style={{
              background: '#059669',
              color: '#fff',
              border: '1px solid #10b981',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(5,150,105,.3)',
            }}
            title="Scarica tutti i contratti, atti, documenti KYC e ricevute della pratica in un unico archivio ZIP ordinato"
          >
            <span>📦 Esporta Fascicolo ZIP Completo</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/documents?projId=${project.id}`)}
            style={{
              background: 'linear-gradient(135deg, #4338ca 0%, #312e81 100%)',
              color: '#fff',
              border: '1px solid #6366f1',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(99,102,241,.3)',
            }}
          >
            <span>📝 Nuovo con Word Studio</span>
          </button>

          <label style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
            <span>{uploading ? 'Caricamento in corso...' : '📤 Carica File da Disco'}</span>
            <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* Toolbar: Ricerca, Filtri e Switch Visualizzazione (Grid / Table) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--card2)', padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border)' }}>
        {/* Filtri Categoria */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: `🌐 Tutti (${docList.length})` },
            { id: 'Contratti', label: '📄 Contratti & Word' },
            { id: 'Societario', label: '🏢 Societario & MFSA' },
            { id: 'Compliance', label: '🛡 Compliance & KYC' },
            { id: 'Trust', label: '🏛 Trust & Fiscale' },
            { id: 'Allegati Progetto', label: '📎 Allegati' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setDocCategory(cat.id)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: docCategory === cat.id ? '#1e1b4b' : 'var(--card)',
                color: docCategory === cat.id ? '#818cf8' : 'var(--muted)',
                border: `1px solid ${docCategory === cat.id ? '#4338ca' : 'var(--border)'}`,
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search & Mode Switch */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Cerca file nel Vault..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', width: 190 }}
          />

          <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{ padding: '6px 10px', background: viewMode === 'grid' ? '#1e1b4b' : 'transparent', color: viewMode === 'grid' ? '#818cf8' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              title="Vista Griglia Schede"
            >
              ⊞ Griglia
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{ padding: '6px 10px', background: viewMode === 'list' ? '#1e1b4b' : 'transparent', color: viewMode === 'list' ? '#818cf8' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              title="Vista Elenco Tabellare"
            >
              ☰ Elenco
            </button>
          </div>
        </div>
      </div>

      {/* Grid View Google Drive Style */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
          {filteredDocs.map(doc => {
            const isWord = doc.formato === 'word' || (doc.nome && (doc.nome.endsWith('.docx') || doc.nome.endsWith('.doc')));
            return (
              <div
                key={doc.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                  transition: 'transform .15s, border-color .15s',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontSize: 28 }}>
                      {isWord ? '📝' : '📄'}
                    </div>
                    <span style={{ fontSize: 9.5, background: doc.firmato ? '#0d2d22' : '#1e1b4b', color: doc.firmato ? '#34d399' : '#818cf8', border: `1px solid ${doc.firmato ? '#059669' : '#4338ca'}`, padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>
                      {doc.firmato ? '🔒 Firmato (OTP)' : (isWord ? 'DOCX Word' : 'PDF')}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {doc.titolo || doc.nome}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>📁 {doc.cat || doc.categoria || 'Vault'}</span>
                    <span>·</span>
                    <span>💾 {doc.dimensione || '24 KB'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                    📅 {doc.data || doc.dataCaricamento || '15/08/2026'}
                  </div>
                </div>

                {/* Actions per Card */}
                <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedPreviewDoc(doc)}
                    style={{ flex: 1, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  >
                    👁 Anteprima
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                    style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    title="Apri e Modifica con Word Studio"
                  >
                    ✏️ Studio
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadDocumentPdf(doc)}
                    style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '5px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Scarica in formato PDF A4"
                  >
                    📥 PDF
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadDocumentWord(doc)}
                    style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '5px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Scarica in formato Microsoft Word (.doc)"
                  >
                    📝 Word
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(doc.id)}
                    style={{ background: '#2d1515', border: '1px solid #7f1d1d', color: '#f87171', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    title="Elimina Documento dal Drive"
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View Table */}
      {viewMode === 'list' && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Nome File / Documento</th>
                  <th style={{ padding: '10px 12px' }}>Categoria</th>
                  <th style={{ padding: '10px 12px' }}>Dimensione</th>
                  <th style={{ padding: '10px 12px' }}>Data</th>
                  <th style={{ padding: '10px 12px' }}>Firma (OTP)</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Azioni Cloud Vault</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map(doc => {
                  const isWord = doc.formato === 'word' || (doc.nome && (doc.nome.endsWith('.docx') || doc.nome.endsWith('.doc')));
                  return (
                    <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{isWord ? '📝' : '📄'}</span>
                        <span>{doc.titolo || doc.nome}</span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontSize: 10, background: '#1a1f3d', color: '#818cf8', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                          {doc.cat || doc.categoria || 'Generale'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.dimensione || '24 KB'}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.data || doc.dataCaricamento || '15/08/2026'}</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontSize: 9.5, background: doc.firmato ? '#0d2d22' : '#2d1a05', color: doc.firmato ? '#34d399' : '#f59e0b', border: `1px solid ${doc.firmato ? '#059669' : '#d97706'}`, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                          {doc.firmato ? '🔒 OTP verificata' : '⏳ In attesa di firma'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedPreviewDoc(doc)}
                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--indigo-l)', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            👁 Anteprima
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                            style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✏️ Word Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDocumentPdf(doc)}
                            style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                            title="Scarica in formato PDF A4"
                          >
                            📥 PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDocumentWord(doc)}
                            style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '4px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', fontWeight: 700 }}
                            title="Scarica in formato Microsoft Word (.doc)"
                          >
                            📝 Word
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc.id)}
                            style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#f87171', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Visualizzatore Anteprima Documento Vault */}
      {selectedPreviewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,.7)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📄 {selectedPreviewDoc.titolo || selectedPreviewDoc.nome}</span>
                  <span style={{ fontSize: 10, background: selectedPreviewDoc.firmato ? '#0d2d22' : '#200f40', color: selectedPreviewDoc.firmato ? '#34d399' : '#a78bfa', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                    {selectedPreviewDoc.firmato ? '🔒 Firmato (OTP verificata)' : 'Bozza Legale Studio'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                  Pratica: <strong>{project.n}</strong> · Cliente: <strong>{project.cl}</strong>
                  {/* La dimensione si scrive solo se l'archivio la conosce: «32 KB» era un numero
                      di comodo, e un peso inventato è un dato inventato (regola 7). */}
                  {selectedPreviewDoc.dimensione ? <> · Dimensione: {selectedPreviewDoc.dimensione}</> : null}
                </div>
              </div>
              <button
                onClick={() => setSelectedPreviewDoc(null)}
                style={{ background: 'var(--card2)', border: 'none', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}
              >
                ✕
              </button>
            </div>

            {/*
              §39 — L'anteprima mostra il foglio A4 con i margini di stampa, e mostra il documento.
              Prima disegnava attorno al contenuto un'intestazione cablata («BLUMAN ADVISORY
              SERVICES») e un blocco firme con il nome di una persona: in un'applicazione
              multi-tenant era l'identità di un altro studio stampata sopra l'atto di chiunque, e
              una firma che nessuno aveva apposto (regola 7). Ora si vede l'intestazione che il
              documento porta con sé — quella che l'operatore ha bloccato o modificato in Document
              Studio — e se non ne porta nessuna non se ne inventa una.
            */}
            <div style={{ flex: 1, padding: 18, overflowY: 'auto', background: '#0a0d14' }}>
              {partiAnteprima ? (
                <FoglioA4
                  sfondo="#0a0d14"
                  intestazione={partiAnteprima.intestazione ? { html: partiAnteprima.intestazione, etichetta: 'Intestazione' } : undefined}
                  piede={partiAnteprima.piede ? { html: partiAnteprima.piede, etichetta: 'Piè di pagina' } : undefined}
                >
                  <div style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: partiAnteprima.corpo }} />
                </FoglioA4>
              ) : selectedPreviewDoc.dbDoc && selectedPreviewDoc.url && selectedPreviewDoc.url !== '#' ? (
                // §2.9 — file reale archiviato nel fascicolo: anteprima del PDF/immagine caricato.
                // Qui i margini sono quelli del file, non li decide questa pagina.
                <div style={{ fontFamily: 'sans-serif', background: '#fff', borderRadius: 8, padding: 16 }}>
                  {/\.(png|jpe?g)$/i.test(selectedPreviewDoc.nome || '') ? (
                    <img src={selectedPreviewDoc.url} alt={selectedPreviewDoc.nome} style={{ maxWidth: '100%', borderRadius: 6 }} />
                  ) : (
                    <iframe src={selectedPreviewDoc.url} title={selectedPreviewDoc.nome || 'Documento'} style={{ width: '100%', height: 520, border: '1px solid #cbd5e1', borderRadius: 6, background: '#f1f5f9' }} />
                  )}
                  <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>
                    <a href={selectedPreviewDoc.url} target="_blank" rel="noreferrer" style={{ color: '#0284c7', fontWeight: 700 }}>↗ Apri il file originale</a>
                  </div>
                </div>
              ) : (
                // Niente HTML e niente file: si dice, invece di riempire il foglio con un testo
                // di circostanza che sembrava il contenuto del documento.
                <div style={{ background: '#fff', color: '#334155', borderRadius: 8, padding: 28, fontSize: 12.5, lineHeight: 1.6, fontFamily: 'sans-serif' }}>
                  <strong>Nessun contenuto da mostrare.</strong> Di questo documento l'archivio non conserva né il testo
                  né il file: c'è solo la scheda. Aprilo in Document Studio per comporne il testo, oppure ricarica il
                  file originale dalla scheda del passaggio.
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleDownloadDocumentPdf(selectedPreviewDoc)}
                  style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '8px 14px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📥 Scarica PDF A4
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadDocumentWord(selectedPreviewDoc)}
                  style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '8px 14px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📝 Scarica Word (.doc)
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/documents?projId=${project.id}&docId=${selectedPreviewDoc.id}`);
                  }}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  📝 Modifica in Document Studio
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewDoc(null)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
