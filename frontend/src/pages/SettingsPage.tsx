import React, { useState, useEffect } from 'react';
import { fetchUtentiTenant, creaUtenteTenantApi, uploadFileApi, fetchTenantInfoApi, updateTenantInfoApi, testEmailApi, testImapApi, testChannelApi, resetPasswordUtenteApi, rigeneraSlugWhatsappApi } from '../api/client';
import { chiaviDatiLocali } from '../utils/datiLocali';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, isAdminStudio, saveTenantInfoToStorage } from '../utils/tenant';
import { useAnagraficaStudio } from '../hooks/useAnagraficaStudio';
import { AnagraficaStudioModal } from '../components/AnagraficaStudioModal';
import { UserProfileModal } from '../components/UserProfileModal';
import { OperatorDetailModal } from '../components/settings/OperatorDetailModal';
import { useToast } from '../components/ui/ToastProvider';
import { confirm } from '../components/ui/ConfirmProvider';
import { TabCompany } from '../components/settings/TabCompany';
import { TabInvoiceDesign } from '../components/settings/TabInvoiceDesign';
import { InvoicePreviewModal } from '../components/settings/InvoicePreviewModal';
import { TabChannels } from '../components/settings/TabChannels';
import { TabUsers } from '../components/settings/TabUsers';
import { TabSdi } from '../components/settings/TabSdi';
import { TabManutenzione } from '../components/settings/TabManutenzione';
import { TabSicurezza } from '../components/settings/TabSicurezza';
import { TabCompliance } from '../components/settings/TabCompliance';
import { fetchModuliTenant } from '../api/kyc';
import { InviteUserModal } from '../components/settings/InviteUserModal';
import { ResetPasswordModal } from '../components/settings/ResetPasswordModal';
import { ArchiviaOperatoreModal } from '../components/settings/ArchiviaOperatoreModal';
import styles from './Settings.module.css';

type Tab = 'company' | 'users' | 'sdi' | 'invoice_design' | 'channels' | 'compliance' | 'manutenzione' | 'sicurezza';

export function SettingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('company');
  /**
   * §7 — le stesse informazioni della guida al primo accesso (`AnagraficaStudioModal`), richiamabili
   * da qui: chi arriva in Anagrafica per compilare deve poter vedere **cosa** manca e **perché**,
   * senza dover aspettare che il promemoria ricompaia. La lettura è la stessa funzione
   * (`fetchAnagraficaStudioApi`), quindi le due schermate non possono dire cose diverse.
   */
  const [guidaAnagraficaAperta, setGuidaAnagraficaAperta] = useState(false);
  const anagraficaStudio = useAnagraficaStudio({ abilitato: isAdminStudio() });
  // Standby moduli a livello di studio (nav-only): l'admin spegne i moduli non usati.
  const MODULI_STANDBY: Array<{ key: string; label: string }> = [
    { key: 'projects', label: 'Progetti' }, { key: 'clients', label: 'Clienti' },
    { key: 'calendar', label: 'Calendario' }, { key: 'invoices', label: 'Fatture & SDI' },
    { key: 'scadenzario', label: 'Scadenzario' }, { key: 'primanota', label: 'Prima Nota' },
    { key: 'banks', label: 'Banche' }, { key: 'retainers', label: 'Retainer' },
    { key: 'documents', label: 'Documenti' }, { key: 'reports', label: 'Report' },
  ];
  const [moduliStandby, setModuliStandby] = useState<string[]>([]);
  // null = stato dei moduli non ancora noto (o lettura fallita). In quel caso il modulo si considera
  // ATTIVO (fail-open, come il backend e il default «studi esistenti ON»): la scheda si nasconde solo
  // quando il server dice esplicitamente che 'kyc' non è tra i concessi.
  const [moduliConcessi, setModuliConcessi] = useState<string[] | null>(null);
  const [moduliMsg, setModuliMsg] = useState<string | null>(null);
  const kycConcesso = moduliConcessi === null ? true : moduliConcessi.includes('kyc');
  const kycAttivo = kycConcesso && !moduliStandby.includes('kyc');
  // I moduli attivabili nello standby: quelli di navigazione + KYC solo se concesso allo studio.
  const moduliToggabili = kycConcesso
    ? [...MODULI_STANDBY, { key: 'kyc', label: '🛡 Compliance & Antiriciclaggio (KYC)' }]
    : MODULI_STANDBY;
  useEffect(() => {
    fetchModuliTenant().then((m) => setModuliConcessi(m.concessi || [])).catch(() => setModuliConcessi(null));
  }, []);
  const toggleModulo = (key: string) =>
    setModuliStandby((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const handleSaveModuli = async () => {
    setModuliMsg(null);
    try {
      const tid = getCurrentTenantId();
      await updateTenantInfoApi({ moduliDisattivati: moduliStandby }, tid);
      let info: any = {};
      try { info = JSON.parse(localStorage.getItem(getTenantStorageKey('bluman_tenant_info', tid)) || '{}'); } catch { /* storage vuoto */ }
      saveTenantInfoToStorage(tid, { ...info, moduliDisattivati: moduliStandby });
      setModuliMsg('Salvato: i moduli in standby sono nascosti dalla navigazione per lo studio.');
    } catch (e: any) {
      setModuliMsg(e?.message || 'Errore nel salvataggio dei moduli');
    }
  };
  // Ruolo dell'utente corrente — serve a TabSicurezza per mostrare la sezione 2FA
  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('bluman_user') || '{}'); } catch { return {}; } })();
  const currentRuolo: string = currentUser?.ruolo || '';
  const [saved, setSaved] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Stati Reset Password Utente
  const [resetModalUser, setResetModalUser] = useState<any | null>(null);
  // Archiviazione / riattivazione di un operatore (§2bis): la persona e il verso dell'azione.
  const [archiviaModal, setArchiviaModal] = useState<{ persona: any; verso: 'archivia' | 'riattiva' } | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetResult, setResetResult] = useState<{ email: string; passwordTemporanea: string; nome: string } | null>(null);
  const [copiedResetPass, setCopiedResetPass] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetUserPassword = async () => {
    if (!resetModalUser) return;
    setResettingPassword(true);
    setResetError(null);
    try {
      const res = await resetPasswordUtenteApi(resetModalUser.id);
      setResetResult({
        email: res.email || resetModalUser.email,
        nome: res.nome || resetModalUser.nome || resetModalUser.name,
        passwordTemporanea: res.passwordTemporanea,
      });
    } catch (err: any) {
      setResetError(err.message || 'Errore durante il reset della password');
    } finally {
      setResettingPassword(false);
    }
  };

  // Manutenzione dei dati locali di questo browser
  const [chiaviLocali, setChiaviLocali] = useState<string[]>([]);
  const [confermaSvuota, setConfermaSvuota] = useState(false);
  const [chiaviRimosse, setChiaviRimosse] = useState<string[] | null>(null);

  // Configuratore Canali Omnichannel & SMTP
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');
  // App Meta **dello studio**: l'App Secret è la chiave con cui il backend verifica la firma
  // dei messaggi in ingresso, quindi è un segreto e non torna mai indietro dal server.
  const [waAppId, setWaAppId] = useState('');
  const [waAppSecret, setWaAppSecret] = useState('');
  const [waOtpTemplate, setWaOtpTemplate] = useState('');
  const [waOtpTemplateLang, setWaOtpTemplateLang] = useState('');
  // Calcolata dal server dallo slug dello studio: non si scrive e non si salva, si legge.
  const [waCallbackUrl, setWaCallbackUrl] = useState<string | null>(null);
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgBotUsername, setTgBotUsername] = useState('');
  // Signal: il demone è dello studio, quindi indirizzo, token e numero sono suoi. Il campo
  // `signalCliEndpoint` che stava qui si salvava e nessuno lo leggeva.
  const [signalEndpoint, setSignalEndpoint] = useState('');
  const [signalToken, setSignalToken] = useState('');
  const [signalNumber, setSignalNumber] = useState('');

  // SMTP Server Credentials (Posta in Uscita)
  const [smtpHost, setSmtpHost] = useState('');
  // Nome che il certificato del server deve attestare quando è diverso dall'host: vuoto, si
  // verifica l'host. Nessuna scorciatoia sulla verifica TLS, solo il nome con cui confrontarla.
  const [smtpServername, setSmtpServername] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [smtpReplyTo, setSmtpReplyTo] = useState('');
  const [smtpBcc, setSmtpBcc] = useState('');
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<string | null>(null);

  // IMAP / POP3 Server Credentials (Posta in Entrata & Ingestion)
  const [imapProtocol, setImapProtocol] = useState<'imap' | 'pop3'>('imap');
  const [imapHost, setImapHost] = useState('');
  // Gemello del campo SMTP: qui serve al caso in cui il nome coperto dal certificato non ha
  // record DNS, e nessun singolo valore nel campo «Host» può soddisfare DNS e certificato.
  const [imapServername, setImapServername] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUser, setImapUser] = useState('');
  const [imapPass, setImapPass] = useState('');
  const [imapFolder, setImapFolder] = useState('INBOX');
  const [imapPollInterval, setImapPollInterval] = useState('5m');
  const [testingImap, setTestingImap] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<string | null>(null);

  // Firma Elettronica & Disclaimer Privacy Email Studio
  const [emailSignatureHtml, setEmailSignatureHtml] = useState('');

  // Form dati azienda (Sede Legale & Operativa)
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [pIva, setPIva] = useState('');
  const [codFisc, setCodFisc] = useState('');
  const [sedeLegale, setSedeLegale] = useState('');
  const [sedeOperativa, setSedeOperativa] = useState('');
  const [email, setEmail] = useState('');
  const [pec, setPec] = useState('');
  const [telefono, setTelefono] = useState('');
  const [iban, setIban] = useState('');
  const [regimeFiscale, setRegimeFiscale] = useState('');
  const [capitaleSociale, setCapitaleSociale] = useState('');
  const [regImprese, setRegImprese] = useState('');

  // Personalizzazione Layout Fattura & PDF
  const [logoUrl, setLogoUrl] = useState('');
  const [coloreTemaFattura, setColoreTemaFattura] = useState('var(--indigo-d)');
  const [titoloIntestazione, setTitoloIntestazione] = useState('');
  const [notePieDiPagina, setNotePieDiPagina] = useState('');
  const [mostraSdi, setMostraSdi] = useState(true);
  const [mostraIva, setMostraIva] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Form utenti
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [modalUserOpen, setModalUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserSpecializzazione, setNewUserSpecializzazione] = useState('');
  const [newUserRole, setNewUserRole] = useState<'super_admin' | 'advisor' | 'operator'>('advisor');
  const [submittingUser, setSubmittingUser] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<any | null>(null);
  // §35 — `GET /tenant/info` restituisce le credenziali vuote con il flag `<chiave>Impostata`:
  // i campi password restano vuoti (lasciarli vuoti = «non modificare») e questi flag dicono
  // all'operatore che sul server la credenziale c'è già.
  const [segretiImpostati, setSegretiImpostati] = useState<{
    smtpPass?: boolean; imapPass?: boolean; waAccessToken?: boolean; waVerifyToken?: boolean; waAppSecret?: boolean; tgBotToken?: boolean; signalToken?: boolean;
  }>({});
  
  const loadTenantData = async () => {
    setLoadingUsers(true);
    const currentTenantId = getCurrentTenantId();
    const studioDefaults = getStudioInfoForTenant(currentTenantId);

    const dbTenant = await fetchTenantInfoApi(currentTenantId);
    const localInfoStr = localStorage.getItem(getTenantStorageKey('bluman_tenant_info', currentTenantId));
    let localInfo: any = {};
    if (localInfoStr) {
      try { localInfo = JSON.parse(localInfoStr); } catch {}
    }

    // Unione intelligente: parte dai defaults dello studio, sovrascrive con i dati DB se non vuoti, e infine con le modifiche locali
    const tData: any = { ...studioDefaults };
    if (dbTenant && typeof dbTenant === 'object') {
      Object.keys(dbTenant).forEach(k => {
        if (dbTenant[k] !== null && dbTenant[k] !== undefined && dbTenant[k] !== '') {
          tData[k] = dbTenant[k];
        }
      });
    }
    if (localInfo && typeof localInfo === 'object') {
      Object.keys(localInfo).forEach(k => {
        if (localInfo[k] !== null && localInfo[k] !== undefined && localInfo[k] !== '') {
          tData[k] = localInfo[k];
        }
      });
    }

    if (tData) {
      setRagioneSociale(tData.ragioneSociale || '');
      setModuliStandby(Array.isArray(tData.moduliDisattivati) ? tData.moduliDisattivati : []);
      setPIva(tData.piva || '');
      setCodFisc(tData.codiceFiscale || '');
      setSedeLegale(tData.sedeLegale || '');
      setSedeOperativa(tData.sedeOperativa || '');
      setEmail(tData.email || '');
      setPec(tData.pec || '');
      setTelefono(tData.telefono || '');
      setIban(tData.iban || '');
      setLogoUrl(tData.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url', currentTenantId)) || '');
      setColoreTemaFattura(tData.coloreTemaFattura || 'var(--indigo-d)');
      setNotePieDiPagina(tData.notePieFattura || tData.notePieDiPagina || '');
      setTitoloIntestazione(tData.titoloIntestazione || '');
      setWaPhoneId(tData.waPhoneId || '');
      setWaAccessToken(tData.waAccessToken || '');
      setWaVerifyToken(tData.waVerifyToken || '');
      setWaAppId(tData.waAppId || '');
      setWaAppSecret(tData.waAppSecret || '');
      setWaOtpTemplate(tData.waOtpTemplate || '');
      setWaOtpTemplateLang(tData.waOtpTemplateLang || 'it');
      setWaCallbackUrl(tData.waCallbackUrl || null);
      setTgBotToken(tData.tgBotToken || '');
      setTgBotUsername(tData.tgBotUsername || '');
      setSmtpHost(tData.smtpHost || '');
      setSmtpServername(tData.smtpServername || '');
      setSmtpPort(tData.smtpPort ? String(tData.smtpPort) : '465');
      setSmtpSecure(tData.smtpSecure != null ? tData.smtpSecure : true);
      setSmtpUser(tData.smtpUser || '');
      setSmtpPass(tData.smtpPass || '');
      setSmtpFromEmail(tData.smtpFromEmail || '');
      setSmtpFromName(tData.smtpFromName || '');
      setSmtpReplyTo(tData.smtpReplyTo || '');
      setSmtpBcc(tData.smtpBcc || '');
      setImapProtocol(tData.imapProtocol || 'imap');
      setImapHost(tData.imapHost || '');
      setImapServername(tData.imapServername || '');
      setImapPort(tData.imapPort ? String(tData.imapPort) : '993');
      setImapSecure(tData.imapSecure != null ? tData.imapSecure : true);
      setImapUser(tData.imapUser || '');
      setImapPass(tData.imapPass || '');
      setImapFolder(tData.imapFolder || 'INBOX');
      setImapPollInterval(tData.imapPollInterval || '5m');
      setEmailSignatureHtml(tData.emailSignatureHtml || '');
      setRegimeFiscale(tData.regimeFiscale || '');
      setCapitaleSociale(tData.capitaleSociale || '');
      setRegImprese(tData.regImprese || '');
      setMostraSdi(tData.mostraSdi !== undefined ? tData.mostraSdi : true);
      setMostraIva(tData.mostraIva !== undefined ? tData.mostraIva : true);
      setSignalEndpoint(tData.signalEndpoint || '');
      setSignalNumber(tData.signalNumber || '');
      setSegretiImpostati({
        smtpPass: Boolean(tData.smtpPassImpostata),
        imapPass: Boolean(tData.imapPassImpostata),
        waAccessToken: Boolean(tData.waAccessTokenImpostata),
        waVerifyToken: Boolean(tData.waVerifyTokenImpostata),
        waAppSecret: Boolean(tData.waAppSecretImpostata),
        tgBotToken: Boolean(tData.tgBotTokenImpostata),
        signalToken: Boolean(tData.signalTokenImpostata),
      });
    }

    const dbUsers = await fetchUtentiTenant();
    if (dbUsers && Array.isArray(dbUsers) && dbUsers.length > 0) {
      setUsers(dbUsers);
    }
    setLoadingUsers(false);
  };

  useEffect(() => {
    loadTenantData();
  }, []);

  const handleSaveCompany = async (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();
    const currentTenantId = getCurrentTenantId();
    const dataToSave = {
      id: currentTenantId,
      ragioneSociale,
      piva: pIva,
      codiceFiscale: codFisc,
      sedeLegale,
      sedeOperativa,
      email,
      pec,
      telefono,
      iban,
      regimeFiscale,
      capitaleSociale,
      regImprese,
      logoUrl,
      coloreTemaFattura,
      notePieFattura: notePieDiPagina,
      titoloIntestazione,
      mostraSdi,
      mostraIva,
      // `emailInboundParseUrl` non si manda più: puntava a una rotta inesistente e il backend
      // non lo accetta più. La posta in arrivo si legge dalla casella IMAP configurata sopra.
      signalEndpoint,
      signalToken,
      signalNumber,
      waPhoneId,
      waAccessToken,
      waVerifyToken,
      waAppId,
      waAppSecret,
      waOtpTemplate,
      waOtpTemplateLang,
      tgBotToken,
      tgBotUsername,
      smtpHost,
      smtpServername,
      smtpPort: Number(smtpPort) || 465,
      smtpSecure,
      smtpUser,
      smtpPass,
      smtpFromEmail,
      smtpFromName,
      smtpReplyTo,
      smtpBcc,
      imapProtocol,
      imapHost,
      imapServername,
      imapPort: Number(imapPort) || 993,
      imapSecure,
      imapUser,
      imapPass,
      imapFolder,
      imapPollInterval,
      emailSignatureHtml,
    };

    saveTenantInfoToStorage(currentTenantId, dataToSave);
    // §3.3 — prima il salvataggio server era atteso senza try/catch: al primo errore di
    // rete l'handler moriva in silenzio e il banner «Salvato» non compariva né compariva
    // un messaggio. Ora il fallimento è dichiarato (i dati restano in bozza locale).
    try {
      const salvato: any = await updateTenantInfoApi(dataToSave, currentTenantId);
      // §35 — le credenziali appena inserite non tornano indietro dal server: si svuotano i
      // campi e si aggiornano i flag «già impostata», così il prossimo salvataggio con i campi
      // vuoti non prova a riscrivere niente.
      if (salvato && typeof salvato === 'object') {
        setSegretiImpostati({
          smtpPass: Boolean(salvato.smtpPassImpostata),
          imapPass: Boolean(salvato.imapPassImpostata),
          waAccessToken: Boolean(salvato.waAccessTokenImpostata),
          waVerifyToken: Boolean(salvato.waVerifyTokenImpostata),
          waAppSecret: Boolean(salvato.waAppSecretImpostata),
          tgBotToken: Boolean(salvato.tgBotTokenImpostata),
          signalToken: Boolean(salvato.signalTokenImpostata),
        });
        // Lo slug nasce al primo salvataggio della configurazione WhatsApp: la Callback URL
        // che il server ha appena calcolato è quella da incollare in Meta, e senza aggiornarla
        // qui l'operatore continuerebbe a vedere il campo vuoto fino al ricaricamento.
        if (typeof salvato.waCallbackUrl === 'string') setWaCallbackUrl(salvato.waCallbackUrl);
      }
      if (smtpPass) setSmtpPass('');
      if (imapPass) setImapPass('');
      if (waAccessToken) setWaAccessToken('');
      if (waVerifyToken) setWaVerifyToken('');
      if (waAppSecret) setWaAppSecret('');
      if (tgBotToken) setTgBotToken('');
      if (signalToken) setSignalToken('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      toast.errore(`Salvataggio impostazioni NON riuscito: ${err?.message || 'errore di rete'}. I dati sono conservati in locale su questo dispositivo ma non sincronizzati col server: riprova.`);
    }
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const json = await testEmailApi({
        smtpHost,
        smtpServername,
        smtpPort: Number(smtpPort) || 465,
        smtpSecure,
        smtpUser,
        smtpPass,
        smtpFromEmail,
        smtpFromName,
        emailDestinatario: smtpUser || email,
      });
      // Riuscita è solo `success: true`. Prima bastava che il messaggio contenesse «successo»,
      // e il messaggio lo scrive il server: una risposta di errore che diceva «la prova non è
      // riuscita, riprova con successo» — o un testo cambiato nel backend — veniva mostrata
      // come «✓ CONNESSO!». Il messaggio si legge, non si interpreta (regola 7).
      if (json?.success) {
        setSmtpTestResult(`✓ CONNESSO! ${json.message || `Email di prova inviata a ${smtpUser || email}`}`);
      } else {
        setSmtpTestResult(`❌ ${json?.errore || json?.message || 'Prova SMTP non riuscita: il server non ha riportato il motivo.'}`);
      }
    } catch (err: any) {
      setSmtpTestResult(`❌ Errore di connessione: ${err.message}`);
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleTestImap = async () => {
    setTestingImap(true);
    setImapTestResult(null);
    try {
      const json = await testImapApi({
        imapHost,
        imapServername,
        imapPort: Number(imapPort) || 993,
        imapSecure,
        imapUser,
        imapPass,
      });
      if (json?.success) {
        setImapTestResult(`✓ CONNESSO! ${json.message || `Connessione IMAP verificata su ${imapHost}:${imapPort}`}`);
      } else {
        setImapTestResult(`❌ ${json?.errore || json?.message || 'Prova IMAP non riuscita: il server non ha riportato il motivo.'}`);
      }
    } catch (err: any) {
      setImapTestResult(`❌ Errore di connessione IMAP: ${err.message}`);
    } finally {
      setTestingImap(false);
    }
  };

  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [channelTestResult, setChannelTestResult] = useState<Record<string, string>>({});
  const [rigenerandoSlug, setRigenerandoSlug] = useState(false);

  const handleTestChannel = async (channel: 'whatsapp' | 'telegram' | 'signal') => {
    setTestingChannel(channel);
    try {
      // La prova Signal non manda più `signalCliEndpoint` (un campo che il server non conosceva):
      // servono indirizzo **e** numero, perché il numero è il mittente e senza non si spedisce.
      const json = await testChannelApi({
        channel,
        waPhoneId,
        waAccessToken,
        tgBotToken,
        signalEndpoint,
        signalToken,
        signalNumber,
      });
      if (json && json.success) {
        setChannelTestResult(prev => ({ ...prev, [channel]: `✓ ${json.message}` }));
      } else {
        // Il motivo sta in `message`: il server risponde `{success, message}` in entrambi i casi
        // (è la stessa funzione `esito`), mentre qui si leggeva `json.errore` — che non esiste.
        // L'operatore vedeva «Connessione fallita» anche quando il server aveva spiegato per
        // esteso che Meta aveva rifiutato le credenziali, e non aveva modo di correggere nulla.
        setChannelTestResult(prev => ({ ...prev, [channel]: `❌ ${json?.message || `${channel.toUpperCase()}: il server ha risposto ${json?.status || 'senza spiegare il motivo'}`}` }));
      }
    } catch (err: any) {
      // Prima qui c'era «Modalità Simulatore: connessione verificata con successo in ambiente
      // dev»: con il backend irraggiungibile l'operatore leggeva un successo verde. Un canale
      // non provato non è un canale funzionante (regola 7).
      setChannelTestResult(prev => ({
        ...prev,
        [channel]: `❌ Prova non eseguita: ${err?.message || 'backend non raggiungibile'}. Il canale non è stato verificato.`,
      }));
    } finally {
      setTestingChannel(null);
    }
  };

  /**
   * Rotazione del path di callback WhatsApp.
   *
   * La conferma è doppia perché la conseguenza è un'interruzione: finché la Callback URL in Meta
   * non viene aggiornata, Meta chiama il path vecchio e quel path risponde 404 — i messaggi dei
   * clienti non entrano più. Meglio un dialogo in più che un canale spento senza che nessuno
   * colleghi il fatto al pulsante premuto.
   */
  const handleRigeneraSlugWhatsapp = async () => {
    const conferma = await confirm({
      titolo: 'Rigenerare il path di callback WhatsApp?',
      messaggio:
        'I messaggi dei clienti NON verranno più ricevuti finché non aggiorni la Callback URL ' +
        'nella dashboard Meta con il nuovo indirizzo. L\'operazione non si annulla.',
      confermaLabel: 'Rigenera',
      pericolo: true,
    });
    if (!conferma) return;

    setRigenerandoSlug(true);
    try {
      const esito = await rigeneraSlugWhatsappApi();
      if (!esito.ok) {
        toast.errore(`Rotazione non riuscita: ${esito.errore || 'errore non specificato'}`);
        return;
      }
      if (esito.waCallbackUrl) setWaCallbackUrl(esito.waCallbackUrl);
      toast.successo('Nuovo path generato. Aggiorna la Callback URL in Meta con l\'indirizzo mostrato qui sopra.');
    } finally {
      setRigenerandoSlug(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadingLogo(true);
      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(file);
        });
        const base64Data = await base64Promise;
        const uploadRes = await uploadFileApi(file.name, base64Data);
        let finalLogoUrl = '';
        if (uploadRes && uploadRes.url) {
          finalLogoUrl = uploadRes.url;
        } else {
          finalLogoUrl = base64Data;
        }
        setLogoUrl(finalLogoUrl);
        await updateTenantInfoApi({ logoUrl: finalLogoUrl });
        localStorage.setItem(getTenantStorageKey('bluman_logo_url'), finalLogoUrl);
        toast.successo('Logo caricato e salvato permanentemente su Supabase PostgreSQL!');
      } catch (err: any) {
        // §3.3 — upload o salvataggio falliti: prima sparivano in console.error e il logo
        // sembrava caricato (era già in anteprima). Il localStorage viene scritto solo dopo.
        toast.errore(`Caricamento logo non riuscito: ${err?.message || 'errore di rete'}. Il logo NON è stato salvato sul server.`);
      } finally {
        setUploadingLogo(false);
      }
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    setSubmittingUser(true);
    try {
      await creaUtenteTenantApi({
        nome: newUserName,
        email: newUserEmail,
        ruolo: newUserRole,
        specializzazione: newUserSpecializzazione,
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserSpecializzazione('');
      setModalUserOpen(false);
      await loadTenantData();
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      // §3.3 — la creazione del collaboratore è una scrittura critica (account + eventuale
      // email di invito): il fallimento va mostrato, il modal resta aperto per riprovare.
      toast.errore(`Creazione collaboratore non riuscita: ${err?.message || 'errore di rete'}. L'utente NON è stato creato.`);
    } finally {
      setSubmittingUser(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Impostazioni Studio, Sede Legale & Layout Fatture</div>
          <div className={styles.subTitle}>Configura le sedi legali/operative, la personalizzazione del modello di fattura PDF ed il team</div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'company' ? styles.tabActive : ''}`} onClick={() => setTab('company')}>
          🏢 Anagrafica Studio & Sedi Legali
        </button>
        <button className={`${styles.tab} ${tab === 'invoice_design' ? styles.tabActive : ''}`} onClick={() => setTab('invoice_design')}>
          🎨 Personalizzazione Modello Fattura PDF
        </button>
        <button className={`${styles.tab} ${tab === 'channels' ? styles.tabActive : ''}`} onClick={() => setTab('channels')}>
          💬 Integratore Canali Omnichannel
        </button>
        <button className={`${styles.tab} ${tab === 'users' ? styles.tabActive : ''}`} onClick={() => setTab('users')}>
          👥 Gestione Team ({users.length})
        </button>
        <button className={`${styles.tab} ${tab === 'sdi' ? styles.tabActive : ''}`} onClick={() => setTab('sdi')}>
          📨 Fatturazione Elettronica (Invio Manuale)
        </button>
        {kycAttivo && (
          <button className={`${styles.tab} ${tab === 'compliance' ? styles.tabActive : ''}`} onClick={() => setTab('compliance')}>
            🛡️ Compliance & Antiriciclaggio
          </button>
        )}
        <button
          className={`${styles.tab} ${tab === 'manutenzione' ? styles.tabActive : ''}`}
          onClick={() => { setTab('manutenzione'); setChiaviLocali(chiaviDatiLocali()); setChiaviRimosse(null); setConfermaSvuota(false); }}
        >
          🧹 Manutenzione Dati Locali
        </button>
        {currentRuolo === 'super_admin' && (
          <button
            className={`${styles.tab} ${tab === 'sicurezza' ? styles.tabActive : ''}`}
            onClick={() => setTab('sicurezza')}
          >
            🔐 Sicurezza Account
          </button>
        )}
      </div>

      {saved && (
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
          ✓ Impostazioni studio e layout fattura aggiornati con successo!
        </div>
      )}

      {/* TAB 1: Dati Società & Sedi */}
      {tab === 'company' && (
        <>
        <TabCompany
          ragioneSociale={ragioneSociale}
          setRagioneSociale={setRagioneSociale}
          pIva={pIva}
          setPIva={setPIva}
          codFisc={codFisc}
          setCodFisc={setCodFisc}
          capitaleSociale={capitaleSociale}
          setCapitaleSociale={setCapitaleSociale}
          regImprese={regImprese}
          setRegImprese={setRegImprese}
          sedeLegale={sedeLegale}
          setSedeLegale={setSedeLegale}
          sedeOperativa={sedeOperativa}
          setSedeOperativa={setSedeOperativa}
          email={email}
          setEmail={setEmail}
          pec={pec}
          setPec={setPec}
          telefono={telefono}
          setTelefono={setTelefono}
          regimeFiscale={regimeFiscale}
          setRegimeFiscale={setRegimeFiscale}
          iban={iban}
          setIban={setIban}
          handleSaveCompany={handleSaveCompany}
        />
        {/* §7 — cosa manca per poter emettere un documento fiscale, accanto ai campi che lo
            compilano. Il conteggio e l'elenco vengono dal server: qui non si indovina nulla. */}
        {isAdminStudio() && (
          <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>📋 Dati obbligatori per fatturare</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Ragione sociale, partita IVA, codice fiscale, sede legale, regime fiscale e IBAN sono ciò che
              finisce in ogni fattura elettronica. Senza questi dati l'app <strong>rifiuta di comporre</strong> il
              documento, invece di riempire i campi con un valore inventato.
            </div>
            {!anagraficaStudio.letto ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                ℹ️ Stato non verificato: il server non ha risposto all'ultima lettura. Non è detto che manchi
                qualcosa — non l'ho potuto controllare.
              </div>
            ) : anagraficaStudio.completa ? (
              <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Anagrafica completa: nessun documento viene rifiutato per dati mancanti.</div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--pill-amber-fg)' }}>
                ⚠ Mancano {anagraficaStudio.mancanti.length}{' '}
                {anagraficaStudio.mancanti.length === 1 ? 'campo' : 'campi'}:{' '}
                {anagraficaStudio.mancanti.map(c => c.etichetta).join(', ')}.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setGuidaAnagraficaAperta(true)}>
                Rivedi la guida
              </button>
              {!anagraficaStudio.letto && (
                <button type="button" className="btn btn-sm" onClick={anagraficaStudio.ricarica}>Riprova la lettura</button>
              )}
            </div>
          </div>
        )}
        <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🧩 Moduli in standby</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Spegni i moduli che lo studio non usa per ora: spariscono dalla navigazione per tutti. Non è un blocco di sicurezza (per quello resta la Matrice Permessi per utente). Dashboard e Impostazioni restano sempre attive.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {moduliToggabili.map((m) => {
              const attivo = !moduliStandby.includes(m.key);
              return (
                <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: attivo ? 'var(--card)' : 'var(--pill-amber-bg)' }}>
                  <input type="checkbox" checked={attivo} onChange={() => toggleModulo(m.key)} />
                  <span>{m.label}{attivo ? '' : ' — standby'}</span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveModuli}>Salva moduli</button>
            {moduliMsg && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{moduliMsg}</span>}
          </div>
        </div>
        </>
      )}

      {/* TAB 2: Personalizzazione Layout Fattura PDF (§Admin) */}
      {tab === 'invoice_design' && (
        <TabInvoiceDesign
          setPreviewOpen={setPreviewOpen}
          handleLogoUpload={handleLogoUpload}
          uploadingLogo={uploadingLogo}
          logoUrl={logoUrl}
          setColoreTemaFattura={setColoreTemaFattura}
          coloreTemaFattura={coloreTemaFattura}
          titoloIntestazione={titoloIntestazione}
          setTitoloIntestazione={setTitoloIntestazione}
          notePieDiPagina={notePieDiPagina}
          setNotePieDiPagina={setNotePieDiPagina}
          mostraSdi={mostraSdi}
          setMostraSdi={setMostraSdi}
          mostraIva={mostraIva}
          setMostraIva={setMostraIva}
          handleSaveCompany={handleSaveCompany}
        />
      )}

      {/* Modal Live Preview Fattura PDF (§Admin) */}
      {previewOpen && (
        <InvoicePreviewModal
          coloreTemaFattura={coloreTemaFattura}
          logoUrl={logoUrl}
          titoloIntestazione={titoloIntestazione}
          ragioneSociale={ragioneSociale}
          sedeLegale={sedeLegale}
          sedeOperativa={sedeOperativa}
          pIva={pIva}
          iban={iban}
          mostraSdi={mostraSdi}
          notePieDiPagina={notePieDiPagina}
          setPreviewOpen={setPreviewOpen}
        />
      )}

      {/* Guida ai dati obbligatori (§7), richiamata dall'Anagrafica. `mostraCompila={false}`:
          i campi sono già in questa pagina, e un pulsante che ci riporta dove siamo sarebbe
          una bugia comoda. */}
      {guidaAnagraficaAperta && (
        <AnagraficaStudioModal
          stato={anagraficaStudio}
          onClose={() => setGuidaAnagraficaAperta(false)}
          onCompila={() => setGuidaAnagraficaAperta(false)}
          mostraCompila={false}
        />
      )}

      {/* TAB 3: Configurazione Canali Omnichannel (WhatsApp, Telegram, Email, Signal) */}
      {tab === 'channels' && (
        <TabChannels
          handleSaveCompany={handleSaveCompany}
          handleTestSmtp={handleTestSmtp}
          testingSmtp={testingSmtp}
          smtpTestResult={smtpTestResult}
          smtpHost={smtpHost}
          setSmtpHost={setSmtpHost}
          smtpServername={smtpServername}
          setSmtpServername={setSmtpServername}
          smtpPort={smtpPort}
          setSmtpPort={setSmtpPort}
          smtpUser={smtpUser}
          setSmtpUser={setSmtpUser}
          smtpPass={smtpPass}
          setSmtpPass={setSmtpPass}
          smtpFromEmail={smtpFromEmail}
          setSmtpFromEmail={setSmtpFromEmail}
          smtpFromName={smtpFromName}
          setSmtpFromName={setSmtpFromName}
          smtpReplyTo={smtpReplyTo}
          setSmtpReplyTo={setSmtpReplyTo}
          smtpBcc={smtpBcc}
          setSmtpBcc={setSmtpBcc}
          smtpSecure={smtpSecure}
          setSmtpSecure={setSmtpSecure}
          handleTestImap={handleTestImap}
          testingImap={testingImap}
          imapTestResult={imapTestResult}
          imapProtocol={imapProtocol}
          setImapProtocol={setImapProtocol}
          imapHost={imapHost}
          setImapHost={setImapHost}
          imapServername={imapServername}
          setImapServername={setImapServername}
          imapPort={imapPort}
          setImapPort={setImapPort}
          imapFolder={imapFolder}
          setImapFolder={setImapFolder}
          imapUser={imapUser}
          setImapUser={setImapUser}
          imapPass={imapPass}
          setImapPass={setImapPass}
          imapPollInterval={imapPollInterval}
          setImapPollInterval={setImapPollInterval}
          imapSecure={imapSecure}
          setImapSecure={setImapSecure}
          emailSignatureHtml={emailSignatureHtml}
          setEmailSignatureHtml={setEmailSignatureHtml}
          handleTestChannel={handleTestChannel}
          testingChannel={testingChannel}
          channelTestResult={channelTestResult}
          waPhoneId={waPhoneId}
          setWaPhoneId={setWaPhoneId}
          waVerifyToken={waVerifyToken}
          setWaVerifyToken={setWaVerifyToken}
          waAppId={waAppId}
          setWaAppId={setWaAppId}
          waAppSecret={waAppSecret}
          setWaAppSecret={setWaAppSecret}
          waOtpTemplate={waOtpTemplate}
          setWaOtpTemplate={setWaOtpTemplate}
          waOtpTemplateLang={waOtpTemplateLang}
          setWaOtpTemplateLang={setWaOtpTemplateLang}
          waCallbackUrl={waCallbackUrl}
          onRigeneraSlug={handleRigeneraSlugWhatsapp}
          rigenerandoSlug={rigenerandoSlug}
          waAccessToken={waAccessToken}
          setWaAccessToken={setWaAccessToken}
          tgBotUsername={tgBotUsername}
          setTgBotUsername={setTgBotUsername}
          tgBotToken={tgBotToken}
          setTgBotToken={setTgBotToken}
          signalEndpoint={signalEndpoint}
          setSignalEndpoint={setSignalEndpoint}
          signalToken={signalToken}
          setSignalToken={setSignalToken}
          signalNumber={signalNumber}
          setSignalNumber={setSignalNumber}
          segretiImpostati={segretiImpostati}
        />
      )}

      {/* TAB 3: Gestione Team & Accessi */}
      {tab === 'users' && (
        <TabUsers
          setProfileModalOpen={setProfileModalOpen}
          setModalUserOpen={setModalUserOpen}
          loadingUsers={loadingUsers}
          users={users}
          setSelectedOperator={setSelectedOperator}
          setResetModalUser={setResetModalUser}
          setResetResult={setResetResult}
          setResetError={setResetError}
          setCopiedResetPass={setCopiedResetPass}
          onArchivia={(persona, verso) => setArchiviaModal({ persona, verso })}
          puoGestire={currentRuolo === 'super_admin' || currentRuolo === 'advisor'}
        />
      )}

      {/* TAB 4: Configurazione SDI */}
      {tab === 'sdi' && <TabSdi />}

      {/* TAB Compliance/AML (KYC Malta v0.2, K0/3): impostazioni compliance + audit trail immutabile */}
      {tab === 'compliance' && kycAttivo && <TabCompliance ruolo={currentRuolo} />}

      {/* TAB 5: Manutenzione dei dati locali di questo browser
          Una parte del lavoro dello studio è ancora scritta nel browser e non a database: è la
          ragione per cui il portale del cliente vede meno cose dello studio, e per cui azzerare
          il database non basta a ripulire l'elenco dei progetti. Qui si svuota quella parte. */}
      {tab === 'manutenzione' && (
        <TabManutenzione
          chiaviLocali={chiaviLocali}
          setChiaviLocali={setChiaviLocali}
          chiaviRimosse={chiaviRimosse}
          setChiaviRimosse={setChiaviRimosse}
          confermaSvuota={confermaSvuota}
          setConfermaSvuota={setConfermaSvuota}
        />
      )}
      {/* TAB 6: Sicurezza Account (2FA TOTP — super_admin e advisor) */}
      {tab === 'sicurezza' && (
        <TabSicurezza ruolo={currentRuolo} />
      )}

      {modalUserOpen && (
        <InviteUserModal
          handleAddUser={handleAddUser}
          newUserName={newUserName}
          setNewUserName={setNewUserName}
          newUserSpecializzazione={newUserSpecializzazione}
          setNewUserSpecializzazione={setNewUserSpecializzazione}
          newUserEmail={newUserEmail}
          setNewUserEmail={setNewUserEmail}
          newUserRole={newUserRole}
          setNewUserRole={setNewUserRole}
          setModalUserOpen={setModalUserOpen}
          submittingUser={submittingUser}
        />
      )}

      {/* Modal Scheda Performance & Report Ore Operatore */}
      {selectedOperator && (
        <OperatorDetailModal
          operator={selectedOperator}
          onClose={() => setSelectedOperator(null)}
        />
      )}

      {/* Modal Il Mio Profilo & Password */}
      {profileModalOpen && (
        <UserProfileModal
          user={null}
          onClose={() => setProfileModalOpen(false)}
        />
      )}

      {/* Modal Reset Password Utente */}
      {resetModalUser && (
        <ResetPasswordModal
          resetModalUser={resetModalUser}
          setResetModalUser={setResetModalUser}
          resetError={resetError}
          resetResult={resetResult}
          resettingPassword={resettingPassword}
          handleResetUserPassword={handleResetUserPassword}
          copiedResetPass={copiedResetPass}
          setCopiedResetPass={setCopiedResetPass}
        />
      )}

      {/* Modal Archiviazione / Riattivazione Operatore (§2bis) */}
      {archiviaModal && (
        <ArchiviaOperatoreModal
          persona={archiviaModal.persona}
          verso={archiviaModal.verso}
          onClose={() => setArchiviaModal(null)}
          onFatto={loadTenantData}
        />
      )}
    </div>
  );
}
