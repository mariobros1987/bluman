import React, { useState, useEffect } from 'react';
import type { Fornitore, FatturaRicevuta } from '../../api/fornitori';
import { registraFatturaPassivaApi, importaFatturaPassivaXmlApi } from '../../api/fornitori';
import { fetchContiBancariApi } from '../../api/client';

interface RegistraFatturaPassivaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (nuovaFattura: FatturaRicevuta) => void;
  fornitori: Fornitore[];
  selectedFornitoreId?: string | null;
}

interface RigaSpesaPassiva {
  id: string;
  descrizione: string;
  categoria: string;
  quantita: number;
  prezzoUnitarioEur: string;
  aliquotaIva: number;
}

export const RegistraFatturaPassivaModal: React.FC<RegistraFatturaPassivaModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  fornitori,
  selectedFornitoreId,
}) => {
  const [modalita, setModalita] = useState<'manuale' | 'xml'>('manuale');

  // Campi Manuale
  const [fornitoreId, setFornitoreId] = useState(selectedFornitoreId || '');
  const [numero, setNumero] = useState('');
  const [data, setData] = useState(new Date().toISOString().split('T')[0]);
  const [esigibilitaIva, setEsigibilitaIva] = useState<'immediata' | 'differita' | 'split'>('immediata');
  
  // Righe di costo
  const [righe, setRighe] = useState<RigaSpesaPassiva[]>([
    {
      id: '1',
      descrizione: 'Acquisto servizi / beni strumentali',
      categoria: 'spese_generali',
      quantita: 1,
      prezzoUnitarioEur: '',
      aliquotaIva: 22,
    },
  ]);

  // Pagamento immediato
  const [giaPagata, setGiaPagata] = useState(false);
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().split('T')[0]);
  const [contoBancarioId, setContoBancarioId] = useState('');
  const [riferimentoTransazione, setRiferimentoTransazione] = useState('');
  const [contiBancari, setContiBancari] = useState<any[]>([]);

  // Campi XML
  const [xmlContent, setXmlContent] = useState('');
  const [fileName, setFileName] = useState('');

  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (selectedFornitoreId) setFornitoreId(selectedFornitoreId);
      fetchContiBancariApi()
        .then((res) => {
          setContiBancari(res || []);
          if (res && res.length > 0 && !contoBancarioId) {
            setContoBancarioId(res[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, selectedFornitoreId]);

  if (!isOpen) return null;

  const fornitoreSelezionato = fornitori.find((f) => f.id === fornitoreId);

  // Calcolo Totali dalle righe
  const calcolaTotaliRighe = () => {
    let totImponibile = 0;
    let totIva = 0;

    righe.forEach((r) => {
      const p = parseFloat(r.prezzoUnitarioEur.replace(',', '.') || '0') || 0;
      const q = r.quantita || 1;
      const imp = p * q;
      const iva = (imp * r.aliquotaIva) / 100;
      totImponibile += imp;
      totIva += iva;
    });

    return {
      imponibileEur: totImponibile,
      ivaEur: totIva,
      totaleEur: totImponibile + totIva,
      imponibileCent: Math.round(totImponibile * 100),
      ivaCent: Math.round(totIva * 100),
      totaleCent: Math.round((totImponibile + totIva) * 100),
    };
  };

  const totali = calcolaTotaliRighe();

  const handleAggiungiRiga = () => {
    setRighe([
      ...righe,
      {
        id: String(Date.now()),
        descrizione: '',
        categoria: 'spese_generali',
        quantita: 1,
        prezzoUnitarioEur: '',
        aliquotaIva: 22,
      },
    ]);
  };

  const handleRimuoviRiga = (id: string) => {
    if (righe.length === 1) return;
    setRighe(righe.filter((r) => r.id !== id));
  };

  const handleUpdateRiga = (id: string, field: keyof RigaSpesaPassiva, value: any) => {
    setRighe(righe.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setXmlContent(content);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrore(null);

    try {
      if (modalita === 'xml') {
        if (!xmlContent.trim()) {
          throw new Error('Seleziona o incolla il file XML della fattura passiva.');
        }
        const res = await importaFatturaPassivaXmlApi({
          xmlContent,
          pagata: giaPagata,
          dataPagamento: giaPagata ? dataPagamento : undefined,
          contoBancarioId: giaPagata && contoBancarioId ? contoBancarioId : undefined,
        });
        onSuccess(res.fattura);
        onClose();
        return;
      }

      // Modalità manuale
      if (!fornitoreId) {
        throw new Error('Seleziona il fornitore emittente.');
      }
      if (!numero.trim()) {
        throw new Error('Il numero fattura del fornitore è obbligatorio.');
      }
      if (totali.imponibileCent <= 0) {
        throw new Error("L'imponibile totale della fattura deve essere maggiore di zero.");
      }

      const res = await registraFatturaPassivaApi({
        fornitoreId,
        numero: numero.trim(),
        data,
        imponibileCentesimi: totali.imponibileCent,
        ivaCentesimi: totali.ivaCent,
        totaleCentesimi: totali.totaleCent,
        esigibilitaIva,
        pagata: giaPagata,
        dataPagamento: giaPagata ? dataPagamento : undefined,
        contoBancarioId: giaPagata && contoBancarioId ? contoBancarioId : undefined,
        riferimentoPagamento: giaPagata && riferimentoTransazione ? riferimentoTransazione.trim() : undefined,
      });

      onSuccess(res);
      onClose();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante la registrazione della fattura.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: '900px', width: '95%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header Modale */}
        <div className="modal-header" style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.6rem' }}>📥</span>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.25rem' }}>
                Registrazione Fattura d'Acquisto / Passiva
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Registrazione costi fornitore, scorporo IVA, detraibilità LIPE e registrazione automatica in Prima Nota
              </p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose} disabled={saving}>
            ✕
          </button>
        </div>

        {/* Modalità Switcher */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-secondary)',
            padding: '8px 24px',
            borderBottom: '1px solid var(--border)',
            gap: '8px',
          }}
        >
          <button
            type="button"
            className={`btn btn-sm ${modalita === 'manuale' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setModalita('manuale')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>✍️</span> Registrazione Manuale Dettagliata
          </button>
          <button
            type="button"
            className={`btn btn-sm ${modalita === 'xml' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setModalita('xml')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>⚡</span> Import Automatico XML FatturaPA 1.2
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
            {errore && (
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid #ef4444',
                  color: '#ef4444',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '0.9rem',
                }}
              >
                ⚠️ {errore}
              </div>
            )}

            {modalita === 'manuale' ? (
              <div>
                {/* Dati Testata */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                      Fornitore Emittente *
                    </label>
                    <select
                      className="input-field"
                      required
                      value={fornitoreId}
                      onChange={(e) => setFornitoreId(e.target.value)}
                      style={{ width: '100%', fontWeight: 600 }}
                    >
                      <option value="">-- Seleziona Fornitore dall'Anagrafica --</option>
                      {fornitori.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.ragioneSociale} {f.partitaIva ? `(P.IVA ${f.partitaIva})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                      Esigibilità IVA
                    </label>
                    <select
                      className="input-field"
                      value={esigibilitaIva}
                      onChange={(e) => setEsigibilitaIva(e.target.value as any)}
                      style={{ width: '100%' }}
                    >
                      <option value="immediata">I - Immediata (Ordinaria)</option>
                      <option value="differita">D - Differita (art. 6 DPR 633)</option>
                      <option value="split">S - Split Payment</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                      Numero Fattura Fornitore *
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      required
                      placeholder="es. FT-2026/998 o 123/A"
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      style={{ width: '100%', fontWeight: 600 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
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

                  {fornitoreSelezionato?.iban && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-muted)' }}>
                        IBAN Fornitore
                      </label>
                      <div style={{ fontSize: '0.85rem', fontFamily: 'monospace', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                        {fornitoreSelezionato.iban}
                      </div>
                    </div>
                  )}
                </div>

                {/* Righe di Dettaglio Spesa */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>
                      📦 Righe di Dettaglio & Categorie di Costo
                    </h4>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleAggiungiRiga}
                      style={{ fontSize: '0.8rem' }}
                    >
                      + Aggiungi Riga Costo
                    </button>
                  </div>

                  <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 10px', width: '35%' }}>Descrizione Bene / Servizio</th>
                          <th style={{ padding: '8px 10px', width: '22%' }}>Categoria Costo</th>
                          <th style={{ padding: '8px 10px', width: '10%' }}>Quantità</th>
                          <th style={{ padding: '8px 10px', width: '15%' }}>Prezzo Unit. (€)</th>
                          <th style={{ padding: '8px 10px', width: '12%' }}>IVA %</th>
                          <th style={{ padding: '8px 10px', width: '6%', textAlign: 'center' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {righe.map((r) => (
                          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                type="text"
                                className="input-field"
                                required
                                placeholder="Descrizione voce spesa..."
                                value={r.descrizione}
                                onChange={(e) => handleUpdateRiga(r.id, 'descrizione', e.target.value)}
                                style={{ width: '100%', fontSize: '0.85rem' }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <select
                                className="input-field"
                                value={r.categoria}
                                onChange={(e) => handleUpdateRiga(r.id, 'categoria', e.target.value)}
                                style={{ width: '100%', fontSize: '0.85rem' }}
                              >
                                <option value="spese_generali">Spese Generali</option>
                                <option value="consulenze_professionali">Consulenze Esterne</option>
                                <option value="software_saas">Software & SaaS</option>
                                <option value="utenze_locazione">Utenze & Affitti</option>
                                <option value="beni_strumentali">Beni Strumentali</option>
                                <option value="tasse_tributi">Imposte & Tasse</option>
                              </select>
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                type="number"
                                step="0.1"
                                min="0.1"
                                className="input-field"
                                value={r.quantita}
                                onChange={(e) => handleUpdateRiga(r.id, 'quantita', parseFloat(e.target.value) || 1)}
                                style={{ width: '100%', fontSize: '0.85rem' }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <input
                                type="text"
                                className="input-field"
                                required
                                placeholder="0.00"
                                value={r.prezzoUnitarioEur}
                                onChange={(e) => handleUpdateRiga(r.id, 'prezzoUnitarioEur', e.target.value)}
                                style={{ width: '100%', fontSize: '0.85rem', fontWeight: 600 }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <select
                                className="input-field"
                                value={r.aliquotaIva}
                                onChange={(e) => handleUpdateRiga(r.id, 'aliquotaIva', parseInt(e.target.value, 10))}
                                style={{ width: '100%', fontSize: '0.85rem' }}
                              >
                                <option value={22}>22%</option>
                                <option value={10}>10%</option>
                                <option value={5}>5%</option>
                                <option value={4}>4%</option>
                                <option value={0}>0% (Esente)</option>
                              </select>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              {righe.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRimuoviRiga(r.id)}
                                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem' }}
                                  title="Elimina riga"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Box Riepilogo Totali */}
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    padding: '16px 20px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    marginBottom: '20px',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '24px',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale Imponibile:</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>€{totali.imponibileEur.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Totale IVA:</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>€{totali.ivaEur.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'right', borderLeft: '1px solid var(--border)', paddingLeft: '20px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Totale Fattura Passiva:</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>
                      €{totali.totaleEur.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Sezione Pagamento & Prima Nota */}
                <div
                  style={{
                    background: 'rgba(59, 130, 246, 0.04)',
                    padding: '16px 20px',
                    borderRadius: '8px',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={giaPagata}
                      onChange={(e) => setGiaPagata(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span>💳 Registra Pagamento Immediato & Scrivi Uscita in Prima Nota</span>
                  </label>

                  {giaPagata && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginTop: '14px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          Data Pagamento *
                        </label>
                        <input
                          type="date"
                          className="input-field"
                          required={giaPagata}
                          value={dataPagamento}
                          onChange={(e) => setDataPagamento(e.target.value)}
                          style={{ width: '100%' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          Conto Bancario Studio *
                        </label>
                        <select
                          className="input-field"
                          value={contoBancarioId}
                          onChange={(e) => setContoBancarioId(e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {contiBancari.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.nomeBanca} ({cb.iban})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                          CRO / Riferimento Transazione
                        </label>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="es. CRO-12345678"
                          value={riferimentoTransazione}
                          onChange={(e) => setRiferimentoTransazione(e.target.value)}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Modalità XML SDI */
              <div>
                <div
                  style={{
                    border: '2px dashed var(--border)',
                    borderRadius: '12px',
                    padding: '30px 20px',
                    textAlign: 'center',
                    background: 'var(--bg-secondary)',
                    marginBottom: '20px',
                  }}
                >
                  <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '8px' }}>📄</span>
                  <h4 style={{ margin: '0 0 6px 0', fontWeight: 700 }}>Carica File XML Fattura Elettronica</h4>
                  <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Formati supportati: FatturaPA 1.2 (.xml standard o .xml.p7m firmato CAdES)
                  </p>

                  <input
                    type="file"
                    accept=".xml,.p7m"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                    id="xml-file-input"
                  />
                  <label htmlFor="xml-file-input" className="btn btn-primary" style={{ cursor: 'pointer' }}>
                    📁 Seleziona File dal Computer
                  </label>

                  {fileName && (
                    <div style={{ marginTop: '12px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary)' }}>
                      ✓ File caricato: {fileName}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                    Oppure Incolla il Testo XML Grezzo della Fattura:
                  </label>
                  <textarea
                    className="input-field"
                    rows={8}
                    placeholder="<?xml version='1.0' encoding='UTF-8'?> <p:FatturaElettronica..."
                    value={xmlContent}
                    onChange={(e) => setXmlContent(e.target.value)}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.4 }}
                  />
                </div>
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
              {saving ? 'Registrazione in corso...' : '📥 Conferma Registrazione Fattura Passiva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default RegistraFatturaPassivaModal;
