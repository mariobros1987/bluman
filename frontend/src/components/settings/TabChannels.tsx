import React, { useState } from 'react';
import styles from '../../pages/Settings.module.css';
import { PannelloRecordDns } from './PannelloRecordDns';

interface TabChannelsProps {
  handleSaveCompany: (e?: React.FormEvent) => void;
  handleTestSmtp: () => void;
  testingSmtp: boolean;
  smtpTestResult: string | null;
  smtpHost: string;
  setSmtpHost: (v: string) => void;
  /**
   * Nome che il certificato del server deve attestare, quando è diverso dall'host.
   *
   * Serve al caso misurato sulla casella dello studio: il nome coperto dal certificato non ha
   * record DNS, e l'indirizzo che risolve ne attesta un altro. Vuoto — il caso normale — si
   * verifica contro l'host. Non è un modo per disattivare la verifica: il certificato viene
   * comunque validato, cambia solo il nome con cui viene confrontato.
   */
  smtpServername: string;
  setSmtpServername: (v: string) => void;
  smtpPort: string;
  setSmtpPort: (v: string) => void;
  smtpUser: string;
  setSmtpUser: (v: string) => void;
  smtpPass: string;
  setSmtpPass: (v: string) => void;
  smtpFromEmail: string;
  setSmtpFromEmail: (v: string) => void;
  smtpFromName: string;
  setSmtpFromName: (v: string) => void;
  smtpReplyTo: string;
  setSmtpReplyTo: (v: string) => void;
  smtpBcc: string;
  setSmtpBcc: (v: string) => void;
  smtpSecure: boolean;
  setSmtpSecure: (v: boolean) => void;
  handleTestImap: () => void;
  testingImap: boolean;
  imapTestResult: string | null;
  imapProtocol: 'imap' | 'pop3';
  setImapProtocol: (v: 'imap' | 'pop3') => void;
  imapHost: string;
  setImapHost: (v: string) => void;
  /** Come `smtpServername`, per il server di posta in entrata. */
  imapServername: string;
  setImapServername: (v: string) => void;
  imapPort: string;
  setImapPort: (v: string) => void;
  imapFolder: string;
  setImapFolder: (v: string) => void;
  imapUser: string;
  setImapUser: (v: string) => void;
  imapPass: string;
  setImapPass: (v: string) => void;
  imapPollInterval: string;
  setImapPollInterval: (v: string) => void;
  imapSecure: boolean;
  setImapSecure: (v: boolean) => void;
  emailSignatureHtml: string;
  setEmailSignatureHtml: (v: string) => void;
  handleTestChannel: (channel: 'whatsapp' | 'telegram' | 'signal') => void;
  testingChannel: string | null;
  channelTestResult: Record<string, string>;
  waPhoneId: string;
  setWaPhoneId: (v: string) => void;
  waVerifyToken: string;
  setWaVerifyToken: (v: string) => void;
  waAccessToken: string;
  setWaAccessToken: (v: string) => void;
  /** App Meta **dello studio**: App ID (riferimento nella dashboard) e App Secret (firma HMAC). */
  waAppId: string;
  setWaAppId: (v: string) => void;
  waAppSecret: string;
  setWaAppSecret: (v: string) => void;
  /** Template di autenticazione approvato nell'app dello studio, con la lingua approvata. */
  waOtpTemplate: string;
  setWaOtpTemplate: (v: string) => void;
  waOtpTemplateLang: string;
  setWaOtpTemplateLang: (v: string) => void;
  /** Callback URL calcolata dal server dallo slug dello studio. `null` finché non ne ha uno. */
  waCallbackUrl: string | null;
  onRigeneraSlug: () => void;
  rigenerandoSlug: boolean;
  tgBotUsername: string;
  setTgBotUsername: (v: string) => void;
  tgBotToken: string;
  setTgBotToken: (v: string) => void;
  /**
   * Signal: indirizzo del demone `signal-cli-rest-api` **dello studio**, token del proxy che lo
   * espone e numero registrato sopra. Prima c'era un solo campo (`signalCliEndpoint`) che si
   * salvava e nessuna riga di codice leggeva: il pulsante di prova rispondeva «daemon in ascolto»
   * senza aver contattato nessuno.
   */
  signalEndpoint: string;
  setSignalEndpoint: (v: string) => void;
  signalToken: string;
  setSignalToken: (v: string) => void;
  signalNumber: string;
  setSignalNumber: (v: string) => void;
  /**
   * §35 — l'API non restituisce più i valori delle credenziali (regola 6): restituisce
   * `<chiave>Impostata: boolean`. I campi password quindi arrivano vuoti anche quando la
   * credenziale è salvata, e questi flag servono a dirlo all'operatore invece di lasciargli
   * credere che la configurazione sia sparita. Campo lasciato vuoto = credenziale invariata.
   */
  segretiImpostati?: {
    smtpPass?: boolean;
    imapPass?: boolean;
    waAccessToken?: boolean;
    waVerifyToken?: boolean;
    waAppSecret?: boolean;
    tgBotToken?: boolean;
    signalToken?: boolean;
  };
}

/** Testo sotto un campo credenziale: dice se ce n'è già una salvata sul server. */
function NotaSegreto({ impostata }: { impostata?: boolean }) {
  return (
    <div style={{ fontSize: 10, color: impostata ? '#34d399' : 'var(--muted)', marginTop: 3 }}>
      {impostata
        ? '✓ Già salvata sul server. Lascia vuoto per non modificarla.'
        : 'Nessuna credenziale salvata: il canale non può funzionare finché non la inserisci.'}
    </div>
  );
}

// TAB 3: Configurazione Canali Omnichannel (WhatsApp, Telegram, Email, Signal)
export function TabChannels({
  handleSaveCompany,
  handleTestSmtp,
  testingSmtp,
  smtpTestResult,
  smtpHost,
  setSmtpHost,
  smtpServername,
  setSmtpServername,
  smtpPort,
  setSmtpPort,
  smtpUser,
  setSmtpUser,
  smtpPass,
  setSmtpPass,
  smtpFromEmail,
  setSmtpFromEmail,
  smtpFromName,
  setSmtpFromName,
  smtpReplyTo,
  setSmtpReplyTo,
  smtpBcc,
  setSmtpBcc,
  smtpSecure,
  setSmtpSecure,
  handleTestImap,
  testingImap,
  imapTestResult,
  imapProtocol,
  setImapProtocol,
  imapHost,
  setImapHost,
  imapServername,
  setImapServername,
  imapPort,
  setImapPort,
  imapFolder,
  setImapFolder,
  imapUser,
  setImapUser,
  imapPass,
  setImapPass,
  imapPollInterval,
  setImapPollInterval,
  imapSecure,
  setImapSecure,
  emailSignatureHtml,
  setEmailSignatureHtml,
  handleTestChannel,
  testingChannel,
  channelTestResult,
  waPhoneId,
  setWaPhoneId,
  waVerifyToken,
  setWaVerifyToken,
  waAccessToken,
  setWaAccessToken,
  waAppId,
  setWaAppId,
  waAppSecret,
  setWaAppSecret,
  waOtpTemplate,
  setWaOtpTemplate,
  waOtpTemplateLang,
  setWaOtpTemplateLang,
  waCallbackUrl,
  onRigeneraSlug,
  rigenerandoSlug,
  tgBotUsername,
  setTgBotUsername,
  tgBotToken,
  setTgBotToken,
  signalEndpoint,
  setSignalEndpoint,
  signalToken,
  setSignalToken,
  signalNumber,
  setSignalNumber,
  segretiImpostati,
}: TabChannelsProps) {
  const segreti = segretiImpostati || {};
  const [copiatoCallback, setCopiatoCallback] = useState(false);

  const copiaCallback = async () => {
    if (!waCallbackUrl) return;
    try {
      await navigator.clipboard.writeText(waCallbackUrl);
      setCopiatoCallback(true);
      setTimeout(() => setCopiatoCallback(false), 2000);
    } catch {
      // L'API degli appunti non è disponibile (contesto non sicuro, permesso negato): il campo
      // resta selezionabile a mano. Non si finge che la copia sia riuscita.
      setCopiatoCallback(false);
    }
  };

  // La dashboard Meta dove si incolla la Callback URL. Costruita dall'App ID dello studio: è
  // l'unico uso dell'App ID, che non entra in nessuna chiamata.
  const consoleMeta = waAppId
    ? `https://developers.facebook.com/apps/${encodeURIComponent(waAppId)}/whatsapp-business/wa-dev-console/`
    : 'https://developers.facebook.com/apps/';
  return (
        <form onSubmit={handleSaveCompany} className={styles.sectionBox}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💬 Integratore Canali Omnichannel & Credenziali Webhook</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Inserisci i token ed i parametri di connessione per la sincronizzazione automatica delle conversazioni sui Progetti dei Clienti.
          </div>

          {/* BOX GUIDA INTERATTIVA PASSO-PASSO */}
          <div style={{ background: '#1a1f3d', border: '1px solid #2d3260', borderRadius: 12, padding: 16, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📖 Guida Passo-Passo: Come Funziona l'Associazione Automatica ai Progetti</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.6 }}>
              <strong>1. Associazione per Numero di Telefono (WhatsApp / Signal):</strong><br />
              Quando il cliente invia un messaggio o un file da cellulare (es. <code>+39 335 1234567</code>), BluMan cerca il numero nell'anagrafica <strong>Clienti ERP</strong> ed associa la chat al Progetto in corso. Per Signal il numero va indicato fra i referenti del cliente, in forma internazionale.<br /><br />
              <strong>2. Associazione per Indirizzo Email (Email Inbound):</strong><br />
              Le email ricevute nella casella configurata qui sopra vengono collegate al progetto del mittente. Includendo il codice dell'incarico nell'oggetto si forza l'assegnazione a uno specifico progetto.<br /><br />
              <strong>3. Associazione Telegram:</strong><br />
              Avviene tramite l'<strong>identificativo numerico della chat</strong> (es. <code>123456789</code>), quello che il bot riceve quando il cliente gli scrive: Telegram accetta uno <code>@nomeutente</code> solo per i canali pubblici, e su un cliente non funziona. Si legge da <code>getUpdates</code> dopo che il cliente ha scritto al bot: <strong>non</strong> è l'identificativo che risponde <code>getMe</code>, che è quello del bot, e usarlo dà «the bot can't send messages to the bot».<br /><br />
              <strong>4. Canale interno dell'app (Portale Riservato):</strong><br />
              Non passa da nessun servizio esterno e non ha credenziali: il messaggio resta nella piattaforma e il cliente lo legge nel suo portale, se ha un accesso attivo.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
            {/* 📧 SERVER EMAIL SMTP TRANSAZIONALE & NOTIFICHE */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📧 Server Email SMTP Transazionale & Notifiche Studio</span>
                <button
                  type="button"
                  onClick={handleTestSmtp}
                  disabled={testingSmtp}
                  style={{ background: '#3730a3', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {testingSmtp ? 'Testing SMTP...' : '🧪 Test Connessione SMTP'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                Configura i parametri del server di posta in uscita per l'invio dei Magic Link di login cliente, notifiche scadenze e preventivi.
              </div>

              {smtpTestResult && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 12,
                  fontWeight: 500,
                  background: (smtpTestResult.includes('✓') || smtpTestResult.includes('successo') || smtpTestResult.includes('CONNESSO')) ? '#0d2d22' : '#2d0d0d',
                  color: (smtpTestResult.includes('✓') || smtpTestResult.includes('successo') || smtpTestResult.includes('CONNESSO')) ? '#34d399' : '#f87171',
                  border: `1px solid ${(smtpTestResult.includes('✓') || smtpTestResult.includes('successo') || smtpTestResult.includes('CONNESSO')) ? '#059669' : '#dc2626'}`
                }}>
                  {smtpTestResult}
                </div>
              )}

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Host Server SMTP *:</label>
                  <input type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="es. smtp.iltuoprovider.it" style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Porta Server SMTP *:</label>
                  <input type="number" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Nome nel certificato (solo se diverso dall'host):</label>
                  <input type="text" value={smtpServername} onChange={e => setSmtpServername(e.target.value)} placeholder="lascia vuoto: si verifica l'host" style={{ fontSize: 12 }} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Da compilare solo se il provider dice che il certificato è intestato a un nome
                    diverso da quello a cui ci si collega. Il certificato resta verificato: cambia
                    il nome con cui viene confrontato, non il fatto che venga controllato.
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Username / Email Autenticazione *:</label>
                  <input type="text" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="comunicazioni@studio.it" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Password SMTP / App Key *:</label>
                  <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.smtpPass} />
                </div>
                <div className={styles.field}>
                  <label>Email Mittente Visibile *:</label>
                  <input type="email" value={smtpFromEmail} onChange={e => setSmtpFromEmail(e.target.value)} placeholder="comunicazioni@iltuostudio.it" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Nome Mittente Visualizzato *:</label>
                  <input type="text" value={smtpFromName} onChange={e => setSmtpFromName(e.target.value)} placeholder="Nome dello Studio, come lo leggono i clienti" style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Indirizzo di Risposta (Reply-To):</label>
                  <input type="email" value={smtpReplyTo} onChange={e => setSmtpReplyTo(e.target.value)} placeholder="comunicazioni@iltuostudio.it" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Copia Conoscenza Nascosta Studio (BCC Archivio):</label>
                  <input type="email" value={smtpBcc} onChange={e => setSmtpBcc(e.target.value)} placeholder="archivio@iltuostudio.it" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                <input type="checkbox" id="smtpSecure" checked={smtpSecure} onChange={e => setSmtpSecure(e.target.checked)} style={{ width: 14, height: 14 }} />
                <label htmlFor="smtpSecure" style={{ cursor: 'pointer' }}>Usa Connessione Crittografata SSL/TLS (Porta 465 - Consigliata)</label>
              </div>
            </div>

            {/* 📥 SERVER EMAIL IMAP / POP3 (POSTA IN ENTRATA & INGESTION FASCICOLI) */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📥 Server Email IMAP / POP3 (Posta in Entrata & Ingestion Fascicoli)</span>
                <button
                  type="button"
                  onClick={handleTestImap}
                  disabled={testingImap}
                  style={{ background: '#0369a1', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {testingImap ? 'Testing IMAP...' : '🧪 Test Connessione IMAP'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                {/* La casella è quella configurata qui sotto, non una scritta nel codice: prima
                    questa riga nominava la casella di un solo studio, e ogni altro studio leggeva
                    che BluMan legge la posta di qualcun altro. */}
                Configura i parametri di ricezione per consentire a BluMan di leggere le email che i clienti
                scrivono {imapUser.trim() ? <>alla casella <code>{imapUser.trim()}</code></> : <>alla casella dello studio</>} ed
                associarle in tempo reale ai rispettivi progetti.
              </div>

              {imapTestResult && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  marginBottom: 12,
                  fontWeight: 500,
                  background: (imapTestResult.includes('✓') || imapTestResult.includes('successo') || imapTestResult.includes('CONNESSO') || imapTestResult.includes('verificata')) ? '#0d2d22' : '#2d0d0d',
                  color: (imapTestResult.includes('✓') || imapTestResult.includes('successo') || imapTestResult.includes('CONNESSO') || imapTestResult.includes('verificata')) ? '#34d399' : '#f87171',
                  border: `1px solid ${(imapTestResult.includes('✓') || imapTestResult.includes('successo') || imapTestResult.includes('CONNESSO') || imapTestResult.includes('verificata')) ? '#059669' : '#dc2626'}`
                }}>
                  {imapTestResult}
                </div>
              )}

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Protocollo Ricezione:</label>
                  <select value={imapProtocol} onChange={e => setImapProtocol(e.target.value as any)} style={{ fontSize: 12, padding: '7px 10px' }}>
                    <option value="imap">IMAP4 (Sincronizzazione Bidirezionale Multi-Device - Consigliato)</option>
                    <option value="pop3">POP3 (Download Singolo Posta)</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Host Server Posta in Entrata *:</label>
                  <input type="text" value={imapHost} onChange={e => setImapHost(e.target.value)} placeholder="es. imap.iltuoprovider.it" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Porta Server Ricezione *:</label>
                  <input type="number" value={imapPort} onChange={e => setImapPort(e.target.value)} placeholder="993" style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Nome nel certificato (solo se diverso dall'host):</label>
                  <input type="text" value={imapServername} onChange={e => setImapServername(e.target.value)} placeholder="lascia vuoto: si verifica l'host" style={{ fontSize: 12 }} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Serve quando il test risponde «il nome dell'host non è tra quelli del
                    certificato» e il nome corretto non è raggiungibile: qui si dichiara il nome che
                    il certificato attesta, lasciando nell'host l'indirizzo a cui collegarsi.
                  </div>
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Cartella Remota da Monitorare:</label>
                  <input type="text" value={imapFolder} onChange={e => setImapFolder(e.target.value)} placeholder="INBOX" style={{ fontSize: 12 }} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Username / Email Posta in Entrata *:</label>
                  <input type="text" value={imapUser} onChange={e => setImapUser(e.target.value)} placeholder="posta@iltuostudio.it" style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Password Casella Posta *:</label>
                  <input type="password" value={imapPass} onChange={e => setImapPass(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.imapPass} />
                </div>
              </div>

              <div className={styles.grid2} style={{ marginTop: 10 }}>
                <div className={styles.field}>
                  <label>Frequenza Polling Sincronizzazione:</label>
                  <select value={imapPollInterval} onChange={e => setImapPollInterval(e.target.value)} style={{ fontSize: 12, padding: '7px 10px' }}>
                    <option value="2m">⚡ Ogni 2 Minuti (Live Ingestion)</option>
                    <option value="5m">⏱ Ogni 5 Minuti (Standard)</option>
                    <option value="15m">⏳ Ogni 15 Minuti</option>
                    <option value="manual">✋ Solo Manuale</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)', paddingTop: 20 }}>
                  <input type="checkbox" id="imapSecure" checked={imapSecure} onChange={e => setImapSecure(e.target.checked)} style={{ width: 14, height: 14 }} />
                  <label htmlFor="imapSecure" style={{ cursor: 'pointer' }}>Usa Connessione Crittografata SSL/TLS (Porta 993 - Consigliata)</label>
                </div>
              </div>
            </div>

            {/* 🖋️ FIRMA AUTOMATICA & DISCLAIMER PRIVACY EMAIL STUDIO */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🖋️ Firma Automatica & Disclaimer Privacy GDPR Studio</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                Questa firma e clausola legale verranno allegate automaticamente in calce a tutte le email inviate da BluMan ai clienti.
              </div>
              <div className={styles.field}>
                <label>Modello Firma & Disclaimer (Supporta tag: &#123;&#123;nome_operatore&#125;&#125;, &#123;&#123;ruolo_operatore&#125;&#125;, &#123;&#123;sito_web&#125;&#125;):</label>
                <textarea
                  value={emailSignatureHtml}
                  onChange={e => setEmailSignatureHtml(e.target.value)}
                  rows={4}
                  style={{ width: '100%', fontSize: 11.5, fontFamily: 'monospace', padding: 10, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                />
              </div>
            </div>

            {/* 🛡️ RECORD DNS DEL DOMINIO (SPF, DKIM, DMARC, MX) — vedi PannelloRecordDns.tsx */}
            <PannelloRecordDns smtpFromEmail={smtpFromEmail} imapUser={imapUser} smtpHost={smtpHost} />

            {/* 🟢 WHATSAPP BUSINESS API */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🟢 WhatsApp Business API (Meta Cloud Official Integration)</span>
                <button
                  type="button"
                  onClick={() => handleTestChannel('whatsapp')}
                  disabled={testingChannel === 'whatsapp'}
                  style={{ background: '#065f46', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {testingChannel === 'whatsapp' ? 'Testing...' : '🧪 Test WhatsApp API'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                In uscita: codici di firma, credenziali del portale e messaggi ai clienti. In ingresso: i messaggi
                che i clienti scrivono al numero dello studio. Le due metà si configurano con la <strong>tua app Meta</strong>:
                le credenziali qui sotto sono dello studio, non condivise con altri studi.
              </div>

              {channelTestResult['whatsapp'] && (
                <div style={{ padding: 10, borderRadius: 8, fontSize: 11.5, marginBottom: 12, background: '#0d2d22', color: '#34d399', border: '1px solid #059669' }}>
                  {channelTestResult['whatsapp']}
                </div>
              )}

              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', margin: '4px 0 8px' }}>
                Metà in uscita — invio dei messaggi
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>WhatsApp Phone Number ID (Meta *):</label>
                  <input type="text" value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Meta System User Access Token (Permanent *):</label>
                  <input type="password" value={waAccessToken} onChange={e => setWaAccessToken(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.waAccessToken} />
                </div>
                <div className={styles.field}>
                  <label>Template OTP approvato (opzionale):</label>
                  <input type="text" value={waOtpTemplate} onChange={e => setWaOtpTemplate(e.target.value)} placeholder="es. codice_accesso" style={{ fontSize: 12 }} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Senza template il codice parte come testo libero, che WhatsApp consegna solo se il cliente
                    ha scritto allo studio nelle ultime 24 ore. Il template va approvato <strong>nella tua app</strong>.
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Lingua del template:</label>
                  <input type="text" value={waOtpTemplateLang} onChange={e => setWaOtpTemplateLang(e.target.value)} placeholder="it" style={{ fontSize: 12 }} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Il codice della lingua con cui il template è stato approvato (es. <code>it</code>, <code>it_IT</code>, <code>en_US</code>).
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', margin: '16px 0 8px' }}>
                Metà in ingresso — messaggi dai clienti
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Meta App ID:</label>
                  <input type="text" value={waAppId} onChange={e => setWaAppId(e.target.value)} placeholder="es. 1234567890123456" style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Meta App Secret *:</label>
                  <input type="password" value={waAppSecret} onChange={e => setWaAppSecret(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.waAppSecret} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    È la chiave con cui il server verifica che i messaggi arrivino davvero da Meta. Senza, i messaggi
                    in ingresso vengono rifiutati.
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Webhook Verify Token (handshake Meta):</label>
                  <input type="password" value={waVerifyToken} onChange={e => setWaVerifyToken(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.waVerifyToken} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    La stringa che scegli tu e incolli anche in Meta. È il controllo che Meta fa quando salvi la
                    Callback URL: se le due stringhe non coincidono, Meta non attiva il webhook.
                  </div>
                </div>
              </div>

              <div className={styles.field} style={{ marginTop: 12 }}>
                <label>Callback URL da incollare in Meta (sola lettura):</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    readOnly
                    value={waCallbackUrl || 'Verrà generata al primo salvataggio di questa scheda'}
                    onFocus={e => e.target.select()}
                    style={{ fontSize: 12, flex: '1 1 320px', fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={copiaCallback}
                    disabled={!waCallbackUrl}
                    style={{ background: waCallbackUrl ? '#065f46' : '#334155', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: waCallbackUrl ? 'pointer' : 'not-allowed' }}
                  >
                    {copiatoCallback ? '✓ Copiata' : '📋 Copia'}
                  </button>
                  <button
                    type="button"
                    onClick={onRigeneraSlug}
                    disabled={rigenerandoSlug}
                    style={{ background: '#7c2d12', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {rigenerandoSlug ? 'Rigenerazione…' : '🔄 Rigenera'}
                  </button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                  Contiene un codice casuale che identifica il tuo studio: non condividerlo. Per attivare l'ingresso,
                  in Meta incolla questo indirizzo in <strong>Callback URL</strong> e il Verify Token qui sopra, poi
                  sottoscrivi il campo <code>messages</code>.{' '}
                  <a href={consoleMeta} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>
                    Apri la configurazione WhatsApp della tua app Meta →
                  </a>
                </div>
                <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
                  ⚠️ «Rigenera» cambia l'indirizzo: i messaggi smettono di arrivare finché non aggiorni la Callback URL in Meta.
                </div>
              </div>
            </div>

            {/* ✈️ TELEGRAM BOT API */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>✈️ Telegram Bot API (100% GRATUITO)</span>
                <button
                  type="button"
                  onClick={() => handleTestChannel('telegram')}
                  disabled={testingChannel === 'telegram'}
                  style={{ background: '#075985', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {testingChannel === 'telegram' ? 'Testing...' : '🧪 Test Telegram Bot'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                Crea un bot con @BotFather ed incolla il Token per ricevere messaggi ed allegati dai clienti.
              </div>

              {channelTestResult['telegram'] && (
                <div style={{ padding: 10, borderRadius: 8, fontSize: 11.5, marginBottom: 12, background: '#0c2a3a', color: '#38bdf8', border: '1px solid #0284c7' }}>
                  {channelTestResult['telegram']}
                </div>
              )}

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Bot Username Telegram *:</label>
                  <input type="text" value={tgBotUsername} onChange={e => setTgBotUsername(e.target.value)} style={{ fontSize: 12 }} />
                </div>
                <div className={styles.field}>
                  <label>Bot Access Token (@BotFather *):</label>
                  <input type="password" value={tgBotToken} onChange={e => setTgBotToken(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.tgBotToken} />
                </div>
              </div>
            </div>

            {/* 🔒 SIGNAL — IL DEMONE È DELLO STUDIO */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>🔒 Signal (demone dello studio)</span>
                <button
                  type="button"
                  onClick={() => handleTestChannel('signal')}
                  disabled={testingChannel === 'signal'}
                  style={{ background: '#312e81', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  {testingChannel === 'signal' ? 'Testing...' : '🧪 Test Signal'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                Signal non ha un servizio centrale da chiamare con un token: serve un demone
                <code> signal-cli-rest-api</code> <strong>tuo</strong>, con un numero registrato sopra,
                raggiungibile in https. I messaggi dei clienti si leggono dal demone quando apri il
                fascicolo o premi «Sincronizza» — non c'è nessun indirizzo da registrare presso Signal.
              </div>

              {channelTestResult['signal'] && (
                <div style={{ padding: 10, borderRadius: 8, fontSize: 11.5, marginBottom: 12, background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca' }}>
                  {channelTestResult['signal']}
                </div>
              )}

              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Indirizzo del demone Signal *:</label>
                  <input
                    type="text"
                    value={signalEndpoint}
                    onChange={e => setSignalEndpoint(e.target.value)}
                    placeholder="es. https://signal.iltuostudio.it"
                    style={{ fontSize: 12 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Deve essere in <code>https</code>: da qui passano il token e i messaggi dei clienti.
                    Indirizzi interni o di rete privata vengono rifiutati.
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Numero Signal dello studio *:</label>
                  <input
                    type="text"
                    value={signalNumber}
                    onChange={e => setSignalNumber(e.target.value)}
                    placeholder="es. +393351234567"
                    style={{ fontSize: 12 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    È il mittente, e deve essere <strong>registrato sul tuo demone</strong>. Serve il
                    prefisso internazionale: senza, <code>3351234567</code> diventerebbe un numero
                    francese e il messaggio partirebbe verso un estraneo.
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Token del demone (se il proxy lo richiede):</label>
                  <input type="password" value={signalToken} onChange={e => setSignalToken(e.target.value)} placeholder="••••••••••••" style={{ fontSize: 12 }} autoComplete="new-password" />
                  <NotaSegreto impostata={segreti.signalToken} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                    Viaggia nell'intestazione <code>Authorization</code>, mai nell'indirizzo.
                  </div>
                </div>
              </div>
            </div>

            {/* 🌐 CANALE INTERNO DELL'APP (Portale Riservato) */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🌐 Canale interno dell'app (Portale Riservato)</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#34d399', background: '#0d2d22', border: '1px solid #059669', borderRadius: 20, padding: '2px 8px' }}>
                  sempre attivo
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                È il canale della piattaforma: l'operatore scrive dal fascicolo e il cliente legge nel
                suo Portale Riservato, senza che nulla esca verso un servizio esterno. <strong>Non ha
                credenziali da configurare</strong> — niente token, niente server da ospitare — ed è per
                questo che è l'unico che non può essere spento da un campo vuoto.
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Perché funzioni serve una cosa sola, che non si configura qui: il cliente deve avere un{' '}
                <strong>accesso al portale</strong> (email e password, o un Magic Link). Se non ce l'ha, il
                messaggio resta nel fascicolo ma non lo legge nessuno. Le credenziali del portale si
                creano dalla scheda del cliente.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" className={styles.saveBtn}>
              💾 Salva Credenziali Canali
            </button>
          </div>
        </form>
  );
}
