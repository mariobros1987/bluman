import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmt } from '../utils';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { resolveDocumentTemplateHtml, PREBUILT_TEMPLATES } from '../utils/documentTemplates';
import { getStudioInfoForTenant } from '../utils/tenant';
import {
  fetchComunicazioniApi,
  scaricaDocumentoClient,
  scaricaDocumentoPortaleApi,
  inviaPropostaDatiApi,
  inviaRichiestaAddendumApi,
  richiediModificaDocumentoApi,
} from '../api/client';
import type { DocumentoPortale } from '../api/client';
import type { ModuloProposta, PortalTab } from '../components/portal/types';
import { mapProjectToPortalModules } from '../components/portal/mapPortalModules';
import { mascheraIban, mascheraUbo } from '../components/portal/format';
import {
  portalWrapperStyle,
  containerStyle,
  bodyStyle,
} from '../components/portal/styles';
import { PortalLogin } from '../components/portal/PortalLogin';
import { PortalTopNav } from '../components/portal/PortalTopNav';
import { PortalHeroBanner } from '../components/portal/PortalHeroBanner';
import { PortalTabsBar } from '../components/portal/PortalTabsBar';
import { PortalStudioPreviewBanner } from '../components/portal/PortalStudioPreviewBanner';
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
import { livelloFirmaEffettivo } from '../components/portal/livelloFirma';
import { usePortalAuth } from '../components/portal/usePortalAuth';
import { usePortalNotifiche } from '../components/portal/usePortalNotifiche';
import { usePortalFirma } from '../components/portal/usePortalFirma';
import { usePortalData } from '../components/portal/usePortalData';

export function ClientPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('magic_token') || '';

  const [activeTab, setActiveTab] = useState<PortalTab>('proposta');

  // Ref bridge per la dipendenza circolare tra i due hook: `loadPortalData` vive in
  // `usePortalData` ma deve poter aggiornare `setIsAuthenticated`/`setAccessoNegato`,
  // che nascono in `usePortalAuth` — il quale a sua volta riceve `loadPortalData`
  // da qui. I thunk delegano a questo ref, popolato con i setter veri appena la
  // destrutturazione di `usePortalAuth` (sotto) è disponibile: nel primo rendering
  // trovano i no-op iniziali, ma `loadPortalData` non viene mai invocata durante
  // il render — solo dentro effetti ed handler — quindi delega sempre a un
  // setter già valido.
  const authSettersRef = useRef<{
    setIsAuthenticated: (v: boolean) => void;
    setAccessoNegato: (v: string | null) => void;
  }>({
    setIsAuthenticated: () => {},
    setAccessoNegato: () => {},
  });

  const {
    clientObj, setClientObj, clientName, clientProjects, selectedProjectId, setSelectedProjectId,
    progettoId, setProgettoId, moduliProposti, setModuliProposti, messaggi, setMessaggi,
    moduleSignatures, signed, setSigned, eidasSeal, setEidasSeal, addendums, addendumErrore,
    pageLoading, portalDocs, portalDocsErrore, portalDocsCaricamento, formData, bozzaDati,
    setBozzaDati, proposteDati, contattiStudio, fatturePortale, fattureCaricamento,
    fattureErrore, isStudioPreview, elencoClienti, caricaDocumenti, caricaFirmeModuli,
    caricaAddendum, caricaProposteDati, caricaFatturePortale,
    ricaricaProgetti, loadPortalData,
  } = usePortalData({
    token,
    setIsAuthenticated: (v) => authSettersRef.current.setIsAuthenticated(v),
    setAccessoNegato: (v) => authSettersRef.current.setAccessoNegato(v),
  });
  const [selectedModule, setSelectedModule] = useState<ModuloProposta | null>(null);
/** Testo libero della nuova richiesta di addendum che il cliente sta scrivendo. */
  const [nuovaRichiestaAddendum, setNuovaRichiestaAddendum] = useState('');
  const [invioAddendum, setInvioAddendum] = useState(false);
  const [addendumMsg, setAddendumMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);

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

  const [formSaved, setFormSaved] = useState(false);
  const [invioProposta, setInvioProposta] = useState(false);
  const [propostaMsg, setPropostaMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  /**
   * §2.4: IBAN e titolare effettivo sono mostrati mascherati. Il cliente può scoprirli
   * esplicitamente con un interruttore: non c'è motivo che un dato bancario o il nome del
   * titolare effettivo restino in chiaro su uno schermo condiviso o in una schermata di
   * cortesia.
   */
  const [mostraDatiSensibili, setMostraDatiSensibili] = useState(false);

  const [nuovoMessaggio, setNuovoMessaggio] = useState('');
  const [canaleMessaggio, setCanaleMessaggio] = useState<'whatsapp' | 'email' | 'telegram' | 'portal'>('portal');
  const [inviandoMessaggio, setInviandoMessaggio] = useState(false);

  /**
   * Errore della rilettura dopo la firma. Serve per distinguere le due cose davanti al cliente:
   * la firma è registrata a database, è solo la pagina che non si è aggiornata.
   */
  const [erroreRicarica, setErroreRicarica] = useState<string | null>(null);

  // Stati di autenticazione del portale (credenziali, magic link e gestione della password
  // personale) e i quattro handler collegati: estratti in `usePortalAuth`. La chiamata riceve
  // `loadPortalData`, `clientObj` e `setClientObj` da `usePortalData` (l'hook invocato sopra),
  // e i suoi setter `setIsAuthenticated`/`setAccessoNegato` tornano nel ref bridge collegato
  // subito sotto; le uscite servono già agli useEffect sottostanti e al render.
  const {
    isAuthenticated,
    setIsAuthenticated,
    accessoNegato,
    setAccessoNegato,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginLoading,
    loginError,
    setLoginError,
    authMode,
    setAuthMode,
    manualMagicToken,
    setManualMagicToken,
    clientPassCurrent,
    setClientPassCurrent,
    clientPassNew,
    setClientPassNew,
    clientPassConfirm,
    setClientPassConfirm,
    clientPassShow,
    setClientPassShow,
    clientPassLoading,
    clientPassMsg,
    handleClientLogin,
    handleClientLogout,
    handleManualMagicSubmit,
    handleSaveClientPassword,
  } = usePortalAuth({ loadPortalData, clientObj, setClientObj });

  // Il ref bridge si collega ai setter veri di `usePortalAuth`: i setter di `useState`
  // sono referenzialmente stabili, l'assegnamento è idempotente e `loadPortalData`
  // non viene mai invocata durante il render, quindi i thunk delegano sempre a un
  // setter già valido.
  authSettersRef.current = { setIsAuthenticated, setAccessoNegato };

  useEffect(() => {
    loadPortalData();
  }, [token]);

  // Campanella delle notifiche del portale cliente (Blocco 3): caricamento all'accesso e
  // aggiornamento in tempo reale via stream SSE, estratti in `usePortalNotifiche`.
  const {
    notifichePortale,
    notifPortaleOpen,
    setNotifPortaleOpen,
    notificheNonLette,
    handleSegnaNotificheLette,
    handleSelezionaNotificaPortale,
  } = usePortalNotifiche({ isAuthenticated, setActiveTab });

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

  // Firma elettronica del portale (SES/FEA/FEQ): canali, OTP, firma con file, bersaglio,
  // estratti in `usePortalFirma`. La chiamata sta qui, e non accanto agli altri hook,
  // perché riceve `ricaricaDopoFirma` e `getResolvedEngagementHtml`, dichiarate solo
  // poco sopra: spostarla prima le referenzerebbe prima della loro inizializzazione.
  const {
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
  } = usePortalFirma({
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
  });

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
        <PortalStudioPreviewBanner
          clientName={clientName}
          clientObj={clientObj}
          elencoClienti={elencoClienti}
          handleSelectPreviewClient={handleSelectPreviewClient}
        />
      )}

      {/* Top Navbar Header */}
      <PortalTopNav
        currentStudioInfo={currentStudioInfo}
        clientName={clientName}
        clientProjects={clientProjects}
        selectedProjectId={selectedProjectId}
        notifPortaleOpen={notifPortaleOpen}
        setNotifPortaleOpen={setNotifPortaleOpen}
        notificheNonLette={notificheNonLette}
        handleSegnaNotificheLette={handleSegnaNotificheLette}
        notifichePortale={notifichePortale}
        handleSelezionaNotificaPortale={handleSelezionaNotificaPortale}
        handleSelectProject={handleSelectProject}
        handleClientLogout={handleClientLogout}
      />

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
      <PortalHeroBanner
        progettoAttivo={progettoAttivo}
        signed={signed}
      />

      {/* Portal Tabs Bar */}
      <PortalTabsBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

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
          // Fase 3 FEA (§4) — livello, firmatario identificato e documento di
          // riconoscimento: tutto ciò che la modale sa del valore legale che
          // il documento esige passa da qui.
          livelloFirma={livelloFirmaModale}
          firmatariAmmessi={firmatariAmmessi}
          firmatarioSelezionato={firmatarioSelezionato}
          setFirmatarioSelezionato={setFirmatarioSelezionato}
          onCaricaDocRiconoscimento={onCaricaDocRiconoscimento}
          docRiconoscimentoNome={docRiconoscimentoNome}
          onRimuoviDocRiconoscimento={onRimuoviDocRiconoscimento}
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
          clienteId={clientObj?.id}
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
          clienteId={clientObj?.id}
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
          livelloRichiesto={livelloFirmaEffettivo(documentoDaCaricare.livelloFirmaRichiesto)}
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
