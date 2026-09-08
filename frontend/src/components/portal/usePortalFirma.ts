import { useState, useEffect } from 'react';
import type React from 'react';
import {
  canaliFirmaApi,
  requestPortalOtpApi,
  verifyPortalOtpAndSignApi,
  firmaConFileApi,
  calcolaHashSha256,
} from '../../api/client';
import type { CanaleOtp, CanaleFirma, DocumentoPortale } from '../../api/client';
import type { BersaglioFirma } from './types';
import { livelloFirmaEffettivo, AVVISO_LIVELLO } from './livelloFirma';

/**
 * Hook React con la firma elettronica del portale cliente (Blocco 1 dello split): i canali
 * OTP disponibili, l'invio e la convalida del codice, la firma con file caricato e i tre
 * avvii — lettera d'incarico, documento del fascicolo, conclusione di un modulo.
 *
 * Il sigillo della lettera d'incarico (`eidasSeal`) resta nell'orchestratore: lo scrive
 * `loadPortalData` quando ripristina la sessione e lo legge il render, quindi qui arriva
 * solo il suo setter, per `registraEsitoFirma`.
 */

interface UsePortalFirmaArgs {
  /** Solo con una sessione attiva si chiede all'anagrafica l'elenco dei canali di firma. */
  isAuthenticated: boolean;
  /** Anagrafica del cliente: il suo id accompagna ogni richiesta di firma. */
  clientObj: any;
  /** Nome del cliente, firmatario di ripiego quando l'elenco chiuso non ha una scelta. */
  clientName: string;
  /** Loader globale del portale, acceso durante la convalida del codice. */
  setLoading: (valore: boolean) => void;
  /** Sblocca il portale quando la lettera d'incarico viene firmata. */
  setSigned: (valore: boolean) => void;
  /** Pubblica il sigillo della lettera d'incarico nello stato dell'orchestratore. */
  setEidasSeal: (valore: any) => void;
  /** Chiude la vista del documento dopo la firma di un documento del fascicolo. */
  setSelectedViewerDoc: (valore: any | null) => void;
  /** Rilegge i documenti del fascicolo dopo la firma di uno di essi. */
  caricaDocumenti: (clienteId?: string) => Promise<void>;
  /** Rilegge le conclusioni firmate dei moduli dopo la firma di una di esse. */
  caricaFirmeModuli: (clienteId?: string) => Promise<void>;
  /** Riarrotola i progetti dopo la firma della lettera d'incarico. */
  ricaricaDopoFirma: () => Promise<void>;
  /** HTML della lettera d'incarico come il cliente la vede: base dell'impronta di firma. */
  getResolvedEngagementHtml: () => string;
}

export function usePortalFirma({
  isAuthenticated,
  clientObj,
  clientName,
  setLoading,
  setSigned,
  setEidasSeal,
  setSelectedViewerDoc,
  caricaDocumenti,
  caricaFirmeModuli,
  ricaricaDopoFirma,
  getResolvedEngagementHtml,
}: UsePortalFirmaArgs): {
  otpModalOpen: boolean;
  setOtpModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  otpCode: string;
  setOtpCode: React.Dispatch<React.SetStateAction<string>>;
  otpCanale: CanaleOtp;
  setOtpCanale: React.Dispatch<React.SetStateAction<CanaleOtp>>;
  canaliFirma: CanaleFirma[];
  botTelegram: string | null;
  usaRecapitoDiverso: boolean;
  setUsaRecapitoDiverso: React.Dispatch<React.SetStateAction<boolean>>;
  recapitoDichiarato: string;
  setRecapitoDichiarato: React.Dispatch<React.SetStateAction<string>>;
  otpTarget: string;
  otpTargetDichiarato: boolean;
  otpLoading: boolean;
  otpError: string | null;
  setOtpError: React.Dispatch<React.SetStateAction<string | null>>;
  otpAttesaReinvio: number;
  otpReinviiRimanenti: number | null;
  otpValiditaSecondi: number;
  modalitaFirma: 'otp' | 'manuale_scansionata' | 'qualificata_esterna';
  setModalitaFirma: React.Dispatch<React.SetStateAction<'otp' | 'manuale_scansionata' | 'qualificata_esterna'>>;
  fileFirmato: { nome: string; base64: string } | null;
  setFileFirmato: React.Dispatch<React.SetStateAction<{ nome: string; base64: string } | null>>;
  caricamentoFirmato: boolean;
  padGrafometricaAperto: boolean;
  setPadGrafometricaAperto: React.Dispatch<React.SetStateAction<boolean>>;
  firmatariAmmessi: string[];
  firmatarioSelezionato: string;
  setFirmatarioSelezionato: React.Dispatch<React.SetStateAction<string>>;
  docRiconoscimentoNome: string | null;
  onCaricaDocRiconoscimento: (file: File) => void;
  onRimuoviDocRiconoscimento: () => void;
  livelloFirmaModale: 'ses' | 'fea';
  successSealModal: any | null;
  setSuccessSealModal: React.Dispatch<React.SetStateAction<any | null>>;
  canaleCorrente: CanaleFirma | undefined;
  nomeCanale: Record<CanaleOtp, string>;
  TITOLO_MANDATO: string;
  setBersaglioFirma: React.Dispatch<React.SetStateAction<BersaglioFirma>>;
  inviaCodiceFirma: (opzioni?: {
    reinvio?: boolean;
    bersaglio?: BersaglioFirma;
    canale?: CanaleOtp;
    livello?: 'ses' | 'fea';
  }) => Promise<boolean>;
  confermaFirmaConOtp: (firmaGrafometricaPng?: string) => Promise<boolean>;
  confermaFirmaConFile: () => Promise<boolean>;
  avviaFirmaDocumento: (doc: DocumentoPortale) => Promise<void>;
  avviaFirmaModulo: (modulo: { id: string; nome: string }) => Promise<void>;
  leggiFileFirmato: (file: File) => Promise<void>;
} {
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
  /**
   * Fase 3 FEA (misura 1, §4) — chi firma: l'elenco chiuso dei firmatari che l'anagrafica
   * ammette (nome del cliente o legale rappresentante in referentiJson), esposto da
   * `canali-firma` e fatto rispettare dal server in tutte le rotte di firma. Qui il cliente
   * dichiara con quale identità firma; il nome scelto entra nella richiesta OTP e nel sigillo.
   */
  const [firmatariAmmessi, setFirmatariAmmessi] = useState<string[]>([]);
  const [firmatarioSelezionato, setFirmatarioSelezionato] = useState('');
  /**
   * Fase 3 FEA (misura 1, §4) — documento di riconoscimento caricato una tantum dal
   * firmatario (data URL). Raccomandato per la FEA, non obbligatorio: quando presente il
   * server lo scandisce, ne calcola l'hash e lo lega al digest del sigillo. Il controllo
   * di tipo e dimensione (PDF/PNG/JPEG, max 30 MB) resta del server, come per ogni file.
   */
  const [docRiconoscimentoBase64, setDocRiconoscimentoBase64] = useState<string | null>(null);
  const [docRiconoscimentoTipo, setDocRiconoscimentoTipo] = useState<string | null>(null);
  const [docRiconoscimentoNome, setDocRiconoscimentoNome] = useState<string | null>(null);
  /**
   * Fase 3 FEA — il livello che il documento in firma esige ('ses' | 'fea'): la modale lo
   * usa per titolo, nota legale e firma grafica obbligatoria. Il FEQ non arriva qui: la
   * lista documenti nasconde il bottone OTP e orienta al provider di firma digitale.
   */
  const [livelloFirmaModale, setLivelloFirmaModale] = useState<'ses' | 'fea'>('ses');
  const [successSealModal, setSuccessSealModal] = useState<any | null>(null);

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
        // Fase 3 FEA (misura 1): l'elenco chiuso dei firmatari ammessi dall'anagrafica —
        // prima voce il nome del cliente, poi l'eventuale legale rappresentante. Si
        // preseleziona la prima voce, che è la più probabile; la modale lascia comunque
        // la scelta al firmatario, e il server fa rispettare l'elenco a ogni firma.
        const firmatari = res.firmatariAmmessi || [];
        setFirmatariAmmessi(firmatari);
        setFirmatarioSelezionato(firmatari[0] ?? '');

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

  /**
   * Fase 3 FEA (misura 1, §4) — caricamento del documento di riconoscimento scelto dal
   * firmatario nella modale. Il file viene letto come data URL e mandato com'è al server:
   * è lui che scandisce, calcola l'hash e lo lega al digest del sigillo. Qui si rifiutano
   * solo i file che il server scarterebbe comunque (tipo non ammesso o oltre 30 MB), per
   * non far perdere al cliente il codice già digitato.
   */
  const onCaricaDocRiconoscimento = (file: File) => {
    const estensioniAmmesse = ['application/pdf', 'image/png', 'image/jpeg'];
    if (!estensioniAmmesse.includes(file.type)) {
      setOtpError('Documento di riconoscimento: formato non ammesso. Carica un PDF, PNG o JPEG.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setOtpError('Documento di riconoscimento: il file supera i 30 MB consentiti.');
      return;
    }
    const nome = file.name.toLowerCase();
    const tipo = nome.includes('passaporto')
      ? 'Passaporto'
      : nome.includes('patente')
        ? 'Patente'
        : 'Carta d\'identità';
    const reader = new FileReader();
    reader.onload = () => {
      setDocRiconoscimentoBase64(typeof reader.result === 'string' ? reader.result : null);
      setDocRiconoscimentoTipo(tipo);
      setDocRiconoscimentoNome(file.name);
      setOtpError(null);
    };
    reader.onerror = () => setOtpError('Lettura del documento di riconoscimento non riuscita: riprova.');
    reader.readAsDataURL(file);
  };

  /** La rimozione azzera i tre valori: il server riceverà la firma senza documento allegato. */
  const onRimuoviDocRiconoscimento = () => {
    setDocRiconoscimentoBase64(null);
    setDocRiconoscimentoTipo(null);
    setDocRiconoscimentoNome(null);
  };

  /**
   * Invio o reinvio del codice. Un errore resta un errore, e il cliente legge quale.
   *
   * `livello` è l'unico punto in cui la modale apprende il valore legale che il documento
   * esige (Fase 3 FEA, §4): chi avvia la firma lo dichiara — il fascicolo in base all'etichetta
   * del documento — e il default 'ses' copre engagement letter e moduli, che etichettatura non
   * hanno. Centralizzarlo qui evita che un 'fea' residuo da una firma precedente sopravviva
   * a una firma successiva: ogni invio di codice ricalibra la modale sul documento giusto.
   */
  const inviaCodiceFirma = async (
    opzioni: { reinvio?: boolean; bersaglio?: BersaglioFirma; canale?: CanaleOtp; livello?: 'ses' | 'fea' } = {},
  ) => {
    const bersaglio = opzioni.bersaglio ?? bersaglioFirma;
    const canaleDaUsare = opzioni.canale ?? otpCanale;
    if (opzioni.canale) setOtpCanale(opzioni.canale);
    if (opzioni.bersaglio) setBersaglioFirma(opzioni.bersaglio);
    setLivelloFirmaModale(opzioni.livello ?? 'ses');
    setOtpLoading(true);
    setOtpError(null);
    setOtpCode('');

    try {
      const res = await requestPortalOtpApi({
        canale: canaleDaUsare,
        ambito: bersaglio.ambito,
        riferimentoId: bersaglio.riferimentoId,
        recapitoDichiarato: usaRecapitoDiverso && recapitoDichiarato.trim() ? recapitoDichiarato.trim() : undefined,
        // Fase 3 FEA (misura 1): l'identità con cui il cliente dichiara di firmare —
        // scelta nell'elenco chiuso esposto da canali-firma. Il server la valida.
        signerName: firmatarioSelezionato || clientName,
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
        // Fase 3 FEA (misura 1): firma con l'identità scelta nell'elenco chiuso, e con
        // l'eventuale documento di riconoscimento che il server scandisce e lega al sigillo.
        signerName: firmatarioSelezionato || clientName,
        documentoTitolo: bersaglioFirma.titolo,
        ambito: bersaglioFirma.ambito,
        riferimentoId: bersaglioFirma.riferimentoId,
        clienteId: clientObj?.id,
        firmaGrafometricaPng,
        docRiconoscimentoBase64: docRiconoscimentoBase64 ?? undefined,
        docRiconoscimentoTipo: docRiconoscimentoTipo ?? undefined,
      });

      await registraEsitoFirma(res.seal);
      setOtpModalOpen(false);
      setOtpCode('');
      // Il documento di riconoscimento è una tantum: consumato dalla firma, non
      // resta in memoria per quella successiva.
      onRimuoviDocRiconoscimento();
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
        // Fase 3 FEA (misura 1): anche nel canale file il firmatario è quello scelto
        // nell'elenco chiuso, non il generico nome del cliente.
        signerName: firmatarioSelezionato || clientName,
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

    // La riga `FirmaElettronica` con sigillo, hash e IP l'ha già scritta il backend: qui si aggiorna
    // solo la vista. Lo stato si riconcilia dal database al prossimo accesso (`loadPortalData`),
    // come documenti e addendum — niente `localStorage`, che non arriva agli altri dispositivi né
    // allo studio.
    setEidasSeal(seal);
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
    // Piano firma §3 — guard preventivo: solo il FEQ respinge l'OTP (il server
    // risponderebbe 409). La FEA al contrario si OTTIENE dal flusso misurato del
    // portale: grafometrica obbligatoria, sessione certificata e firmatario
    // identificato (Fase 3, §4). Il livello scelto qui orienta la modale.
    const livelloDoc = livelloFirmaEffettivo(doc.livelloFirmaRichiesto);
    if (livelloDoc === 'feq') {
      setModalitaFirma('otp');
      setFileFirmato(null);
      setOtpError(AVVISO_LIVELLO[livelloDoc]);
      setOtpModalOpen(true);
      return;
    }
    const bersaglio: BersaglioFirma = {
      ambito: 'documento_vault',
      titolo: doc.titolo || doc.nome,
      riferimentoId: doc.id,
    };
    setModalitaFirma('otp');
    setFileFirmato(null);
    // `inviaCodiceFirma` fissa bersaglio e livello: qui non serve scriverli due volte.
    await inviaCodiceFirma({ bersaglio, livello: livelloDoc === 'fea' ? 'fea' : 'ses' });
  };

  /**
   * Conclusione di un'operazione: la firma è una firma elettronica semplice (SES) con OTP
   * verificata, con lo stesso flusso
   * OTP dei documenti del fascicolo. Il server firma i dati canonici del modulo (§2.9) e mette
   * la riga in `FirmaElettronica` — data, hash e IP veri, visibili subito anche allo studio.
   */
  const avviaFirmaModulo = async (modulo: { id: string; nome: string }) => {
    // I moduli non hanno etichettatura FEA: si firmano SES, come sempre —
    // `inviaCodiceFirma` lo fissa col suo default.
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

  return {
    otpModalOpen,
    setOtpModalOpen,
    otpCode,
    setOtpCode,
    otpCanale,
    setOtpCanale,
    canaliFirma,
    botTelegram,
    usaRecapitoDiverso,
    setUsaRecapitoDiverso,
    recapitoDichiarato,
    setRecapitoDichiarato,
    otpTarget,
    otpTargetDichiarato,
    otpLoading,
    otpError,
    setOtpError,
    otpAttesaReinvio,
    otpReinviiRimanenti,
    otpValiditaSecondi,
    modalitaFirma,
    setModalitaFirma,
    fileFirmato,
    setFileFirmato,
    caricamentoFirmato,
    padGrafometricaAperto,
    setPadGrafometricaAperto,
    firmatariAmmessi,
    firmatarioSelezionato,
    setFirmatarioSelezionato,
    docRiconoscimentoNome,
    onCaricaDocRiconoscimento,
    onRimuoviDocRiconoscimento,
    livelloFirmaModale,
    successSealModal,
    setSuccessSealModal,
    canaleCorrente,
    nomeCanale,
    TITOLO_MANDATO,
    setBersaglioFirma,
    inviaCodiceFirma,
    confermaFirmaConOtp,
    confermaFirmaConFile,
    avviaFirmaDocumento,
    avviaFirmaModulo,
    leggiFileFirmato,
  };
}
