import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CatBadge } from '../components/ui/CatBadge';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { resolveDocumentTemplateHtml, PREBUILT_TEMPLATES } from '../utils/documentTemplates';
import { getStudioInfoForTenant, getCurrentTenantId, getTenantStorageKey, BLUECODE_TENANT_ID } from '../utils/tenant';
import {
  fetchProgetti,
  fetchClienti,
  fetchComunicazioniApi,
  inviaComunicazioneApi,
  canaliFirmaApi,
  requestPortalOtpApi,
  verifyPortalOtpAndSignApi,
  firmaConFileApi,
  calcolaHashSha256,
  magicLoginApi,
  clientLoginApi,
  cambiaPasswordClienteApi,
  documentiPortaleApi,
  urlFileArchivio,
  scaricaDocumentoClient,
  scaricaDocumentoPortaleApi,
  contattiPortaleApi,
  proposteDatiPortaleApi,
  inviaPropostaDatiApi,
  richiesteAddendumPortaleApi,
  inviaRichiestaAddendumApi,
  fatturePortaleApi,
  richiediModificaDocumentoApi,
  elencoFirmeApi,
  fetchNotificheApi,
  markNotificheReadApi,
  apriStreamNotifiche,
} from '../api/client';
import type {
  CanaleOtp,
  CanaleFirma,
  AmbitoFirma,
  DocumentoPortale,
  ContattiStudio,
  PropostaDatiFiscale,
  RichiestaAddendum,
  FatturaPortale,
  NotificaStreamEvent,
} from '../api/client';
import { tempoRelativo } from '../components/NotificationModal';
import type { CategoriaModulo } from '../types';

/** Notifica destinata al cliente, come la mostra la campanella del portale. */
interface NotificaPortale {
  id: string;
  oggetto: string;
  corpo: string;
  link: string | null;
  tipoEvento: string | null;
  createdAt: string;
  letto: boolean;
}

export interface ModuloPassaggio {
  id: string;
  titolo: string;
  completato: boolean;
  operatore?: string;
  data?: string;
  note?: string;
  documenti?: DocumentoPortale[];
}

export interface ModuloDeliverable {
  id?: string;
  titolo: string;
  nomeFile: string;
  data: string;
  fileUrl?: string | null;
  firmato?: boolean;
  richiedeFirma?: boolean;
  docCompleto?: DocumentoPortale;
}

export interface ModuloProposta {
  id: string;
  nome: string;
  cat: CategoriaModulo;
  prezzo: number;
  ore: number;
  righeCount: number;
  descrizione?: string;
  stato?: 'completato' | 'in_corso' | 'da_firmare' | 'pending';
  operatore?: string;
  percentuale?: number;
  passaggi?: ModuloPassaggio[];
  deliverables?: ModuloDeliverable[];
  richiedeFirmaFinale?: boolean;
}

/**
 * Traduce i moduli REALI del progetto nella forma che il Portale Cliente mostra,
 * associando ad ogni modulo e ad ogni micro-voce i documenti pubblicati a DB.
 */
function mapProjectToPortalModules(project: any, portalDocs: DocumentoPortale[] = []): ModuloProposta[] {
  if (!project) return [];

  const moduli = Array.isArray(project.moduli) ? project.moduli : [];
  if (moduli.length === 0) return [];

  // Avanzamento calcolato dal backend, indicizzato per id modulo
  const avanzamentoModuli = new Map<string, any>(
    (project.avanzamento?.moduli || []).map((m: any) => [String(m.id), m]),
  );

  return moduli.map((m: any): ModuloProposta => {
    const cat = (m.categoria as CategoriaModulo) || 'Societario';
    const av = avanzamentoModuli.get(String(m.id));
    const statoModulo = av?.stato ?? m.stato;
    const isDone = statoModulo === 'done' || statoModulo === 'completed' || statoModulo === 'completato';

    // Micro-voci reali dal database
    const microvoci = Array.isArray(m.microvoci) ? m.microvoci : [];
    const passaggi: ModuloPassaggio[] = microvoci.map((mv: any, mvIdx: number) => {
      const mvId = mv.id || `mv-${mvIdx}`;
      const docsDiQuestaMicrovoce = portalDocs.filter(d => 
        (d.microvoceProgettoId && String(d.microvoceProgettoId) === String(mv.id)) ||
        (d.microvoceNome && d.microvoceNome.trim().toLowerCase() === (mv.nome || '').trim().toLowerCase() && d.modulo === m.nome)
      );

      return {
        id: mvId,
        titolo: mv.nome,
        completato: mv.stato === 'done' || mv.stato === 'completed',
        note: mv.causaNota || undefined,
        operatore: mv.risorsa?.nome || undefined,
        documenti: docsDiQuestaMicrovoce,
      };
    });

    // Documenti pubblicati dallo studio per questo modulo
    const docsDiQuestoModulo = portalDocs.filter(d => 
      (d.moduloProgettoId && String(d.moduloProgettoId) === String(m.id)) ||
      (d.modulo && d.modulo.trim().toLowerCase() === (m.nome || '').trim().toLowerCase()) ||
      microvoci.some((mv: any) => String(mv.id) === String(d.microvoceProgettoId))
    );

    const deliverables: ModuloDeliverable[] = docsDiQuestoModulo.map(d => ({
      id: d.id,
      titolo: d.titolo || d.nome,
      nomeFile: d.nome,
      data: d.caricatoIl ? new Date(d.caricatoIl).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT'),
      fileUrl: d.fileUrl,
      firmato: d.firmato,
      richiedeFirma: d.richiedeFirma,
      docCompleto: d,
    }));

    return {
      id: m.id,
      nome: m.nome,
      cat,
      prezzo: typeof m.prezzo === 'number' && m.prezzo > 0 ? (m.prezzo > 1000 ? m.prezzo / 100 : m.prezzo) : 0,
      ore: m.orePreventivate ?? 0,
      righeCount: passaggi.length,
      descrizione: m.descrizione || undefined,
      stato: isDone ? 'completato' : 'in_corso',
      operatore: microvoci.find((mv: any) => mv.risorsa?.nome)?.risorsa?.nome || undefined,
      percentuale: av?.percentuale ?? 0,
      passaggi,
      deliverables,
      richiedeFirmaFinale: true,
    };
  });
}

type PortalTab = 'proposta' | 'avanzamento' | 'form' | 'documenti' | 'fatture' | 'contatti' | 'profilo';

/**
 * L'atto che il codice OTP sta autorizzando: la lettera d'incarico o un documento del fascicolo.
 * `riferimentoId` è l'id del documento, e finisce nel sigillo a database — senza, una firma non si
 * potrebbe più ricollegare all'atto firmato.
 */
interface BersaglioFirma {
  ambito: AmbitoFirma;
  titolo: string;
  riferimentoId?: string;
}

/**
 * Data e ora nel formato italiano, a partire da quello che manda il backend (ISO).
 * Se il valore non è una data valida si restituisce così com'è: meglio un testo grezzo che un
 * «Invalid Date» al posto della data di una firma.
 */
function dataOraLeggibile(valore: string | null): string {
  if (!valore) return '';
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return valore;
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ClientPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('magic_token') || '';

  // Stati di autenticazione per Portale Cliente (Email + Password e Magic Link)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'credentials' | 'magic'>('credentials');
  const [manualMagicToken, setManualMagicToken] = useState('');

  const [activeTab, setActiveTab] = useState<PortalTab>('proposta');
  const [clientObj, setClientObj] = useState<any>(null);
  const [clientName, setClientName] = useState('Cliente Studio');
  const [clientProjects, setClientProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [moduliProposti, setModuliProposti] = useState<ModuloProposta[]>([]);
  const [selectedModule, setSelectedModule] = useState<ModuloProposta | null>(null);
  const [moduleSignatures, setModuleSignatures] = useState<Record<string, { firmato: boolean; dataFirma: string; signerName: string }>>({});
  // Lo stato di firma NON si inizializza da una chiave cablata: la chiave conteneva il nome di un
  // cliente specifico, quindi un browser in cui quel cliente aveva firmato mostrava "firmato" a
  // qualunque altro cliente. Si risolve in `loadPortalData` sul nome del cliente autenticato.
  const [signed, setSigned] = useState<boolean>(false);

  // Stati Gestione Password Personale Cliente
  const [clientPassCurrent, setClientPassCurrent] = useState('');
  const [clientPassNew, setClientPassNew] = useState('');
  const [clientPassConfirm, setClientPassConfirm] = useState('');
  const [clientPassShow, setClientPassShow] = useState(false);
  const [clientPassLoading, setClientPassLoading] = useState(false);
  const [clientPassMsg, setClientPassMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  // Le richieste di integrazione dell'incarico (§2.5) vivono a database, agganciate al
  // progetto, e lo studio le vede. Prima stavano in `localStorage` sotto una chiave col nome
  // del cliente: invisibili allo studio e perse al cambio dispositivo. Si leggono e si
  // scrivono via API in `loadPortalData` e nella sezione dedicata del contratto firmato.
  const [addendums, setAddendums] = useState<RichiestaAddendum[]>([]);
  const [addendumErrore, setAddendumErrore] = useState<string | null>(null);
  /** Testo libero della nuova richiesta di addendum che il cliente sta scrivendo. */
  const [nuovaRichiestaAddendum, setNuovaRichiestaAddendum] = useState('');
  const [invioAddendum, setInvioAddendum] = useState(false);
  const [addendumMsg, setAddendumMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [accessoNegato, setAccessoNegato] = useState<string | null>(null);

  /**
   * Documenti del fascicolo, letti da `GET /portal/documenti`.
   *
   * Qui c'erano quattro documenti scritti nel codice: un NDA «firmato il 15/08/2026 01:44:12», uno
   * statuto maltese, una dichiarazione UBO e una letter of wishes per un trust. Nessuno esisteva a
   * database, per nessun cliente, e la data di firma del primo era inventata: ogni cliente che
   * apriva il portale vedeva quei quattro atti come se fossero i suoi, con uno già sottoscritto.
   * Ora l'elenco è quello vero e, quando è vuoto, la sezione lo dichiara (§2.1).
   */
  const [portalDocs, setPortalDocs] = useState<DocumentoPortale[]>([]);
  const [portalDocsErrore, setPortalDocsErrore] = useState<string | null>(null);
  const [portalDocsCaricamento, setPortalDocsCaricamento] = useState(false);
  /** Documento del fascicolo per cui il cliente ha scelto un file firmato a mano, da confermare. */
  const [documentoDaCaricare, setDocumentoDaCaricare] = useState<DocumentoPortale | null>(null);
  /**
   * §WF-DOC — id del documento di cui il cliente ha aperto la cronologia delle versioni.
   * Il percorso del documento deve essere sempre ripercorribile all'indietro: da qui si
   * risale dalla versione attuale fino a quella che il cliente aveva eventualmente firmato.
   */
  const [storicoVersioniAperto, setStoricoVersioniAperto] = useState<string | null>(null);

  // Visualizzatore A4 Documento Selezionato per Lettura Completa
  const [selectedViewerDoc, setSelectedViewerDoc] = useState<any | null>(null);

  // §WF-DOC — Richiesta Modifiche Documento dal Portale Cliente
  const [modificaDocTarget, setModificaDocTarget] = useState<DocumentoPortale | null>(null);
  const [modificaDocTesto, setModificaDocTesto] = useState('');
  const [modificaDocInviando, setModificaDocInviando] = useState(false);

  const handleInviaRichiestaModifica = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modificaDocTarget || !modificaDocTesto.trim()) return;
    setModificaDocInviando(true);
    try {
      await richiediModificaDocumentoApi(modificaDocTarget.id, modificaDocTesto.trim(), clientObj?.id);
      alert('✓ La tua richiesta di modifica è stata inviata allo studio. L\'advisor esaminerà le tue note e caricherà la versione aggiornata.');
      setModificaDocTarget(null);
      setModificaDocTesto('');
      await caricaDocumenti(clientObj?.id);
    } catch (err: any) {
      alert(`❌ Errore invio richiesta: ${err?.message ?? 'Errore sconosciuto'}`);
    } finally {
      setModificaDocInviando(false);
    }
  };

  // ── Blocco 3 — CAMPANELLA NOTIFICHE DEL CLIENTE ─────────────────────────────
  // Il backend scrive notifiche destinate al cliente (documento da firmare, pagamento
  // registrato, firma apposta): qui si caricano all'accesso e si aggiornano in tempo
  // reale via stream SSE, così il cliente vede subito quando c'è qualcosa da firmare.
  const [notifichePortale, setNotifichePortale] = useState<NotificaPortale[]>([]);
  const [notifPortaleOpen, setNotifPortaleOpen] = useState(false);

  // ── FIRMA ELETTRONICA SEMPLICE: CANALE, CODICE, MODALITÀ ──────────────────
  //
  // I due valori iniziali che stavano qui erano il cellulare di una persona reale e un
  // indirizzo email inventato: comparivano precompilati nei campi di QUALUNQUE cliente, e
  // il primo era anche la destinazione predefinita del codice di firma. Ora i recapiti
  // arrivano dall'anagrafica via `/portal/canali-firma`, e questi campi restano vuoti:
  // servono solo se il firmatario dichiara un recapito diverso (§1.2).
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCanale, setOtpCanale] = useState<CanaleOtp>('whatsapp');
  const [canaliFirma, setCanaliFirma] = useState<CanaleFirma[]>([]);
  const [botTelegram, setBotTelegram] = useState<string | null>(null);
  const [usaRecapitoDiverso, setUsaRecapitoDiverso] = useState(false);
  const [recapitoDichiarato, setRecapitoDichiarato] = useState('');
  const [otpTarget, setOtpTarget] = useState('');
  const [otpTargetDichiarato, setOtpTargetDichiarato] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  /** Secondi di attesa prima del prossimo reinvio, e reinvii ancora concessi (§1.5). */
  const [otpAttesaReinvio, setOtpAttesaReinvio] = useState(0);
  const [otpReinviiRimanenti, setOtpReinviiRimanenti] = useState<number | null>(null);
  /** Validità residua del codice in corso: dichiarata dal backend, non un 5 scritto a mano. */
  const [otpValiditaSecondi, setOtpValiditaSecondi] = useState(0);
  /** Le tre strade di firma richieste (§1.3). */
  const [modalitaFirma, setModalitaFirma] = useState<'otp' | 'manuale_scansionata' | 'qualificata_esterna'>('otp');
  const [fileFirmato, setFileFirmato] = useState<{ nome: string; base64: string } | null>(null);
  const [caricamentoFirmato, setCaricamentoFirmato] = useState(false);
  /**
   * Pad della firma grafometrica. Si apre DOPO che il codice è stato digitato e prima della
   * chiamata di convalida (§1.11): il disegno viaggia nella stessa richiesta dell'OTP e
   * finisce allegato al sigillo. Da sola la grafometrica non prova nulla — chiunque può
   * tracciare un nome col mouse — quindi non è mai un'alternativa al codice, solo un
   * elemento in più nel verbale.
   */
  const [padGrafometricaAperto, setPadGrafometricaAperto] = useState(false);
  // Stesso motivo del flag `signed`: il sigillo di firma è di un cliente preciso e non va letto da
  // una chiave cablata. Viene caricato in `loadPortalData` per il cliente autenticato.
  const [eidasSeal, setEidasSeal] = useState<any>(null);
  const [successSealModal, setSuccessSealModal] = useState<any | null>(null);

  // Form Cliente State — vuoto per definizione. Qui c'erano ragione sociale, partita IVA, codice
  // fiscale, IBAN e legale rappresentante di un cliente reale come valori iniziali: siccome nulla
  // li sovrascriveva, QUALUNQUE cliente apriva la scheda 3 e trovava i dati di un terzo nei propri
  // campi. Vengono riempiti in `loadPortalData` con la riga del cliente autenticato, se c'è.
  //
  // §2.3: questi sono i valori ATTUALI a database (sola lettura). Le modifiche passano da una
  // proposta che lo studio conferma: il campo non si scrive qui, si invia via
  // `inviaPropostaDatiApi`. `bozzaDati` contiene i valori digitati, `proposteDati` lo stato
  // delle richieste già inviate.
  const [formData, setFormData] = useState({
    ragioneSociale: '',
    piva: '',
    legaleRappresentante: '',
    codiceFiscale: '',
    iban: '',
    titolareEffettivo: '',
    sedeLegale: '',
  });
  const [formSaved, setFormSaved] = useState(false);
  /** Valori digitati dal cliente, campo per campo: diventano proposte solo all'invio. */
  const [bozzaDati, setBozzaDati] = useState({
    ragioneSociale: '',
    piva: '',
    legaleRappresentante: '',
    codiceFiscale: '',
    iban: '',
    titolareEffettivo: '',
    sedeLegale: '',
  });
  /** Proposte di modifica dei dati fiscali inviate dal cliente, col loro stato. */
  const [proposteDati, setProposteDati] = useState<PropostaDatiFiscale[]>([]);
  const [invioProposta, setInvioProposta] = useState(false);
  const [propostaMsg, setPropostaMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  /**
   * §2.4: IBAN e titolare effettivo sono mostrati mascherati. Il cliente può scoprirli
   * esplicitamente con un interruttore: non c'è motivo che un dato bancario o il nome del
   * titolare effettivo restino in chiaro su uno schermo condiviso o in una schermata di
   * cortesia.
   */
  const [mostraDatiSensibili, setMostraDatiSensibili] = useState(false);

  /**
   * §2.6: i recapiti dello studio (lead advisor reale) arrivano dal backend. Prima la scheda
   * mostrava a tutti un nome proprio, un indirizzo email e un telefono scritti a mano nel
   * codice — e il pallino verde "Advisor Online", che non riflette la presenza di nessuno.
   */
  const [contattiStudio, setContattiStudio] = useState<ContattiStudio | null>(null);

  /** §2.11: fatture e stato di pagamento dei progetti del cliente. */
  const [fatturePortale, setFatturePortale] = useState<FatturaPortale[]>([]);
  const [fattureCaricamento, setFattureCaricamento] = useState(false);
  const [fattureErrore, setFattureErrore] = useState<string | null>(null);

  /**
   * §2.10: anteprima del portale aperta da un utente dello studio. Quando è vera il portale
   * mostra un selettore del cliente e un banner «anteprima», perché i dati che si vedono non
   * sono di chi sta guardando ma del cliente scelto.
   */
  const [isStudioPreview, setIsStudioPreview] = useState(false);
  /** Elenco completo dei clienti, per il selettore dell'anteprima studio. */
  const [elencoClienti, setElencoClienti] = useState<any[]>([]);

  // Comunicazioni State
  const [progettoId, setProgettoId] = useState<string>('proj-001');
  const [messaggi, setMessaggi] = useState<any[]>([]);
  const [nuovoMessaggio, setNuovoMessaggio] = useState('');
  const [canaleMessaggio, setCanaleMessaggio] = useState<'whatsapp' | 'email' | 'telegram' | 'portal'>('portal');
  const [inviandoMessaggio, setInviandoMessaggio] = useState(false);

  /**
   * Errore della rilettura dopo la firma. Serve per distinguere le due cose davanti al cliente:
   * la firma è registrata a database, è solo la pagina che non si è aggiornata.
   */
  const [erroreRicarica, setErroreRicarica] = useState<string | null>(null);

  /**
   * Rilegge dal database i progetti del cliente autenticato e allinea moduli e messaggi.
   *
   * Vive fuori da `loadPortalData` perché serve anche subito dopo la firma: ripassare da tutto
   * il caricamento significherebbe riconsumare il magic token (con un secondo
   * `MAGIC_LINK_USATO` nell'audit), rileggere l'elenco clienti e azzerare la scelta del
   * progetto. Qui serve solo il dato che la firma ha cambiato.
   *
   * `preferisciId` mantiene selezionato il progetto che il cliente sta guardando, quando esiste
   * ancora dopo la rilettura.
   */
  const ricaricaProgetti = async (
    clienteIdSessione: string | null,
    nomeCliente: string,
    preferisciId?: string,
  ) => {
    const progettiRes = await fetchProgetti();
    const elenco: any[] = Array.isArray(progettiRes) ? progettiRes : [];

    // Cerca i progetti associati ESCLUSIVAMENTE al cliente corrente.
    const matched = elenco.filter((p: any) => {
      const byId = clienteIdSessione && (p.clienteId === clienteIdSessione || p.cliente?.id === clienteIdSessione);
      const byName = nomeCliente && p.cliente?.nome && p.cliente.nome.trim().toLowerCase() === nomeCliente.trim().toLowerCase();
      // Nessun confronto per email: il modello `Cliente` non ha una colonna email (le
      // referenze stanno in `referentiJson`), quindi `p.cliente.email` è sempre
      // undefined e il ramo non poteva mai essere vero.
      return byId || byName;
    });

    // Nessun progetto di ripiego. Se il cliente non ha progetti a database l'elenco resta
    // vuoto e il portale lo dichiara. Prima entrambi i rami fabbricavano un "Progetto
    // Consulenza & Structuring per <nome>" da 28.500 € in Malta, stato in_progress: un
    // incarico inesistente con un prezzo inventato, mostrato AL CLIENTE come se fosse il
    // suo. Da lì il mapper ci attaccava anche i moduli, perché quel finto progetto non ha
    // moduli a database.
    setClientProjects(matched);

    if (matched.length === 0) {
      setSelectedProjectId('');
      setProgettoId('');
      setModuliProposti([]);
      return;
    }

    // Non il più recente in assoluto, ma il più recente CON moduli a database.
    // `GET /progetti` ordina per data discendente e prima si prendeva `matched[0]`:
    // se lo studio aveva aperto un secondo incarico per lo stesso cliente e non lo
    // aveva ancora istanziato, il portale mostrava quello — vuoto — e il cliente
    // vedeva zero moduli pur avendone due sull'incarico precedente. Da qui l'idea
    // che servisse prima firmare: la firma non c'entra, l'elenco puntava al
    // progetto sbagliato.
    const preferito = preferisciId ? matched.find((p: any) => String(p.id) === String(preferisciId)) : undefined;
    const conModuli = matched.find((p: any) => Array.isArray(p.moduli) && p.moduli.length > 0);
    const activeProj = preferito ?? conModuli ?? matched[0];
    const pId = String(activeProj.id);
    setSelectedProjectId(pId);
    setProgettoId(pId);
    setModuliProposti(mapProjectToPortalModules(activeProj));
    const msgs = await fetchComunicazioniApi(pId);
    if (msgs && Array.isArray(msgs)) {
      setMessaggi(msgs);
    }
  };

  /**
   * Rilegge i documenti del fascicolo con il loro stato di firma a database.
   *
   * Serve anche dopo una firma: il sigillo lo emette il backend, quindi l'unico modo di sapere
   * che un documento è firmato è richiederlo. Un errore di lettura viene mostrato: prima l'elenco
   * era finto e non poteva fallire, ora può, e «non riesco a leggere i documenti» non deve
   * assomigliare a «non ci sono documenti».
   */
  const caricaDocumenti = async (clienteIdSessione?: string | null) => {
    setPortalDocsCaricamento(true);
    setPortalDocsErrore(null);
    try {
      const res = await documentiPortaleApi(clienteIdSessione ?? undefined);
      setPortalDocs(Array.isArray(res?.documenti) ? res.documenti : []);
    } catch (err: any) {
      setPortalDocs([]);
      setPortalDocsErrore(err?.message || 'Impossibile leggere i documenti del fascicolo.');
    } finally {
      setPortalDocsCaricamento(false);
    }
  };

  /**
   * Le firme di conclusione delle operazioni (ambito `modulo_completato`).
   *
   * Prima la conferma viveva in `localStorage` (`bluman_module_signatures_…`): firmata su un
   * browser voleva dire non firmata su un altro, e lo studio non ne aveva traccia. Ora arriva da
   * database come le firme dei documenti (§2.9): ogni conferma è una riga `FirmaElettronica`
   * emessa da `/portal/verify-otp-and-sign`, con data, hash e IP del momento della firma.
   */
  const caricaFirmeModuli = async (clienteIdSessione?: string | null) => {
    try {
      const res = await elencoFirmeApi({ clienteId: clienteIdSessione ?? undefined, ambito: 'modulo_completato' });
      const firme = Array.isArray(res?.firme) ? res.firme : [];
      const mappa: Record<string, { firmato: boolean; dataFirma: string; signerName: string }> = {};
      for (const f of firme) {
        // L'elenco arriva già ordinato dal più recente: la prima riga per modulo è quella buona.
        if (f.riferimentoId && !mappa[f.riferimentoId]) {
          mappa[f.riferimentoId] = {
            firmato: true,
            dataFirma: dataOraLeggibile(f.firmatoAt),
            signerName: f.firmatarioNome || clientName,
          };
        }
      }
      setModuleSignatures(mappa);
    } catch {
      setModuleSignatures({});
    }
  };

  /**
   * §2.5 — Rilegge da database le richieste di integrazione dell'incarico.
   *
   * Prima venivano da `localStorage`: lo studio non le vedeva mai e un cambio dispositivo le
   * perdeva. Un errore di lettura viene dichiarato, non mascherato da elenco vuoto.
   */
  const caricaAddendum = async (clienteIdSessione?: string | null) => {
    setAddendumErrore(null);
    try {
      const res = await richiesteAddendumPortaleApi(clienteIdSessione ?? undefined);
      setAddendums(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setAddendums([]);
      setAddendumErrore(err?.message || 'Impossibile leggere le richieste di integrazione.');
    }
  };

  /** §2.3 — Rilegge le proposte di modifica dei dati fiscali inviate dal cliente. */
  const caricaProposteDati = async (clienteIdSessione?: string | null) => {
    try {
      const res = await proposteDatiPortaleApi(clienteIdSessione ?? undefined);
      setProposteDati(Array.isArray(res) ? res : []);
    } catch {
      setProposteDati([]);
    }
  };

  /** §2.6 — Recapiti reali dello studio (lead advisor) dalla riga del tenant. */
  const caricaContattiStudio = async (clienteIdSessione?: string | null) => {
    try {
      const res = await contattiPortaleApi(clienteIdSessione ?? undefined);
      setContattiStudio(res);
    } catch {
      setContattiStudio(null);
    }
  };

  /** §2.11 — Fatture e stato di pagamento dei progetti del cliente. */
  const caricaFatturePortale = async (clienteIdSessione?: string | null) => {
    setFattureCaricamento(true);
    setFattureErrore(null);
    try {
      const res = await fatturePortaleApi(clienteIdSessione ?? undefined);
      setFatturePortale(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setFatturePortale([]);
      setFattureErrore(err?.message || 'Impossibile leggere le fatture.');
    } finally {
      setFattureCaricamento(false);
    }
  };

  const loadPortalData = async (clienteIdParam?: string) => {
    setPageLoading(true);
    let resolvedClientName = clientName;
    let clienteIdSessione: string | null = clienteIdParam || null;
    // §2.10: vero solo quando chi apre il portale è un utente dello studio (nessuna sessione
    // cliente). In quel caso i dati mostrati sono del cliente scelto nel selettore, non di chi
    // guarda, e la pagina lo dichiara con il banner «anteprima».
    let anteprimaStudio = false;

    if (token) {
      try {
        const sessione = await magicLoginApi(token);
        if (!sessione?.token) throw new Error('Magic Link non valido o scaduto');
        localStorage.setItem('bluman_jwt_token', sessione.token);
        if (sessione.user) {
          localStorage.setItem('bluman_client_user', JSON.stringify(sessione.user));
        }
        clienteIdSessione = sessione.user?.clienteId ?? null;
        setIsAuthenticated(true);
        setAccessoNegato(null);
      } catch (err: any) {
        console.warn('Magic login non riuscito', err);
        setAccessoNegato(err.message || 'Link di accesso non valido o scaduto.');
        setIsAuthenticated(false);
        setPageLoading(false);
        return;
      }
    } else if (clienteIdParam) {
      clienteIdSessione = clienteIdParam;
      // Se non c'è una sessione cliente salvata ma c'è un utente studio, il `clienteIdParam`
      // è la scelta di un'anteprima, non la sessione di quel cliente.
      anteprimaStudio = !localStorage.getItem('bluman_client_user') && Boolean(localStorage.getItem('bluman_user'));
      setIsAuthenticated(true);
      setAccessoNegato(null);
    } else {
      const existingToken = localStorage.getItem('bluman_jwt_token');
      const savedClientUser = localStorage.getItem('bluman_client_user');
      const savedStudioUser = localStorage.getItem('bluman_user');
      if (existingToken && savedClientUser) {
        try {
          const parsed = JSON.parse(savedClientUser);
          if (parsed.ruolo === 'cliente' && parsed.clienteId) {
            clienteIdSessione = parsed.clienteId;
            setIsAuthenticated(true);
            setAccessoNegato(null);
          } else {
            setIsAuthenticated(false);
            setPageLoading(false);
            return;
          }
        } catch {
          setIsAuthenticated(false);
          setPageLoading(false);
          return;
        }
      } else if (existingToken && savedStudioUser) {
        // Advisor o membro dello studio che apre l'anteprima portale
        anteprimaStudio = true;
        setIsAuthenticated(true);
        setAccessoNegato(null);
      } else {
        setIsAuthenticated(false);
        setPageLoading(false);
        return;
      }
    }
    setIsStudioPreview(anteprimaStudio);

    try {
      // Id del cliente di cui si stanno guardando i dati: quello della sessione, oppure quello
      // scelto nell'anteprima dello studio. Serve alle rotte del portale, che per un utente
      // studio non possono dedurlo dal token.
      let clienteIdRisolto: string | null = clienteIdSessione;
      const clientiRes = await fetchClienti();
      if (clientiRes && Array.isArray(clientiRes) && clientiRes.length > 0) {
        // §2.10: l'elenco completo serve al selettore dell'anteprima studio.
        setElencoClienti(clientiRes);
        const found = clienteIdSessione
          ? clientiRes.find(c => c.id === clienteIdSessione)
          : undefined;
        // Con una sessione cliente il ripiego su `clientiRes[0]` non è ammesso: se l'id della
        // sessione non compare nell'elenco, il portale apriva l'anagrafica di UN ALTRO cliente
        // — nome, partita IVA, IBAN e titolare effettivo compresi — e da lì proseguiva con i
        // suoi progetti. Meglio negare l'accesso: è un dato che non torna, non un dettaglio.
        if (clienteIdSessione && !found) {
          setAccessoNegato('La tua anagrafica non risulta più disponibile. Contatta lo studio.');
          setIsAuthenticated(false);
          setPageLoading(false);
          return;
        }
        // Senza id di sessione siamo nell'anteprima aperta da uno studio autenticato: lì
        // `clientiRes[0]` è una scelta, non un travisamento (§2.10 prevede un selettore).
        const risolto: any = found || clientiRes[0];
        clienteIdRisolto = risolto.id ?? clienteIdSessione;
        setClientObj(risolto);
        setClientName(risolto.nome);
        resolvedClientName = risolto.nome;
        // Il form societario si riempie con la riga del cliente, non con valori d'esempio: i campi
        // che il database non ha restano vuoti perché è il cliente a doverli compilare.
        const referenti: any = risolto.referentiJson || {};
        const valoriCliente = {
          ragioneSociale: risolto.nome || '',
          piva: risolto.piva || '',
          legaleRappresentante: referenti.legaleRappresentante || '',
          codiceFiscale: risolto.codiceFiscale || '',
          iban: risolto.iban || '',
          titolareEffettivo: risolto.ubo || '',
          sedeLegale: risolto.sedeLegale || '',
        };
        setFormData(valoriCliente);
        // La bozza parte dai valori attuali: il cliente digita solo ciò che vuole cambiare (§2.3).
        setBozzaDati(valoriCliente);
      }

      // Ripristina lo stato di firma persistito in memoria, SOLO per il cliente autenticato.
      const isSignedLocal = localStorage.getItem(`bluman_portal_signed_${resolvedClientName}`) === 'true';
      setSigned(isSignedLocal);
      const savedSeal = isSignedLocal ? localStorage.getItem(`bluman_seal_${resolvedClientName}`) : null;
      if (savedSeal) {
        try { setEidasSeal(JSON.parse(savedSeal)); } catch (e) { setEidasSeal(null); }
      } else {
        setEidasSeal(null);
      }

      // §2.5 — le richieste di integrazione dell'incarico si rileggono da database, non più da
      // `localStorage`: lo studio le vede e non vanno perse al cambio dispositivo.
      await caricaAddendum(clienteIdRisolto);
      // §2.3 proposte dati fiscali, §2.6 contatti studio, §2.11 fatture. Sono letture
      // indipendenti: un errore su una non blocca le altre.
      await caricaProposteDati(clienteIdRisolto);
      await caricaContattiStudio(clienteIdRisolto);
      await caricaFatturePortale(clienteIdRisolto);

      // I documenti firmati NON si rileggono più da `localStorage`. La firma di un documento
      // stava in `bluman_signed_docs_<cliente>`: firmato su un browser voleva dire non firmato
      // su un altro, e lo studio non ne vedeva traccia. Ora arriva da database (§2.9).
      await caricaDocumenti(clienteIdRisolto);

      // Le firme di conclusione delle operazioni, come tutto il resto del portale, arrivano dal
      // database (righe FirmaElettronica con ambito `modulo_completato`): firmate su qualsiasi
      // dispositivo sono subito visibili qui e allo studio.
      await caricaFirmeModuli(clienteIdSessione);

      try {
        await ricaricaProgetti(clienteIdSessione, resolvedClientName);
      } catch (err) {
        console.warn('Errore recupero progetti portale:', err);
      }
    } catch (err) {
      console.warn('Errore caricamento dati portale:', err);
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    loadPortalData();
  }, [token]);

  // ── Blocco 3 — CAMPANELLA: CARICAMENTO NOTIFICHE + STREAM IN TEMPO REALE ──
  useEffect(() => {
    if (!isAuthenticated) return;

    (async () => {
      const righe = await fetchNotificheApi();
      if (Array.isArray(righe)) {
        setNotifichePortale(righe.map((n: any) => ({
          id: n.id,
          oggetto: n.oggetto || 'Notifica',
          corpo: n.corpo || '',
          link: n.link || null,
          tipoEvento: n.tipoEvento || null,
          createdAt: n.createdAt || n.inviataAt || '',
          letto: n.statoLettura === 'letta',
        })));
      }
    })();

    const chiudi = apriStreamNotifiche((evento: NotificaStreamEvent) => {
      setNotifichePortale((prev) =>
        prev.some((n) => n.id === evento.id)
          ? prev
          : [{
              id: evento.id,
              oggetto: evento.oggetto,
              corpo: evento.corpo,
              link: evento.link ?? null,
              tipoEvento: evento.tipoEvento ?? null,
              createdAt: evento.createdAt,
              letto: false,
            }, ...prev].slice(0, 50),
      );
    });
    return chiudi;
  }, [isAuthenticated]);

  const notificheNonLette = notifichePortale.filter((n) => !n.letto).length;

  const handleSegnaNotificheLette = async () => {
    setNotifichePortale((prev) => prev.map((n) => ({ ...n, letto: true })));
    // §3.3 — la campanella si svuota subito (stato visuale), ma se la scrittura sul server
    // fallisce lo notifichiamo in console invece di far finta di niente con un'eccezione
    // non gestita: al prossimo accesso le notifiche torneranno da leggere.
    try {
      await markNotificheReadApi();
    } catch (err) {
      console.warn('Segnala-notifiche-lette non persistito sul server:', err);
    }
  };

  /** Il link della notifica porta alla scheda giusta del portale. */
  const handleSelezionaNotificaPortale = (n: NotificaPortale) => {
    setNotifPortaleOpen(false);
    if (n.link === '/portal/documents') setActiveTab('documenti');
    else if (n.link === '/portal/invoices') setActiveTab('fatture');
    // Punto 4 — le risposte di addendum e proposte dati vivono nella tab «Proposta»;
    // la conferma di una firma si rivede nell'avanzamento.
    else if (n.link === '/portal/proposal') setActiveTab('proposta');
    else if (n.link === '/portal/avanzamento') setActiveTab('avanzamento');
  };

  // ── CANALI DI FIRMA: QUALI SONO DAVVERO UTILIZZABILI ──────────────────────
  //
  // Le tre voci erano scritte a mano nel JSX, SMS compreso, e nessuna sapeva se il canale
  // fosse configurato: chi scegliesse SMS o WhatsApp su uno studio senza credenziali
  // vedeva "codice inviato" e restava ad aspettare. Ora l'elenco arriva dal backend con il
  // motivo dell'indisponibilità, e il preferito del cliente è preselezionato (§1.4).
  useEffect(() => {
    if (!isAuthenticated) return;
    let annullato = false;

    (async () => {
      try {
        const res = await canaliFirmaApi();
        if (annullato) return;
        setCanaliFirma(res.canali || []);
        setBotTelegram(res.botTelegram ?? null);

        const disponibili = (res.canali || []).filter((c) => c.disponibile);
        const preferito = disponibili.find((c) => c.canale === res.canalePreferito);
        // Scelta ogni volta, con il preferito preselezionato: se il preferito non è
        // utilizzabile si preseleziona il primo che lo è, invece di un default fisso su un
        // canale che non spedirebbe.
        if (preferito) setOtpCanale(preferito.canale);
        else if (disponibili[0]) setOtpCanale(disponibili[0].canale);
      } catch (err) {
        // Nessun ripiego inventato: senza elenco i pulsanti restano disabilitati e il
        // messaggio lo dice, invece di offrire canali di cui non sappiamo nulla.
        if (!annullato) setCanaliFirma([]);
      }
    })();

    return () => {
      annullato = true;
    };
  }, [isAuthenticated, clientObj?.id]);

  /** Contatore dell'attesa fra due reinvii: il pulsante resta spento finché non arriva a 0. */
  useEffect(() => {
    if (otpAttesaReinvio <= 0) return;
    const t = setTimeout(() => setOtpAttesaReinvio((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpAttesaReinvio]);

  /** Validità residua del codice, per non far digitare a vuoto un codice già scaduto. */
  useEffect(() => {
    if (otpValiditaSecondi <= 0) return;
    const t = setTimeout(() => setOtpValiditaSecondi((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpValiditaSecondi]);

  const canaleCorrente = canaliFirma.find((c) => c.canale === otpCanale);
  const nomeCanale: Record<CanaleOtp, string> = {
    whatsapp: 'WhatsApp',
    email: 'Email',
    telegram: 'Telegram',
  };

  /**
   * Impronta del documento che il cliente ha davanti.
   *
   * Il backend la pretende e non ne fabbrica più una: un sigillo senza impronta certifica
   * una volontà su un testo qualunque. Si calcola sull'HTML esattamente come viene
   * mostrato, quindi due clienti con moduli diversi hanno impronte diverse e una modifica
   * al mandato dopo la firma è dimostrabile.
   */
  const impronteDocumento = async () => calcolaHashSha256(getResolvedEngagementHtml());

  const TITOLO_MANDATO = 'Engagement Letter & Mandato Professionale';

  /**
   * Cosa si sta firmando in questo momento.
   *
   * Il flusso OTP era cablato sulla lettera d'incarico: ambito, titolo e impronta erano costanti.
   * I documenti del Vault avevano quindi una firma tutta loro, che non passava dal backend —
   * `DigitalSignatureModal` disegnava la grafometrica, la scriveva in `localStorage` e il portale
   * dichiarava al cliente «firmato con Sigillo FEA eIDAS UE 910/2014». Non c'era nessun codice
   * OTP, nessuna riga in `FirmaElettronica`, nessuna impronta del documento: una dichiarazione di
   * validità legale su una firma che a database non esisteva, e che lo studio non vedeva.
   *
   * Ora il bersaglio è un dato: la stessa modale, lo stesso codice e lo stesso sigillo servono la
   * lettera d'incarico e un documento del fascicolo, cambiando solo ambito e riferimento.
   *
   * Nello stato stanno solo i tre valori, non la funzione che calcola l'impronta: una closure
   * salvata al primo render firmerebbe l'HTML di allora, con i moduli ancora da caricare.
   */
  const [bersaglioFirma, setBersaglioFirma] = useState<BersaglioFirma>({
    ambito: 'engagement_letter',
    titolo: TITOLO_MANDATO,
  });

  /**
   * Impronta da mandare al backend, secondo cosa si sta firmando.
   *
   * Per un documento del fascicolo non si manda niente: l'impronta la calcola il server dal file
   * che ha in archivio. Lo stesso vale per la conclusione di un'operazione: il server firma i dati
   * canonici del modulo (nome, categoria, prezzo, microvoci) che ha lui, non una scelta del
   * browser. È l'unico modo perché voglia dire qualcosa — chi firma è anche chi manda la
   * richiesta, e un'impronta scelta dal browser descrive il documento che vuole il firmatario,
   * non quello che ha firmato. Per la lettera d'incarico resta questa, perché il testo del mandato
   * è ancora composto qui e il server non ce l'ha.
   */
  const improntaDelBersaglio = async (bersaglio: BersaglioFirma): Promise<string | undefined> => {
    if (
      (bersaglio.ambito === 'documento_vault' || bersaglio.ambito === 'modulo_completato') &&
      bersaglio.riferimentoId
    ) {
      return undefined;
    }
    return impronteDocumento();
  };

  /** Invio o reinvio del codice. Un errore resta un errore, e il cliente legge quale. */
  const inviaCodiceFirma = async (opzioni: { reinvio?: boolean; bersaglio?: BersaglioFirma; canale?: CanaleOtp } = {}) => {
    const bersaglio = opzioni.bersaglio ?? bersaglioFirma;
    const canaleDaUsare = opzioni.canale ?? otpCanale;
    if (opzioni.canale) setOtpCanale(opzioni.canale);
    if (opzioni.bersaglio) setBersaglioFirma(opzioni.bersaglio);
    setOtpLoading(true);
    setOtpError(null);
    setOtpCode('');

    try {
      const res = await requestPortalOtpApi({
        canale: canaleDaUsare,
        ambito: bersaglio.ambito,
        riferimentoId: bersaglio.riferimentoId,
        recapitoDichiarato: usaRecapitoDiverso && recapitoDichiarato.trim() ? recapitoDichiarato.trim() : undefined,
        signerName: clientName,
        clienteId: clientObj?.id,
      });

      setOtpTarget(res.maskedTarget);
      setOtpTargetDichiarato(Boolean(res.recapitoDichiarato));
      setOtpValiditaSecondi(res.expiresInSeconds ?? 0);
      setOtpReinviiRimanenti(res.reinviiRimanenti ?? null);
      setOtpAttesaReinvio(res.attesaReinvioSecondi ?? 0);
      setOtpModalOpen(true);
      return true;
    } catch (err: any) {
      // 429: limite di frequenza. Il contatore parte dai secondi che dice il backend, così
      // il pulsante non promette un reinvio che sarebbe rifiutato.
      if (err?.attendiSecondi) setOtpAttesaReinvio(err.attendiSecondi);
      setOtpError(err?.message || 'Invio del codice non riuscito.');
      // In reinvio la modale è già aperta e mostra l'errore; al primo invio si apre perché
      // è lì che il messaggio è leggibile, con il campo del codice ancora vuoto.
      if (!opzioni.reinvio) setOtpModalOpen(true);
      return false;
    } finally {
      setOtpLoading(false);
    }
  };

  /** Verifica del codice e apposizione della firma, con la grafometrica se raccolta. */
  const confermaFirmaConOtp = async (firmaGrafometricaPng?: string) => {
    if (!otpCode || otpCode.length < 6) {
      setOtpError('Inserisci il codice completo a 6 cifre.');
      return false;
    }
    setLoading(true);
    setOtpError(null);

    try {
      const res = await verifyPortalOtpAndSignApi({
        otp: otpCode,
        documentoHash: await improntaDelBersaglio(bersaglioFirma),
        signerName: clientName,
        documentoTitolo: bersaglioFirma.titolo,
        ambito: bersaglioFirma.ambito,
        riferimentoId: bersaglioFirma.riferimentoId,
        clienteId: clientObj?.id,
        firmaGrafometricaPng,
      });

      await registraEsitoFirma(res.seal);
      setOtpModalOpen(false);
      setOtpCode('');
      return true;
    } catch (err: any) {
      setOtpError(err?.message || 'Convalida del codice non riuscita.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Firma a penna o con provider esterno (§1.3): il documento scaricato torna come file, e
   * la prova è il file stesso. L'OTP, se c'è un codice digitato, viene citato nel sigillo.
   */
  const confermaFirmaConFile = async () => {
    if (!fileFirmato) {
      setOtpError('Carica prima il documento firmato.');
      return false;
    }
    setCaricamentoFirmato(true);
    setOtpError(null);

    try {
      const res = await firmaConFileApi({
        tipoFirma: modalitaFirma === 'qualificata_esterna' ? 'qualificata_esterna' : 'manuale_scansionata',
        documentoHash: await improntaDelBersaglio(bersaglioFirma),
        filename: fileFirmato.nome,
        contentBase64: fileFirmato.base64,
        ambito: bersaglioFirma.ambito,
        riferimentoId: bersaglioFirma.riferimentoId,
        documentoTitolo: bersaglioFirma.titolo,
        signerName: clientName,
        clienteId: clientObj?.id,
        otp: otpCode.length === 6 ? otpCode : undefined,
      });

      await registraEsitoFirma(res.seal);
      setFileFirmato(null);
      return true;
    } catch (err: any) {
      setOtpError(err?.message || 'Caricamento del documento firmato non riuscito.');
      return false;
    } finally {
      setCaricamentoFirmato(false);
    }
  };

  /**
   * Cosa aggiornare dopo che il backend ha emesso il sigillo.
   *
   * Cambia con l'ambito: la lettera d'incarico sblocca il portale e attiva il progetto, un
   * documento del fascicolo va semplicemente riletto — il suo stato di firma sta a database e non
   * si deduce dal fatto che il pulsante è stato premuto.
   */
  const registraEsitoFirma = async (seal: any) => {
    setSuccessSealModal(seal);
    if (bersaglioFirma.ambito === 'documento_vault') {
      await caricaDocumenti(clientObj?.id);
      setSelectedViewerDoc(null);
      return;
    }
    if (bersaglioFirma.ambito === 'modulo_completato') {
      // La firma sta a database: si rilegge l'elenco delle conclusioni per mostrarla, senza
      // scrivere in localStorage — non arriverebbe allo studio né agli altri dispositivi.
      await caricaFirmeModuli(clientObj?.id);
      return;
    }

    setEidasSeal(seal);
    localStorage.setItem(`bluman_seal_${clientName}`, JSON.stringify(seal));
    localStorage.setItem(`bluman_portal_signed_${clientName}`, 'true');
    setSigned(true);
    await ricaricaDopoFirma();
  };

  /**
   * Avvia la firma di un documento del fascicolo: sceglie il bersaglio e chiede il codice.
   *
   * Il codice viene richiesto per QUESTO documento, con il suo `riferimentoId`: un OTP emesso per
   * la lettera d'incarico non convalida la firma di un documento, e viceversa.
   */
  const avviaFirmaDocumento = async (doc: DocumentoPortale) => {
    const bersaglio: BersaglioFirma = {
      ambito: 'documento_vault',
      titolo: doc.titolo || doc.nome,
      riferimentoId: doc.id,
    };
    setModalitaFirma('otp');
    setFileFirmato(null);
    // `inviaCodiceFirma` fissa il bersaglio: qui non serve scriverlo due volte.
    await inviaCodiceFirma({ bersaglio });
  };

  /**
   * Conclusione di un'operazione: la firma è una firma elettronica semplice (SES) con OTP
   * verificata, con lo stesso flusso
   * OTP dei documenti del fascicolo. Il server firma i dati canonici del modulo (§2.9) e mette
   * la riga in `FirmaElettronica` — data, hash e IP veri, visibili subito anche allo studio.
   */
  const avviaFirmaModulo = async (modulo: { id: string; nome: string }) => {
    const bersaglio: BersaglioFirma = {
      ambito: 'modulo_completato',
      titolo: modulo.nome,
      riferimentoId: modulo.id,
    };
    setModalitaFirma('otp');
    setFileFirmato(null);
    await inviaCodiceFirma({ bersaglio });
  };

  /** Legge il file scelto dal cliente come data URL, per spedirlo in base64. */
  const leggiFileFirmato = (file: File) =>
    new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        setFileFirmato({ nome: file.name, base64: String(reader.result || '') });
        resolve();
      };
      reader.onerror = () => {
        setOtpError('Impossibile leggere il file selezionato.');
        resolve();
      };
      reader.readAsDataURL(file);
    });

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail || !loginPassword) {
      setLoginError('Inserisci sia email che password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await clientLoginApi(loginEmail.trim(), loginPassword);
      if (res && res.token) {
        localStorage.setItem('bluman_jwt_token', res.token);
        if (res.user) {
          localStorage.setItem('bluman_client_user', JSON.stringify(res.user));
        }
        setIsAuthenticated(true);
        setAccessoNegato(null);
        await loadPortalData(res.user?.clienteId);
      } else {
        setLoginError('Credenziali non valide o utente non trovato');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Credenziali non valide');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleClientLogout = () => {
    localStorage.removeItem('bluman_jwt_token');
    localStorage.removeItem('bluman_client_user');
    setIsAuthenticated(false);
  };

  const handleManualMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!manualMagicToken.trim()) {
      setLoginError('Inserisci un Magic Token valido');
      return;
    }
    setLoginLoading(true);
    try {
      const sessione = await magicLoginApi(manualMagicToken.trim());
      if (!sessione?.token) throw new Error('Magic Token non valido o scaduto');
      localStorage.setItem('bluman_jwt_token', sessione.token);
      if (sessione.user) {
        localStorage.setItem('bluman_client_user', JSON.stringify(sessione.user));
      }
      setIsAuthenticated(true);
      setAccessoNegato(null);
      await loadPortalData(sessione.user?.clienteId);
    } catch (err: any) {
      setLoginError(err.message || 'Magic Token non valido o scaduto');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSelectProject = (pId: string, availableProjects?: any[]) => {
    const projs = availableProjects || clientProjects;
    setSelectedProjectId(pId);
    setProgettoId(pId);
    // Il modulo aperto appartiene al progetto che si sta lasciando: senza chiuderlo, il suo
    // dettaglio resta a schermo sopra l'elenco del progetto nuovo.
    setSelectedModule(null);
    const foundProj = projs.find((p: any) => String(p.id) === String(pId));
    // Si assegna anche quando il progetto non si trova: l'elenco vuoto è il dato corretto.
    // Con `if (foundProj)` un progetto non trovato lasciava a schermo i moduli del precedente.
    setModuliProposti(foundProj ? mapProjectToPortalModules(foundProj) : []);
    fetchComunicazioniApi(pId).then(msgs => {
      if (msgs && Array.isArray(msgs)) setMessaggi(msgs);
    }).catch(() => {});
  };

  /**
   * §2.10 — Cambio del cliente nell'anteprima dello studio.
   *
   * Rilegge l'intero portale sul cliente scelto: anagrafica, progetti, documenti, proposte,
   * addendum, contatti e fatture. È un'anteprima, quindi il banner resta visibile anche dopo.
   */
  const handleSelectPreviewClient = (clienteId: string) => {
    if (!clienteId || clienteId === clientObj?.id) return;
    void loadPortalData(clienteId);
  };

  const totalValue = moduliProposti.reduce((acc, m) => acc + m.prezzo, 0);

  /** Progetto attualmente scelto nel selettore, con l'avanzamento che il backend ha calcolato. */
  const progettoAttivo = clientProjects.find((p: any) => String(p.id) === String(selectedProjectId)) || clientProjects[0] || null;

  useEffect(() => {
    if (progettoAttivo) {
      setModuliProposti(mapProjectToPortalModules(progettoAttivo, portalDocs));
    }
  }, [progettoAttivo, portalDocs]);

  /**
   * Percentuale reale del progetto (§16). Prima la barra di avanzamento era
   * `Math.max(75, firmati/totali)` con etichetta "75% in Lavorazione Avanzata": non poteva
   * scendere sotto il 75% qualunque fosse lo stato dei lavori, e quel numero veniva mostrato
   * al cliente come avanzamento del suo incarico.
   */
  const percentualeProgetto: number = progettoAttivo?.avanzamento?.percentuale ?? 0;

  /**
   * Rilettura del portale dopo una firma già convalidata dal server.
   *
   * Non c'è niente da costruire nel browser: la riga di firma, l'evento in audit e il passaggio
   * del progetto a `in_progress` li scrive l'endpoint di firma (`POST /portale/firma-otp`),
   * e i moduli dell'incarico erano già a database perché li ha istanziati lo studio. Qui si
   * rilegge, così il cliente vede lo stato aggiornato invece di una copia locale.
   *
   * Prima, dopo la firma, questa funzione: prendeva un cliente qualunque con `clientiRes[0]`
   * o ne creava uno nuovo; inventava un id `proj-<timestamp>`; apriva un secondo progetto e un
   * preventivo che duplicava i moduli già istanziati, traducendo in `mod-m01` ogni modulo con
   * un id non riconosciuto; poi fabbricava moduli al 25% con tre micro-voci fisse, un progetto
   * "operatore" al 20% e un documento «Engagement Letter firmata — 54 KB» scritto solo in
   * localStorage. Nessuno di quei dati esisteva a database, e l'unico errore possibile veniva
   * inghiottito da un `catch` che scriveva in console.
   */
  const ricaricaDopoFirma = async () => {
    setLoading(true);
    setErroreRicarica(null);
    try {
      await ricaricaProgetti(clientObj?.id ?? null, clientName, selectedProjectId || undefined);
    } catch (err) {
      console.error('Rilettura dei dati dopo la firma non riuscita:', err);
      setErroreRicarica(
        'La firma è stata registrata. Non è riuscito soltanto l\'aggiornamento di questa pagina: ricaricala per vedere lo stato aggiornato dell\'incarico.',
      );
    } finally {
      setLoading(false);
    }
  };

  /** §2.4 — Maschera l'IBAN lasciando visibili solo gli ultimi caratteri. */
  const mascheraIban = (iban: string) => {
    const compatto = (iban || '').replace(/\s+/g, '');
    if (!compatto) return '';
    return `•••• ${compatto.slice(-8)}`;
  };

  /** §2.4 — Maschera il titolare effettivo: il nome intero si vede solo scoprendo il dato. */
  const mascheraUbo = (nome: string) => ((nome || '').trim() ? '••••••••' : '');

  /**
   * §2.3 — Invio delle proposte di modifica dei dati fiscali.
   *
   * Il cliente non scrive direttamente in anagrafica: per ogni campo il cui valore digitato
   * differisce da quello attuale invia una proposta che resta `in_attesa` finché lo studio non
   * la conferma. Solo allora il valore entra nella riga del cliente.
   */
  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invioProposta) return;
    setPropostaMsg(null);
    const campi = ['ragioneSociale', 'piva', 'legaleRappresentante', 'codiceFiscale', 'iban', 'titolareEffettivo', 'sedeLegale'] as const;
    const modifiche = campi.filter((c) => {
      const nuovo = (bozzaDati[c] || '').trim();
      return nuovo !== '' && nuovo !== (formData[c] || '').trim();
    });
    if (modifiche.length === 0) {
      setPropostaMsg({ text: 'Nessun campo da aggiornare: digita un valore diverso da quello attuale per proporre una modifica.', type: 'error' });
      return;
    }
    setInvioProposta(true);
    try {
      for (const campo of modifiche) {
        await inviaPropostaDatiApi({ campo, valoreProposto: (bozzaDati as any)[campo].trim(), clienteId: clientObj?.id });
      }
      await caricaProposteDati(clientObj?.id);
      setPropostaMsg({
        text: `✓ ${modifiche.length === 1 ? 'Proposta inviata' : `${modifiche.length} proposte inviate`} allo studio. Le modifiche saranno effettive solo dopo la conferma dello studio.`,
        type: 'success',
      });
      setFormSaved(true);
      setTimeout(() => setFormSaved(false), 4000);
    } catch (err: any) {
      setPropostaMsg({ text: err?.message || 'Errore durante l\'invio della proposta.', type: 'error' });
    } finally {
      setInvioProposta(false);
    }
  };

  /** §2.3 — proposta di modifica ancora in attesa di conferma, per un campo del form. */
  const propostaInAttesa = (campo: string) =>
    proposteDati.find((p) => p.campo === campo && p.stato === 'in_attesa') || null;

  /**
   * §2.5 — Invio di una nuova richiesta di integrazione dell'incarico.
   *
   * Testo libero agganciato al progetto selezionato: lo studio la riceve, la lavora e ne
   * aggiorna lo stato. Prima era un bottone che fabbricava in `localStorage` un addendum già
   * scritto — titolo, modulo e prezzo di 3.500 € — che lo studio non vedeva.
   */
  const inviaNuovaRichiestaAddendum = async () => {
    const testo = nuovaRichiestaAddendum.trim();
    if (!testo || invioAddendum) return;
    setInvioAddendum(true);
    setAddendumMsg(null);
    try {
      await inviaRichiestaAddendumApi({ testoRichiesta: testo, progettoId: selectedProjectId || undefined, clienteId: clientObj?.id });
      setNuovaRichiestaAddendum('');
      await caricaAddendum(clientObj?.id);
      setAddendumMsg({ text: '✓ Richiesta inviata allo studio. Lo stato dell\'integrazione sarà aggiornato qui.', type: 'success' });
    } catch (err: any) {
      setAddendumMsg({ text: err?.message || 'Errore durante l\'invio della richiesta.', type: 'error' });
    } finally {
      setInvioAddendum(false);
    }
  };

  const handleSaveClientPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientPassMsg(null);
    if (clientPassNew.length < 6) {
      setClientPassMsg({ text: 'La nuova password deve contenere almeno 6 caratteri.', type: 'error' });
      return;
    }
    if (clientPassNew !== clientPassConfirm) {
      setClientPassMsg({ text: 'Le due password non coincidono.', type: 'error' });
      return;
    }
    setClientPassLoading(true);
    try {
      await cambiaPasswordClienteApi(clientPassNew, clientPassCurrent, clientObj?.id, clientObj?.email || loginEmail);
      setClientPassMsg({ text: '✓ Password salvata con successo! Ora puoi accedere al portale anche con la tua email e questa password.', type: 'success' });
      setClientPassCurrent('');
      setClientPassNew('');
      setClientPassConfirm('');
      if (clientObj) {
        setClientObj({ ...clientObj, hasPassword: true });
      }
    } catch (err: any) {
      setClientPassMsg({ text: err.message || 'Errore durante il salvataggio della password', type: 'error' });
    } finally {
      setClientPassLoading(false);
    }
  };

  const getResolvedEngagementHtml = () => {
    const tmpl = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-engagement');
    const baseHtml = tmpl ? tmpl.contenutoHtml : '';

    const modulesTableHtml = `
      <div style="margin: 16px 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 10pt; text-align: left;">
          <thead style="background: #f1f5f9; color: #1e1b4b; font-weight: 700; border-bottom: 1px solid #cbd5e1;">
            <tr>
              <th style="padding: 8px 12px;">Modulo Specialistico</th>
              <th style="padding: 8px 12px;">Categoria</th>
              <th style="padding: 8px 12px; text-align: center;">Ore Stimate</th>
              <th style="padding: 8px 12px; text-align: right;">Corrispettivo</th>
            </tr>
          </thead>
          <tbody>
            ${moduliProposti.map(m => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 12px; font-weight: 600; color: #0f172a;">${m.nome}</td>
                <td style="padding: 8px 12px; color: #475569;">${m.cat}</td>
                <td style="padding: 8px 12px; text-align: center; color: #475569;">${m.ore}h</td>
                <td style="padding: 8px 12px; text-align: right; font-weight: 700; color: #1e1b4b;">${fmt(m.prezzo)}</td>
              </tr>
            `).join('')}
            <tr style="background: #f8fafc; font-weight: 800;">
              <td colspan="3" style="padding: 10px 12px; text-align: right; color: #1e1b4b;">TOTALE COMPLESSIVO MANDATO:</td>
              <td style="padding: 10px 12px; text-align: right; color: #4338ca; font-size: 11pt;">${fmt(totalValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const studio = getStudioInfoForTenant();
    return resolveDocumentTemplateHtml(baseHtml.replace('<!-- {{TABELLA_MODULI}} -->', modulesTableHtml), {
      cliente: clientObj || {
        nome: clientName,
        referenteNome: clientName,
        ragioneSociale: formData.ragioneSociale || clientName,
        piva: formData.piva || '',
        codiceFiscale: formData.codiceFiscale || '',
      },
      progetto: {
        // Il nome dell'incarico a database. Era cablato «Progetto Consulenza & Structuring
        // Patrimoniale»: compariva dentro il testo che il cliente sottoscrive, riferito a un
        // incarico che non è il suo. Senza progetto resta la dizione generica.
        titolo: progettoAttivo?.nome || 'Incarico professionale',
        totalePreventivo: totalValue,
      },
      studio,
    });
  };

  // Qui c'era `getResolvedDocumentHtml`: per un documento del fascicolo componeva un testo
  // legale — premesse, articoli, richiami a eIDAS — e lo mostrava al cliente come se fosse il
  // documento. Il file vero stava in archivio e non veniva nemmeno aperto: il cliente leggeva
  // articoli che nessuno aveva scritto e poi firmava. I documenti del fascicolo si aprono ora
  // per quello che sono, e il testo generato è rimasto solo per la lettera d'incarico, che
  // effettivamente si compone qui.

  const currentStudioInfo = getStudioInfoForTenant();

  if (pageLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ⏳ Autenticazione sessione e caricamento portale riservato in corso...
        </div>
      </div>
    );
  }

  // Schermata di Login Portale Cliente con Email + Password (o Magic Link)
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 20, padding: 32, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
          {/* Header */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'var(--indigo)', color: '#fff', fontSize: 26, marginBottom: 12 }}>
              🛡
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              {currentStudioInfo.ragioneSociale || 'BluMan Advisory'}
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Portale Riservato Clienti • Consultazione Incarichi & Firma Elettronica Semplice
            </p>
          </div>

          {/* Switcher Modalità Accesso */}
          <div style={{ background: 'var(--card2)', padding: 4, borderRadius: 12, display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => { setAuthMode('credentials'); setLoginError(null); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: authMode === 'credentials' ? 'var(--indigo)' : 'transparent',
                color: authMode === 'credentials' ? '#fff' : 'var(--muted)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all .2s ease',
              }}
            >
              🔑 Email e Password
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('magic'); setLoginError(null); }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                background: authMode === 'magic' ? 'var(--indigo)' : 'transparent',
                color: authMode === 'magic' ? '#fff' : 'var(--muted)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all .2s ease',
              }}
            >
              🔗 Magic Link
            </button>
          </div>

          {accessoNegato && (
            <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
              ⚠️ {accessoNegato}
            </div>
          )}

          {loginError && (
            <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
              ⚠️ {loginError}
            </div>
          )}

          {/* Form Credenziali Classico */}
          {authMode === 'credentials' ? (
            <form onSubmit={handleClientLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email di Registrazione Cliente *</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="es. mario.rossi@holding.it"
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password Riservata *</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 20px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loginLoading ? 'wait' : 'pointer',
                  marginTop: 6,
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
              >
                {loginLoading ? 'Verifica credenziali in corso...' : 'Accedi al Portale Riservato ➔'}
              </button>
            </form>
          ) : (
            /* Form Magic Token */
            <form onSubmit={handleManualMagicSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice o Token Magic Link</label>
                <input
                  type="text"
                  value={manualMagicToken}
                  onChange={e => setManualMagicToken(e.target.value)}
                  placeholder="es. client_12345678_abcdef..."
                  required
                  style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
                <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  Incolla il codice Magic Token che hai ricevuto per email o WhatsApp dal tuo Advisor.
                </span>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 20px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loginLoading ? 'wait' : 'pointer',
                  marginTop: 6,
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
              >
                {loginLoading ? 'Verifica Magic Token...' : 'Accedi con Magic Token ➔'}
              </button>
            </form>
          )}

          <div style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              🔒 Connessione protetta con crittografia end-to-end · Firma elettronica semplice (OTP verificata) · art. 20 CAD
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={portalWrapperStyle}>
      <div style={containerStyle}>
      {/* §2.10 — Banner anteprima: un utente dello studio sta guardando il portale di un
          cliente. I dati non sono i suoi e ogni azione va letta come simulazione. */}
      {isStudioPreview && (
        <div style={{ margin: '0 0 12px', background: '#2a1f0d', border: '1px solid #b45309', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ color: '#fcd34d', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            👁 ANTEPRIMA STUDIO — Stai visualizzando il portale di <strong>{clientName}</strong>. Nessuna modifica è reale.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#fcd34d', fontSize: 11 }}>Cliente:</span>
            <select
              value={clientObj?.id || ''}
              onChange={(e) => handleSelectPreviewClient(e.target.value)}
              style={{ background: '#1c1608', color: '#fde68a', border: '1px solid #b45309', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {elencoClienti.map((c: any) => (
                <option key={c.id} value={c.id} style={{ background: '#1c1608', color: '#fde68a' }}>{c.nome}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Top Navbar Header */}
      <div style={topNavStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'var(--indigo)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 800 }}>🛡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {currentStudioInfo.ragioneSociale || 'BluMan Advisory Platform'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Portale Riservato Cliente · <strong>{clientName}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* 📁 SELETTORE MULTI-PROGETTO CLIENTE */}
          {clientProjects.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card2)', padding: '4px 12px', borderRadius: 10, border: '1px solid #4338ca' }}>
              <span style={{ fontSize: 14 }}>📁</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 9, color: '#a5b4fc', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '.3px' }}>
                  Progetto Attivo ({clientProjects.length} disponibili)
                </span>
                <select
                  value={selectedProjectId || clientProjects[0]?.id || ''}
                  onChange={(e) => handleSelectProject(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: 12,
                    padding: '2px 0',
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: 240,
                  }}
                >
                  {clientProjects.map((p: any) => {
                    // Due progetti dello stesso cliente possono avere il nome identico (a
                    // database ce ne sono: "Struttura Holding — Famiglia Ricci" ×2, uno con
                    // moduli e uno vuoto). Col solo nome le due voci sono indistinguibili e
                    // non si capisce quale si è scelto: l'etichetta porta anche il conteggio
                    // dei moduli e l'avanzamento calcolato.
                    const nModuli = Array.isArray(p.moduli) ? p.moduli.length : 0;
                    const pct = p.avanzamento?.percentuale;
                    const dettaglio = [
                      p.giurisdizione ? `(${p.giurisdizione})` : null,
                      `${nModuli} ${nModuli === 1 ? 'modulo' : 'moduli'}`,
                      typeof pct === 'number' ? `${pct}%` : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <option key={p.id} value={p.id} style={{ background: '#161822', color: '#fff' }}>
                        {p.nome} — {dettaglio}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {/* 🔔 Blocco 3 — Campanella notifiche del cliente (documenti da firmare, pagamenti, firme) */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setNotifPortaleOpen((v) => !v)}
              title="Le mie notifiche"
              style={{
                position: 'relative',
                background: 'var(--card2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              🔔
              {notificheNonLette > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 800,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                  }}
                >
                  {notificheNonLette}
                </span>
              )}
            </button>

            {notifPortaleOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 40,
                  right: 0,
                  width: 340,
                  maxWidth: '90vw',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 12,
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
                  zIndex: 1200,
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>🔔 Le mie notifiche</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {notificheNonLette > 0 && (
                      <button
                        onClick={handleSegnaNotificheLette}
                        style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        ✓ Segna lette
                      </button>
                    )}
                    <button onClick={() => setNotifPortaleOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}>
                  {notifichePortale.length === 0 ? (
                    <div style={{ padding: 22, textAlign: 'center', color: '#94a3b8', fontSize: 11.5 }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>📭</div>
                      Nessuna notifica
                    </div>
                  ) : (
                    notifichePortale.map((n) => {
                      const icona = n.tipoEvento === 'documento_da_firmare' ? '✍️'
                        : n.tipoEvento === 'firma_apposta' ? '✅'
                        : n.tipoEvento === 'fattura_incassata' ? '💶'
                        : n.tipoEvento === 'risposta_addendum' ? '📄'
                        : n.tipoEvento === 'risposta_proposta_dati' ? '🗂️'
                        : 'ℹ️';
                      const ts = n.createdAt ? new Date(n.createdAt).getTime() : 0;
                      return (
                        <div
                          key={n.id}
                          onClick={() => handleSelezionaNotificaPortale(n)}
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            marginBottom: 5,
                            background: n.letto ? '#1e293b40' : '#1e293b',
                            borderLeft: n.letto ? '3px solid #334155' : '3px solid #6366f1',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 11.5, color: n.letto ? '#94a3b8' : '#f8fafc' }}>
                              {icona} {n.oggetto}
                            </span>
                            {ts > 0 && (
                              <span style={{ fontSize: 9.5, color: '#64748b', whiteSpace: 'nowrap' }}>{tempoRelativo(ts)}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#cbd5e1', lineHeight: 1.4 }}>{n.corpo}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', fontSize: 11, padding: '5px 12px', borderRadius: 20, fontWeight: 600 }}>
            🔒 Accesso Riservato Cliente
          </div>
          <button
            onClick={handleClientLogout}
            style={{
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              color: '#f87171',
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Disconnettiti dal portale"
          >
            🚪 Esci
          </button>
        </div>
      </div>

      {erroreRicarica && (
        <div style={{ margin: '0 0 12px', background: '#2d0d0d', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <span>{erroreRicarica}</span>
          <button
            onClick={() => setErroreRicarica(null)}
            style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
            title="Chiudi"
          >
            ✕
          </button>
        </div>
      )}

      {/* Hero Welcome Banner */}
      <div style={heroBannerStyle}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            PORTALE DEDICATO ED ASSISTENZA PROFESSIONALE
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px' }}>
            {progettoAttivo?.nome || 'Nessun incarico aperto'}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Benvenuto nel tuo portale. Qui puoi consultare l'avanzamento dei lavori, compilare i dati societari e sottoscrivere i contratti.
          </div>
        </div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Stato Incarico</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: signed ? '#34d399' : 'var(--amber)', marginTop: 2 }}>
            {signed ? '✓ Progetto Attivo (In Lavorazione)' : '✍️ In Attesa di Accettazione'}
          </div>
        </div>
      </div>

      {/* Portal Tabs Bar */}
      <div style={tabsBarStyle}>
        <button
          onClick={() => setActiveTab('proposta')}
          style={tabBtnStyle(activeTab === 'proposta')}
        >
          ✍️ 1. Proposta d'Ordine & Firma
        </button>
        <button
          onClick={() => setActiveTab('avanzamento')}
          style={tabBtnStyle(activeTab === 'avanzamento')}
        >
          📊 2. Avanzamento Live Lavori
        </button>
        <button
          onClick={() => setActiveTab('form')}
          style={tabBtnStyle(activeTab === 'form')}
        >
          📋 3. Form Dati Societari
        </button>
        <button
          onClick={() => setActiveTab('documenti')}
          style={tabBtnStyle(activeTab === 'documenti')}
        >
          📎 4. Documenti & Contratti
        </button>
        <button
          onClick={() => setActiveTab('fatture')}
          style={tabBtnStyle(activeTab === 'fatture')}
        >
          💳 5. Fatture & Pagamenti
        </button>
        <button
          onClick={() => setActiveTab('contatti')}
          style={tabBtnStyle(activeTab === 'contatti')}
        >
          💬 6. Contatto Advisor
        </button>
        <button
          onClick={() => setActiveTab('profilo')}
          style={tabBtnStyle(activeTab === 'profilo')}
        >
          👤 7. Profilo & Password
        </button>
      </div>

      {/* Main Body Content */}
      <div style={bodyStyle}>
        {/* TAB 1: Proposta d'Ordine & Firma */}
        {activeTab === 'proposta' && (
          <div style={docBoxStyle}>
            {signed ? (
              <div>
                {/* 🔒 CONTRATTO BASE STIPULATO & CONGELATO (v1.0) */}
                <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 14, padding: 20, marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ background: '#34d399', color: '#064e3b', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, textTransform: 'uppercase' }}>
                          🔒 FIRMATO & CONGELATO (v1.0)
                        </span>
                        {/* Repertorio e marca temporale vengono dal sigillo di firma emesso dal server
                            (/portal/verify-otp-and-sign). Prima erano cablati: mostravano data, ora e
                            IP di una firma che non era quella del cliente collegato. */}
                        {eidasSeal?.signatureId && (
                          <span style={{ fontSize: 11, color: '#34d399', fontFamily: 'monospace' }}>{eidasSeal.signatureId}</span>
                        )}
                      </div>
                      <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 }}>Engagement Letter & Proposta d'Ordine Iniziale (v1.0)</h3>
                      {eidasSeal?.timestampIso ? (
                        <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 4 }}>
                          Stipulato il: <strong>{new Date(eidasSeal.timestampIso).toLocaleString('it-IT')}</strong>
                          {eidasSeal.sha256Digest && <> · Impronta SHA-256: <span style={{ fontFamily: 'monospace' }}>{String(eidasSeal.sha256Digest).slice(0, 16)}…</span></>}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>
                          Firma registrata su questo dispositivo, ma il sigillo di firma non è disponibile:
                          non possiamo mostrarne marca temporale né impronta. Richiedi allo studio la copia con evidenza di firma.
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={async () => {
                          const studio = getStudioInfoForTenant();
                          const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                          const rawLogo = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? `${window.location.origin}/logo.png` : '');
                          const logoHtml = rawLogo
                            ? `<img src="${rawLogo}" style="max-height:55px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />`
                            : `<div style="font-size:20px;font-weight:800;color:#1e1b4b;margin-bottom:8px;">🏛 ${studio.ragioneSociale.toUpperCase()}</div>`;
                          const htmlContent = `
                            <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                              <div>
                                ${logoHtml}
                                <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY</div>
                                <div style="font-size:11px;color:#475569;margin-top:2px;">${studio.sedeLegale}</div>
                              </div>
                              <div style="text-align:right;">
                                <div style="font-size:16px;font-weight:800;color:#4338ca;">ENGAGEMENT LETTER v1.0 (CONGELATO)</div>
                                <div style="font-size:12px;font-weight:700;margin-top:2px;">Cliente: ${clientName}</div>
                                <div style="font-size:10px;color:#166534;margin-top:2px;">✓ FIRMATO DIGITALMENTE E CONGELATO</div>
                              </div>
                            </div>
                            <p style="margin-top:20px;line-height:1.6;">Si attesta la stipula ed il congelamento immutabile dell'Engagement Letter professionale per l'avvio delle attività di consulenza patrimoniale.</p>
                          `;
                          // Le evidenze di firma vengono SOLO dal sigillo di firma emesso dal server.
                          // Prima erano due firmatari cablati con data e indirizzi IP inventati, e la
                          // controfirma dello studio non esiste in nessun registro: il PDF attestava
                          // una firma che nessuno aveva apposto. Senza sigillo il PDF esce senza
                          // pagina di evidenze, non con evidenze finte.
                          const evidenzeFirma = eidasSeal?.timestampIso
                            ? [{
                                signerName: eidasSeal.signerName || clientName,
                                signerRole: 'Cliente Incarico (Legale Rappresentante)',
                                timestamp: new Date(eidasSeal.timestampIso).toLocaleString('it-IT'),
                                ipAddress: eidasSeal.ipAddress || 'non registrato',
                              }]
                            : [];
                          await downloadRealPdf(`Engagement_Letter_v1.0_${clientName.replace(/\s+/g, '_')}`, htmlContent, evidenzeFirma);
                        }}
                        style={{ background: '#166534', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        📥 Scarica PDF Contratto Congelato v1.0
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6ee7b7', textTransform: 'uppercase', marginBottom: 8 }}>
                    Moduli Inclusi nel Contratto Base (Stipula Iniziale):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {moduliProposti.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 6 }}>
                        Nessun modulo è ancora stato istanziato su questo progetto: l'elenco delle
                        prestazioni comparirà qui appena lo Studio lo predispone.
                      </div>
                    ) : moduliProposti.map((m, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 6 }}>
                        <span>✓ {m.nome} ({m.cat})</span>
                        <span style={{ fontWeight: 700 }}>{fmt(m.prezzo)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#34d399', textAlign: 'right' }}>
                    Valore Base Congelato: {fmt(totalValue)}
                  </div>
                </div>

                {/* 📜 ADDENDUM D'ORDINE — richieste del cliente gestite dallo studio (§2.5) */}
                <div style={{ borderTop: '2px dashed var(--border)', paddingTop: 20, marginTop: 24 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>📜 Richieste d'Integrazione & Addendum</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      Descrivi la modifica o il modulo aggiuntivo che ti serve: lo studio preparerà l'addendum e lo troverai qui, pronto per la firma.
                    </div>
                  </div>

                  {addendumErrore && (
                    <div style={{ background: '#2d1516', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 10, padding: 10, fontSize: 11, marginBottom: 14 }}>
                      ⚠️ {addendumErrore}
                    </div>
                  )}

                  <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <textarea
                      value={nuovaRichiestaAddendum}
                      onChange={(e) => setNuovaRichiestaAddendum(e.target.value)}
                      placeholder="Es. Vorrei aggiungere il modulo Tax Refund Malta al contratto in corso…"
                      rows={3}
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', outline: 'none' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {progettoAttivo ? (<>Riferimento progetto: <b style={{ color: 'var(--text)' }}>{progettoAttivo.nome}</b></>) : 'La richiesta sarà agganciata al progetto attivo del portale'}
                      </div>
                      <button
                        onClick={() => void inviaNuovaRichiestaAddendum()}
                        disabled={invioAddendum || !nuovaRichiestaAddendum.trim()}
                        style={{ background: invioAddendum || !nuovaRichiestaAddendum.trim() ? 'var(--muted)' : 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: invioAddendum || !nuovaRichiestaAddendum.trim() ? 'default' : 'pointer', opacity: invioAddendum ? 0.6 : 1 }}
                      >
                        {invioAddendum ? 'Invio in corso…' : '➕ Invia richiesta allo studio'}
                      </button>
                    </div>
                    {addendumMsg && (
                      <div style={{ fontSize: 11, marginTop: 8, fontWeight: 600, color: addendumMsg.type === 'success' ? '#34d399' : '#fca5a5' }}>
                        {addendumMsg.text}
                      </div>
                    )}
                  </div>

                  {addendums.length === 0 ? (
                    <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
                      Nessuna richiesta di addendum inviata. Il contratto base è attualmente la versione attiva.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {addendums.map((add) => {
                        const badgeStato: Record<string, { testo: string; colore: string; sfondo: string }> = {
                          richiesta: { testo: '📨 INVIATA — IN ATTESA', colore: '#000', sfondo: 'var(--amber)' },
                          in_preparazione: { testo: '⚙️ IN PREPARAZIONE', colore: '#fff', sfondo: 'var(--indigo)' },
                          pronta: { testo: '✅ PRONTA', colore: '#000', sfondo: '#34d399' },
                          rifiutata: { testo: '⛔ RIFIUTATA', colore: '#fff', sfondo: '#b91c1c' },
                        };
                        const badge = badgeStato[add.stato] ?? badgeStato.richiesta;
                        return (
                          <div key={add.id} style={{ background: add.stato === 'pronta' ? '#0d2d22' : 'var(--card2)', border: `1px solid ${add.stato === 'pronta' ? '#1a5c3c' : 'var(--border)'}`, borderRadius: 12, padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                              <span style={{ background: badge.sfondo, color: badge.colore, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10 }}>
                                {badge.testo}
                              </span>
                              {add.progetto && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 10 }}>
                                  {add.progetto.nome}
                                </span>
                              )}
                              <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>Richiesta del {dataOraLeggibile(add.createdAt)}</span>
                            </div>

                            <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: add.rispostaStudio ? 10 : 0 }}>
                              {add.testoRichiesta}
                            </div>

                            {add.rispostaStudio && (
                              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
                                <b style={{ color: 'var(--text)' }}>Risposta dello studio:</b>{' '}
                                <span style={{ whiteSpace: 'pre-wrap' }}>{add.rispostaStudio}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {/* 🛡️ GUIDA STEP-BY-STEP PER IL CLIENTE NELLE FIRME */}
                <div style={{ background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.7), rgba(49, 46, 129, 0.45))', border: '1px solid #4338ca', borderRadius: 14, padding: 18, marginBottom: 22 }}>
                  <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
                    📋 Guida Rapida alla Sottoscrizione Digitale (3 Semplici Passaggi)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', marginBottom: 4 }}>1️⃣ Revisione Condizioni</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Esamina i moduli inclusi, le tariffe trasparenti e le clausole dell'incarico.</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', marginBottom: 4 }}>2️⃣ Verifica OTP Sicuro</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Ricevi un codice temporaneo a 6 cifre via WhatsApp o Email certificata.</div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>3️⃣ Firma con OTP verificata</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>Apponi la firma elettronica semplice (OTP verificata · art. 20 CAD) e scarica l'attestazione PDF.</div>
                    </div>
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 700, letterSpacing: '.5px', marginBottom: 4 }}>
                      {/* §2.8: il numero della lettera d'incarico è del progetto, assegnato dal
                          backend alla creazione. Prima era cablato EL-2026-089 per tutti. */}
                      ENGAGEMENT LETTER & PROPOSTA D'ORDINE N. {progettoAttivo?.numeroContratto || '— numero in assegnazione —'}
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Dettaglio Incarico Professionale & Moduli Spettanti</h2>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      Studio Erogante: <strong>{getStudioInfoForTenant().ragioneSociale}</strong> · Advisor Lead: <strong>{getStudioInfoForTenant().leadAdvisor}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Giurisdizione Incarico:</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>{getStudioInfoForTenant().giurisdizione}</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  {moduliProposti.length === 0
                    ? 'Moduli di Consulenza — nessuno ancora istanziato su questo progetto'
                    : `Moduli di Consulenza Incorporati (${moduliProposti.length}) — Clicca su ciascun modulo per esaminare l'attività svolta dall'operatore`}
                </div>

                {moduliProposti.length === 0 && (
                  <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 18, fontSize: 12, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
                    Questo progetto non ha ancora moduli operativi a database. Non compaiono
                    prestazioni, operatori né percentuali di avanzamento perché non ce ne sono:
                    appena lo Studio istanzia i moduli dell'incarico li trovi qui, ciascuno con
                    il proprio stato reale.
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {moduliProposti.map((m, idx) => {
                    const isSigned = moduleSignatures[m.id]?.firmato;
                    const isDone = isSigned || m.stato === 'completato';
                    return (
                      <div
                        key={m.id || idx}
                        onClick={() => setSelectedModule(m)}
                        style={{
                          background: isSigned ? '#0d2d22' : 'var(--card2)',
                          border: isSigned ? '1.5px solid #10b981' : isDone ? '1.5px solid #6366f1' : '1px solid var(--border)',
                          borderRadius: 12,
                          padding: '16px 18px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          transition: 'all .2s ease',
                          boxShadow: '0 2px 8px rgba(0,0,0,.2)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CatBadge cat={m.cat} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{m.nome}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isSigned ? (
                              <span style={{ background: '#10b981', color: '#064e3b', fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 12 }}>
                                ✓ CONCLUSO & FIRMATO
                              </span>
                            ) : isDone ? (
                              <span style={{ background: 'var(--amber)', color: '#000', fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 12 }}>
                                ✍️ CONCLUSO (DA FIRMARE)
                              </span>
                            ) : (
                              <span style={{ background: '#200f40', color: '#a78bfa', fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 12 }}>
                                ⏱ IN LAVORAZIONE ({m.percentuale ?? 0}%)
                              </span>
                            )}
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                          <div>
                            Include {m.righeCount} micro-prestazioni specialistiche · Stima: <strong>{m.ore}h</strong>
                            {m.operatore && <span> · Operatore: <strong style={{ color: 'var(--text)' }}>{m.operatore}</strong></span>}
                          </div>
                          <div style={{ color: 'var(--indigo-l)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>👁 Esamina attività operatore & firma</span> ➔
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: 'linear-gradient(135deg,#1a1f3d,#1e2045)', border: '1px solid #2d3260', borderRadius: 14, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>Valore Totale Complessivo Proposta d'Ordine</div>
                    <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8, marginTop: 2 }}>Nessun costo nascosto. Include assistenza fino al completamento.</div>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(totalValue)}</div>
                </div>

                {/* 📜 VISUALIZZATORE DOCUMENTALE ENGAGEMENT LETTER A4 */}
                <div style={{ marginTop: 24, marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>📜 Testo Integrale del Mandato Professionale (Engagement Letter da Esaminare)</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        Leggi attentamente le clausole, i moduli incorporati, i corrispettivi e le condizioni legali prima di apporre la firma.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await downloadRealPdf(`Engagement_Letter_Bozza_${clientName.replace(/\s+/g, '_')}`, getResolvedEngagementHtml());
                      }}
                      style={{
                        background: '#1a1f3d',
                        border: '1px solid #4338ca',
                        color: '#c7d2fe',
                        padding: '8px 16px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      📥 Scarica Bozza PDF A4
                    </button>
                  </div>

                  {/* Foglio A4 Renderizzato */}
                  <div
                    style={{
                      background: '#ffffff',
                      color: '#0f172a',
                      borderRadius: 12,
                      padding: '36px 32px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
                      border: '1px solid #cbd5e1',
                      maxHeight: 520,
                      overflowY: 'auto',
                      fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                    }}
                    dangerouslySetInnerHTML={{ __html: getResolvedEngagementHtml() }}
                  />
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Accettazione & Apposizione Firma Elettronica Semplice</div>
                  <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
                    Conferma la proposta contrattuale mediante <strong>Firma Elettronica Semplice (OTP verificata)</strong> ai sensi dell'art. 20 del CAD.
                  </p>

                  {/* ── COME VUOI FIRMARE (§1.3) ─────────────────────────────────── */}
                  <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>
                      ✍️ Scegli come firmare il mandato:
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                      {([
                        { id: 'otp' as const, icona: '📲', titolo: 'Firma online con codice OTP', nota: 'Ricevi un codice e firmi qui, in un minuto' },
                        { id: 'manuale_scansionata' as const, icona: '🖊', titolo: 'Scarica, firma a penna e ricarica', nota: 'Stampi il PDF, lo firmi e lo ricarichi' },
                        { id: 'qualificata_esterna' as const, icona: '🪪', titolo: 'Firma digitale del mio provider', nota: 'Aruba, InfoCert, Namirial, CNS…' },
                      ]).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { setModalitaFirma(m.id); setOtpError(null); }}
                          style={{
                            background: modalitaFirma === m.id ? '#1e1b4b' : 'var(--card)',
                            border: `1.5px solid ${modalitaFirma === m.id ? '#6366f1' : 'var(--border)'}`,
                            borderRadius: 10,
                            padding: '10px 14px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{m.icona}</span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: modalitaFirma === m.id ? '#a5b4fc' : 'var(--text)' }}>{m.titolo}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.nota}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {modalitaFirma === 'otp' ? (
                    <>
                      {/* 📲 SCELTA CANALE DI RICEZIONE DEL CODICE (§1.1, §1.4) */}
                      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>
                          📲 Dove vuoi ricevere il codice di firma?
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 10 }}>
                          La scelta è tua ogni volta. I recapiti sono quelli della tua scheda anagrafica.
                        </div>

                        {canaliFirma.length === 0 ? (
                          <div style={{ fontSize: 11.5, color: '#fbbf24', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 8, padding: 10 }}>
                            ⚠️ Non è stato possibile leggere i canali di invio disponibili. Ricarica la pagina o contatta lo Studio: senza un canale attivo il codice non può essere spedito.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                            {canaliFirma.map((c) => {
                              const stile: Record<CanaleOtp, { icona: string; sfondo: string; bordo: string; testo: string }> = {
                                whatsapp: { icona: '🟢', sfondo: '#0d2d22', bordo: '#059669', testo: '#34d399' },
                                email: { icona: '✉️', sfondo: '#1e1b4b', bordo: '#6366f1', testo: '#818cf8' },
                                telegram: { icona: '✈️', sfondo: '#0c2b3f', bordo: '#0ea5e9', testo: '#38bdf8' },
                              };
                              const s = stile[c.canale];
                              const scelto = otpCanale === c.canale;
                              return (
                                <button
                                  key={c.canale}
                                  type="button"
                                  disabled={!c.disponibile}
                                  title={c.disponibile ? undefined : c.motivo}
                                  onClick={() => { setOtpCanale(c.canale); setOtpError(null); setUsaRecapitoDiverso(false); }}
                                  style={{
                                    background: scelto ? s.sfondo : 'var(--card)',
                                    border: `1.5px solid ${scelto ? s.bordo : 'var(--border)'}`,
                                    borderRadius: 10,
                                    padding: '10px 14px',
                                    textAlign: 'left',
                                    cursor: c.disponibile ? 'pointer' : 'not-allowed',
                                    opacity: c.disponibile ? 1 : 0.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                  }}
                                >
                                  <span style={{ fontSize: 20 }}>{s.icona}</span>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: scelto ? s.testo : 'var(--text)' }}>
                                      {nomeCanale[c.canale]}
                                    </div>
                                    {/* Il recapito è mascherato: serve a farti riconoscere il tuo, non a mostrarlo per intero. */}
                                    <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {c.disponibile ? c.recapitoMascherato : c.motivo}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Recapito diverso da quello in anagrafica (§1.2) */}
                        {canaleCorrente?.disponibile && otpCanale !== 'telegram' && (
                          <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={usaRecapitoDiverso}
                                onChange={(e) => { setUsaRecapitoDiverso(e.target.checked); setRecapitoDichiarato(''); }}
                              />
                              <span>
                                {otpCanale === 'email'
                                  ? "Voglio ricevere il codice a un altro indirizzo email"
                                  : 'Voglio ricevere il codice su un altro numero'}
                              </span>
                            </label>
                            {usaRecapitoDiverso && (
                              <div style={{ marginTop: 8 }}>
                                <input
                                  type={otpCanale === 'email' ? 'email' : 'tel'}
                                  value={recapitoDichiarato}
                                  onChange={(e) => setRecapitoDichiarato(e.target.value)}
                                  placeholder={otpCanale === 'email' ? 'nome@dominio.it' : '+39 ...'}
                                  style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', minWidth: 260 }}
                                />
                                <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 6, lineHeight: 1.4 }}>
                                  Il recapito che indichi qui viene registrato nel verbale di firma come dichiarato da te
                                  e diverso da quello della tua scheda anagrafica.
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Telegram: la chat va attivata dal cliente, il codice non può arrivare prima */}
                        {otpCanale === 'telegram' && !canaleCorrente?.disponibile && botTelegram && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            Per usare questo canale scrivi una volta a{' '}
                            <a href={`https://t.me/${botTelegram}`} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontWeight: 700 }}>
                              @{botTelegram}
                            </a>{' '}
                            e poi ricarica la pagina.
                          </div>
                        )}
                      </div>

                      {otpError && !otpModalOpen && (
                        <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                          ⚠️ {otpError}
                        </div>
                      )}

                      <button
                        // Il bersaglio va dichiarato qui e non lasciato a quello che c'è in stato:
                        // dopo aver firmato un documento del fascicolo `bersaglioFirma` punta
                        // ancora a quel documento, e il mandato finirebbe registrato con
                        // l'ambito e il riferimento di un altro atto.
                        onClick={() => inviaCodiceFirma({ bersaglio: { ambito: 'engagement_letter', titolo: TITOLO_MANDATO } })}
                        disabled={loading || otpLoading || !canaleCorrente?.disponibile || (usaRecapitoDiverso && !recapitoDichiarato.trim())}
                        style={{
                          background: canaleCorrente?.disponibile ? 'var(--indigo)' : 'var(--card)',
                          color: canaleCorrente?.disponibile ? '#fff' : 'var(--muted)',
                          border: canaleCorrente?.disponibile ? 'none' : '1px solid var(--border)',
                          padding: '12px 28px',
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: canaleCorrente?.disponibile ? 'pointer' : 'not-allowed',
                          boxShadow: canaleCorrente?.disponibile ? '0 4px 20px rgba(99,102,241,.4)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span>
                          {otpLoading
                            ? 'Invio del codice in corso…'
                            : `📲 Invia il codice via ${nomeCanale[otpCanale]} e firma`}
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* FIRMA A PENNA O CON PROVIDER ESTERNO: SCARICA, FIRMA, RICARICA */}
                      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
                          {modalitaFirma === 'manuale_scansionata' ? (
                            <>
                              <strong style={{ color: 'var(--text)' }}>1.</strong> Scarica il PDF del mandato ·{' '}
                              <strong style={{ color: 'var(--text)' }}>2.</strong> Firmalo a penna ·{' '}
                              <strong style={{ color: 'var(--text)' }}>3.</strong> Ricarica qui la scansione o la foto.
                            </>
                          ) : (
                            <>
                              <strong style={{ color: 'var(--text)' }}>1.</strong> Scarica il PDF del mandato ·{' '}
                              <strong style={{ color: 'var(--text)' }}>2.</strong> Firmalo con il tuo dispositivo o servizio
                              di firma digitale (.p7m o PDF firmato) · <strong style={{ color: 'var(--text)' }}>3.</strong> Ricaricalo qui.
                            </>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              await downloadRealPdf(`Mandato_${clientName.replace(/\s+/g, '_')}`, getResolvedEngagementHtml());
                            }}
                            style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '10px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                          >
                            📥 Scarica il PDF da firmare
                          </button>

                          <label style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                            📎 {fileFirmato ? 'Cambia file' : 'Carica il documento firmato'}
                            <input
                              type="file"
                              accept={modalitaFirma === 'manuale_scansionata' ? 'application/pdf,image/png,image/jpeg' : 'application/pdf,.p7m'}
                              style={{ display: 'none' }}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) { setOtpError(null); await leggiFileFirmato(file); }
                              }}
                            />
                          </label>

                          {fileFirmato && (
                            <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>✓ {fileFirmato.nome}</span>
                          )}
                        </div>

                        {modalitaFirma === 'qualificata_esterna' && (
                          // Detto come sta: il certificato non viene verificato dalla piattaforma, e questo
                          // finisce scritto anche nel verbale. Prometterne la validazione sarebbe una firma
                          // dichiarata valida da noi senza che nessuno l'abbia controllata.
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                            La validità della firma qualificata è attestata dal tuo provider. La piattaforma
                            registra la ricezione del file da questa sessione autenticata e ne calcola
                            l'impronta, ma non verifica il certificato di firma.
                          </div>
                        )}
                      </div>

                      {otpError && (
                        <div style={{ fontSize: 11.5, color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                          ⚠️ {otpError}
                        </div>
                      )}

                      <button
                        onClick={() => confermaFirmaConFile()}
                        disabled={!fileFirmato || caricamentoFirmato}
                        style={{
                          background: fileFirmato ? 'var(--indigo)' : 'var(--card)',
                          color: fileFirmato ? '#fff' : 'var(--muted)',
                          border: fileFirmato ? 'none' : '1px solid var(--border)',
                          padding: '12px 28px',
                          borderRadius: 10,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: fileFirmato ? 'pointer' : 'not-allowed',
                          boxShadow: fileFirmato ? '0 4px 20px rgba(99,102,241,.4)' : 'none',
                        }}
                      >
                        {caricamentoFirmato ? 'Caricamento e registrazione…' : '🔒 Deposita il documento firmato'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Avanzamento Live Lavori */}
        {activeTab === 'avanzamento' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📊 Stato Avanzamento Lavori in Tempo Reale</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>
              Monitora le prestazioni specialistiche e i passaggi eseguiti dall'advisor per ciascun modulo. Clicca su un modulo per visualizzare i dettagli o firmare la conclusione dell'operazione.
            </div>

            {/* Progress Bar — percentuale calcolata dal backend (§16), non una soglia minima */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                <span>Progresso Generale Fascicoli & Incarico</span>
                <span style={{ color: 'var(--indigo-l)', fontWeight: 800 }}>
                  {moduliProposti.length === 0
                    ? 'Non ancora avviato'
                    : `${percentualeProgetto}%${percentualeProgetto >= 100 ? ' Concluso' : ' in lavorazione'}`}
                </span>
              </div>
              <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${percentualeProgetto}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--indigo), #34d399)',
                    borderRadius: 10,
                    transition: 'width .3s ease',
                  }}
                />
              </div>
            </div>

            {/* Elenco Moduli con Avanzamento Live e Click per Dettagli */}
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 12 }}>
              Fascicoli Operativi in Corso & Conclusi ({moduliProposti.length})
            </div>

            {moduliProposti.length === 0 && (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 18, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                Non ci sono ancora fascicoli operativi aperti su questo progetto. Quando lo Studio
                avvia le lavorazioni trovi qui i moduli, con le micro-fasi effettivamente eseguite
                e l'operatore che le ha svolte.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {moduliProposti.map((m, idx) => {
                const isSigned = moduleSignatures[m.id]?.firmato;
                const isDone = isSigned || m.stato === 'completato';
                // Solo passaggi reali: quando il modulo non ha micro-voci a database l'elenco
                // resta vuoto invece di essere rimpiazzato da fasi cablate già spuntate.
                const passaggi = m.passaggi || [];
                const passaggiCompletati = isSigned ? passaggi.length : passaggi.filter(p => p.completato).length;

                return (
                  <div
                    key={m.id || idx}
                    onClick={() => setSelectedModule(m)}
                    style={{
                      background: isSigned ? '#0d2d22' : 'var(--card2)',
                      border: isSigned ? '1.5px solid #10b981' : isDone ? '1.5px solid #6366f1' : '1px solid var(--border)',
                      borderRadius: 14,
                      padding: 18,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      boxShadow: '0 4px 14px rgba(0,0,0,.25)',
                      transition: 'all .2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: isSigned ? '#10b981' : isDone ? '#4338ca' : 'var(--card)',
                            color: isSigned ? '#064e3b' : '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: 14,
                          }}
                        >
                          {isSigned ? '✓' : isDone ? '✍️' : idx + 1}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <CatBadge cat={m.cat} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{m.nome}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {m.operatore
                              ? <>Operatore: <strong style={{ color: 'var(--text)' }}>{m.operatore}</strong> · </>
                              : <>Operatore non ancora assegnato · </>}
                            Stima: {m.ore}h
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {isSigned ? (
                          <span style={{ background: '#10b981', color: '#064e3b', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                            ✓ CONCLUSO & VALIDATO
                          </span>
                        ) : isDone ? (
                          <span style={{ background: 'var(--amber)', color: '#000', fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 12 }}>
                            ✍️ ATTIVITÀ CONCLUSE (DA FIRMARE)
                          </span>
                        ) : (
                          <span style={{ background: '#200f40', color: '#a78bfa', fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 12 }}>
                            ⏱ IN LAVORAZIONE ({m.percentuale ?? 0}%)
                          </span>
                        )}
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(m.prezzo)}</div>
                      </div>
                    </div>

                    {/* Mini Avanzamento Passaggi & Documenti */}
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--muted)' }}>
                          Progressione operativa: <strong style={{ color: '#34d399' }}>{passaggiCompletati}/{passaggi.length} micro-fasi</strong>
                        </span>
                        {m.deliverables && m.deliverables.length > 0 && (
                          <span style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#c7d2fe', padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: 10 }}>
                            📄 {m.deliverables.length} atto/i pubblicato/i
                          </span>
                        )}
                      </div>
                      <div style={{ color: 'var(--indigo-l)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>👁 Visualizza attività & documenti</span> ➔
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: Form Dati Societari */}
        {activeTab === 'form' && (
          <div style={docBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📋 Dati Societari e KYC</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Le modifiche diventano una <b>proposta</b>: i nuovi valori entrano in anagrafica solo dopo la conferma dello studio. IBAN e titolare effettivo sono mascherati.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMostraDatiSensibili(!mostraDatiSensibili)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {mostraDatiSensibili ? '🙈 Nascondi dati sensibili' : '👁 Mostra dati sensibili'}
              </button>
            </div>
            <div style={{ height: 14 }} />

            {formSaved && (
              <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
                ✓ Proposta inviata allo studio!
              </div>
            )}

            {propostaMsg && (
              <div style={{ background: propostaMsg.type === 'success' ? '#0d2d22' : '#2d1516', border: `1px solid ${propostaMsg.type === 'success' ? '#1a5c3c' : '#7f1d1d'}`, color: propostaMsg.type === 'success' ? '#34d399' : '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
                {propostaMsg.text}
              </div>
            )}

            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ragione Sociale Entità *</label>
                  <input value={bozzaDati.ragioneSociale} onChange={e => setBozzaDati({ ...bozzaDati, ragioneSociale: e.target.value })} required />
                  {propostaInAttesa('ragioneSociale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('ragioneSociale')?.valoreProposto}»</div>}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / VAT Number *</label>
                  <input value={bozzaDati.piva} onChange={e => setBozzaDati({ ...bozzaDati, piva: e.target.value })} required />
                  {propostaInAttesa('piva') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('piva')?.valoreProposto}»</div>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Legale Rappresentante *</label>
                  <input value={bozzaDati.legaleRappresentante} onChange={e => setBozzaDati({ ...bozzaDati, legaleRappresentante: e.target.value })} required />
                  {propostaInAttesa('legaleRappresentante') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('legaleRappresentante')?.valoreProposto}»</div>}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Fiscale *</label>
                  <input value={bozzaDati.codiceFiscale} onChange={e => setBozzaDati({ ...bozzaDati, codiceFiscale: e.target.value })} required />
                  {propostaInAttesa('codiceFiscale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('codiceFiscale')?.valoreProposto}»</div>}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN per Operazioni / Accreditamento *</label>
                {mostraDatiSensibili ? (
                  <input value={bozzaDati.iban} onChange={e => setBozzaDati({ ...bozzaDati, iban: e.target.value })} style={{ fontFamily: 'monospace' }} required />
                ) : (
                  <input value={mascheraIban(formData.iban)} disabled style={{ fontFamily: 'monospace', opacity: 0.65 }} title="Usa «Mostra dati sensibili» per vedere o modificare l'IBAN" />
                )}
                {propostaInAttesa('iban') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa di conferma dello studio</div>}
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolare Effettivo (UBO) & Quota di Possesso *</label>
                {mostraDatiSensibili ? (
                  <input value={bozzaDati.titolareEffettivo} onChange={e => setBozzaDati({ ...bozzaDati, titolareEffettivo: e.target.value })} required />
                ) : (
                  <input value={mascheraUbo(formData.titolareEffettivo)} disabled style={{ opacity: 0.65 }} title="Usa «Mostra dati sensibili» per vedere o modificare il titolare effettivo" />
                )}
                {propostaInAttesa('titolareEffettivo') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa di conferma dello studio</div>}
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Sede Legale</label>
                <input value={bozzaDati.sedeLegale} onChange={e => setBozzaDati({ ...bozzaDati, sedeLegale: e.target.value })} />
                {propostaInAttesa('sedeLegale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('sedeLegale')?.valoreProposto}»</div>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="submit" disabled={invioProposta} style={{ background: invioProposta ? 'var(--muted)' : 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: invioProposta ? 'default' : 'pointer', opacity: invioProposta ? 0.6 : 1 }}>
                  {invioProposta ? 'Invio in corso…' : '➕ Invia proposte di modifica allo studio'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 4: Documenti Legali & Firme con Persistenza */}
        {activeTab === 'documenti' && (
          <div style={docBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📎 Vault Documenti Legali e Modelli In Incarico</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Visualizza, scarica, firma con <strong>firma elettronica semplice</strong> (lettura, codice sul canale che scegli, firma grafometrica) oppure <strong>ricarica il PDF firmato a mano</strong>. Le firme sono registrate a database e visibili allo studio.
                </div>
              </div>
              <button
                type="button"
                onClick={() => caricaDocumenti(clientObj?.id)}
                disabled={portalDocsCaricamento}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: portalDocsCaricamento ? 'default' : 'pointer' }}
              >
                {portalDocsCaricamento ? 'Aggiorno…' : '↻ Aggiorna elenco'}
              </button>
            </div>

            {/* Un errore di lettura non si traveste da fascicolo vuoto. */}
            {portalDocsErrore && (
              <div style={{ background: '#3b1219', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 12, padding: 14, fontSize: 12, marginBottom: 14 }}>
                <strong>Non riesco a leggere i tuoi documenti.</strong> {portalDocsErrore}
                <div style={{ marginTop: 6, color: '#fca5a5', fontSize: 11 }}>
                  Non significa che il fascicolo sia vuoto: riprova con «Aggiorna elenco» o avvisa lo studio.
                </div>
              </div>
            )}

            {!portalDocsErrore && portalDocs.length === 0 && (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 22, textAlign: 'center' }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  {portalDocsCaricamento ? 'Sto leggendo il tuo fascicolo…' : 'Nessun documento nel fascicolo'}
                </div>
                {!portalDocsCaricamento && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Lo studio non ha ancora caricato documenti sulle attività del tuo incarico.
                    Quando lo farà li troverai qui, con il testo integrale da leggere prima di firmare.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {portalDocs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    background: doc.firmato ? '#0d2d22' : 'var(--card2)',
                    border: `1px solid ${doc.firmato ? '#1a5c3c' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    transition: 'all .2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 26 }}>{doc.tipo === 'verbale_firma' ? '📜' : doc.firmato ? '🔒' : '📄'}</div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{doc.nome}</span>
                        <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>{doc.categoria}</span>
                        {doc.versione && doc.versione > 1 && (
                          doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setStoricoVersioniAperto(storicoVersioniAperto === doc.id ? null : doc.id)}
                              title="Mostra o nascondi le versioni precedenti di questo documento"
                              style={{ fontSize: 10, background: 'var(--card)', padding: '2px 8px', borderRadius: 6, color: '#818cf8', fontWeight: 700, border: '1px solid #4338ca55', cursor: 'pointer' }}
                            >
                              🕘 v{doc.versione} · {doc.versioniPrecedenti.length} precedent{doc.versioniPrecedenti.length === 1 ? 'e' : 'i'}
                            </button>
                          ) : (
                            <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>v{doc.versione}</span>
                          )
                        )}
                      </div>
                      {/* Da quale attività dell'incarico arriva il documento: il cliente sa a cosa
                          si riferisce senza doverlo chiedere. */}
                      {doc.modulo && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                          {doc.modulo}{doc.progetto ? ` · ${doc.progetto}` : ''}
                        </div>
                      )}
                      <div style={{ fontSize: 10.5, color: doc.firmato ? '#a7f3d0' : 'var(--muted)', marginTop: 3 }}>
                        {doc.firmato
                          ? `✓ Firmato${doc.dataFirma ? ` il ${dataOraLeggibile(doc.dataFirma)}` : ''}${doc.canaleVerificato ? ` · ${doc.canaleVerificato}` : ''}`
                          : doc.tipo === 'verbale_firma'
                            ? '📜 Verbale di firma · atto certificativo della sottoscrizione, generato automaticamente'
                            : doc.statoScansione === 'in_corso'
                              ? '⏳ Controllo antivirus in corso: disponibile a breve'
                              : doc.statoScansione === 'infetto'
                                ? '⛔ Il controllo antivirus ha bloccato questo file: lo studio è stato avvisato'
                                : 'In attesa di lettura e sottoscrizione'}
                      </div>
                      {doc.documentoNonPiuDisponibile && (
                        <div style={{ fontSize: 10.5, color: '#fbbf24', marginTop: 3 }}>
                          Firma registrata: il file a cui si riferisce non è più nel fascicolo.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Apertura del documento vero. Prima questo pulsante mostrava un testo legale
                        composto dal portale: il file in archivio non veniva nemmeno aperto. */}
                    <button
                      type="button"
                      disabled={!urlFileArchivio(doc.fileUrl) || !doc.scaricabile}
                      title={
                        !doc.fileUrl
                          ? 'Nessun file allegato a questo documento'
                          : !doc.scaricabile
                            ? 'File non disponibile: controllo antivirus non superato o ancora in corso'
                            : undefined
                      }
                      onClick={() => setSelectedViewerDoc(doc)}
                      style={{
                        background: '#1a1f3d',
                        border: '1px solid #4338ca',
                        color: doc.scaricabile && doc.fileUrl ? '#c7d2fe' : '#6b7280',
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: doc.scaricabile && doc.fileUrl ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      👁 Apri il documento
                    </button>

                    {doc.scaricabile && urlFileArchivio(doc.fileUrl) && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => scaricaDocumentoPortaleApi(doc.id, 'pdf')}
                          style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          title="Scarica il PDF master generato dal motore (lo stesso file su cui è fissata l'impronta di firma)"
                        >
                          📥 PDF
                        </button>
                        {doc.fileDocxUrl && (
                          <button
                            type="button"
                            onClick={() => scaricaDocumentoPortaleApi(doc.id, 'docx')}
                            style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                            title="Scarica la copia Word (.docx) generata dal motore server-side"
                          >
                            📝 Word
                          </button>
                        )}
                      </div>
                    )}

                    {doc.firmato ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ background: '#064e3b', border: '1px solid #10b981', color: '#6ee7b7', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>🔒</span> FIRMATO{doc.dataFirma ? ` IL ${new Date(doc.dataFirma).toLocaleDateString('it-IT')}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSuccessSealModal({
                              // Il frontend non inventa evidenze legali: ciò che manca dal sigillo
                              // server resta vuoto e la ricevuta lo mostra come "non registrato".
                              signatureId: doc.signatureId || `SIG-${doc.id.slice(0, 8).toUpperCase()}`,
                              signerName: doc.firmatarioNome || clientName,
                              documentoTitolo: doc.titolo || doc.nome,
                              documentoHash: doc.documentoHash || '',
                              timestampIso: doc.dataFirma || '',
                              canaleVerificato: doc.canaleVerificato || 'Verifica codice OTP',
                              ipAddress: doc.ipAddress || '',
                              standard: doc.standard || 'Firma Elettronica Semplice (OTP verificata) · art. 20 CAD',
                              firmaGrafometricaPng: doc.firmaGrafometricaPng,
                              fileUrl: doc.fileUrl,
                              documentoId: doc.id,
                              fileDocxUrl: doc.fileDocxUrl,
                            });
                          }}
                          style={{ background: '#1e1b4b', border: '1px solid #6366f1', color: '#c7d2fe', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          📜 Ricevuta di firma
                        </button>
                      </div>
                    ) : doc.tipo === 'verbale_firma' ? (
                      /* Punto 2 piano gap — il verbale è un atto certificativo generato dal
                          sistema: si legge e si scarica, ma non si firma e non si manda in revisione. */
                      <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 700, background: '#1e1b4b', border: '1px solid #4338ca', padding: '7px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        📜 Verbale di firma · atto certificativo della sottoscrizione
                      </div>
                    ) : (
                      <>
                        {/* Richiedi Modifiche al documento */}
                        <button
                          type="button"
                          onClick={() => {
                            setModificaDocTarget(doc);
                            setModificaDocTesto('');
                          }}
                          style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                          title="Invia note o chiedi modifiche allo studio prima di firmare"
                        >
                          📝 Richiedi Modifiche
                        </button>

                        {/* La firma passa dal backend: codice sul canale scelto, impronta calcolata
                            dal server sul file in archivio, sigillo scritto a database. */}
                        <button
                          type="button"
                          disabled={!doc.richiedeFirma || otpLoading}
                          title={doc.richiedeFirma ? undefined : 'Documento non firmabile in questo momento'}
                          onClick={() => avviaFirmaDocumento(doc)}
                          style={{ background: doc.richiedeFirma ? 'var(--indigo)' : 'var(--card)', color: doc.richiedeFirma ? '#fff' : 'var(--muted)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: doc.richiedeFirma && !otpLoading ? 'pointer' : 'default', boxShadow: doc.richiedeFirma ? '0 2px 10px rgba(99,102,241,.3)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          ✍️ Firma con codice
                        </button>

                        <label style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>{caricamentoFirmato ? '⏳ Carico…' : '📤 Ricarica Firmato a Mano'}</span>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            style={{ display: 'none' }}
                            onChange={async e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              await leggiFileFirmato(file);
                              setBersaglioFirma({ ambito: 'documento_vault', titolo: doc.titolo || doc.nome, riferimentoId: doc.id });
                              setModalitaFirma('manuale_scansionata');
                              setDocumentoDaCaricare(doc);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {/* Storico Richieste di Modifica inviate per questo Documento */}
                  {doc.richiesteModifica && doc.richiesteModifica.length > 0 && (
                    <div style={{ width: '100%', background: '#18181b', border: '1px solid #3f3f46', borderRadius: 10, padding: 12, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>💬 Le tue note e richieste di modifica per questo atto:</span>
                      </div>
                      {doc.richiesteModifica.map((rm) => (
                        <div key={rm.id} style={{ background: 'var(--card2)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11 }}>
                          <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>«{rm.commento}»</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            <span>Inviata il {new Date(rm.creatoAt).toLocaleString('it-IT')}</span>
                            <span style={{ fontWeight: 700, color: rm.stato === 'risolta' ? '#34d399' : '#fbbf24' }}>
                              {rm.stato === 'risolta' ? '✓ Risolta dallo studio' : '⏳ In esame dallo studio'}
                            </span>
                          </div>
                          {rm.rispostaStudio && (
                            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', color: '#93c5fd', fontSize: 10.5 }}>
                              <strong>Riscontro Advisor:</strong> {rm.rispostaStudio}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* §WF-DOC — Cronologia delle versioni: il percorso del documento è sempre
                      ripercorribile all'indietro, dalla copia attuale fino a quella eventualmente
                      già sottoscritta. I dati arrivano dal server (catena documentoPadreId):
                      qui non viene inventato niente. */}
                  {doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 && storicoVersioniAperto === doc.id && (
                    <div style={{ width: '100%', background: 'var(--card)', border: '1px dashed #4338ca66', borderRadius: 10, padding: 12, marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🕘 Cronologia versioni — percorso del documento a ritroso
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ background: 'var(--card2)', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--text)' }}>v{doc.versione}</strong>
                          <span style={{ color: 'var(--muted)' }}>versione attuale{doc.caricatoIl ? ` · caricata il ${dataOraLeggibile(doc.caricatoIl)}` : ''}</span>
                          <span style={{ fontWeight: 700, color: doc.firmato ? '#34d399' : '#93c5fd' }}>
                            {doc.firmato
                              ? `✍️ Firmata${doc.dataFirma ? ` il ${dataOraLeggibile(doc.dataFirma)}` : ''}`
                              : 'In attesa di firma'}
                          </span>
                        </div>
                        {doc.versioniPrecedenti.map((v) => (
                          <div key={v.id} style={{ background: 'transparent', padding: '5px 12px 5px 22px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--muted)' }}>
                            <span style={{ color: '#4338ca' }}>↳</span>
                            <strong style={{ color: 'var(--muted)' }}>v{v.versione}</strong>
                            <span>{v.caricatoIl ? `caricata il ${dataOraLeggibile(v.caricatoIl)}` : 'data di caricamento non disponibile'}</span>
                            {v.firmatoAt ? (
                              <span style={{ fontWeight: 700, color: '#34d399' }}>✍️ Firmata il {dataOraLeggibile(v.firmatoAt)}</span>
                            ) : (
                              <span style={{ color: '#71717a' }}>nessuna firma registrata su questa versione</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Fatture & Stato Pagamenti (§2.11) */}
        {activeTab === 'fatture' && (
          <div style={docBoxStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💳 Fatture & Stato dei Pagamenti</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Le fatture emesse sui tuoi incarichi, con l'importo, lo stato di incasso e la prossima scadenza. Le bozze non ancora emesse restano allo studio.
                </div>
              </div>
              <button
                type="button"
                onClick={() => caricaFatturePortale(clientObj?.id)}
                disabled={fattureCaricamento}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: fattureCaricamento ? 'default' : 'pointer' }}
              >
                {fattureCaricamento ? 'Aggiorno…' : '↻ Aggiorna'}
              </button>
            </div>

            {fattureErrore && (
              <div style={{ background: '#3b1219', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 12, padding: 14, fontSize: 12, marginBottom: 14 }}>
                <strong>Non riesco a leggere le fatture.</strong> {fattureErrore}
              </div>
            )}

            {!fattureErrore && fatturePortale.length === 0 && (
              <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 22, textAlign: 'center' }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>🧾</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  {fattureCaricamento ? 'Sto leggendo le fatture…' : 'Nessuna fattura emessa'}
                </div>
                {!fattureCaricamento && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Lo studio non ha ancora emesso fatture sui tuoi incarichi. Quando lo farà le troverai qui, con lo stato di pagamento.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {fatturePortale.map((f) => (
                <div
                  key={f.id}
                  style={{
                    background: f.pagata ? '#0d2d22' : 'var(--card2)',
                    border: `1px solid ${f.pagata ? '#1a5c3c' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 22 }}>{f.tipoDocumento === 'nota_credito' ? '↩️' : '🧾'}</div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          {f.tipoDocumento === 'nota_credito' ? 'Nota di Credito' : 'Fattura'} {f.numero}
                        </span>
                        {f.progetto && (
                          <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>{f.progetto}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: f.pagata ? '#a7f3d0' : 'var(--muted)', marginTop: 3 }}>
                        {f.data ? `Emessa il ${new Date(f.data).toLocaleDateString('it-IT')}` : 'Data non indicata'}
                        {f.pagata
                          ? ' · ✓ Pagata'
                          : f.prossimaScadenza
                            ? ` · Scadenza ${new Date(f.prossimaScadenza.dataScadenza).toLocaleDateString('it-IT')} (${fmt(f.prossimaScadenza.importoCentesimi / 100)})`
                            : ' · In attesa di pagamento'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        background: f.pagata ? '#10b981' : 'var(--amber)',
                        color: '#000',
                        fontSize: 10.5,
                        fontWeight: 800,
                        padding: '3px 9px',
                        borderRadius: 12,
                      }}
                    >
                      {f.pagata ? '✓ INCASSATA' : '⏳ DA INCASSARE'}
                    </span>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(f.totaleCentesimi / 100)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: Contatto Advisor & Messaggistica Live */}
        {activeTab === 'contatti' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💬 Assistenza Dedicata & Comunicazioni Dirette Studio</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>Invia messaggi in tempo reale al tuo Advisor di riferimento. La conversazione è sincronizzata con l'Advisor Hub dello Studio.</div>

            {/* §2.6 — Scheda Advisor costruita sui recapiti reali dello studio (riga del
                tenant), non su un nome e un telefono scritti a mano. Il pallino "Advisor
                Online" non c'è più: non riflette la presenza reale di nessuno. */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
                {(contattiStudio?.advisorNome || contattiStudio?.studio || '??')
                  .split(/\s+/)
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {contattiStudio?.advisorNome || 'Il tuo Advisor di riferimento'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600 }}>
                  {contattiStudio?.studio || 'Studio'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {[
                    contattiStudio?.advisorEmail ? `✉️ ${contattiStudio.advisorEmail}` : null,
                    contattiStudio?.telefono ? `📞 ${contattiStudio.telefono}` : null,
                    !contattiStudio?.advisorEmail && contattiStudio?.emailStudio ? `✉️ ${contattiStudio.emailStudio}` : null,
                  ].filter(Boolean).join('  ·  ') || 'Recapiti non ancora configurati dallo studio'}
                </div>
              </div>
            </div>

            {/* Live Chat Timeline */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto', marginBottom: 18 }}>
              {messaggi.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: 12 }}>
                  💬 Nessun messaggio scambiato finora. Scrivi qui sotto per contattare il tuo Advisor.
                </div>
              ) : (
                messaggi.map((m: any, idx: number) => {
                  const isCliente = m.direzione === 'entrata' || (m.mittente && m.mittente.includes('Cliente'));
                  return (
                    <div
                      key={m.id || idx}
                      style={{
                        alignSelf: isCliente ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        background: isCliente ? '#1e1b4b' : 'var(--card2)',
                        border: `1px solid ${isCliente ? '#4338ca' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: '10px 14px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: isCliente ? '#a5b4fc' : 'var(--indigo-l)' }}>
                          {/* §2.6: il mittente dello studio prende il nome vero se c'è, senza
                              inventare una persona. */}
                          {isCliente ? 'Tu (Cliente)' : (m.mittente || contattiStudio?.advisorNome || 'Studio (Advisor)')}
                        </span>
                        <span style={{ fontSize: 9.5, color: 'var(--muted)' }}>
                          {m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi')}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                        {m.testo}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Live Message Sender Form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!nuovoMessaggio.trim() || inviandoMessaggio) return;
                setInviandoMessaggio(true);

                // §2.6: il destinatario è lo studio reale (e il suo advisor se c'è), non un
                // nome cablato.
                const destinatarioStudio = contattiStudio?.advisorNome
                  ? `${contattiStudio.studio || 'Studio'} (${contattiStudio.advisorNome})`
                  : (contattiStudio?.studio || 'Studio');

                const msgObj = {
                  id: `msg-${Date.now()}`,
                  canale: canaleMessaggio,
                  mittente: `${clientName} (Cliente)`,
                  destinatario: destinatarioStudio,
                  direzione: 'entrata',
                  testo: nuovoMessaggio.trim(),
                  dataOra: new Date().toLocaleString('it-IT'),
                };

                setMessaggi(prev => [...prev, msgObj]);

                try {
                  await inviaComunicazioneApi(progettoId, {
                    canale: canaleMessaggio,
                    mittente: `${clientName} (Cliente)`,
                    destinatario: destinatarioStudio,
                    direzione: 'entrata',
                    testo: nuovoMessaggio.trim(),
                  });
                } catch (err) {
                  console.warn('Errore invio messaggio portale:', err);
                }

                setNuovoMessaggio('');
                setInviandoMessaggio(false);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Invia messaggio diretto all'Advisor:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Canale preferito:</span>
                  <select
                    value={canaleMessaggio}
                    onChange={(e) => setCanaleMessaggio(e.target.value as any)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    {/*
                      I tre ripieghi che stavano qui — un cellulare di una persona reale, un
                      indirizzo inventato e una @ costruita dal nome del cliente — comparivano
                      nella tendina di qualunque cliente che non avesse quel recapito in
                      anagrafica, e sceglierli significava chiedere l'invio a un estraneo. Ora
                      il canale senza recapito si vede spento e non è selezionabile.
                    */}
                    <option value="portal">🌐 Portale Riservato (Sicuro)</option>
                    {(() => {
                      const referenti = (clientObj as any)?.referentiJson || {};
                      const recapiti: Array<{ id: string; etichetta: string; valore?: string | null }> = [
                        { id: 'whatsapp', etichetta: '🟢 WhatsApp Business', valore: clientObj?.cellulare || referenti.whatsapp || clientObj?.telefono },
                        { id: 'email', etichetta: '✉️ Email', valore: clientObj?.email || referenti.email },
                        { id: 'telegram', etichetta: '✈️ Telegram', valore: clientObj?.telegram || referenti.telegram },
                      ];
                      return recapiti.map((r) => (
                        <option key={r.id} value={r.id} disabled={!r.valore}>
                          {r.etichetta} {r.valore ? `(${r.valore})` : '— recapito non presente in anagrafica'}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <textarea
                  value={nuovoMessaggio}
                  onChange={(e) => setNuovoMessaggio(e.target.value)}
                  placeholder="Scrivi qui la tua richiesta o domanda per l'Advisor..."
                  rows={2}
                  style={{ flex: 1, fontSize: 12, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'none' }}
                />
                <button
                  type="submit"
                  disabled={inviandoMessaggio || !nuovoMessaggio.trim()}
                  style={{
                    background: 'var(--indigo)',
                    color: '#fff',
                    border: 'none',
                    padding: '0 20px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: (!nuovoMessaggio.trim() || inviandoMessaggio) ? 0.6 : 1,
                  }}
                >
                  {inviandoMessaggio ? 'Invio...' : 'Invia →'}
                </button>
              </div>
            </form>

            {/* §2.6 — Sede legale dello studio: prima dai contatti reali letti dal tenant, con
                il ripiego locale solo se il backend non ha risposto. */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Sede Legale {contattiStudio?.studio || getStudioInfoForTenant().ragioneSociale}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                {contattiStudio?.sedeLegale || getStudioInfoForTenant().sedeLegale || 'Sede in fase di configurazione'}<br />
                {contattiStudio?.emailStudio ? `✉️ ${contattiStudio.emailStudio}` : (getStudioInfoForTenant().email ? `${getStudioInfoForTenant().email}` : '')}
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: Profilo & Password Personale Cliente */}
        {activeTab === 'profilo' && (
          <div style={docBoxStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>👤 Profilo Riservato & Sicurezza Accesso</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
              Gestisci i dati anagrafici del tuo account, i recapiti per le notifiche di sicurezza e imposta la tua password personale per accedere direttamente al portale.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              {/* Card Dati Anagrafici & Contatti */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🏛</span> Dati Intestatario & Recapiti
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Ragione Sociale / Intestatario</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', marginTop: 2 }}>{clientName}</div>
                  </div>

                  <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Email Principale Notifiche & OTP</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{clientObj?.email || loginEmail || 'Non specificata'}</div>
                  </div>

                  <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Telefono & WhatsApp di Sicurezza</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>
                      {clientObj?.cellulare || (clientObj as any)?.referentiJson?.whatsapp || clientObj?.telefono || 'Non configurato'}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Giurisdizione Incarico</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#818cf8', marginTop: 2 }}>{clientObj?.giurisdizione || 'Malta'}</div>
                    </div>
                    <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Stato Accesso Portale</div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: clientObj?.hasPassword ? '#34d399' : 'var(--amber)', marginTop: 2 }}>
                        {clientObj?.hasPassword ? '🟢 Password Attiva' : '⚪ Solo Magic Link'}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  ℹ️ Per modificare i dati anagrafici fiscali (P.IVA, SDI, Sede), puoi compilare la scheda <strong>📋 3. Form Dati Societari</strong> o richiedere l'aggiornamento all'Advisor.
                </div>
              </div>

              {/* Card Imposta / Cambia Password Portale */}
              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🔐</span> Imposta / Modifica Password Portale
                </div>

                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
                  Impostando una password personale potrai accedere direttamente al portale con la tua email (<strong>{clientObj?.email || loginEmail || clientName}</strong>) in qualsiasi momento, senza dover richiedere un nuovo Magic Link via email.
                </div>

                <form onSubmit={handleSaveClientPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {clientPassMsg && (
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        fontSize: 12,
                        background: clientPassMsg.type === 'success' ? '#0d2d22' : '#3b1c1c',
                        color: clientPassMsg.type === 'success' ? '#34d399' : '#f87171',
                        border: `1px solid ${clientPassMsg.type === 'success' ? '#059669' : '#ef4444'}`,
                      }}
                    >
                      {clientPassMsg.text}
                    </div>
                  )}

                  {clientObj?.hasPassword && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                        Password Attuale (se già impostata)
                      </label>
                      <input
                        type={clientPassShow ? 'text' : 'password'}
                        value={clientPassCurrent}
                        onChange={e => setClientPassCurrent(e.target.value)}
                        placeholder="Inserisci password attuale se la stai modificando"
                        style={{
                          width: '100%',
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: '9px 12px',
                          color: 'var(--text)',
                          fontSize: 12,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                        Nuova Password Portale * (min. 6 caratteri)
                      </label>
                      <button
                        type="button"
                        onClick={() => setClientPassShow(!clientPassShow)}
                        style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontSize: 10.5, cursor: 'pointer', padding: 0 }}
                      >
                        {clientPassShow ? '🙈 Nascondi' : '👁 Mostra'}
                      </button>
                    </div>
                    <input
                      type={clientPassShow ? 'text' : 'password'}
                      value={clientPassNew}
                      onChange={e => setClientPassNew(e.target.value)}
                      placeholder="es. PasswordSicura2026!"
                      required
                      style={{
                        width: '100%',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '9px 12px',
                        color: 'var(--text)',
                        fontSize: 12,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                      Conferma Nuova Password *
                    </label>
                    <input
                      type={clientPassShow ? 'text' : 'password'}
                      value={clientPassConfirm}
                      onChange={e => setClientPassConfirm(e.target.value)}
                      placeholder="Ripeti la nuova password"
                      required
                      style={{
                        width: '100%',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '9px 12px',
                        color: 'var(--text)',
                        fontSize: 12,
                        boxSizing: 'border-box',
                      }}
                    />
                    {clientPassConfirm && clientPassNew !== clientPassConfirm && (
                      <span style={{ fontSize: 10, color: '#f87171', marginTop: 4, display: 'block' }}>
                        ⚠ Le due password non coincidono.
                      </span>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={clientPassLoading || !clientPassNew || clientPassNew !== clientPassConfirm}
                    style={{
                      background: 'var(--indigo)',
                      color: '#fff',
                      border: 'none',
                      padding: '10px 18px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                      opacity: (!clientPassNew || clientPassNew !== clientPassConfirm || clientPassLoading) ? 0.6 : 1,
                      marginTop: 6,
                    }}
                  >
                    {clientPassLoading ? 'Salvataggio in corso...' : '🔒 Salva Password Portale'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 🔐 MODALE DI FIRMA ELETTRONICA SEMPLICE (SES) CON OTP */}
      {otpModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}>
          <div style={{
            background: 'var(--sidebar)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '28px 24px',
            width: '100%',
            maxWidth: 480,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            {/* Header Modale */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1e1b4b', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  🔐
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                    Firma Elettronica Semplice (OTP verificata)
                  </h3>
                  <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                    Art. 20 CAD — validità del documento informatico
                  </span>
                </div>
              </div>
              <button
                onClick={() => setOtpModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Selettore Canale di Recapito OTP (Switch immediato tra Email, WhatsApp e Telegram) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Scegli o cambia il canale di ricezione codice:</span>
                <span style={{ color: '#818cf8', fontWeight: 800 }}>{nomeCanale[otpCanale]}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { id: 'email' as const, label: '✉️ Email' },
                  { id: 'whatsapp' as const, label: '📱 WhatsApp' },
                  { id: 'telegram' as const, label: '✈️ Telegram' },
                ].map((c) => {
                  const isSelected = otpCanale === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={otpLoading}
                      onClick={async () => {
                        setOtpCanale(c.id);
                        setOtpError(null);
                        await inviaCodiceFirma({ canale: c.id, reinvio: true });
                      }}
                      style={{
                        padding: '8px 10px',
                        fontSize: 11.5,
                        fontWeight: isSelected ? 800 : 600,
                        background: isSelected ? 'var(--indigo)' : 'var(--card)',
                        color: isSelected ? '#fff' : 'var(--muted)',
                        border: isSelected ? '1.5px solid #818cf8' : '1px solid var(--border)',
                        borderRadius: 8,
                        cursor: otpLoading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Info Canale — validità e recapito sono quelli che ha detto il backend */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                {otpTarget ? (
                  <>
                    Codice monouso inviato via <strong>{nomeCanale[otpCanale]}</strong>
                    {otpValiditaSecondi > 0 ? (
                      <>
                        {' '}· scade fra{' '}
                        <strong>
                          {Math.floor(otpValiditaSecondi / 60)}:{String(otpValiditaSecondi % 60).padStart(2, '0')}
                        </strong>
                      </>
                    ) : (
                      <> · <strong style={{ color: '#fbbf24' }}>scaduto</strong>, richiedine uno nuovo</>
                    )}
                  </>
                ) : (
                  <>Il codice non è stato inviato: leggi il motivo qui sotto e riprova o cambia canale.</>
                )}
              </div>
              {otpTarget && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#a5b4fc', gap: 10 }}>
                  <span>{otpCanale === 'email' ? '📬 Inviato a:' : otpCanale === 'telegram' ? '✈️ Inviato a:' : '📱 Inviato a:'}</span>
                  <span>{otpTarget}</span>
                </div>
              )}
              {otpTargetDichiarato && (
                <div style={{ fontSize: 10.5, color: '#fbbf24', marginTop: 8, lineHeight: 1.4 }}>
                  Recapito dichiarato da te in fase di firma, diverso da quello in anagrafica: la circostanza
                  viene registrata nel verbale.
                </div>
              )}
            </div>

            {/* Input Codice OTP (Nessun codice pre-compilato, digitazione manuale) */}
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
                Inserisci il Codice a 6 Cifre ricevuto sul tuo dispositivo:
              </label>
              <input
                type="text"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ''));
                  setOtpError(null);
                }}
                placeholder="• • • • • •"
                style={{
                  width: '100%',
                  textAlign: 'center',
                  fontSize: 24,
                  fontWeight: 900,
                  letterSpacing: 10,
                  padding: '12px',
                  borderRadius: 10,
                  background: 'var(--card)',
                  color: 'var(--indigo-l)',
                  border: `2px solid ${otpError ? '#ef4444' : 'var(--indigo)'}`,
                  outline: 'none',
                }}
              />
              {otpError && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, fontWeight: 600 }}>
                  ⚠️ {otpError}
                </div>
              )}
            </div>

            {/* Note Legali SES — dette come stanno */}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.45, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
              {/*
                Il testo precedente dichiarava un "indirizzo IP certificato" e un'associazione
                "univoca" del documento al firmatario. Nessuna delle due cose è vera: l'IP è
                quello visto dal server, non certificato da nessuno, e può mancare; il fattore
                verificato è il possesso del recapito, non l'identità della persona. Una nota
                legale che promette più di quanto il sistema fa indebolisce il verbale, non lo
                rafforza — perché è la prima cosa che una contestazione va a leggere.
              */}
              🛡 Firmando dichiari di aver letto il documento. Vengono registrati: il codice monouso
              recapitato al tuo <strong>{nomeCanale[otpCanale].toLowerCase()}</strong>, la data e ora UTC,
              l'impronta SHA-256 del testo che stai leggendo, l'indirizzo IP visto dal server (o
              «non registrato», se la rete non lo espone) e il browser usato. La verifica attesta il
              possesso del recapito registrato nella tua scheda: è una Firma Elettronica Semplice
              con OTP verificata ai sensi dell'art. 20 del CAD, non una firma elettronica qualificata
              o avanzata.
            </div>

            {/* Azioni */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => {
                  if (!otpCode || otpCode.length < 6) {
                    setOtpError('Inserisci il codice completo a 6 cifre.');
                    return;
                  }
                  // La grafometrica viene raccolta DOPO il codice e allegata al sigillo (§1.11):
                  // da sola non prova nulla, dopo l'OTP è un elemento in più nel verbale.
                  setOtpError(null);
                  setPadGrafometricaAperto(true);
                }}
                disabled={loading || otpCode.length < 6}
                style={{
                  background: otpCode.length === 6 ? 'var(--indigo)' : 'var(--card)',
                  color: otpCode.length === 6 ? '#fff' : 'var(--muted)',
                  border: otpCode.length === 6 ? 'none' : '1px solid var(--border)',
                  padding: '14px',
                  borderRadius: 12,
                  fontSize: 13.5,
                  fontWeight: 800,
                  cursor: otpCode.length === 6 ? 'pointer' : 'not-allowed',
                  boxShadow: otpCode.length === 6 ? '0 4px 16px rgba(99,102,241,.4)' : 'none',
                }}
              >
                {loading ? 'Verifica del codice e apposizione del sigillo…' : '🔒 Prosegui: convalida il codice e firma'}
              </button>

              <button
                type="button"
                onClick={() => confermaFirmaConOtp()}
                disabled={loading || otpCode.length < 6}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 10.5, cursor: otpCode.length === 6 ? 'pointer' : 'not-allowed', textDecoration: 'underline' }}
              >
                Firma senza apporre la firma grafica
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)' }}>
                  Non hai ricevuto il codice?
                  {otpReinviiRimanenti !== null && (
                    <span style={{ marginLeft: 4 }}>
                      ({otpReinviiRimanenti} {otpReinviiRimanenti === 1 ? 'reinvio' : 'reinvii'} disponibili)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  // Il pulsante conosce i due limiti veri (§1.5): 60 secondi fra un reinvio e
                  // l'altro, massimo tre. Prima lanciava una `alert('✓ Nuovo codice inviato')`
                  // senza guardare l'esito, quindi diceva "inviato" anche su un rifiuto.
                  onClick={() => inviaCodiceFirma({ reinvio: true })}
                  disabled={otpLoading || otpAttesaReinvio > 0 || otpReinviiRimanenti === 0}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'var(--muted)' : 'var(--indigo-l)',
                    fontWeight: 700,
                    cursor: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'not-allowed' : 'pointer',
                    textDecoration: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'none' : 'underline',
                  }}
                >
                  {otpLoading
                    ? 'Invio…'
                    : otpReinviiRimanenti === 0
                      ? 'Reinvii esauriti'
                      : otpAttesaReinvio > 0
                        ? `Reinvia fra ${otpAttesaReinvio}s`
                        : 'Reinvia codice ↻'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✍️ PAD GRAFOMETRICO DELLA FIRMA SES — si apre col codice già digitato (§1.11) */}
      {padGrafometricaAperto && (
        <DigitalSignatureModal
          documentTitle={TITOLO_MANDATO}
          signerName={clientName}
          signerRole="Legale Rappresentante / Firmatario"
          zIndex={10000}
          notaRegistrazione="✓ Il tratto viene allegato al sigillo insieme al codice monouso che hai appena inserito, alla data e ora UTC e all'impronta SHA-256 del documento."
          onClose={() => setPadGrafometricaAperto(false)}
          onSigned={async (firma) => {
            // Il pad si chiude prima della chiamata: se la convalida rifiuta il codice
            // l'errore va letto nella modale di firma, che è dove sta il campo da correggere.
            setPadGrafometricaAperto(false);
            await confermaFirmaConOtp(firma.signatureImageBase64);
          }}
        />
      )}

      {/* 📄 MODALE A4 DOCUMENT VIEWER PER LETTURA COMPLETA PRE-FIRMA */}
      {selectedViewerDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
            {/* Top Modal Bar */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>📄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{selectedViewerDoc.titolo || selectedViewerDoc.nome}</h3>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {selectedViewerDoc.nome} · Cliente: <strong>{clientName}</strong> · Categoria: {selectedViewerDoc.categoria}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedViewerDoc(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Il file dell'archivio, mostrato per quello che è.
                Qui prima c'era l'HTML composto da `getResolvedDocumentHtml`: articoli e premesse
                inventati dal portale, mostrati al posto del documento che il cliente stava per
                firmare. Il browser mostra da sé i PDF e le immagini; per gli altri formati non si
                finge un'anteprima, si dice che va scaricato. */}
            <div style={{ flex: 1, overflow: 'hidden', padding: 16, background: '#0f172a', display: 'flex', justifyContent: 'center' }}>
              {(() => {
                const url = urlFileArchivio(selectedViewerDoc.fileUrl);

                if (!url) {
                  return (
                    <div style={{ alignSelf: 'center', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, maxWidth: 460, lineHeight: 1.7 }}>
                      A questo documento non è allegato nessun file.<br />
                      Se ti è stato chiesto di firmarlo, scrivilo allo studio dalla scheda Contatti: senza il file
                      la firma non può essere apposta.
                    </div>
                  );
                }

                return (
                  <iframe
                    src={url}
                    title={selectedViewerDoc.nome}
                    style={{ width: '100%', height: '100%', minHeight: 480, border: 'none', borderRadius: 8, background: '#ffffff' }}
                  />
                );
              })()}
            </div>

            {/* Bottom Modal Actions */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {urlFileArchivio(selectedViewerDoc.fileUrl) && (
                  <>
                    <button
                      type="button"
                      onClick={() => scaricaDocumentoPortaleApi(selectedViewerDoc.id, 'pdf')}
                      style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                      title="Scarica il PDF master generato dal motore (lo stesso file su cui è fissata l'impronta di firma)"
                    >
                      📥 Scarica PDF A4
                    </button>
                    {selectedViewerDoc.fileDocxUrl && (
                      <button
                        type="button"
                        onClick={() => scaricaDocumentoPortaleApi(selectedViewerDoc.id, 'docx')}
                        style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                        title="Scarica la copia Word (.docx) generata dal motore server-side"
                      >
                        📝 Scarica Word (.docx)
                      </button>
                    )}
                  </>
                )}

                {/* Pulsante Richiedi Modifiche integrato nel visualizzatore.
                    Il verbale di firma (punto 2 piano gap) non accetta revisioni. */}
                {!selectedViewerDoc.firmato && selectedViewerDoc.tipo !== 'verbale_firma' && (
                  <button
                    type="button"
                    onClick={() => {
                      setModificaDocTarget(selectedViewerDoc);
                      setModificaDocTesto('');
                    }}
                    style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '8px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    title="Invia note o chiedi modifiche allo studio prima di firmare"
                  >
                    📝 Richiedi Modifiche
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setSelectedViewerDoc(null)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Chiudi Lettura
                </button>

                {selectedViewerDoc.firmato ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                      ✓ Documento già sottoscritto{selectedViewerDoc.dataFirma ? ` il ${dataOraLeggibile(selectedViewerDoc.dataFirma)}` : ''}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSuccessSealModal({
                          // Stessa regola: niente evidenze inventate dal frontend.
                          signatureId: selectedViewerDoc.signatureId || `SIG-${selectedViewerDoc.id.slice(0, 8).toUpperCase()}`,
                          signerName: selectedViewerDoc.firmatarioNome || clientName,
                          documentoTitolo: selectedViewerDoc.titolo || selectedViewerDoc.nome,
                          documentoHash: selectedViewerDoc.documentoHash || '',
                          timestampIso: selectedViewerDoc.dataFirma || '',
                          canaleVerificato: selectedViewerDoc.canaleVerificato || 'Verifica codice OTP',
                          ipAddress: selectedViewerDoc.ipAddress || '',
                          standard: selectedViewerDoc.standard || 'Firma Elettronica Semplice (OTP verificata) · art. 20 CAD',
                          firmaGrafometricaPng: selectedViewerDoc.firmaGrafometricaPng,
                          fileUrl: selectedViewerDoc.fileUrl,
                          documentoId: selectedViewerDoc.id,
                          fileDocxUrl: selectedViewerDoc.fileDocxUrl,
                        });
                      }}
                      style={{ background: '#1e1b4b', border: '1px solid #6366f1', color: '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      📜 Ricevuta di firma
                    </button>
                  </div>
                ) : selectedViewerDoc.tipo === 'verbale_firma' ? (
                  /* Punto 2 piano gap — il verbale non si firma: attesta una firma già apposta. */
                  <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', padding: '8px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    📜 Atto certificativo · si consulta e si scarica
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!selectedViewerDoc.richiedeFirma || otpLoading}
                    onClick={() => avviaFirmaDocumento(selectedViewerDoc)}
                    style={{ background: selectedViewerDoc.richiedeFirma ? 'var(--indigo)' : 'var(--card)', color: selectedViewerDoc.richiedeFirma ? '#fff' : 'var(--muted)', border: 'none', padding: '8px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: selectedViewerDoc.richiedeFirma && !otpLoading ? 'pointer' : 'default', boxShadow: selectedViewerDoc.richiedeFirma ? '0 4px 14px rgba(99,102,241,.35)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {otpLoading ? 'Invio il codice…' : '✍️ Ho letto: ricevi il codice e firma'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📝 MODALE RICHIESTA MODIFICHE DOCUMENTO (Globale, zIndex: 11500) */}
      {modificaDocTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11500, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 540, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 25px 60px rgba(0,0,0,.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>📝 Richiedi Modifiche all'Atto</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{modificaDocTarget.nome}</div>
              </div>
              <button type="button" onClick={() => setModificaDocTarget(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleInviaRichiestaModifica} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5 }}>
                Descrivi con precisione quali clausole, dettagli o informazioni desideri rettificare. Lo studio riceverà la tua nota ed elaborerà una versione corretta prima della firma definitiva.
              </div>

              <textarea
                value={modificaDocTesto}
                onChange={e => setModificaDocTesto(e.target.value)}
                placeholder="Es. Vorrei rettificare l'indirizzo della sede legale al punto 2 e correggere la quota di partecipazione..."
                rows={5}
                required
                style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setModificaDocTarget(null)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={modificaDocInviando || !modificaDocTesto.trim()}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: modificaDocInviando || !modificaDocTesto.trim() ? 'not-allowed' : 'pointer' }}
                >
                  {modificaDocInviando ? 'Invio in corso…' : 'Invia Richiesta allo Studio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 📜 MODALE ATTESTAZIONE & RICEVUTA DI FIRMA (SES) */}
      {successSealModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 12000, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1.5px solid #10b981', borderRadius: 20, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 70px rgba(16,185,129,0.25)' }}>
            {/* Header Sigillo */}
            <div style={{ background: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)', padding: '20px 24px', borderBottom: '1px solid #059669', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#10b981', color: '#064e3b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, boxShadow: '0 4px 14px rgba(16,185,129,0.4)' }}>
                  ✓
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#ecfdf5' }}>
                    Documento Sottoscritto con Successo
                  </div>
                  <div style={{ fontSize: 11, color: '#6ee7b7', fontWeight: 600, marginTop: 2 }}>
                    Firma Elettronica Semplice (OTP verificata) · art. 20 CAD
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSuccessSealModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#a7f3d0', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Body Sigillo Certificato */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Atto Sottoscritto:</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', textAlign: 'right', maxWidth: '65%', wordBreak: 'break-word' }}>
                    📄 {successSealModal.documentoTitolo || 'Atto Studio'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Firmatario:</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe' }}>
                    👤 {successSealModal.signerName || clientName}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Data e Ora Registrazione (UTC):</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                    📅 {successSealModal.timestampIso ? new Date(successSealModal.timestampIso).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'medium' }) : 'Data e ora non registrate'}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Signature ID / Sigillo Univoco:</span>
                  <span style={{ fontSize: 11.5, fontFamily: 'monospace', fontWeight: 800, color: '#34d399', background: '#064e3b', padding: '2px 8px', borderRadius: 6 }}>
                    🔑 {successSealModal.signatureId}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Canale Autenticato:</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)' }}>
                    {successSealModal.canaleVerificato || 'Verifica codice OTP'}
                  </span>
                </div>

                {successSealModal.ipAddress && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Indirizzo IP Connessione:</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>
                      🌐 {successSealModal.ipAddress}
                    </span>
                  </div>
                )}

                {successSealModal.documentoHash && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>Impronta Crittografica SHA-256 (Integrità Documento):</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', background: '#090d16', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all' }}>
                      {successSealModal.documentoHash}
                    </span>
                  </div>
                )}

                {/* Se è stata apposta la firma grafometrica visiva */}
                {successSealModal.firmaGrafometricaPng && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, background: '#ffffff', padding: 12, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#1e1b4b', textTransform: 'uppercase' }}>
                      Tratto Grafometrico Sottoscritto:
                    </span>
                    <img
                      src={successSealModal.firmaGrafometricaPng}
                      alt="Firma Grafometrica"
                      style={{ height: 48, objectFit: 'contain', alignSelf: 'flex-start' }}
                    />
                  </div>
                )}
              </div>

              {/* Informazione Legale */}
              <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
                🛡 La presente attestazione documenta che l'atto è stato sottoscritto con firma elettronica semplice mediante codice OTP verificato (art. 20 del CAD). Una copia del documento firmato è conservata nel Vault dello Studio.
              </div>
            </div>

            {/* Footer Azioni */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              {successSealModal.fileUrl ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => scaricaDocumentoClient(successSealModal.fileUrl, `${(successSealModal.documentoTitolo || 'Documento_Firmato').replace(/[^a-zA-Z0-9_-]/g, '_')}_FIRMATO.pdf`)}
                    style={{ background: '#059669', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    📥 Copia PDF Firmata
                  </button>
                  {/* §Punto-1 — la copia Word ha senso solo se esiste un .docx reale generato dal
                      motore: prima qui veniva fabbricato un .doc stub con testo inventato. */}
                  {successSealModal.documentoId && successSealModal.fileDocxUrl && (
                    <button
                      type="button"
                      onClick={() => scaricaDocumentoPortaleApi(successSealModal.documentoId, 'docx')}
                      style={{ background: '#1e1b4b', border: '1px solid #3b82f6', color: '#93c5fd', padding: '9px 16px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      📝 Copia Word (.docx)
                    </button>
                  )}
                </div>
              ) : <div />}

              <button
                type="button"
                onClick={() => setSuccessSealModal(null)}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                ✓ Chiudi e Continua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✍️ CONFERMA INVIO DOCUMENTO FIRMATO A MANO (firma a penna, §1.3) */}
      {/* 📤 CONFERMA INVIO DEL DOCUMENTO FIRMATO A MANO (§1.3)
          Qui c'era `DigitalSignatureModal`: disegnava la grafometrica, la scriveva in
          `localStorage`, sincronizzava un finto vault di progetto e concludeva con «firmato con
          successo con Sigillo FEA eIDAS UE 910/2014». Nessun codice OTP, nessuna riga in
          `FirmaElettronica`, nessuna impronta del documento: il cliente credeva di aver firmato,
          lo studio non vedeva niente, e su un altro browser il documento risultava da firmare.
          La firma SES passa ora dalla modale del codice; questa serve solo alla firma a penna. */}
      {documentoDaCaricare && fileFirmato && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📤 Invio del documento firmato a mano</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                Stai inviando allo studio il file firmato per <strong>{documentoDaCaricare.titolo || documentoDaCaricare.nome}</strong>.
                Il documento e la sua impronta vengono registrati a database: la prova della firma è il file stesso.
              </div>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
              <div style={{ color: 'var(--muted)', marginBottom: 3 }}>File selezionato</div>
              <div style={{ fontWeight: 700, wordBreak: 'break-all' }}>{fileFirmato.nome}</div>
            </div>

            <label style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              Se hai firmato con un provider di firma digitale, indicalo: cambia il valore probatorio scritto accanto alla firma.
              <select
                value={modalitaFirma === 'qualificata_esterna' ? 'qualificata_esterna' : 'manuale_scansionata'}
                onChange={(e) => setModalitaFirma(e.target.value as 'manuale_scansionata' | 'qualificata_esterna')}
                style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}
              >
                <option value="manuale_scansionata">Firmato a penna e scansionato</option>
                <option value="qualificata_esterna">Firmato con firma digitale qualificata</option>
              </select>
            </label>

            {otpError && (
              <div style={{ background: '#3b1219', border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
                {otpError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => { setDocumentoDaCaricare(null); setFileFirmato(null); setOtpError(null); }}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '9px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={caricamentoFirmato}
                onClick={async () => {
                  const esito = await confermaFirmaConFile();
                  // La modale resta aperta se l'invio è fallito: l'errore è lì sopra, e chiuderla
                  // farebbe credere che il file sia arrivato.
                  if (esito) setDocumentoDaCaricare(null);
                }}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: caricamentoFirmato ? 'default' : 'pointer' }}
              >
                {caricamentoFirmato ? 'Invio in corso…' : 'Invia allo studio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🛡️ MODALE DETTAGLIO ATTIVITÀ OPERATORE & FIRMA CONCLUSIONE MODULO */}
      {selectedModule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 25px 60px rgba(0,0,0,.6)' }}>
            
            {/* Header Modale */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <CatBadge cat={selectedModule.cat} />
                  <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>Fascicolo Operativo Modulo</span>
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selectedModule.nome}</h2>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                  Valore Operazione: <strong style={{ color: 'var(--indigo-l)' }}>{fmt(selectedModule.prezzo)}</strong> · Stima Ore: <strong>{selectedModule.ore}h</strong>
                </div>
              </div>
              <button
                onClick={() => setSelectedModule(null)}
                style={{ background: 'var(--card2)', border: 'none', width: 32, height: 32, borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Stato Conclusione / Firma Banner */}
            {moduleSignatures[selectedModule.id]?.firmato ? (
              <div style={{ background: '#0d2d22', border: '1.5px solid #10b981', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#10b981', color: '#064e3b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✓</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#34d399' }}>✓ OPERAZIONE CONCLUSA & VALIDATA CON SUCCESSO</div>
                  <div style={{ fontSize: 11, color: '#a7f3d0', marginTop: 2 }}>
                    Firmato digitalmente da <strong>{moduleSignatures[selectedModule.id].signerName}</strong> in data {moduleSignatures[selectedModule.id].dataFirma} · Firma Elettronica Semplice (OTP verificata) · art. 20 CAD
                  </div>
                </div>
              </div>
            ) : selectedModule.stato === 'completato' ? (
              <div style={{ background: '#2d1a0d', border: '1.5px solid #d97706', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f59e0b', color: '#78350f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>✍️</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>ATTIVITÀ OPERATIVE COMPLETATE — IN ATTESA DI FIRMA</div>
                  <div style={{ fontSize: 11, color: '#fde68a', marginTop: 2 }}>
                    L'operatore ha completato tutte le prestazioni previste. Verifica i passaggi sotto ed apponi la firma conclusiva per validare l'operazione.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: '#1e1b4b', border: '1.5px solid #4338ca', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>⏱</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#c7d2fe' }}>
                    {(selectedModule.percentuale ?? 0) > 0
                      ? `OPERAZIONE IN LAVORAZIONE (${selectedModule.percentuale}%)`
                      : 'OPERAZIONE NON ANCORA AVVIATA'}
                  </div>
                  <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 2 }}>
                    {/* Prima: `{selectedModule.percentuale || 75}%` con "il team sta eseguendo gli
                        ultimi adempimenti" — un modulo a 0% dichiarava al cliente il 75% e lavori
                        agli sgoccioli. Il ripiego scattava proprio quando il dato mancava. */}
                    {(selectedModule.percentuale ?? 0) > 0
                      ? 'Le prestazioni previste sono in corso di esecuzione.'
                      : 'Nessuna prestazione risulta ancora avviata su questo modulo.'}
                  </div>
                </div>
              </div>
            )}

            {/* Scheda Team Responsabile. Il riquadro "Data Esecuzione: Agosto 2026" che stava
                qui a destra era una data cablata nel sorgente, identica per ogni modulo di ogni
                cliente: `ModuloProposta` non porta nessuna data, quindi non c'era niente da
                mostrare. Rimosso anziché sostituito con la data di oggi, che sarebbe la stessa
                bugia con un numero diverso. */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Advisor / Operatore Incaricato:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: selectedModule.operatore ? 'var(--text)' : 'var(--muted)' }}>
                  {selectedModule.operatore ? `👤 ${selectedModule.operatore}` : 'Operatore non ancora assegnato'}
                </div>
              </div>
            </div>

            {/* Checklist Passaggi Operativi Svolti dall'Operatore */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
                📋 Dettaglio Passaggi & Micro-Prestazioni Svolte ({selectedModule.passaggi?.length ?? 0}):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(selectedModule.passaggi ?? []).length === 0 && (
                  <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Questo modulo non ha ancora micro-prestazioni registrate a database. L'elenco
                    si popola man mano che l'operatore consuntiva le attività.
                  </div>
                )}
                {(selectedModule.passaggi ?? []).map((p, pIdx) => (
                  <div
                    key={p.id || pIdx}
                    style={{
                      background: 'var(--card)',
                      border: p.completato ? '1px solid #166534' : '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: p.completato ? '#0d2d22' : 'var(--card2)', color: p.completato ? '#34d399' : 'var(--muted)', border: `1px solid ${p.completato ? '#10b981' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginTop: 2 }}>
                        {p.completato ? '✓' : pIdx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: p.completato ? 'var(--text)' : 'var(--muted)' }}>
                          {p.titolo}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {p.note ? `${p.note} · ` : ''}<span style={{ color: 'var(--indigo-l)' }}>Operatore: {p.operatore || 'Studio'}</span>{p.data ? ` (${p.data})` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: p.completato ? '#0d2d22' : 'var(--card2)', color: p.completato ? '#34d399' : 'var(--muted)' }}>
                        {p.completato ? 'Completato ✓' : 'In Corso'}
                      </span>
                    </div>

                    {/* Documenti specifici collegati a questa micro-voce */}
                    {p.documenti && p.documenti.length > 0 && (
                      <div style={{ marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase' }}>
                          📄 Documenti pubblicati per questa micro-fase:
                        </div>
                        {p.documenti.map((doc) => (
                          <div
                            key={doc.id}
                            style={{
                              background: doc.firmato ? '#064e3b30' : 'var(--card2)',
                              border: `1px solid ${doc.firmato ? '#10b981' : '#4338ca'}`,
                              borderRadius: 8,
                              padding: '8px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 16 }}>{doc.tipo === 'verbale_firma' ? '📜' : doc.firmato ? '🔒' : '📄'}</span>
                              <div>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>
                                  {doc.nome}
                                  {doc.versione && doc.versione > 1 && (
                                    <span style={{ marginLeft: 6, fontSize: 9.5, background: 'var(--card)', padding: '1px 5px', borderRadius: 4, color: '#818cf8', fontWeight: 600 }}>v{doc.versione}</span>
                                  )}
                                </div>
                                <div style={{ fontSize: 10, color: doc.tipo === 'verbale_firma' ? '#a5b4fc' : doc.firmato ? '#34d399' : doc.statoDoc === 'in_revisione' ? '#fbbf24' : '#93c5fd' }}>
                                  {doc.tipo === 'verbale_firma' ? '📜 Verbale di firma · atto certificativo' : doc.firmato ? '✓ Firmato con OTP verificata' : doc.statoDoc === 'in_revisione' ? '⚠️ In attesa di riscontro modifica' : '🚀 Pubblicato dallo studio per la firma'}
                                </div>
                                {doc.versioniPrecedenti && doc.versioniPrecedenti.length > 0 && (
                                  <div style={{ fontSize: 9.5, color: '#93c5fd', marginTop: 2 }}>
                                    🕘 v{doc.versione}: sostituisce {doc.versioniPrecedenti.map(v => `v${v.versione}${v.firmatoAt ? ' (firmata)' : ''}`).join(', ')} — cronologia completa nella scheda «Documenti & Contratti»
                                  </div>
                                )}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => setSelectedViewerDoc(doc)}
                                style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                              >
                                👁 Apri
                              </button>
                              {doc.scaricabile && urlFileArchivio(doc.fileUrl) && (
                                <button
                                  type="button"
                                  onClick={() => scaricaDocumentoClient(doc.fileUrl, doc.nome)}
                                  style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '5px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  title="Scarica il file"
                                >
                                  ⬇
                                </button>
                              )}
                              {!doc.firmato && doc.tipo !== 'verbale_firma' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { setModificaDocTarget(doc); setModificaDocTesto(''); }}
                                    style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '5px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                                    title="Chiedi modifiche o note prima di firmare"
                                  >
                                    📝 Modifica
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!doc.richiedeFirma || otpLoading}
                                    onClick={() => avviaFirmaDocumento(doc)}
                                    style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                                  >
                                    ✍️ Firma
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Documenti & Deliverables Prodotti */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>
                📎 Documenti & Fascicoli Prodotti dall'Operatore ({selectedModule.deliverables?.length ?? 0}):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(selectedModule.deliverables ?? []).length === 0 && (
                  <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Nessun documento è ancora stato pubblicato per questo modulo. I fascicoli
                    prodotti compaiono qui e nella scheda "Documenti & Contratti" non appena lo Studio
                    li pubblica.
                  </div>
                )}
                {(selectedModule.deliverables ?? []).map((d, dIdx) => {
                  const docReal = d.docCompleto;
                  return (
                    <div
                      key={d.id || dIdx}
                      style={{
                        background: d.firmato ? '#064e3b30' : 'var(--card2)',
                        border: `1px solid ${d.firmato ? '#10b981' : 'var(--border)'}`,
                        borderRadius: 10,
                        padding: '12px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18 }}>{d.firmato ? '🔒' : '📄'}</span>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {d.titolo}
                            {docReal?.versione && docReal.versione > 1 && (
                              <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--card)', padding: '1px 5px', borderRadius: 4, color: '#818cf8' }}>v{docReal.versione}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                            {d.nomeFile} · Depositato il {d.data}
                            {d.firmato && <span style={{ color: '#34d399', fontWeight: 700, marginLeft: 6 }}>✓ Firmato</span>}
                          </div>
                          {docReal?.versioniPrecedenti && docReal.versioniPrecedenti.length > 0 && (
                            <div style={{ fontSize: 9.5, color: '#93c5fd', marginTop: 2 }}>
                              🕘 v{docReal.versione}: sostituisce {docReal.versioniPrecedenti.map(v => `v${v.versione}${v.firmatoAt ? ' (firmata)' : ''}`).join(', ')} — cronologia completa nella scheda «Documenti & Contratti»
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            if (docReal) setSelectedViewerDoc(docReal);
                          }}
                          style={{ background: '#1a1f3d', border: '1px solid #4338ca', color: '#c7d2fe', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          👁 Apri Documento
                        </button>

                        {docReal?.scaricabile && urlFileArchivio(docReal.fileUrl) && (
                          <button
                            type="button"
                            onClick={() => scaricaDocumentoClient(docReal.fileUrl, d.nomeFile)}
                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            ⬇ Scarica
                          </button>
                        )}

                        {!d.firmato && docReal && docReal.tipo !== 'verbale_firma' && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setModificaDocTarget(docReal); setModificaDocTesto(''); }}
                              style={{ background: '#27272a', border: '1px solid #52525b', color: '#fbbf24', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                              title="Invia note allo studio"
                            >
                              📝 Richiedi Modifiche
                            </button>
                            <button
                              type="button"
                              disabled={!docReal.richiedeFirma || otpLoading}
                              onClick={() => avviaFirmaDocumento(docReal)}
                              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              ✍️ Firma con codice
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Azioni & Firma Conclusione */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <button
                onClick={() => setSelectedModule(null)}
                style={{ background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Chiudi
              </button>

              {moduleSignatures[selectedModule.id]?.firmato ? (
                <div style={{ fontSize: 12, color: '#34d399', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔒 Conclusione firmata · firma registrata con OTP verificata</span>
                </div>
              ) : (
                <button
                  onClick={() => { void avviaFirmaModulo(selectedModule); }}
                  style={{
                    background: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    padding: '11px 22px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>✍️ Firma la conclusione dell'operazione (firma semplice con codice OTP · art. 20 CAD)</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const portalWrapperStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '100vh',
  overflowY: 'auto',
  background: 'var(--bg)',
  color: 'var(--text)',
};

const containerStyle: React.CSSProperties = {
  minHeight: '100%',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  padding: '24px 20px 80px',
  maxWidth: 1120,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const topNavStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  paddingBottom: 14, borderBottom: '1px solid var(--border)',
};

const heroBannerStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg,#13162b,#1a1d3b)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: '0 8px 30px rgba(0,0,0,.3)',
};

const tabsBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  borderBottom: '2px solid var(--border)',
  paddingBottom: 10,
  paddingTop: 6,
  position: 'sticky',
  top: 0,
  zIndex: 30,
  background: 'var(--bg)',
};

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--indigo)' : 'var(--card2)',
  border: active ? '1px solid var(--indigo-l)' : '1px solid var(--border)',
  color: active ? '#ffffff' : 'var(--text)',
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 18px',
  borderRadius: 10,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: active ? '0 4px 14px rgba(99, 102, 241, 0.4)' : 'none',
  transition: 'all .2s ease',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
});

const bodyStyle: React.CSSProperties = {
  flex: 1,
};

const docBoxStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: '0 12px 36px rgba(0,0,0,.3)',
};

