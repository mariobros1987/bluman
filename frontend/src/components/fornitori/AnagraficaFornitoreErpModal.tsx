import React, { useState, useEffect } from 'react';
import type { Fornitore, FatturaRicevuta } from '../../api/fornitori';
import { creaFornitoreApi, aggiornaFornitoreApi, fetchFatturePassiveApi } from '../../api/fornitori';

interface AnagraficaFornitoreErpModalProps {
  fornitore?: Fornitore | null;
  onClose: () => void;
  onSaved: (fornitore: Fornitore) => void;
}

export const AnagraficaFornitoreErpModal: React.FC<AnagraficaFornitoreErpModalProps> = ({
  fornitore,
  onClose,
  onSaved,
}) => {
  const isEditing = !!fornitore?.id;
  const [tab, setTab] = useState<'generale' | 'sede' | 'pagamenti' | 'fatture' | 'note'>('generale');

  // Form State
  const [ragioneSociale, setRagioneSociale] = useState(fornitore?.ragioneSociale || '');
  const [partitaIva, setPartitaIva] = useState(fornitore?.partitaIva || '');
  const [codiceFiscale, setCodiceFiscale] = useState(fornitore?.codiceFiscale || '');
  const [sdiCode, setSdiCode] = useState(fornitore?.sdiCode || '0000000');
  const [pec, setPec] = useState(fornitore?.pec || '');
  const [email, setEmail] = useState(fornitore?.email || '');
  const [indirizzo, setIndirizzo] = useState(fornitore?.indirizzo || '');
  const [cap, setCap] = useState(fornitore?.cap || '');
  const [citta, setCitta] = useState(fornitore?.citta || '');
  const [nazione, setNazione] = useState(fornitore?.nazione || 'IT');
  const [iban, setIban] = useState(fornitore?.iban || '');
  const [note, setNote] = useState(fornitore?.note || '');

  // Storico Fatture del fornitore
  const [fattureFornitore, setFattureFornitore] = useState<FatturaRicevuta[]>([]);
  const [loadingFatture, setLoadingFatture] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (fornitore?.id) {
      setLoadingFatture(true);
      fetchFatturePassiveApi(fornitore.id)
        .then((res) => setFattureFornitore(res || []))
        .catch((err) => console.warn('Errore lettura storico fatture fornitore:', err))
        .finally(() => setLoadingFatture(false));
    }
  }, [fornitore?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragioneSociale.trim()) {
      setErrore('La Ragione Sociale o Denominazione del fornitore è obbligatoria.');
      return;
    }

    setSaving(true);
    setErrore(null);
    try {
      const payload = {
        ragioneSociale: ragioneSociale.trim(),
        partitaIva: partitaIva.trim() || undefined,
        codiceFiscale: codiceFiscale.trim() || undefined,
        sdiCode: sdiCode.trim() || undefined,
        pec: pec.trim() || undefined,
        email: email.trim() || undefined,
        indirizzo: indirizzo.trim() || undefined,
        cap: cap.trim() || undefined,
        citta: citta.trim() || undefined,
        nazione: nazione.trim() || 'IT',
        iban: iban.trim() || undefined,
        note: note.trim() || undefined,
      };

      let saved: Fornitore;
      if (isEditing && fornitore?.id) {
        saved = await aggiornaFornitoreApi(fornitore.id, payload);
      } else {
        saved = await creaFornitoreApi(payload);
      }

      onSaved(saved);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante il salvataggio del fornitore.');
    } finally {
      setSaving(false);
    }
  };

  const totaleAcquistiCent = fattureFornitore.reduce((acc, f) => acc + (f.totaleCentesimi || 0), 0);
  const totalePagatoCent = fattureFornitore
    .filter((f) => f.pagata)
    .reduce((acc, f) => acc + (f.totaleCentesimi || 0), 0);
  const totaleDaSaldareCent = totaleAcquistiCent - totalePagatoCent;

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '840px', width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header Modale */}
        <div className="modal-header" style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.6rem' }}>🏢</span>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.25rem' }}>
                {isEditing ? `Scheda Anagrafica Fornitore — ${fornitore?.ragioneSociale}` : 'Nuova Anagrafica Fornitore ERP'}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Gestione completa dati fiscali, SDI FatturaPA, recapiti operativi e condizioni di pagamento
              </p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose} disabled={saving}>
            ✕
          </button>
        </div>

        {/* Tab Navigation (OpenSTAManager ERP Style) */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            padding: '0 16px',
            gap: '4px',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            className={`btn-tab ${tab === 'generale' ? 'active' : ''}`}
            onClick={() => setTab('generale')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: tab === 'generale' ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === 'generale' ? 700 : 500,
              color: tab === 'generale' ? 'var(--primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📋</span> Dati Fiscali & SDI
          </button>
          <button
            type="button"
            className={`btn-tab ${tab === 'sede' ? 'active' : ''}`}
            onClick={() => setTab('sede')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: tab === 'sede' ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === 'sede' ? 700 : 500,
              color: tab === 'sede' ? 'var(--primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📍</span> Sede & Recapiti
          </button>
          <button
            type="button"
            className={`btn-tab ${tab === 'pagamenti' ? 'active' : ''}`}
            onClick={() => setTab('pagamenti')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: tab === 'pagamenti' ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === 'pagamenti' ? 700 : 500,
              color: tab === 'pagamenti' ? 'var(--primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>💳</span> Pagamenti & IBAN
          </button>
          {isEditing && (
            <button
              type="button"
              className={`btn-tab ${tab === 'fatture' ? 'active' : ''}`}
              onClick={() => setTab('fatture')}
              style={{
                padding: '12px 16px',
                border: 'none',
                background: 'transparent',
                borderBottom: tab === 'fatture' ? '3px solid var(--primary)' : '3px solid transparent',
                fontWeight: tab === 'fatture' ? 700 : 500,
                color: tab === 'fatture' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>📂</span> Fatture Ricevute ({fattureFornitore.length})
            </button>
          )}
          <button
            type="button"
            className={`btn-tab ${tab === 'note' ? 'active' : ''}`}
            onClick={() => setTab('note')}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: tab === 'note' ? '3px solid var(--primary)' : '3px solid transparent',
              fontWeight: tab === 'note' ? 700 : 500,
              color: tab === 'note' ? 'var(--primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📝</span> Note Interne
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
            {errore && (
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--red)',
                  color: 'var(--red)',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '0.9rem',
                }}
              >
                ⚠️ {errore}
              </div>
            )}

            {/* TAB 1: DATI GENERALI & FISCALI */}
            {tab === 'generale' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Ragione Sociale / Denominazione Fornitore *
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    required
                    value={ragioneSociale}
                    onChange={(e) => setRagioneSociale(e.target.value)}
                    placeholder="Es. Forniture Tech S.r.l. o Dott. Mario Rossi"
                    style={{ width: '100%', fontSize: '1rem', fontWeight: 600 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Partita IVA
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={partitaIva}
                    onChange={(e) => setPartitaIva(e.target.value)}
                    placeholder="Es. IT01234567890"
                    style={{ width: '100%', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Codice Fiscale
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={codiceFiscale}
                    onChange={(e) => setCodiceFiscale(e.target.value)}
                    placeholder="Es. RSSMRA80A01H501Z o P.IVA"
                    style={{ width: '100%', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Codice Destinatario SDI (7 caratteri)
                  </label>
                  <input
                    type="text"
                    maxLength={7}
                    className="input-field"
                    value={sdiCode}
                    onChange={(e) => setSdiCode(e.target.value.toUpperCase())}
                    placeholder="0000000 o Codice SDI (es. M5UXCR1)"
                    style={{ width: '100%', fontFamily: 'monospace', fontWeight: 700 }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Usa 0000000 se le fatture vengono inoltrate via PEC o se fornitore estero.
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Indirizzo PEC Fatturazione Elettronica
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

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Nazione Sede Legale
                  </label>
                  <select
                    className="input-field"
                    value={nazione}
                    onChange={(e) => setNazione(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="IT">🇮🇹 Italia (IT)</option>
                    <option value="SM">🇸🇲 San Marino (SM)</option>
                    <option value="DE">🇩🇪 Germania (DE)</option>
                    <option value="FR">🇫🇷 Francia (FR)</option>
                    <option value="ES">🇪🇸 Spagna (ES)</option>
                    <option value="CH">🇨🇭 Svizzera (CH)</option>
                    <option value="GB">🇬🇧 Regno Unito (GB)</option>
                    <option value="US">🇺🇸 Stati Uniti (US)</option>
                  </select>
                </div>
              </div>
            )}

            {/* TAB 2: SEDE & RECAPITI */}
            {tab === 'sede' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '18px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Indirizzo e Numero Civico
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={indirizzo}
                    onChange={(e) => setIndirizzo(e.target.value)}
                    placeholder="Es. Via Roma 123, Scala A"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Città
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={citta}
                    onChange={(e) => setCitta(e.target.value)}
                    placeholder="Es. Milano"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    CAP (Codice Avviamento Postale)
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    className="input-field"
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                    placeholder="Es. 20121"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Email Ordinaria di Contatto / Ordini
                  </label>
                  <input
                    type="email"
                    className="input-field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="amministrazione@fornitore.com"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {/* TAB 3: PAGAMENTI & BANCARI */}
            {tab === 'pagamenti' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '18px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    IBAN del Fornitore (per Bonifici in Uscita)
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={iban}
                    onChange={(e) => setIban(e.target.value.toUpperCase().replace(/\s/g, ''))}
                    placeholder="IT00X0000000000000000000000"
                    style={{ width: '100%', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '1px' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    L'IBAN verrà suggerito automaticamente nella registrazione delle fatture e nei pagamenti in Prima Nota.
                  </span>
                </div>
              </div>
            )}

            {/* TAB 4: STORICO FATTURE D'ACQUISTO */}
            {tab === 'fatture' && isEditing && (
              <div>
                {/* KPI Strip Fornitore */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
                  <div className="card" style={{ padding: '14px', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale Acquisti</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px' }}>
                      €{(totaleAcquistiCent / 100).toFixed(2)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '14px', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Fatture Saldate</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--green)', marginTop: '4px' }}>
                      €{(totalePagatoCent / 100).toFixed(2)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '14px', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Da Saldare</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: totaleDaSaldareCent > 0 ? 'var(--red)' : 'var(--green)', marginTop: '4px' }}>
                      €{(totaleDaSaldareCent / 100).toFixed(2)}
                    </div>
                  </div>
                </div>

                {loadingFatture ? (
                  <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    Caricamento fatture del fornitore...
                  </div>
                ) : fattureFornitore.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                    Nessuna fattura d'acquisto registrata per questo fornitore.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 10px' }}>Data</th>
                          <th style={{ padding: '8px 10px' }}>Numero FT</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Imponibile</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>IVA</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Totale</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center' }}>Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fattureFornitore.map((f) => (
                          <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 10px' }}>{new Date(f.data).toLocaleDateString('it-IT')}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700 }}>{f.numero}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>€{(f.imponibileCentesimi / 100).toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>€{(f.ivaCentesimi / 100).toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800 }}>
                              €{(f.totaleCentesimi / 100).toFixed(2)}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {f.pagata ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--green)', fontWeight: 600 }}>
                                  ✓ Saldata
                                </span>
                              ) : (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--red)', fontWeight: 600 }}>
                                  ⏳ Aperta
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: NOTE INTERNE */}
            {tab === 'note' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Note Interne & Accordi Contrattuali
                </label>
                <textarea
                  className="input-field"
                  rows={8}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Accordi quadro, referenti commerciali, condizioni di sconto o note di gestione per lo studio..."
                  style={{ width: '100%', lineHeight: 1.5 }}
                />
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              background: 'var(--bg-secondary)',
            }}
          >
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio...' : isEditing ? '💾 Aggiorna Anagrafica Fornitore' : '✨ Salva Fornitore'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
