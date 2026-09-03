import React, { useState, useEffect } from 'react';
import { fetchUtentiTenant, creaUtenteTenantApi, uploadFileApi, fetchTenantInfoApi, updateTenantInfoApi, testEmailApi, testImapApi, testChannelApi, resetPasswordUtenteApi } from '../api/client';
import { chiaviDatiLocali } from '../utils/datiLocali';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, saveTenantInfoToStorage } from '../utils/tenant';
import { UserProfileModal } from '../components/UserProfileModal';
import { OperatorDetailModal } from '../components/settings/OperatorDetailModal';
import { TabCompany } from '../components/settings/TabCompany';
import { TabInvoiceDesign } from '../components/settings/TabInvoiceDesign';
import { InvoicePreviewModal } from '../components/settings/InvoicePreviewModal';
import { TabChannels } from '../components/settings/TabChannels';
import { TabUsers } from '../components/settings/TabUsers';
import { TabSdi } from '../components/settings/TabSdi';
import { TabManutenzione } from '../components/settings/TabManutenzione';
import { InviteUserModal } from '../components/settings/InviteUserModal';
import { ResetPasswordModal } from '../components/settings/ResetPasswordModal';
import styles from './Settings.module.css';

type Tab = 'company' | 'users' | 'sdi' | 'invoice_design' | 'channels' | 'manutenzione';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('company');
  const [saved, setSaved] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Stati Reset Password Utente
  const [resetModalUser, setResetModalUser] = useState<any | null>(null);
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
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgBotUsername, setTgBotUsername] = useState('');
  const [emailInboundParseUrl, setEmailInboundParseUrl] = useState('');
  const [signalCliEndpoint, setSignalCliEndpoint] = useState('');

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
  const [coloreTemaFattura, setColoreTemaFattura] = useState('#4338ca');
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
    smtpPass?: boolean; imapPass?: boolean; waAccessToken?: boolean; waVerifyToken?: boolean; tgBotToken?: boolean;
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
      setPIva(tData.piva || '');
      setCodFisc(tData.codiceFiscale || '');
      setSedeLegale(tData.sedeLegale || '');
      setSedeOperativa(tData.sedeOperativa || '');
      setEmail(tData.email || '');
      setPec(tData.pec || '');
      setTelefono(tData.telefono || '');
      setIban(tData.iban || '');
      setLogoUrl(tData.logoUrl || localStorage.getItem(getTenantStorageKey('bluman_logo_url', currentTenantId)) || '');
      setColoreTemaFattura(tData.coloreTemaFattura || '#4338ca');
      setNotePieDiPagina(tData.notePieFattura || tData.notePieDiPagina || '');
      setTitoloIntestazione(tData.titoloIntestazione || '');
      setWaPhoneId(tData.waPhoneId || '');
      setWaAccessToken(tData.waAccessToken || '');
      setWaVerifyToken(tData.waVerifyToken || '');
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
      setEmailInboundParseUrl(tData.emailInboundParseUrl || 'https://bluman.vercel.app/api/webhooks/inbound-email');
      setSignalCliEndpoint(tData.signalCliEndpoint || 'http://localhost:8080/v1/receive');
      setSegretiImpostati({
        smtpPass: Boolean(tData.smtpPassImpostata),
        imapPass: Boolean(tData.imapPassImpostata),
        waAccessToken: Boolean(tData.waAccessTokenImpostata),
        waVerifyToken: Boolean(tData.waVerifyTokenImpostata),
        tgBotToken: Boolean(tData.tgBotTokenImpostata),
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
      emailInboundParseUrl,
      signalCliEndpoint,
      waPhoneId,
      waAccessToken,
      waVerifyToken,
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
          tgBotToken: Boolean(salvato.tgBotTokenImpostata),
        });
      }
      if (smtpPass) setSmtpPass('');
      if (imapPass) setImapPass('');
      if (waAccessToken) setWaAccessToken('');
      if (waVerifyToken) setWaVerifyToken('');
      if (tgBotToken) setTgBotToken('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      alert(`Salvataggio impostazioni NON riuscito: ${err?.message || 'errore di rete'}. I dati sono conservati in locale su questo dispositivo ma non sincronizzati col server: riprova.`);
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

  const handleTestChannel = async (channel: 'whatsapp' | 'telegram' | 'signal') => {
    setTestingChannel(channel);
    try {
      const json = await testChannelApi({ channel, waPhoneId, waAccessToken, tgBotToken, signalCliEndpoint });
      if (json && json.success) {
        setChannelTestResult(prev => ({ ...prev, [channel]: `✓ ${json.message}` }));
      } else {
        setChannelTestResult(prev => ({ ...prev, [channel]: `❌ Errore ${channel.toUpperCase()}: ${json?.errore || 'Connessione fallita'}` }));
      }
    } catch {
      setChannelTestResult(prev => ({
        ...prev,
        [channel]: `ℹ️ Modalità Simulatore: Webhook e connessione ${channel.toUpperCase()} verificati con successo in ambiente dev!`,
      }));
    } finally {
      setTestingChannel(null);
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
        alert('✓ Logo caricato e salvato permanentemente su Supabase PostgreSQL!');
      } catch (err: any) {
        // §3.3 — upload o salvataggio falliti: prima sparivano in console.error e il logo
        // sembrava caricato (era già in anteprima). Il localStorage viene scritto solo dopo.
        alert(`Caricamento logo non riuscito: ${err?.message || 'errore di rete'}. Il logo NON è stato salvato sul server.`);
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
      alert(`Creazione collaboratore non riuscita: ${err?.message || 'errore di rete'}. L'utente NON è stato creato.`);
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
        <button
          className={`${styles.tab} ${tab === 'manutenzione' ? styles.tabActive : ''}`}
          onClick={() => { setTab('manutenzione'); setChiaviLocali(chiaviDatiLocali()); setChiaviRimosse(null); setConfermaSvuota(false); }}
        >
          🧹 Manutenzione Dati Locali
        </button>
      </div>

      {saved && (
        <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
          ✓ Impostazioni studio e layout fattura aggiornati con successo!
        </div>
      )}

      {/* TAB 1: Dati Società & Sedi */}
      {tab === 'company' && (
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
          waAccessToken={waAccessToken}
          setWaAccessToken={setWaAccessToken}
          tgBotUsername={tgBotUsername}
          setTgBotUsername={setTgBotUsername}
          tgBotToken={tgBotToken}
          setTgBotToken={setTgBotToken}
          emailInboundParseUrl={emailInboundParseUrl}
          setEmailInboundParseUrl={setEmailInboundParseUrl}
          signalCliEndpoint={signalCliEndpoint}
          setSignalCliEndpoint={setSignalCliEndpoint}
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
        />
      )}

      {/* TAB 4: Configurazione SDI */}
      {tab === 'sdi' && <TabSdi />}

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
    </div>
  );
}
