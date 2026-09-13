import React, { useState, useEffect } from 'react';
import { statoTotpApi, attivaTotpApi, confermaTotpApi, disabilitaTotpApi, dimenticaIpFidatiApi } from '../../api/auth';

type FaseAttivazioneTotp = 'idle' | 'qr' | 'backup_codes' | 'conferma';

interface TabSicurezzaProps {
  /** Solo il super_admin vede questa tab */
  ruolo?: string;
}

export function TabSicurezza({ ruolo }: TabSicurezzaProps) {
  const [totpAbilitato, setTotpAbilitato] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [successo, setSuccesso] = useState<string | null>(null);

  // IP Fidati (ricorda postazione)
  const [ipFidatiCount, setIpFidatiCount] = useState<number>(0);
  const [ipCorrenteFidato, setIpCorrenteFidato] = useState<boolean>(false);
  const [resettandoIp, setResettandoIp] = useState(false);

  // Flusso attivazione 2FA
  const [faseAttivazione, setFaseAttivazione] = useState<FaseAttivazioneTotp>('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [segretoManuale, setSegretoManuale] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codiceConferma, setCodiceConferma] = useState('');
  const [confermandoTotp, setConfermandoTotp] = useState(false);
  const [backupCopiati, setBackupCopiati] = useState(false);
  const [mostraSegreto, setMostraSegreto] = useState(false);

  // Flusso disabilitazione 2FA
  const [modalDisabilita, setModalDisabilita] = useState(false);
  const [passwordDisabilita, setPasswordDisabilita] = useState('');
  const [disabilitando, setDisabilitando] = useState(false);

  const isSuperAdmin = ruolo === 'super_admin';

  // Carica stato TOTP all'apertura della tab
  useEffect(() => {
    if (!isSuperAdmin) { setLoading(false); return; }
    statoTotpApi()
      .then(r => {
        setTotpAbilitato(r.totpAbilitato);
        setIpFidatiCount(r.ipFidatiCount || 0);
        setIpCorrenteFidato(Boolean(r.ipCorrenteFidato));
      })
      .catch(() => setTotpAbilitato(false))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  const avviaAttivazione2Fa = async () => {
    setErrore(null);
    setSuccesso(null);
    try {
      const res = await attivaTotpApi();
      setQrUrl(res.qrUrl);
      setSegretoManuale(res.segreto);
      setBackupCodes(res.backupCodes);
      setCodiceConferma('');
      setFaseAttivazione('qr');
    } catch (err: any) {
      setErrore(err.message || 'Errore durante la generazione del codice QR');
    }
  };

  const confermaAttivazione = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setConfermandoTotp(true);
    try {
      await confermaTotpApi(codiceConferma.trim());
      setFaseAttivazione('backup_codes');
    } catch (err: any) {
      setErrore(err.message || 'Codice non valido. Riprova.');
    } finally {
      setConfermandoTotp(false);
    }
  };

  const completaAttivazione = () => {
    setTotpAbilitato(true);
    setFaseAttivazione('idle');
    setQrUrl('');
    setSegretoManuale('');
    setBackupCodes([]);
    setCodiceConferma('');
    setBackupCopiati(false);
    setSuccesso('✅ Autenticazione a due fattori attivata con successo!');
    setTimeout(() => setSuccesso(null), 5000);
  };

  const avviaDisabilitazione = () => {
    setModalDisabilita(true);
    setPasswordDisabilita('');
    setErrore(null);
  };

  const confermaDsabilitazione = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setDisabilitando(true);
    try {
      await disabilitaTotpApi(passwordDisabilita);
      setTotpAbilitato(false);
      setModalDisabilita(false);
      setPasswordDisabilita('');
      setSuccesso('🔓 Autenticazione a due fattori disabilitata.');
      setTimeout(() => setSuccesso(null), 5000);
    } catch (err: any) {
      setErrore(err.message || 'Errore durante la disabilitazione del 2FA');
    } finally {
      setDisabilitando(false);
    }
  };

  const dimenticaIp = async () => {
    setResettandoIp(true);
    setErrore(null);
    try {
      await dimenticaIpFidatiApi();
      setIpFidatiCount(0);
      setIpCorrenteFidato(false);
      setSuccesso('Tutte le postazioni fidate sono state rimosse. Al prossimo accesso verrà richiesto il codice 2FA.');
      setTimeout(() => setSuccesso(null), 5000);
    } catch (err: any) {
      setErrore(err.message || 'Errore durante il reset delle postazioni fidate');
    } finally {
      setResettandoIp(false);
    }
  };

  const copiaBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setBackupCopiati(true);
    setTimeout(() => setBackupCopiati(false), 3000);
  };

  // ── Stili condivisi ──────────────────────────────────────────────
  const sCard: React.CSSProperties = {
    background: 'var(--sidebar)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  };
  const sBadgeActive: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(52,211,153,.12)',
    border: '1px solid rgba(52,211,153,.3)',
    color: '#34d399',
    borderRadius: 8,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 700,
  };
  const sBadgeInactive: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(156,163,175,.08)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    borderRadius: 8,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 700,
  };

  if (!isSuperAdmin) {
    return (
      <div style={sCard}>
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
          <div style={{ fontSize: 14 }}>Le impostazioni di sicurezza avanzate sono riservate al Super Admin.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Messaggi di esito */}
      {errore && (
        <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
          ⚠️ {errore}
        </div>
      )}
      {successo && (
        <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
          {successo}
        </div>
      )}

      {/* ── Card 2FA TOTP ─────────────────────────────────────────── */}
      <div style={sCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>📱</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Autenticazione a Due Fattori (2FA)</span>
              {loading ? null : totpAbilitato
                ? <span style={sBadgeActive}>● Attiva</span>
                : <span style={sBadgeInactive}>○ Non attiva</span>
              }
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, maxWidth: 540, lineHeight: 1.6 }}>
              Aggiunge un secondo livello di sicurezza all'accesso del Super Admin. Pienamente compatibile con <strong style={{ color: 'var(--text)' }}>Password di Apple (Portachiavi iCloud)</strong>, Google Authenticator, 1Password, Bitwarden e app compatibili RFC 6238.
            </p>
          </div>

          {/* Bottone principale */}
          {!loading && faseAttivazione === 'idle' && (
            totpAbilitato ? (
              <button
                onClick={avviaDisabilitazione}
                style={{ background: '#7f1d1d', border: '1px solid #b91c1c', color: '#fca5a5', padding: '9px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                🔓 Disabilita 2FA
              </button>
            ) : (
              <button
                onClick={avviaAttivazione2Fa}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,.4)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                🔐 Abilita 2FA
              </button>
            )
          )}
        </div>

        {/* ── Flusso Attivazione Step 1: QR Code ── */}
        {faseAttivazione === 'qr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                📷 Passo 1 di 2 — Scansiona il codice QR con la tua app authenticator o Password di Apple
              </div>

              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* QR Code */}
                <div style={{ background: '#fff', borderRadius: 10, padding: 8, flexShrink: 0 }}>
                  {qrUrl ? (
                    <img src={qrUrl} alt="QR Code 2FA TOTP BluMan" width={160} height={160} style={{ display: 'block' }} />
                  ) : (
                    <div style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontSize: 28 }}>
                      📱
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 200 }}>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                    Apri la tua app authenticator (su iPhone puoi usare direttamente la <strong style={{ color: 'var(--text)' }}>Fotocamera</strong> o <strong style={{ color: 'var(--text)' }}>Password di Apple / Portachiavi iCloud</strong>, oppure Google Authenticator / 1Password) e scansiona il codice QR.
                  </p>

                  {/* Inserimento manuale */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setMostraSegreto(!mostraSegreto)}
                      style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      {mostraSegreto ? '🙈 Nascondi chiave segreta' : '🔑 Non riesci a scansionare? Inserisci a mano'}
                    </button>
                    {mostraSegreto && (
                      <div style={{ marginTop: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Chiave segreta (inserimento manuale):</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: 2, wordBreak: 'break-all' }}>
                          {segretoManuale}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                          Account: BluMan · Tipo: TOTP · Periodo: 30s · Cifre: 6
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Inserisci codice di conferma */}
            <form onSubmit={confermaAttivazione} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                🔢 Passo 2 di 2 — Inserisci il codice a 6 cifre dall'app per confermare
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <input
                    type="text"
                    value={codiceConferma}
                    onChange={e => setCodiceConferma(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    autoComplete="one-time-code"
                    style={{
                      width: '100%',
                      fontSize: 24,
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      letterSpacing: 8,
                      textAlign: 'center',
                      padding: '12px 0',
                      background: 'var(--bg)',
                      border: '2px solid var(--indigo)',
                      borderRadius: 10,
                      color: 'var(--text)',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={confermandoTotp || codiceConferma.length < 6}
                  style={{
                    background: 'var(--indigo)', color: '#fff', border: 'none', padding: '12px 20px', borderRadius: 9,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (confermandoTotp || codiceConferma.length < 6) ? 0.6 : 1,
                  }}
                >
                  {confermandoTotp ? 'Verifica...' : '✅ Conferma'}
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={() => { setFaseAttivazione('idle'); setErrore(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', alignSelf: 'flex-start' }}
            >
              ← Annulla
            </button>
          </div>
        )}

        {/* ── Flusso Attivazione Step 2: Backup Codes ── */}
        {faseAttivazione === 'backup_codes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700, color: '#fbbf24' }}>
                ⚠️ Salva questi codici di recupero — non li vedrai più!
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
                Conservali in un posto sicuro (Password di Apple, 1Password, stampa). Ognuno può essere usato una sola volta al posto del codice TOTP in caso di perdita del dispositivo.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
                {backupCodes.map((c, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', letterSpacing: 2, color: 'var(--text)', textAlign: 'center' }}>
                    {c}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={copiaBackupCodes}
                style={{ background: backupCopiati ? 'rgba(52,211,153,.15)' : 'var(--bg)', border: '1px solid var(--border)', color: backupCopiati ? '#34d399' : 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                {backupCopiati ? '✓ Copiati!' : '📋 Copia tutti i codici'}
              </button>
            </div>

            <button
              type="button"
              onClick={completaAttivazione}
              style={{
                background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399',
                padding: '12px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✅ Ho salvato i codici — Completa l'attivazione
            </button>
          </div>
        )}
      </div>

      {/* ── Card Postazioni e IP Fidati (Ricorda Postazione) ── */}
      {totpAbilitato && faseAttivazione === 'idle' && (
        <div style={sCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>🌐</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Postazioni e Reti Fidate (Ricorda IP)</span>
                {ipCorrenteFidato ? (
                  <span style={sBadgeActive}>✓ IP Corrente Riconosciuto</span>
                ) : (
                  <span style={sBadgeInactive}>○ Nuovo IP / Da verificare al login</span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, maxWidth: 540, lineHeight: 1.6 }}>
                Se accedi dallo stesso indirizzo IP, il codice 2FA viene chiesto solo la prima volta. Nei successivi accessi da questa stessa postazione o rete fidata il login è immediato. Se invece ti colleghi da un nuovo IP o rete sconosciuta, il codice 2FA verrà richiesto per proteggere il tuo account.
              </p>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Postazioni/reti registrate: <strong style={{ color: 'var(--text)' }}>{ipFidatiCount}</strong>
              </div>
            </div>

            {ipFidatiCount > 0 && (
              <button
                type="button"
                onClick={dimenticaIp}
                disabled={resettandoIp}
                style={{
                  background: 'rgba(239,68,68,.12)',
                  border: '1px solid rgba(239,68,68,.3)',
                  color: '#f87171',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: resettandoIp ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {resettandoIp ? 'Rimozione...' : '🗑️ Dimentica postazioni fidate'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Card Informazioni Aggiuntive ── */}
      {totpAbilitato && faseAttivazione === 'idle' && (
        <div style={{ ...sCard, background: 'rgba(52,211,153,.04)', border: '1px solid rgba(52,211,153,.15)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, color: '#34d399', marginBottom: 6 }}>🛡️ Dettagli Sicurezza 2FA Attiva</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><strong>Compatibilità Apple Passwords:</strong> Puoi salvare l'account direttamente nel Portachiavi iCloud di iPhone, iPad e Mac per la compilazione automatica con Face ID / Touch ID.</li>
              <li><strong>Ricorda IP:</strong> Chi effettua il login dallo stesso IP autenticato accede direttamente con password senza dover ridigitare il TOTP ad ogni sessione.</li>
              <li><strong>Accessi da nuove reti:</strong> Al cambio di connessione WiFi, rete dati cellulare o nuovo IP, il sistema richiede tempestivamente il codice TOTP a 6 cifre.</li>
              <li><strong>Codici di recupero:</strong> In caso di emergenza o smarrimento del telefono, puoi inserire uno degli 8 codici di backup generati all'attivazione.</li>
              <li><strong>Disabilitazione protetta:</strong> Disattivare il 2FA richiede la verifica della tua password attuale.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Modale Conferma Disabilitazione ── */}
      {modalDisabilita && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10500, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Disabilita 2FA</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0', lineHeight: 1.6 }}>
                Questa operazione rimuove il secondo fattore di sicurezza dal tuo account. Inserisci la tua password corrente per confermare.
              </p>
            </div>

            {errore && (
              <div style={{ background: '#3b1414', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
                ⚠️ {errore}
              </div>
            )}

            <form onSubmit={confermaDsabilitazione} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password corrente *</label>
                <input
                  type="password"
                  value={passwordDisabilita}
                  onChange={e => setPasswordDisabilita(e.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                  style={{ width: '100%', fontSize: 14 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => { setModalDisabilita(false); setPasswordDisabilita(''); setErrore(null); }}
                  style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '10px', borderRadius: 9, fontSize: 13, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={disabilitando || !passwordDisabilita}
                  style={{ flex: 1, background: '#7f1d1d', border: '1px solid #b91c1c', color: '#fca5a5', padding: '10px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (disabilitando || !passwordDisabilita) ? 0.6 : 1 }}
                >
                  {disabilitando ? 'Disabilitazione...' : '🔓 Disabilita 2FA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
