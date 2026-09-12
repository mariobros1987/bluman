import { useState } from 'react';
import type React from 'react';
import {
  fetchProgetti,
  fetchCliente,
  fetchClienti,
  fetchComunicazioniApi,
  magicLoginApi,
  documentiPortaleApi,
  contattiPortaleApi,
  proposteDatiPortaleApi,
  richiesteAddendumPortaleApi,
  fatturePortaleApi,
  elencoFirmeApi,
} from '../../api/client';
import type {
  DocumentoPortale,
  ContattiStudio,
  PropostaDatiFiscale,
  RichiestaAddendum,
  FatturaPortale,
} from '../../api/client';
import type { ModuloProposta } from './types';
import { mapProjectToPortalModules } from './mapPortalModules';
import { dataOraLeggibile } from './format';

/**
 * Hook React con i dati del portale cliente: anagrafica, progetti, documenti, firme,
 * richieste di addendum, proposte fiscali, recapiti dello studio, fatture e messaggi,
 * con `loadPortalData` che orchestra il primo caricamento (magic link, sessione salvata
 * o anteprima dello studio).
 */

interface UsePortalDataArgs {
  /** Magic token del link di accesso, letto dall'URL del portale. */
  token: string;
  /** Accende o spegne la sessione del portale: setter di `usePortalAuth`, passato come thunk. */
  setIsAuthenticated: (valore: boolean) => void;
  /** Imposta il messaggio di accesso negato: setter di `usePortalAuth`, passato come thunk. */
  setAccessoNegato: (valore: string | null) => void;
}

export function usePortalData({ token, setIsAuthenticated, setAccessoNegato }: UsePortalDataArgs): {
  clientObj: any;
  setClientObj: (valore: any) => void;
  clientName: string;
  clientProjects: any[];
  selectedProjectId: string;
  setSelectedProjectId: React.Dispatch<React.SetStateAction<string>>;
  progettoId: string;
  setProgettoId: React.Dispatch<React.SetStateAction<string>>;
  moduliProposti: ModuloProposta[];
  setModuliProposti: React.Dispatch<React.SetStateAction<ModuloProposta[]>>;
  messaggi: any[];
  setMessaggi: React.Dispatch<React.SetStateAction<any[]>>;
  moduleSignatures: Record<string, { firmato: boolean; dataFirma: string; signerName: string }>;
  signed: boolean;
  setSigned: React.Dispatch<React.SetStateAction<boolean>>;
  eidasSeal: any;
  setEidasSeal: React.Dispatch<React.SetStateAction<any>>;
  addendums: RichiestaAddendum[];
  addendumErrore: string | null;
  pageLoading: boolean;
  portalDocs: DocumentoPortale[];
  portalDocsErrore: string | null;
  portalDocsCaricamento: boolean;
  formData: { ragioneSociale: string; piva: string; legaleRappresentante: string; codiceFiscale: string; iban: string; titolareEffettivo: string; sedeLegale: string };
  bozzaDati: { ragioneSociale: string; piva: string; legaleRappresentante: string; codiceFiscale: string; iban: string; titolareEffettivo: string; sedeLegale: string };
  setBozzaDati: React.Dispatch<React.SetStateAction<{ ragioneSociale: string; piva: string; legaleRappresentante: string; codiceFiscale: string; iban: string; titolareEffettivo: string; sedeLegale: string }>>;
  proposteDati: PropostaDatiFiscale[];
  contattiStudio: ContattiStudio | null;
  fatturePortale: FatturaPortale[];
  fattureCaricamento: boolean;
  fattureErrore: string | null;
  isStudioPreview: boolean;
  elencoClienti: any[];
  caricaDocumenti: (clienteIdSessione?: string | null) => Promise<void>;
  caricaFirmeModuli: (clienteIdSessione?: string | null) => Promise<void>;
  caricaAddendum: (clienteIdSessione?: string | null) => Promise<void>;
  caricaProposteDati: (clienteIdSessione?: string | null) => Promise<void>;
  caricaContattiStudio: (clienteIdSessione?: string | null) => Promise<void>;
  caricaFatturePortale: (clienteIdSessione?: string | null) => Promise<void>;
  ricaricaProgetti: (clienteIdSessione: string | null, nomeCliente: string, preferisciId?: string) => Promise<void>;
  loadPortalData: (clienteId?: string) => Promise<void>;
} {
  const [clientObj, setClientObj] = useState<any>(null);
  const [clientName, setClientName] = useState('Cliente Studio');
  const [clientProjects, setClientProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [moduliProposti, setModuliProposti] = useState<ModuloProposta[]>([]);
  const [moduleSignatures, setModuleSignatures] = useState<Record<string, { firmato: boolean; dataFirma: string; signerName: string }>>({});
  // Lo stato di firma NON si inizializza da una chiave cablata: la chiave conteneva il nome di un
  // cliente specifico, quindi un browser in cui quel cliente aveva firmato mostrava "firmato" a
  // qualunque altro cliente. Si risolve in `loadPortalData` sul nome del cliente autenticato.
  const [signed, setSigned] = useState<boolean>(false);

  // Le richieste di integrazione dell'incarico (§2.5) vivono a database, agganciate al
  // progetto, e lo studio le vede. Prima stavano in `localStorage` sotto una chiave col nome
  // del cliente: invisibili allo studio e perse al cambio dispositivo. Si leggono e si
  // scrivono via API in `loadPortalData` e nella sezione dedicata del contratto firmato.
  const [addendums, setAddendums] = useState<RichiestaAddendum[]>([]);
  const [addendumErrore, setAddendumErrore] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

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

  // Stesso motivo del flag `signed`: il sigillo di firma è di un cliente preciso e non va letto da
  // una chiave cablata. Viene caricato in `loadPortalData` per il cliente autenticato.
  const [eidasSeal, setEidasSeal] = useState<any>(null);

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
        localStorage.setItem('bluman_portal_token', sessione.token);
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
      const existingToken = localStorage.getItem('bluman_portal_token') || localStorage.getItem('bluman_jwt_token');
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
      const clientiRes = anteprimaStudio
        ? await fetchClienti()
        : (clienteIdSessione ? [await fetchCliente(clienteIdSessione)] : []);
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

      // Lo stato di firma della lettera d'incarico si rilegge da database, come documenti (§2.9) e
      // addendum (§2.5): la firma è una riga `FirmaElettronica` emessa da `/portal/verify-otp-and-sign`,
      // con sigillo, hash e IP. Prima viveva in `bluman_portal_signed_<cliente>`/`bluman_seal_<cliente>`:
      // firmata su un browser voleva dire da firmare su un altro, e lo studio non ne vedeva traccia.
      try {
        const resFirme = await elencoFirmeApi({ clienteId: clienteIdRisolto ?? undefined, ambito: 'engagement_letter' });
        const firmeEl = Array.isArray(resFirme?.firme) ? resFirme.firme : [];
        // L'elenco arriva già ordinato dal più recente: la prima riga dell'ambito è quella buona.
        // Il filtro sul cliente è difensivo — per le sessioni cliente lo impone già il server —
        // e in anteprima studio evita di mostrare la lettera d'un altro come firmata.
        const firmaEl = firmeEl.find((f) => !clienteIdRisolto || f.cliente?.id === clienteIdRisolto);
        if (firmaEl) {
          setSigned(true);
          setEidasSeal({
            id: firmaEl.id,
            signatureId: firmaEl.signatureId,
            tipoFirma: firmaEl.tipoFirma,
            signerName: firmaEl.firmatarioNome || resolvedClientName,
            documentoTitolo: firmaEl.documentoTitolo,
            timestampIso: firmaEl.firmatoAt,
            documentoHash: firmaEl.documentoHash,
            sha256Digest: firmaEl.fileFirmatoHash ?? firmaEl.documentoHash,
            ipAddress: firmaEl.ipAddress ?? null,
            // Il GET /firme non espone lo user-agent: non lo si ricostruisce a caso (regola 7).
            userAgent: null,
            canaleVerificato: firmaEl.canaleVerificato,
            standard: firmaEl.standard,
            fileFirmatoUrl: firmaEl.fileFirmatoUrl,
          });
        } else {
          setSigned(false);
          setEidasSeal(null);
        }
      } catch (err) {
        // «Non riesco a leggere» non è «non c'è»: l'errore si vede in console, lo stato resta
        // quello di partenza e la lettura successiva ci riprova.
        console.warn('Errore recupero firma lettera d\'incarico:', err);
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

  return {
    clientObj,
    setClientObj,
    clientName,
    clientProjects,
    selectedProjectId,
    setSelectedProjectId,
    progettoId,
    setProgettoId,
    moduliProposti,
    setModuliProposti,
    messaggi,
    setMessaggi,
    moduleSignatures,
    signed,
    setSigned,
    eidasSeal,
    setEidasSeal,
    addendums,
    addendumErrore,
    pageLoading,
    portalDocs,
    portalDocsErrore,
    portalDocsCaricamento,
    formData,
    bozzaDati,
    setBozzaDati,
    proposteDati,
    contattiStudio,
    fatturePortale,
    fattureCaricamento,
    fattureErrore,
    isStudioPreview,
    elencoClienti,
    caricaDocumenti,
    caricaFirmeModuli,
    caricaAddendum,
    caricaProposteDati,
    caricaContattiStudio,
    caricaFatturePortale,
    ricaricaProgetti,
    loadPortalData,
  };
}
