import React, { useState, useEffect } from 'react';
import type { Fornitore } from '../../api/fornitori';
import { creaFornitoreApi, aggiornaFornitoreApi } from '../../api/fornitori';

interface NuovoFornitoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (fornitore: Fornitore) => void;
  fornitoreDaModificare?: Fornitore | null;
}

export const NuovoFornitoreModal: React.FC<NuovoFornitoreModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  fornitoreDaModificare,
}) => {
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [partitaIva, setPartitaIva] = useState('');
  const [codiceFiscale, setCodiceFiscale] = useState('');
  const [email, setEmail] = useState('');
  const [pec, setPec] = useState('');
  const [sdiCode, setSdiCode] = useState('');
  const [indirizzo, setIndirizzo] = useState('');
  const [citta, setCitta] = useState('');
  const [cap, setCap] = useState('');
  const [nazione, setNazione] = useState('IT');
  const [iban, setIban] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (fornitoreDaModificare) {
      setRagioneSociale(fornitoreDaModificare.ragioneSociale || '');
      setPartitaIva(fornitoreDaModificare.partitaIva || '');
      setCodiceFiscale(fornitoreDaModificare.codiceFiscale || '');
      setEmail(fornitoreDaModificare.email || '');
      setPec(fornitoreDaModificare.pec || '');
      setSdiCode(fornitoreDaModificare.sdiCode || '');
      setIndirizzo(fornitoreDaModificare.indirizzo || '');
      setCitta(fornitoreDaModificare.citta || '');
      setCap(fornitoreDaModificare.cap || '');
      setNazione(fornitoreDaModificare.nazione || 'IT');
      setIban(fornitoreDaModificare.iban || '');
      setNote(fornitoreDaModificare.note || '');
    } else {
      setRagioneSociale('');
      setPartitaIva('');
      setCodiceFiscale('');
      setEmail('');
      setPec('');
      setSdiCode('');
      setIndirizzo('');
      setCitta('');
      setCap('');
      setNazione('IT');
      setIban('');
      setNote('');
    }
    setErrore(null);
  }, [fornitoreDaModificare, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragioneSociale.trim()) {
      setErrore('La ragione sociale è obbligatoria.');
      return;
    }

    setLoading(true);
    setErrore(null);
    try {
      const dati = {
        ragioneSociale: ragioneSociale.trim(),
        partitaIva: partitaIva.trim() || null,
        codiceFiscale: codiceFiscale.trim() || null,
        email: email.trim() || null,
        pec: pec.trim() || null,
        sdiCode: sdiCode.trim() || null,
        indirizzo: indirizzo.trim() || null,
        citta: citta.trim() || null,
        cap: cap.trim() || null,
        nazione: nazione.trim() || 'IT',
        iban: iban.trim() || null,
        note: note.trim() || null,
      };

      let result: Fornitore;
      if (fornitoreDaModificare) {
        result = await aggiornaFornitoreApi(fornitoreDaModificare.id, dati);
      } else {
        result = await creaFornitoreApi(dati);
      }
      onSuccess(result);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante il salvataggio del fornitore.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '640px', width: '90%' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>🏢</span>
            <h3 style={{ margin: 0, fontWeight: 700 }}>
              {fornitoreDaModificare ? 'Modifica Fornitore' : 'Nuovo Fornitore ERP'}
            </h3>
          </div>
          <button className="btn-close" onClick={onClose} disabled={loading}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Ragione Sociale / Denominazione *
              </label>
              <input
                type="text"
                className="input-field"
                required
                value={ragioneSociale}
                onChange={(e) => setRagioneSociale(e.target.value)}
                placeholder="es. AWS EMEA SARL, Notaio Mario Rossi..."
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Partita IVA
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={partitaIva}
                  onChange={(e) => setPartitaIva(e.target.value)}
                  placeholder="es. 12345678901"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Codice Fiscale
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={codiceFiscale}
                  onChange={(e) => setCodiceFiscale(e.target.value)}
                  placeholder="es. RSSMRA80A01H501Z"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Email Amministrazione
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="fatture@fornitore.com"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  PEC
                </label>
                <input
                  type="email"
                  className="input-field"
                  value={pec}
                  onChange={(e) => setPec(e.target.value)}
                  placeholder="fornitore@pec.it"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Indirizzo Sede
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={indirizzo}
                  onChange={(e) => setIndirizzo(e.target.value)}
                  placeholder="Via Roma 10"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Città
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={citta}
                  onChange={(e) => setCitta(e.target.value)}
                  placeholder="Milano"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Codice SDI
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={sdiCode}
                  onChange={(e) => setSdiCode(e.target.value)}
                  placeholder="M5UXCR1"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Coordinate Bancarie IBAN
              </label>
              <input
                type="text"
                className="input-field"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="IT60X0542811101000000123456"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '24px',
              borderTop: '1px solid var(--border)',
              paddingTop: '16px',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Salvataggio...' : fornitoreDaModificare ? 'Aggiorna Fornitore' : 'Crea Fornitore'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
