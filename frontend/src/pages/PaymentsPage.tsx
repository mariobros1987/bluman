import React, { useState, useEffect } from 'react';
import { fetchScadenzarioIncassiApi, registraIncassoApi, fetchClienti } from '../api/client';
import { fmt } from '../utils';
import { useToast } from '../components/ui/ToastProvider';
import { Modal } from '../components/ui/Modal';

export function PaymentsPage() {
  const toast = useToast();
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [selectedCliente, setSelectedCliente] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal Registrazione Incasso Prima Nota
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
    setScadenze(scadData || []);
    setClienti(clData || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalIncassato = scadenze
    .filter(s => s.stato === 'incassato')
    .reduce((a, b) => a + (b.importoCentesimi || 0), 0);

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

    // §3.3 — la registrazione dell'incasso è un'operazione di Prima Nota: se l'API
    // fallisce l'utente deve saperlo (prima: nessun alert, la modal restava aperta in silenzio).
    try {
      const res = await registraIncassoApi(selectedScadenza.id, {
        importoIncassatoCentesimi: importoCentesimi,
        metodoPagamento,
        riferimentoTransazione,
        noteOperatore,
      });
      setSavingIncasso(false);
      if (res) {
        toast.successo('Incasso registrato con successo in Prima Nota!');
        setSelectedScadenza(null);
        loadData();
      }
    } catch (err: any) {
      setSavingIncasso(false);
      toast.errore(`Registrazione incasso NON riuscita: ${err?.message || 'errore di rete'}. La scadenza NON è stata aggiornata in Prima Nota: riprova.`);
    }
  };

  const handleSendReminder = (scad: any) => {
    const clienteNome = scad.fattura?.progetto?.cliente?.nome || 'Cliente';
    const importo = fmt((scad.importoCentesimi || 0) / 100);
    toast.successo(`Sollecito inviato con successo a ${clienteNome} per la rata di ${importo}!`);
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
          <h2 style={{ margin: 0 }}>Scadenzario Incassi & Prima Nota Studio</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Monitoraggio flussi finanziari, rateizzazioni ed incassi partite aperte
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: 'var(--pill-green-bg)', padding: 20, borderRadius: 12, border: '1px solid var(--pill-green-bd)' }}>
          <div style={{ fontSize: 12, color: 'var(--pill-green-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Effettivo</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-green-fg)', marginTop: 8 }}>✓ {fmt(totalIncassato / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-amber-bg)', padding: 20, borderRadius: 12, border: '1px solid var(--pill-amber-bd)' }}>
          <div style={{ fontSize: 12, color: 'var(--pill-amber-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Partite Aperte in Scadenza</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-amber-fg)', marginTop: 8 }}>⏳ {fmt(totalSospeso / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-red-bg)', padding: 20, borderRadius: 12, border: '1px solid var(--pill-red-bd)' }}>
          <div style={{ fontSize: 12, color: 'var(--pill-red-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Incassi Scaduti (In Ritardo)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-red-fg)', marginTop: 8 }}>⚠️ {fmt(totalScaduto / 100)}</div>
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
                <th style={{ padding: '12px 8px' }}>Cliente / Progetto</th>
                <th style={{ padding: '12px 8px' }}>Importo Rata</th>
                <th style={{ padding: '12px 8px' }}>Stato Incasso</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azioni Prima Nota</th>
              </tr>
            </thead>
            <tbody>
              {filteredScadenze.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessun incasso o partita aperta trovata.
                  </td>
                </tr>
              ) : (
                filteredScadenze.map((scad) => {
                  const isLate = new Date(scad.dataScadenza) < new Date() && scad.stato !== 'incassato';
                  const importoRata = (scad.importoCentesimi || 0) / 100;
                  
                  return (
                    <tr key={scad.id} style={{ borderBottom: '1px solid var(--border)', background: isLate ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
                      <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                        📅 Rata #{scad.numeroRata} - {new Date(scad.dataScadenza).toLocaleDateString()}
                        {isLate && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--pill-red-fg)', fontWeight: 700 }}>⚠️ In Ritardo</span>}
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 600, color: 'var(--indigo-l)' }}>
                        {scad.fattura?.numero || 'Fattura'}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{scad.fattura?.progetto?.cliente?.nome || 'Cliente Studio'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{scad.fattura?.progetto?.nome || 'Progetto'}</div>
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 700, fontSize: 15 }}>
                        💶 {fmt(importoRata)}
                      </td>
                      <td style={{ padding: '16px 8px' }}>
                        {scad.stato === 'incassato' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)' }}>✓ Saldata</span>}
                        {scad.stato === 'parziale' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)' }}>🔹 Parziale</span>}
                        {scad.stato === 'in_attesa' && <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)' }}>⏳ In Attesa</span>}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        {scad.stato !== 'incassato' ? (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleSendReminder(scad)}
                              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
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
                          <span style={{ fontSize: 12, color: 'var(--pill-green-fg)', fontWeight: 600 }}>✓ Incassato in Prima Nota</span>
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

      {/* MODAL REGISTRAZIONE INCASSO PRIMA NOTA */}
      {selectedScadenza && (
        <Modal onClose={() => setSelectedScadenza(null)} overlayBackground="rgba(0,0,0,0.7)" zIndex={1000} labelledBy="titolo-incasso-pn">
          {(richiediChiusura) => (
          <form onSubmit={handleSaveIncasso} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 450, border: '1px solid var(--border)' }}>
            <h3 id="titolo-incasso-pn" style={{ marginTop: 0 }}>Registra Incasso Prima Nota</h3>
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
                onClick={richiediChiusura}
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
          )}
        </Modal>
      )}
    </div>
  );
}
