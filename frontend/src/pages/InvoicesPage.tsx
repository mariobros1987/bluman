import { useState, useEffect } from 'react';
import { fetchTutteFattureStudioApi, fetchTenantInfoApi, downloadFatturaXmlApi, inviaFatturaEmailApi, trasmettiFatturaSdiApi } from '../api/client';
import { fmt, getFormattedLogoUrl } from '../utils';
import { PROJECTS } from '../store/mockData';
import { downloadRealPdf } from '../utils/pdfGenerator';
import styles from './Dashboard.module.css'; // Reusing KPI grid styles

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [tenantInfo, setTenantInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = async () => {
    setLoading(true);
    const [invData, tenantRes] = await Promise.all([
      fetchTutteFattureStudioApi(),
      fetchTenantInfoApi(),
    ]);
    if (tenantRes) setTenantInfo(tenantRes);
    const apiInvoices = invData || [];

    const savedStr = localStorage.getItem('bluman_custom_invoices');
    const localInvoices: any[] = savedStr ? JSON.parse(savedStr) : [];

    // Estrai fatture emesse direttamente dai progetti dello studio
    const localProjStr = localStorage.getItem('bluman_custom_projects');
    const localProjs: any[] = localProjStr ? JSON.parse(localProjStr) : [];
    const projInvoices: any[] = [];

    localProjs.forEach((p) => {
      (p.fatture || []).forEach((f: any) => {
        projInvoices.push({
          id: f.id || `ft-proj-${p.id}-${f.numero}`,
          numero: f.numero || `FT-2026-0001`,
          tipo_documento: 'fattura',
          serie: 'FT',
          importo: f.importo || 1500,
          data: f.data || new Date().toLocaleDateString('it-IT'),
          stato: f.stato || 'emessa',
          progetto: {
            id: p.id,
            nome: p.n || p.nome,
            cliente: { nome: p.cl || p.cliente?.nome || 'Cliente Studio' },
          },
          righe: [{ descrizione: f.desc || `Prestazione professionale ${p.n || p.nome}`, importo: Math.round((f.importo || 1500) * 100) }],
        });
      });
    });

    // Includi fatture dei progetti dallo store PROJECTS di default
    PROJECTS.forEach((p) => {
      (p.fatture || []).forEach((f: any) => {
        projInvoices.push({
          id: f.id || `ft-mock-${p.id}-${f.numero}`,
          numero: f.numero || `FT-2026-0001`,
          tipo_documento: 'fattura',
          serie: 'FT',
          importo: f.importo || 1500,
          data: f.data || new Date().toLocaleDateString('it-IT'),
          stato: f.stato || 'emessa',
          progetto: {
            id: p.id,
            nome: p.n,
            cliente: { nome: p.cl || 'Cliente Studio' },
          },
          righe: [{ descrizione: f.desc || `Prestazione professionale: ${p.n}`, importo: Math.round((f.importo || 1500) * 100) }],
        });
      });
    });

    const mergedMap = new Map();
    [...apiInvoices, ...localInvoices, ...projInvoices].forEach(item => {
      if (item && (item.id || item.numero)) {
        mergedMap.set(item.id || item.numero, item);
      }
    });

    setInvoices(Array.from(mergedMap.values()));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const getFatturaImporto = (f: any) => {
    if (f.importo && typeof f.importo === 'number' && f.importo > 0) return f.importo * 100;
    if (f.importoCentesimi && typeof f.importoCentesimi === 'number' && f.importoCentesimi > 0) return f.importoCentesimi;
    if (f.righe && Array.isArray(f.righe) && f.righe.length > 0) {
      return f.righe.reduce((sa: any, sb: any) => sa + (sb.importo || 0), 0);
    }
    return 0;
  };

  const totalEmesso = invoices.filter(f => (f.tipo_documento || f.tipoDocumento || 'fattura') === 'fattura').reduce((a, b) => a + getFatturaImporto(b), 0);
  const totalIncassato = invoices.filter(f => (f.tipo_documento || f.tipoDocumento || 'fattura') === 'fattura' && f.stato === 'incassata').reduce((a, b) => a + getFatturaImporto(b), 0);
  const totalSospeso = invoices.filter(f => (f.tipo_documento || f.tipoDocumento || 'fattura') === 'fattura' && f.stato !== 'incassata').reduce((a, b) => a + getFatturaImporto(b), 0);
  const totalNoteCredito = invoices.filter(f => (f.tipo_documento || f.tipoDocumento) === 'nota_credito').reduce((a, b) => a + getFatturaImporto(b), 0);

  const filteredInvoices = invoices.filter(f => {
    if (filterStato !== 'tutte' && f.stato !== filterStato) return false;
    const searchString = `${f.numero} ${f.progetto?.nome} ${f.progetto?.cliente?.nome}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div className={styles.sectionHeader} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Registro Fatture & Note di Credito</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Emissione fiscale, formato SDI XML ed archivio PDF delle prestazioni
          </p>
        </div>

        <button
          onClick={() => {
            if (invoices.length === 0) {
              alert('Nessuna fattura presente nel registro da esportare.');
              return;
            }
            const headers = [
              'Tipo Documento',
              'Numero Documento',
              'Data Emissione',
              'Cliente Committente',
              'Pratica / Incarico',
              'Imponibile (€)',
              'Aliquota IVA (%)',
              'Totale Documento (€)',
              'Stato Fiscale',
              'Codice SDI / Tracciato'
            ];
            const rows = invoices.map(inv => {
              const isNote = (inv.tipo_documento || inv.tipoDocumento) === 'nota_credito';
              const importoTot = getFatturaImporto(inv) / 100;
              const imponibile = (importoTot / 1.22).toFixed(2);
              const numDoc = inv.numero || `${isNote ? 'NC' : 'FT'}-${inv.numeroProgressivoSerie || '01'}`;
              return [
                isNote ? 'Nota di Credito (NC)' : 'Fattura Elettronica (FT)',
                numDoc,
                inv.data ? new Date(inv.data).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT'),
                `"${(inv.progetto?.cliente?.nome || 'Cliente Studio').replace(/"/g, '""')}"`,
                `"${(inv.progetto?.nome || 'Incarico Studio').replace(/"/g, '""')}"`,
                `${isNote ? '-' : ''}${imponibile}`,
                '22%',
                `${isNote ? '-' : ''}${importoTot.toFixed(2)}`,
                inv.stato === 'incassata' ? 'SALDATA' : inv.stato === 'emessa' ? 'DA_INCASSARE' : 'ANNULLATA',
                inv.sdiIdentificativo || 'SDI-XML-GEN'
              ];
            });
            const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Registro_Fatture_Commercialista_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }}
          style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #1e40af', background: '#1e3a8a', color: '#93c5fd', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          title="Esporta il registro completo delle fatture e note di credito per il commercialista (CSV / Excel)"
        >
          <span>📊 Export Registro Fiscale (CSV / Excel)</span>
        </button>
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
                  const isNote = (inv.tipo_documento || inv.tipoDocumento) === 'nota_credito';
                  const importoTotale = getFatturaImporto(inv) / 100;

                  const formatPdfData = (dataRaw?: any) => {
                    if (!dataRaw) return new Date().toLocaleDateString('it-IT');
                    const d = new Date(dataRaw);
                    return isNaN(d.getTime()) ? new Date().toLocaleDateString('it-IT') : d.toLocaleDateString('it-IT');
                  };

                  const pdfDate = formatPdfData(inv.data);
                  const righePdf = (inv.righe && inv.righe.length > 0) ? inv.righe : [
                    { descrizione: inv.progetto?.nome ? `Canone / Prestazione per ${inv.progetto.nome}` : 'Canone / Prestazione professionale', importo: Math.round(importoTotale * 100) }
                  ];

                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                        <div style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: isNote ? '#7f1d1d' : '#1e3a8a', color: 'white', fontSize: 11, marginRight: 8 }}>
                          {isNote ? 'NC' : 'FT'}
                        </div>
                        {inv.numero || `${isNote ? 'NC' : 'FT'}-${inv.numeroProgressivoSerie}`}
                      </td>
                      <td style={{ padding: '16px 8px', color: 'var(--muted)' }}>
                        {pdfDate}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{inv.progetto?.cliente?.nome || 'Cliente'}</div>
                        <div style={{ fontSize: 12, color: 'var(--indigo-l)' }}>{inv.progetto?.nome || 'Progetto'}</div>
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 700, color: isNote ? '#fca5a5' : '#fff' }}>
                        {isNote ? '-' : ''}💶 {importoTotale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                            const logoSrc = getFormattedLogoUrl(tenantInfo?.logoUrl);
                            const studioNome = tenantInfo?.ragioneSociale || 'Bluecode Advisory Studio';
                            const studioPiva = tenantInfo?.piva || '12345678901';
                            const studioIban = tenantInfo?.iban || 'IT99C0306902100100000012345';
                            const temaColore = tenantInfo?.coloreTemaFattura || '#1e3a8a';

                            await downloadRealPdf(
                              `Fattura_${inv.numero || 'Bozza'}.pdf`,
                              `<div style="font-family: Arial, sans-serif; padding: 25px; color: #0f172a; background: #ffffff;">
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${temaColore}; padding-bottom: 16px; margin-bottom: 24px;">
                                  <div style="display: flex; align-items: center; gap: 16px;">
                                    <img src="${logoSrc}" style="height: 54px; max-width: 180px; object-fit: contain;" />
                                    <div>
                                      <h1 style="margin: 0; color: ${temaColore}; font-size: 20px; font-weight: 800;">${studioNome}</h1>
                                      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">P.IVA ${studioPiva} | Studio Advisory & Consulting</div>
                                    </div>
                                  </div>
                                  <div style="text-align: right;">
                                    <h2 style="margin: 0; color: #0f172a; font-size: 16px; font-weight: 700;">${isNote ? 'NOTA DI CREDITO' : 'FATTURA ELETTRONICA'}</h2>
                                    <div style="font-size: 14px; font-weight: bold; color: ${temaColore}; margin-top: 2px;">${inv.numero || 'Bozza'}</div>
                                    <div style="font-size: 11px; color: #64748b;">Data Emissione: ${pdfDate}</div>
                                  </div>
                                </div>

                                <div style="margin-bottom: 24px; background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
                                  <div style="font-size: 10.5px; text-transform: uppercase; color: #64748b; font-weight: 800; letter-spacing: 0.5px;">Cliente Cessionario:</div>
                                  <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px;">${inv.progetto?.cliente?.nome || 'Cliente Studio'}</div>
                                  <div style="font-size: 12px; color: #334155; margin-top: 2px;">Progetto Collegato: ${inv.progetto?.nome || 'Incarico'}</div>
                                </div>

                                <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                                  <thead>
                                    <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left; font-size: 12px;">
                                      <th style="padding: 10px 12px; color: #334155; font-weight: 700;">Descrizione Prestazione</th>
                                      <th style="padding: 10px 12px; text-align: right; color: #334155; font-weight: 700;">Importo Euro</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${righePdf.map((r: any) => `
                                      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
                                        <td style="padding: 12px 10px; color: #1e293b;">${r.descrizione || 'Prestazione professionale'}</td>
                                        <td style="padding: 12px 10px; text-align: right; font-weight: 700; color: #0f172a;">€ ${((r.importo || 0) / (r.importo > 5000 ? 100 : 1)).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    `).join('')}
                                  </tbody>
                                </table>

                                <div style="text-align: right; font-size: 16px; font-weight: 800; color: ${temaColore}; border-top: 2px solid ${temaColore}; padding-top: 12px;">
                                  TOTALE DOCUMENTO: € ${importoTotale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>

                                <div style="margin-top: 36px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px;">
                                  <strong>Coordinate Bancarie:</strong> IBAN ${studioIban} | <strong>Causale:</strong> Saldo Fattura ${inv.numero || 'Bozza'}
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
                          style={{ background: '#059669', border: 'none', color: 'white', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', marginRight: 6, fontWeight: 700 }}
                          onClick={async () => {
                            const res = await trasmettiFatturaSdiApi(inv.id);
                            if (res) alert(res.message || '✓ Fattura trasmessa a SDI!');
                          }}
                          title="Trasmetti Direttamente all'Agenzia delle Entrate via SDI Web Service"
                        >
                          🚀 Trasmetti a SDI
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

