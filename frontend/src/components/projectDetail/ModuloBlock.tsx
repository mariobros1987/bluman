import React, { useState } from 'react';
import { Badge } from '../ui/Badge';
import { CatBadge } from '../ui/CatBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { AvatarGroup, Avatar } from '../ui/Avatar';
import { fmt } from '../../utils';
import { consuntivaMicrovoceApi } from '../../api/client';
import type { ModuloProgetto, MicroVoce } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

export function ModuloBlock({ mod, open, onToggle, onOpenProc, rawDbModulo, onRefresh, onToggleMv, onOpenAssignMod, onOpenAssignMv, onOpenCalendarMv, onDeleteMod }: {
  mod: ModuloProgetto; open: boolean;
  onToggle: () => void; onOpenProc: (vidx: number) => void;
  rawDbModulo?: any; onRefresh: () => void;
  onToggleMv: (vidx: number) => void;
  onOpenAssignMod: () => void;
  onOpenAssignMv: (vidx: number) => void;
  onOpenCalendarMv: (vidx: number) => void;
  onDeleteMod?: () => void;
}) {
  const color = mod.st === 'blocked' ? 'var(--red)'
    : mod.delay ? 'var(--amber)'
    : mod.waitDep ? 'var(--purple)'
    : 'var(--indigo)';

  const [consuntivaMv, setConsuntivaMv] = useState<any | null>(null);
  const [oreCons, setOreCons] = useState(2);
  const [completa, setCompleta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Micro-voci reali del modulo. Nessun ripiego: era l'ultimo fabbricatore della pagina e il
  // più insidioso, perché agiva in fase di render — anche con i dati corretti a monte, un modulo
  // senza micro-voci ne mostrava tre pescate da MLIB (per nome, per inclusione del nome e infine
  // `MLIB[0]`, quindi sempre qualcosa) o generate col nome del modulo interpolato. Erano righe
  // cliccabili con ore preventivate, indistinguibili da quelle vere: si potevano consuntivare, e
  // `consuntivaMicrovoceApi` sarebbe stata chiamata con l'id di una micro-voce che a database non
  // esiste. È anche la ragione per cui i due moduli senza micro-voci di "Struttura Holding —
  // Famiglia Ricci" (debito noto di Fase 1) risultavano pieni. Un modulo senza micro-voci si
  // dichiara vuoto.
  const displayMicrovoci: MicroVoce[] = mod.v || [];

  const handleConsuntivaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consuntivaMv) return;
    setSubmitting(true);
    try {
      await consuntivaMicrovoceApi({
        microvoceId: consuntivaMv.id,
        oreAggiunte: Number(oreCons),
        completa,
      });
      setConsuntivaMv(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const isDeletable = mod.a === 0 || displayMicrovoci.every(v => v.s !== 'done' && (v.hA || 0) === 0);

  return (
    <div className={`${styles.modBlock} ${mod.delay ? styles.modDelay : ''} ${mod.waitDep ? styles.modWaitDep : ''}`}>
      {/* Header */}
      <div className={styles.modHeader} onClick={onToggle}>
        <span className={`${styles.chev} ${open ? styles.chevOpen : ''}`}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <CatBadge cat={mod.cat} />
            <span className={styles.modName}>{mod.n}</span>
          </div>
          {mod.dn && <div className={styles.modNote}>⚠ {mod.dn}</div>}
          {/* §16.1 — sforamento ore: il modulo avanza, ma sta costando oltre il preventivo.
              Non è il ritardo di `dn`, ed è lo stesso segnale che la Dashboard mostra nel banner. */}
          {mod.rischio && (
            <div className={styles.modNote} style={{ color: 'var(--amber)' }}>
              ⚠ Ore sforate{mod.oreExtra ? ` — +${mod.oreExtra}h oltre il preventivo` : ''}
            </div>
          )}
          {mod.wdn && <div className={styles.modNote} style={{ color: 'var(--purple)' }}>⏳ {mod.wdn}</div>}
        </div>
        <div className={styles.modRight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AvatarGroup ids={mod.team} size={22} />
            <button
              onClick={e => {
                e.stopPropagation();
                onOpenAssignMod();
              }}
              title="Assegna operatore o concedi permessi su questo modulo"
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
            >
              👥 +Assegna
            </button>
            {isDeletable && onDeleteMod && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDeleteMod();
                }}
                title="Elimina modulo dal progetto (0 ore espletate)"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
              >
                🗑 Elimina
              </button>
            )}
          </div>
          <div className={styles.modRightHours}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{mod.pct}%</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{mod.a}h / {mod.h}h</div>
          </div>
          <Badge stato={mod.st} />
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(mod.p)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 16px 0' }}>
        <ProgressBar value={mod.pct} color={color} height={3} />
      </div>

      {/* Micro-voci table */}
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.vt}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Voce</th>
                <th>Assegnato</th>
                <th>Ore prev.</th>
                <th>Ore cons.</th>
                <th>Azione</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {displayMicrovoci.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 18, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Questo modulo non ha micro-voci a database.<br />
                    Nessuna ora preventivata né consuntivata: non c'è avanzamento da calcolare finché non vengono istanziate.
                  </td>
                </tr>
              )}
              {displayMicrovoci.map((v, i) => {
                  const rawMv = rawDbModulo?.microvoci?.[i];
                  const isDelay = v.s === 'delayed';
                  const isBlock = v.s === 'blocked';
                  // §1ter.6 (C2) — chi lavora a questa micro-voce, o niente.
                  //
                  // Prima l'assegnatario assente diventava l'operatore numero 1 (`|| 1` alla
                  // lettura), quindi ogni voce non assegnata mostrava l'avatar di una persona
                  // precisa: un'affermazione su chi sta facendo il lavoro, falsa e invisibile,
                  // perché un avatar disegnato non si distingue da un avatar giusto.
                  //
                  // Si preferisce l'uuid (`risorsaId`) perché è quello che il database sa e
                  // che sopravvive a un ricaricamento della pagina; `Avatar` lo risolve da sé
                  // cercando anche per `dbId`, quindi l'ordine di caricamento non conta.
                  const assegnatario = v.risorsaId ?? v.as ?? null;
                  return (
                    <tr
                      key={i}
                      className={isDelay ? styles.rowDelay : isBlock ? styles.rowBlock : ''}
                    >
                      <td onClick={() => onOpenProc(i)} style={{ cursor: 'pointer' }}>
                        <div className={styles.vn}>
                          <span className={v.s === 'done' ? styles.vnDone : ''}>{v.n}</span>
                          <span className={styles.vnOpen}>dettaglio →</span>
                        </div>
                        {v.vn && (
                          <div style={{ fontSize: 10, color: isBlock ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}>{v.vn}</div>
                        )}
                      </td>
                      <td onClick={e => { e.stopPropagation(); onOpenAssignMv(i); }} style={{ cursor: 'pointer' }} title="Clicca per riassegnare l'operatore di studio">
                        {assegnatario !== null ? (
                          <Avatar id={assegnatario} size={22} />
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--hint, #64748b)', fontStyle: 'italic' }}>
                            non assegnato
                          </span>
                        )}
                      </td>
                      <td><span style={{ color: 'var(--muted)' }}>{v.hE}h</span></td>
                      <td>
                        <span style={{ color: v.hA > v.hE ? 'var(--red)' : v.hA > 0 ? 'var(--green)' : 'var(--hint)', fontWeight: v.hA > v.hE ? 700 : undefined }}>
                          {v.hA}h
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onToggleMv(i);
                            }}
                            style={{
                              background: v.s === 'done' ? '#0d2d22' : 'var(--card2)',
                              border: `1px solid ${v.s === 'done' ? '#1a5c3c' : 'var(--border)'}`,
                              color: v.s === 'done' ? '#34d399' : 'var(--text)',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Clicca per mettere la spunta e salvare lo stato di completamento"
                          >
                            {v.s === 'done' ? '✓ Completata' : '⬜ Spunta'}
                          </button>
                          {rawMv && (
                            <button
                              onClick={e => { e.stopPropagation(); setConsuntivaMv(rawMv); }}
                              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                            >
                              ⏱ Consuntiva
                            </button>
                          )}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onOpenCalendarMv(i);
                            }}
                            title="Apri Anteprima Calendario & Pianifica Scadenza Studio"
                            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '3px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
                          >
                            📅
                          </button>
                        </div>
                      </td>
                      <td><Badge stato={v.s} size="sm" /></td>
                    </tr>
                  );
                })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <div className={styles.modFoot}>
                    <span>Totale: {mod.h}h preventivate · {mod.a}h consuntivate</span>
                    <span style={{ fontWeight: 600 }}>{fmt(mod.p)}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal Consuntivazione Ore */}
      {consuntivaMv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleConsuntivaSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Registra Ore Consuntivate</div>
            <div style={{ fontSize: 12, color: '#818cf8' }}>{consuntivaMv.nome}</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore lavorate da aggiungere *</label>
              <input type="number" value={oreCons} onChange={e => setOreCons(Number(e.target.value))} min={0.5} step={0.5} required />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="chkDone" checked={completa} onChange={e => setCompleta(e.target.checked)} />
              <label htmlFor="chkDone" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                Marca questa microvoce come <strong>Completata (Done)</strong>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setConsuntivaMv(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{submitting ? 'Salvataggio...' : '✓ Salva Modifiche'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
