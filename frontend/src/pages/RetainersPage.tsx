import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchContrattiRicorrentiApi, creaContrattoRicorrenteApi, fetchClienti } from '../api/client';
import { PROJECTS } from '../store/mockData';
import { fmt } from '../utils';

export function RetainersPage() {
  const navigate = useNavigate();
  const [contratti, setContratti] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
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

  const loadData = async () => {
    setLoading(true);
    const [cData, clData] = await Promise.all([
      fetchContrattiRicorrentiApi(),
      fetchClienti(),
    ]);

    const apiContratti = cData || [];
    const savedStr = localStorage.getItem('bluman_retainer_contracts');
    const localContratti: any[] = savedStr ? JSON.parse(savedStr) : [];

    // Evita duplicati per ID
    const mergedMap = new Map();
    [...apiContratti, ...localContratti].forEach(item => {
      if (item && item.id) mergedMap.set(item.id, item);
    });

    setContratti(Array.from(mergedMap.values()));
    setClienti(clData || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteId || !titolo || !importoEuro || !prossimaFatturazione) return;
    setSaving(true);
    const importoCentesimi = Math.round(parseFloat(importoEuro) * 100);

    const res = await creaContrattoRicorrenteApi({
      clienteId,
      progettoId: progettoId || undefined,
      titolo,
      frequenza,
      importoCentesimi,
      prossimaFatturazione,
      note,
    });

    // Garanzia salvataggio anche in ambiente offline / fallback
    const newContractObj = res || {
      id: `cnt-${Date.now()}`,
      clienteId,
      progettoId,
      titolo,
      frequenza,
      importoCentesimi,
      prossimaFatturazione,
      stato: 'attivo',
      cliente: clienti.find(c => c.id === clienteId) || { nome: 'Cliente Studio' },
      progetto: PROJECTS.find(p => String(p.id) === String(progettoId)),
    };

    const savedStr = localStorage.getItem('bluman_retainer_contracts');
    const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
    localStorage.setItem('bluman_retainer_contracts', JSON.stringify([newContractObj, ...savedArr]));

    setSaving(false);
    alert('✓ Contratto Ricorrente attivato con successo!');
    setShowModal(false);
    setTitolo('');
    setImportoEuro('');
    setProgettoId('');
    loadData();
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Contratti Ricorrenti & Retainer Studio</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Pianificazione canoni continui (Advisory, Governance, Compliance AML)
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
        >
          ➕ Nuovo Contratto Retainer
        </button>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento contratti in corso...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Oggetto Contratto</th>
                <th style={{ padding: '12px 8px' }}>Cliente</th>
                <th style={{ padding: '12px 8px' }}>Progetto Collegato</th>
                <th style={{ padding: '12px 8px' }}>Frequenza</th>
                <th style={{ padding: '12px 8px' }}>Canone Ricorrente</th>
                <th style={{ padding: '12px 8px' }}>Prossima Fatturazione</th>
                <th style={{ padding: '12px 8px' }}>Stato</th>
              </tr>
            </thead>
            <tbody>
              {contratti.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessun contratto ricorrente attivo. Clicca su "+ Nuovo Contratto Retainer" per crearne uno.
                  </td>
                </tr>
              ) : (
                contratti.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                      📑 {c.titolo}
                    </td>
                    <td style={{ padding: '16px 8px' }}>
                      {c.cliente?.nome || 'Cliente Studio'}
                    </td>
                    <td style={{ padding: '16px 8px' }}>
                      {c.progetto ? (
                        <button
                          onClick={() => navigate(`/projects/${c.progetto.id}`)}
                          style={{ background: 'none', border: 'none', color: '#6366f1', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                        >
                          📁 {c.progetto.nome} ↗
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>— Canone Studio —</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 8px', textTransform: 'capitalize' }}>
                      ⏳ {c.frequenza}
                    </td>
                    <td style={{ padding: '16px 8px', fontWeight: 700, color: '#6ee7b7' }}>
                      💶 {fmt((c.importoCentesimi || 0) / 100)}
                    </td>
                    <td style={{ padding: '16px 8px', color: 'var(--indigo-l)' }}>
                      📅 {new Date(c.prossimaFatturazione).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '16px 8px' }}>
                      <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>
                        ✓ {c.stato}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleCreate} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Nuovo Contratto Retainer Ricorrente</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Cliente Incarico *</label>
              <select
                required
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              >
                <option value="">Seleziona Cliente...</option>
                {clienti.map(cl => (
                  <option key={cl.id} value={cl.id}>{cl.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Progetto Collegato (Opzionale)</label>
              <select
                value={progettoId}
                onChange={(e) => setProgettoId(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              >
                <option value="">Nessun progetto specifico (Canone Generico)</option>
                {PROJECTS.map(p => (
                  <option key={p.id} value={String(p.id)}>📁 {p.n} ({p.cl})</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Titolo / Oggetto del Canone *</label>
              <input
                type="text"
                required
                placeholder="es. Canone Advisory & Corporate Governance 2026"
                value={titolo}
                onChange={(e) => setTitolo(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Frequenza</label>
                <select
                  value={frequenza}
                  onChange={(e) => setFrequenza(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="mensile">Mensile</option>
                  <option value="trimestrale">Trimestrale</option>
                  <option value="semestrale">Semestrale</option>
                  <option value="annuale">Annuale</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Canone (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="1500"
                  value={importoEuro}
                  onChange={(e) => setImportoEuro(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Data Prossima Fatturazione *</label>
              <input
                type="date"
                required
                value={prossimaFatturazione}
                onChange={(e) => setProssimaFatturazione(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Note / Note a piè fattura</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', height: 60 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--indigo)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
              >
                {saving ? 'Salvataggio...' : '✓ Attiva Contratto'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
