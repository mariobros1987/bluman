import { useState, useEffect } from 'react';
import {
  anteprimaFascicoloFiscaleApi,
  scaricaFascicoloFiscaleZipApi,
  type AnteprimaFascicoloFiscale,
} from '../../api/fascicoloFiscale';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function EsportaFascicoloCommercialistaModal({ isOpen, onClose }: Props) {
  const currentYear = new Date().getFullYear();
  const [anno, setAnno] = useState<number>(currentYear);
  const [tipo, setTipo] = useState<'mensile' | 'trimestrale' | 'annuale'>('mensile');
  const [mese, setMese] = useState<number>(new Date().getMonth() + 1);
  const [trimestre, setTrimestre] = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3));

  const [loading, setLoading] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [anteprima, setAnteprima] = useState<AnteprimaFascicoloFiscale | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      caricaAnteprima();
    }
  }, [isOpen, anno, tipo, mese, trimestre]);

  const caricaAnteprima = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await anteprimaFascicoloFiscaleApi({
        anno,
        tipo,
        mese: tipo === 'mensile' ? mese : undefined,
        trimestre: tipo === 'trimestrale' ? trimestre : undefined,
      });
      setAnteprima(data);
    } catch (err: any) {
      setError(err?.message || 'Impossibile calcolare anteprima');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { blob, nomeFile } = await scaricaFascicoloFiscaleZipApi({
        anno,
        tipo,
        mese: tipo === 'mensile' ? mese : undefined,
        trimestre: tipo === 'trimestrale' ? trimestre : undefined,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeFile;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      onClose();
    } catch (err: any) {
      setError(err?.message || 'Errore durante il download del file ZIP');
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  const mesiNomi = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ];

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-container" style={{ maxWidth: 640, width: '100%' }}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              📦 Export Fascicolo per il Commercialista
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Generazione archivio ZIP unificato con XML SDI, LIPE, F24 e Prima Nota
            </p>
          </div>
          <button type="button" className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.15)', color: 'var(--red)', fontSize: 12.5, border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              ⚠️ {error}
            </div>
          )}

          {/* Selezione Periodo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                Anno Fiscale
              </label>
              <select
                value={anno}
                onChange={(e) => setAnno(parseInt(e.target.value, 10))}
                style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%', fontSize: 13 }}
              >
                {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                Tipo Periodo
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as any)}
                style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%', fontSize: 13 }}
              >
                <option value="mensile">Mensile</option>
                <option value="trimestrale">Trimestrale</option>
                <option value="annuale">Anno Intero</option>
              </select>
            </div>

            {tipo === 'mensile' && (
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                  Mese
                </label>
                <select
                  value={mese}
                  onChange={(e) => setMese(parseInt(e.target.value, 10))}
                  style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%', fontSize: 13 }}
                >
                  {mesiNomi.map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {tipo === 'trimestrale' && (
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
                  Trimestre
                </label>
                <select
                  value={trimestre}
                  onChange={(e) => setTrimestre(parseInt(e.target.value, 10))}
                  style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: '100%', fontSize: 13 }}
                >
                  <option value={1}>1° Trimestre (Gen - Mar)</option>
                  <option value={2}>2° Trimestre (Apr - Giu)</option>
                  <option value={3}>3° Trimestre (Lug - Set)</option>
                  <option value={4}>4° Trimestre (Ott - Dic)</option>
                </select>
              </div>
            )}
          </div>

          {/* Scheda Anteprima Contenuti ZIP */}
          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)' }}>
              📁 Contenuto del Fascicolo Digitale (.ZIP)
            </h4>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: 12.5 }}>
                ⏳ Calcolo riepilogo in corso...
              </div>
            ) : anteprima ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span>🟢 <b>01_Fatture_Attive_Vendite</b> (XML SDI + CSV)</span>
                  <span style={{ fontWeight: 700 }}>{anteprima.conteggioFattureAttive} fatture (€ {anteprima.totaleImponibileVenditeEuro.toFixed(2)})</span>
                </div>
                {/* Il conteggio delle fatture non è il conteggio degli XML: una bozza non ha
                    numerazione definitiva né trasmissione, quindi resta nel registro CSV ma
                    non fra i file XML. Dirlo qui evita che lo studio scopra la differenza
                    dopo aver mandato lo ZIP al commercialista. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, color: 'var(--muted)', fontSize: 11.5 }}>
                  <span style={{ paddingLeft: 18 }}>↳ file XML FatturaPA inclusi</span>
                  <span>
                    {anteprima.conteggioXmlAttiviGenerati} XML
                    {anteprima.conteggioBozzeEscluseDaXml > 0
                      ? ` · ${anteprima.conteggioBozzeEscluseDaXml} in bozza solo nel CSV`
                      : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span>🔵 <b>02_Fatture_Passive_Acquisti</b> (XML + CSV)</span>
                  <span style={{ fontWeight: 700 }}>{anteprima.conteggioFatturePassive} fatture (€ {anteprima.totaleImponibileAcquistiEuro.toFixed(2)})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6, color: 'var(--muted)', fontSize: 11.5 }}>
                  <span style={{ paddingLeft: 18 }}>↳ XML originali del fornitore allegati</span>
                  <span>
                    {anteprima.conteggioXmlPassiviAllegati} su {anteprima.conteggioFatturePassive}
                    {anteprima.conteggioFatturePassive - anteprima.conteggioXmlPassiviAllegati > 0
                      ? ` · ${anteprima.conteggioFatturePassive - anteprima.conteggioXmlPassiviAllegati} senza file`
                      : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span>📊 <b>03_Liquidazione_IVA_LIPE</b> (F24 CSV + TXT)</span>
                  <span style={{ fontWeight: 700, color: anteprima.saldoIvaEuro >= 0 ? 'var(--red)' : 'var(--green)' }}>
                    {anteprima.saldoIvaEuro >= 0 ? `Debito F24: € ${anteprima.saldoIvaEuro.toFixed(2)}` : `Credito: € ${Math.abs(anteprima.saldoIvaEuro).toFixed(2)}`}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                  <span>💳 <b>04_Prima_Nota_Cassa_Banca</b> (CSV Zucchetti/TeamSystem)</span>
                  <span style={{ fontWeight: 700 }}>{anteprima.conteggioMovimentiPrimaNota} movimenti</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 2, color: 'var(--muted)', fontSize: 11.5 }}>
                  <span>📄 <b>00_INDICE_FASCICOLO_FISCALE.txt</b></span>
                  <span>Incluso</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'var(--card)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={downloading}>
            Annulla
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownloadZip}
            disabled={downloading || loading}
          >
            {downloading ? 'Generazione ZIP in corso...' : '⚡ Scarica Fascicolo Fiscale ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
