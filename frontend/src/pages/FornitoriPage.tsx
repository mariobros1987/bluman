import React, { useState, useEffect } from 'react';
import type { Fornitore, FatturaRicevuta } from '../api/fornitori';
import {
  fetchFornitoriApi,
  eliminaFornitoreApi,
  fetchFattureRicevuteApi,
} from '../api/fornitori';
import { NuovoFornitoreModal } from '../components/fornitori/NuovoFornitoreModal';
import { RegistraFatturaPassivaModal } from '../components/fornitori/RegistraFatturaPassivaModal';
import { PagaFatturaPassivaModal } from '../components/fornitori/PagaFatturaPassivaModal';

export const FornitoriPage: React.FC = () => {
  const [tab, setTab] = useState<'fatture' | 'fornitori'>('fatture');
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [fatture, setFatture] = useState<FatturaRicevuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [ricerca, setRicerca] = useState('');
  const [filtroStato, setFiltroStato] = useState<'tutti' | 'da_pagare' | 'pagata'>('tutti');

  // Modali
  const [isNuovoFornitoreOpen, setIsNuovoFornitoreOpen] = useState(false);
  const [fornitoreInModifica, setFornitoreInModifica] = useState<Fornitore | null>(null);
  const [isRegistraFatturaOpen, setIsRegistraFatturaOpen] = useState(false);
  const [fatturaDaPagare, setFatturaDaPagare] = useState<FatturaRicevuta | null>(null);

  const caricaDati = async () => {
    setLoading(true);
    try {
      const [fornitoriRes, fattureRes] = await Promise.all([
        fetchFornitoriApi(),
        fetchFattureRicevuteApi(),
      ]);
      setFornitori(fornitoriRes);
      setFatture(fattureRes);
    } catch (err) {
      console.error('Errore caricamento dati ciclo passivo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    caricaDati();
  }, []);

  const handleEliminaFornitore = async (fornitore: Fornitore) => {
    if (!window.confirm(`Sei sicuro di voler eliminare il fornitore "${fornitore.ragioneSociale}"?`)) {
      return;
    }
    try {
      await eliminaFornitoreApi(fornitore.id);
      await caricaDati();
    } catch (err: any) {
      alert(err?.message || 'Errore eliminazione fornitore.');
    }
  };

  // KPI Calculations
  const totaleAcquistiCentesimi = fatture.reduce((acc, f) => acc + f.totaleCentesimi, 0);
  const totaleDaSaldareCentesimi = fatture
    .filter((f) => !f.pagata)
    .reduce((acc, f) => acc + f.totaleCentesimi, 0);
  const totaleSaldatoCentesimi = fatture
    .filter((f) => f.pagata)
    .reduce((acc, f) => acc + f.totaleCentesimi, 0);

  // Filtri Fatture
  const fattureFiltrate = fatture.filter((f) => {
    const matchRicerca =
      f.numero.toLowerCase().includes(ricerca.toLowerCase()) ||
      (f.fornitore?.ragioneSociale || '').toLowerCase().includes(ricerca.toLowerCase());
    if (!matchRicerca) return false;

    if (filtroStato === 'da_pagare') return !f.pagata;
    if (filtroStato === 'pagata') return f.pagata;
    return true;
  });

  // Filtri Fornitori
  const fornitoriFiltrati = fornitori.filter((f) => {
    return (
      f.ragioneSociale.toLowerCase().includes(ricerca.toLowerCase()) ||
      (f.partitaIva || '').toLowerCase().includes(ricerca.toLowerCase()) ||
      (f.citta || '').toLowerCase().includes(ricerca.toLowerCase())
    );
  });

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
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
            <span>🏢</span> Ciclo Passivo & Fornitori ERP
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Gestione anagrafica fornitori, registro fatture d'acquisto, import XML FatturaPA 1.2 e uscite Prima Nota.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFornitoreInModifica(null);
              setIsNuovoFornitoreOpen(true);
            }}
          >
            + Nuovo Fornitore
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsRegistraFatturaOpen(true)}
          >
            📥 Registra / Importa Fattura Passiva
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid var(--primary)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Fornitori in Anagrafica
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '4px' }}>
            {fornitori.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Partner e fornitori registrati</div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Totale Spese / Acquisti
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#3b82f6', marginTop: '4px' }}>
            €{(totaleAcquistiCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{fatture.length} fatture passive registrate</div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Fatture da Saldare
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b', marginTop: '4px' }}>
            €{(totaleDaSaldareCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {fatture.filter((f) => !f.pagata).length} documenti aperti
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            Fatture Saldate
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
            €{(totaleSaldatoCentesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Regolarmente registrate in uscita</div>
        </div>
      </div>

      {/* Main Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '2px solid var(--border)',
          marginBottom: '20px',
          gap: '8px',
        }}
      >
        <button
          type="button"
          onClick={() => setTab('fatture')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'transparent',
            fontWeight: tab === 'fatture' ? 700 : 500,
            color: tab === 'fatture' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: tab === 'fatture' ? '3px solid var(--primary)' : '3px solid transparent',
            marginBottom: '-2px',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          📥 Registro Fatture d'Acquisto ({fatture.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('fornitori')}
          style={{
            padding: '12px 20px',
            border: 'none',
            background: 'transparent',
            fontWeight: tab === 'fornitori' ? 700 : 500,
            color: tab === 'fornitori' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: tab === 'fornitori' ? '3px solid var(--primary)' : '3px solid transparent',
            marginBottom: '-2px',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          🏢 Anagrafica Fornitori ({fornitori.length})
        </button>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          className="input-field"
          placeholder={tab === 'fatture' ? 'Cerca per numero fattura o fornitore...' : 'Cerca per ragione sociale, P.IVA, città...'}
          value={ricerca}
          onChange={(e) => setRicerca(e.target.value)}
          style={{ maxWidth: '380px', flex: 1 }}
        />

        {tab === 'fatture' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className={`btn btn-sm ${filtroStato === 'tutti' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFiltroStato('tutti')}
            >
              Tutte ({fatture.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroStato === 'da_pagare' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFiltroStato('da_pagare')}
            >
              Da Saldare ({fatture.filter((f) => !f.pagata).length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroStato === 'pagata' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFiltroStato('pagata')}
            >
              Saldate ({fatture.filter((f) => f.pagata).length})
            </button>
          </div>
        )}
      </div>

      {/* Content Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          Caricamento dati ciclo passivo in corso...
        </div>
      ) : tab === 'fatture' ? (
        fattureFiltrate.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}
          >
            <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '12px' }}>📥</span>
            <h3>Nessuna fattura d'acquisto trovata</h3>
            <p style={{ margin: '0 0 16px 0' }}>Registra una nuova spesa fornitore o importa un file XML FatturaPA 1.2.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsRegistraFatturaOpen(true)}
            >
              + Registra Fattura Passiva
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                  <th style={{ padding: '12px 16px' }}>Numero Documento</th>
                  <th style={{ padding: '12px 16px' }}>Data</th>
                  <th style={{ padding: '12px 16px' }}>Fornitore</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Imponibile</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>IVA</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Totale</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Stato Saldo</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {fattureFiltrate.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                      {f.numero}
                      {f.xmlSdiRaw && (
                        <span
                          style={{
                            marginLeft: '6px',
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(59, 130, 246, 0.15)',
                            color: '#3b82f6',
                          }}
                        >
                          SDI XML
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {new Date(f.data).toLocaleDateString('it-IT')}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600 }}>{f.fornitore?.ragioneSociale || '—'}</div>
                      {f.fornitore?.partitaIva && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          P.IVA: {f.fornitore.partitaIva}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      €{(f.imponibileCentesimi / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      €{(f.ivaCentesimi / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                      €{(f.totaleCentesimi / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {f.pagata ? (
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                          }}
                        >
                          ✓ Saldata
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#f59e0b',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                          }}
                        >
                          ⏳ Da Saldare
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {!f.pagata && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => setFatturaDaPagare(f)}
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
        )
      ) : fornitoriFiltrati.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}
        >
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '12px' }}>🏢</span>
          <h3>Nessun fornitore registrato</h3>
          <p style={{ margin: '0 0 16px 0' }}>Aggiungi il tuo primo fornitore per associare le fatture passive.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFornitoreInModifica(null);
              setIsNuovoFornitoreOpen(true);
            }}
          >
            + Aggiungi Fornitore
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', fontSize: '0.85rem' }}>
                <th style={{ padding: '12px 16px' }}>Ragione Sociale</th>
                <th style={{ padding: '12px 16px' }}>P.IVA / CF</th>
                <th style={{ padding: '12px 16px' }}>Sede & Città</th>
                <th style={{ padding: '12px 16px' }}>Contatti & SDI</th>
                <th style={{ padding: '12px 16px', textAlign: 'center' }}>Fatture Collegate</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {fornitoriFiltrati.map((forn) => (
                <tr key={forn.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                    {forn.ragioneSociale}
                    {forn.iban && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        IBAN: {forn.iban}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                    {forn.partitaIva && <div>P.IVA: {forn.partitaIva}</div>}
                    {forn.codiceFiscale && <div style={{ color: 'var(--text-muted)' }}>CF: {forn.codiceFiscale}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {forn.indirizzo ? `${forn.indirizzo}, ` : ''}
                    {forn.citta ? `${forn.citta} (${forn.cap || ''})` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>
                    {forn.email && <div>✉️ {forn.email}</div>}
                    {forn.pec && <div style={{ color: 'var(--primary)' }}>🔒 {forn.pec}</div>}
                    {forn.sdiCode && <div style={{ color: 'var(--text-muted)' }}>SDI: {forn.sdiCode}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: 'var(--bg-secondary)',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      {forn._count?.fattureRicevute || 0}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setFornitoreInModifica(forn);
                          setIsNuovoFornitoreOpen(true);
                        }}
                      >
                        ✏️ Modifica
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleEliminaFornitore(forn)}
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

      {/* Modali */}
      <NuovoFornitoreModal
        isOpen={isNuovoFornitoreOpen}
        onClose={() => setIsNuovoFornitoreOpen(false)}
        onSuccess={() => caricaDati()}
        fornitoreDaModificare={fornitoreInModifica}
      />

      <RegistraFatturaPassivaModal
        isOpen={isRegistraFatturaOpen}
        onClose={() => setIsRegistraFatturaOpen(false)}
        onSuccess={() => caricaDati()}
        fornitori={fornitori}
        onOpenNuovoFornitore={() => {
          setIsRegistraFatturaOpen(false);
          setFornitoreInModifica(null);
          setIsNuovoFornitoreOpen(true);
        }}
      />

      <PagaFatturaPassivaModal
        isOpen={!!fatturaDaPagare}
        onClose={() => setFatturaDaPagare(null)}
        onSuccess={() => caricaDati()}
        fattura={fatturaDaPagare}
      />
    </div>
  );
};
export default FornitoriPage;
