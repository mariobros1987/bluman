import React, { useState, useEffect } from 'react';
import { fetchTutteFattureStudioApi, downloadFatturaXmlApi, downloadFatturaPdfServerApi, inviaFatturaEmailApi } from '../api/client';
import { fmt } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import styles from './Dashboard.module.css'; // Reusing KPI grid styles

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = async () => {
    setLoading(true);
    const invData = await fetchTutteFattureStudioApi();
    setInvoices(invData || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
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
      <div className={styles.sectionHeader} style={{ marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Registro Fatture & Note di Credito</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Emissione fiscale, formato SDI XML ed archivio PDF delle prestazioni
          </p>
        </div>
      </div>

      <div className={styles.kpiGrid} style={{ marginBottom: '2rem' }}>
        <div className={styles.kpiCard} style={{ background: '#1e3a8a', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>Totale Fatturato Studio</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>💶 {fmt(totalEmesso / 100)}</div>
        </div>
        <div className={styles.kpiCard} style={{ background: '#064e3b', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Saldate</div>
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
                <th style={{ padding: '12px 8px' }}>Importo Totale</th>
                <th style={{ padding: '12px 8px' }}>Stato Fiscale</th>
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
                        {inv.stato === 'incassata' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>✓ Saldata</span>}
                        {inv.stato === 'emessa' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#78350f', color: '#fcd34d' }}>⏳ Emessa</span>}
                        {inv.stato === 'annullata' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#451a03', color: '#fca5a5' }}>✗ Annullata</span>}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        <button 
                          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', marginRight: 6 }}
                          onClick={async () => {
                            await downloadRealPdf(
                              `Fattura_${inv.numero || 'Bozza'}.pdf`,
                              `<div style="font-family: Arial, sans-serif; padding: 20px; color: #0f172a;">
                                <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 20px;">
                                  <div>
                                    <h1 style="margin: 0; color: #1e3a8a; font-size: 20px;">Bluecode Advisory Studio</h1>
                                    <div style="font-size: 12px; color: #64748b;">P.IVA 12345678901 | Studio Advisory & Consulting</div>
                                  </div>
                                  <div style="text-align: right;">
                                    <h2 style="margin: 0; color: #0f172a; font-size: 16px;">${isNote ? 'NOTA DI CREDITO' : 'FATTURA ELETTRONICA'}</h2>
                                    <div style="font-size: 13px; font-weight: bold; color: #1e3a8a;">${inv.numero || 'Bozza'}</div>
                                    <div style="font-size: 11px; color: #64748b;">Data: ${inv.data ? new Date(inv.data).toLocaleDateString() : 'Oggi'}</div>
                                  </div>
                                </div>
                                <div style="margin-bottom: 20px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                                  <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold;">Cliente Cessionario:</div>
                                  <div style="font-size: 14px; font-weight: bold; color: #0f172a;">${inv.progetto?.cliente?.nome || 'Cliente Studio'}</div>
                                  <div style="font-size: 12px; color: #334155;">Progetto: ${inv.progetto?.nome || 'Incarico'}</div>
                                </div>
                                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                                  <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', textAlign: 'left', fontSize: '12px' }}>
                                      <th style="padding: 8px;">Descrizione Prestazione</th>
                                      <th style="padding: 8px; text-align: right;">Importo</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${(inv.righe || []).map((r: any) => `
                                      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
                                        <td style="padding: 10px 8px;">${r.descrizione}</td>
                                        <td style="padding: 10px 8px; text-align: right; font-weight: bold;">€ ${(r.importo / 100).toFixed(2)}</td>
                                      </tr>
                                    `).join('')}
                                  </tbody>
                                </table>
                                <div style="text-align: right; font-size: 16px; font-weight: bold; color: #1e3a8a; border-top: 2px solid #1e3a8a; padding-top: 10px;">
                                  TOTALE DOCUMENTO: € ${fmt(importoTotale)}
                                </div>
                                <div style="margin-top: 30px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                                  IBAN di Pagamento: IT99C0306902100100000012345 | Causale: Saldo Fattura ${inv.numero}
                                </div>
                              </div>`
                            );
                          }}
                          title="Scarica Fattura PDF Grafico VERO (A4)"
                        >
                          📄 Scarica Fattura PDF
                        </button>
                        <button 
                          style={{ background: '#0284c7', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', marginRight: 6 }}
                          onClick={() => downloadFatturaXmlApi(inv.id)}
                          title="Scarica Tracciato XML SDI FatturaPA"
                        >
                          📥 XML SDI
                        </button>
                        <button 
                          style={{ background: 'var(--indigo)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                          onClick={async () => {
                            const res = await inviaFatturaEmailApi(inv.id);
                            if (res) alert('✓ ' + (res.message || 'Email inviata con successo via Nodemailer!'));
                          }}
                          title="Invia al Cliente via SMTP Nodemailer con Allegato PDF"
                        >
                          ✉️ Invia Mail
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
    </div>
  );
}

