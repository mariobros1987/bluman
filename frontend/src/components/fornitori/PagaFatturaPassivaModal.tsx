import React, { useState } from 'react';
import type { FatturaRicevuta } from '../../api/fornitori';
import { pagaFatturaRicevutaApi } from '../../api/fornitori';

interface PagaFatturaPassivaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  fattura: FatturaRicevuta | null;
}

export const PagaFatturaPassivaModal: React.FC<PagaFatturaPassivaModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  fattura,
}) => {
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0]);
  const [metodoPagamento, setMetodoPagamento] = useState<'bonifico' | 'carta' | 'assegno' | 'contanti'>('bonifico');
  const [riferimentoTransazione, setRiferimentoTransazione] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  if (!isOpen || !fattura) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrore(null);
    try {
      await pagaFatturaRicevutaApi(fattura.id, {
        dataPagamento,
        metodoPagamento,
        riferimentoTransazione: riferimentoTransazione.trim() || null,
        note: note.trim() || null,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante la registrazione del pagamento.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '520px', width: '90%' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>💳</span>
            <h3 style={{ margin: 0, fontWeight: 700 }}>Salda Fattura Fornitore</h3>
          </div>
          <button className="btn-close" onClick={onClose} disabled={loading} aria-label="Chiudi la finestra">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
          {errore && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              ⚠️ {errore}
            </div>
          )}

          <div
            style={{
              background: 'var(--bg-secondary)',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Fattura Passiva:</div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>
              n. {fattura.numero} — {fattura.fornitore?.ragioneSociale || 'Fornitore'}
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px' }}>
              Totale da Saldare: €{(fattura.totaleCentesimi / 100).toFixed(2)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Data Pagamento Effettivo *
              </label>
              <input
                type="date"
                className="input-field"
                required
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Metodo di Pagamento
                </label>
                <select
                  className="input-field"
                  value={metodoPagamento}
                  onChange={(e) => setMetodoPagamento(e.target.value as any)}
                  style={{ width: '100%' }}
                >
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">Carta di Credito / Bancomat</option>
                  <option value="assegno">Assegno Bancario</option>
                  <option value="contanti">Cassa Contanti</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Riferimento (CRO/TRN)
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={riferimentoTransazione}
                  onChange={(e) => setRiferimentoTransazione(e.target.value)}
                  placeholder="es. TRN-998822"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Note Pagamento / Prima Nota
              </label>
              <input
                type="text"
                className="input-field"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="es. Pagamento disposto con bonifico su c/c Unicredit"
                style={{ width: '100%' }}
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
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Registrazione...' : 'Conferma Saldo in Prima Nota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
