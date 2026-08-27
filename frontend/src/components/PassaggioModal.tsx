import React, { useState, useEffect, useRef } from 'react';
import { generateRealPdfBase64 } from '../utils/pdfGenerator';
import { PREBUILT_TEMPLATES, resolveDocumentTemplateHtml, type DocumentTemplate } from '../utils/documentTemplates';
import { REORGANIZATION_TEMPLATES } from '../utils/reorganizationTemplates';
import {
  salvaDocumentoApi,
  listaDocumentiProgetto,
  aggiornaStatoDocumentoApi,
  nuovaVersioneDocumentoApi,
  aggiornaRichiestaModificaDocumentoApi,
  eliminaDocumentoApi,
  archiviaDocumentoApi,
  sbloccaDocumentoApi,
  scaricaDocumentoClient,
  scaricaDocumentoWordClient,
  urlFileArchivio,
  type RichiestaModificaDoc,
} from '../api/client';
import { isAdminStudio } from '../utils/tenant';
import type { Progetto, Passaggio } from '../types';

interface PassaggioModalProps {
  project: Progetto;
  mid: number;
  vidx: number;
  onClose: () => void;
  onSaveVoce?: (updatedSteps: Passaggio[], updatedNotes?: NoteEntry[], updatedDocCount?: number) => void;
  /** Id DB del progetto (uuid), necessario per salvare documenti a database. */
  progettoDbId?: string;
  /** Id DB della microvoce (uuid), necessario per collegare il documento alla microvoce. */
  microvoceDbId?: string;
}

interface NoteEntry {
  id: string;
  autore: string;
  data: string;
  testo: string;
}

interface DocumentoEntry {
  id: string;
  nome: string;
  dimensione: string;
  richiedeFirma: boolean;
  firmato: boolean;
  dataCaricamento: string;
  templateId?: string;
  statoDoc?: 'bozza' | 'pubblicato' | 'in_revisione' | 'firmato';
  versione?: number;
  pubblicatoAt?: string | null;
  fileUrl?: string;
  richiesteModifica?: RichiestaModificaDoc[];
  /**
   * §WF-DOC — sigillo di firma restituito dal server (data, id firma, tipo).
   * Serve per mostrare all'operatore *quando* e *come* il cliente ha firmato:
   * prima l'app diceva solo "FIRMATO" e la data era leggibile solo nel portale.
   * Non viene mai ricostruito lato client: se il server non lo manda, non si mostra.
   */
  firma?: { riferimentoId: string | null; firmatoAt: string | null; signatureId: string | null; tipoFirma: string | null } | null;
}

interface RecommendationResult {
  template: DocumentTemplate | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// Tutte le 30 cartelle e modelli studio disponibili
const ALL_STUDIO_TEMPLATES: DocumentTemplate[] = [
  ...PREBUILT_TEMPLATES,
  ...REORGANIZATION_TEMPLATES.filter(rt => !PREBUILT_TEMPLATES.some(pt => pt.id === rt.id)),
];

/**
 * §WF-DOC / regola 7 — traduce il `tipoFirma` del sigillo server in etichetta leggibile.
 * Se il server non manda il tipo si restituisce stringa vuota: meglio dire solo
 * "FIRMATO" che affermare una modalità di firma che non risulta agli atti.
 */
function etichettaTipoFirma(tipoFirma?: string | null): string {
  switch (tipoFirma) {
    case 'fea_otp': return 'firma elettronica semplice con OTP verificata';
    case 'manuale_scansionata': return 'firma autografa scansionata';
    case 'qualificata_esterna': return 'firma digitale qualificata';
    default: return '';
  }
}

/**
 * Motore di Pre-screening Intelligente Studio BluMan
 * Analizza la microvoce, il modulo e la categoria e individua il modello più idoneo.
 */
export function getSmartDocumentRecommendation(voceTitle: string, category: string = '', moduleName: string = ''): RecommendationResult {
  const v = voceTitle.toLowerCase();
  const c = category.toLowerCase();
  const m = moduleName.toLowerCase();

  // 1. Intake, KYC, Antiriciclaggio, Raccolta Documenti
  if (v.includes('kyc') || v.includes('intake') || v.includes('questionario') || v.includes('adeguata verifica') || v.includes('antiriciclaggio') || v.includes('raccolta doc')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-1-questionario-intake-cliente' || t.id === 'tmpl-ubo' || t.id === 'tmpl-antiriciclaggio') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata fase di onboarding/compliance: consigliato il Questionario Intake & Adeguata Verifica Antiriciclaggio.',
    };
  }

  // 2. Trust, Fiduciaria, Protezione Patrimoniale
  if (v.includes('trust') || v.includes('fiduciar') || v.includes('deed') || v.includes('wishes') || c.includes('trust') || m.includes('trust')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-trust-malta' || t.categoria === 'trust') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata operazione fiduciaria: consigliato il Deed of Trust con clausole di protezione e Letter of Wishes.',
    };
  }

  // 3. Exit Tax, Fiscalità Internazionale, CFC, Residenza Fiscale
  if (v.includes('exit tax') || v.includes('rateizzazione') || v.includes('plusvalenz') || v.includes('trasferimento residenza')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-3-memo-valutazione-exit-tax' || t.id === 'tmpl-06-1-memo-procedurale-exit-tax-rateizzazione') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato adempimento fiscale straordinario: consigliato il Memo Valutazione Exit Tax ex art. 166 TUIR.',
    };
  }
  if (v.includes('analisi fiscale') || v.includes('cfc') || v.includes('esterovestizione') || v.includes('interpello') || c.includes('fiscale')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-01-2-memo-analisi-fiscale-preliminare') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata perizia tributaria: consigliato il Memo di Analisi Fiscale Preliminare & Sostanza Economica.',
    };
  }

  // 4. Costituzione Società, Statuto, Holding, Atto Costitutivo
  if (v.includes('statuto') || v.includes('costituz') || v.includes('atto') || v.includes('holding') || v.includes('ltd') || v.includes('societ') || c.includes('societario') || m.includes('structuring')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-statuto-holding' || t.id === 'tmpl-02-3-checklist-costituzione-societa-estera' || t.id === 'tmpl-02-1-memorandum-struttura') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata costituzione/corporate structuring: consigliato lo Statuto Standard Holding o Memorandum di Struttura.',
    };
  }

  // 5. Cessione Quote, Patti Parasociali, M&A
  if (v.includes('cessione') || v.includes('quote') || v.includes('partecipaz') || v.includes('compravendita')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.titolo.toLowerCase().includes('cessione') || t.id.includes('cessione')) || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato trasferimento partecipazioni: consigliato il Contratto di Cessione Quote con clausole di garanzia.',
    };
  }

  // 6. Banche, Conti Correnti, KYC Bancario
  if (v.includes('banc') || v.includes('conto') || v.includes('emi') || v.includes('iban') || c.includes('banking')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-03-1-matrice-comparativa-istituti-bancari' || t.id === 'tmpl-03-3-procedura-apertura-conto-societario') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato dossier bancario: consigliata la Procedura di Apertura Conto Societario & Matrice Banche.',
    };
  }

  // 7. Marchi, Proprietà Intellettuale (IP), Licenze
  if (v.includes('marchi') || v.includes('ip') || v.includes('brevett') || v.includes('euipo') || c.includes('ip')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-05-3-bozza-contratto-cessione-licenza-ip' || t.id === 'tmpl-05-2-procedura-deposito-marchio') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevata tutela asset intangibili: consigliato il Contratto di Cessione e Licenza d\'Uso Marchio/IP.',
    };
  }

  // 8. Engagement, Mandato, Accordo di Riservatezza NDA
  if (v.includes('nda') || v.includes('riservatezza') || v.includes('segreto')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-nda') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato scambio preliminare informazioni: consigliato il Non-Disclosure Agreement (NDA) bilaterale.',
    };
  }
  if (v.includes('incarico') || v.includes('mandato') || v.includes('lettera') || v.includes('preventivo')) {
    const tmpl = ALL_STUDIO_TEMPLATES.find(t => t.id === 'tmpl-engagement') || ALL_STUDIO_TEMPLATES[0];
    return {
      template: tmpl,
      confidence: 'high',
      reason: 'Rilevato avvio formale incarico: consigliata la Lettera d\'Incarico Professionale (Engagement Letter).',
    };
  }

  // Fallback a suggerimento medio
  const fallbackTmpl = ALL_STUDIO_TEMPLATES.find(t => t.categoria === (c as any)) || ALL_STUDIO_TEMPLATES[0];
  return {
    template: fallbackTmpl,
    confidence: 'medium',
    reason: `Attività generale di categoria ${category || 'Advisory'}: puoi associare un modello correlato o lasciare l'attività senza documenti.`,
  };
}

// Usa solo lo stato della voce: il numero documenti (`d`) era richiesto nella firma
// ma mai letto, e MicroVoce ora lo dichiara opzionale.
function getDefaultPassaggi(v: { s: string }): Passaggio[] {
  return [
    { id: 's1', title: 'Informazioni preliminari & Briefing', type: 'info', who: 'operatore', stato: v.s !== 'pending' ? 'done' : 'pending', desc: 'Briefing interno del team prima di avviare l\'attività.' },
    { id: 's2', title: 'Verifica & Documentazione Incarico', type: 'doc', who: 'cliente', stato: 'pending', desc: 'Collega o carica un documento solo se richiesto dall\'attività.', file: undefined },
    { id: 's3', title: 'Dati aggiuntivi dal cliente', type: 'form', who: 'cliente', stato: 'pending', desc: 'Il cliente compila il form con i dati societari.', fields: ['Nome completo', 'Recapito preferito'] },
    { id: 's4', title: 'Conferma e validazione finale', type: 'check', who: 'operatore', stato: v.s === 'done' ? 'done' : 'pending', desc: 'Verifica finale del team prima di chiudere la voce.' },
  ];
}

const TYPE_LABEL: Record<string, string> = { doc: 'Documento', form: 'Form', info: 'Info', check: 'Verifica' };
const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
  doc:   { bg: '#1a1f3d', color: '#818cf8' },
  form:  { bg: '#200f40', color: '#a78bfa' },
  info:  { bg: '#1e2030', color: '#94a3b8' },
  check: { bg: '#0d2d22', color: '#34d399' },
};

export function PassaggioModal({ project, mid, vidx, onClose, onSaveVoce, progettoDbId, microvoceDbId }: PassaggioModalProps) {
  const effProgettoId = progettoDbId || (project as any)?.dbId || (project as any)?.id;
  const mod = project.mods.find(m => m.id === mid)!;
  const voce = mod.v[vidx];
  const effMicrovoceId = microvoceDbId || (voce as any)?.dbId;
  const [view, setView] = useState<'operatore' | 'cliente'>('operatore');
  const [activeTab, setActiveTab] = useState<'passaggi' | 'note' | 'documenti'>('passaggi');
  const [steps, setSteps] = useState<Passaggio[]>(() => voce.proc || getDefaultPassaggi(voce));

  // Note operative persistite
  const [notes, setNotes] = useState<NoteEntry[]>(() => {
    if (voce.note && Array.isArray(voce.note) && voce.note.length > 0) {
      return voce.note;
    }
    const saved = localStorage.getItem(`bluman_notes_${project.id}_${mid}_${vidx}`);
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return [
      { id: 'n1', autore: 'Avv. Mario Dibenedetto', data: new Date().toLocaleDateString('it-IT'), testo: 'Attività avviata nel fascicolo digitale dello studio.' },
    ];
  });
  const [newNote, setNewNote] = useState('');

  // Calcolo Pre-screening Intelligente
  const recommendation = getSmartDocumentRecommendation(voce.n, mod.cat, mod.n);

  // Documenti collegati alla microvoce (PARTE DA ARRAY VUOTO SE L'OPERATORE NON HA COLLEGATO NULLA!)
  const [documents, setDocuments] = useState<DocumentoEntry[]>(() => {
    const savedDocsKey = `bluman_docs_${project.id}_${mid}_${vidx}`;
    const savedStr = localStorage.getItem(savedDocsKey);
    if (savedStr) {
      try {
        const parsed = JSON.parse(savedStr);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return []; // NESSUN DOCUMENTO FORZATO DI DEFAULT!
  });


  const [selectedDocPreview, setSelectedDocPreview] = useState<DocumentoEntry | null>(null);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [selectedCatalogCategory, setSelectedCatalogCategory] = useState<string>('ALL');

  // Form master preview state
  const [, setPreviewFormModalStep] = useState<Passaggio | null>(null);
  const [, setPreviewFormValues] = useState<Record<string, string>>({});

  const [, setShowAddStepModal] = useState(false);

  const doneN = steps.filter(s => s.stato === 'done').length;
  const visible = view === 'operatore' ? steps : steps.filter(s => s.who === 'cliente');

  const persistDocuments = (newDocs: DocumentoEntry[]) => {
    setDocuments(newDocs);
    localStorage.setItem(`bluman_docs_${project.id}_${mid}_${vidx}`, JSON.stringify(newDocs));
    voce.d = newDocs.length;
    if (onSaveVoce) {
      onSaveVoce(steps, notes, newDocs.length);
    }
  };

  const toggleDone = (id: string) => {
    const nextSteps: Passaggio[] = steps.map(s => s.id === id ? { ...s, stato: (s.stato === 'done' ? 'pending' : 'done') as 'pending' | 'done' } : s);
    setSteps(nextSteps);
    voce.proc = nextSteps;
    if (onSaveVoce) {
      onSaveVoce(nextSteps, notes, documents.length);
    }
  };

  const handleDeleteStep = (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo passaggio dalla checklist?')) return;
    const nextSteps = steps.filter(s => s.id !== id);
    setSteps(nextSteps);
    voce.proc = nextSteps;
    if (onSaveVoce) {
      onSaveVoce(nextSteps, notes, documents.length);
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    const entry: NoteEntry = {
      id: `n-${Date.now()}`,
      autore: 'Avv. Mario Dibenedetto (Advisor)',
      data: new Date().toLocaleString('it-IT'),
      testo: newNote,
    };
    const updatedNotes = [entry, ...notes];
    setNotes(updatedNotes);
    localStorage.setItem(`bluman_notes_${project.id}_${mid}_${vidx}`, JSON.stringify(updatedNotes));
    voce.note = updatedNotes;
    if (onSaveVoce) {
      onSaveVoce(steps, updatedNotes, documents.length);
    }
    setNewNote('');
  };

  // Stato per il Modale di Scelta Metodo Firma e Configurazione Documento
  const [configFirmaModal, setConfigFirmaModal] = useState<{
    open: boolean;
    tmpl?: DocumentTemplate;
    file?: File;
    fileBase64?: string;
    stepId?: string;
    titolo: string;
    richiedeFirma: boolean;
    metodoFirma: 'fea_otp' | 'manuale_scansionata' | 'qualificata_esterna' | 'tutte';
    statoDoc: 'bozza' | 'pubblicato';
    dataScadenzaDoc: string;
  } | null>(null);

  // Apertura modale configurazione firma per Template
  const apriConfigFirmaTemplate = (tmpl: DocumentTemplate, stepId?: string) => {
    setConfigFirmaModal({
      open: true,
      tmpl,
      stepId,
      titolo: `${tmpl.titolo} — ${project.cl}.pdf`,
      richiedeFirma: true,
      metodoFirma: 'fea_otp',
      statoDoc: 'bozza',
      dataScadenzaDoc: '',
    });
  };

  // Esecuzione del salvataggio documento con metodo firma configurato
  const eseguiSalvataggioConfigurato = async () => {
    if (!configFirmaModal) return;
    const { tmpl, file, fileBase64, stepId, titolo, richiedeFirma, metodoFirma, statoDoc, dataScadenzaDoc } = configFirmaModal;

    const rawFilename = titolo.trim() || (tmpl ? `${tmpl.titolo} — ${project.cl}.pdf` : file?.name || 'Documento.pdf');
    const formattedName = tmpl ? rawFilename.replace(/\.docx?$/i, '.pdf') : rawFilename;

    let contentBase64 = fileBase64 || '';
    if (tmpl && !contentBase64) {
      // `DocumentTemplate` dichiara `contenutoHtml`: `tmpl.html` non esiste ed era sempre
      // undefined, quindi il contenuto arrivava solo dal cast `as any`. Se qualcuno avesse
      // rimosso quel fallback, ogni PDF pubblicato sarebbe diventato uno stub col solo titolo.
      const rawHtml = tmpl.contenutoHtml || '';
      const resolvedHtml = resolveDocumentTemplateHtml(rawHtml, project);
      contentBase64 = await generateRealPdfBase64(resolvedHtml || `<html><body><h1>${formattedName}</h1></body></html>`);
    }

    let dbId: string | undefined;
    let savedFileUrl: string | undefined;

    if (effProgettoId) {
      try {
        const salvato = await salvaDocumentoApi({
          progettoId: effProgettoId,
          microvoceProgettoId: effMicrovoceId,
          filename: formattedName,
          contentBase64,
          categoriaDoc: tmpl?.categoria || 'Allegati Microvoce',
          statoDoc,
          dataScadenzaDoc: dataScadenzaDoc || undefined,
          tipo: richiedeFirma ? 'allegato' : 'compilato',
        });
        dbId = salvato.id;
        savedFileUrl = salvato.fileUrl;
      } catch (err: any) {
        console.warn('Errore salvataggio documento a DB:', err);
      }
    }

    const newDoc: DocumentoEntry = {
      id: dbId || (tmpl ? `d-${tmpl.id}-${Date.now()}` : `d-${Date.now()}`),
      nome: formattedName,
      dimensione: file ? `${Math.round(file.size / 1024)} KB` : '56 KB',
      richiedeFirma,
      firmato: false,
      dataCaricamento: new Date().toLocaleDateString('it-IT'),
      templateId: tmpl?.id,
      statoDoc,
      versione: 1,
      fileUrl: savedFileUrl,
      richiesteModifica: [],
    };

    const updatedDocs = [...documents, newDoc];
    persistDocuments(updatedDocs);

    // Se associato a uno step specifico o al primo passaggio doc
    const updatedSteps = steps.map((s) => {
      if ((stepId && s.id === stepId) || (!stepId && s.type === 'doc' && !s.file)) {
        return {
          ...s,
          file: formattedName,
          documentoAllegatoUrl: tmpl?.id || savedFileUrl || newDoc.id,
          richiedeFirmaCliente: richiedeFirma,
        };
      }
      return s;
    });

    setSteps(updatedSteps);
    voce.proc = updatedSteps;
    if (onSaveVoce) onSaveVoce(updatedSteps, notes, updatedDocs.length);

    setConfigFirmaModal(null);
    setShowCatalogModal(false);

    const metodoNome = metodoFirma === 'fea_otp' ? 'Firma semplice (OTP)' : metodoFirma === 'manuale_scansionata' ? 'Olografa Tradizionale' : metodoFirma === 'qualificata_esterna' ? 'Qualificata QES' : 'Libera';
    alert(`✓ Documento "${formattedName}" collegato con successo!\n• Richiede Firma: ${richiedeFirma ? `Sì (${metodoNome})` : 'No (Sola lettura)'}\n• Stato: ${statoDoc === 'pubblicato' ? '🚀 Pubblicato al Cliente' : '🔒 Bozza Interna'}`);

    if (effProgettoId) await ricaricaDocumentiDb();
  };

  // Applica Modello (apre il configuratore firma)
  const handleApplyTemplate = (tmpl: DocumentTemplate, stepId?: string) => {
    apriConfigFirmaTemplate(tmpl, stepId);
  };

  // Caricamento documenti dal database su mount
  useEffect(() => {
    if (!effProgettoId) return;
    let mounted = true;
    listaDocumentiProgetto(effProgettoId)
      .then(dbDocs => {
        if (!mounted) return;
        // Filtra documenti associati a questa microvoce
        const docsMv = dbDocs.filter(d => effMicrovoceId ? (d.microvoceProgettoId === effMicrovoceId) : false);
        if (docsMv.length > 0) {
          const mapped: DocumentoEntry[] = docsMv.map(d => ({
            id: d.id,
            nome: d.fileUrl ? (d.fileUrl.split('/').pop()?.replace(/^\d+_/, '') || `Documento v${d.versione}`) : `Documento v${d.versione}`,
            dimensione: 'Fascicolo DB',
            richiedeFirma: d.tipo !== 'firmato' && d.tipo !== 'verbale_firma' && !d.firmato,
            firmato: d.firmato || d.statoDoc === 'firmato',
            dataCaricamento: new Date(d.createdAt).toLocaleDateString('it-IT'),
            statoDoc: d.statoDoc || 'bozza',
            versione: d.versione || 1,
            pubblicatoAt: d.pubblicatoAt,
            fileUrl: d.fileUrl,
            richiesteModifica: d.richiesteModifica || [],
          }));
          setDocuments(mapped);
          voce.d = mapped.length;
        }
      })
      .catch(err => console.warn('Errore lettura documenti DB:', err));
    return () => { mounted = false; };
  }, [effProgettoId, effMicrovoceId]);

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [versionTargetDocId, setVersionTargetDocId] = useState<string | null>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);

  const ricaricaDocumentiDb = async () => {
    if (!effProgettoId) return;
    try {
      const dbDocs = await listaDocumentiProgetto(effProgettoId);
      const docsMv = dbDocs.filter(d => effMicrovoceId ? (d.microvoceProgettoId === effMicrovoceId) : false);
      const mapped: DocumentoEntry[] = docsMv.map(d => ({
        id: d.id,
        nome: d.fileUrl ? (d.fileUrl.split('/').pop()?.replace(/^\d+_/, '') || `Documento v${d.versione}`) : `Documento v${d.versione}`,
        dimensione: 'Fascicolo DB',
        richiedeFirma: d.tipo !== 'firmato' && d.tipo !== 'verbale_firma' && !d.firmato,
        firmato: d.firmato || d.statoDoc === 'firmato',
        dataCaricamento: new Date(d.createdAt).toLocaleDateString('it-IT'),
        statoDoc: d.statoDoc || 'bozza',
        versione: d.versione || 1,
        pubblicatoAt: d.pubblicatoAt,
        fileUrl: d.fileUrl,
        richiesteModifica: d.richiesteModifica || [],
        firma: d.firma ?? null,
      }));
      setDocuments(mapped);
      voce.d = mapped.length;
      if (onSaveVoce) onSaveVoce(steps, notes, mapped.length);
    } catch (err) {
      console.warn('Errore ricarica documenti:', err);
    }
  };

  // Pubblica documento al cliente (visibile per firma)
  const handlePubblicaDocumento = async (docId: string) => {
    try {
      const localDoc = documents.find(d => d.id === docId);
      const isLocalId = docId.startsWith('d-');

      if (isLocalId && effProgettoId) {
        // Documento template o locale non ancora salvato a DB: salvalo ora come VERO PDF con stato pubblicato
        const tmpl = localDoc?.templateId ? ALL_STUDIO_TEMPLATES.find(t => t.id === localDoc.templateId) : null;
        const rawHtml = tmpl?.contenutoHtml || `<html><body><h1>${localDoc?.nome || 'Documento'}</h1></body></html>`;
        const htmlContent = resolveDocumentTemplateHtml(rawHtml, project);
        const contentBase64 = await generateRealPdfBase64(htmlContent);
        const rawName = localDoc?.nome || 'Documento.pdf';
        const pdfFilename = rawName.replace(/\.docx?$/i, '.pdf');

        await salvaDocumentoApi({
          progettoId: effProgettoId,
          microvoceProgettoId: microvoceDbId,
          filename: pdfFilename,
          contentBase64,
          categoriaDoc: tmpl?.categoria || 'Allegati Microvoce',
          statoDoc: 'pubblicato',
        });
      } else {
        try {
          await aggiornaStatoDocumentoApi(docId, 'pubblicato');
        } catch (err: any) {
          if (effProgettoId) {
            // Se fallisce l'aggiornamento (es. documento orfano nel client), salvalo direttamente a DB
            const tmpl = localDoc?.templateId ? ALL_STUDIO_TEMPLATES.find(t => t.id === localDoc.templateId) : null;
            const rawHtml = tmpl?.contenutoHtml || `<html><body><h1>${localDoc?.nome || 'Documento'}</h1></body></html>`;
            const htmlContent = resolveDocumentTemplateHtml(rawHtml, project);
            const contentBase64 = await generateRealPdfBase64(htmlContent);
            const rawName = localDoc?.nome || 'Documento.pdf';
            const pdfFilename = rawName.replace(/\.docx?$/i, '.pdf');

            await salvaDocumentoApi({
              progettoId: effProgettoId,
              microvoceProgettoId: microvoceDbId,
              filename: pdfFilename,
              contentBase64,
              categoriaDoc: tmpl?.categoria || 'Allegati Microvoce',
              statoDoc: 'pubblicato',
            });
          } else {
            throw err;
          }
        }
      }
      alert('🚀 Documento pubblicato al cliente con successo! Ora è visibile nel portale per la firma.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      alert(`❌ Errore pubblicazione: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };

  // Rimetti documento in bozza interna
  const handleRimettiInBozza = async (docId: string) => {
    if (!confirm('Vuoi rimettere questo documento in bozza interna? Il cliente non lo vedrà più fino a nuova pubblicazione.')) return;
    try {
      await aggiornaStatoDocumentoApi(docId, 'bozza');
      alert('🔒 Documento rimesso in bozza interna.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      alert(`❌ Errore: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };

  // §WF-DOC — sblocco di un documento firmato. Riservato all'admin dello studio
  // (advisor) e al super_admin: il controllo vero lo fa il server, che rifiuta
  // chiunque altro con 403 anche se il pulsante venisse raggiunto per altra via.
  //
  // La motivazione è obbligatoria e finisce nell'audit log: un atto sottoscritto
  // dal cliente si riapre solo lasciando scritto perché. La firma già apposta NON
  // viene cancellata, così il percorso resta ripercorribile all'indietro: il
  // cliente continua a vedere la firma che ha dato sulla versione precedente.
  const handleSbloccaDocumento = async (docId: string, nomeDoc: string) => {
    if (docId.startsWith('d-')) {
      alert('Questo documento non è ancora archiviato a database: non risulta firmato e non ha bisogno di sblocco.');
      return;
    }
    const motivo = prompt(
      `SBLOCCO DOCUMENTO FIRMATO\n\n"${nomeDoc}"\n\n` +
      'Il cliente ha già sottoscritto questo documento. Riaprendolo torna in bozza interna: ' +
      'il cliente ne verrà informato e dovrai pubblicare una nuova versione da fargli firmare.\n' +
      'La firma già apposta resta agli atti e non viene cancellata.\n\n' +
      'Indica la motivazione (almeno 10 caratteri, viene registrata nel registro delle attività):'
    );
    if (motivo === null) return;
    if (motivo.trim().length < 10) {
      alert('Motivazione troppo breve: serve una spiegazione di almeno 10 caratteri, perché resta agli atti.');
      return;
    }
    try {
      await sbloccaDocumentoApi(docId, motivo.trim());
      alert('🔓 Documento riaperto in bozza interna. Motivazione registrata; il cliente è stato notificato.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      alert(`❌ Sblocco non riuscito: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };

  // Carica nuova versione (v2, v3...) post revisione
  const handleFileNuovaVersione = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !versionTargetDocId) return;
    e.target.value = '';
    setUploadingDoc(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Lettura file non riuscita'));
        reader.readAsDataURL(file);
      });

      await nuovaVersioneDocumentoApi(versionTargetDocId, {
        filename: file.name,
        contentBase64: base64,
      });

      alert('✓ Nuova versione caricata con successo! Ora è in bozza: controllala e clicca "Pubblica al Cliente" quando è pronta.');
      setVersionTargetDocId(null);
      await ricaricaDocumentiDb();
    } catch (err: any) {
      alert(`❌ Errore caricamento nuova versione: ${err?.message ?? 'Errore sconosciuto'}`);
    } finally {
      setUploadingDoc(false);
    }
  };

  // Risolvi richiesta di modifica del cliente
  const handleRisolviRichiesta = async (rid: string) => {
    const risposta = prompt('Inserisci un commento o nota di riscontro per il cliente (opzionale):') ?? '';
    try {
      await aggiornaRichiestaModificaDocumentoApi(rid, { stato: 'risolta', rispostaStudio: risposta });
      alert('✓ Richiesta di modifica contrassegnata come risolta.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      alert(`❌ Errore: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };

  // Caricamento documento dal disco: legge base64 e apre il configuratore firma
  const handleFileUploadPassaggio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Lettura file non riuscita'));
        reader.readAsDataURL(file);
      });

      setConfigFirmaModal({
        open: true,
        file,
        fileBase64: base64,
        titolo: file.name,
        richiedeFirma: true,
        metodoFirma: 'fea_otp',
        statoDoc: 'bozza',
        dataScadenzaDoc: '',
      });
    } catch (err: any) {
      alert(`❌ Impossibile leggere il file: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };


  // Scollega documento da un singolo step
  const handleUnlinkStepDoc = (stepId: string) => {
    const updated = steps.map(item => item.id === stepId ? { ...item, file: undefined, documentoAllegatoUrl: undefined } : item);
    setSteps(updated);
    voce.proc = updated;
    if (onSaveVoce) onSaveVoce(updated, notes, documents.length);
  };

  const filteredCatalog = ALL_STUDIO_TEMPLATES.filter(t => {
    if (selectedCatalogCategory === 'ALL') return true;
    return t.categoria === selectedCatalogCategory;
  });

  return (
    <div style={overlayStyle} onClick={e => { if ((e.target as HTMLElement).id === 'proc-ov') onClose(); }} id="proc-ov">
      <div style={modalStyle}>
        {/* Head */}
        <div style={headStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{voce.n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                📁 {mod.n} ({mod.cat}) · Pratica: <strong>{project.n}</strong> — Cliente: {project.cl}
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle}>✕</button>
          </div>

          {/* Sub Navigation */}
          <div style={{ display: 'flex', gap: 6, marginTop: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <button
              onClick={() => setActiveTab('passaggi')}
              style={tabBtnStyle(activeTab === 'passaggi')}
            >
              📋 Checklist Passaggi ({doneN}/{steps.length})
            </button>
            <button
              onClick={() => setActiveTab('note')}
              style={tabBtnStyle(activeTab === 'note')}
            >
              📝 Note & Registro Attività ({notes.length})
            </button>
            <button
              onClick={() => setActiveTab('documenti')}
              style={tabBtnStyle(activeTab === 'documenti')}
            >
              📎 Documenti & Workflow ({documents.length})
            </button>
          </div>
        </div>

        {/* Body TAB 1: Passaggi */}
        {activeTab === 'passaggi' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* View Switcher & Add Step Button */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', flex: 1, gap: 8 }}>
                {(['operatore', 'cliente'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      flex: 1, padding: '7px', borderRadius: 8,
                      border: `1px solid ${view === v ? 'var(--indigo)' : 'var(--border)'}`,
                      background: view === v ? '#1a1f3d' : 'var(--card)',
                      color: view === v ? 'var(--indigo-l)' : 'var(--muted)',
                      fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {v === 'operatore' ? '👤 Vista Operatore Studio' : '🧑‍💼 Vista Portale Cliente'}
                  </button>
                ))}
              </div>

              {view === 'operatore' && (
                <button
                  type="button"
                  onClick={() => setShowAddStepModal(true)}
                  style={{
                    background: 'var(--indigo)', color: '#fff', border: 'none',
                    padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0
                  }}
                >
                  ➕ Aggiungi Azione
                </button>
              )}
            </div>

            {visible.map((s, i) => {
              const isLast = i === visible.length - 1;
              const tc = TYPE_COLOR[s.type] || TYPE_COLOR.info;
              return (
                <div key={s.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: s.stato === 'done' ? 'var(--green)' : 'var(--card2)',
                      color: s.stato === 'done' ? '#fff' : 'var(--muted)',
                      border: s.stato !== 'done' ? '1.5px solid var(--border)' : 'none',
                    }}>
                      {s.stato === 'done' ? '✓' : i + 1}
                    </div>
                    {!isLast && <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4, minHeight: 14 }} />}
                  </div>

                  <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.desc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase', ...tc }}>
                          {TYPE_LABEL[s.type]}
                        </span>
                        {view === 'operatore' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              onClick={() => toggleDone(s.id)}
                              title="Segna come completato / da fare"
                              style={{ background: 'none', border: 'none', color: s.stato === 'done' ? 'var(--green)' : 'var(--hint)', cursor: 'pointer', fontSize: 15 }}
                            >
                              {s.stato === 'done' ? '✓' : '○'}
                            </button>
                            <button
                              onClick={() => handleDeleteStep(s.id)}
                              title="Elimina passaggio"
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, opacity: 0.7 }}
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step Type = Form */}
                    {s.type === 'form' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa' }}>📋 Dati da raccogliere dal cliente:</span>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewFormValues({
                                'Ragione Sociale': project.cl,
                                'P.IVA / VAT': 'IT99887766554',
                                'Legale Rappresentante': 'Mario Dibenedetto',
                                'Codice Fiscale': 'DBNMRI85M12H501Z',
                                'Sede Legale': 'Milano (MI) Via Roma 10',
                                'IBAN Operativo': 'IT99C0306903200100000001234',
                                'Nome Titolare Effettivo': 'Mario Dibenedetto (100%)',
                              });
                              setPreviewFormModalStep(s);
                            }}
                            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                          >
                            👁 Compila / Visualizza Form
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(s.fields || ['Ragione Sociale', 'P.IVA / VAT', 'Legale Rappresentante']).map((fld, idx) => (
                            <span key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '2px 7px', borderRadius: 6, fontSize: 9.5, fontWeight: 600 }}>
                              📝 {fld}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Step Type = Doc (Mostra SOLO se c'è un documento, altrimenti propone il Pre-screening!) */}
                    {s.type === 'doc' && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {s.file ? (
                          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ fontSize: 20 }}>📄</div>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                                  {s.file}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                                  {s.stato === 'done' ? '✓ Firmato dal cliente' : '✍️ Richiede firma con OTP'}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: s.stato === 'done' ? '#0d2d22' : '#2d1a05', color: s.stato === 'done' ? '#34d399' : '#f59e0b', border: `1px solid ${s.stato === 'done' ? '#1a5c3c' : '#78350f'}` }}>
                                {s.stato === 'done' ? '🔒 FIRMATO' : '✍️ DA FIRMARE'}
                              </span>

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDocPreview({
                                    id: `doc-${s.id}`,
                                    nome: s.file || 'Documento.pdf',
                                    dimensione: '56 KB',
                                    richiedeFirma: true,
                                    firmato: s.stato === 'done',
                                    dataCaricamento: new Date().toLocaleDateString('it-IT'),
                                  });
                                }}
                                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                              >
                                👁 Leggi PDF
                              </button>

                              <button
                                type="button"
                                onClick={() => handleUnlinkStepDoc(s.id)}
                                title="Scollega documento da questo passaggio"
                                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--red)', padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                              >
                                🗑 Scollega
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: '#1e1b4b20', border: '1px dashed #6366f1', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>
                                📁 Nessun documento collegato a questo passaggio
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                {recommendation.template ? `Modello consigliato: ${recommendation.template.titolo}` : 'Puoi associare un atto studio o lasciare l\'attività come procedura interna.'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {recommendation.template && (
                                <button
                                  type="button"
                                  onClick={() => apriConfigFirmaTemplate(recommendation.template!, s.id)}
                                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                                >
                                  ⚡ Collega Consigliato
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setShowCatalogModal(true)}
                                style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                              >
                                📂 Scegli Modello
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Body TAB 2: Note Operatore */}
        {activeTab === 'note' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                Aggiungi Nota Operativa o Aggiornamento:
              </label>
              <textarea
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                placeholder="Inserisci dettagli sull'avanzamento, note di riunione, riscontri dal cliente..."
                rows={3}
                style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                  + Registra Nota
                </button>
              </div>
            </form>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Storico Note Operative ({notes.length})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => (
                <div key={n.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
                    <strong style={{ color: 'var(--indigo-l)' }}>👤 {n.autore}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>{n.data}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5 }}>
                    {n.testo}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body TAB 3: Documenti & Pre-screening AI */}
        {activeTab === 'documenti' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Box Pre-screening & Suggerimento Modello Intelligente */}
            <div style={{ background: '#1e1b4b30', border: '1.5px solid #6366f1', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#818cf8', fontWeight: 700, fontSize: 12 }}>
                  <span>💡 Pre-screening AI Studio & Modello Consigliato</span>
                  <span style={{ fontSize: 10, background: '#312e81', color: '#c7d2fe', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                    {recommendation.confidence === 'high' ? '🎯 ALTA AFFINITÀ' : '💡 SUGGERIMENTO'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCatalogModal(true)}
                  style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                >
                  Sfoglia tutti i 30 modelli ↗
                </button>
              </div>

              {recommendation.template ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#f8fafc' }}>
                    📄 {recommendation.template.titolo}
                  </div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4, lineHeight: 1.4 }}>
                    {recommendation.reason}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handleApplyTemplate(recommendation.template!)}
                      style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}
                    >
                      ⚡ Collega Modello Consigliato (1-Click)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCatalogModal(true)}
                      style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      📂 Scegli Altro Modello Studio
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                  Nessun modello consigliato in modo automatico per questo tipo di attività.
                </div>
              )}
            </div>

            {/* Input file nascosto per caricare nuove versioni di documenti */}
            <input
              type="file"
              ref={versionInputRef}
              style={{ display: 'none' }}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls,.txt,.p7m,.xml"
              onChange={handleFileNuovaVersione}
            />

            {/* Lista Documenti Effettivamente Collegati */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
                Documenti Collegati a questa Microvoce ({documents.length})
              </div>

              {documents.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--muted)', fontSize: 12 }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📭</div>
                  <strong>Nessun documento collegato a questa voce.</strong>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    Questa attività non ha atti o contratti forzati. Puoi associare il modello consigliato sopra o caricare un file personalizzato in bozza.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {documents.map(d => {
                    const st = d.statoDoc || (d.firmato ? 'firmato' : 'bozza');
                    const hasAperte = d.richiesteModifica && d.richiesteModifica.some(r => r.stato === 'aperta');

                    return (
                      <div
                        key={d.id}
                        style={{
                          background: 'var(--card)',
                          border: st === 'in_revisione' || hasAperte ? '1.5px solid #f59e0b' : (st === 'pubblicato' ? '1.5px solid #3b82f6' : (st === 'firmato' ? '1.5px solid #10b981' : '1px solid var(--border)')),
                          borderRadius: 10,
                          padding: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                          <div
                            onClick={() => setSelectedDocPreview(d)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 200 }}
                            title="Clicca per visualizzare"
                          >
                            <div style={{ fontSize: 24 }}>📄</div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', textDecoration: 'underline' }}>{d.nome}</span>
                                {d.versione && (
                                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                                    v{d.versione}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                {d.dimensione} · Caricato il {d.dataCaricamento}
                              </div>
                            </div>
                          </div>

                          {/* Stato Workflow Badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {st === 'bozza' && (
                              <span style={{ background: '#27272a', color: '#a1a1aa', border: '1px solid #3f3f46', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                🔒 BOZZA (Cliente non vede)
                              </span>
                            )}
                            {st === 'pubblicato' && (
                              <span style={{ background: '#1e3a8a30', color: '#60a5fa', border: '1px solid #1d4ed8', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                🚀 PUBBLICATO (In attesa di firma)
                              </span>
                            )}
                            {st === 'in_revisione' && (
                              <span style={{ background: '#451a0330', color: '#fbbf24', border: '1px solid #b45309', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                ⚠️ IN REVISIONE (Modifica richiesta)
                              </span>
                            )}
                            {st === 'firmato' && (
                              <span style={{ background: '#064e3b30', color: '#34d399', border: '1px solid #059669', padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                                {/* §WF-DOC / regola 7 — l'etichetta dice il tipo di firma che c'è stato
                                    davvero: prima diceva "CON OTP" anche su una firma qualificata
                                    esterna o su un cartaceo scansionato, promettendo più del vero. */}
                                ✅ FIRMATO{etichettaTipoFirma(d.firma?.tipoFirma) ? ` — ${etichettaTipoFirma(d.firma?.tipoFirma)}` : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* §WF-DOC — sigillo di firma: chi guarda la micro-voce nell'app deve
                            vedere le stesse informazioni che vede il cliente nel portale, senza
                            doverci arrivare per deduzione. Data, tipo e id firma vengono dal
                            server (`creaSigilloFea`): qui non si ricostruisce nulla. */}
                        {st === 'firmato' && (
                          <div style={{ background: '#064e3b25', border: '1px solid #059669', borderRadius: 8, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399' }}>
                              🔒 Documento sottoscritto dal cliente
                              {d.firma?.firmatoAt ? ` il ${new Date(d.firma.firmatoAt).toLocaleString('it-IT')}` : ''}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {d.firma?.signatureId
                                ? <>Riferimento firma: <code style={{ fontSize: 9.5 }}>{d.firma.signatureId}</code></>
                                : 'Riferimento firma non disponibile su questo documento.'}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              Stato terminale: pubblicazione, nuove versioni ed eliminazione sono bloccate.
                              {' '}Solo l'amministratore dello studio può riaprirlo, motivando lo sblocco.
                            </div>
                          </div>
                        )}

                        {/* Note / Richieste di Modifica del Cliente */}
                        {d.richiesteModifica && d.richiesteModifica.length > 0 && (
                          <div style={{ background: '#27180430', border: '1px solid #78350f', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>💬 Richieste di Modifica del Cliente ({d.richiesteModifica.length}):</span>
                            </div>
                            {d.richiesteModifica.map(rm => (
                              <div key={rm.id} style={{ fontSize: 11, background: 'var(--card)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>«{rm.commento}»</div>
                                  <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>
                                    Inviato da {rm.cliente?.nome || 'Cliente'} il {new Date(rm.creatoAt).toLocaleString('it-IT')}
                                    {rm.rispostaStudio && <span style={{ color: '#60a5fa' }}> · Risposta studio: {rm.rispostaStudio}</span>}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  {rm.stato === 'aperta' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRisolviRichiesta(rm.id)}
                                      style={{ background: '#059669', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 6, fontSize: 9.5, fontWeight: 700, cursor: 'pointer' }}
                                    >
                                      ✓ Segna Risolta
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: 9.5, color: '#10b981', fontWeight: 700 }}>✓ Risolta</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Barra Azioni Operatore */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          {/* Pulsante Pubblica al Cliente */}
                          {(st === 'bozza' || st === 'in_revisione') && (
                            <button
                              type="button"
                              onClick={() => handlePubblicaDocumento(d.id)}
                              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              title="Pubblica questo documento nel portale cliente per consentirne la visione e la firma"
                            >
                              🚀 Pubblica al Cliente
                            </button>
                          )}

                          {/* Pulsante Rimetti in Bozza */}
                          {st === 'pubblicato' && (
                            <button
                              type="button"
                              onClick={() => handleRimettiInBozza(d.id)}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}
                              title="Nascondi temporaneamente al cliente per modifiche interne"
                            >
                              🔒 Rimetti in Bozza
                            </button>
                          )}

                          {/* Pulsante Carica Nuova Versione — §WF-DOC: non su un atto firmato.
                              Il server rifiuta comunque la richiesta (409), qui evitiamo di
                              offrire un comando che non può funzionare. */}
                          {st !== 'firmato' && (
                            <button
                              type="button"
                              onClick={() => {
                                setVersionTargetDocId(d.id);
                                versionInputRef.current?.click();
                              }}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              title="Carica una versione aggiornata (es. v2) mantenendo lo storico"
                            >
                              📤 Carica Nuova Versione (v{(d.versione || 1) + 1})
                            </button>
                          )}

                          {d.fileUrl && (
                            <>
                              <button
                                type="button"
                                onClick={() => scaricaDocumentoClient(d.fileUrl, d.nome)}
                                style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
                                title="Scarica in formato PDF A4"
                              >
                                📥 PDF
                              </button>
                              <button
                                type="button"
                                onClick={() => scaricaDocumentoWordClient(d.fileUrl, d.nome)}
                                style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}
                                title="Scarica in formato Microsoft Word (.doc)"
                              >
                                📝 Word
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedDocPreview(d)}
                            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            👁 Visualizza
                          </button>

                          {/* Eliminazione — §WF-DOC: un atto firmato non si cancella.
                              Sparirebbe il file e al cliente resterebbe una firma orfana. */}
                          {st !== 'firmato' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(`Sei sicuro di voler eliminare il documento "${d.nome}"?`)) {
                                  if (effProgettoId && !d.id.startsWith('d-')) {
                                    try {
                                      await eliminaDocumentoApi(d.id);
                                    } catch (err: any) {
                                      // Prima l'errore finiva nella console e il documento
                                      // veniva togliato dall'elenco locale comunque: sul
                                      // database restava, e alla riapertura della micro-voce
                                      // ricompariva. Se il server non l'ha cancellato,
                                      // l'operatore deve saperlo adesso.
                                      console.error('Eliminazione documento non riuscita:', err);
                                      alert(
                                        `Eliminazione non riuscita: ${err?.message || 'errore imprevisto'}.\n` +
                                        'Il documento è ancora archiviato sul server e resta visibile.'
                                      );
                                      return;
                                    }
                                  }
                                  const nextDocs = documents.filter(doc => doc.id !== d.id);
                                  persistDocuments(nextDocs);
                                }
                              }}
                              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--red)', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                            >
                              🗑 Elimina
                            </button>
                          )}

                          {/* §WF-DOC — stato terminale: il documento è sottoscritto dal cliente.
                              Restano solo lettura e download; per rilavorarlo serve lo sblocco
                              dell'admin dello studio, che ne registra la motivazione. */}
                          {st === 'firmato' && (
                            isAdminStudio() ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSbloccaDocumento(d.id, d.nome)}
                                  style={{ background: '#3f1d1d', border: '1px solid #b91c1c', color: '#fca5a5', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                  title="Riapri in bozza questo documento firmato: la motivazione viene registrata nell'audit e il cliente ne viene informato"
                                >
                                  🔓 Sblocca per modifiche (admin)
                                </button>
                                {/* Punto 3 piano gap — alternativa alla cancellazione vietata:
                                    l'admin toglie il documento firmato dalle liste operative,
                                    file e sigillo restano conservati nello storico. */}
                                {effProgettoId && !d.id.startsWith('d-') && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!confirm(
                                        `Il documento "${d.nome}" è firmato dal cliente: non può essere eliminato.\n` +
                                        'Vuoi archiviarlo? Scomparirà dalle liste operative ma il file e la firma restano conservati nello storico.'
                                      )) return;
                                      try {
                                        await archiviaDocumentoApi(d.id);
                                        const nextDocs = documents.filter(doc => doc.id !== d.id);
                                        persistDocuments(nextDocs);
                                      } catch (err: any) {
                                        console.error('Archiviazione documento non riuscita:', err);
                                        alert(
                                          `Archiviazione non riuscita: ${err?.message || 'errore imprevisto'}.\n` +
                                          'Il documento è ancora presente sul server.'
                                        );
                                      }
                                    }}
                                    style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                    title="Nascondi questo documento firmato dalle liste operative: il file e la firma restano conservati nello storico"
                                  >
                                    🗄 Archivia
                                  </button>
                                )}
                              </>
                            ) : (
                              <span
                                style={{ fontSize: 10.5, color: 'var(--muted)', fontStyle: 'italic', padding: '5px 8px' }}
                                title="Solo l'amministratore dello studio può riaprire un documento firmato"
                              >
                                🔒 Bloccato dalla firma del cliente — sblocco riservato all'admin
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Caricamento Documento Reale dal Disco → DB */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                📎 Carica Nuovo Documento dal Computer nel Fascicolo Progetto:
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                💡 Il documento viene salvato in <strong>Bozza Interna</strong>: sarai tu a cliccare <strong>"🚀 Pubblica al Cliente"</strong> quando è pronto per la firma.
              </div>
              {!effProgettoId && (
                <div style={{ fontSize: 10.5, color: '#f59e0b', background: '#2d1a0530', border: '1px solid #78350f', borderRadius: 6, padding: '6px 10px' }}>
                  ⚠️ Progetto non ancora a database: il documento verrà salvato solo localmente e non sarà visibile al cliente.
                </div>
              )}
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: uploadingDoc ? 'not-allowed' : 'pointer',
                  background: 'var(--card)', border: '1.5px dashed var(--border)', borderRadius: 8, padding: '10px 14px',
                  opacity: uploadingDoc ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 20 }}>📁</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {uploadingDoc ? '⏳ Caricamento in corso...' : 'Clicca per selezionare un file (PDF, DOCX, JPG, PNG…)'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls,.txt,.p7m,.xml"
                  style={{ display: 'none' }}
                  disabled={uploadingDoc}
                  onChange={handleFileUploadPassaggio}
                />
              </label>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Nessun documento viene imposto automaticamente. Utilizza il pre-screening guidato per associare modelli quando necessario.
          </span>
          <button onClick={onClose} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Chiudi
          </button>
        </div>

        {/* Modale Catalogo Completo 30 Modelli Studio */}
        {showCatalogModal && (
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
        )}

        {/* Modale Configurazione Metodo Firma & Pubblicazione Atto */}
        {configFirmaModal && configFirmaModal.open && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000, padding: 16 }}>
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.8)' }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>✍️</span> Configurazione Documento & Metodo di Firma
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Definisci se questo atto richiede la firma del cliente e con quale modalità legale.
                  </div>
                </div>
                <button type="button" onClick={() => setConfigFirmaModal(null)} style={closeBtnStyle}>✕</button>
              </div>

              {/* Body */}
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Titolo Atto */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                    📄 Titolo / Nome Documento:
                  </label>
                  <input
                    type="text"
                    value={configFirmaModal.titolo}
                    onChange={(e) => setConfigFirmaModal({ ...configFirmaModal, titolo: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12, outline: 'none' }}
                  />
                </div>

                {/* Scelta Richiede Firma */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                    🔒 Obbligo di Firma del Cliente:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, richiedeFirma: true })}
                      style={{
                        background: configFirmaModal.richiedeFirma ? '#1e1b4b' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.richiedeFirma ? 'var(--indigo)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.richiedeFirma ? '#a5b4fc' : 'var(--text)' }}>
                        ✍️ Richiede Firma
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Il cliente deve apporre la firma prima di considerare l'atto completato.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, richiedeFirma: false })}
                      style={{
                        background: !configFirmaModal.richiedeFirma ? '#1e1b4b' : 'var(--card)',
                        border: `1.5px solid ${!configFirmaModal.richiedeFirma ? 'var(--indigo)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: !configFirmaModal.richiedeFirma ? '#a5b4fc' : 'var(--text)' }}>
                        📄 Sola Consultazione
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Atto informativo, verbale o visura depositata (non richiede firma).
                      </div>
                    </button>
                  </div>
                </div>

                {/* Metodi di Firma Ammessi (visibile solo se richiede firma) */}
                {configFirmaModal.richiedeFirma && (
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                      🖊️ Seleziona il Metodo di Firma Ammesso per il Cliente:
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        {
                          id: 'fea_otp' as const,
                          icon: '📱',
                          titolo: 'Firma Elettronica Semplice (OTP + Pad grafometrico)',
                          desc: 'Codice OTP via SMS/Email/WhatsApp + Firma Grafometrica ai sensi dell\'art. 20 del CAD. Istantanea e guidata.',
                          tag: 'CONSIGLIATO',
                          tagColor: '#34d399',
                        },
                        {
                          id: 'manuale_scansionata' as const,
                          icon: '🖊️',
                          titolo: 'Firma Olografa Tradizionale (Scarica, Firma e Ricarica)',
                          desc: 'Il cliente scarica il PDF generato, lo stampa, lo firma a penna e ricarica la scansione o foto nel portale.',
                          tag: 'TRADIZIONALE',
                          tagColor: '#94a3b8',
                        },
                        {
                          id: 'qualificata_esterna' as const,
                          icon: '🔐',
                          titolo: 'Firma Digitale Qualificata (QES / Token SmartCard / SPID)',
                          desc: 'Il cliente appone la propria firma qualificata tramite dispositivo personale (Aruba, InfoCert, Namirial, SPID) e carica il file .p7m.',
                          tag: 'ALTA SICUREZZA',
                          tagColor: '#818cf8',
                        },
                        {
                          id: 'tutte' as const,
                          icon: '🌐',
                          titolo: 'Tutte le modalità abilitate (Scelta libera del Cliente)',
                          desc: 'Il cliente potrà scegliere in autonomia la modalità di sottoscrizione preferita direttamente dal Portale.',
                          tag: 'FLESSIBILE',
                          tagColor: '#f59e0b',
                        },
                      ].map((m) => (
                        <div
                          key={m.id}
                          onClick={() => setConfigFirmaModal({ ...configFirmaModal, metodoFirma: m.id })}
                          style={{
                            background: configFirmaModal.metodoFirma === m.id ? '#1e1b4b' : 'var(--card)',
                            border: `1.5px solid ${configFirmaModal.metodoFirma === m.id ? 'var(--indigo)' : 'var(--border)'}`,
                            borderRadius: 10, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{m.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.metodoFirma === m.id ? '#c7d2fe' : 'var(--text)' }}>
                                {m.titolo}
                              </span>
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: '#00000040', color: m.tagColor, border: `1px solid ${m.tagColor}40` }}>
                                {m.tag}
                              </span>
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.35 }}>
                              {m.desc}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Visibilità Iniziale Workflow */}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
                    🚀 Visibilità Iniziale nel Portale Cliente:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, statoDoc: 'bozza' })}
                      style={{
                        background: configFirmaModal.statoDoc === 'bozza' ? '#2d1a05' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.statoDoc === 'bozza' ? '#f59e0b' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.statoDoc === 'bozza' ? '#fcd34d' : 'var(--text)' }}>
                        🔒 Bozza Interna
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Salvato per revisione interna studio. Cliccherai "Pubblica" quando pronto.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfigFirmaModal({ ...configFirmaModal, statoDoc: 'pubblicato' })}
                      style={{
                        background: configFirmaModal.statoDoc === 'pubblicato' ? '#064e3b' : 'var(--card)',
                        border: `1.5px solid ${configFirmaModal.statoDoc === 'pubblicato' ? '#10b981' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: configFirmaModal.statoDoc === 'pubblicato' ? '#6ee7b7' : 'var(--text)' }}>
                        🚀 Pubblica Subito
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
                        Subito visibile al cliente nel portale con notifica automatica.
                      </div>
                    </button>
                  </div>
                </div>

                {/* Data Scadenza Opzionale */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                    📅 Scadenza / Termine Firma (Opzionale):
                  </label>
                  <input
                    type="date"
                    value={configFirmaModal.dataScadenzaDoc || ''}
                    onChange={(e) => setConfigFirmaModal({ ...configFirmaModal, dataScadenzaDoc: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 11.5 }}
                  />
                </div>
              </div>

              {/* Footer Modal */}
              <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setConfigFirmaModal(null)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => eseguiSalvataggioConfigurato()}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  ✓ Salva e Collega Atto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Anteprima Documento & Download al massimo livello zIndex */}
      {selectedDocPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 880, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,.8)' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>📄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{selectedDocPreview.nome}</h3>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Versione {selectedDocPreview.versione || 1} · Caricato il {selectedDocPreview.dataCaricamento} · Stato: <strong>{selectedDocPreview.statoDoc === 'pubblicato' ? 'Pubblicato' : 'Bozza'}</strong>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedDocPreview(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Viewer iframe o messaggio */}
            <div style={{ flex: 1, overflow: 'hidden', padding: 16, background: '#0f172a', display: 'flex', justifyContent: 'center', minHeight: 460 }}>
              {(() => {
                const url = urlFileArchivio(selectedDocPreview.fileUrl);
                if (!url) {
                  return (
                    <div style={{ alignSelf: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      Nessun file fisico collegato o documento generato localmente.
                    </div>
                  );
                }
                return (
                  <iframe
                    src={url}
                    title={selectedDocPreview.nome}
                    style={{ width: '100%', height: '100%', minHeight: 460, border: 'none', borderRadius: 8, background: '#ffffff' }}
                  />
                );
              })()}
            </div>

            {/* Footer Azioni */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedDocPreview.fileUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => scaricaDocumentoClient(selectedDocPreview.fileUrl, selectedDocPreview.nome)}
                      style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      📥 Scarica PDF A4
                    </button>
                    <button
                      type="button"
                      onClick={() => scaricaDocumentoWordClient(selectedDocPreview.fileUrl, selectedDocPreview.nome)}
                      style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      📝 Scarica Word (.doc)
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedDocPreview(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--sidebar)', border: '1px solid var(--border)',
  borderRadius: 14, width: '100%', maxWidth: 640,
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 40px rgba(0,0,0,.6)',
};

const headStyle: React.CSSProperties = {
  padding: '16px 20px 0', borderBottom: 'none', background: 'var(--card)',
  borderTopLeftRadius: 14, borderTopRightRadius: 14,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--muted)',
  fontSize: 16, cursor: 'pointer', padding: '2px 6px',
};

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--indigo)' : '2px solid transparent',
    color: active ? 'var(--indigo-l)' : 'var(--muted)',
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', transition: 'all .15s',
  };
}
