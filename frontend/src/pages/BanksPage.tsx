import React, { useState, useEffect } from 'react';
import { fetchContiBancariApi, creaContoBancarioApi } from '../api/client';
import { fmt } from '../utils';
import { useToast } from '../components/ui/ToastProvider';

export function BanksPage() {
  const toast = useToast();
  const [conti, setConti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Modal Form State
  const [nomeConto, setNomeConto] = useState('');
  const [banca, setBanca] = useState('');
  const [iban, setIban] = useState('');
  const [bicSwift, setBicSwift] = useState('');
  const [saldoInizialeEur, setSaldoInizialeEur] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadConti = async () => {
    setLoading(true);
    try {
      const data = await fetchContiBancariApi();
      setConti(data || []);
    } catch (err) {
      console.warn('Errore lettura conti bancari:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConti();
  }, []);

  const totalLiquiditaCentesimi = conti.reduce((acc, c) => acc + (c.saldoAttuale || 0), 0);

  const handleCreateConto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeConto || !banca) return;
    setSubmitting(true);

    const saldoNum = parseFloat(saldoInizialeEur) || 0;

    try {
      await creaContoBancarioApi({
        nomeConto,
        banca,
        iban,
        bicSwift,
        saldoInizialeEur: saldoNum,
        isDefault,
      });
      toast.successo('Conto Bancario / Cassa aggiunto con successo a database!');
      setModalOpen(false);
      setNomeConto('');
      setBanca('');
      setIban('');
      setBicSwift('');
      setSaldoInizialeEur('');
      setIsDefault(false);
      await loadConti();
    } catch (err: any) {
      toast.errore(`Errore creazione conto: ${err?.message || 'errore di rete'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>🏦 Banche, Conti Correnti & Cassa Studio</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Monitoraggio in tempo reale della liquidità, IBAN aziendali e riconciliazione movimenti di cassa
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
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
          + Nuovo Conto / Cassa
        </button>
      </div>

      {/* KPI Liquidità Totale */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: '2rem' }}>
        <div style={{ background: 'var(--pill-blue-bg)', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--pill-blue-fg)', textTransform: 'uppercase', fontWeight: 600 }}>Liquidità Complessiva Studio</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--pill-blue-fg)', marginTop: 8 }}>💶 {fmt(totalLiquiditaCentesimi / 100)}</div>
        </div>
        <div style={{ background: 'var(--card)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Conti Attivi Registrati</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', marginTop: 8 }}>🏛️ {conti.length}</div>
        </div>
      </div>

      {/* Griglia Conti */}
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento conti bancari dal database...</div>
      ) : conti.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏦</div>
          <h3 style={{ margin: '0 0 8px 0' }}>Nessun conto bancario configurato</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 1.5rem 0' }}>
            Aggiungi i conti correnti o la cassa contanti dello studio per gestire gli accrediti delle fatture e la Prima Nota.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            + Configura Primo Conto
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {conti.map((c) => (
            <div
              key={c.id}
              style={{
                background: 'var(--card)',
                borderRadius: 14,
                padding: '1.5rem',
                border: c.isDefault ? '2px solid var(--primary)' : '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{c.nomeConto}</h3>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.banca}</div>
                  </div>
                  {c.isDefault && (
                    <span style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)', fontSize: 11, fontWeight: 700 }}>
                      PREDEFINITO
                    </span>
                  )}
                </div>

                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, margin: '12px 0' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>IBAN Accredito</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>
                    {c.iban || 'Nessun IBAN registrato'}
                  </div>
                  {c.bicSwift && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      BIC/SWIFT: <code>{c.bicSwift}</code>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Saldo Attuale:</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: (c.saldoAttuale || 0) >= 0 ? 'var(--green)' : 'var(--pill-red-fg)' }}>
                  {fmt((c.saldoAttuale || 0) / 100)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Nuovo Conto */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 500, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 1.5rem 0' }}>Aggiungi Conto Corrente / Cassa Studio</h3>
            <form onSubmit={handleCreateConto} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Conto *</label>
                <input
                  type="text"
                  required
                  placeholder="Es. Conto Operativo Principale"
                  value={nomeConto}
                  onChange={(e) => setNomeConto(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Istituto Bancario / Tipologia *</label>
                <input
                  type="text"
                  required
                  placeholder="Es. Intesa Sanpaolo / Unicredit / Cassa Contanti"
                  value={banca}
                  onChange={(e) => setBanca(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN</label>
                <input
                  type="text"
                  placeholder="IT00X0000000000000000000000"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>BIC / SWIFT</label>
                  <input
                    type="text"
                    placeholder="BCITITMM"
                    value={bicSwift}
                    onChange={(e) => setBicSwift(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Saldo Iniziale (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={saldoInizialeEur}
                    onChange={(e) => setSaldoInizialeEur(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="defaultCheck"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                <label htmlFor="defaultCheck" style={{ fontSize: 13, cursor: 'pointer' }}>
                  Imposta come conto predefinito per l'accredito fatture
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {submitting ? 'Salvataggio...' : 'Crea Conto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
