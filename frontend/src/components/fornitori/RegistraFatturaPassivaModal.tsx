import React, { useState } from 'react';
import type { Fornitore, FatturaRicevuta } from '../../api/fornitori';
import { registraFatturaRicevutaApi, importaXmlFatturaRicevutaApi } from '../../api/fornitori';

interface RegistraFatturaPassivaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (fattura: FatturaRicevuta) => void;
  fornitori: Fornitore[];
  onOpenNuovoFornitore: () => void;
}

export const RegistraFatturaPassivaModal: React.FC<RegistraFatturaPassivaModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  fornitori,
  onOpenNuovoFornitore,
}) => {
  const [tab, setTab] = useState<'manuale' | 'xml'>('manuale');
  const [fornitoreId, setFornitoreId] = useState('');
  const [numero, setNumero] = useState('');
  const [data, setData] = useState(new Date().toISOString().split('T')[0]);
  const [imponibileEur, setImponibileEur] = useState('');
  const [aliquotaIva, setAliquotaIva] = useState(22);
  const [esigibilitaIva, setEsigibilitaIva] = useState<'immediata' | 'differita' | 'split'>('immediata');
  const [pagata, setPagata] = useState(false);
  const [xmlContent, setXmlContent] = useState('');
  const [xmlFileName, setXmlFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  if (!isOpen) return null;

  const imponibileCent = Math.round((parseFloat(imponibileEur || '0') || 0) * 100);
  const ivaCent = Math.round((imponibileCent * aliquotaIva) / 100);
  const totaleCent = imponibileCent + ivaCent;

  const handleXmlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setXmlContent(text || '');
    };
    reader.readAsText(file);
  };

  const handleSalvaManuale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fornitoreId) {
      setErrore('Seleziona un fornitore.');
      return;
    }
    if (!numero.trim()) {
      setErrore('Inserisci il numero di fattura.');
      return;
    }
    if (imponibileCent <= 0) {
      setErrore("L'imponibile deve essere maggiore di zero.");
      return;
    }

    setLoading(true);
    setErrore(null);
    try {
      const res = await registraFatturaRicevutaApi({
        fornitoreId,
        numero: numero.trim(),
        data,
        imponibileCentesimi: imponibileCent,
        ivaCentesimi: ivaCent,
        totaleCentesimi: totaleCent,
        esigibilitaIva,
        pagata,
        dataPagamento: pagata ? new Date().toISOString() : null,
        registraMovimentoPrimaNota: pagata,
      });
      onSuccess(res);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Errore registrazione fattura passiva.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportaXml = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!xmlContent.trim()) {
      setErrore('Seleziona un file XML o incolla il contenuto.');
      return;
    }

    setLoading(true);
    setErrore(null);
    try {
      const res = await importaXmlFatturaRicevutaApi(xmlContent);
      onSuccess(res);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || "Errore durante l'importazione del file XML FatturaPA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '680px', width: '90%' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.4rem' }}>📥</span>
            <h3 style={{ margin: 0, fontWeight: 700 }}>Registra Fattura d'Acquisto (Passiva)</h3>
          </div>
          <button className="btn-close" onClick={onClose} disabled={loading}>
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            padding: '0 16px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab('manuale');
              setErrore(null);
            }}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              fontWeight: tab === 'manuale' ? 700 : 500,
              color: tab === 'manuale' ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: tab === 'manuale' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            ✍️ Inserimento Manuale
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('xml');
              setErrore(null);
            }}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              fontWeight: tab === 'xml' ? 700 : 500,
              color: tab === 'xml' ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: tab === 'xml' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            ⚡ Import XML FatturaPA 1.2
          </button>
        </div>

        <div style={{ padding: '20px 24px' }}>
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

          {tab === 'manuale' ? (
            <form onSubmit={handleSalvaManuale}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Fornitore *</label>
                    <button
                      type="button"
                      onClick={onOpenNuovoFornitore}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}
                    >
                      + Nuovo Fornitore
                    </button>
                  </div>
                  <select
                    className="input-field"
                    required
                    value={fornitoreId}
                    onChange={(e) => setFornitoreId(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">-- Seleziona Fornitore ERP --</option>
                    {fornitori.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.ragioneSociale} {f.partitaIva ? `(P.IVA ${f.partitaIva})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Numero Fattura Fornitore *
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      required
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      placeholder="es. 2026/A-91, FT-1049"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Data Documento *
                    </label>
                    <input
                      type="date"
                      className="input-field"
                      required
                      value={data}
                      onChange={(e) => setData(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Imponibile (€) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="input-field"
                      required
                      value={imponibileEur}
                      onChange={(e) => setImponibileEur(e.target.value)}
                      placeholder="0.00"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Aliquota IVA
                    </label>
                    <select
                      className="input-field"
                      value={aliquotaIva}
                      onChange={(e) => setAliquotaIva(parseInt(e.target.value, 10))}
                      style={{ width: '100%' }}
                    >
                      <option value={22}>22% Ordinaria</option>
                      <option value={10}>10% Ridotta</option>
                      <option value={5}>5% Minima</option>
                      <option value={4}>4% Agricola</option>
                      <option value={0}>0% Esente/Non Imponibile</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                      Esigibilità IVA
                    </label>
                    <select
                      className="input-field"
                      value={esigibilitaIva}
                      onChange={(e) => setEsigibilitaIva(e.target.value as any)}
                      style={{ width: '100%' }}
                    >
                      <option value="immediata">Immediata</option>
                      <option value="differita">Differita</option>
                      <option value="split">Split Payment</option>
                    </select>
                  </div>
                </div>

                {/* Box Totale Calcolato */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Imponibile: €{(imponibileCent / 100).toFixed(2)} + IVA ({aliquotaIva}%): €{(ivaCent / 100).toFixed(2)}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                      Totale Fattura: €{(totaleCent / 100).toFixed(2)}
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={pagata}
                      onChange={(e) => setPagata(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    Già Saldata (Scrivi uscita Prima Nota)
                  </label>
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
                  {loading ? 'Registrazione...' : 'Registra Fattura Passiva'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleImportaXml}>
              <div style={{ textAlign: 'center', padding: '24px 16px', border: '2px dashed var(--border)', borderRadius: '12px', background: 'var(--bg-secondary)' }}>
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '8px' }}>📄</span>
                <h4 style={{ margin: '0 0 6px 0', fontWeight: 700 }}>Carica File XML Fattura Elettronica</h4>
                <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Trascina qui il file .xml o .xml.p7m ricevuto dal fornitore o dall'Agenzia delle Entrate
                </p>

                <input
                  type="file"
                  accept=".xml,.p7m"
                  id="xmlFileInput"
                  onChange={handleXmlFileUpload}
                  style={{ display: 'none' }}
                />
                <label htmlFor="xmlFileInput" className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  📁 Seleziona File XML
                </label>

                {xmlFileName && (
                  <div style={{ marginTop: '12px', fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 600 }}>
                    ✓ File caricato: {xmlFileName}
                  </div>
                )}
              </div>

              <div style={{ marginTop: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Oppure incolla il testo XML:
                </label>
                <textarea
                  className="input-field"
                  rows={6}
                  value={xmlContent}
                  onChange={(e) => setXmlContent(e.target.value)}
                  placeholder="<p:FatturaElettronica ...>...</p:FatturaElettronica>"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
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
                <button type="submit" className="btn btn-primary" disabled={loading || !xmlContent.trim()}>
                  {loading ? 'Analisi & Importazione...' : 'Analizza & Importa Fattura'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
