import React, { useState, useEffect } from 'react';
import { fetchTutteFattureStudioApi, fetchScadenzarioIncassiApi, registraIncassoApi, downloadFatturaXmlApi } from '../api/client';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import styles from './Dashboard.module.css'; // Reusing KPI grid styles

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'fatture' | 'scadenzario'>('fatture');

  // Modal Registrazione Incasso / Prima Nota
  const [selectedScadenza, setSelectedScadenza] = useState<any>(null);
  const [importoIncasso, setImportoIncasso] = useState('');
  const [metodoPagamento, setMetodoPagamento] = useState('bonifico');
  const [riferimentoTransazione, setRiferimentoTransazione] = useState('');
  const [noteOperatore, setNoteOperatore] = useState('');
  const [savingIncasso, setSavingIncasso] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [invData, scadData] = await Promise.all([
      fetchTutteFattureStudioApi(),
      fetchScadenzarioIncassiApi(),
    ]);
    setInvoices(invData || []);
    setScadenze(scadData || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalEmesso = invoices.filter(f => f.tipo_documento === 'fattura').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalIncassato = invoices.filter(f => f.tipo_documento === 'fattura' && f.stato === 'incassata').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalSospeso = invoices.filter(f => f.tipo_documento === 'fattura' && f.stato === 'emessa').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalNoteCredito = invoices.filter(f => f.tipo_documento === 'nota_credito').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);

  const handleSaveIncasso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedScadenza || !importoIncasso) return;
    setSavingIncasso(true);
    const importoCentesimi = Math.round(parseFloat(importoIncasso) * 100);
    const res = await registraIncassoApi(selectedScadenza.id, {
      importoIncassatoCentesimi: importoCentesimi,
      metodoPagamento,
      riferimentoTransazione,
      noteOperatore,
    });
    setSavingIncasso(false);
    if (res) {
      alert('✓ Incasso registrato con successo in Prima Nota!');
      setSelectedScadenza(null);
      loadData();
    }
  };

  const filteredInvoices = invoices.filter(f => {
    if (filterStato !== 'tutte' && f.stato !== filterStato) return false;
    const searchString = `${f.numero} ${f.progetto?.nome} ${f.progetto?.cliente?.nome}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Gestione Fatture & Incassi Studio</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => setActiveTab('fatture')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'fatture' ? 'var(--indigo)' : 'var(--card)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            📋 Registro Fatture & NC
          </button>
          <button
            onClick={() => setActiveTab('scadenzario')}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'scadenzario' ? 'var(--indigo)' : 'var(--card)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            💳 Scadenzario & Prima Nota ({scadenze.filter(s => s.stato !== 'incassato').length})
          </button>
        </div>
      </div>

      <div className={styles.kpiGrid} style={{ marginBottom: '2rem' }}>
        <div className={styles.kpiCard} style={{ background: '#1e3a8a', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>Totale Fatturato Studio</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>💶 {fmt(totalEmesso / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#064e3b', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Effettivo</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>✓ {fmt(totalIncassato / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#78350f', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fcd34d', textTransform: 'uppercase', fontWeight: 600 }}>In Sospeso / Partite Aperte</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#451a03', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fca5a5', textTransform: 'uppercase', fontWeight: 600 }}>Note di Credito Emesse</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>📉 {fmt(totalNoteCredito / 100)}</div>
        </div>
      </div>

      {activeTab === 'fatture' && (
        <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem' }}>
            <input
              type="text"
              placeholder="Cerca per numero, cliente o progetto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1 }}
            />
            <select
              value={filterStato}
              onChange={(e) => setFilterStato(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 200 }}
            >
              <option value="tutte">Tutti gli stati</option>
              <option value="emessa">Da Incassare (Emesse)</option>
              <option value="incassata">Incassate</option>
              <option value="annullata">Annullate</option>
            </select>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento registro fatture...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 8px' }}>Documento</th>
                  <th style={{ padding: '12px 8px' }}>Data</th>
                  <th style={{ padding: '12px 8px' }}>Cliente / Progetto</th>
                  <th style={{ padding: '12px 8px' }}>Importo</th>
                  <th style={{ padding: '12px 8px' }}>Stato</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azioni Export</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                      Nessun documento trovato.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => {
                    const isNote = inv.tipo_documento === 'nota_credito';
                    const importoTotale = (inv.righe?.reduce((a: any, b: any) => a + b.importo, 0) || 0) / 100;
                    
                    return (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                          <div style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: isNote ? '#7f1d1d' : '#1e3a8a', color: 'white', fontSize: 11, marginRight: 8 }}>
                            {isNote ? 'NC' : 'FT'}
                          </div>
                          {inv.numero || `${isNote ? 'NC' : 'FT'}-${inv.numeroProgressivoSerie}`}
                        </td>
                        <td style={{ padding: '16px 8px', color: 'var(--muted)' }}>
                          {inv.data ? new Date(inv.data).toLocaleDateString() : '-'}
                        </td>
                        <td style={{ padding: '16px 8px' }}>
                          <div style={{ fontWeight: 600 }}>{inv.progetto?.cliente?.nome || 'Cliente'}</div>
                          <div style={{ fontSize: 12, color: 'var(--indigo-l)' }}>{inv.progetto?.nome || 'Progetto'}</div>
                        </td>
                        <td style={{ padding: '16px 8px', fontWeight: 700, color: isNote ? '#fca5a5' : '#fff' }}>
                          {isNote ? '-' : ''}💶 {fmt(importoTotale)}
                        </td>
                        <td style={{ padding: '16px 8px' }}>
                          {inv.stato === 'incassata' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>✓ Incassata</span>}
                          {inv.stato === 'emessa' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#78350f', color: '#fcd34d' }}>⏳ Da Incassare</span>}
                          {inv.stato === 'annullata' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#451a03', color: '#fca5a5' }}>✗ Annullata</span>}
                        </td>
                        <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                          <button 
                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', marginRight: 8 }}
                            onClick={async () => {
                              await downloadRealPdf({
                                titolo: `Documento ${inv.numero || 'Bozza'}`,
                                contenuto: `Documento: ${isNote ? 'Nota di Credito' : 'Fattura'} ${inv.numero}\nProgetto: ${inv.progetto?.nome}\nCliente: ${inv.progetto?.cliente?.nome}\nImporto: ${fmt(importoTotale)}\nData: ${inv.data ? new Date(inv.data).toLocaleDateString() : 'Oggi'}`
                              });
                            }}
                          >
                            📄 PDF
                          </button>
                          <button 
                            style={{ background: '#0284c7', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                            onClick={() => downloadFatturaXmlApi(inv.id)}
                          >
                            📥 XML SDI
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'scadenzario' && (
        <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
          <div style={{ marginBottom: '1.5rem', fontSize: 16, fontWeight: 600 }}>
            Scadenzario Incassi & Partite Aperte (Prima Nota Studio)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Rata / Scadenza</th>
                <th style={{ padding: '12px 8px' }}>Fattura</th>
                <th style={{ padding: '12px 8px' }}>Cliente</th>
                <th style={{ padding: '12px 8px' }}>Importo Rata</th>
                <th style={{ padding: '12px 8px' }}>Stato Incasso</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azione Prima Nota</th>
              </tr>
            </thead>
            <tbody>
              {scadenze.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessuna scadenza d'incasso registrata nello scadenzario.
                  </td>
                </tr>
              ) : (
                scadenze.map((scad) => {
                  const importoRata = (scad.importoCentesimi || 0) / 100;
                  return (
                    <tr key={scad.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                        📅 Rata #{scad.numeroRata} - {new Date(scad.dataScadenza).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        {scad.fattura?.numero || 'Fattura'}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        {scad.fattura?.progetto?.cliente?.nome || 'Cliente Studio'}
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 700 }}>
                        💶 {fmt(importoRata)}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        {scad.stato === 'incassato' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>✓ Saldata</span>}
                        {scad.stato === 'parziale' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#1e3a8a', color: '#93c5fd' }}>🔹 Parziale</span>}
                        {scad.stato === 'in_attesa' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#78350f', color: '#fcd34d' }}>⏳ In Attesa</span>}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        {scad.stato !== 'incassato' ? (
                          <button
                            onClick={() => {
                              setSelectedScadenza(scad);
                              setImportoIncasso(((scad.importoCentesimi || 0) / 100).toString());
                            }}
                            style={{ background: 'var(--indigo)', border: 'none', color: 'white', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                          >
                            💰 Registra Incasso
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>✓ Registrato in Prima Nota</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL REGISTRAZIONE INCASSO / PRIMA NOTA */}
      {selectedScadenza && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveIncasso} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 450, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Registra Incasso Prima Nota</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Fattura: {selectedScadenza.fattura?.numero} | Cliente: {selectedScadenza.fattura?.progetto?.cliente?.nome}
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Importo Incassato (€)</label>
              <input
                type="number"
                step="0.01"
                required
                value={importoIncasso}
                onChange={(e) => setImportoIncasso(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Metodo di Pagamento</label>
              <select
                value={metodoPagamento}
                onChange={(e) => setMetodoPagamento(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              >
                <option value="bonifico">Bonifico Bancario</option>
                <option value="carta">Carta di Credito / Pos</option>
                <option value="stripe">Stripe Gateway</option>
                <option value="assegno">Assegno</option>
                <option value="contanti">Contanti</option>
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Riferimento Transazione (CRO / TRN)</label>
              <input
                type="text"
                placeholder="es. CRO 1234567890"
                value={riferimentoTransazione}
                onChange={(e) => setRiferimentoTransazione(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Note Operatore Studio</label>
              <textarea
                value={noteOperatore}
                onChange={(e) => setNoteOperatore(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', height: 60 }}
              />
            </div>

            <div style={{ display: 'flex', justifyRight: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={() => setSelectedScadenza(null)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={savingIncasso}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--indigo)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
              >
                {savingIncasso ? 'Salvataggio...' : '✓ Salva in Prima Nota'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

