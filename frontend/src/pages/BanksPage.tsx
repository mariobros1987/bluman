import React, { useState, useEffect } from 'react';
import { fetchContiBancariApi, creaContoBancarioApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';
import { fmt } from '../utils';

export function BanksPage() {
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
    const currentTenantId = getCurrentTenantId();
    const data = await fetchContiBancariApi();
    const apiConti = (data || []).filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);

    const bankStorageKey = getTenantStorageKey('bluman_custom_banks', currentTenantId);
    const saved = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');

    let finalConti = [...apiConti, ...saved];

    if (finalConti.length === 0) {
      if (currentTenantId === BLUECODE_TENANT_ID) {
        finalConti = [
          {
            id: 'bank-01',
            tenantId: BLUECODE_TENANT_ID,
            nomeConto: 'Conto Operativo Malta (EUR)',
            banca: 'Bank of Valletta plc',
            iban: 'MT89VALL22013000000012345678',
            bicSwift: 'VALLMTM1',
            saldoAttuale: 18540000,
            isDefault: true,
          }
        ];
      }
    }

    setConti(finalConti);
    setLoading(false);
  };

  useEffect(() => {
    loadConti();
  }, []);

  const totalLiquiditaCentesimi = conti.reduce((acc, c) => acc + (c.saldoAttuale || 0), 0);

  const handleCreateConto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeConto || !banca) return;
    setSubmitting(true);
    const currentTenantId = getCurrentTenantId();

    const saldoNum = parseFloat(saldoInizialeEur) || 0;
    const saldoCentesimi = Math.round(saldoNum * 100);

    const newConto = {
      id: `bank-${Date.now()}`,
      tenantId: currentTenantId,
      nomeConto,
      banca,
      iban,
      bicSwift,
      saldoAttuale: saldoCentesimi,
      isDefault,
    };

    const bankStorageKey = getTenantStorageKey('bluman_custom_banks', currentTenantId);
    const saved = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
    localStorage.setItem(bankStorageKey, JSON.stringify([newConto, ...saved]));

    // §3.3 — local-first: il conto è subito disponibile su questo dispositivo, ma l'alert
    // deve dire com'è andata la sincronizzazione col server (prima: "aggiunto" sempre).
    try {
      await creaContoBancarioApi({
        nomeConto,
        banca,
        iban,
        bicSwift,
        saldoInizialeEur: saldoNum,
        isDefault,
      });
      alert('✓ Conto Bancario / Cassa aggiunto con successo e sincronizzato col server dello studio!');
    } catch (err: any) {
      alert(`Conto "${nomeConto}" salvato in LOCALE ma NON sincronizzato col server: ${err?.message || 'errore di rete'}. Sarà visibile solo su questo dispositivo finché la sincronizzazione non andrà a buon fine.`);
    } finally {
      setSubmitting(false);
    }

    setModalOpen(false);
    setNomeConto('');
    setBanca('');
    setIban('');
    setBicSwift('');
    setSaldoInizialeEur('');
    setIsDefault(false);
    loadConti();
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>🏦 Banche, Conti Correnti & Cassa Studio</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Monitoraggio in tempo reale della liquidità, IBAN aziendali e riconciliazione movimenti di cassa
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
        >
          ➕ Aggiungi Conto / Cassa
        </button>
      </div>

      {/* KPI Liquidità Complessiva Studio */}
      <div style={{ background: '#064e3b', padding: 24, borderRadius: 12, border: '1px solid #047857', marginBottom: '2rem' }}>
        <div style={{ fontSize: 12, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>
          Totale Liquidità Disponibile (Tutti i Conti & Cassa)
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'white', marginTop: 8 }}>
          💶 {fmt(totalLiquiditaCentesimi / 100)}
        </div>
      </div>

      {/* Grid Schede Conti Correnti */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {loading ? (
          <div style={{ padding: '2rem', color: 'var(--muted)' }}>Caricamento conti bancari...</div>
        ) : (
          conti.map((conto) => {
            const saldoEur = (conto.saldoAttuale || 0) / 100;
            return (
              <div
                key={conto.id}
                style={{
                  background: 'var(--card)',
                  borderRadius: 12,
                  padding: '1.5rem',
                  border: conto.isDefault ? '2px solid var(--indigo-l)' : '1px solid var(--border)',
                  position: 'relative',
                }}
              >
                {conto.isDefault && (
                  <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--indigo)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                    PREDEFINITO FATTURA
                  </span>
                )}
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{conto.nomeConto}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{conto.banca}</div>

                <div style={{ margin: '16px 0', padding: '12px', background: 'var(--bg)', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: 'var(--indigo-l)' }}>
                  IBAN: {conto.iban || 'N/D (Cassa / Gateway)'}<br />
                  BIC/SWIFT: {conto.bicSwift || 'N/D'}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Saldo Attuale</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#6ee7b7' }}>€ {fmt(saldoEur)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL NUOVO CONTO BANCARIO */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleCreateConto} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Aggiungi Nuovo Conto Corrente o Cassa</h3>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Nome Identificativo Conto *</label>
              <input
                type="text"
                required
                placeholder="es. Unicredit c/c Operativo"
                value={nomeConto}
                onChange={(e) => setNomeConto(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Banca / Istituto di Credito *</label>
              <input
                type="text"
                required
                placeholder="es. Unicredit S.p.A."
                value={banca}
                onChange={(e) => setBanca(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Coordinate IBAN</label>
              <input
                type="text"
                placeholder="IT99 C030 6902 1001 0000 0012 345"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>BIC / SWIFT</label>
                <input
                  type="text"
                  placeholder="UNCRITM1"
                  value={bicSwift}
                  onChange={(e) => setBicSwift(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Saldo Iniziale (€)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="50000"
                  value={saldoInizialeEur}
                  onChange={(e) => setSaldoInizialeEur(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <label htmlFor="isDefault" style={{ fontSize: 12, cursor: 'pointer' }}>Imposta come conto predefinito per il pagamento delle fatture</label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--indigo)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
              >
                {submitting ? 'Salvataggio...' : '✓ Salva Conto'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
