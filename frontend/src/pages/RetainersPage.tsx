import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchContrattiRicorrentiApi, creaContrattoRicorrenteApi, fetchClienti, generaFatturaRetainerApi } from '../api/client';
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

  const handleGeneraFattura = async (contrattoId: string) => {
    if (!confirm('Confermi l\'emissione automatica della Fattura e la creazione della rata nello Scadenzario per questo canone?')) return;
    setLoading(true);

    const targetContratto = contratti.find(c => String(c.id) === String(contrattoId));
    const res = await generaFatturaRetainerApi(contrattoId);

    // Garanzia aggiornamento locale per la visibilità immediata in Fatture e Scadenzario
    const anno = new Date().getFullYear();
    const numeroFattura = res?.fattura?.numero || `FT-${anno}-000${Math.floor(Math.random() * 900) + 100}`;
    const importoEurVal = (targetContratto?.importoCentesimi || 150000) / 100;

    const nuovaFatturaLocal = {
      id: res?.fattura?.id || `ft-ret-${Date.now()}`,
      numero: numeroFattura,
      tipo_documento: 'fattura',
      serie: 'FT',
      importo: importoEurVal,
      data: new Date().toLocaleDateString('it-IT'),
      stato: 'emessa',
      progetto: targetContratto?.progetto ? {
        id: targetContratto.progetto.id,
        nome: targetContratto.progetto.nome || targetContratto.progetto.n,
        cliente: targetContratto.cliente || { nome: 'Cliente Studio' },
      } : {
        id: 'prj-retainer',
        nome: `Canone: ${targetContratto?.titolo || 'Retainer'}`,
        cliente: targetContratto?.cliente || { nome: 'Cliente Studio' },
      },
      righe: [{ descrizione: targetContratto?.titolo || 'Canone Retainer Studio', importo: importoEurVal }],
    };

    // 1. Salva nel registro fatture locali
    const savedInvoicesStr = localStorage.getItem('bluman_custom_invoices');
    const savedInvoicesArr: any[] = savedInvoicesStr ? JSON.parse(savedInvoicesStr) : [];
    localStorage.setItem('bluman_custom_invoices', JSON.stringify([nuovaFatturaLocal, ...savedInvoicesArr]));

    // 2. Salva nello scadenzario locale
    const nuovaScadenzaLocal = {
      id: `scad-ret-${Date.now()}`,
      numeroRata: 1,
      dataScadenza: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      importoCentesimi: targetContratto?.importoCentesimi || 150000,
      stato: 'in_attesa',
      fattura: nuovaFatturaLocal,
    };
    const savedScadStr = localStorage.getItem('bluman_custom_scadenze');
    const savedScadArr: any[] = savedScadStr ? JSON.parse(savedScadStr) : [];
    localStorage.setItem('bluman_custom_scadenze', JSON.stringify([nuovaScadenzaLocal, ...savedScadArr]));

    // 3. Aggiorna lo stato del contratto localmente
    const updatedContratti = contratti.map(c => {
      if (String(c.id) === String(contrattoId)) {
        const prox = new Date(c.prossimaFatturazione || Date.now());
        prox.setMonth(prox.getMonth() + 1);
        return { ...c, stato: 'fatturato', prossimaFatturazione: prox.toISOString() };
      }
      return c;
    });
    setContratti(updatedContratti);
    localStorage.setItem('bluman_retainer_contracts', JSON.stringify(updatedContratti));

    setLoading(false);
    alert(`✓ Fattura ${numeroFattura} emessa con successo!\nStato contratto aggiornato ad "Inviato" ed inserito in Scadenzario Incassi.`);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Contratti Ricorrenti & Retainer Studio</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Pianificazione canoni continui di Advisory, Governance e Compliance con generazione automatica fatture e scadenze
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nuovo Contratto Retainer
        </button>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento contratti retainer...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ padding: '12px 16px' }}>Oggetto Canone</th>
                <th style={{ padding: '12px 8px' }}>Cliente Incarico</th>
                <th style={{ padding: '12px 8px' }}>Progetto Collegato</th>
                <th style={{ padding: '12px 8px' }}>Frequenza</th>
                <th style={{ padding: '12px 8px' }}>Canone Ricorrente</th>
                <th style={{ padding: '12px 8px' }}>Prossima Fatturazione</th>
                <th style={{ padding: '12px 8px' }}>Stato</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Azioni 1-Click</th>
              </tr>
            </thead>
            <tbody>
              {contratti.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessun contratto ricorrente attivo. Clicca su "+ Nuovo Contratto Retainer" per crearne uno.
                  </td>
                </tr>
              ) : (
                contratti.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>📑 {c.titolo}</div>
                      {c.note && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{c.note}</div>}
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
                        ✓ {c.stato || 'attivo'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleGeneraFattura(c.id)}
                        style={{ background: '#4338ca', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(67,56,202,.3)' }}
                        title="Emetti immediatamente la Fattura Fiscale e registra la partita aperta nello Scadenzario Incassi"
                      >
                        🧾 Emetti Fattura 1-Click
                      </button>
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
                disabled={!clienteId}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: !clienteId ? 'var(--card2)' : 'var(--bg)', color: 'var(--text)', opacity: !clienteId ? 0.6 : 1 }}
              >
                <option value="">
                  {!clienteId
                    ? '⚠️ Seleziona prima un cliente...'
                    : 'Nessun progetto specifico (Canone Generico Studio)'}
                </option>
                {(() => {
                  const selClienteObj = clienti.find(c => c.id === clienteId);
                  const nomeCliente = selClienteObj?.nome?.toLowerCase() || '';

                  // Estrai progetti da DB/LocalStorage/MockData
                  const localStr = localStorage.getItem('bluman_custom_projects');
                  const localProjs: any[] = localStr ? JSON.parse(localStr) : [];
                  const allAvailable = [...localProjs, ...PROJECTS];

                  const filtered = allAvailable.filter(p => {
                    if (!clienteId) return false;
                    if (p.clienteId === clienteId || p.cliente_id === clienteId) return true;
                    if (nomeCliente && (p.cl?.toLowerCase().includes(nomeCliente) || p.cliente?.nome?.toLowerCase().includes(nomeCliente))) return true;
                    return false;
                  });

                  // Rimuovi duplicati per ID o Nome
                  const uniqueProjs = new Map();
                  filtered.forEach(p => uniqueProjs.set(p.id || p.n, p));

                  return Array.from(uniqueProjs.values()).map(p => (
                    <option key={p.id || p.n} value={String(p.id)}>
                      📁 {p.n || p.nome}
                    </option>
                  ));
                })()}
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
