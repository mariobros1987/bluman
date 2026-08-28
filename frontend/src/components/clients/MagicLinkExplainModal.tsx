import { useState } from 'react';
import { generaMagicLinkApi } from '../../api/client';
import type { Cliente } from '../../types';

export function MagicLinkExplainModal({ client, onClose }: { client: Cliente; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [generando, setGenerando] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Il link non esiste finché il server non lo ha emesso. Prima questa riga era
  // `client_${client.id.substring(0, 8)}`, costruita qui nel browser: un token che nessuno
  // aveva registrato e che quindi non era verificabile da nessuna parte.
  const [risultato, setRisultato] = useState<{ magicUrl: string; sent: boolean; erroreInvio?: string; scadenza: string } | null>(null);
  const magicUrl = risultato?.magicUrl ?? '';

  const genera = async () => {
    setErrore(null);
    setGenerando(true);
    try {
      const res = await generaMagicLinkApi(client.id, email.trim());
      setRisultato({ magicUrl: res.magicUrl, sent: res.sent, erroreInvio: res.erroreInvio, scadenza: res.scadenza });
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Errore generazione Magic Link');
    } finally {
      setGenerando(false);
    }
  };

  const copyToClipboard = () => {
    if (!magicUrl) return;
    navigator.clipboard.writeText(magicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Accesso Cliente Passwordless & Accettazione</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {client.nome} ({client.tipo === 'company' ? 'Società' : 'Persona Fisica'})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'var(--card2)', border: 'none', width: 26, height: 26, borderRadius: 6, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ background: '#1a1f3d', border: '1px solid #2d3260', borderRadius: 10, padding: 14, fontSize: 11.5, color: '#818cf8', lineHeight: 1.5 }}>
          ℹ️ <strong>Come avviene l'accettazione del cliente (§15, §23):</strong>
          <ul style={{ paddingLeft: 18, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Il cliente <strong>non usa password</strong>: accede tramite un <strong>Magic Link sicuro</strong> univoco.</li>
            <li>Aprendo il link, il cliente visualizza l'<strong>Engagement Letter</strong> con il dettaglio dei moduli scelti.</li>
            <li>Apposta la firma (o conferma OTP), il backend esegue l'<strong>istanziazione automatica atomica</strong> del progetto (passando lo stato a <em>in_progress</em>).</li>
          </ul>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email del cliente a cui inviare il link *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="cliente@esempio.it"
              disabled={generando}
              style={{ fontSize: 11.5 }}
            />
            <button
              onClick={genera}
              disabled={generando || !email.trim()}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: generando || !email.trim() ? 'not-allowed' : 'pointer', opacity: generando || !email.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >
              {generando ? 'Generazione...' : 'Genera e invia'}
            </button>
          </div>
        </div>

        {errore && (
          <div style={{ background: '#3d1a1f', border: '1px solid #602d32', borderRadius: 10, padding: 12, fontSize: 11.5, color: '#f87171' }}>
            ⚠️ {errore}
          </div>
        )}

        {risultato && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
              Link di accesso cliente generato{risultato.sent ? ' e inviato per email' : ' (invio email non riuscito: consegnalo a mano)'} — valido fino al{' '}
              {new Date(risultato.scadenza).toLocaleDateString('it-IT')}:
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={magicUrl} readOnly style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--indigo-l)' }} />
              <button
                onClick={copyToClipboard}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {copied ? '✓ Copiato!' : 'Copia Link'}
              </button>
            </div>
            {/* Il token in chiaro esiste solo in questa risposta e nell'email: in tabella c'è
                il suo SHA-256, quindi riaprendo il modale non si recupera più. */}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>
              Copialo ora se serve: il link non è più recuperabile dopo la chiusura di questa finestra.
            </div>
            {/* Il motivo dell'invio mancato, non solo il fatto: «non riuscito» manda a
                controllare impostazioni che possono essere già corrette, mentre il testo del
                server dice se è la porta bloccata o la password rifiutata. */}
            {!risultato.sent && risultato.erroreInvio && (
              <div style={{ background: '#3d1a1f', border: '1px solid #602d32', borderRadius: 10, padding: 10, fontSize: 10.5, color: '#f87171', marginTop: 8 }}>
                Motivo tecnico dell'invio mancato: {risultato.erroreInvio}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
