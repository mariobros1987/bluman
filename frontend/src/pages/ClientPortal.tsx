import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmt } from '../utils';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { resolveDocumentTemplateHtml, PREBUILT_TEMPLATES } from '../utils/documentTemplates';
import { getStudioInfoForTenant } from '../utils/tenant';
import {
  fetchProgetti,
  fetchClienti,
  fetchComunicazioniApi,
  canaliFirmaApi,
  requestPortalOtpApi,
  verifyPortalOtpAndSignApi,
  firmaConFileApi,
  calcolaHashSha256,
  magicLoginApi,
  clientLoginApi,
  cambiaPasswordClienteApi,
  documentiPortaleApi,
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
  DocumentoPortale,
  ContattiStudio,
  PropostaDatiFiscale,
  RichiestaAddendum,
  FatturaPortale,
  NotificaStreamEvent,
} from '../api/client';
import { tempoRelativo } from '../components/NotificationModal';
import type { NotificaPortale, ModuloProposta, PortalTab, BersaglioFirma } from '../components/portal/types';
import { mapProjectToPortalModules } from '../components/portal/mapPortalModules';
import { dataOraLeggibile } from '../components/portal/format';
import {
  portalWrapperStyle,
  containerStyle,
  topNavStyle,
  heroBannerStyle,
  tabsBarStyle,
  tabBtnStyle,
  bodyStyle,
} from '../components/portal/styles';
import { PortalLogin } from '../components/portal/PortalLogin';
import { FirmaOtpModal } from '../components/portal/FirmaOtpModal';
import { DocumentViewerModal } from '../components/portal/DocumentViewerModal';
import { ModificaDocModal } from '../components/portal/ModificaDocModal';
import { SuccessSealModal } from '../components/portal/SuccessSealModal';
import { InvioManualeModal } from '../components/portal/InvioManualeModal';
import { DettaglioModuloModal } from '../components/portal/DettaglioModuloModal';
import { TabProposta } from '../components/portal/TabProposta';
import { TabAvanzamento } from '../components/portal/TabAvanzamento';
import { TabForm } from '../components/portal/TabForm';
import { TabDocumenti } from '../components/portal/TabDocumenti';
import { TabFatture } from '../components/portal/TabFatture';
import { TabContatti } from '../components/portal/TabContatti';
import { TabProfilo } from '../components/portal/TabProfilo';

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
      <PortalLogin
        currentStudioInfo={currentStudioInfo}
        authMode={authMode}
        setAuthMode={setAuthMode}
        accessoNegato={accessoNegato}
        loginError={loginError}
        setLoginError={setLoginError}
        loginEmail={loginEmail}
        setLoginEmail={setLoginEmail}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        loginLoading={loginLoading}
        manualMagicToken={manualMagicToken}
        setManualMagicToken={setManualMagicToken}
        handleClientLogin={handleClientLogin}
        handleManualMagicSubmit={handleManualMagicSubmit}
      />
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
          <TabProposta
            signed={signed}
            eidasSeal={eidasSeal}
            clientName={clientName}
            moduliProposti={moduliProposti}
            totalValue={totalValue}
            addendumErrore={addendumErrore}
            nuovaRichiestaAddendum={nuovaRichiestaAddendum}
            setNuovaRichiestaAddendum={setNuovaRichiestaAddendum}
            progettoAttivo={progettoAttivo}
            inviaNuovaRichiestaAddendum={inviaNuovaRichiestaAddendum}
            invioAddendum={invioAddendum}
            addendumMsg={addendumMsg}
            addendums={addendums}
            moduleSignatures={moduleSignatures}
            setSelectedModule={setSelectedModule}
            getResolvedEngagementHtml={getResolvedEngagementHtml}
            modalitaFirma={modalitaFirma}
            setModalitaFirma={setModalitaFirma}
            otpError={otpError}
            setOtpError={setOtpError}
            canaliFirma={canaliFirma}
            otpCanale={otpCanale}
            setOtpCanale={setOtpCanale}
            nomeCanale={nomeCanale}
            usaRecapitoDiverso={usaRecapitoDiverso}
            setUsaRecapitoDiverso={setUsaRecapitoDiverso}
            recapitoDichiarato={recapitoDichiarato}
            setRecapitoDichiarato={setRecapitoDichiarato}
            canaleCorrente={canaleCorrente}
            botTelegram={botTelegram}
            otpModalOpen={otpModalOpen}
            inviaCodiceFirma={inviaCodiceFirma}
            TITOLO_MANDATO={TITOLO_MANDATO}
            loading={loading}
            otpLoading={otpLoading}
            fileFirmato={fileFirmato}
            leggiFileFirmato={leggiFileFirmato}
            confermaFirmaConFile={confermaFirmaConFile}
            caricamentoFirmato={caricamentoFirmato}
          />
        )}

        {/* TAB 2: Avanzamento Live Lavori */}
        {activeTab === 'avanzamento' && (
          <TabAvanzamento
            moduliProposti={moduliProposti}
            percentualeProgetto={percentualeProgetto}
            moduleSignatures={moduleSignatures}
            setSelectedModule={setSelectedModule}
          />
        )}

        {/* TAB 3: Form Dati Societari */}
        {activeTab === 'form' && (
          <TabForm
            mostraDatiSensibili={mostraDatiSensibili}
            setMostraDatiSensibili={setMostraDatiSensibili}
            formSaved={formSaved}
            propostaMsg={propostaMsg}
            handleSaveForm={handleSaveForm}
            bozzaDati={bozzaDati}
            setBozzaDati={setBozzaDati}
            propostaInAttesa={propostaInAttesa}
            formData={formData}
            mascheraIban={mascheraIban}
            mascheraUbo={mascheraUbo}
            invioProposta={invioProposta}
          />
        )}

        {/* TAB 4: Documenti Legali & Firme con Persistenza */}
        {activeTab === 'documenti' && (
          <TabDocumenti
            portalDocs={portalDocs}
            portalDocsErrore={portalDocsErrore}
            portalDocsCaricamento={portalDocsCaricamento}
            caricaDocumenti={caricaDocumenti}
            clientObj={clientObj}
            storicoVersioniAperto={storicoVersioniAperto}
            setStoricoVersioniAperto={setStoricoVersioniAperto}
            setSelectedViewerDoc={setSelectedViewerDoc}
            scaricaDocumentoPortaleApi={scaricaDocumentoPortaleApi}
            setSuccessSealModal={setSuccessSealModal}
            clientName={clientName}
            setModificaDocTarget={setModificaDocTarget}
            setModificaDocTesto={setModificaDocTesto}
            otpLoading={otpLoading}
            avviaFirmaDocumento={avviaFirmaDocumento}
            caricamentoFirmato={caricamentoFirmato}
            leggiFileFirmato={leggiFileFirmato}
            setBersaglioFirma={setBersaglioFirma}
            setModalitaFirma={setModalitaFirma}
            setDocumentoDaCaricare={setDocumentoDaCaricare}
          />
        )}

        {/* TAB 5: Fatture & Stato Pagamenti (§2.11) */}
        {activeTab === 'fatture' && (
          <TabFatture
            fatturePortale={fatturePortale}
            fattureErrore={fattureErrore}
            fattureCaricamento={fattureCaricamento}
            caricaFatturePortale={caricaFatturePortale}
            clientObj={clientObj}
          />
        )}

        {/* TAB 6: Contatto Advisor & Messaggistica Live */}
        {activeTab === 'contatti' && (
          <TabContatti
            contattiStudio={contattiStudio}
            messaggi={messaggi}
            setMessaggi={setMessaggi}
            nuovoMessaggio={nuovoMessaggio}
            setNuovoMessaggio={setNuovoMessaggio}
            inviandoMessaggio={inviandoMessaggio}
            setInviandoMessaggio={setInviandoMessaggio}
            canaleMessaggio={canaleMessaggio}
            setCanaleMessaggio={setCanaleMessaggio}
            clientName={clientName}
            clientObj={clientObj}
            progettoId={progettoId}
          />
        )}

        {/* TAB 7: Profilo & Password Personale Cliente */}
        {activeTab === 'profilo' && (
          <TabProfilo
            clientName={clientName}
            clientObj={clientObj}
            loginEmail={loginEmail}
            handleSaveClientPassword={handleSaveClientPassword}
            clientPassMsg={clientPassMsg}
            clientPassShow={clientPassShow}
            setClientPassShow={setClientPassShow}
            clientPassCurrent={clientPassCurrent}
            setClientPassCurrent={setClientPassCurrent}
            clientPassNew={clientPassNew}
            setClientPassNew={setClientPassNew}
            clientPassConfirm={clientPassConfirm}
            setClientPassConfirm={setClientPassConfirm}
            clientPassLoading={clientPassLoading}
          />
        )}
      </div>

      {/* 🔐 MODALE DI FIRMA ELETTRONICA SEMPLICE (SES) CON OTP */}
      {otpModalOpen && (
        <FirmaOtpModal
          otpCanale={otpCanale}
          setOtpCanale={setOtpCanale}
          nomeCanale={nomeCanale}
          otpLoading={otpLoading}
          otpTarget={otpTarget}
          otpTargetDichiarato={otpTargetDichiarato}
          otpValiditaSecondi={otpValiditaSecondi}
          otpCode={otpCode}
          setOtpCode={setOtpCode}
          otpError={otpError}
          setOtpError={setOtpError}
          loading={loading}
          otpReinviiRimanenti={otpReinviiRimanenti}
          otpAttesaReinvio={otpAttesaReinvio}
          inviaCodiceFirma={inviaCodiceFirma}
          confermaFirmaConOtp={confermaFirmaConOtp}
          setPadGrafometricaAperto={setPadGrafometricaAperto}
          onClose={() => setOtpModalOpen(false)}
        />
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
        <DocumentViewerModal
          selectedViewerDoc={selectedViewerDoc}
          clientName={clientName}
          otpLoading={otpLoading}
          setSelectedViewerDoc={setSelectedViewerDoc}
          setModificaDocTarget={setModificaDocTarget}
          setModificaDocTesto={setModificaDocTesto}
          setSuccessSealModal={setSuccessSealModal}
          scaricaDocumentoPortaleApi={scaricaDocumentoPortaleApi}
          avviaFirmaDocumento={avviaFirmaDocumento}
        />
      )}

      {/* 📝 MODALE RICHIESTA MODIFICHE DOCUMENTO (Globale, zIndex: 11500) */}
      {modificaDocTarget && (
        <ModificaDocModal
          modificaDocTarget={modificaDocTarget}
          modificaDocTesto={modificaDocTesto}
          setModificaDocTesto={setModificaDocTesto}
          modificaDocInviando={modificaDocInviando}
          setModificaDocTarget={setModificaDocTarget}
          handleInviaRichiestaModifica={handleInviaRichiestaModifica}
        />
      )}

      {/* 📜 MODALE ATTESTAZIONE & RICEVUTA DI FIRMA (SES) */}
      {successSealModal && (
        <SuccessSealModal
          successSealModal={successSealModal}
          clientName={clientName}
          setSuccessSealModal={setSuccessSealModal}
          scaricaDocumentoClient={scaricaDocumentoClient}
          scaricaDocumentoPortaleApi={scaricaDocumentoPortaleApi}
        />
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
        <InvioManualeModal
          documentoDaCaricare={documentoDaCaricare}
          fileFirmato={fileFirmato}
          modalitaFirma={modalitaFirma}
          setModalitaFirma={setModalitaFirma}
          otpError={otpError}
          setOtpError={setOtpError}
          setDocumentoDaCaricare={setDocumentoDaCaricare}
          setFileFirmato={setFileFirmato}
          caricamentoFirmato={caricamentoFirmato}
          confermaFirmaConFile={confermaFirmaConFile}
        />
      )}

      {/* 🛡️ MODALE DETTAGLIO ATTIVITÀ OPERATORE & FIRMA CONCLUSIONE MODULO */}
      {selectedModule && (
        <DettaglioModuloModal
          selectedModule={selectedModule}
          moduleSignatures={moduleSignatures}
          otpLoading={otpLoading}
          setSelectedModule={setSelectedModule}
          setSelectedViewerDoc={setSelectedViewerDoc}
          setModificaDocTarget={setModificaDocTarget}
          setModificaDocTesto={setModificaDocTesto}
          scaricaDocumentoClient={scaricaDocumentoClient}
          avviaFirmaDocumento={avviaFirmaDocumento}
          avviaFirmaModulo={avviaFirmaModulo}
        />
      )}
      </div>
    </div>
  );
}
