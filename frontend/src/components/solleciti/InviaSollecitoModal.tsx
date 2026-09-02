import React, { useState, useEffect } from 'react';
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

export const InviaSollecitoModal: React.FC<InviaSollecitoModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  scadenzaId,
  numeroFattura,
  clienteNome,
}) => {
  const [livello, setLivello] = useState<LivelloSollecito>('1_avviso_bonario');
  const [emailDestinatario, setEmailDestinatario] = useState('');
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
    if (!emailDestinatario.trim()) {
      setErrore("L'indirizzo email del destinatario è obbligatorio.");
      return;
    }

    setLoadingInvio(true);
    setErrore(null);
    try {
      const res = await inviaSollecitoApi(scadenzaId, {
        livello,
        emailDestinatario: emailDestinatario.trim(),
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
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '680px', width: '90%' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>📩</span>
            <h3 style={{ margin: 0, fontWeight: 700 }}>
              Invia Sollecito Pagamento — {clienteNome} ({numeroFattura})
            </h3>
          </div>
          <button className="btn-close" onClick={onClose} disabled={loadingInvio}>
            ✕
          </button>
        </div>

        <form onSubmit={handleInvia} style={{ padding: '20px 24px' }}>
          {errore && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid #ef4444',
                color: '#ef4444',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              ⚠️ {errore}
            </div>
          )}

          {/* Livello Selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
              Livello Sollecito & Gravità:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${livello === '1_avviso_bonario' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setLivello('1_avviso_bonario')}
                style={{ padding: '8px 10px', fontSize: '0.8rem' }}
              >
                1️⃣ Avviso Bonario
              </button>
              <button
                type="button"
                className={`btn btn-sm ${livello === '2_sollecito_mora' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setLivello('2_sollecito_mora')}
                style={{ padding: '8px 10px', fontSize: '0.8rem' }}
              >
                2️⃣ Sollecito con Mora
              </button>
              <button
                type="button"
                className={`btn btn-sm ${livello === '3_diffida_legale' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setLivello('3_diffida_legale')}
                style={{ padding: '8px 10px', fontSize: '0.8rem', color: livello === '3_diffida_legale' ? '#fff' : '#ef4444' }}
              >
                3️⃣ Diffida Legale
              </button>
            </div>
          </div>

          {/* Box Dettaglio Mora Calcolata */}
          {anteprima?.sollecito.calcoloMora && (
            <div
              style={{
                background: 'var(--bg-secondary)',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                marginBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Ritardo: <strong>{anteprima.sollecito.calcoloMora.giorniRitardo} giorni</strong> | Capitale: €
                  {(anteprima.sollecito.calcoloMora.importoCapitaleCent / 100).toFixed(2)}
                </div>
                {livello !== '1_avviso_bonario' && (
                  <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600, marginTop: '2px' }}>
                    + Interessi mora (12%): €{(anteprima.sollecito.calcoloMora.interessiMoraCent / 100).toFixed(2)} | Spese recupero: €
                    {(anteprima.sollecito.calcoloMora.speseForfettarieRecuperoCent / 100).toFixed(2)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Totale Richiesto:</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>
                  €{(anteprima.sollecito.calcoloMora.totaleDovutoCent / 100).toFixed(2)}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Email Destinatario *
              </label>
              <input
                type="email"
                className="input-field"
                required
                value={emailDestinatario}
                onChange={(e) => setEmailDestinatario(e.target.value)}
                placeholder="cliente@azienda.com"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Oggetto Email *
              </label>
              <input
                type="text"
                className="input-field"
                required
                value={oggetto}
                onChange={(e) => setOggetto(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Testo Formale del Sollecito *
              </label>
              <textarea
                className="input-field"
                rows={9}
                required
                value={testo}
                onChange={(e) => setTesto(e.target.value)}
                style={{ width: '100%', fontSize: '0.85rem', lineHeight: 1.5 }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '20px',
              borderTop: '1px solid var(--border)',
              paddingTop: '16px',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loadingInvio}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={loadingInvio || loadingAnteprima}>
              {loadingInvio ? 'Invio in corso...' : '✉️ Invia Sollecito al Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
