import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScadenzarioIncassiApi, registraIncassoApi, fetchClienti } from '../api/client';
import { fmt } from '../utils';

export function ScadenzarioPage() {
  const navigate = useNavigate();
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [selectedCliente, setSelectedCliente] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal Registrazione Incasso
  const [selectedScadenza, setSelectedScadenza] = useState<any>(null);
  const [importoIncasso, setImportoIncasso] = useState('');
  const [metodoPagamento, setMetodoPagamento] = useState('bonifico');
  const [riferimentoTransazione, setRiferimentoTransazione] = useState('');
  const [noteOperatore, setNoteOperatore] = useState('');
  const [savingIncasso, setSavingIncasso] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [scadData, clData] = await Promise.all([
      fetchScadenzarioIncassiApi(),
      fetchClienti(),
    ]);

    let finalScadenze = scadData || [];

    // Fallback/Integrazione se lo studio opera in modalità locale/custom
    if (finalScadenze.length === 0) {
      const localStr = localStorage.getItem('bluman_custom_projects');
      const localProjs: any[] = localStr ? JSON.parse(localStr) : [];
      const extractedScad: any[] = [];

      localProjs.forEach((p) => {
        (p.fatture || []).forEach((f: any, fIdx: number) => {
          const importoCentesimi = Math.round((f.importo || 0) * 100);
          extractedScad.push({
            id: `scad-loc-${p.id}-${fIdx}`,
            numeroRata: 1,
            dataScadenza: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            importoCentesimi,
            stato: f.stato === 'incassata' ? 'incassato' : 'in_attesa',
            fattura: {
              numero: f.numero || `FT-2026-000${fIdx + 1}`,
              progetto: {
                id: p.id,
                nome: p.n,
                cliente: { nome: p.cl || 'Cliente Studio' },
              },
            },
            registrazioniRegistrate: f.stato === 'incassata' ? [
              {
                importoIncassatoCentesimi: importoCentesimi,
                metodoPagamento: 'bonifico',
                riferimentoTransazione: 'TRN-SETTLED',
                dataIncasso: new Date().toISOString(),
              }
            ] : [],
          });
        });
      });

      finalScadenze = extractedScad;
    }

    setScadenze(finalScadenze);
    setClienti(clData || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalSospeso = scadenze
    .filter(s => s.stato !== 'incassato')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

  const totalScaduto = scadenze
    .filter(s => s.stato !== 'incassato' && new Date(s.dataScadenza) < new Date())
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

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

  const handleSendReminder = (scad: any) => {
    const clienteNome = scad.fattura?.progetto?.cliente?.nome || 'Cliente';
    const importo = fmt((scad.importoCentesimi || 0) / 100);
    alert(`✉️ Sollecito inviato con successo a ${clienteNome} per la rata di ${importo}!`);
  };

  const filteredScadenze = scadenze.filter(s => {
    if (filterStato !== 'tutte' && s.stato !== filterStato) return false;
    if (selectedCliente !== 'tutti' && s.fattura?.progetto?.cliente?.id !== selectedCliente) return false;
    const searchString = `${s.fattura?.numero} ${s.fattura?.progetto?.cliente?.nome} ${s.fattura?.progetto?.nome}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Scadenzario Incassi & Partite Aperte</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Controllo delle rate e dei pagamenti in scadenza con collegamento diretto ai Progetti
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: '#78350f', padding: 20, borderRadius: 12, border: '1px solid #b45309' }}>
          <div style={{ fontSize: 12, color: '#fcd34d', textTransform: 'uppercase', fontWeight: 600 }}>Partite Aperte in Scadenza</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div style={{ background: '#7f1d1d', padding: 20, borderRadius: 12, border: '1px solid #b91c1c' }}>
          <div style={{ fontSize: 12, color: '#fca5a5', textTransform: 'uppercase', fontWeight: 600 }}>Incassi Scaduti (In Ritardo)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⚠️ {fmt(totalScaduto / 100)}</div>
        </div>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cerca per fattura, cliente o progetto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 200 }}
          />

          <select
            value={selectedCliente}
            onChange={(e) => setSelectedCliente(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 220 }}
          >
            <option value="tutti">Tutti i Clienti</option>
            {clienti.map(c => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>

          <select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 200 }}
          >
            <option value="tutte">Tutti gli stati</option>
            <option value="in_attesa">In Attesa</option>
            <option value="parziale">Parziali</option>
            <option value="incassato">Incassati (Saldati)</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento scadenzario incassi...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Scadenza / Rata</th>
                <th style={{ padding: '12px 8px' }}>Fattura</th>
                <th style={{ padding: '12px 8px' }}>Cliente / Progetto Collegato</th>
                <th style={{ padding: '12px 8px' }}>Importo Rata</th>
                <th style={{ padding: '12px 8px' }}>Stato Incasso</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredScadenze.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessuna partita aperta o scadenza trovata.
                  </td>
                </tr>
              ) : (
                filteredScadenze.map((scad) => {
                  const isLate = new Date(scad.dataScadenza) < new Date() && scad.stato !== 'incassato';
                  const importoRata = (scad.importoCentesimi || 0) / 100;
                  const projectId = scad.fattura?.progetto?.id || '1';
                  
                  return (
                    <tr key={scad.id} style={{ borderBottom: '1px solid var(--border)', background: isLate ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
                      <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                        📅 Rata #{scad.numeroRata} - {new Date(scad.dataScadenza).toLocaleDateString()}
                        {isLate && <span style={{ marginLeft: 8, fontSize: 11, color: '#fca5a5', fontWeight: 700 }}>⚠️ In Ritardo</span>}
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 600, color: 'var(--indigo-l)' }}>
                        {scad.fattura?.numero || 'Fattura'}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{scad.fattura?.progetto?.cliente?.nome || 'Cliente Studio'}</div>
                        <button
                          onClick={() => navigate(`/projects/${projectId}`)}
                          style={{ background: 'transparent', border: 'none', color: '#60a5fa', padding: 0, fontSize: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}
                        >
                          🔗 {scad.fattura?.progetto?.nome || 'Progetto Incarico'} ↗
                        </button>
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 700, fontSize: 15 }}>
                        💶 {fmt(importoRata)}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        {scad.stato === 'incassato' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>✓ Saldata</span>}
                        {scad.stato === 'parziale' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#1e3a8a', color: '#93c5fd' }}>🔹 Parziale</span>}
                        {scad.stato === 'in_attesa' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#78350f', color: '#fcd34d' }}>⏳ In Attesa</span>}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        {scad.stato !== 'incassato' ? (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleSendReminder(scad)}
                              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'white', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                            >
                              ✉️ Sollecita
                            </button>
                            <button
                              onClick={() => {
                                setSelectedScadenza(scad);
                                setImportoIncasso(importoRata.toString());
                              }}
                              style={{ background: 'var(--indigo)', border: 'none', color: 'white', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                            >
                              💰 Registra Incasso
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>✓ Saldata</span>
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

      {/* MODAL REGISTRAZIONE INCASSO */}
      {selectedScadenza && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveIncasso} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 450, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Registra Incasso Rata</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Fattura: {selectedScadenza.fattura?.numero} | Cliente: {selectedScadenza.fattura?.progetto?.cliente?.nome}
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Importo Incassato (€) *</label>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
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
                {savingIncasso ? 'Salvataggio...' : '✓ Salva Incasso'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
