import type { ReactNode } from 'react';
import type { InvioComunicazione } from '../hooks/useInvioComunicazione';
import type { CanaliStudio } from '../hooks/useCanaliStudio';
import type { RecapitiCliente } from '../utils/recapitiCliente';
import { useToast } from './ui/ToastProvider';

/**
 * Il compositore di un messaggio del fascicolo: sceglie il canale, allega, invia.
 *
 * È **presentazione sola**. Lo stato e la consegna stanno in `useInvioComunicazione`, che è montato
 * dal chiamante: così questo componente si può mettere in due posti — la chat del fascicolo e la
 * scheda di una micro-voce — senza che esistano due implementazioni dell'invio. Il giorno in cui la
 * consegna cambia (una ricevuta in più, un canale nuovo), cambia in un posto e vale per entrambi.
 *
 * `microvoceProgettoId` è l'unica differenza fra i due montaggi, e non è cosmetica: con quel campo
 * il messaggio nasce **già abbinato** alla voce, e la riga di testo sotto il selettore lo dice
 * all'operatore, perché la conseguenza non è visibile da qui.
 */
export function ComposerComunicazione({
  invio,
  contatto,
  studioChannels,
  microvoceProgettoId,
  feedback,
  azioniExtra,
  avvisi,
}: {
  invio: InvioComunicazione;
  contatto: RecapitiCliente;
  studioChannels: CanaliStudio;
  /** Presente quando si scrive da dentro una micro-voce: il messaggio nasce abbinato a quella. */
  microvoceProgettoId?: string;
  /**
   * Il riscontro da mostrare. È del **chiamante**, non dell'hook: chi monta il compositore ha già un
   * riscontro suo — la posta in arrivo, un abbinamento — e due stati separati accenderebbero due
   * riquadri insieme.
   */
  feedback: { tipo: 'ok' | 'err'; testo: string } | null;
  /** Comandi che appartengono a chi monta il compositore (nella chat: il test WhatsApp). */
  azioniExtra?: ReactNode;
  /** Avvisi del chiamante, sopra il riscontro dell'invio (nella chat: la casella IMAP muta). */
  avvisi?: ReactNode;
}) {
  const toast = useToast();
  const { canale, setCanale, testo, setTesto, fileAllegato, setFileAllegato, fileInputRef, customDestEmail, setCustomDestEmail, inviando, caricandoFile, invia } = invio;

  const dettaglioCanale = () => {
    switch (canale) {
      case 'whatsapp':
        return { val: contatto.whatsapp, color: 'var(--pill-green-fg)', bg: 'var(--pill-green-bg)' };
      case 'email':
        return { val: contatto.email, color: 'var(--indigo-l)', bg: 'var(--pill-indigo-bg)' };
      case 'telegram':
        return { val: contatto.telegram, color: 'var(--cat-societario)', bg: 'var(--pill-sky-bd)' };
      case 'signal':
        return { val: contatto.signal, color: 'var(--pill-indigo-fg)', bg: 'var(--pill-indigo-bg)' };
      default:
        return { val: contatto.referente || 'portal', color: 'var(--indigo)', bg: 'var(--surface-1)' };
    }
  };
  const channelDetail = dettaglioCanale();

  return (
    <form onSubmit={invia} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📤 {microvoceProgettoId ? 'Rispondi su questa micro-voce' : 'Rispondi al Cliente dal Progetto'}</span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Linea / Canale Studio (Admin):</label>
            <select
              value={canale}
              onChange={e => setCanale(e.target.value as any)}
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
            >
              <option value="whatsapp">🟢 WhatsApp Business Studio ({studioChannels.whatsapp})</option>
              <option value="email">✉️ Email Ufficiale Studio ({studioChannels.email})</option>
              <option value="telegram">✈️ Telegram Bot Studio ({studioChannels.telegram})</option>
              <option value="signal">🔒 Signal Studio Cifrato ({studioChannels.signal})</option>
              <option value="portal">🌐 Portale Riservato Studio ({studioChannels.portal})</option>
            </select>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: channelDetail.bg,
            border: `1px solid ${channelDetail.color}40`,
            padding: '4px 12px',
            borderRadius: 8,
            fontSize: 11,
            color: channelDetail.color,
          }}>
            <span style={{ fontWeight: 800 }}>🎯 Destinatario Cliente:</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{channelDetail.val}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>({contatto.referente})</span>
            <span style={{
              background: 'rgba(255,255,255,0.15)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
            }}>
              ✓ Anagrafica ERP
            </span>
          </div>

          {canale === 'email' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>📧 Destinatario:</span>
              <input
                type="email"
                value={customDestEmail || contatto.email}
                onChange={e => setCustomDestEmail(e.target.value)}
                placeholder="destinatario@email.com"
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  minWidth: 240,
                  fontWeight: 600,
                }}
              />
            </div>
          )}

          {azioniExtra}
        </div>
      </div>

      {avvisi}

      {feedback && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          background: feedback.tipo === 'ok' ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
          color: feedback.tipo === 'ok' ? 'var(--green)' : 'var(--pill-red-fg)',
          border: `1px solid ${feedback.tipo === 'ok' ? 'var(--green)' : 'var(--red)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>{feedback.testo}</span>
        </div>
      )}

      {/* Il cliente vede **una conversazione sola** — il suo portale, la sua chat Telegram, il suo
          numero WhatsApp. L'etichetta della voce è una lente dell'operatore, non un canale: va detto
          qui, o chi scrive crederà di aver aperto un filo dedicato e si stupirà di non trovarlo. */}
      {microvoceProgettoId && (
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Il cliente vede una conversazione sola: il messaggio gli arriva sul canale scelto come tutti
          gli altri, e resta nel fascicolo <strong>abbinato a questa voce</strong>.
        </div>
      )}

      {fileAllegato && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: 'var(--pill-indigo-fg)', width: 'fit-content' }}>
          <span>📎 {fileAllegato.nome}</span>
          <span style={{ fontSize: 9.5, opacity: 0.8 }}>({fileAllegato.sizeStr})</span>
          <button
            type="button"
            onClick={() => {
              setFileAllegato(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
            style={{ background: 'transparent', border: 'none', color: 'var(--pill-red-fg)', cursor: 'pointer', fontWeight: 700, padding: '0 4px', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          value={testo}
          onChange={e => setTesto(e.target.value)}
          disabled={inviando || caricandoFile}
          placeholder={`Scrivi un messaggio per ${contatto.referente} da inviare via ${canale.toUpperCase()} (${channelDetail.val})...`}
          rows={2}
          style={{ flex: 1, fontSize: 12.5, borderRadius: 10, padding: 10, resize: 'none' }}
        />

        {/* Il campo file è nascosto: si apre dal tasto 📎, che è l'unica parte visibile. */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
              toast.attenzione('Il file selezionato supera il limite di 15 MB.');
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              setFileAllegato({
                nome: file.name,
                base64: reader.result as string,
                sizeStr: `${(file.size / 1024).toFixed(0)} KB`,
                mime: file.type || 'application/octet-stream',
              });
            };
            reader.readAsDataURL(file);
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Allega un documento o file"
          style={{
            background: 'var(--card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '8px 12px',
            borderRadius: 10,
            fontSize: 14,
            cursor: 'pointer',
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          📎
        </button>

        <button
          type="submit"
          disabled={inviando || caricandoFile || (!testo.trim() && !fileAllegato)}
          style={{
            background: inviando || caricandoFile ? 'var(--indigo-d)' : 'var(--indigo)',
            color: '#fff',
            border: 'none',
            padding: '0 24px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            height: 44,
            cursor: inviando || caricandoFile ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 14px rgba(99,102,241,.3)',
            opacity: inviando || caricandoFile || (!testo.trim() && !fileAllegato) ? 0.7 : 1,
          }}
        >
          {inviando || caricandoFile ? 'Invio in corso...' : 'Invia Ora →'}
        </button>
      </div>
    </form>
  );
}
