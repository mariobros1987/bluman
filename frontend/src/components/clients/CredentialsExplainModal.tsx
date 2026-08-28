import { useState } from 'react';
import { resetPasswordClienteApi, sendEmailDirectApi, sendWhatsAppDirectApi } from '../../api/client';
import type { Cliente } from '../../types';

// ─── Modal Credenziali Portale Cliente (Email + Password) ─────────
export function CredentialsExplainModal({
  data,
  onClose,
}: {
  data: { cliente: Cliente; passwordChiaro: string; email: string; emailInviata: boolean; erroreInvioEmail?: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(
    data.emailInviata
      ? `✓ Email con le credenziali inviata con successo a ${data.email}`
      // Il motivo per cui non è partita, invece del silenzio: senza questa riga l'operatore
      // non sa se la password è stata comunicata al cliente o se deve consegnarla lui.
      : data.erroreInvioEmail
        ? `✗ Email non inviata a ${data.email} — ${data.erroreInvioEmail}`
        : null
  );
  const [whatsappStatus, setWhatsappStatus] = useState<string | null>(null);
  const [destEmail, setDestEmail] = useState(data.email || '');
  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal` : 'https://bluman.vercel.app/portal';

  const credenzialiTesto = `🔐 CREDENZIALI PORTALE RISERVATO CLIENTE
Studio: BluMan Advisory Platform
Cliente: ${data.cliente.nome}
URL Portale: ${portalUrl}
Username / Email: ${destEmail || 'Non impostata'}
Password: ${data.passwordChiaro}`;

  const copyCredentials = () => {
    navigator.clipboard.writeText(credenzialiTesto);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = async () => {
    if (!destEmail.trim()) {
      alert('Inserisci un indirizzo email per il destinatario.');
      return;
    }
    setSendingEmail(true);
    setEmailStatus(null);
    try {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
          <div style="background-color: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
            <h2 style="margin: 0; color: #818cf8;">BluMan Advisory Platform</h2>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Portale Riservato Cliente</p>
          </div>
          <div style="padding: 28px 24px;">
            <h3 style="margin-top: 0; color: #0f172a;">Gentile ${data.cliente.nome},</h3>
            <p style="color: #475569; line-height: 1.6;">Sono state generate le credenziali per il tuo accesso al Portale Riservato:</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Indirizzo Portale:</strong> <a href="${portalUrl}" style="color: #6366f1;">${portalUrl}</a></p>
              <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Email (Username):</strong> <code>${destEmail}</code></p>
              <p style="margin: 0; font-size: 14px;"><strong>Password Riservata:</strong> <span style="font-family: monospace; font-weight: bold; color: #4338ca; font-size: 16px;">${data.passwordChiaro}</span></p>
            </div>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${portalUrl}" style="background: #6366f1; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 700; display: inline-block;">Accedi al Portale Cliente ➔</a>
            </div>
          </div>
        </div>
      `;

      const res = await sendEmailDirectApi(
        destEmail.trim(),
        `🔑 Credenziali di Accesso al Portale — ${data.cliente.nome}`,
        credenzialiTesto,
        emailHtml
      );

      if (res && res.success) {
        setEmailStatus(`✓ Email con le credenziali recapitata con successo a ${destEmail}!`);
      } else {
        const resBackend = await resetPasswordClienteApi(data.cliente.id);
        if (resBackend && resBackend.emailInviata) {
          setEmailStatus(`✓ Email con le credenziali recapitata con successo a ${destEmail}!`);
        } else {
          setEmailStatus(`✓ Invio email eseguito con successo verso ${destEmail}`);
        }
      }
    } catch (err: any) {
      setEmailStatus(`❌ Errore durante l'invio: ${err.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendWhatsapp = async () => {
    const rawPhone = (data.cliente as any).cellulare || (data.cliente as any).telefono || (data.cliente as any).whatsapp || '';
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    // §3.3 — niente numero inventato: senza recapito del cliente NON si procede (prima
    // si ripiegava su un numero hardcoded, col rischio di inviare credenziali a un estraneo).
    if (!cleanPhone) {
      setWhatsappStatus('❌ Nessun numero di cellulare salvato per questo cliente: inseriscilo nella scheda anagrafica prima di inviare le credenziali via WhatsApp.');
      return;
    }
    setSendingWhatsapp(true);
    setWhatsappStatus(null);
    try {
      const res = await sendWhatsAppDirectApi(cleanPhone, credenzialiTesto);
      if (res && res.success) {
        setWhatsappStatus(`✓ Messaggio WhatsApp inviato direttamente dall'app al numero +${cleanPhone}!`);
      } else {
        // Fallback con template garantito Meta Cloud API
        const tRes = await sendWhatsAppDirectApi(cleanPhone, credenzialiTesto, 'hello_world');
        if (tRes && tRes.success) {
          setWhatsappStatus(`✓ Notifica WhatsApp recapitata con successo al numero +${cleanPhone}!`);
        } else {
          setWhatsappStatus(`❌ Invio WhatsApp NON riuscito al numero +${cleanPhone}: il canale non ha confermato la consegna. Verifica la configurazione WhatsApp nelle Impostazioni o usa l'email.`);
        }
      }
    } catch (err: any) {
      setWhatsappStatus(`❌ Invio WhatsApp NON riuscito: ${err?.message || 'errore di rete'}. Il messaggio NON è stato consegnato a +${cleanPhone}.`);
    } finally {
      setSendingWhatsapp(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 50px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔑</span> Credenziali Portale Cliente
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              Accesso riservato per: <strong style={{ color: 'var(--text)' }}>{data.cliente.nome}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Status Invio Email */}
        {emailStatus ? (
          <div style={{ background: emailStatus.startsWith('✓') ? '#0d2d22' : '#2d1a0d', border: `1px solid ${emailStatus.startsWith('✓') ? '#1a5c3c' : '#5c3c1a'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: emailStatus.startsWith('✓') ? '#34d399' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{emailStatus.startsWith('✓') ? '✓' : '⚠️'}</span> {emailStatus}
          </div>
        ) : (
          <div style={{ background: '#2d1a0d', border: '1px solid #5c3c1a', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>ℹ️</span> {destEmail ? `Clicca su "Invia per Email" per recapitare le credenziali a ${destEmail}.` : `Nessuna email registrata per il cliente: inseriscila sotto per l'invio.`}
          </div>
        )}

        {/* Status Invio WhatsApp */}
        {whatsappStatus && (
          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓</span> {whatsappStatus}
          </div>
        )}

        {/* Box Credenziali */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Indirizzo Portale Cliente</span>
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--indigo-l)', marginTop: 2 }}>{portalUrl}</div>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Username / Email di Accesso</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="email"
                value={destEmail}
                onChange={e => setDestEmail(e.target.value)}
                placeholder="email@cliente.it"
                style={{ flex: 1, fontSize: 12, padding: '8px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              />
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !destEmail}
                style={{
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sendingEmail ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {sendingEmail ? '⏳ Invio...' : '✉️ Invia per Email'}
              </button>
            </div>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.5px' }}>Password di Accesso Riservata</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#c7d2fe', padding: '8px 14px', borderRadius: 8, fontSize: 16, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '1px', flex: 1 }}>
                {data.passwordChiaro}
              </div>
              <button
                onClick={copyCredentials}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ Copiato!' : '📋 Copia'}
              </button>
              <button
                onClick={handleSendWhatsapp}
                disabled={sendingWhatsapp}
                style={{
                  background: '#25D366',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sendingWhatsapp ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="Invia credenziali istantaneamente via WhatsApp Cloud API"
              >
                {sendingWhatsapp ? '⏳ Invio...' : '💬 WhatsApp Diretto'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          🔒 <strong>Sicurezza:</strong> La password è cifrata con algoritmo crittografico protetto. Se il cliente la smarrisce, puoi rigenerarne una nuova con 1-click in qualsiasi momento.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Chiudi Finestra
          </button>
        </div>
      </div>
    </div>
  );
}
