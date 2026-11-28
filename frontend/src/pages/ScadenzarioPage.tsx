import { useState, useEffect } from 'react';
import { fetchScadenzarioIncassiApi, fetchClienti } from '../api/client';
import { fmt } from '../utils';
import { InviaSollecitoModal } from '../components/solleciti/InviaSollecitoModal';
import { RegistraIncassoModal } from '../components/contabilita/RegistraIncassoModal';
import { StornaIncassoModal } from '../components/contabilita/StornaIncassoModal';
import { incassiStornabili } from '../../../src/domain/stornoIncasso';
import { useToast } from '../components/ui/ToastProvider';
import { FiltroPeriodo } from '../components/ui/FiltroPeriodo';
import { usePeriodo } from '../context/PeriodoContext';

export function ScadenzarioPage() {
  const toast = useToast();
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [selectedCliente, setSelectedCliente] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');
  // Filtro periodo sulla data di scadenza (lato server). Inizializzato dal periodo globale.
  const { dataDa: gDataDa, dataA: gDataA } = usePeriodo();
  const [dataDa, setDataDa] = useState(gDataDa);
  const [dataA, setDataA] = useState(gDataA);
  useEffect(() => { setDataDa(gDataDa); setDataA(gDataA); }, [gDataDa, gDataA]);

  // Modal Sollecito
  const [scadenzaDaSollecitare, setScadenzaDaSollecitare] = useState<any>(null);

  // Registrazione e storno dell'incasso: i due modali leggono e scrivono da soli, la pagina rilegge.
  const [selectedScadenza, setSelectedScadenza] = useState<any>(null);
  const [scadenzaDaStornare, setScadenzaDaStornare] = useState<any>(null);

  // F6 — una lettura fallita è un errore da dichiarare, non «nessuna scadenza».
  const [erroreCaricamento, setErroreCaricamento] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErroreCaricamento(null);
    try {
      const [scadData, clData] = await Promise.all([
        fetchScadenzarioIncassiApi({ dataDa: dataDa || undefined, dataA: dataA || undefined }, { rigettaSuErrore: true }),
        fetchClienti(),
      ]);
      setScadenze(scadData || []);
      setClienti(clData || []);
    } catch (err) {
      setScadenze([]);
      setErroreCaricamento(err instanceof Error ? err.message : 'Errore di rete');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dataDa, dataA]);

  const totalSospeso = scadenze
    .filter((s) => s.stato !== 'incassato' && s.stato !== 'stornata')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const totalScaduto = scadenze
    .filter((s) => s.stato !== 'incassato' && s.stato !== 'stornata' && new Date(s.dataScadenza) < new Date())
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const totalIncassato = scadenze
    .filter((s) => s.stato === 'incassato')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const filteredScadenze = scadenze.filter((s) => {
    if (filterStato !== 'tutte' && s.stato !== filterStato) return false;
    const clId = s.fattura?.clienteId || s.fattura?.progetto?.clienteId;
    if (selectedCliente !== 'tutti' && clId !== selectedCliente) return false;
    const searchString = `${s.fattura?.numero || ''} ${s.fattura?.cliente?.nome || ''} ${s.fattura?.progetto?.nome || ''}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>📅 Scadenzario Incassi & Partite Aperte</h2>
        <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
          Controllo rate delle fatture, solleciti e registrazione tempestiva degli incassi
        </p>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: '2rem' }}>
        <div style={{ background: 'var(--pill-amber-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-amber-fg)', textTransform: 'uppercase', fontWeight: 600 }}>In Sospeso / Da Incassare</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-amber-fg)', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-red-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-red-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Rate Scadute (In Ritardo)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-red-fg)', marginTop: 8 }}>⚠️ {fmt(totalScaduto / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-green-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-green-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Saldate</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-green-fg)', marginTop: 8 }}>✓ {fmt(totalIncassato / 100)}</div>
        </div>
        <div style={{ background: 'var(--card)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Totale Rate Gestite</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>📊 {scadenze.length}</div>
        </div>
      </div>

      {/* FILTRI & TABELLA */}
      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cerca per numero fattura, cliente o incarico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 200 }}
          />
          <select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 180 }}
          >
            <option value="tutte">Tutti gli stati</option>
            <option value="in_attesa">In Attesa (Aperte)</option>
            <option value="parziale">Incassate Parziali</option>
            <option value="incassato">Saldate</option>
          </select>
          <select
            value={selectedCliente}
            onChange={(e) => setSelectedCliente(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 200 }}
          >
            <option value="tutti">Tutti i clienti</option>
            {clienti.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <FiltroPeriodo dataDa={dataDa} dataA={dataA} onDataDa={setDataDa} onDataA={setDataA} />
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento scadenze dal database...</div>
        ) : erroreCaricamento ? (
          <div role="alert" style={{ padding: '2rem', textAlign: 'center', background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', borderRadius: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Impossibile caricare lo scadenzario.</div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>{erroreCaricamento}</div>
            <button type="button" className="btn" onClick={() => loadData()}>Riprova</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}><table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Scadenza</th>
                <th style={{ padding: '12px 8px' }}>Fattura</th>
                <th style={{ padding: '12px 8px' }}>Cliente / Progetto</th>
                <th style={{ padding: '12px 8px' }}>Rata</th>
                <th style={{ padding: '12px 8px' }}>Importo Rata</th>
                <th style={{ padding: '12px 8px' }}>Stato</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azione</th>
              </tr>
            </thead>
            <tbody>
              {filteredScadenze.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessuna scadenza trovata.
                  </td>
                </tr>
              ) : (
                filteredScadenze.map((s) => {
                  const isStornata = s.stato === 'stornata';
                  const isScaduta = s.stato !== 'incassato' && !isStornata && new Date(s.dataScadenza) < new Date();
                  const isIncassata = s.stato === 'incassato';
                  const clNome = s.fattura?.cliente?.nome || s.fattura?.progetto?.cliente?.nome || 'Cliente';

                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 8px', fontWeight: 600, color: isScaduta ? 'var(--pill-red-fg)' : 'var(--text)' }}>
                        {new Date(s.dataScadenza).toLocaleDateString('it-IT')}
                        {isScaduta && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--pill-red-fg)' }}>⚠️ SCADUTA</span>}
                      </td>
                      <td style={{ padding: '14px 8px', fontWeight: 600, color: 'var(--primary)' }}>
                        {s.fattura?.numero || 'Fattura'}
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{clNome}</div>
                        {s.fattura?.progetto?.nome && (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>📁 {s.fattura.progetto.nome}</div>
                        )}
                      </td>
                      <td style={{ padding: '14px 8px', fontSize: 13, color: 'var(--muted)' }}>
                        Rata #{s.numeroRata}
                      </td>
                      <td style={{ padding: '14px 8px', fontWeight: 700 }}>
                        {fmt((s.importoCentesimi || 0) / 100)}
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: isStornata ? 'var(--pill-blue-bg)' : isIncassata ? 'var(--pill-green-bg)' : isScaduta ? 'var(--pill-red-bg)' : 'var(--pill-amber-bg)',
                            color: isStornata ? 'var(--pill-blue-fg)' : isIncassata ? 'var(--pill-green-fg)' : isScaduta ? 'var(--pill-red-fg)' : 'var(--pill-amber-fg)',
                          }}
                        >
                          {isStornata ? '↩︎ STORNATA' : isIncassata ? 'SALDATA' : isScaduta ? 'SCADUTA' : s.stato === 'parziale' ? 'PARZIALE' : 'IN ATTESA'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                        {!isStornata && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                            {!isIncassata && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => setScadenzaDaSollecitare(s)}
                                >
                                  📩 Sollecita
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-success"
                                  onClick={() => setSelectedScadenza(s)}
                                >
                                  📥 Registra Incasso
                                </button>
                              </>
                            )}
                            {incassiStornabili(s.registrazioniRegistrate ?? []).length > 0 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                title="Annulla un incasso registrato per errore: riga contraria, la rata torna da incassare"
                                onClick={() => setScadenzaDaStornare(s)}
                              >
                                ↩ Storna incasso
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table></div>
        )}
      </div>

      {selectedScadenza && (
        <RegistraIncassoModal rata={selectedScadenza} onClose={() => setSelectedScadenza(null)} onRegistrato={loadData} />
      )}
      {scadenzaDaStornare && (
        <StornaIncassoModal rata={scadenzaDaStornare} onClose={() => setScadenzaDaStornare(null)} onStornato={loadData} />
      )}
      {/* MODAL SOLLECITO */}
      <InviaSollecitoModal
        isOpen={!!scadenzaDaSollecitare}
        onClose={() => setScadenzaDaSollecitare(null)}
        onSuccess={(msg) => {
          toast.successo(msg);
          loadData();
        }}
        scadenzaId={scadenzaDaSollecitare?.id || null}
        numeroFattura={scadenzaDaSollecitare?.fattura?.numero || 'Fattura'}
        clienteNome={scadenzaDaSollecitare?.fattura?.cliente?.nome || scadenzaDaSollecitare?.fattura?.progetto?.cliente?.nome || 'Cliente'}
      />
    </div>
  );
}
