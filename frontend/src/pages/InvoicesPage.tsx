import React, { useState, useEffect } from 'react';
import { fetchTutteFattureStudioApi } from '../api/client';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import styles from './Dashboard.module.css'; // Reusing KPI grid styles

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchTutteFattureStudioApi().then(data => {
      setInvoices(data || []);
      setLoading(false);
    });
  }, []);

  const totalEmesso = invoices.filter(f => f.tipo_documento === 'fattura').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalIncassato = invoices.filter(f => f.tipo_documento === 'fattura' && f.stato === 'incassata').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalSospeso = invoices.filter(f => f.tipo_documento === 'fattura' && f.stato === 'emessa').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);
  const totalNoteCredito = invoices.filter(f => f.tipo_documento === 'nota_credito').reduce((a, b) => a + (b.righe?.reduce((sa: any, sb: any) => sa + sb.importo, 0) || 0), 0);

  const filteredInvoices = invoices.filter(f => {
    if (filterStato !== 'tutte' && f.stato !== filterStato) return false;
    const searchString = `${f.numero} ${f.progetto?.nome} ${f.progetto?.cliente?.nome}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Gestione Fatture & Pagamenti Studio</div>
      </div>

      <div className={styles.kpiGrid} style={{ marginBottom: '2rem' }}>
        <div className={styles.kpiCard} style={{ background: '#1e3a8a', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>Totale Fatturato Q3/2026</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>💶 {fmt(totalEmesso / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#064e3b', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Incassato</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>✓ {fmt(totalIncassato / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#78350f', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fcd34d', textTransform: 'uppercase', fontWeight: 600 }}>In Sospeso / Da Incassare</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#451a03', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fca5a5', textTransform: 'uppercase', fontWeight: 600 }}>Note di Credito Emesse</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>📉 {fmt(totalNoteCredito / 100)}</div>
        </div>
      </div>

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
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azioni</th>
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
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
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
                        {inv.stato === 'emessa' && !isNote && (
                          <button 
                            onClick={() => alert('Funzionalità di cambio stato implementabile via API')}
                            style={{ background: 'var(--indigo)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                          >
                            ✓ Incassata
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
