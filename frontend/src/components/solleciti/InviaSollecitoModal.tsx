import { useState, useEffect } from 'react';
import type { LivelloSollecito, AnteprimaSollecitoResponse } from '../../api/solleciti';
import { anteprimaSollecitoApi, inviaSollecitoApi } from '../../api/solleciti';

interface InviaSollecitoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (messaggio: string) => void;
  scadenzaId: string | null;
  numeroFattura: string;
  clienteNome: string;
}

export function InviaSollecitoModal({
  isOpen,
  onClose,
  onSuccess,
  scadenzaId,
  numeroFattura,
  clienteNome,
}: InviaSollecitoModalProps) {
  const [livello, setLivello] = useState<LivelloSollecito>('1_avviso_bonario');
  const [canale, setCanale] = useState<'email' | 'whatsapp' | 'entrambi'>('email');
  const [emailDestinatario, setEmailDestinatario] = useState('');
  const [telefonoDestinatario, setTelefonoDestinatario] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [testo, setTesto] = useState('');
  const [anteprima, setAnteprima] = useState<AnteprimaSollecitoResponse | null>(null);

  const [loadingAnteprima, setLoadingAnteprima] = useState(false);
  const [loadingInvio, setLoadingInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const caricaAnteprima = async (liv: LivelloSollecito) => {
    if (!scadenzaId) return;
    setLoadingAnteprima(true);
    setErrore(null);
    try {
      const res = await anteprimaSollecitoApi(scadenzaId, liv);
      setAnteprima(res);
      setEmailDestinatario(res.clienteEmail || '');
      setOggetto(res.sollecito.oggettoEmail);
      setTesto(res.sollecito.corpoTesto);
    } catch (err: any) {
      setErrore(err?.message || 'Errore generazione anteprima sollecito.');
    } finally {
      setLoadingAnteprima(false);
    }
  };

  useEffect(() => {
    if (isOpen && scadenzaId) {
      caricaAnteprima(livello);
    }
  }, [isOpen, scadenzaId, livello]);

  if (!isOpen || !scadenzaId) return null;

  const handleInvia = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((canale === 'email' || canale === 'entrambi') && !emailDestinatario.trim()) {
      setErrore("L'indirizzo email del destinatario è obbligatorio per l'invio via Email.");
      return;
    }
    if ((canale === 'whatsapp' || canale === 'entrambi') && !telefonoDestinatario.trim()) {
      setErrore("Il numero di cellulare con prefisso internazionale è obbligatorio per l'invio via WhatsApp.");
      return;
    }

    setLoadingInvio(true);
    setErrore(null);
    try {
      const res = await inviaSollecitoApi(scadenzaId, {
        livello,
        canale,
        emailDestinatario: emailDestinatario.trim() || undefined,
        telefonoDestinatario: telefonoDestinatario.trim() || undefined,
        oggettoPersonalizzato: oggetto.trim(),
        testoPersonalizzato: testo.trim(),
      });
      onSuccess(res.messaggio);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || "Errore durante l'invio del sollecito.");
    } finally {
      setLoadingInvio(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '750px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
              📩 Invia Sollecito di Pagamento — {numeroFattura}
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Cliente: <b>{clienteNome}</b> · Calcolo mora e spese forfettarie D.Lgs. 231/2002
            </p>
          </div>
          <button type="button" className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleInvia} style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1 }}>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {errore && (
              <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', fontSize: '0.85rem' }}>
                ⚠️ {errore}
              </div>
            )}

            {/* Canale di Invio */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Canale di Trasmissione:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${canale === 'email' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCanale('email')}
                >
                  📧 Solo Email
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${canale === 'whatsapp' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCanale('whatsapp')}
                >
                  💬 Solo WhatsApp
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${canale === 'entrambi' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCanale('entrambi')}
                >
                  🚀 Entrambi (Email + WhatsApp)
                </button>
              </div>
            </div>

            {/* Scelta Livello */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Livello e Tipologia Sollecito:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${livello === '1_avviso_bonario' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLivello('1_avviso_bonario')}
                >
                  🟢 1. Avviso Bonario
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${livello === '2_sollecito_mora' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLivello('2_sollecito_mora')}
                >
                  🟡 2. Sollecito con Mora
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${livello === '3_diffida_legale' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLivello('3_diffida_legale')}
                >
                  🔴 3. Diffida ad Adempiere
                </button>
              </div>
            </div>

            {/* Recapiti Destinatario */}
            <div style={{ display: 'grid', gridTemplateColumns: (canale === 'entrambi') ? '1fr 1fr' : '1fr', gap: '12px' }}>
              {(canale === 'email' || canale === 'entrambi') && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Email Destinatario:
                  </label>
                  <input
                    type="email"
                    value={emailDestinatario}
                    onChange={(e) => setEmailDestinatario(e.target.value)}
                    placeholder="amministrazione@cliente.it"
                  />
                </div>
              )}

              {(canale === 'whatsapp' || canale === 'entrambi') && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Cellulare / WhatsApp (+39...):
                  </label>
                  <input
                    type="tel"
                    value={telefonoDestinatario}
                    onChange={(e) => setTelefonoDestinatario(e.target.value)}
                    placeholder="393351234567"
                  />
                </div>
              )}
            </div>

            {/* Oggetto */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Oggetto / Intestazione:
              </label>
              <input
                type="text"
                value={oggetto}
                onChange={(e) => setOggetto(e.target.value)}
              />
            </div>

            {/* Corpo Testo */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Corpo del Messaggio:
              </label>
              <textarea
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                rows={10}
                style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}
              />
            </div>

            {/* Card Calcolo Mora */}
            {anteprima?.sollecito?.calcoloMora && (
              <div style={{ padding: '12px 16px', background: 'var(--card2)', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600, color: 'var(--indigo-l)', marginBottom: '6px' }}>
                  📊 Dettaglio Conteggio Legale (D.Lgs. 231/2002)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Ritardo:</span>
                    <div><b>{anteprima.sollecito.calcoloMora.giorniRitardo} giorni</b></div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Interessi Mora:</span>
                    <div><b>€ {(anteprima.sollecito.calcoloMora.interessiMoraCent / 100).toFixed(2)}</b></div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Spese Forfettarie:</span>
                    <div><b>€ {(anteprima.sollecito.calcoloMora.speseForfettarieRecuperoCent / 100).toFixed(2)}</b></div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Totale Dovuto:</span>
                    <div style={{ color: '#ef4444', fontWeight: 700 }}>€ {(anteprima.sollecito.calcoloMora.totaleDovutoCent / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 16px', background: 'var(--card)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loadingInvio}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={loadingInvio || loadingAnteprima}>
              {loadingInvio ? 'Invio in corso...' : '⚡ Invia Sollecito Ufficiale'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
