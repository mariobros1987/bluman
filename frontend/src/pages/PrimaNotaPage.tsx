import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScadenzarioIncassiApi, fetchClienti } from '../api/client';
import { fmt } from '../utils';

export function PrimaNotaPage() {
  const navigate = useNavigate();
  const [scadenze, setScadenze] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMetodo, setSelectedMetodo] = useState('tutti');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal Nuova Registrazione Prima Nota
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClienteId, setNewClienteId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImporto, setNewImporto] = useState('');
  const [newMetodo, setNewMetodo] = useState('bonifico');
  const [newCro, setNewCro] = useState('');

  const handleAddMovimento = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newImporto || !newDesc) return;
    const importoCentesimi = Math.round(parseFloat(newImporto) * 100);
    const cl = clienti.find(c => c.id === newClienteId);

    const newScad = {
      id: `pn-${Date.now()}`,
      numeroRata: 1,
      dataScadenza: new Date().toISOString(),
      importoCentesimi,
      stato: 'incassato',
      fattura: {
        numero: 'FT-MANUALE',
        progetto: {
          id: '1',
          nome: newDesc,
          cliente: { nome: cl?.nome || 'Cliente Generico' },
        },
      },
      registrazioniRegistrate: [
        {
          importoIncassatoCentesimi: importoCentesimi,
          metodoPagamento: newMetodo,
          riferimentoTransazione: newCro || 'CRO-MANUALE',
          dataIncasso: new Date().toISOString(),
        },
      ],
    };

    setScadenze([newScad, ...scadenze]);
    setShowAddModal(false);
    setNewDesc('');
    setNewImporto('');
    setNewCro('');
    alert('✓ Nuova registrazione aggiunta con successo in Prima Nota!');
  };

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

  // Filtriamo solo i movimenti effettivamente incassati in prima nota
  const incassiSaldate = scadenze.filter(s => s.stato === 'incassato' || (s.registrazioniRegistrate && s.registrazioniRegistrate.length > 0));

  const totalIncassatoEffettivo = incassiSaldate.reduce((acc, s) => {
    const regTot = s.registrazioniRegistrate?.reduce((ra: number, rb: any) => ra + rb.importoIncassatoCentesimi, 0);
    return acc + (regTot || s.importoCentesimi || 0);
  }, 0);

  const filteredIncassi = incassiSaldate.filter(s => {
    const reg = s.registrazioniRegistrate?.[0];
    if (selectedMetodo !== 'tutti' && reg?.metodoPagamento !== selectedMetodo) return false;
    const searchString = `${s.fattura?.numero} ${s.fattura?.progetto?.cliente?.nome} ${s.fattura?.progetto?.nome} ${reg?.riferimentoTransazione || ''}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Registro Prima Nota & Movimenti Cassa/Banca</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Storico contabile ufficiale delle entrate ed incassi registrati con codice di transazione CRO/TRN
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
        >
          ➕ Nuova Registrazione Prima Nota
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: '#064e3b', padding: 20, borderRadius: 12, border: '1px solid #047857' }}>
          <div style={{ fontSize: 12, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Totale Incassato Registrato in Prima Nota</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>✓ {fmt(totalIncassatoEffettivo / 100)}</div>
        </div>
      </div>

      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cerca per CRO, fattura, cliente o progetto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 200 }}
          />

          <select
            value={selectedMetodo}
            onChange={(e) => setSelectedMetodo(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 220 }}
          >
            <option value="tutti">Tutti i Metodi di Pagamento</option>
            <option value="bonifico">Bonifico Bancario</option>
            <option value="carta">POS / Carta di Credito</option>
            <option value="stripe">Stripe Gateway</option>
            <option value="assegno">Assegno</option>
            <option value="contanti">Contanti</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento registro prima nota...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Data Incasso</th>
                <th style={{ padding: '12px 8px' }}>Fattura / Riferimento</th>
                <th style={{ padding: '12px 8px' }}>Cliente / Progetto Collegato</th>
                <th style={{ padding: '12px 8px' }}>Metodo / CRO</th>
                <th style={{ padding: '12px 8px' }}>Importo Incassato</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Stato Contabile</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncassi.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessun movimento di prima nota registrato.
                  </td>
                </tr>
              ) : (
                filteredIncassi.map((scad) => {
                  const reg = scad.registrazioniRegistrate?.[0];
                  const importoIncassato = reg ? reg.importoIncassatoCentesimi / 100 : scad.importoCentesimi / 100;
                  const dataIncasso = reg?.dataIncasso ? new Date(reg.dataIncasso).toLocaleDateString() : new Date().toLocaleDateString();
                  const projectId = scad.fattura?.progetto?.id || '1';

                  return (
                    <tr key={scad.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 8px', fontWeight: 600 }}>
                        📅 {dataIncasso}
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
                      <td style={{ padding: '16px 8px' }}>
                        <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>💳 {reg?.metodoPagamento || 'bonifico'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{reg?.riferimentoTransazione || 'CRO Non specificato'}</div>
                      </td>
                      <td style={{ padding: '16px 8px', fontWeight: 700, fontSize: 15, color: '#6ee7b7' }}>
                        + € {fmt(importoIncassato)}
                      </td>
                      <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                        <span style={{ padding: '4px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#064e3b', color: '#6ee7b7' }}>
                          ✓ Registrato
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL NUOVA REGISTRAZIONE PRIMA NOTA */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddMovimento} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>Nuova Registrazione Movimento Prima Nota</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Cliente / Anagrafica *</label>
              <select
                required
                value={newClienteId}
                onChange={(e) => setNewClienteId(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              >
                <option value="">Seleziona Cliente...</option>
                {clienti.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Descrizione Movimento *</label>
              <input
                type="text"
                required
                placeholder="es. Incasso Acconto Consulenza Legale Malta"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Importo (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="2500"
                  value={newImporto}
                  onChange={(e) => setNewImporto(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Metodo di Pagamento</label>
                <select
                  value={newMetodo}
                  onChange={(e) => setNewMetodo(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">POS / Carta di Credito</option>
                  <option value="stripe">Stripe Gateway</option>
                  <option value="assegno">Assegno</option>
                  <option value="contanti">Contanti</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Codice CRO / TRN Transazione</label>
              <input
                type="text"
                placeholder="es. CRO 9876543210"
                value={newCro}
                onChange={(e) => setNewCro(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="submit"
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--indigo)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
              >
                ✓ Registra in Prima Nota
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
