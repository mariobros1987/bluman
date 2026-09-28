import { useState } from 'react';
import { CatBadge } from '../ui/CatBadge';
import { fmt } from '../../utils';
import { creaModuloTemplateApi, aggiornaModuloTemplateApi } from '../../api/client';
import type { Articolo, CategoriaModulo, Giurisdizione, ModuloTemplate } from '../../types';
import { useToast } from '../ui/ToastProvider';

// ─── Componente Costruttore Modulo Template ───────────────────────
export function CreaModuloForm({ articoliList, giurList, moduliList, moduloInModifica, onCreated, onAnnullaModifica }: { articoliList: Articolo[]; giurList: Giurisdizione[]; moduliList?: ModuloTemplate[]; moduloInModifica?: ModuloTemplate | null; onCreated: () => void; onAnnullaModifica?: () => void }) {
  const toast = useToast();
  // §36 — modalità modifica: se arriva un modulo esistente, il costruttore si apre
  // pre-popolato (nome, categoria, giurisdizione, forfait, distinta base e dipendenze) e il
  // salvataggio passa per la PUT invece della POST di creazione.
  const [nome, setNome] = useState(moduloInModifica?.n ?? '');
  const [cat, setCat] = useState<CategoriaModulo>(moduloInModifica?.cat ?? 'Societario');
  const [giurisdizioneId, setGiurisdizioneId] = useState<string>(moduloInModifica?.giurisdizioneId ?? '');
  const [prezzoPkg, setPrezzoPkg] = useState<number | ''>(moduloInModifica?.pkg ?? '');
  const [selectedArts, setSelectedArts] = useState<Array<{ artId: string; qty: number; customPrice?: number }>>(() =>
    (moduloInModifica?.righe ?? []).map(r => ({
      artId: r.art,
      qty: r.qty ?? 1,
      customPrice: r.oP !== undefined ? r.oP : articoliList.find(a => a.id === r.art)?.p,
    }))
  );
  // Dipendenze: i moduli da cui questo dipende (attesa_dipendenza finché non sono `done`).
  // Pre-caricate in modifica; il backend rifiuta i cicli (400).
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(new Set(moduloInModifica?.deps ?? []));
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Moduli fra cui scegliere le dipendenze: tutti gli altri (mai se stesso).
  const moduliDipendibili = (moduliList ?? []).filter(m => m.id !== moduloInModifica?.id);
  const toggleDep = (id: string) => {
    setSelectedDeps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleArt = (artId: string) => {
    setSelectedArts(prev => {
      const exists = prev.find(x => x.artId === artId);
      if (exists) return prev.filter(x => x.artId !== artId);
      const art = articoliList.find(a => a.id === artId);
      return [...prev, { artId, qty: 1, customPrice: art?.p }];
    });
  };

  const updateQty = (artId: string, qty: number) => {
    setSelectedArts(prev => prev.map(x => x.artId === artId ? { ...x, qty: Math.max(1, qty) } : x));
  };

  const updateCustomPrice = (artId: string, price: number) => {
    setSelectedArts(prev => prev.map(x => x.artId === artId ? { ...x, customPrice: Math.max(0, price) } : x));
  };

  const handleSave = async () => {
    if (!nome.trim() || selectedArts.length === 0) return;
    setLoading(true);
    try {
      const payload = {
        nome,
        categoria: cat,
        giurisdizioneId: giurisdizioneId || null,
        prezzoPacchetto: prezzoPkg !== '' ? Number(prezzoPkg) * 100 : null,
        righe: selectedArts.map(x => ({ articoloId: x.artId, quantita: x.qty })),
        // Dipendenze del modulo: il backend sostituisce l'insieme e rifiuta i cicli (400).
        dipendenzeDaIds: [...selectedDeps],
      };
      if (moduloInModifica) {
        await aggiornaModuloTemplateApi(moduloInModifica.id, payload);
      } else {
        await creaModuloTemplateApi(payload);
      }
      onCreated();
    } catch (err: any) {
      // §3.3 — salvataggio modulo template fallito: messaggio esplicito all'utente.
      toast.errore(`Salvataggio modulo non riuscito: ${err?.message || 'errore di rete'}. Riprova.`);
    } finally {
      setLoading(false);
    }
  };

  const totalCalculated = selectedArts.reduce((acc, curr) => {
    const art = articoliList.find(a => a.id === curr.artId);
    const unitPrice = curr.customPrice !== undefined ? curr.customPrice : (art ? art.p : 0);
    return acc + (unitPrice * curr.qty);
  }, 0);

  const totalHours = selectedArts.reduce((acc, curr) => {
    const art = articoliList.find(a => a.id === curr.artId);
    return acc + (art ? art.h * curr.qty : 0);
  }, 0);

  const filteredArticoli = articoliList.filter(a =>
    a.n.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.cat.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
      {/* Colonna 1: Editor Modulo Template */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 12px 36px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{moduloInModifica ? `✏️ Modifica Modulo Template — ${moduloInModifica.n}` : 'Costruttore Modulo Template'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {moduloInModifica
                ? 'Aggiorna nome, giurisdizione, listino pacchetto, distinta base e dipendenze del modulo'
                : 'Componi la distinta base, imposta giurisdizione, listino pacchetto e le eventuali dipendenze'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {moduloInModifica && onAnnullaModifica && (
              <button
                onClick={onAnnullaModifica}
                style={{ background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                ✕ Annulla modifica
              </button>
            )}
            <CatBadge cat={cat} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Modulo Template *</label>
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="es. Corporate Structuring & Holding Malta"
              required
              style={{ fontSize: 13, fontWeight: 600 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
              <select value={cat} onChange={e => setCat(e.target.value as CategoriaModulo)}>
                {['Analisi', 'Societario', 'Trust', 'Banking', 'Fiscale', 'Legale', 'IP', 'Compliance'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>🌍 Giurisdizione Target *</label>
              <select value={giurisdizioneId} onChange={e => setGiurisdizioneId(e.target.value)}>
                <option value="">🌐 Generico (Tutte)</option>
                {giurList.map(g => {
                  const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
                  return <option key={g.id} value={g.id}>{flag} {g.nome} ({g.codice})</option>;
                })}
              </select>
            </div>
          </div>
        </div>

        {/* Dipendenze del modulo */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)', marginBottom: 4 }}>
            🔗 Dipende da (moduli){selectedDeps.size > 0 ? ` — ${selectedDeps.size} selezionati` : ''}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 8 }}>
            Le micro-voci di questo modulo restano «in attesa di dipendenze» finché i moduli scelti non sono completati. Non sono ammessi cicli.
          </div>
          {moduliDipendibili.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>Nessun altro modulo in libreria da cui dipendere.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto' }}>
              {moduliDipendibili.map(m => {
                const sel = selectedDeps.has(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => toggleDep(m.id)}
                    title={m.giurisdizione?.nome || 'Generico'}
                    style={{
                      padding: '4px 10px', borderRadius: 16, fontSize: 11, cursor: 'pointer',
                      border: `1px solid ${sel ? 'var(--indigo)' : 'var(--border)'}`,
                      background: sel ? 'var(--pill-indigo-bg)' : 'var(--card2)',
                      color: sel ? 'var(--pill-indigo-fg)' : 'var(--text)',
                    }}
                  >
                    {sel ? '✓ ' : ''}{m.n}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selezione Articoli Distinta Base */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--indigo-l)' }}>
              🧱 Articoli della Distinta Base ({selectedArts.length} selezionati)
            </span>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Cerca articolo..."
              style={{ width: 140, padding: '4px 8px', fontSize: 11 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
            {filteredArticoli.map(a => {
              const item = selectedArts.find(x => x.artId === a.id);
              const isSel = !!item;
              const currentPrice = item?.customPrice !== undefined ? item.customPrice : a.p;

              return (
                <div
                  key={a.id}
                  style={{
                    background: isSel ? 'linear-gradient(135deg,var(--surface-1),var(--card2))' : 'var(--card2)',
                    border: `1px solid ${isSel ? 'var(--indigo-l)' : 'var(--border)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    transition: 'all var(--t)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => toggleArt(a.id)}>
                    <input type="checkbox" checked={isSel} readOnly style={{ cursor: 'pointer', transform: 'scale(1.1)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: isSel ? '#fff' : 'var(--text)' }}>{a.n}</div>
                      <div style={{ fontSize: 10, color: isSel ? 'var(--indigo-l)' : 'var(--muted)', marginTop: 2 }}>
                        {a.cat} · ⏱ {a.h}h stimate · Listino: {fmt(a.p)}
                      </div>
                    </div>
                  </div>

                  {isSel && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--sidebar)', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', gap: 10 }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>Q.tà:</span>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={e => updateQty(a.id, Number(e.target.value))}
                          style={{ width: 44, padding: '3px 4px', fontSize: 11, fontWeight: 700, textAlign: 'center' }}
                          min={1}
                        />
                      </div>

                      {/* EDIT PREZZO PERSONALIZZATO */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>€ Prezzo unitario:</span>
                        <input
                          type="number"
                          value={currentPrice}
                          onChange={e => updateCustomPrice(a.id, Number(e.target.value))}
                          style={{ width: 80, padding: '3px 6px', fontSize: 11, fontWeight: 700, textAlign: 'right', color: 'var(--pill-green-fg)', background: 'var(--pill-green-bg)', borderColor: 'var(--pill-green-bd)' }}
                          min={0}
                          step={50}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Colonna 2: Anteprima Live & Riepilogo Economico */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 12px 36px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>👁 Anteprima Modulo Template</span>
        </div>

        {selectedArts.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--card2)', borderRadius: 12, border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Nessun articolo ancora selezionato</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Seleziona gli articoli a sinistra per comporre la distinta base del modulo.</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{nome || 'Nuovo Modulo Template'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {selectedArts.length} prestazioni incorporate · Stima totale <strong>{totalHours}h operative</strong>
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              Distinta Base Componenti:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto', maxHeight: 240 }}>
              {selectedArts.map((item, idx) => {
                const art = articoliList.find(a => a.id === item.artId);
                if (!art) return null;
                return (
                  <div key={idx} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                    <div>
                      <strong>{item.qty}x</strong> {art.n}
                      <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>({art.h * item.qty}h)</span>
                    </div>
                    <div style={{ fontWeight: 600 }}>{fmt(art.p * item.qty)}</div>
                  </div>
                );
              })}
            </div>

            {/* Riepilogo Economico & Forfait */}
            <div style={{ background: 'linear-gradient(135deg,var(--surface-1),var(--card2))', border: '1px solid var(--card2)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--indigo-l)' }}>Somma Singoli Articoli:</span>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmt(totalCalculated)}</span>
              </div>

              <div>
                <label style={{ fontSize: 11, color: 'var(--indigo-l)', display: 'block', marginBottom: 4 }}>Prezzo Forfait Modulo (€ opzionale) *</label>
                <input
                  type="number"
                  value={prezzoPkg}
                  onChange={e => setPrezzoPkg(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={`Prezzo Pacchetto € (Default ${fmt(totalCalculated)})`}
                  style={{ fontSize: 13, fontWeight: 700, background: 'var(--surface-2)', borderColor: 'var(--border)' }}
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={!nome.trim() || selectedArts.length === 0 || loading}
              style={{
                width: '100%',
                background: 'var(--indigo)',
                color: 'var(--on-accent)',
                border: 'none',
                padding: '12px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                opacity: (!nome.trim() || selectedArts.length === 0) ? 0.5 : 1,
                boxShadow: '0 4px 16px rgba(99,102,241,.4)',
              }}
            >
              {loading ? 'Salvataggio...' : moduloInModifica ? '✓ Salva Modifiche al Modulo Template' : '✓ Salva Modulo Template con Distinta Base'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
