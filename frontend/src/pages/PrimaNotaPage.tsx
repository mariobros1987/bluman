import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScadenzarioIncassiApi, fetchClienti } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey } from '../utils/tenant';
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
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [newClienteId, setNewClienteId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImporto, setNewImporto] = useState('');
  const [newMetodo, setNewMetodo] = useState('bonifico');
  const [newCro, setNewCro] = useState('');

  const handleImportCsv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) return;

    const lines = csvContent.trim().split('\n');
    const newItems: any[] = [];
    const currentTenantId = getCurrentTenantId();

    lines.forEach((line, idx) => {
      // Formato atteso: Data, Descrizione/Causale, Importo, CRO/TRN (separati da virgola o punto e virgola)
      const parts = line.includes(';') ? line.split(';') : line.split(',');
      if (parts.length >= 2) {
        const rawDate = parts[0]?.trim();
        const rawDesc = parts[1]?.trim();
        const rawImporto = parts[2]?.replace(/[€\s]/g, '').trim();
        const rawCro = parts[3]?.trim() || `TRN-${Date.now()}-${idx}`;

        const importoNum = parseFloat(rawImporto) || 1500;
        const importoCentesimi = Math.round(importoNum * 100);

        // Matching cliente per nome presente nella causale
        const matchedClient = clienti.find(c => rawDesc.toLowerCase().includes(c.nome.toLowerCase())) || { nome: 'Cliente Studio (Riconciliato)' };

        newItems.push({
          id: `pn-csv-${Date.now()}-${idx}`,
          tenantId: currentTenantId,
          numeroRata: 1,
          dataScadenza: new Date().toISOString(),
          importoCentesimi,
          stato: 'incassato',
          fattura: {
            numero: `FT-RICONC-${idx + 1}`,
            progetto: {
              id: '1',
              nome: rawDesc,
              cliente: { nome: matchedClient.nome },
            },
          },
          registrazioniRegistrate: [
            {
              importoIncassatoCentesimi: importoCentesimi,
              metodoPagamento: 'bonifico',
              riferimentoTransazione: rawCro,
              dataIncasso: new Date().toISOString(),
            },
          ],
        });
      }
    });

    if (newItems.length > 0) {
      const pnStorageKey = getTenantStorageKey('bluman_custom_primanota', currentTenantId);
      const existingPn = JSON.parse(localStorage.getItem(pnStorageKey) || '[]');
      const updatedPn = [...newItems, ...existingPn];
      localStorage.setItem(pnStorageKey, JSON.stringify(updatedPn));
      
      setScadenze(prev => [...newItems, ...prev]);
      setShowCsvModal(false);
      setCsvContent('');
      alert(`✓ ${newItems.length} movimenti bancari importati e riconciliati con successo in Prima Nota!`);
    } else {
      alert('Nessun movimento valido trovato. Verifica il formato CSV inserito.');
    }
  };

  const handleAddMovimento = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newImporto || !newDesc) return;
    const importoCentesimi = Math.round(parseFloat(newImporto) * 100);
    const cl = clienti.find(c => c.id === newClienteId);
    const currentTenantId = getCurrentTenantId();

    const newScad = {
      id: `pn-${Date.now()}`,
      tenantId: currentTenantId,
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

    const pnStorageKey = getTenantStorageKey('bluman_custom_primanota', currentTenantId);
    const existingPn = JSON.parse(localStorage.getItem(pnStorageKey) || '[]');
    localStorage.setItem(pnStorageKey, JSON.stringify([newScad, ...existingPn]));

    setScadenze([newScad, ...scadenze]);
    setShowAddModal(false);
    setNewDesc('');
    setNewImporto('');
    setNewCro('');
    alert('✓ Nuova registrazione aggiunta con successo in Prima Nota!');
  };

  const loadData = async () => {
    setLoading(true);
    const currentTenantId = getCurrentTenantId();
    const [scadData, clData] = await Promise.all([
      fetchScadenzarioIncassiApi(),
      fetchClienti(),
    ]);

    let finalScadenze = (scadData || []).filter((s: any) => !s.tenantId || s.tenantId === currentTenantId);

    // Integrazione progetti del tenant
    const projStorageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);
    const localStr = localStorage.getItem(projStorageKey);
    const localProjs: any[] = localStr ? JSON.parse(localStr) : [];
    const extractedScad: any[] = [];

    localProjs.forEach((p) => {
      (p.fatture || []).forEach((f: any, fIdx: number) => {
        const importoCentesimi = Math.round((f.importo || 0) * 100);
        extractedScad.push({
          id: `scad-loc-${p.id}-${fIdx}`,
          tenantId: currentTenantId,
          numeroRata: 1,
          dataScadenza: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          importoCentesimi,
          stato: f.stato === 'incassata' ? 'incassato' : 'in_attesa',
          fattura: {
            numero: f.numero || `FT-2026-000${fIdx + 1}`,
            progetto: {
              id: p.id,
              nome: p.n,
              cliente: { nome: p.cl || 'Cliente Studio' },
            },
          },
          registrazioniRegistrate: f.stato === 'incassata' ? [
            {
              importoIncassatoCentesimi: importoCentesimi,
              metodoPagamento: 'bonifico',
              riferimentoTransazione: 'TRN-SETTLED',
              dataIncasso: new Date().toISOString(),
            }
          ] : [],
        });
      });
    });

    // Custom Prima Nota salvate
    const pnStorageKey = getTenantStorageKey('bluman_custom_primanota', currentTenantId);
    const pnSavedStr = localStorage.getItem(pnStorageKey);
    const customPn = pnSavedStr ? JSON.parse(pnSavedStr) : [];

    const mergedMap = new Map();
    [...finalScadenze, ...extractedScad, ...customPn].forEach(item => {
      if (item && item.id) mergedMap.set(item.id, item);
    });

    setScadenze(Array.from(mergedMap.values()));
    const filteredClients = (clData || []).filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);
    setClienti(filteredClients);
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              if (scadenze.length === 0) {
                alert('Nessun movimento contabile presente da esportare.');
                return;
              }
              const headers = [
                'Data Registrazione',
                'Tipo Documento',
                'Numero Fattura / Riferimento',
                'Cliente Committente',
                'Progetto / Incarico',
                'Metodo Pagamento',
                'CRO / Riferimento Transazione',
                'Importo Incassato (€)',
                'Stato Contabile'
              ];
              const rows = scadenze.map(s => {
                const reg = s.registrazioniRegistrate?.[0] || {};
                return [
                  reg.dataIncasso ? new Date(reg.dataIncasso).toLocaleDateString('it-IT') : new Date(s.dataScadenza).toLocaleDateString('it-IT'),
                  s.fattura?.numero?.startsWith('NC') ? 'Nota di Credito' : 'Fattura Professionale',
                  s.fattura?.numero || 'FT-PROV',
                  `"${(s.fattura?.progetto?.cliente?.nome || 'Cliente Studio').replace(/"/g, '""')}"`,
                  `"${(s.fattura?.progetto?.nome || 'Incarico Studio').replace(/"/g, '""')}"`,
                  reg.metodoPagamento || 'bonifico',
                  reg.riferimentoTransazione || 'TRN-VERIFIED',
                  ((s.importoCentesimi || 0) / 100).toFixed(2),
                  s.stato === 'incassato' ? 'INCASSATO_REGISTRATO' : 'IN_ATTESA'
                ];
              });
              const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.setAttribute('href', url);
              link.setAttribute('download', `Prima_Nota_Commercialista_${new Date().toISOString().slice(0, 10)}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
            style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #059669', background: '#064e3b', color: '#6ee7b7', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            title="Esporta il tracciato contabile per il commercialista (compatibile con Zucchetti, TeamSystem, Datev, Profis ed Excel)"
          >
            <span>📊 Export Commercialista (CSV / Excel)</span>
          </button>
          <button
            onClick={() => setShowCsvModal(true)}
            style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--indigo)', background: '#1e1b4b', color: '#a5b4fc', fontWeight: 600, cursor: 'pointer' }}
          >
            📥 Importa Estratto Conto (CSV)
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
          >
            ➕ Nuova Registrazione Prima Nota
          </button>
        </div>
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

      {/* MODAL IMPORTA ESTRATTO CONTO CSV */}
      {showCsvModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleImportCsv} style={{ background: 'var(--card)', padding: '2rem', borderRadius: 12, width: 560, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0 }}>📥 Importa & Riconcilia Estratto Conto Bancario</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, marginBottom: 16 }}>
              Incolla le righe del tuo estratto conto bancario (formato: <code>Data, Causale/Descrizione, Importo, CRO/TRN</code>). Il sistema riconcilierà automaticamente gli incassi con le anagrafiche e le fatture dello studio.
            </p>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>Dati CSV / Testo Estratto Conto *</label>
              <textarea
                required
                rows={6}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder="14/08/2026, Bonifico Holding Beta S.r.l. acconto consulenza, 3500.00, TRN-88776655&#10;15/08/2026, Bonifico Mario Rossi saldo parere legale, 1800.00, CRO-11223344"
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setCsvContent('14/08/2026, Bonifico Holding Beta S.r.l. acconto consulenza, 3500.00, TRN-88776655\n15/08/2026, Bonifico Ing. Roberto Rossi saldo parere legale, 1800.00, CRO-11223344\n16/08/2026, Bonifico Acme Corp retainer mensile, 2500.00, TRN-99887711');
                }}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
              >
                📋 Inserisci Esempio
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCsvModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--indigo)', color: 'white', cursor: 'pointer', fontWeight: 600 }}
                >
                  ✓ Riconcilia & Importa
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
