import React, { useState, useEffect } from 'react';
import {
  fetchPrimaNotaApi,
  createPrimaNotaApi,
  importCsvPrimaNotaApi,
  deletePrimaNotaApi,
  fetchClienti,
  fetchContiBancariApi,
} from '../api/client';
import { fmt } from '../utils';
import { EsportaFascicoloCommercialistaModal } from '../components/contabilita/EsportaFascicoloCommercialistaModal';
import { Paginatore } from '../components/ui/Paginatore';
import { isRispostaPaginata, type MetaPaginazione } from '../api/paginazione';
import { useToast } from '../components/ui/ToastProvider';
import { Modal } from '../components/ui/Modal';
import { confirm } from '../components/ui/ConfirmProvider';

interface RiepilogoPrimaNota {
  totaleEntrateCentesimi: number;
  totaleUsciteCentesimi: number;
  saldoCentesimi: number;
}
const META_INIZIALE: MetaPaginazione = { page: 1, limit: 50, totale: 0, pagine: 0 };

export function PrimaNotaPage() {
  const toast = useToast();
  const [movimenti, setMovimenti] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [contiBancari, setContiBancari] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [meta, setMeta] = useState<MetaPaginazione>(META_INIZIALE);
  const [riepilogo, setRiepilogo] = useState<RiepilogoPrimaNota>({ totaleEntrateCentesimi: 0, totaleUsciteCentesimi: 0, saldoCentesimi: 0 });
  const [selectedTipo, setSelectedTipo] = useState('tutti');
  const [selectedMetodo, setSelectedMetodo] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);

  // Modal Nuova Registrazione Prima Nota
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form Fields
  const [newTipo, setNewTipo] = useState<'entrata' | 'uscita'>('entrata');
  const [newCategoria, setNewCategoria] = useState('incasso_fattura');
  const [newClienteId, setNewClienteId] = useState('');
  const [newContoId, setNewContoId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImporto, setNewImporto] = useState('');
  const [newMetodo, setNewMetodo] = useState('bonifico');
  const [newCro, setNewCro] = useState('');
  const [newData, setNewData] = useState(new Date().toISOString().slice(0, 10));

  const loadData = async () => {
    setLoading(true);
    setErrore('');
    try {
      const [pnRes, clRes, contiRes] = await Promise.all([
        fetchPrimaNotaApi({
          page,
          limit,
          search: searchDebounced,
          sortBy: 'data',
          sortOrder: 'desc',
          tipo: selectedTipo === 'tutti' ? undefined : selectedTipo,
          metodo: selectedMetodo === 'tutti' ? undefined : selectedMetodo,
        }),
        fetchClienti(),
        fetchContiBancariApi(),
      ]);
      if (!isRispostaPaginata<any>(pnRes)) throw new Error('Risposta Prima Nota non valida');
      setMovimenti(pnRes.data);
      setMeta(pnRes.meta);
      if (pnRes.meta.pagine > 0 && page > pnRes.meta.pagine) setPage(pnRes.meta.pagine);
      setRiepilogo((pnRes.riepilogo as RiepilogoPrimaNota | undefined) || { totaleEntrateCentesimi: 0, totaleUsciteCentesimi: 0, saldoCentesimi: 0 });
      setClienti(clRes || []);
      setContiBancari(contiRes || []);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Errore caricamento Prima Nota');
      setMovimenti([]);
      console.warn('Errore caricamento Prima Nota:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchDebounced(searchTerm.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  useEffect(() => {
    loadData();
  }, [page, limit, searchDebounced, selectedTipo, selectedMetodo]);

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) return;

    setSubmitting(true);
    try {
      const res = await importCsvPrimaNotaApi(csvContent, newContoId || undefined);
      setShowCsvModal(false);
      setCsvContent('');
      await loadData();
      toast.successo(`${res.importati || 'Tutti i'} movimenti bancari importati e riconciliati con successo nel database!`);
    } catch (err: any) {
      toast.errore(`Errore importazione CSV: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMovimento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newImporto || !newDesc) return;

    const importoCentesimi = Math.round(parseFloat(newImporto) * 100);
    setSubmitting(true);
    try {
      await createPrimaNotaApi({
        contoBancarioId: newContoId || undefined,
        clienteId: newClienteId || undefined,
        tipo: newTipo,
        categoria: newCategoria,
        descrizione: newDesc,
        importoCentesimi,
        metodoPagamento: newMetodo,
        riferimentoTransazione: newCro || undefined,
        data: newData,
      });

      setShowAddModal(false);
      setNewDesc('');
      setNewImporto('');
      setNewCro('');
      await loadData();
    } catch (err: any) {
      toast.errore(`Errore creazione movimento: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMovimento = async (id: string) => {
    if (!(await confirm({ messaggio: 'Sei sicuro di voler eliminare questa registrazione dalla Prima Nota?', confermaLabel: 'Elimina', pericolo: true }))) return;
    try {
      await deletePrimaNotaApi(id);
      await loadData();
    } catch (err: any) {
      toast.errore(`Errore eliminazione: ${err.message}`);
    }
  };

  // Metriche
  const totalEntrateCent = riepilogo.totaleEntrateCentesimi;
  const totalUsciteCent = riepilogo.totaleUsciteCentesimi;
  const saldoPeriodoCent = riepilogo.saldoCentesimi;

  const filteredMovimenti = movimenti;

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Prima Nota & Movimenti Cassa/Banca</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Registro cronologico ufficiale delle transazioni finanziarie collegate al conto ed alle fatture
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowCsvModal(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            📥 Importa Estratto Conto (CSV)
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowExportModal(true)}
            style={{ padding: '10px 18px', fontWeight: 700 }}
          >
            📦 Esporta Fascicolo Commercialista (ZIP)
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            + Nuova Registrazione
          </button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: '2rem' }}>
        <div style={{ background: 'var(--pill-green-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-green-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Totale Incassi (Entrate)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-green-fg)', marginTop: 8 }}>+ {fmt(totalEntrateCent / 100)}</div>
        </div>
        <div style={{ background: 'var(--pill-red-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-red-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Totale Spese / Uscite</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-red-fg)', marginTop: 8 }}>- {fmt(totalUsciteCent / 100)}</div>
        </div>
        <div style={{ background: saldoPeriodoCent >= 0 ? 'var(--pill-blue-bg)' : 'var(--pill-amber-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: saldoPeriodoCent >= 0 ? 'var(--pill-blue-fg)' : 'var(--pill-amber-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Saldo Netto Periodo</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pill-blue-fg)', marginTop: 8 }}>💶 {fmt(saldoPeriodoCent / 100)}</div>
        </div>
        <div style={{ background: 'var(--card)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Movimenti Registrati</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>📊 {meta.totale}</div>
        </div>
      </div>

      {/* FILTRI & TABELLA */}
      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cerca per descrizione, cliente o CRO/TRN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 200 }}
          />
          <select
            value={selectedTipo}
            onChange={(e) => { setSelectedTipo(e.target.value); setPage(1); }}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 160 }}
          >
            <option value="tutti">Tutti i tipi</option>
            <option value="entrata">Solo Entrate (+)</option>
            <option value="uscita">Solo Uscite (-)</option>
          </select>
          <select
            value={selectedMetodo}
            onChange={(e) => { setSelectedMetodo(e.target.value); setPage(1); }}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 160 }}
          >
            <option value="tutti">Tutti i metodi</option>
            <option value="bonifico">Bonifico Bancario</option>
            <option value="carta">Carta di Credito</option>
            <option value="contanti">Contanti</option>
            <option value="assegno">Assegno</option>
          </select>
        </div>

        {errore && <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' }}>{errore}</div>}
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento Prima Nota a database...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Data</th>
                <th style={{ padding: '12px 8px' }}>Tipo</th>
                <th style={{ padding: '12px 8px' }}>Descrizione / Causale</th>
                <th style={{ padding: '12px 8px' }}>Cliente / Controparte</th>
                <th style={{ padding: '12px 8px' }}>Conto / Metodo</th>
                <th style={{ padding: '12px 8px' }}>CRO / Riferimento</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Importo</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovimenti.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessuna registrazione trovata in Prima Nota.
                  </td>
                </tr>
              ) : (
                filteredMovimenti.map((m) => {
                  const isEntrata = m.tipo === 'entrata';
                  const dataStr = m.data ? new Date(m.data).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT');
                  const clNome = m.cliente?.nome || (m.fattura?.cliente?.nome) || '—';
                  const contoNome = m.contoBancario?.nomeConto || 'Cassa / Predefinito';

                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 8px', color: 'var(--muted)', fontSize: 13 }}>{dataStr}</td>
                      <td style={{ padding: '14px 8px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            background: isEntrata ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
                            color: isEntrata ? 'var(--pill-green-fg)' : 'var(--pill-red-fg)',
                          }}
                        >
                          {isEntrata ? 'ENTRATA' : 'USCITA'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px', fontWeight: 600 }}>
                        {m.descrizione}
                        {m.fattura?.numero && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--primary)', background: 'var(--pill-blue-bg)', padding: '2px 6px', borderRadius: 4 }}>
                            {m.fattura.numero}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 8px', color: 'var(--text)' }}>{clNome}</td>
                      <td style={{ padding: '14px 8px', fontSize: 13 }}>
                        <div>{contoNome}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{m.metodoPagamento || 'bonifico'}</div>
                      </td>
                      <td style={{ padding: '14px 8px', fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>
                        {m.riferimentoTransazione || '—'}
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'right', fontWeight: 700, color: isEntrata ? 'var(--green)' : 'var(--pill-red-fg)' }}>
                        {isEntrata ? '+' : '-'} {fmt((m.importoCentesimi || 0) / 100)}
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteMovimento(m.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--red)',
                            fontSize: 14,
                          }}
                          title="Elimina movimento"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
        <Paginatore
          meta={meta}
          onPageChange={setPage}
          onLimitChange={(nuovoLimite) => { setLimit(nuovoLimite); setPage(1); }}
        />
      </div>

      {/* MODAL NUOVA REGISTRAZIONE */}
      {showAddModal && (
        <Modal onClose={() => setShowAddModal(false)} zIndex={1000} overlayBackground="rgba(0,0,0,0.7)" labelledBy="prima-nota-add-titolo">
          {(richiediChiusura) => (
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 520, border: '1px solid var(--border)' }}>
            <h3 id="prima-nota-add-titolo" style={{ margin: '0 0 1.5rem 0' }}>Nuova Registrazione Prima Nota</h3>
            <form onSubmit={handleAddMovimento} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo Movimento</label>
                  <select
                    value={newTipo}
                    onChange={(e: any) => setNewTipo(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="entrata">Entrata (+)</option>
                    <option value="uscita">Uscita (-)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria</label>
                  <select
                    value={newCategoria}
                    onChange={(e) => setNewCategoria(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="incasso_fattura">Incasso Fattura</option>
                    <option value="pagamento_fornitore">Fornitore</option>
                    <option value="imposta_tasse">Tasse/F24</option>
                    <option value="stipendi_compensi">Compensi</option>
                    <option value="spese_generali">Spese Studio</option>
                    <option value="altro">Altro</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data</label>
                  <input
                    type="date"
                    value={newData}
                    onChange={(e) => setNewData(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione / Causale Operazione *</label>
                <input
                  type="text"
                  required
                  placeholder="Es. Incasso acconto parcella consulenza..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo (€) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="1500.00"
                    value={newImporto}
                    onChange={(e) => setNewImporto(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Metodo Pagamento</label>
                  <select
                    value={newMetodo}
                    onChange={(e) => setNewMetodo(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="bonifico">Bonifico Bancario</option>
                    <option value="carta">Carta di Credito</option>
                    <option value="contanti">Contanti</option>
                    <option value="assegno">Assegno</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cliente Collegato (Opzionale)</label>
                  <select
                    value={newClienteId}
                    onChange={(e) => setNewClienteId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="">Nessuno / Spesa interna</option>
                    {clienti.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Conto Corrente / Cassa</label>
                  <select
                    value={newContoId}
                    onChange={(e) => setNewContoId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="">Conto Predefinito Studio</option>
                    {contiBancari.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.nomeConto} ({cb.banca})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CRO / Riferimento Transazione (Opzionale)</label>
                <input
                  type="text"
                  placeholder="Es. TRN-2026-987654321"
                  value={newCro}
                  onChange={(e) => setNewCro(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={richiediChiusura}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {submitting ? 'Salvataggio...' : 'Registra in Prima Nota'}
                </button>
              </div>
            </form>
          </div>
          )}
        </Modal>
      )}

      {/* MODAL IMPORT CSV */}
      {showCsvModal && (
        <Modal onClose={() => setShowCsvModal(false)} zIndex={1000} overlayBackground="rgba(0,0,0,0.7)" labelledBy="prima-nota-csv-titolo">
          {(richiediChiusura) => (
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 600, border: '1px solid var(--border)' }}>
            <h3 id="prima-nota-csv-titolo" style={{ margin: '0 0 8px 0' }}>Importazione Estratto Conto Bancario (CSV)</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1rem 0' }}>
              Incolla il testo del tracciato CSV bancario. Formato supportato: <code>Data;Descrizione/Causale;Importo;CRO/TRN</code>.
            </p>

            <form onSubmit={handleImportCsv} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Conto Bancario di Destinazione</label>
                <select
                  value={newContoId}
                  onChange={(e) => setNewContoId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Conto Predefinito Studio</option>
                  {contiBancari.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.nomeConto} ({cb.banca})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Dati CSV</label>
                <textarea
                  required
                  rows={8}
                  placeholder={`2026-09-01;Bonifico da Alpha Corp parcella 1;5000.00;TRN123456789\n2026-09-02;Acquisto cancelleria e server;-150.00;TRN987654321`}
                  value={csvContent}
                  onChange={(e) => setCsvContent(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={richiediChiusura}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {submitting ? 'Importazione in corso...' : 'Importa e Riconcilia'}
                </button>
              </div>
            </form>
          </div>
          )}
        </Modal>
      )}

      {/* MODAL EXPORT FASCICOLO COMMERICALISTA ZIP */}
      <EsportaFascicoloCommercialistaModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
