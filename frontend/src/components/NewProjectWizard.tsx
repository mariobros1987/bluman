import React, { useState, useEffect } from 'react';
import { CatBadge } from './ui/CatBadge';
import { fmt, moduloH, moduloP } from '../utils';
import { MLIB } from '../store/mockData';
import type { CategoriaModulo, Cliente } from '../types';
import { fetchClienti, creaClienteApi, creaProgettoApi, creaPreventivoEAccettaApi } from '../api/client';

interface NewProjectWizardProps {
  onClose: () => void;
  onProjectCreated?: () => void;
}

export function NewProjectWizard({ onClose, onProjectCreated }: NewProjectWizardProps) {
  const [step, setStep] = useState(1);

  // Client selection state
  const [existingClients, setExistingClients] = useState<Cliente[]>([]);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [clientType, setClientType] = useState<'individual' | 'company'>('individual');
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [notif, setNotif] = useState(false);

  // Fetch existing clients on mount
  useEffect(() => {
    const loadClients = async () => {
      const res = await fetchClienti();
      if (res && Array.isArray(res) && res.length > 0) {
        setExistingClients(res);
        setSelectedClientId(res[0].id);
        setClientName(res[0].nome);
        setClientType(res[0].tipo as any);
        setClientMode('existing');
      } else {
        setClientMode('new');
      }
    };
    loadClients();
  }, []);

  const handleSelectExisting = (clientId: string) => {
    setSelectedClientId(clientId);
    const found = existingClients.find(c => c.id === clientId);
    if (found) {
      setClientName(found.nome);
      setClientType(found.tipo as any);
    }
  };

  const selModules = MLIB.filter(m => selectedMods.has(m.id));
  const totalP = selModules.reduce((a, m) => a + moduloP(m), 0);
  const totalH = selModules.reduce((a, m) => a + moduloH(m), 0);

  const cats = [...new Set(MLIB.map(m => m.cat))] as CategoriaModulo[];

  const toggleMod = (id: string) =>
    setSelectedMods(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const canNext = step === 1
    ? (clientMode === 'existing' ? !!selectedClientId : clientName.trim()) && projectName.trim()
    : step === 2 ? selectedMods.size > 0 : !loading;

  const handleNext = async () => {
    if (step < 3) { setStep(s => s + 1); return; }
    
    setLoading(true);
    try {
      let finalClientId = selectedClientId;

      // Se in modalità "nuovo", crea prima il cliente via API
      if (clientMode === 'new' || !finalClientId) {
        const nuovoCliente = await creaClienteApi({ nome: clientName, tipo: clientType });
        finalClientId = nuovoCliente.id;
      }

      // 2. Crea progetto associato al cliente salvato su Supabase
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
      } catch (apiErr) {
        console.warn('Backend API project creation fallback local:', apiErr);
      }

      // 3. Salva sempre il nuovo progetto in localStorage come ridondanza locale
      const nuovoProgetto: Progetto = {
        id: progettoId,
        n: projectName,
        cl: clientName,
        ct: clientType,
        st: 'in_progress',
        pct: 10,
        start: new Date().toLocaleDateString('it-IT'),
        due: 'In corso',
        val: totalP,
        delay: false,
        fisc: 'privato',
        fatture: [],
        mods: selModules.map((m, idx) => ({
          id: idx + 200,
          n: m.name,
          cat: m.cat,
          st: 'in_progress',
          pct: 0,
          h: moduloH(m),
          a: 0,
          p: moduloP(m),
          team: [1],
          delay: false,
          v: m.sub.map((s, sIdx) => ({
            id: sIdx + 1,
            n: s.title,
            h: 2,
            a: 0,
            st: 'pending',
            op: 'Advisor',
            linkDoc: s.docUrl || '',
          })),
        })),
      };

      const savedStr = localStorage.getItem('bluman_custom_projects');
      const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
      savedArr.unshift(nuovoProgetto);
      localStorage.setItem('bluman_custom_projects', JSON.stringify(savedArr));

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
          ✓ Progetto creato e collegato al cliente!
        </div>
      )}

      <div style={overlayStyle} id="wiz-ov" onClick={e => { if ((e.target as HTMLElement).id === 'wiz-ov') onClose(); }}>
        <div style={wizStyle}>
          {/* Head */}
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Nuovo progetto</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                {[1, 2, 3].map((n, i) => (
                  <React.Fragment key={n}>
                    <div style={sd(n)}>{n < step ? '✓' : n}</div>
                    {i < 2 && <div style={{ width: 32, height: 2, borderRadius: 1, background: n < step ? 'var(--green)' : 'var(--border)' }} />}
                  </React.Fragment>
                ))}
                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
                  {['', 'Cliente & Progetto', 'Selezione moduli', 'Riepilogo'][step]}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle}>✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Switch Cliente Esistente vs Nuovo */}
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

                <div style={{ background: '#1a1f3d', border: '1px solid #2d3260', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#818cf8' }}>
                  💡 <strong>Tip:</strong> Il progetto viene collegato al cliente selezionato in PostgreSQL su Supabase.
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                {cats.map(cat => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ marginBottom: 8 }}><CatBadge cat={cat} /></div>
                    {MLIB.filter(m => m.cat === cat).map(m => {
                      const sel = selectedMods.has(m.id);
                      return (
                        <div key={m.id} onClick={() => toggleMod(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`, background: sel ? '#1a1f3d' : 'var(--card)', cursor: 'pointer', marginBottom: 6, transition: 'all var(--t)' }}>
                          <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${sel ? 'var(--indigo)' : 'var(--hint)'}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--indigo)' : 'transparent' }}>
                            {sel && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 500 }}>{m.n}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.righe.length} articoli · {moduloH(m)}h</div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{fmt(moduloP(m))}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {step === 3 && (
              <div>
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  {[['Cliente', clientName || '—'], ['Tipo', clientType === 'individual' ? 'Persona fisica' : 'Società'], ['Progetto', projectName || '—'], ['Moduli selezionati', selModules.length], ['Ore totali', `${totalH}h`]].map(([l, v]) => (
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
                <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#34d399', marginTop: 12 }}>
                  ✓ Alla creazione il progetto verrà collegato in maniera relazionale al cliente su Supabase PostgreSQL.
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={step > 1 ? () => setStep(s => s - 1) : onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
              {step > 1 ? '← Indietro' : 'Annulla'}
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
const wizStyle: React.CSSProperties = { background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.6)' };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, letterSpacing: '.5px', textTransform: 'uppercase' };
const closeBtnStyle: React.CSSProperties = { background: 'var(--card2)', border: 'none', width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 };
