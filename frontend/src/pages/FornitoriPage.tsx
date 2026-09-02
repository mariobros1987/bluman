import React, { useState, useEffect } from 'react';
import type { Fornitore, FatturaRicevuta } from '../api/fornitori';
import {
  fetchFornitoriApi,
  fetchFatturePassiveApi,
  eliminaFornitoreApi,
} from '../api/fornitori';
import { AnagraficaFornitoreErpModal } from '../components/fornitori/AnagraficaFornitoreErpModal';
import { RegistraFatturaPassivaModal } from '../components/fornitori/RegistraFatturaPassivaModal';
import { PagaFatturaPassivaModal } from '../components/fornitori/PagaFatturaPassivaModal';

export const FornitoriPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'fatture' | 'fornitori'>('fatture');
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [fatture, setFatture] = useState<FatturaRicevuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStato, setFilterStato] = useState<'tutte' | 'aperte' | 'saldate'>('tutte');

  // Modali State
  const [isFornitoreModalOpen, setIsFornitoreModalOpen] = useState(false);
  const [fornitoreInModifica, setFornitoreInModifica] = useState<Fornitore | null>(null);

  const [isRegistraFatturaModalOpen, setIsRegistraFatturaModalOpen] = useState(false);

  const [isPagaModalOpen, setIsPagaModalOpen] = useState(false);
  const [fatturaDaPagare, setFatturaDaPagare] = useState<FatturaRicevuta | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [fornData, fattData] = await Promise.all([
        fetchFornitoriApi(),
        fetchFatturePassiveApi(),
      ]);
      setFornitori(fornData || []);
      setFatture(fattData || []);
    } catch (err) {
      console.error('Errore caricamento dati ciclo passivo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEliminaFornitore = async (id: string, nome: string) => {
    if (!confirm(`Sei sicuro di voler eliminare il fornitore "${nome}"?`)) return;
    try {
      await eliminaFornitoreApi(id);
      await loadData();
    } catch (err: any) {
      alert(`Errore: ${err?.message || 'Impossibile eliminare il fornitore'}`);
    }
  };

  // Metriche
  const totaleCostiCent = fatture.reduce((acc, f) => acc + (f.totaleCentesimi || 0), 0);
  const totaleImponibileCent = fatture.reduce((acc, f) => acc + (f.imponibileCentesimi || 0), 0);
  const totaleIvaDetraibileCent = fatture.reduce((acc, f) => acc + (f.ivaCentesimi || 0), 0);
  const totaleSaldatoCent = fatture.filter((f) => f.pagata).reduce((acc, f) => acc + (f.totaleCentesimi || 0), 0);
  const totaleApertoCent = totaleCostiCent - totaleSaldatoCent;

  const filteredFatture = fatture.filter((f) => {
    if (filterStato === 'aperte' && f.pagata) return false;
    if (filterStato === 'saldate' && !f.pagata) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNum = f.numero.toLowerCase().includes(q);
      const matchForn = f.fornitore?.ragioneSociale.toLowerCase().includes(q) || false;
      const matchPiva = f.fornitore?.partitaIva?.toLowerCase().includes(q) || false;
      return matchNum || matchForn || matchPiva;
    }
    return true;
  });

  const filteredFornitori = fornitori.filter((forn) => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNome = forn.ragioneSociale.toLowerCase().includes(q);
      const matchPiva = forn.partitaIva?.toLowerCase().includes(q) || false;
      const matchEmail = forn.email?.toLowerCase().includes(q) || false;
      const matchCitta = forn.citta?.toLowerCase().includes(q) || false;
      return matchNome || matchPiva || matchEmail || matchCitta;
    }
    return true;
  });

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1440px', margin: '0 auto' }}>
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🏢</span> Fornitori, Acquisti & Ciclo Passivo ERP
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Anagrafica fornitori, registrazione fatture passive, import XML SDI, detraibilità IVA e scadenze pagamenti
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFornitoreInModifica(null);
              setIsFornitoreModalOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>+</span> Nuovo Fornitore ERP
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsRegistraFatturaModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>📥</span> Registra / Importa Fattura Passiva
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        <div className="card" style={{ padding: '18px 20px', borderLeft: '4px solid var(--primary)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Totale Acquisti & Costi
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary)', marginTop: '4px' }}>
            €{(totaleCostiCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Imponibile: €{(totaleImponibileCent / 100).toFixed(2)}
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            IVA a Credito Detraibile
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
            €{(totaleIvaDetraibileCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Scorporo IVA acquisti per LIPE
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px', borderLeft: '4px solid #ef4444' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Fatture da Saldare (Aperte)
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ef4444', marginTop: '4px' }}>
            €{(totaleApertoCent / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {fatture.filter((f) => !f.pagata).length} scadenze passive pendenti
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px', borderLeft: '4px solid #6366f1' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Fornitori in Anagrafica
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#6366f1', marginTop: '4px' }}>
            {fornitori.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Anagrafiche con SDI / IBAN
          </div>
        </div>
      </div>

      {/* Main Container with Tabs */}
      <div className="card" style={{ padding: '20px 24px' }}>
        {/* Navigation Switcher & Search Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px' }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'fatture' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('fatture')}
            >
              📥 Registro Fatture d'Acquisto ({fatture.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'fornitori' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('fornitori')}
            >
              🏢 Anagrafica Fornitori ERP ({fornitori.length})
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeTab === 'fatture' && (
              <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${filterStato === 'tutte' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilterStato('tutte')}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                  Tutte
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${filterStato === 'aperte' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilterStato('aperte')}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                  ⏳ Aperte
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${filterStato === 'saldate' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilterStato('saldate')}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                  ✓ Saldate
                </button>
              </div>
            )}

            <input
              type="text"
              className="input-field"
              placeholder="Cerca fornitore, P.IVA, numero fattura..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '280px' }}
            />
          </div>
        </div>

        {/* TAB 1: REGISTRO FATTURE PASSIVE */}
        {activeTab === 'fatture' && (
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Caricamento registro fatture d'acquisto...
              </div>
            ) : filteredFatture.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Nessuna fattura d'acquisto trovata. Clicca su "Registra / Importa Fattura Passiva" per iniziare.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                      <th style={{ padding: '10px 14px' }}>Data</th>
                      <th style={{ padding: '10px 14px' }}>Numero FT</th>
                      <th style={{ padding: '10px 14px' }}>Fornitore</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Imponibile</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>IVA</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Totale</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center' }}>Stato Pagamento</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFatture.map((f) => (
                      <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {new Date(f.data).toLocaleDateString('it-IT')}
                        </td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--primary)' }}>
                          {f.numero}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{f.fornitore?.ragioneSociale || 'Fornitore'}</div>
                          {f.fornitore?.partitaIva && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                              P.IVA {f.fornitore.partitaIva}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          €{(f.imponibileCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                          €{(f.ivaCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, fontSize: '1rem' }}>
                          €{(f.totaleCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          {f.pagata ? (
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#10b981',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                              }}
                            >
                              ✓ Saldata ({f.dataPagamento ? new Date(f.dataPagamento).toLocaleDateString('it-IT') : ''})
                            </span>
                          ) : (
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                              }}
                            >
                              ⏳ Da Saldare
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          {!f.pagata && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                setFatturaDaPagare(f);
                                setIsPagaModalOpen(true);
                              }}
                            >
                              💳 Salda
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ANAGRAFICA FORNITORI ERP */}
        {activeTab === 'fornitori' && (
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Caricamento anagrafiche fornitori...
              </div>
            ) : filteredFornitori.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                Nessun fornitore trovato. Clicca su "+ Nuovo Fornitore ERP".
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                      <th style={{ padding: '10px 14px' }}>Ragione Sociale</th>
                      <th style={{ padding: '10px 14px' }}>P.IVA / Cod. Fiscale</th>
                      <th style={{ padding: '10px 14px' }}>SDI / PEC</th>
                      <th style={{ padding: '10px 14px' }}>Sede</th>
                      <th style={{ padding: '10px 14px' }}>IBAN Pagamento</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFornitori.map((forn) => (
                      <tr
                        key={forn.id}
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onDoubleClick={() => {
                          setFornitoreInModifica(forn);
                          setIsFornitoreModalOpen(true);
                        }}
                      >
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.95rem' }}>
                            {forn.ragioneSociale}
                          </div>
                          {forn.email && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>✉️ {forn.email}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace' }}>
                          <div>{forn.partitaIva || '—'}</div>
                          {forn.codiceFiscale && forn.codiceFiscale !== forn.partitaIva && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{forn.codiceFiscale}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{forn.sdiCode || '0000000'}</div>
                          {forn.pec && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{forn.pec}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div>{forn.citta ? `${forn.citta} (${forn.nazione || 'IT'})` : forn.nazione || 'IT'}</div>
                          {forn.indirizzo && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{forn.indirizzo}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {forn.iban ? forn.iban : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => {
                                setFornitoreInModifica(forn);
                                setIsFornitoreModalOpen(true);
                              }}
                            >
                              ✏️ Scheda ERP
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => handleEliminaFornitore(forn.id, forn.ragioneSociale)}
                              style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              title="Elimina Fornitore"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modale Anagrafica Fornitore ERP */}
      {isFornitoreModalOpen && (
        <AnagraficaFornitoreErpModal
          fornitore={fornitoreInModifica}
          onClose={() => setIsFornitoreModalOpen(false)}
          onSaved={() => {
            loadData();
          }}
        />
      )}

      {/* Modale Registra Fattura Passiva */}
      {isRegistraFatturaModalOpen && (
        <RegistraFatturaPassivaModal
          isOpen={isRegistraFatturaModalOpen}
          onClose={() => setIsRegistraFatturaModalOpen(false)}
          onSuccess={() => {
            loadData();
          }}
          fornitori={fornitori}
        />
      )}

      {/* Modale Salda Fattura */}
      {isPagaModalOpen && (
        <PagaFatturaPassivaModal
          isOpen={isPagaModalOpen}
          onClose={() => setIsPagaModalOpen(false)}
          onSuccess={() => {
            loadData();
          }}
          fattura={fatturaDaPagare}
        />
      )}
    </div>
  );
};
export default FornitoriPage;
