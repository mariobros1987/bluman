import React, { useState, useEffect } from 'react';
import { CatBadge } from '../ui/CatBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { fmt } from '../../utils';
import { fetchModuliLibreria, fetchArticoli } from '../../api/client';
import type { Progetto } from '../../types';
import { useToast } from '../ui/ToastProvider';
import { Modal } from '../ui/Modal';

// ─── Componente Grafo & Dipendenze Moduli del Progetto ────────────
export function GrafoModuliProgettoView({
  project,
  onAddModule,
  onSelectMod,
}: {
  project: Progetto;
  /**
   * Aggiunge al progetto un modulo della libreria. Passa il modello, non un modulo già
   * costruito: l'istanza — righe di distinta, versioni congelate (§15.3), micro-voci — la crea
   * il backend dal preventivo. Costruirla qui produceva un modulo che esisteva solo nel browser.
   */
  onAddModule: (modello: { id: string; versione: number; nome: string; prezzo: number }) => void;
  onSelectMod: (modId: number) => void;
}) {
  const toast = useToast();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [dbModTemplates, setDbModTemplates] = useState<Array<{ id: string; ver: number; n: string; cat: string; h: number; p: number; righe: any[] }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [erroreLibreria, setErroreLibreria] = useState<string | null>(null);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const [mods, arts] = await Promise.all([fetchModuliLibreria(), fetchArticoli()]);
        if (!mods || !Array.isArray(mods)) {
          setErroreLibreria('Libreria moduli non raggiungibile: non è possibile aggiungere moduli.');
          return;
        }
        if (mods.length === 0) {
          setErroreLibreria('La libreria moduli di questo studio è vuota: creane uno in Libreria prima di aggiungerlo a un progetto.');
          return;
        }
        const mapped = mods.map((m: any) => {
          const righeResolved = (m.righeDistinta || []).map((r: any) => {
            const art = (arts || []).find((a: any) => a.id === r.articoloId) || r.articolo;
            const quantita = r.quantita || 1;
            return {
              n: art ? art.nome : 'Articolo non trovato in libreria',
              hE: (r.overrideOre != null ? r.overrideOre : (art?.oreDefault || 0)) * quantita,
              prezzo: (r.overridePrezzo != null ? r.overridePrezzo : (art?.prezzoDefault || 0)) * quantita,
              hA: 0,
              s: 'pending',
              // Regola 7: nessun assegnatario fittizio — l'assegnazione avviene solo
              // dopo che un membro reale del team viene scelto sul modulo/micro-voce.
              d: 0,
            };
          });
          // Ore e prezzo del modulo sono la somma di quello che la distinta contiene davvero.
          // Prima c'erano tre invenzioni in tre righe: `|| 10` ore, `|| 1500` euro e una tariffa
          // di 150 €/ora applicata alle ore quando il pacchetto non aveva prezzo. Un modulo
          // senza distinta risultava così da 10 ore e 1.500 €, cifre che nessuno aveva stimato
          // e che finivano nel valore dell'incarico e nella redditività.
          return {
            id: m.id,
            ver: m.versione || 1,
            n: m.nome,
            cat: m.categoria,
            h: righeResolved.reduce((acc: number, x: any) => acc + x.hE, 0),
            p: m.prezzoPacchetto != null
              ? m.prezzoPacchetto / 100
              : righeResolved.reduce((acc: number, x: any) => acc + x.prezzo, 0) / 100,
            // Nessuna micro-voce inventata: un modulo di libreria senza distinta è un modulo
            // senza distinta, e l'elenco lo dichiara vuoto.
            righe: righeResolved,
          };
        });
        setDbModTemplates(mapped);
        setErroreLibreria(null);
        if (mapped.length > 0) setSelectedTemplate(mapped[0].id);
      } catch (err: any) {
        setErroreLibreria(`Libreria moduli non caricata: ${err?.message || 'errore di rete'}.`);
      }
    }
    loadTemplates();
  }, []);

  // I moduli disponibili sono quelli della libreria dello studio. Qui c'era un elenco fisso di
  // tre voci — «Trust & Asset Protection» 30h/4.500 €, «IP Licensing» 22h/3.800 €, «Licenza MFSA
  // VASP» 50h/9.500 € — che compariva ogni volta che la libreria non rispondeva: nomi, ore e
  // prezzi di uno studio immaginario, aggiungibili a un progetto vero con un clic.
  const allAvailableTemplates = dbModTemplates;

  const handleAddModuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tmpl = allAvailableTemplates.find(t => t.id === selectedTemplate);
    if (!tmpl) return;
    onAddModule({ id: tmpl.id, versione: tmpl.ver, nome: tmpl.n, prezzo: tmpl.p });
    setAddModalOpen(false);
  };

  const completedModsCount = project.mods.filter(m => m.st === 'done' || m.pct === 100).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Controlli Grafo */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🕸 Mappa Grafo Moduli & Workflow Dipendenze</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Visualizzazione dei moduli acquistati dal cliente, delle dipendenze sbloccate e dell'avanzamento live
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, background: 'var(--card2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 20, fontWeight: 600 }}>
            📊 Moduli Ultimati: <span style={{ color: 'var(--green)' }}>{completedModsCount} / {project.mods.length}</span>
          </div>
          <button
            onClick={() => setAddModalOpen(true)}
            style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Aggiungi Modulo da Libreria
          </button>
        </div>
      </div>

      {/* Visual Flow / Grafo Moduli con Frecce */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, minHeight: 300, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Flusso Operativo Progetto & Avanzamento Live:
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, overflowX: 'auto', paddingBottom: 10 }}>
          {project.mods.map((m, idx) => {
            const isDone = m.st === 'done' || m.pct === 100;
            const isInProgress = m.st === 'in_progress' || (m.pct > 0 && m.pct < 100);

            // Calcolo sblocco topologico (locked / unlocked)
            const prevMod = idx > 0 ? project.mods[idx - 1] : null;
            const isLocked = prevMod ? (prevMod.st !== 'done' && prevMod.pct < 100) : false;

            const statusColor = isDone ? 'var(--green)' : isLocked ? 'var(--amber)' : isInProgress ? 'var(--indigo-l)' : 'var(--muted)';
            const lockBadgeText = isDone ? '✓ Ultimato' : isLocked ? `🔒 Bloccato da ${prevMod?.n.substring(0, 14)}...` : isInProgress ? '⚡ In Lavorazione' : '🔓 Sbloccato & Eseguibile';

            return (
              <React.Fragment key={m.id}>
                {/* Node Card */}
                <div
                  onClick={() => onSelectMod(m.id)}
                  style={{
                    minWidth: 270,
                    maxWidth: 290,
                    background: isLocked ? 'rgba(217, 119, 6, 0.05)' : 'var(--card)',
                    border: `1.5px solid ${isDone ? 'var(--green)' : isLocked ? 'var(--amber)' : isInProgress ? 'var(--indigo)' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    cursor: 'pointer',
                    boxShadow: isInProgress ? '0 0 20px rgba(99,102,241,.25)' : isLocked ? '0 0 10px rgba(217,119,6,.15)' : '0 4px 16px rgba(0,0,0,.3)',
                    transition: 'all .2s',
                    opacity: isLocked ? 0.82 : 1,
                  }}
                  title={isLocked ? `Modulo bloccato in attesa del completamento di: ${prevMod?.n}` : "Clicca per aprire la scheda dettagliata del modulo"}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <CatBadge cat={m.cat} />
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: statusColor, background: isLocked ? 'var(--pill-amber-bg)' : 'var(--card2)', border: `1px solid ${isLocked ? 'var(--pill-amber-bd)' : 'var(--border)'}`, padding: '2px 8px', borderRadius: 12 }}>
                      {lockBadgeText}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{m.n}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                      {m.v ? `${m.v.length} Microvoci operative` : 'Passaggi guidati'}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                      <span>Avanzamento Live</span>
                      <span style={{ fontWeight: 700, color: statusColor }}>{m.pct}%</span>
                    </div>
                    <ProgressBar value={m.pct} color={statusColor} height={5} />
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--muted)' }}>
                    <span>⏱ {m.a}/{m.h}h</span>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmt(m.p)}</span>
                  </div>

                  {/* Pulsante Notifica Sblocco al Cliente */}
                  {isDone && idx < project.mods.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toast.successo(`Notifica Sblocco inviata con successo al cliente per la fase successiva: ${project.mods[idx + 1].n}!`);
                      }}
                      style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bd)', color: 'var(--pill-green-fg)', padding: '5px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginTop: 2 }}
                    >
                      ✉️ Notifica Sblocco al Cliente
                    </button>
                  )}
                </div>

                {/* Arrow Connector */}
                {idx < project.mods.length - 1 && (
                  <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 4, color: isDone ? 'var(--green)' : isLocked ? 'var(--amber)' : 'var(--muted)' }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{isDone ? '🔓 ➔' : '🔒 ➔'}</div>
                    <span style={{ fontSize: 9, fontWeight: 600 }}>{isDone ? 'Sbloccato' : 'In attesa'}</span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Modal Aggiungi Modulo da Libreria */}
      {addModalOpen && (
        <Modal onClose={() => setAddModalOpen(false)} labelledBy="titolo-aggiungi-modulo" zIndex={100}>
          {(richiediChiusura) => (
          <form onSubmit={handleAddModuleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div id="titolo-aggiungi-modulo" style={{ fontSize: 16, fontWeight: 700 }}>+ Aggiungi Modulo da Libreria al Progetto</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona una prestazione o modulo aggiuntivo dal catalogo della libreria da associare al cliente</div>

            {erroreLibreria && (
              <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '9px 12px', borderRadius: 10, fontSize: 11, lineHeight: 1.5 }}>
                {erroreLibreria}
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo Template Libreria *</label>
              <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ padding: 10, fontSize: 12 }} disabled={allAvailableTemplates.length === 0}>
                {allAvailableTemplates.length === 0 && <option value="">— nessun modulo in libreria —</option>}
                {allAvailableTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.n} ({t.cat}) — {t.h}h — {fmt(t.p)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il modulo viene istanziato a database da un preventivo accettato: modello e versione restano congelati (§15.3) e le micro-voci nascono dalla distinta del modello.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={!selectedTemplate} style={{ background: selectedTemplate ? 'var(--indigo)' : 'var(--card2)', color: selectedTemplate ? 'var(--on-accent)' : 'var(--hint)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: selectedTemplate ? 'pointer' : 'not-allowed' }}>✓ Aggiungi al Progetto</button>
            </div>
          </form>
          )}
        </Modal>
      )}
    </div>
  );
}
