import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHIAVI_REPORT,
  fetchReportApi,
  downloadReportApi,
  type ReportTabella,
  type CellaReport,
} from '../api/client';

// Formatta una cella della tabella in base al tipo della colonna. Le colonne numeriche
// sono allineate a destra; la valuta usa la stessa `fmt` delle altre pagine (in €).
function formatCella(
  valore: CellaReport,
  idx: number,
  report: ReportTabella,
): { testo: string; numerico: boolean } {
  if (valore === null || valore === undefined) return { testo: '—', numerico: false };
  if (typeof valore === 'number') {
    if (report.colonneValuta.includes(idx)) {
      return { testo: '€ ' + valore.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), numerico: true };
    }
    if (report.colonnePercentuali.includes(idx)) {
      return { testo: valore.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%', numerico: true };
    }
    if (report.colonneOre.includes(idx)) {
      return { testo: valore.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' h', numerico: true };
    }
    return { testo: valore.toLocaleString('it-IT'), numerico: true };
  }
  return { testo: valore, numerico: false };
}

const STILE_TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const STILE_TD: React.CSSProperties = {
  padding: '9px 12px',
  fontSize: 13,
  color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

export function ReportsPage() {
  const [chiaveAttiva, setChiaveAttiva] = useState<string>(CHIAVI_REPORT[0]?.chiave || 'ore-operatori');
  const [anno, setAnno] = useState<number | ''>('');
  const [report, setReport] = useState<ReportTabella | null>(null);
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'' | 'pdf' | 'xlsx'>('');

  const meta = useMemo(() => CHIAVI_REPORT.find((r) => r.chiave === chiaveAttiva), [chiaveAttiva]);
  const usaFiltroAnno = Boolean(meta?.conFiltroAnno);

  const caricaReport = useCallback(async () => {
    setLoading(true);
    setErrore(null);
    try {
      const dati = await fetchReportApi(chiaveAttiva, usaFiltroAnno && anno ? Number(anno) : undefined);
      setReport(dati);
    } catch (err: any) {
      setReport(null);
      setErrore(err?.message || 'Errore nel caricamento del report');
    } finally {
      setLoading(false);
    }
  }, [chiaveAttiva, anno, usaFiltroAnno]);

  useEffect(() => {
    caricaReport();
  }, [caricaReport]);

  const anniDisponibili = useMemo(() => {
    const corrente = new Date().getFullYear();
    const lista: number[] = [];
    for (let y = corrente + 1; y >= corrente - 6; y--) lista.push(y);
    return lista;
  }, []);

  const handleExport = async (formato: 'pdf' | 'xlsx') => {
    if (exporting) return;
    setExporting(formato);
    await downloadReportApi(chiaveAttiva, formato, usaFiltroAnno && anno ? Number(anno) : undefined);
    setExporting('');
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: 0 }}>📊 Report & Analytics</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            Reportistica direzionale su dati reali · esporta in PDF o Excel per condividerla con il team o il cliente.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleExport('pdf')}
            disabled={loading || Boolean(errore) || exporting !== ''}
            style={{
              background: exporting === 'pdf' ? 'var(--card2)' : 'var(--red)',
              color: 'var(--on-accent)', border: 'none', padding: '9px 18px', borderRadius: 8,
              fontSize: 12.5, fontWeight: 700, cursor: loading || exporting !== '' ? 'not-allowed' : 'pointer',
              opacity: loading || Boolean(errore) || exporting !== '' ? 0.6 : 1, transition: 'all .15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {exporting === 'pdf' ? '⏳ Genero…' : '📄 Scarica PDF'}
          </button>
          <button
            onClick={() => handleExport('xlsx')}
            disabled={loading || Boolean(errore) || exporting !== ''}
            style={{
              background: exporting === 'xlsx' ? 'var(--card2)' : 'var(--green)',
              color: 'var(--on-accent)', border: 'none', padding: '9px 18px', borderRadius: 8,
              fontSize: 12.5, fontWeight: 700, cursor: loading || exporting !== '' ? 'not-allowed' : 'pointer',
              opacity: loading || Boolean(errore) || exporting !== '' ? 0.6 : 1, transition: 'all .15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {exporting === 'xlsx' ? '⏳ Genero…' : '📊 Scarica Excel'}
          </button>
        </div>
      </div>

      {/* Selettore report */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {CHIAVI_REPORT.map((r) => {
          const attivo = r.chiave === chiaveAttiva;
          return (
            <button
              key={r.chiave}
              onClick={() => { setChiaveAttiva(r.chiave); if (!r.conFiltroAnno) setAnno(''); }}
              title={r.desc}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: attivo ? 700 : 600,
                cursor: 'pointer',
                border: attivo ? '1px solid var(--indigo)' : '1px solid var(--border)',
                background: attivo ? 'var(--indigo)' : 'var(--card)',
                color: attivo ? 'var(--on-accent)' : 'var(--text)',
                transition: 'all .15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{r.icona}</span> {r.label}
            </button>
          );
        })}

        {/* Filtro anno (solo per report che lo supportano) */}
        {usaFiltroAnno && (
          <select
            value={anno}
            onChange={(e) => setAnno(e.target.value === '' ? '' : Number(e.target.value))}
            style={{
              marginLeft: 'auto', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            <option value="">Tutti gli anni</option>
            {anniDisponibili.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stato caricamento */}
      {loading && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ⏳ Elaborazione report in corso…
        </div>
      )}

      {/* Stato errore — nessun dato finto: si mostra il problema reale */}
      {!loading && errore && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--red)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: 'var(--red)', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Errore nel caricamento del report</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 18 }}>{errore}</div>
          <button
            onClick={caricaReport}
            style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            ↻ Riprova
          </button>
        </div>
      )}

      {/* Tabella report */}
      {!loading && !errore && report && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Sottotitolo del report */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700 }}>{report.titolo}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>{report.sottotitolo}</div>
            </div>
            <div style={{ color: 'var(--hint)', fontSize: 11 }}>{report.righe.length} righe</div>
          </div>

          {report.righe.length === 0 && !report.totali?.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              📭 Nessun dato disponibile per questo report{usaFiltroAnno && anno ? ` nell'anno ${anno}` : ''}.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    {report.intestazioni.map((h, i) => (
                      <th
                        key={i}
                        style={{
                          ...STILE_TH,
                          textAlign: report.colonneValuta.includes(i) || report.colonneOre.includes(i) || report.colonnePercentuali.includes(i) ? 'right' : 'left',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.righe.map((riga, rIdx) => (
                    <tr key={rIdx} style={{ background: rIdx % 2 === 1 ? 'rgba(255,255,255,.02)' : 'transparent' }}>
                      {riga.map((cella, cIdx) => {
                        const { testo, numerico } = formatCella(cella, cIdx, report);
                        return (
                          <td key={cIdx} style={{ ...STILE_TD, textAlign: numerico ? 'right' : 'left' }}>
                            {testo}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {report.totali?.map((tot, tIdx) => (
                    <tr key={`tot-${tIdx}`} style={{ background: 'var(--card2)' }}>
                      {tot.map((cella, cIdx) => {
                        const { testo, numerico } = formatCella(cella, cIdx, report);
                        return (
                          <td key={cIdx} style={{ ...STILE_TD, fontWeight: 700, textAlign: numerico ? 'right' : 'left', color: 'var(--indigo-l)' }}>
                            {testo}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Riepilogo */}
          {report.riepilogo && report.riepilogo.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 16, borderTop: '1px solid var(--border)', background: 'rgba(99,102,241,.06)' }}>
              {report.riepilogo.map((voce, i) => (
                <div key={i} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', minWidth: 180, flex: '1 1 180px' }}>
                  <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{voce.etichetta}</div>
                  <div style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, marginTop: 4 }}>{voce.valore}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
