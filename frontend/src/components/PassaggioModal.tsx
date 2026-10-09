import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from './ui/ToastProvider';
import { confirm } from './ui/ConfirmProvider';
import type { DocumentTemplate } from '../utils/documentTemplates';
import { nomeFileLeggibile } from '../utils';
import { haAccessoComunicazioni } from '../utils/comunicazioniAccesso';
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
import type { Progetto, Passaggio, Cliente } from '../types';
import { fetchComunicazioniMicrovoceApi, type MessaggioDiMicrovoce } from '../api/progetti';
import type { CanaleInvio } from '../hooks/useInvioComunicazione';
import { ALL_STUDIO_TEMPLATES, getSmartDocumentRecommendation } from './passaggio/catalogoModelliStudio';
import { getDefaultPassaggi } from './passaggio/passaggioUtils';
import type { ConfigFirmaModalState, DocumentoEntry, NoteEntry } from './passaggio/types';
import { TabPassaggi } from './passaggio/TabPassaggi';
import { TabNote } from './passaggio/TabNote';
import { TabDocumenti } from './passaggio/TabDocumenti';
import { TabMessaggi } from './passaggio/TabMessaggi';
import { ComposerMicrovoce } from './passaggio/ComposerMicrovoce';
import { ModaleCatalogo } from './passaggio/ModaleCatalogo';
import { ModaleConfigFirma } from './passaggio/ModaleConfigFirma';
import { ModaleNuovaAzione } from './passaggio/ModaleNuovaAzione';
import { ModaleFormPassaggio } from './passaggio/ModaleFormPassaggio';
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
  /**
   * Porta alla chat della pratica. Lo fornisce `ProjectDetail`, che è l'unico a sapere che la
   * chat è una scheda della pagina: il modale si limita a chiudersi e a chiedere il cambio.
   */
  onApriInChat?: () => void;
  /**
   * L'anagrafica del cliente della pratica, per i recapiti del compositore.
   *
   * Il modale non la cerca da sé: `ProjectDetail` ce l'ha già in memoria per la scheda
   * Comunicazioni, e una seconda lettura qui darebbe due pareri diversi sullo stesso cliente — con
   * il canale disponibile in una vista e non nell'altra.
   */
  cliente?: Cliente | null;
}

/**
 * I canali che possono essere il «canale dell'ultimo messaggio» di una voce.
 *
 * Serve a riconoscere un `canale` che arriva dal database invece di fidarsi: la colonna è una
 * stringa libera, e un valore che non è un canale non deve finire nel selettore del compositore.
 */
const CANALI_ULTIMO_MESSAGGIO: CanaleInvio[] = ['email', 'whatsapp', 'telegram', 'signal', 'portal'];

export function PassaggioModal({ project, mid, vidx, onClose, onSaveVoce, progettoDbId, microvoceDbId, onApriInChat, cliente }: PassaggioModalProps) {
  const toast = useToast();
  const effProgettoId = progettoDbId || (project as any)?.dbId || (project as any)?.id;
  const mod = project.mods.find(m => m.id === mid)!;
  const voce = mod.v[vidx];
  const effMicrovoceId = microvoceDbId || (voce as any)?.dbId;
  const [view, setView] = useState<'operatore' | 'cliente'>('operatore');
  const [activeTab, setActiveTab] = useState<'passaggi' | 'note' | 'documenti' | 'messaggi'>('passaggi');
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

  // Le due schede della checklist. Erano state cancellate per sbaglio dal commit `8b1d9e21`,
  // che portò via stato, handler e JSX lasciando i pulsanti a chiamare setter che nessuno
  // leggeva: da fuori, «il pulsante non fa niente». I modali sono tornati come componenti di
  // modulo (`passaggio/ModaleNuovaAzione`, `passaggio/ModaleFormPassaggio`), con lo stato qui —
  // la stessa forma di `showCatalogModal` e `configFirmaModal` qui sotto.
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [previewFormModalStep, setPreviewFormModalStep] = useState<Passaggio | null>(null);

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

  const handleDeleteStep = async (id: string) => {
    if (!(await confirm({ messaggio: 'Sei sicuro di voler eliminare questo passaggio dalla checklist?', confermaLabel: 'Elimina', pericolo: true }))) return;
    const nextSteps = steps.filter(s => s.id !== id);
    setSteps(nextSteps);
    voce.proc = nextSteps;
    if (onSaveVoce) {
      onSaveVoce(nextSteps, notes, documents.length);
    }
  };

  /**
   * Il passaggio nuovo in fondo alla checklist, con le stesse regole dei passaggi che ci sono già.
   *
   * L'`id` comincia per `p-` di proposito: la rotta di salvataggio (`src/routes/progetti.ts`)
   * riconosce proprio quel prefisso come «identificativo locale, non ancora a database» e crea la
   * riga lasciando che sia il database a dare l'uuid. Un id locale di forma diversa verrebbe
   * scambiato per un id esistente e la riga verrebbe scritta con una chiave inventata dal browser.
   */
  const handleCreateStep = (dati: {
    title: string;
    desc: string;
    type: Passaggio['type'];
    who: Passaggio['who'];
    fields?: string[];
  }) => {
    const nuovo: Passaggio = {
      id: `p-${Date.now()}`,
      title: dati.title,
      desc: dati.desc,
      type: dati.type,
      who: dati.who,
      stato: 'pending',
      fields: dati.fields,
    };
    const nextSteps = [...steps, nuovo];
    setSteps(nextSteps);
    voce.proc = nextSteps;
    if (onSaveVoce) onSaveVoce(nextSteps, notes, documents.length);
    setShowAddStepModal(false);
    toast.successo(`Passaggio «${nuovo.title}» aggiunto alla checklist.`);
  };

  /**
   * Le risposte raccolte sul form, legate al passaggio e salvate per intero.
   *
   * Si sostituisce l'oggetto invece di fondere i campi: la scheda manda **tutte** le caselle che ha
   * disegnato, quindi un campo svuotato dall'operatore deve sparire. Fondere lascerebbe in vita il
   * valore vecchio di una casella che a schermo è vuota — cioè un dato che l'operatore crede di
   * aver cancellato e che invece è ancora nel fascicolo.
   */
  const handleSalvaRisposte = (stepId: string, risposte: Record<string, string>) => {
    const nextSteps = steps.map(s => (s.id === stepId ? { ...s, risposte } : s));
    setSteps(nextSteps);
    voce.proc = nextSteps;
    if (onSaveVoce) onSaveVoce(nextSteps, notes, documents.length);
    setPreviewFormModalStep(null);
    toast.successo('Dati del form salvati sul passaggio.');
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
      toast.errore('Archiviazione non riuscita: il fascicolo non ha un ID di database. Riapri la pratica e riprova; se succede di nuovo verifica la connessione alle API.');
      return;
    }
    if (!tmpl && !fileBase64) {
      toast.attenzione('Nessun file da archiviare: scegli un documento dal disco oppure un modello dello studio.');
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
      toast.errore(`Archiviazione del documento non riuscita: ${err?.message ?? 'Errore sconosciuto'}. Il documento NON è stato collegato al fascicolo.`);
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
    toast.successo(`Documento "${formattedName}" collegato. Richiede firma: ${richiedeFirma ? `Sì (${metodoNome})` : 'No (sola lettura)'} · ${statoDoc === 'pubblicato' ? 'Pubblicato al cliente' : 'Bozza interna'}`);

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
            nome: d.fileUrl ? nomeFileLeggibile(null, d.fileUrl) : `Documento v${d.versione}`,
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

  // I messaggi abbinati a questa micro-voce. Si caricano qui e non dentro la scheda «Messaggi»
  // perché il conteggio va scritto sulla linguetta, e una linguetta che si popola solo quando la
  // apri direbbe «0» a una voce che ha messaggi — cioè direbbe il falso per un momento, che è
  // abbastanza per non fidarsi.
  //
  // `effMicrovoceId` può mancare (una voce mai salvata a database): in quel caso non c'è niente da
  // chiedere, e la scheda resta vuota con la sua spiegazione.
  const [messaggiMicrovoce, setMessaggiMicrovoce] = useState<MessaggioDiMicrovoce[]>([]);
  const [erroreMessaggi, setErroreMessaggi] = useState<string | null>(null);
  const [caricandoMessaggi, setCaricandoMessaggi] = useState(false);
  /** Una lettura è già in volo: la rilettura in sottofondo non ne accoda una seconda. */
  const letturaInCorso = useRef(false);

  // Una funzione sola per il primo caricamento, per la rilettura dopo un invio e per quella in
  // sottofondo: due versioni della stessa lettura darebbero due elenchi aggiornati in modo diverso
  // a seconda di come ci si arriva.
  //
  // `silenzioso` esiste per il giro automatico, e non è una comodità: `caricandoMessaggi` è ciò che
  // la linguetta mostra come «…» al posto del conteggio, quindi un aggiornamento in sottofondo che
  // la toccasse farebbe lampeggiare l'intestazione ogni trenta secondi. Il conteggio si aggiorna
  // quando arrivano i dati, senza che nessuno debba vedere che li sta chiedendo.
  const caricaMessaggi = useCallback(async (opzioni: { silenzioso?: boolean } = {}) => {
    // Senza accesso al modulo Comunicazioni la lettura è 403 (voce 4): non si chiede, così
    // l'operatore non vede un errore di permesso al posto di una linguetta che non gli spetta.
    if (!haAccessoComunicazioni()) {
      setMessaggiMicrovoce([]);
      setErroreMessaggi(null);
      return;
    }
    if (!effMicrovoceId) {
      setMessaggiMicrovoce([]);
      setErroreMessaggi(null);
      return;
    }
    if (opzioni.silenzioso && letturaInCorso.current) return;
    letturaInCorso.current = true;
    if (!opzioni.silenzioso) setCaricandoMessaggi(true);
    try {
      const r = await fetchComunicazioniMicrovoceApi(effMicrovoceId);
      setMessaggiMicrovoce(r.messaggi);
      setErroreMessaggi(null);
    } catch (err) {
      // Il motivo vero e non una lista vuota: una lista vuota direbbe «non ha scritto niente»,
      // che è una cosa diversa da «non sono riuscito a leggerlo» (regola 7).
      setErroreMessaggi(err instanceof Error ? err.message : 'Messaggi della micro-voce non disponibili.');
    } finally {
      letturaInCorso.current = false;
      if (!opzioni.silenzioso) setCaricandoMessaggi(false);
    }
  }, [effMicrovoceId]);

  useEffect(() => { void caricaMessaggi(); }, [caricaMessaggi]);

  /**
   * La rilettura in sottofondo, ogni 30 secondi, finché la scheda è aperta.
   *
   * **Senza, questa scheda mentiva.** I messaggi si leggevano una volta sola, al montaggio: un
   * messaggio che arrivava dal cliente mentre l'operatore aveva la voce aperta non compariva mai, e
   * per vederlo bisognava chiudere la voce e riaprirla — il giro che il titolare ha descritto come
   * «devo andare nella chat generale e poi riaprire il modale». La chat della pratica lo fa già da
   * sempre (`ComunicazioniTab`), ed è per questo che lì il messaggio si vedeva: la scheda della voce
   * era l'unico posto dove i messaggi arrivavano e restavano invisibili.
   *
   * Trenta secondi e non cinque: è **lo stesso intervallo della chat**, scelto con l'audit del
   * 21/09/2026 perché ogni giro è una query su `comunicazione_progetto` e la RLS la rende cara. Un
   * intervallo diverso qui vorrebbe dire due tarature da difendere con lo stesso argomento.
   *
   * Il caso «nessun id a database» non costa niente: `caricaMessaggi` esce prima di chiedere.
   */
  useEffect(() => {
    const interval = setInterval(() => { void caricaMessaggi({ silenzioso: true }); }, 30_000);
    return () => clearInterval(interval);
  }, [caricaMessaggi]);

  /**
   * Su che canale si risponde di solito in questa voce: quello dell'ultimo messaggio che c'è.
   *
   * È un predefinito e non un vincolo, e il ripiego è `portal` — l'unico canale che non contatta
   * nessuno: se la voce è vuota non c'è nessuna abitudine da rispettare, e non si sceglie al posto
   * dell'operatore un canale che spedisce davvero (Meta, un SMTP) solo perché è il primo dell'elenco.
   */
  const canaleUltimoMessaggio = messaggiMicrovoce[messaggiMicrovoce.length - 1]?.canale as CanaleInvio | undefined;
  const canalePredefinito: CanaleInvio = canaleUltimoMessaggio && CANALI_ULTIMO_MESSAGGIO.includes(canaleUltimoMessaggio)
    ? canaleUltimoMessaggio
    : 'portal';

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
      toast.successo('Documento pubblicato al cliente. Ora è visibile nel portale per la firma.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      toast.errore(`Errore pubblicazione: ${err?.message ?? 'Errore sconosciuto'}`);
    }
  };

  // Rimetti documento in bozza interna
  const handleRimettiInBozza = async (docId: string) => {
    if (!(await confirm({ messaggio: 'Vuoi rimettere questo documento in bozza interna? Il cliente non lo vedrà più fino a nuova pubblicazione.', confermaLabel: 'Rimetti in bozza' }))) return;
    try {
      await aggiornaStatoDocumentoApi(docId, 'bozza');
      toast.successo('Documento rimesso in bozza interna.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      toast.errore(`Errore: ${err?.message ?? 'Errore sconosciuto'}`);
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
      toast.attenzione('Questo documento non è ancora archiviato a database: non risulta firmato e non ha bisogno di sblocco.');
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
      toast.attenzione('Motivazione troppo breve: serve una spiegazione di almeno 10 caratteri, perché resta agli atti.');
      return;
    }
    try {
      await sbloccaDocumentoApi(docId, motivo.trim());
      toast.successo('Documento riaperto in bozza interna. Motivazione registrata; il cliente è stato notificato.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      toast.errore(`Sblocco non riuscito: ${err?.message ?? 'Errore sconosciuto'}`);
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
      toast.attenzione(`"${file.name}" supera il limite massimo di 30 MB per i documenti del fascicolo.`);
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

      toast.successo('Nuova versione caricata. Ora è in bozza: controllala e clicca "Pubblica al Cliente" quando è pronta.');
      setVersionTargetDocId(null);
      await ricaricaDocumentiDb();
    } catch (err: any) {
      toast.errore(`Errore caricamento nuova versione: ${err?.message ?? 'Errore sconosciuto'}`);
    } finally {
      setUploadingDoc(false);
    }
  };

  // Risolvi richiesta di modifica del cliente
  const handleRisolviRichiesta = async (rid: string) => {
    const risposta = prompt('Inserisci un commento o nota di riscontro per il cliente (opzionale):') ?? '';
    try {
      await aggiornaRichiestaModificaDocumentoApi(rid, { stato: 'risolta', rispostaStudio: risposta });
      toast.successo('Richiesta di modifica contrassegnata come risolta.');
      await ricaricaDocumentiDb();
    } catch (err: any) {
      toast.errore(`Errore: ${err?.message ?? 'Errore sconosciuto'}`);
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
      toast.attenzione(`"${file.name}" supera il limite massimo di 30 MB per i documenti del fascicolo.`);
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
      toast.errore(`Impossibile leggere il file: ${err?.message ?? 'Errore sconosciuto'}`);
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
            {/* La linguetta compare solo a chi può leggere il fascicolo (voce 4, 09/10/2026):
                il guard server la negherebbe, e una linguetta che apre su un 403 è peggio di
                una linguetta che non c'è. */}
            {haAccessoComunicazioni() && (
              <button
                onClick={() => setActiveTab('messaggi')}
                title="I messaggi scambiati con il cliente che riguardano questa voce"
                style={tabBtnStyle(activeTab === 'messaggi')}
              >
                💬 Messaggi ({caricandoMessaggi ? '…' : messaggiMicrovoce.length})
              </button>
            )}          </div>
        </div>

        {/* Body TAB 1: Passaggi */}
        {activeTab === 'passaggi' && (
          <TabPassaggi
            view={view}
            setView={setView}
            visible={visible}
            recommendation={recommendation}
            toggleDone={toggleDone}
            handleDeleteStep={handleDeleteStep}
            setShowAddStepModal={setShowAddStepModal}
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

        {/* Body TAB 4: Messaggi del cliente su questa micro-voce */}
        {activeTab === 'messaggi' && (
          <TabMessaggi
            messaggi={messaggiMicrovoce}
            errore={erroreMessaggi}
            progettoId={effProgettoId ? String(effProgettoId) : undefined}
            microvoceId={effMicrovoceId ? String(effMicrovoceId) : undefined}
            microvoceNome={voce.n}
            onApriInChat={onApriInChat}
            // Si scrive da qui solo se la voce esiste a database: senza il suo id il messaggio non
            // potrebbe nascere abbinato, e un compositore che scrive senza legare sarebbe la cosa
            // peggiore — l'operatore crederebbe di aver risposto «dentro la voce» e non è vero.
            composer={effProgettoId && effMicrovoceId ? (
              <ComposerMicrovoce
                progettoId={String(effProgettoId)}
                microvoceProgettoId={String(effMicrovoceId)}
                nomeCliente={project.cl}
                cliente={cliente}
                canalePredefinito={canalePredefinito}
                onInviato={() => void caricaMessaggi()}
              />
            ) : null}
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

        {/* Le due schede della checklist, ripristinate: l'azione nuova, e i dati del form. */}
        {showAddStepModal && (
          <ModaleNuovaAzione
            onChiudi={() => setShowAddStepModal(false)}
            onCrea={handleCreateStep}
          />
        )}

        {previewFormModalStep && (
          <ModaleFormPassaggio
            step={previewFormModalStep}
            nomeCliente={project.cl}
            onChiudi={() => setPreviewFormModalStep(null)}
            onSalva={(risposte) => handleSalvaRisposte(previewFormModalStep.id, risposte)}
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
