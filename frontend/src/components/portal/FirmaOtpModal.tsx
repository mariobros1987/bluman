import type { CanaleOtp } from '../../api/client';
import type { BersaglioFirma } from './types';

export interface FirmaOtpModalProps {
  otpCanale: CanaleOtp;
  setOtpCanale: (canale: CanaleOtp) => void;
  nomeCanale: Record<CanaleOtp, string>;
  otpLoading: boolean;
  otpTarget: string;
  otpTargetDichiarato: boolean;
  otpValiditaSecondi: number;
  otpCode: string;
  setOtpCode: (valore: string) => void;
  otpError: string | null;
  setOtpError: (errore: string | null) => void;
  loading: boolean;
  otpReinviiRimanenti: number | null;
  otpAttesaReinvio: number;
  inviaCodiceFirma: (opzioni?: { reinvio?: boolean; bersaglio?: BersaglioFirma; canale?: CanaleOtp }) => Promise<boolean>;
  confermaFirmaConOtp: (firmaGrafometricaPng?: string) => Promise<boolean>;
  setPadGrafometricaAperto: (aperto: boolean) => void;
  onClose: () => void;
}

export function FirmaOtpModal({
  otpCanale,
  setOtpCanale,
  nomeCanale,
  otpLoading,
  otpTarget,
  otpTargetDichiarato,
  otpValiditaSecondi,
  otpCode,
  setOtpCode,
  otpError,
  setOtpError,
  loading,
  otpReinviiRimanenti,
  otpAttesaReinvio,
  inviaCodiceFirma,
  confermaFirmaConOtp,
  setPadGrafometricaAperto,
  onClose,
}: FirmaOtpModalProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 20,
    }}>
      <div style={{
        background: 'var(--sidebar)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '28px 24px',
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {/* Header Modale */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1e1b4b', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              🔐
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                Firma Elettronica Semplice (OTP verificata)
              </h3>
              <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                Art. 20 CAD — validità del documento informatico
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Selettore Canale di Recapito OTP (Switch immediato tra Email, WhatsApp e Telegram) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Scegli o cambia il canale di ricezione codice:</span>
            <span style={{ color: '#818cf8', fontWeight: 800 }}>{nomeCanale[otpCanale]}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { id: 'email' as const, label: '✉️ Email' },
              { id: 'whatsapp' as const, label: '📱 WhatsApp' },
              { id: 'telegram' as const, label: '✈️ Telegram' },
            ].map((c) => {
              const isSelected = otpCanale === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={otpLoading}
                  onClick={async () => {
                    setOtpCanale(c.id);
                    setOtpError(null);
                    await inviaCodiceFirma({ canale: c.id, reinvio: true });
                  }}
                  style={{
                    padding: '8px 10px',
                    fontSize: 11.5,
                    fontWeight: isSelected ? 800 : 600,
                    background: isSelected ? 'var(--indigo)' : 'var(--card)',
                    color: isSelected ? '#fff' : 'var(--muted)',
                    border: isSelected ? '1.5px solid #818cf8' : '1px solid var(--border)',
                    borderRadius: 8,
                    cursor: otpLoading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Info Canale — validità e recapito sono quelli che ha detto il backend */}
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            {otpTarget ? (
              <>
                Codice monouso inviato via <strong>{nomeCanale[otpCanale]}</strong>
                {otpValiditaSecondi > 0 ? (
                  <>
                    {' '}· scade fra{' '}
                    <strong>
                      {Math.floor(otpValiditaSecondi / 60)}:{String(otpValiditaSecondi % 60).padStart(2, '0')}
                    </strong>
                  </>
                ) : (
                  <> · <strong style={{ color: '#fbbf24' }}>scaduto</strong>, richiedine uno nuovo</>
                )}
              </>
            ) : (
              <>Il codice non è stato inviato: leggi il motivo qui sotto e riprova o cambia canale.</>
            )}
          </div>
          {otpTarget && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#a5b4fc', gap: 10 }}>
              <span>{otpCanale === 'email' ? '📬 Inviato a:' : otpCanale === 'telegram' ? '✈️ Inviato a:' : '📱 Inviato a:'}</span>
              <span>{otpTarget}</span>
            </div>
          )}
          {otpTargetDichiarato && (
            <div style={{ fontSize: 10.5, color: '#fbbf24', marginTop: 8, lineHeight: 1.4 }}>
              Recapito dichiarato da te in fase di firma, diverso da quello in anagrafica: la circostanza
              viene registrata nel verbale.
            </div>
          )}
        </div>

        {/* Input Codice OTP (Nessun codice pre-compilato, digitazione manuale) */}
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 6 }}>
            Inserisci il Codice a 6 Cifre ricevuto sul tuo dispositivo:
          </label>
          <input
            type="text"
            maxLength={6}
            value={otpCode}
            onChange={(e) => {
              setOtpCode(e.target.value.replace(/\D/g, ''));
              setOtpError(null);
            }}
            placeholder="• • • • • •"
            style={{
              width: '100%',
              textAlign: 'center',
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: 10,
              padding: '12px',
              borderRadius: 10,
              background: 'var(--card)',
              color: 'var(--indigo-l)',
              border: `2px solid ${otpError ? '#ef4444' : 'var(--indigo)'}`,
              outline: 'none',
            }}
          />
          {otpError && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, fontWeight: 600 }}>
              ⚠️ {otpError}
            </div>
          )}
        </div>

        {/* Note Legali SES — dette come stanno */}
        <div style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.45, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
          {/*
            Il testo precedente dichiarava un "indirizzo IP certificato" e un'associazione
            "univoca" del documento al firmatario. Nessuna delle due cose è vera: l'IP è
            quello visto dal server, non certificato da nessuno, e può mancare; il fattore
            verificato è il possesso del recapito, non l'identità della persona. Una nota
            legale che promette più di quanto il sistema fa indebolisce il verbale, non lo
            rafforza — perché è la prima cosa che una contestazione va a leggere.
          */}
          🛡 Firmando dichiari di aver letto il documento. Vengono registrati: il codice monouso
          recapitato al tuo <strong>{nomeCanale[otpCanale].toLowerCase()}</strong>, la data e ora UTC,
          l'impronta SHA-256 del testo che stai leggendo, l'indirizzo IP visto dal server (o
          «non registrato», se la rete non lo espone) e il browser usato. La verifica attesta il
          possesso del recapito registrato nella tua scheda: è una Firma Elettronica Semplice
          con OTP verificata ai sensi dell'art. 20 del CAD, non una firma elettronica qualificata
          o avanzata.
        </div>

        {/* Azioni */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <button
            type="button"
            onClick={() => {
              if (!otpCode || otpCode.length < 6) {
                setOtpError('Inserisci il codice completo a 6 cifre.');
                return;
              }
              // La grafometrica viene raccolta DOPO il codice e allegata al sigillo (§1.11):
              // da sola non prova nulla, dopo l'OTP è un elemento in più nel verbale.
              setOtpError(null);
              setPadGrafometricaAperto(true);
            }}
            disabled={loading || otpCode.length < 6}
            style={{
              background: otpCode.length === 6 ? 'var(--indigo)' : 'var(--card)',
              color: otpCode.length === 6 ? '#fff' : 'var(--muted)',
              border: otpCode.length === 6 ? 'none' : '1px solid var(--border)',
              padding: '14px',
              borderRadius: 12,
              fontSize: 13.5,
              fontWeight: 800,
              cursor: otpCode.length === 6 ? 'pointer' : 'not-allowed',
              boxShadow: otpCode.length === 6 ? '0 4px 16px rgba(99,102,241,.4)' : 'none',
            }}
          >
            {loading ? 'Verifica del codice e apposizione del sigillo…' : '🔒 Prosegui: convalida il codice e firma'}
          </button>

          <button
            type="button"
            onClick={() => confermaFirmaConOtp()}
            disabled={loading || otpCode.length < 6}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 10.5, cursor: otpCode.length === 6 ? 'pointer' : 'not-allowed', textDecoration: 'underline' }}
          >
            Firma senza apporre la firma grafica
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)' }}>
              Non hai ricevuto il codice?
              {otpReinviiRimanenti !== null && (
                <span style={{ marginLeft: 4 }}>
                  ({otpReinviiRimanenti} {otpReinviiRimanenti === 1 ? 'reinvio' : 'reinvii'} disponibili)
                </span>
              )}
            </span>
            <button
              type="button"
              // Il pulsante conosce i due limiti veri (§1.5): 60 secondi fra un reinvio e
              // l'altro, massimo tre. Prima lanciava una `alert('✓ Nuovo codice inviato')`
              // senza guardare l'esito, quindi diceva "inviato" anche su un rifiuto.
              onClick={() => inviaCodiceFirma({ reinvio: true })}
              disabled={otpLoading || otpAttesaReinvio > 0 || otpReinviiRimanenti === 0}
              style={{
                background: 'none',
                border: 'none',
                color: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'var(--muted)' : 'var(--indigo-l)',
                fontWeight: 700,
                cursor: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'not-allowed' : 'pointer',
                textDecoration: otpAttesaReinvio > 0 || otpReinviiRimanenti === 0 ? 'none' : 'underline',
              }}
            >
              {otpLoading
                ? 'Invio…'
                : otpReinviiRimanenti === 0
                  ? 'Reinvii esauriti'
                  : otpAttesaReinvio > 0
                    ? `Reinvia fra ${otpAttesaReinvio}s`
                    : 'Reinvia codice ↻'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
