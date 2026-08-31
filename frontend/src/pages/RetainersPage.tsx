import React, { useState, useEffect } from 'react';
import {
  fetchContrattiRicorrentiApi,
  creaContrattoRicorrenteApi,
  generaFatturaRetainerApi,
  fetchClienti,
  fetchProgetti,
} from '../api/client';
import { fmt } from '../utils';

export function RetainersPage() {
  const [contratti, setContratti] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [progetti, setProgetti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [clienteId, setClienteId] = useState('');
  const [progettoId, setProgettoId] = useState('');
  const [titolo, setTitolo] = useState('');
  const [frequenza, setFrequenza] = useState('mensile');
  const [importoEuro, setImportoEuro] = useState('');
  const [prossimaFatturazione, setProssimaFatturazione] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cData, clData, prData] = await Promise.all([
        fetchContrattiRicorrentiApi(),
        fetchClienti(),
        fetchProgetti(),
      ]);
      setContratti(cData || []);
      setClienti(clData || []);
      setProgetti(prData || []);
    } catch (err) {
      console.warn('Errore lettura contratti retainer:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteId || !titolo || !importoEuro || !prossimaFatturazione) return;
    setSaving(true);
    const importoCentesimi = Math.round(parseFloat(importoEuro) * 100);

    try {
      await creaContrattoRicorrenteApi({
        clienteId,
        progettoId: progettoId || undefined,
        titolo,
        frequenza,
        importoCentesimi,
        prossimaFatturazione,
        note: note || undefined,
      });
      alert('✓ Contratto Ricorrente (Retainer) attivato con successo a database!');
      setShowModal(false);
      setTitolo('');
      setImportoEuro('');
      setProssimaFatturazione('');
      setNote('');
      await loadData();
    } catch (err: any) {
      alert(`Errore creazione contratto: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGeneraFattura = async (contrattoId: string) => {
    if (!confirm('Vuoi generare subito la fattura di questo periodo per il contratto retainer?')) return;
    setGeneratingId(contrattoId);
    try {
      const res = await generaFatturaRetainerApi(contrattoId);
      alert(res.messaggio || '✓ Fattura retainer emessa e inserita nello Scadenzario Incassi!');
      await loadData();
    } catch (err: any) {
      alert(`Errore generazione fattura: ${err.message}`);
    } finally {
      setGeneratingId(null);
    }
  };

  const totalMonthlyRunRateCentesimi = contratti.reduce((acc, c) => {
    const val = c.importoCentesimi || 0;
    if (c.frequenza === 'mensile') return acc + val;
    if (c.frequenza === 'trimestrale') return acc + Math.round(val / 3);
    if (c.frequenza === 'semestrale') return acc + Math.round(val / 6);
    if (c.frequenza === 'annuale') return acc + Math.round(val / 12);
    return acc + val;
  }, 0);

  const filteredProgetti = progettoId ? progetti : progetti.filter((p) => !clienteId || p.clienteId === clienteId);

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>🔄 Contratti Ricorrenti & Retainer Studio</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Pianificazione canoni continuativi di assistenza, fatturazione automatica periodica e scadenzario rate
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
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
          + Nuovo Contratto Retainer
        </button>
      </div>

      {/* KPI Run-Rate */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: '2rem' }}>
        <div style={{ background: '#1e3a8a', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>Monthly Recurring Revenue (MRR)</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'white', marginTop: 8 }}>💶 {fmt(totalMonthlyRunRateCentesimi / 100)} / mese</div>
        </div>
        <div style={{ background: 'var(--card)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Contratti Ricorrenti Attivi</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', marginTop: 8 }}>📄 {contratti.length}</div>
        </div>
      </div>

      {/* Griglia Contratti */}
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento contratti dal database...</div>
      ) : contratti.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔄</div>
          <h3 style={{ margin: '0 0 8px 0' }}>Nessun contratto ricorrente attivo</h3>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 1.5rem 0' }}>
            Attiva contratti di assistenza e retainer mensili o trimestrali per automatizzare l'emissione delle parcelle periodiche.
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            + Crea Primo Retainer
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {contratti.map((c) => (
            <div
              key={c.id}
              style={{
                background: 'var(--card)',
                borderRadius: 14,
                padding: '1.5rem',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{c.titolo}</h3>
                    <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginTop: 4 }}>
                      👤 {c.cliente?.nome || 'Cliente'}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: '#064e3b',
                      color: '#6ee7b7',
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {c.frequenza}
                  </span>
                </div>

                {c.progetto?.nome && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    📁 Progetto: <strong>{c.progetto.nome}</strong>
                  </div>
                )}

                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, margin: '14px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Canone Periodico:</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmt((c.importoCentesimi || 0) / 100)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Prossima Fattura:</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fcd34d' }}>
                      {c.prossimaFatturazione ? new Date(c.prossimaFatturazione).toLocaleDateString('it-IT') : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleGeneraFattura(c.id)}
                  disabled={generatingId === c.id}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#059669',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {generatingId === c.id ? 'Emissione...' : '🚀 Genera Fattura Ora'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Nuovo Retainer */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 520, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 1.5rem 0' }}>Nuovo Contratto Ricorrente (Retainer)</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cliente Committente *</label>
                <select
                  required
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Seleziona cliente...</option>
                  {clienti.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Progetto / Incarico Collegato (Opzionale)</label>
                <select
                  value={progettoId}
                  onChange={(e) => setProgettoId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Nessuno / Retainer Generale Studio</option>
                  {filteredProgetti.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.nome} ({pr.cliente?.nome || 'Cliente'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Contratto / Servizio Continuativo *</label>
                <input
                  type="text"
                  required
                  placeholder="Es. Advisory Continuativa e Gestione Societaria 2026"
                  value={titolo}
                  onChange={(e) => setTitolo(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Frequenza Fatturazione</label>
                  <select
                    value={frequenza}
                    onChange={(e) => setFrequenza(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  >
                    <option value="mensile">Mensile</option>
                    <option value="trimestrale">Trimestrale</option>
                    <option value="semestrale">Semestrale</option>
                    <option value="annuale">Annuale</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canone (€) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="2500.00"
                    value={importoEuro}
                    onChange={(e) => setImportoEuro(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Prima Fatturazione *</label>
                <input
                  type="date"
                  required
                  value={prossimaFatturazione}
                  onChange={(e) => setProssimaFatturazione(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note / Clausole (Opzionale)</label>
                <textarea
                  rows={2}
                  placeholder="Note operative o coordinate del contratto..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {saving ? 'Attivazione...' : 'Attiva Contratto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
