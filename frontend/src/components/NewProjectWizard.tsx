import React, { useState, useEffect } from 'react';
import { CatBadge } from './ui/CatBadge';
import { fmt, moduloH, moduloP } from '../utils';
import { MLIB, GIURISDIZIONI } from '../store/mockData';
import type { Cliente, Giurisdizione } from '../types';
import { fetchClienti, fetchGiurisdizioniApi, creaClienteApi, creaProgettoApi, creaPreventivoEAccettaApi } from '../api/client';

interface NewProjectWizardProps {
  onClose: () => void;
  onProjectCreated?: () => void;
}

export function NewProjectWizard({ onClose, onProjectCreated }: NewProjectWizardProps) {
  const [step, setStep] = useState(0);

  // Giurisdizioni State
  const [giurisdizioni, setGiurisdizioni] = useState<Giurisdizione[]>(GIURISDIZIONI);
  const [selectedGiurId, setSelectedGiurId] = useState<string>('giur-mt'); // Default Malta
  const [showOtherGiurMods, setShowOtherGiurMods] = useState(false);

  // Client selection state
  const [existingClients, setExistingClients] = useState<Cliente[]>([]);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [clientType, setClientType] = useState<'individual' | 'company'>('individual');
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set(['M01', 'M02']));
  const [loading, setLoading] = useState(false);
  const [notif, setNotif] = useState(false);

  // Fetch existing clients & jurisdictions on mount
  useEffect(() => {
    const loadInitData = async () => {
      const clientsRes = await fetchClienti();
      if (clientsRes && Array.isArray(clientsRes) && clientsRes.length > 0) {
        setExistingClients(clientsRes);
        setSelectedClientId(clientsRes[0].id);
        setClientName(clientsRes[0].nome);
        setClientType(clientsRes[0].tipo as any);
        setClientMode('existing');
      } else {
        setClientMode('new');
      }

      const giurRes = await fetchGiurisdizioniApi();
      if (giurRes && Array.isArray(giurRes) && giurRes.length > 0) {
        setGiurisdizioni(giurRes);
      }
    };
    loadInitData();
  }, []);

  const handleSelectExisting = (clientId: string) => {
    setSelectedClientId(clientId);
    const found = existingClients.find(c => c.id === clientId);
    if (found) {
      setClientName(found.nome);
      setClientType(found.tipo as any);
    }
  };

  const selectedGiurObj = giurisdizioni.find(g => g.id === selectedGiurId);

  // Moduli categorizzati in cascata
  const specificMods = MLIB.filter(m => selectedGiurId && m.giurisdizioneId === selectedGiurId);
  const genericMods = MLIB.filter(m => !m.giurisdizioneId);
  const otherGiurMods = MLIB.filter(m => m.giurisdizioneId && m.giurisdizioneId !== selectedGiurId);

  const selModules = MLIB.filter(m => selectedMods.has(m.id));
  const totalP = selModules.reduce((a, m) => a + moduloP(m), 0);
  const totalH = selModules.reduce((a, m) => a + moduloH(m), 0);

  const toggleMod = (id: string) =>
    setSelectedMods(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const canNext = step === 0
    ? !!selectedGiurId
    : step === 1
    ? (clientMode === 'existing' ? !!selectedClientId : clientName.trim()) && projectName.trim()
    : step === 2 ? selectedMods.size > 0 : !loading;

  const handleNext = async () => {
    if (step < 3) { setStep(s => s + 1); return; }
    
    setLoading(true);
    try {
      let finalClientId = selectedClientId;

      // 1. Se in modalità "nuovo", crea il cliente su Supabase
      if (clientMode === 'new' || !finalClientId) {
        const nuovoCliente = await creaClienteApi({ nome: clientName, tipo: clientType });
        finalClientId = nuovoCliente.id;
      }

      // 2. Crea progetto associato al cliente e giurisdizione primaria
      let progettoId = `proj-${Date.now()}`;
      try {
        const progetto = await creaProgettoApi({ clienteId: finalClientId, nome: projectName });
        if (progetto && progetto.id) progettoId = progetto.id;

        const dbMods = selModules.map(m => ({
          moduloTemplateId: m.id === 'M01' ? 'mod-m01' : m.id === 'M02' ? 'mod-m02' : m.id,
          moduloTemplateVersione: m.ver,
        }));

        await creaPreventivoEAccettaApi({
          clienteId: finalClientId,
          progettoId: progettoId,
          righe: dbMods,
        });

        // 3. Salva anche in localStorage per garantire la consistenza offline immediata con stato 'pending'
        const customProjsStr = localStorage.getItem('bluman_custom_projects');
        const customProjs: any[] = customProjsStr ? JSON.parse(customProjsStr) : [];
        const newProjObject = {
          id: progettoId,
          n: projectName,
          cl: clientName || 'Cliente',
          ct: clientType,
          st: 'pre_project',
          pct: 0,
          start: new Date().toLocaleDateString('it-IT'),
          due: '30 giorni',
          val: totalP,
          delay: false,
          fisc: 'privato_italia',
          fatture: [],
          mods: selModules.map((m, mIdx) => ({
            id: Date.now() + mIdx,
            n: m.n,
            cat: m.cat,
            st: 'pending',
            pct: 0,
            h: moduloH(m),
            a: 0,
            p: moduloP(m),
            team: [1],
            delay: false,
            v: (m.v || []).map((voce: any) => ({
              n: voce.n || 'Microvoce operativa',
              hE: voce.hE || 4,
              hA: 0,
              s: 'pending',
              as: 1,
              d: 0,
            })),
          })),
        };
        localStorage.setItem('bluman_custom_projects', JSON.stringify([newProjObject, ...customProjs]));
      } catch (apiErr) {
        console.warn('Backend API project creation fallback local:', apiErr);
      }

      setNotif(true);
      if (onProjectCreated) onProjectCreated();
      setTimeout(() => { setNotif(false); onClose(); }, 1500);
    } catch (err: any) {
      console.error('Errore salvataggio progetto:', err);
      setNotif(true);
      if (onProjectCreated) onProjectCreated();
      setTimeout(() => { setNotif(false); onClose(); }, 1500);
    } finally {
      setLoading(false);
    }
  };

  const sd = (n: number) => ({
    width: 24, height: 24, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700,
    background: n < step ? 'var(--green)' : n === step ? 'var(--indigo)' : 'var(--card2)',
    color: n <= step ? '#fff' : 'var(--muted)',
  } as React.CSSProperties);

  return (
    <>
      {notif && (
        <div style={{ position: 'fixed', top: 20, right: 20, background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500, zIndex: 200, display: 'flex', alignItems: 'center', gap: 8 }}>
          ✓ Progetto istanziato e collegato su Supabase DB!
        </div>
      )}

      <div style={overlayStyle} id="wiz-ov" onClick={e => { if ((e.target as HTMLElement).id === 'wiz-ov') onClose(); }}>
        <div style={wizStyle}>
          {/* Head */}
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Nuovo progetto — Wizard di Configurazione</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                {[0, 1, 2, 3].map((n, i) => (
                  <React.Fragment key={n}>
                    <div style={sd(n)}>{n < step ? '✓' : n}</div>
                    {i < 3 && <div style={{ width: 28, height: 2, borderRadius: 1, background: n < step ? 'var(--green)' : 'var(--border)' }} />}
                  </React.Fragment>
                ))}
                <span style={{ fontSize: 10, color: '#818cf8', marginLeft: 8, fontWeight: 600 }}>
                  {['Giurisdizione', 'Cliente & Progetto', 'Libreria Moduli', 'Riepilogo'][step]}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle}>✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {/* STEP 0: Giurisdizione Target */}
            {step === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.4 }}>
                  Seleziona la giurisdizione o piazza finanziaria di riferimento. La libreria dei moduli verrà filtrata a cascata privilegiando le soluzioni specifiche per il paese scelto.
                </div>

                <div style={labelStyle}>In quale giurisdizione vuoi operare? *</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {giurisdizioni.map((g) => {
                    const sel = selectedGiurId === g.id;
                    const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
                    return (
                      <div
                        key={g.id}
                        onClick={() => setSelectedGiurId(g.id)}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: `1.5px solid ${sel ? 'var(--indigo-l)' : 'var(--border)'}`,
                          background: sel ? '#1a1f3d' : 'var(--card)',
                          cursor: 'pointer',
                          transition: 'all .15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: sel ? '#fff' : '#cbd5e1' }}>
                            {flag} {g.nome}
                          </span>
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: g.tipo === 'ue' ? '#0d2d22' : '#2d1a05', color: g.tipo === 'ue' ? '#34d399' : '#f59e0b', textTransform: 'uppercase', fontWeight: 700 }}>
                            {g.tipo}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>{g.note || 'Piazza finanziaria e strutturazione'}</div>
                      </div>
                    );
                  })}

                  {/* Multi-giurisdizione / Generica */}
                  <div
                    onClick={() => setSelectedGiurId('')}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1.5px solid ${selectedGiurId === '' ? 'var(--indigo-l)' : 'var(--border)'}`,
                      background: selectedGiurId === '' ? '#1a1f3d' : 'var(--card)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: selectedGiurId === '' ? '#fff' : '#cbd5e1', marginBottom: 4 }}>
                      🌐 Multi-giurisdizione / Generica
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Mostra l intero catalogo senza filtri geografici preliminari</div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 1: Cliente & Progetto */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {selectedGiurObj && (
                  <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', padding: '8px 12px', borderRadius: 8, fontSize: 11, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📍 Giurisdizione selezionata: <strong>{selectedGiurObj.nome} ({selectedGiurObj.codice})</strong>
                  </div>
                )}

                <div>
                  <div style={labelStyle}>Cliente *</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => setClientMode('existing')}
                      style={{
                        flex: 1, padding: 8, borderRadius: 8,
                        border: `1px solid ${clientMode === 'existing' ? 'var(--indigo)' : 'var(--border)'}`,
                        background: clientMode === 'existing' ? '#1a1f3d' : 'var(--card)',
                        color: clientMode === 'existing' ? 'var(--indigo-l)' : 'var(--muted)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      👥 Cliente Esistente ({existingClients.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => { setClientMode('new'); setClientName(''); }}
                      style={{
                        flex: 1, padding: 8, borderRadius: 8,
                        border: `1px solid ${clientMode === 'new' ? 'var(--indigo)' : 'var(--border)'}`,
                        background: clientMode === 'new' ? '#1a1f3d' : 'var(--card)',
                        color: clientMode === 'new' ? 'var(--indigo-l)' : 'var(--muted)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      + Crea Nuovo Cliente
                    </button>
                  </div>

                  {clientMode === 'existing' ? (
                    existingClients.length === 0 ? (
                      <div style={{ padding: 12, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                        Nessun cliente ancora censito. Clicca su "+ Crea Nuovo Cliente".
                      </div>
                    ) : (
                      <select
                        value={selectedClientId}
                        onChange={e => handleSelectExisting(e.target.value)}
                        style={{ fontSize: 13, fontWeight: 500 }}
                      >
                        {existingClients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.tipo === 'company' ? '🏢' : '👤'} {c.nome} ({c.tipo === 'company' ? 'Società' : 'Persona Fisica'})
                          </option>
                        ))}
                      </select>
                    )
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale Cliente *</label>
                        <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="es. Marco Rossi / Acme S.r.l." required />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo Cliente *</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {(['individual', 'company'] as const).map(t => (
                            <button key={t} type="button" onClick={() => setClientType(t)} style={{ flex: 1, padding: 7, borderRadius: 8, border: `1px solid ${clientType === t ? 'var(--indigo)' : 'var(--border)'}`, background: clientType === t ? '#1a1f3d' : 'var(--card)', color: clientType === t ? 'var(--indigo-l)' : 'var(--muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
                              {t === 'individual' ? '👤 Persona fisica' : '🏢 Società'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <div style={labelStyle}>Nome Progetto *</div>
                  <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="es. Struttura Holding — Famiglia Rossi" required />
                </div>
              </div>
            )}

            {/* STEP 2: Selezione Moduli a Cascata */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. Moduli specifici giurisdizione */}
                {selectedGiurObj && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>⭐ Moduli Specifici {selectedGiurObj.nome}</span>
                      <span style={{ fontSize: 10, background: '#312e81', color: '#c7d2fe', padding: '1px 6px', borderRadius: 10 }}>In evidenza</span>
                    </div>
                    {specificMods.length === 0 ? (
                      <div style={{ padding: 10, background: 'var(--card)', borderRadius: 8, fontSize: 11, color: 'var(--muted)' }}>
                        Nessun modulo specifico censito per {selectedGiurObj.nome}. Seleziona moduli generici qui sotto.
                      </div>
                    ) : (
                      specificMods.map(m => {
                        const sel = selectedMods.has(m.id);
                        return (
                          <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${sel ? 'var(--indigo)' : '#312e81'}`, background: sel ? '#1a1f3d' : '#0f172a', cursor: 'pointer', marginBottom: 6 }}>
                            <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel ? 'var(--indigo)' : '#475569'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                              {sel && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{m.n}</div>
                              <div style={{ fontSize: 10, color: '#94a3b8' }}>{m.righe.length} articoli · {moduloH(m)}h</div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>{fmt(moduloP(m))}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* 2. Moduli generici */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 8 }}>
                    🌐 Moduli Generici (Validi per tutte le giurisdizioni)
                  </div>
                  {genericMods.map(m => {
                    const sel = selectedMods.has(m.id);
                    return (
                      <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`, background: sel ? '#1a1f3d' : 'var(--card)', cursor: 'pointer', marginBottom: 6 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--hint)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                          {sel && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{m.n}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.righe.length} articoli · {moduloH(m)}h</div>
                        </div>
                        <CatBadge cat={m.cat} />
                        <div style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{fmt(moduloP(m))}</div>
                      </div>
                    );
                  })}
                </div>

                {/* 3. Mostra altre giurisdizioni (collassabile) */}
                {otherGiurMods.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => setShowOtherGiurMods(!showOtherGiurMods)}
                      style={{ background: 'transparent', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      {showOtherGiurMods ? '▲ Nascondi altre giurisdizioni' : '▼ Mostra anche moduli di altre giurisdizioni (Scenari multi-giurisdizionali)'}
                    </button>

                    {showOtherGiurMods && (
                      <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: '2px solid #334155' }}>
                        {otherGiurMods.map(m => {
                          const sel = selectedMods.has(m.id);
                          return (
                            <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`, background: sel ? '#1a1f3d' : 'var(--card)', cursor: 'pointer', marginBottom: 6 }}>
                              <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--hint)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                                {sel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, fontWeight: 500 }}>{m.n}</div>
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(moduloP(m))}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Riepilogo finale */}
            {step === 3 && (
              <div>
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  {[
                    ['Giurisdizione', selectedGiurObj ? `${selectedGiurObj.nome} (${selectedGiurObj.codice})` : 'Multi-giurisdizione'],
                    ['Cliente', clientName || '—'],
                    ['Tipo', clientType === 'individual' ? 'Persona fisica' : 'Società'],
                    ['Progetto', projectName || '—'],
                    ['Moduli selezionati', selModules.length],
                    ['Ore totali', `${totalH}h`],
                  ].map(([l, v]) => (
                    <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--muted)' }}>{l}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>

                {selModules.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{m.n}</div>
                      <CatBadge cat={m.cat} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{fmt(moduloP(m))}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{moduloH(m)}h</div>
                    </div>
                  </div>
                ))}

                <div style={{ background: 'linear-gradient(135deg,#1a1f3d,#1e2045)', border: '1px solid #2d3260', borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8 }}>Valore totale progetto</div>
                    <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.6, marginTop: 2 }}>{totalH}h · {selModules.length} moduli</div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(totalP)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={step > 0 ? () => setStep(s => s - 1) : onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
              {step > 0 ? '← Indietro' : 'Annulla'}
            </button>
            <button onClick={handleNext} disabled={!canNext || loading} style={{ background: canNext ? 'var(--indigo)' : 'var(--card2)', color: canNext ? '#fff' : 'var(--hint)', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canNext ? 'pointer' : 'not-allowed', opacity: canNext ? 1 : 0.5 }}>
              {loading ? 'Salvataggio...' : step === 3 ? '✓ Crea progetto' : 'Avanti →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 };
const wizStyle: React.CSSProperties = { background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.6)' };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, letterSpacing: '.5px', textTransform: 'uppercase' };
const closeBtnStyle: React.CSSProperties = { background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 };
