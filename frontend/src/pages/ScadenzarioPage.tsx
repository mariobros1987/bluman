import React, { useState, useEffect } from 'react';
import { fetchScadenzarioIncassiApi, registraIncassoApi, fetchClienti } from '../api/client';
import { fmt } from '../utils';
import { InviaSollecitoModal } from '../components/solleciti/InviaSollecitoModal';

export function ScadenzarioPage() {
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [selectedCliente, setSelectedCliente] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal Sollecito
  const [scadenzaDaSollecitare, setScadenzaDaSollecitare] = useState<any>(null);

  // Modal Registrazione Incasso
  const [selectedScadenza, setSelectedScadenza] = useState<any>(null);
  const [importoIncasso, setImportoIncasso] = useState('');
  const [metodoPagamento, setMetodoPagamento] = useState('bonifico');
  const [riferimentoTransazione, setRiferimentoTransazione] = useState('');
  const [noteOperatore, setNoteOperatore] = useState('');
  const [savingIncasso, setSavingIncasso] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [scadData, clData] = await Promise.all([
        fetchScadenzarioIncassiApi(),
        fetchClienti(),
      ]);
      setScadenze(scadData || []);
      setClienti(clData || []);
    } catch (err) {
      console.warn('Errore lettura scadenzario:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalSospeso = scadenze
    .filter((s) => s.stato !== 'incassato')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const totalScaduto = scadenze
    .filter((s) => s.stato !== 'incassato' && new Date(s.dataScadenza) < new Date())
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const totalIncassato = scadenze
    .filter((s) => s.stato === 'incassato')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const handleSaveIncasso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedScadenza || !importoIncasso) return;
    setSavingIncasso(true);
    const importoCentesimi = Math.round(parseFloat(importoIncasso) * 100);

    try {
      await registraIncassoApi(selectedScadenza.id, {
        importoIncassatoCentesimi: importoCentesimi,
        metodoPagamento,
        riferimentoTransazione: riferimentoTransazione || undefined,
        noteOperatore: noteOperatore || undefined,
      });
      alert('✓ Incasso registrato con successo e scritto automaticamente in Prima Nota!');
      setSelectedScadenza(null);
      setImportoIncasso('');
      setRiferimentoTransazione('');
      setNoteOperatore('');
      await loadData();
    } catch (err: any) {
      alert(`Errore registrazione incasso: ${err.message}`);
    } finally {
      setSavingIncasso(false);
    }
  };

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
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-red-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-red-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Rate Scadute (In Ritardo)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⚠️ {fmt(totalScaduto / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-green-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-green-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Saldate</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>✓ {fmt(totalIncassato / 100)}</div>
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
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento scadenze dal database...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
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
                  const isScaduta = s.stato !== 'incassato' && new Date(s.dataScadenza) < new Date();
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
                            background: isIncassata ? 'var(--pill-green-bg)' : isScaduta ? 'var(--pill-red-bg)' : 'var(--pill-amber-bg)',
                            color: isIncassata ? 'var(--pill-green-fg)' : isScaduta ? 'var(--pill-red-fg)' : 'var(--pill-amber-fg)',
                          }}
                        >
                          {isIncassata ? 'SALDATA' : isScaduta ? 'SCADUTA' : 'IN ATTESA'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                        {!isIncassata && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
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
                              onClick={() => {
                                setSelectedScadenza(s);
                                setImportoIncasso(((s.importoCentesimi || 0) / 100).toFixed(2));
                              }}
                            >
                              📥 Registra Incasso
                            </button>
                          </div>
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

      {/* MODAL REGISTRA INCASSO */}
      {selectedScadenza && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Registrazione Incasso Rata #{selectedScadenza.numeroRata}</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
              Fattura: <strong>{selectedScadenza.fattura?.numero}</strong> | Importo Rata: <strong>{fmt((selectedScadenza.importoCentesimi || 0) / 100)}</strong>
            </p>

            <form onSubmit={handleSaveIncasso} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo Incassato Effettivo (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={importoIncasso}
                  onChange={(e) => setImportoIncasso(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 16, fontWeight: 700 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Metodo Pagamento</label>
                <select
                  value={metodoPagamento}
                  onChange={(e) => setMetodoPagamento(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">Carta di Credito</option>
                  <option value="contanti">Contanti</option>
                  <option value="assegno">Assegno</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CRO / Riferimento Transazione Bancaria</label>
                <input
                  type="text"
                  placeholder="Es. CRO-987654321"
                  value={riferimentoTransazione}
                  onChange={(e) => setRiferimentoTransazione(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note Operatore (Opzionale)</label>
                <input
                  type="text"
                  placeholder="Note interne dell'operatore..."
                  value={noteOperatore}
                  onChange={(e) => setNoteOperatore(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedScadenza(null)}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={savingIncasso}
                >
                  {savingIncasso ? 'Registrazione...' : 'Conferma & Scrivi in Prima Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL SOLLECITO */}
      <InviaSollecitoModal
        isOpen={!!scadenzaDaSollecitare}
        onClose={() => setScadenzaDaSollecitare(null)}
        onSuccess={(msg) => {
          alert(`✓ ${msg}`);
          loadData();
        }}
        scadenzaId={scadenzaDaSollecitare?.id || null}
        numeroFattura={scadenzaDaSollecitare?.fattura?.numero || 'Fattura'}
        clienteNome={scadenzaDaSollecitare?.fattura?.cliente?.nome || scadenzaDaSollecitare?.fattura?.progetto?.cliente?.nome || 'Cliente'}
      />
    </div>
  );
}
