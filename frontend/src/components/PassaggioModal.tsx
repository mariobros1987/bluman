import React, { useState, useEffect, useRef } from 'react';
import type { DocumentTemplate } from '../utils/documentTemplates';
import {
  salvaDocumentoApi,
  generaDocumentoApi,
  listaDocumentiProgetto,
  aggiornaStatoDocumentoApi,
  nuovaVersioneDocumentoApi,
  aggiornaRichiestaModificaDocumentoApi,
  sbloccaDocumentoApi,
  scaricaDocumentoClient,
  scaricaDocumentoWordClient,
  urlFileArchivio,
} from '../api/client';
import type { Progetto, Passaggio } from '../types';
import { ALL_STUDIO_TEMPLATES, getSmartDocumentRecommendation } from './passaggio/catalogoModelliStudio';
import { getDefaultPassaggi } from './passaggio/passaggioUtils';
import type { ConfigFirmaModalState, DocumentoEntry, NoteEntry } from './passaggio/types';
import { TabPassaggi } from './passaggio/TabPassaggi';
import { TabNote } from './passaggio/TabNote';
import { TabDocumenti } from './passaggio/TabDocumenti';
import { ModaleCatalogo } from './passaggio/ModaleCatalogo';
import { ModaleConfigFirma } from './passaggio/ModaleConfigFirma';
import { closeBtnStyle } from './passaggio/passaggioStyles';

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
  const [configFirmaModal, setConfigFirmaModal] = useState<ConfigFirmaModalState | null>(null);

  // Apertura modale configurazione firma per Template
  const apriConfigFirmaTemplate = (tmpl: DocumentTemplate, stepId?: string) => {
    // Piano firma §3 — il template porta il livello legale che lo studio gli ha etichettato;
    // l'operatore lo vede nel selettore e può cambiarlo prima di salvare. Default 'ses'.
    const livelloTemplate = (tmpl as any).livelloFirmaRichiesto as 'ses' | 'fea' | 'feq' | undefined;
    setConfigFirmaModal({
      open: true,
      tmpl,
      stepId,
      titolo: `${tmpl.titolo} — ${project.cl}.pdf`,
      richiedeFirma: true,
      livelloFirmaRichiesto: livelloTemplate === 'fea' || livelloTemplate === 'feq' ? livelloTemplate : 'ses',
      metodoFirma: 'fea_otp',
      statoDoc: 'bozza',
      dataScadenzaDoc: '',
    });
  };

  // Esecuzione del salvataggio documento con metodo firma configurato
  const eseguiSalvataggioConfigurato = async () => {
    if (!configFirmaModal) return;
    const { tmpl, file, fileBase64, stepId, titolo, richiedeFirma, livelloFirmaRichiesto, metodoFirma, statoDoc, dataScadenzaDoc } = configFirmaModal;

    const rawFilename = titolo.trim() || (tmpl ? `${tmpl.titolo} — ${project.cl}.pdf` : file?.name || 'Documento.pdf');
    const formattedName = tmpl ? rawFilename.replace(/\.docx?$/i, '.pdf') : rawFilename;

    // §21 — l'archiviazione a DB non è un dettaglio opzionale: è l'operazione che
    // l'operatore sta chiedendo. Prima un errore dell'API (file più grande di quanto il
    // server accettasse, sessione scaduta, API non raggiungibile) veniva ingoiato e il
    // flusso proseguiva creando una voce locale senza nessun file dietro: l'anteprima
    // mostrava «Nessun file fisico collegato» e il portale cliente restava vuoto.
    // Ora il flusso si ferma al primo errore mostrando il motivo riferito dal backend.
    if (!effProgettoId) {
      alert('❌ Archiviazione non riuscita: il fascicolo non ha un ID di database.\nRiapri la pratica e riprova; se succede di nuovo verifica la connessione alle API.');
      return;
    }
    if (!tmpl && !fileBase64) {
      alert('❌ Nessun file da archiviare: scegli un documento dal disco oppure un modello dello studio.');
      return;
    }

    let dbId: string | undefined;
    let savedFileUrl: string | undefined;

    try {
      if (tmpl && !fileBase64) {
        // §Punto-1 — generazione server-side: lo stesso merge produce PDF (master, sigillo
        // legale) e Word (.docx, copia per firma autografa). Il template viaggia con i
        // placeholder {{...}} irrisolti: la risoluzione avviene sul server dai dati
        // autorevoli di DB (tenant, cliente, progetto), non dallo snapshot localStorage.
        // `DocumentTemplate` dichiara `contenutoHtml`: `tmpl.html` non esiste.
        const rawHtml = tmpl.contenutoHtml || '';
        const salvato = await generaDocumentoApi({
          progettoId: effProgettoId,
          microvoceProgettoId: effMicrovoceId,
          contenutoHtml: rawHtml || `<p>${formattedName.replace(/\.pdf$/i, '')}</p>`,
          titolo: formattedName.replace(/\.pdf$/i, ''),
          categoriaDoc: tmpl.categoria || 'Allegati Microvoce',
          statoDoc,
          dataScadenzaDoc: dataScadenzaDoc || undefined,
          // Piano firma §3 — il livello scelto nel selettore viaggia fino al documento:
          // il server lo fa rispettare al momento della firma (409 onesto su OTP se fea/feq).
          livelloFirmaRichiesto,
        });
        dbId = salvato.id;
        savedFileUrl = salvato.fileUrl;
      } else {
        // Upload manuale di un file dell'operatore: resta nel formato originale (allegato),
        // senza doppio formato generato.
        const salvato = await salvaDocumentoApi({
          progettoId: effProgettoId,
          microvoceProgettoId: effMicrovoceId,
          filename: formattedName,
          contentBase64: fileBase64 || '',
          categoriaDoc: tmpl?.categoria || 'Allegati Microvoce',
          statoDoc,
          dataScadenzaDoc: dataScadenzaDoc || undefined,
          tipo: richiedeFirma ? 'allegato' : 'compilato',
          // Piano firma §3 — vale anche per gli allegati caricati a mano: il livello scelto
          // dal config diventa vincolo del documento, non una speranza del frontend.
          livelloFirmaRichiesto,
        });
        dbId = salvato.id;
        savedFileUrl = salvato.fileUrl;
      }
    } catch (err: any) {
      // §21 — nessun documento fantasma: la finestra di configurazione resta aperta e
      // l'operatore può riprovare subito (per esempio con un file più piccolo).
      alert(`❌ Archiviazione del documento non riuscita:\n${err?.message ?? 'Errore sconosciuto'}\n\nIl documento NON è stato collegato al fascicolo.`);
      return;
    }

    const newDoc: DocumentoEntry = {
      id: dbId || (tmpl ? `d-${tmpl.id}-${Date.now()}` : `d-${Date.now()}`),
      nome: formattedName,
      dimensione: file ? `${Math.round(file.size / 1024)} KB` : '56 KB',
      richiedeFirma,
      livelloFirmaRichiesto,
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
          // Piano firma §3 — il passaggio ricorda il livello richiesto dall'atto collegato,
          // così la checklist lo mostra e il salvataggio del progetto lo riporta a DB.
          livelloFirmaRichiesto,
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
            fileUrl: d.fileFirmatoUrl || d.filePdfUrl || d.fileUrl,
            filePdfUrl: d.fileFirmatoUrl || d.filePdfUrl || null,
            fileDocxUrl: d.fileDocxUrl ?? null,
            fileFirmatoUrl: d.fileFirmatoUrl ?? null,
            fileBozzaUrl: d.fileBozzaUrl ?? d.fileUrl ?? null,
            // Piano firma §3 — livello richiesto dall'atto, normalizzato (stringa ignota ⇒ 'ses').
            livelloFirmaRichiesto: d.livelloFirmaRichiesto === 'fea' || d.livelloFirmaRichiesto === 'feq' ? d.livelloFirmaRichiesto : 'ses',
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
        fileUrl: d.fileFirmatoUrl || d.filePdfUrl || d.fileUrl,
        filePdfUrl: d.fileFirmatoUrl || d.filePdfUrl || null,
        fileDocxUrl: d.fileDocxUrl ?? null,
        fileFirmatoUrl: d.fileFirmatoUrl ?? null,
        fileBozzaUrl: d.fileBozzaUrl ?? d.fileUrl ?? null,
        livelloFirmaRichiesto: d.livelloFirmaRichiesto === 'fea' || d.livelloFirmaRichiesto === 'feq' ? d.livelloFirmaRichiesto : 'ses',
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

      // §Punto-1 — i documenti da template non ancora salvati a DB vengono generati sul
      // server (PDF master + Word) dallo stesso merge dati, invece del PDF jsPDF
      // client-side. Il template viaggia con i placeholder {{...}} irrisolti: la
      // risoluzione avviene sul server dai dati autorevoli di DB.
      const generaEPubblicaDaTemplate = async (progettoId: string) => {
        const tmpl = localDoc?.templateId ? ALL_STUDIO_TEMPLATES.find(t => t.id === localDoc.templateId) : null;
        const rawHtml = tmpl?.contenutoHtml || '';
        const rawName = localDoc?.nome || 'Documento.pdf';
        const titolo = rawName.replace(/\.(pdf|docx?)$/i, '');
        await generaDocumentoApi({
          progettoId,
          microvoceProgettoId: microvoceDbId,
          contenutoHtml: rawHtml || `<p>${titolo}</p>`,
          titolo,
          categoriaDoc: tmpl?.categoria || 'Allegati Microvoce',
          statoDoc: 'pubblicato',
          // Piano firma §3 — il livello scelto nel configuratore viaggia anche quando il
          // documento viene (ri)generato dal server al momento della pubblicazione.
          livelloFirmaRichiesto: localDoc?.livelloFirmaRichiesto ?? 'ses',
        });
      };

      if (isLocalId && effProgettoId) {
        await generaEPubblicaDaTemplate(effProgettoId);
      } else {
        try {
          await aggiornaStatoDocumentoApi(docId, 'pubblicato');
        } catch (err: any) {
          if (effProgettoId) {
            // Se fallisce l'aggiornamento (es. documento orfano nel client), salvalo direttamente a DB
            await generaEPubblicaDaTemplate(effProgettoId);
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

    // §21 — stesso tetto dello scanner di sicurezza lato server (§28): oltre 30 MB il
    // file verrebbe comunque rifiutato, meglio non spedire ~40 MB di base64 inutilmente.
    if (file.size > 30 * 1024 * 1024) {
      alert(`❌ "${file.name}" supera il limite massimo di 30 MB per i documenti del fascicolo.`);
      return;
    }

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

    // §21 — lo scanner di sicurezza lato server rifiuta i file oltre 30 MB (§28):
    // respingerli qui evita di codificare e spedire inutilmente ~40 MB di base64
    // che il server scarterebbe comunque.
    if (file.size > 30 * 1024 * 1024) {
      alert(`❌ "${file.name}" supera il limite massimo di 30 MB per i documenti del fascicolo.`);
      return;
    }

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
        livelloFirmaRichiesto: 'ses',
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
          <TabPassaggi
            view={view}
            setView={setView}
            visible={visible}
            project={project}
            recommendation={recommendation}
            toggleDone={toggleDone}
            handleDeleteStep={handleDeleteStep}
            setShowAddStepModal={setShowAddStepModal}
            setPreviewFormValues={setPreviewFormValues}
            setPreviewFormModalStep={setPreviewFormModalStep}
            setSelectedDocPreview={setSelectedDocPreview}
            handleUnlinkStepDoc={handleUnlinkStepDoc}
            apriConfigFirmaTemplate={apriConfigFirmaTemplate}
            setShowCatalogModal={setShowCatalogModal}
          />
        )}

        {/* Body TAB 2: Note Operatore */}
        {activeTab === 'note' && (
          <TabNote
            handleAddNote={handleAddNote}
            newNote={newNote}
            setNewNote={setNewNote}
            notes={notes}
          />
        )}

        {/* Body TAB 3: Documenti & Pre-screening AI */}
        {activeTab === 'documenti' && (
          <TabDocumenti
            recommendation={recommendation}
            setShowCatalogModal={setShowCatalogModal}
            handleApplyTemplate={handleApplyTemplate}
            versionInputRef={versionInputRef}
            handleFileNuovaVersione={handleFileNuovaVersione}
            documents={documents}
            setSelectedDocPreview={setSelectedDocPreview}
            handleRisolviRichiesta={handleRisolviRichiesta}
            handlePubblicaDocumento={handlePubblicaDocumento}
            handleRimettiInBozza={handleRimettiInBozza}
            setVersionTargetDocId={setVersionTargetDocId}
            persistDocuments={persistDocuments}
            effProgettoId={effProgettoId}
            handleSbloccaDocumento={handleSbloccaDocumento}
            uploadingDoc={uploadingDoc}
            handleFileUploadPassaggio={handleFileUploadPassaggio}
          />
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
          <ModaleCatalogo
            voce={voce}
            setShowCatalogModal={setShowCatalogModal}
            selectedCatalogCategory={selectedCatalogCategory}
            setSelectedCatalogCategory={setSelectedCatalogCategory}
            filteredCatalog={filteredCatalog}
            handleApplyTemplate={handleApplyTemplate}
          />
        )}

{/* Modale Configurazione Metodo Firma & Pubblicazione Atto */}
        {configFirmaModal && configFirmaModal.open && (
          <ModaleConfigFirma
            configFirmaModal={configFirmaModal}
            setConfigFirmaModal={setConfigFirmaModal}
            eseguiSalvataggioConfigurato={eseguiSalvataggioConfigurato}
          />
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
            <div style={{ flex: 1, overflow: 'hidden', padding: 16, background: 'var(--surface-2)', display: 'flex', justifyContent: 'center', minHeight: 460 }}>
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
                      onClick={() => scaricaDocumentoClient(selectedDocPreview.fileFirmatoUrl || selectedDocPreview.filePdfUrl || selectedDocPreview.fileUrl, selectedDocPreview.nome)}
                      style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--green)', color: 'var(--green)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {selectedDocPreview.firmato ? '📥 Scarica PDF Firmato' : '📥 Scarica PDF A4'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (selectedDocPreview.fileDocxUrl
                        ? scaricaDocumentoClient(selectedDocPreview.fileDocxUrl, selectedDocPreview.nome.replace(/\.(pdf|docx?)$/i, '') + '.docx')
                        : scaricaDocumentoWordClient(selectedDocPreview.fileUrl, selectedDocPreview.nome))}
                      style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-l)', color: 'var(--pill-blue-fg)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
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

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--indigo)' : '2px solid transparent',
    color: active ? 'var(--indigo-l)' : 'var(--muted)',
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', transition: 'all .15s',
  };
}
