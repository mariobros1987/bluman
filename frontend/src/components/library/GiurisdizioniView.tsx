import { useState } from 'react';
import { CatBadge } from '../ui/CatBadge';
import { creaGiurisdizioneApi } from '../../api/client';
import type { Giurisdizione, ModuloTemplate } from '../../types';

// ─── Componente Giurisdizioni Studio ──────────────────────────────
export function GiurisdizioniView({
  giurList,
  moduliList,
  onAddGiur,
  onOpenInGraph,
  onLinkModulo,
}: {
  giurList: Giurisdizione[];
  moduliList: ModuloTemplate[];
  onAddGiur: (g: Giurisdizione) => void;
  onOpenInGraph: (giurId: string) => void;
  onLinkModulo?: (modId: string, giurId: string | null) => void;
}) {
  const [modalGiurOpen, setModalGiurOpen] = useState(false);
  const [selectedGiur, setSelectedGiur] = useState<Giurisdizione | null>(null);
  const [newGiurNome, setNewGiurNome] = useState('');
  const [newGiurCodice, setNewGiurCodice] = useState('');
  const [newGiurTipo, setNewGiurTipo] = useState<'ue' | 'extra_ue' | 'stato_usa' | 'altro'>('ue');
  const [newGiurNote, setNewGiurNote] = useState('');
  const [selectedModToAssign, setSelectedModToAssign] = useState<string>('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Guida / Instruction Banner */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💡 Come assegnare un Modello alla Giurisdizione:</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
            • <strong>Metodo 1 (Rapido):</strong> Clicca su qualsiasi giurisdizione sotto per aprire il modal e seleziona il modulo da associare.<br />
            • <strong>Metodo 2 (Costruttore):</strong> Vai nella scheda <em>"Costruttore Modulo Template"</em> e scegli la giurisdizione target dal menu a tendina.
          </div>
        </div>

        <button
          onClick={() => setModalGiurOpen(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nuova Giurisdizione
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {giurList.map((g) => {
          const flag = g.codice === 'MT' ? '🇲🇹' : g.codice === 'GI' ? '🇬🇮' : g.codice.startsWith('US') ? '🇺🇸' : g.codice === 'AE' ? '🇦🇪' : '🌐';
          const linkedMods = moduliList.filter(m => m.giurisdizioneId === g.id);

          return (
            <div
              key={g.id}
              onClick={() => setSelectedGiur(g)}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(0,0,0,.2)',
                cursor: 'pointer',
                transition: 'transform .15s, border-color .15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--indigo)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{flag}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: g.tipo === 'ue' ? '#0d2d22' : g.tipo === 'stato_usa' ? '#1e1b4b' : '#2d1a05',
                      color: g.tipo === 'ue' ? '#34d399' : g.tipo === 'stato_usa' ? '#a5b4fc' : '#f59e0b',
                      textTransform: 'uppercase',
                    }}
                  >
                    {g.tipo}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{g.nome} ({g.codice})</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                  {g.note || 'Nessuna nota aggiuntiva'}
                </div>
              </div>

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>
                  🧩 {linkedMods.length} Moduli Specifici
                </span>
                <span style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600 }}>
                  Gestisci & Associa ➔
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dettaglio & Assegnazione Moduli Giurisdizione */}
      {selectedGiur && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{selectedGiur.codice === 'MT' ? '🇲🇹' : selectedGiur.codice === 'GI' ? '🇬🇮' : selectedGiur.codice.startsWith('US') ? '🇺🇸' : selectedGiur.codice === 'AE' ? '🇦🇪' : '🌐'}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedGiur.nome} ({selectedGiur.codice})</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Gestione Moduli Specifici della Piazza Finanziaria</div>
                </div>
              </div>
              <button onClick={() => setSelectedGiur(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            {/* Assegnazione 1-Click Nuovo Modulo */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', textTransform: 'uppercase' }}>
                ➕ Associa un Modello di Libreria a questa Giurisdizione
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={selectedModToAssign}
                  onChange={e => setSelectedModToAssign(e.target.value)}
                  style={{ flex: 1, padding: 8, fontSize: 12 }}
                >
                  <option value="">-- Seleziona Modulo da Associare --</option>
                  {moduliList.filter(m => m.giurisdizioneId !== selectedGiur.id).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.n} ({m.cat}) {m.giurisdizioneId ? '— (Già associato ad altra giur)' : '— (Generico)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedModToAssign) return;
                    if (onLinkModulo) {
                      onLinkModulo(selectedModToAssign, selectedGiur.id);
                    }
                    const targetMod = moduliList.find(m => m.id === selectedModToAssign);
                    alert(`✓ Modulo "${targetMod?.n}" associato con successo alla giurisdizione ${selectedGiur.nome}!`);
                    setSelectedModToAssign('');
                  }}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Associa
                </button>
              </div>
            </div>

            {/* Lista Moduli Collegati */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>🧩 Moduli Template Attualmente Collegati ({moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length}):</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', padding: 12, background: 'var(--card2)', borderRadius: 8, textAlign: 'center' }}>
                    Nessun modulo specifico attualmente collegato a questa giurisdizione.<br />Usa il menu sopra per associare i moduli spettai.
                  </div>
                ) : (
                  moduliList.filter(m => m.giurisdizioneId === selectedGiur.id).map(m => (
                    <div key={m.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.n}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Cat: {m.cat} · Version v{m.ver}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CatBadge cat={m.cat} />
                        <button
                          type="button"
                          onClick={() => {
                            if (onLinkModulo) {
                              onLinkModulo(m.id, null);
                            }
                            alert(`✓ Modulo "${m.n}" scollegato dalla giurisdizione ${selectedGiur.nome}. Torna ad essere generico.`);
                          }}
                          title="Scollega da questa giurisdizione"
                          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--red)', padding: '2px 6px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}
                        >
                          ✕ Scollega
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setSelectedGiur(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Chiudi
              </button>
              <button
                type="button"
                onClick={() => {
                  const gId = selectedGiur.id;
                  setSelectedGiur(null);
                  onOpenInGraph(gId);
                }}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
              >
                🕸 VEDI NEL GRAFO CON FILTRO ATTIVO ➔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuova Giurisdizione */}
      {modalGiurOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 440, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>+ Nuova Giurisdizione Studio</div>
              <button onClick={() => setModalGiurOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newGiurNome || !newGiurCodice) return;
                // §3.3 — creaGiurisdizioneApi ora lancia se il server rifiuta o non risponde:
                // la giurisdizione si aggiunge alla lista SOLO con l'oggetto restituito dal DB,
                // mai con un id inventato dal client (succedeva: 'giur-<timestamp>').
                try {
                  const res = await creaGiurisdizioneApi({
                    nome: newGiurNome,
                    codice: newGiurCodice.toUpperCase(),
                    tipo: newGiurTipo,
                    note: newGiurNote,
                  });
                  onAddGiur(res);
                  setModalGiurOpen(false);
                  setNewGiurNome('');
                  setNewGiurCodice('');
                  setNewGiurNote('');
                } catch (err: any) {
                  alert(`Creazione giurisdizione non riuscita: ${err?.message || 'errore di rete'}. Riprova.`);
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Giurisdizione *</label>
                <input value={newGiurNome} onChange={e => setNewGiurNome(e.target.value)} placeholder="es. Svizzera / Lussemburgo" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice ISO / Paese *</label>
                <input value={newGiurCodice} onChange={e => setNewGiurCodice(e.target.value)} placeholder="es. CH / LU" required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo *</label>
                <select value={newGiurTipo} onChange={e => setNewGiurTipo(e.target.value as any)}>
                  <option value="ue">Unione Europea (UE)</option>
                  <option value="extra_ue">Extra-UE (Gibilterra, EAU, UK...)</option>
                  <option value="stato_usa">Stato USA (Florida, Delaware...)</option>
                  <option value="altro">Altro</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note / Descrizione</label>
                <textarea value={newGiurNote} onChange={e => setNewGiurNote(e.target.value)} placeholder="Note adempimenti o valuta" rows={2} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setModalGiurOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
                <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Salva Giurisdizione</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
