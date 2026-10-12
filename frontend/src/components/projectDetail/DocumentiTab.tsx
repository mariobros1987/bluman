import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadRealPdf, downloadRealWordDoc } from '../../utils/pdfGenerator';
import { SimpleZipBuilder } from '../../utils/zipBuilder';
// `scaricaDocumentoClient`/`scaricaDocumentoWordClient` erano usate in
// handleDownloadDocumentPdf/Word senza essere importate: sul ramo `doc.dbDoc` — cioè
// proprio i documenti archiviati a database — il click lanciava ReferenceError. Il
// typecheck del frontend non lo vedeva perché girava su zero file (vedi tsconfig.json).
import { listaDocumentiProgetto, salvaDocumentoApi, eliminaDocumentoApi, archiviaDocumentoApi, scaricaDocumentoClient, scaricaDocumentoWordClient } from '../../api/client';
import { getTenantStorageKey, getStudioInfoForTenant, isAdminStudio } from '../../utils/tenant';
import { FoglioA4 } from '../documenti/FoglioA4';
import { scomponiDocumento } from '../../../../src/util/intestazionePiede';
import { escapeHtmlTesto, sanitizzaHtmlDocumento } from '../../../../src/util/htmlSanitizer';
import type { Progetto } from '../../types';
import { documentoApiAVista, documentiRimossi, ricordaDocumentoRimosso } from './documentiUtils';
import { FirmaStudioModal } from '../documenti/FirmaStudioModal';
import { useToast } from '../ui/ToastProvider';
import { confirm } from '../ui/ConfirmProvider';

// ─── Componente Documenti & Vault Legale Progetto ──────────────────
// ─── Componente Documenti & Vault Legale Progetto (Google Drive / Cloud Vault) ───
export function DocumentiTab({ project }: { project: Progetto }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [docCategory, setDocCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<any | null>(null);
  const [docPerFirmaStudio, setDocPerFirmaStudio] = useState<any | null>(null);

  // §39 — l'HTML archiviato può portare intestazione e piede propri, marcati dentro il documento
  // al salvataggio: qui si separano per rimetterli al loro posto sul foglio A4 dell'anteprima.
  // Un documento salvato prima di §39 non li ha: torna tutto come corpo, come si vedeva prima.
  const partiAnteprima = selectedPreviewDoc?.contenutoHtml
    ? scomponiDocumento(sanitizzaHtmlDocumento(selectedPreviewDoc.contenutoHtml))
    : null;

  // Caricamento Documenti dal Vault Locale e Cloud (Sincronizzati 1-a-1 con i Modelli Word Studio)
  const [docList, setDocList] = useState<any[]>(() => {
    // §7 — qui il vault **fabbricava** i documenti. Per il tenant Bluecode, e per i progetti il cui
    // id fosse `1`, `2`, `proj-001` o `proj-002`, costruiva a runtime tutti i modelli dello studio
    // con data 15/08/2026, e due di essi — contratto di incarico e NDA — li marcava
    // `firmato: true`, cioè «sottoscritti con Firma Elettronica Semplice (OTP verificata)»: due
    // documenti firmati che nessuno aveva firmato. La condizione passava da `String(project.id)`,
    // quindi non serviva nemmeno il tenant demo: bastava un id numerico. Ora il vault contiene solo
    // quello che esiste — le righe del database (lette qui sotto) e i documenti salvati in locale.
    try {
      const storageKey = getTenantStorageKey(`bluman_project_documents_${project.id}`);
      const savedProjDocsStr = localStorage.getItem(storageKey);
      const savedProjDocs: any[] = savedProjDocsStr ? JSON.parse(savedProjDocsStr) : [];

      const allVaultStr = localStorage.getItem(getTenantStorageKey('bluman_all_vault_documents'));
      const allVault: any[] = allVaultStr ? JSON.parse(allVaultStr) : [];
      const matchingGlobalDocs = allVault.filter((d: any) => String(d.progettoId) === String(project.id));

      const mergedMap = new Map<string, any>();
      [...savedProjDocs, ...matchingGlobalDocs].forEach(d => {
        if (d && (d.id || d.nome)) {
          mergedMap.set(d.id || d.nome, d);
        }
      });
      // I documenti già rimossi non tornano: il registro globale li riproporrebbe comunque,
      // ed è questo che rendeva la cancellazione solo apparente.
      const rimossi = documentiRimossi(project.id);
      return Array.from(mergedMap.values()).filter(d => !rimossi.has(d.id));
    } catch {
      return [];
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
    const rawContent = sanitizzaHtmlDocumento(doc.contenutoHtml || `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt; padding: 10px;">
        <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
          ${escapeHtmlTesto(doc.titolo || doc.nome)}
        </h1>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
          <strong>Studio Professionale:</strong> ${escapeHtmlTesto(studio.ragioneSociale)}<br/>
          <strong>Cliente Committente:</strong> ${escapeHtmlTesto(project.cl)} (${escapeHtmlTesto(project.n)})<br/>
          <strong>Categoria Vault:</strong> ${escapeHtmlTesto(doc.cat || doc.categoria || 'Generale')}<br/>
          <strong>Stato Firma:</strong> ${doc.firmato ? 'Sottoscritto con Firma Elettronica Semplice (OTP verificata · art. 20 CAD)' : 'Bozza Documentale Studio'}
        </div>
      </div>
    `);

    return sanitizzaHtmlDocumento(`
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
          <div>
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">${escapeHtmlTesto(studio.ragioneSociale.toUpperCase())} — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">${escapeHtmlTesto(studio.sedeLegale)} · P.IVA ${escapeHtmlTesto(studio.piva)}</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Rif. Incarico: #${escapeHtmlTesto(project.id)}<br/>Data: ${escapeHtmlTesto(doc.data || doc.dataCaricamento || '2026')}
          </div>
        </div>
        <div>${rawContent}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>${escapeHtmlTesto(studio.ragioneSociale)} • Pratica: ${escapeHtmlTesto(project.n)}</span>
          <span>Firma Elettronica Semplice • art. 20 CAD</span>
        </div>
      </div>
    `);
  };

  // Scarica Copia VERA in PDF A4
  const handleDownloadDocumentPdf = async (doc: any) => {
    const urlDaScaricare = doc.fileFirmatoUrl || doc.filePdfUrl || doc.url;
    if (doc.dbDoc && urlDaScaricare && urlDaScaricare !== '#') {
      const nomeBase = doc.nome || doc.titolo || 'Documento';
      const safeName = doc.firmato && !nomeBase.toLowerCase().includes('firmato')
        ? `${nomeBase.replace(/\.[^/.]+$/, '')}_firmato.pdf`
        : nomeBase;
      await scaricaDocumentoClient(urlDaScaricare, safeName);
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

  // Fix firma — l'atto come sottoscritto: il file firmato caricato dal cliente (flusso
  // FEQ/SES con file), distinto dal PDF master di `doc.url`. Esiste come file separato
  // solo in quel flusso: le copie §36 (tipo 'firmato') hanno già la firma incastonata
  // nel proprio PDF, e il verbale (tipo 'verbale_firma') attesta, non sottoscrive.
  const mostraAttoFirmato = (doc: any) =>
    Boolean(doc.fileFirmatoUrl) && doc.tipo !== 'verbale_firma' && doc.tipo !== 'firmato';

  const handleDownloadAttoFirmato = async (doc: any) => {
    const urlFirmato = doc.fileFirmatoUrl;
    if (!urlFirmato) return;
    // L'estensione è quella vera del file firmato (.p7m/.docx/…), dedotta dall'URL:
    // non si dà per scontato che sia un PDF.
    const estensione = (urlFirmato.split('?')[0].match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || '';
    const nomeBase = ((doc.titolo || doc.nome || 'Documento').replace(/\.[^/.]+$/, '') || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_');
    await scaricaDocumentoClient(urlFirmato, estensione ? `${nomeBase}_firmato.${estensione}` : `${nomeBase}_firmato`);
  };

  // Caricamento File da Disco nel Vault Progetto
  // §2.9 — il file va nel fascicolo del progetto a database (tabella `documento`): prima
  // la scansione lato server (§28), poi la riga visibile al portale cliente e agli altri
  // operatori. Niente più localStorage, che era invisibile a chiunque altro.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.(?:html?|xhtml|svg|xml|mhtml|js)$/i.test(file.name)) {
      toast.attenzione('Formato non ammesso: HTML, SVG, XML e contenuti web attivi non possono essere archiviati.');
      e.target.value = '';
      return;
    }
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
      toast.successo(`File "${file.name}" archiviato nel fascicolo del progetto con successo!`);
    } catch (err) {
      console.error(err);
      const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
      toast.errore(`Caricamento non riuscito${motivo}`);
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
        toast.attenzione('Questo documento è firmato dal cliente: non può essere eliminato. Solo l\'amministratore dello studio può archiviarlo.');
        return;
      }
      if (!(await confirm({
        titolo: 'Questo documento è firmato dal cliente e non può essere eliminato.',
        messaggio: 'Vuoi archiviarlo? Scomparirà dalle liste operative ma il file e la firma restano conservati nello storico.',
        confermaLabel: 'Archivia',
      }))) return;
      try {
        await archiviaDocumentoApi(docId);
      } catch (err) {
        console.error(err);
        const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
        toast.errore(`Archiviazione non riuscita${motivo}`);
        return;
      }
    } else {
      if (!(await confirm({ messaggio: 'Vuoi rimuovere questo documento dal Vault del progetto?', confermaLabel: 'Rimuovi', pericolo: true }))) return;
      try {
        const isLocalTemp = docId.startsWith('doc-tmpl-') || docId.startsWith('d-') || docId.startsWith('local-');
        if (!isLocalTemp || doc?.dbDoc) {
          await eliminaDocumentoApi(docId);
        }
      } catch (err) {
        console.error(err);
        const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
        toast.errore(`Eliminazione non riuscita${motivo}`);
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
    toast.successo(firmato
      ? 'Documento archiviato: resta nello storico con la sua firma.'
      : 'Documento rimosso con successo dal Vault.');
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
            <span style={{ fontSize: 10, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '3px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase' }}>
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
                const docHtmlContent = sanitizzaHtmlDocumento(d.contenutoHtml || `<h1>${escapeHtmlTesto(d.titolo || d.nome)}</h1><p>Documento del fascicolo ${escapeHtmlTesto(project.n)} - ${escapeHtmlTesto(project.cl)}</p>`);
                zip.addTextFile(`${folder}/${fileName.replace(/\.docx?$/, '.html')}`, docHtmlContent);
              });

              zip.download(`Fascicolo_Completo_${safeProjName}_${safeClientName}.zip`);
            }}
            style={{
              background: 'var(--green)',
              color: 'var(--on-accent)',
              border: '1px solid var(--green)',
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
            className="btn btn-primary"
          >
            <span>📝 Nuovo con Word Studio</span>
          </button>

          <label style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
            <span>{uploading ? 'Caricamento in corso...' : '📤 Carica File da Disco'}</span>
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.zip,.p7m,.eml,.txt,.csv" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
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
                background: docCategory === cat.id ? 'var(--pill-indigo-bg)' : 'var(--card)',
                color: docCategory === cat.id ? 'var(--pill-indigo-fg)' : 'var(--muted)',
                border: `1px solid ${docCategory === cat.id ? 'var(--pill-indigo-bd)' : 'var(--border)'}`,
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
              style={{ padding: '6px 10px', background: viewMode === 'grid' ? 'var(--pill-indigo-bg)' : 'transparent', color: viewMode === 'grid' ? 'var(--pill-indigo-fg)' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              title="Vista Griglia Schede"
            >
              ⊞ Griglia
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{ padding: '6px 10px', background: viewMode === 'list' ? 'var(--pill-indigo-bg)' : 'transparent', color: viewMode === 'list' ? 'var(--pill-indigo-fg)' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
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
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {doc.firmato && (
                        <span style={{ fontSize: 9.5, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', border: '1px solid var(--pill-green-bd)', padding: '2px 6px', borderRadius: 8, fontWeight: 700 }}>
                          🔒 Firmato
                        </span>
                      )}
                      {doc.dbDoc?.firmatoDaStudio && (
                        <span style={{ fontSize: 9.5, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', border: '1px solid var(--pill-indigo-bd)', padding: '2px 6px', borderRadius: 8, fontWeight: 700 }}>
                          🏛️ Studio
                        </span>
                      )}
                      {!doc.firmato && !doc.dbDoc?.firmatoDaStudio && (
                        <span style={{ fontSize: 9.5, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', border: '1px solid var(--pill-indigo-bd)', padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>
                          {isWord ? 'DOCX Word' : 'PDF'}
                        </span>
                      )}
                    </div>
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
                    className="btn btn-secondary btn-sm" style={{ flex: 1 }}
                  >
                    👁 Anteprima
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                    className="btn btn-secondary btn-sm"
                    title="Apri e Modifica con Word Studio"
                  >
                    ✏️ Studio
                  </button>

                  {doc.dbDoc && !doc.dbDoc.firmatoDaStudio && (
                    <button
                      type="button"
                      onClick={() => setDocPerFirmaStudio(doc.dbDoc)}
                      className="btn btn-secondary btn-sm"
                      title="Apponi la firma dello studio / professionista incaricato sul documento"
                    >
                      ✍️ Firma Studio
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDownloadDocumentPdf(doc)}
                    className="btn btn-success btn-sm"
                    title="Scarica in formato PDF A4"
                  >
                    📥 PDF
                  </button>

                  {mostraAttoFirmato(doc) && (
                    <button
                      type="button"
                      onClick={() => handleDownloadAttoFirmato(doc)}
                      className="btn btn-success btn-sm"
                      title="Scarica l'atto come sottoscritto (file firmato), distinto dal PDF master e dal verbale di firma"
                    >
                      ✍️ Firmato
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDownloadDocumentWord(doc)}
                    className="btn btn-secondary btn-sm"
                    title="Scarica in formato Microsoft Word (.doc)"
                  >
                    📝 Word
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="btn btn-danger btn-sm"
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
                        <span style={{ fontSize: 10, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--pill-indigo-bd)' }}>
                          {doc.cat || doc.categoria || 'Generale'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.dimensione || '24 KB'}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.data || doc.dataCaricamento || '15/08/2026'}</td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 9.5, background: doc.firmato ? 'var(--pill-green-bg)' : 'var(--pill-amber-bg)', color: doc.firmato ? 'var(--pill-green-fg)' : 'var(--pill-amber-fg)', border: `1px solid ${doc.firmato ? 'var(--pill-green-bd)' : 'var(--pill-amber-bd)'}`, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                            {doc.firmato ? '🔒 OTP verificata' : '⏳ In attesa di firma'}
                          </span>
                          {doc.dbDoc?.firmatoDaStudio && (
                            <span style={{ fontSize: 9.5, background: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)', border: '1px solid var(--pill-indigo-bd)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                              🏛️ Studio
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {doc.dbDoc && !doc.dbDoc.firmatoDaStudio && (
                            <button
                              type="button"
                              onClick={() => setDocPerFirmaStudio(doc.dbDoc)}
                              className="btn btn-secondary btn-sm"
                              title="Apponi la firma dello studio / professionista incaricato sul documento"
                            >
                              ✍️ Firma Studio
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedPreviewDoc(doc)}
                            className="btn btn-secondary btn-sm"
                          >
                            👁 Anteprima
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                            className="btn btn-secondary btn-sm"
                          >
                            ✏️ Word Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDocumentPdf(doc)}
                            className="btn btn-success btn-sm"
                            title="Scarica in formato PDF A4"
                          >
                            📥 PDF
                          </button>
                          {mostraAttoFirmato(doc) && (
                            <button
                              type="button"
                              onClick={() => handleDownloadAttoFirmato(doc)}
                              className="btn btn-success btn-sm"
                              title="Scarica l'atto come sottoscritto (file firmato), distinto dal PDF master e dal verbale di firma"
                            >
                              ✍️ Firmato
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDownloadDocumentWord(doc)}
                            className="btn btn-secondary btn-sm"
                            title="Scarica in formato Microsoft Word (.doc)"
                          >
                            📝 Word
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="btn btn-danger btn-sm"
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
                  <span style={{ fontSize: 10, background: selectedPreviewDoc.firmato ? 'var(--pill-green-bg)' : 'var(--pill-indigo-bg)', color: selectedPreviewDoc.firmato ? 'var(--green)' : 'var(--purple)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--indigo-d)' }}>
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
            <div style={{ flex: 1, padding: 18, overflowY: 'auto', background: 'var(--surface-2)' }}>
              {partiAnteprima ? (
                <FoglioA4
                  sfondo="var(--surface-2)"
                  intestazione={partiAnteprima.intestazione ? { html: partiAnteprima.intestazione, etichetta: 'Intestazione' } : undefined}
                  piede={partiAnteprima.piede ? { html: partiAnteprima.piede, etichetta: 'Piè di pagina' } : undefined}
                >
                  <div style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: partiAnteprima.corpo }} />
                </FoglioA4>
              ) : selectedPreviewDoc.dbDoc && selectedPreviewDoc.url && selectedPreviewDoc.url !== '#' ? (
                // Gli URL archivio sono attachment: niente iframe nel contesto autenticato.
                <div data-theme="light" style={{ fontFamily: 'sans-serif', background: '#fff', color: 'var(--text)', borderRadius: 8, padding: 28, textAlign: 'center' }}>
                  <strong>Anteprima incorporata disabilitata per sicurezza.</strong>
                  <div style={{ marginTop: 8, fontSize: 12 }}>Scarica il file per aprirlo con l'applicazione associata.</div>
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <a href={selectedPreviewDoc.url} download style={{ color: 'var(--cat-societario)', fontWeight: 700 }}>Scarica il file originale</a>
                  </div>
                </div>
              ) : (
                // Niente HTML e niente file: si dice, invece di riempire il foglio con un testo
                // di circostanza che sembrava il contenuto del documento.
                <div data-theme="light" style={{ background: '#fff', color: 'var(--text)', borderRadius: 8, padding: 28, fontSize: 12.5, lineHeight: 1.6, fontFamily: 'sans-serif' }}>
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
                  className="btn btn-success" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📥 Scarica PDF A4
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadDocumentWord(selectedPreviewDoc)}
                  className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  📝 Scarica Word (.doc)
                </button>
                {/* Fix firma — l'atto come sottoscritto, distinto dal PDF master e dal verbale
                    di firma: il file firmato caricato (FEQ/SES), con l'estensione vera
                    dedotta dall'URL (.p7m/.docx/…), non arbitrariamente .pdf. */}
                {mostraAttoFirmato(selectedPreviewDoc) && (
                  <button
                    type="button"
                    onClick={() => handleDownloadAttoFirmato(selectedPreviewDoc)}
                    className="btn btn-success" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    title="L'atto come sottoscritto (file firmato), distinto dal PDF master e dal verbale di firma"
                  >
                    ✍️ Scarica atto firmato
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/documents?projId=${project.id}&docId=${selectedPreviewDoc.id}`);
                  }}
                  className="btn btn-primary"
                >
                  📝 Modifica in Document Studio
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewDoc(null)}
                  className="btn btn-secondary"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Firma Studio */}
      {docPerFirmaStudio && (
        <FirmaStudioModal
          doc={docPerFirmaStudio}
          onClose={() => setDocPerFirmaStudio(null)}
          onSigned={() => {
            setDocPerFirmaStudio(null);
            listaDocumentiProgetto(String(project.id))
              .then((dbDocs) => {
                const vista = dbDocs.map((d) => documentoApiAVista(d, String(project.id)));
                setDocList((prev) => {
                  const idsDb = new Set(vista.map((d) => d.id));
                  return [...vista, ...prev.filter((d) => !idsDb.has(d.id))];
                });
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
