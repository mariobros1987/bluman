import React, { useState } from 'react';
import { Badge } from '../ui/Badge';
import { CatBadge } from '../ui/CatBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { Modal } from '../ui/Modal';
import { AvatarGroup, Avatar } from '../ui/Avatar';
import { fmt } from '../../utils';
import { consuntivaMicrovoceApi, impostaCondivisioneMicrovoceApi, ripristinaMicrovociModuloApi } from '../../api/client';
import { useToast } from '../ui/ToastProvider';
import { confirm } from '../ui/ConfirmProvider';
import type { ModuloProgetto, MicroVoce } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

export function ModuloBlock({ mod, open, onToggle, onOpenProc, rawDbModulo, onRefresh, onToggleMv, onOpenAssignMod, onOpenAssignMv, onOpenCalendarMv, onDeleteMod, moduliProgetto = [], progettoId }: {
  mod: ModuloProgetto; open: boolean;
  onToggle: () => void; onOpenProc: (vidx: number) => void;
  rawDbModulo?: any; onRefresh: () => void;
  onToggleMv: (vidx: number) => void;
  onOpenAssignMod: () => void;
  onOpenAssignMv: (vidx: number) => void;
  onOpenCalendarMv: (vidx: number) => void;
  onDeleteMod?: () => void;
  /** Tutti i moduli del progetto (id uuid + nome), per scegliere dove condividere una voce. */
  moduliProgetto?: Array<{ id: string; nome: string }>;
  progettoId?: string;
}) {
  const color = mod.st === 'blocked' ? 'var(--red)'
    : mod.delay ? 'var(--amber)'
    : mod.waitDep ? 'var(--purple)'
    : 'var(--indigo)';

  const [consuntivaMv, setConsuntivaMv] = useState<any | null>(null);
  const [oreCons, setOreCons] = useState(2);
  const [completa, setCompleta] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Ripristino delle voci da distinta (modulo vuoto): stato del pulsante, non del modulo.
  const [ripristinoInCorso, setRipristinoInCorso] = useState(false);
  const toast = useToast();
  // Pannello «Voci condivise» (Fase 2): gestisce in quali ALTRI moduli le voci di questo modulo
  // sono condivise. Lo stato di selezione è per micro-voce → set di id modulo di destinazione.
  const [condivisioneOpen, setCondivisioneOpen] = useState(false);
  const [selCondivise, setSelCondivise] = useState<Record<string, Set<string>>>({});
  const [salvandoCond, setSalvandoCond] = useState(false);
  const [erroreCond, setErroreCond] = useState<string | null>(null);

  const altriModuli = moduliProgetto.filter((m) => m.id !== rawDbModulo?.id);

  const apriCondivisione = () => {
    // Pre-carica la selezione corrente dalle condivisioni USCENTI di ciascuna voce.
    const iniziale: Record<string, Set<string>> = {};
    for (const mv of (rawDbModulo?.microvoci ?? [])) {
      iniziale[mv.id] = new Set<string>((mv.condivisioni ?? []).map((c: any) => c.moduloProgettoId));
    }
    setSelCondivise(iniziale);
    setErroreCond(null);
    setCondivisioneOpen(true);
  };

  const salvaCondivisione = async (mvId: string) => {
    if (!progettoId) return;
    setSalvandoCond(true);
    setErroreCond(null);
    try {
      await impostaCondivisioneMicrovoceApi(progettoId, mvId, [...(selCondivise[mvId] ?? [])]);
      onRefresh();
    } catch (err) {
      setErroreCond(err instanceof Error ? err.message : 'Condivisione non riuscita.');
    } finally {
      setSalvandoCond(false);
    }
  };

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

  // Un modulo esiste a database se `GET /progetti/:id` lo restituisce: `rawDbModulo` arriva da lì.
  // Senza, il modulo è una copia rimasta in questo browser (ripiego su `bluman_custom_projects`)
  // e non c'è nessuna riga da riempire.
  const moduloInDatabase = Boolean(rawDbModulo?.id);

  const ripristinaVoci = async () => {
    if (!progettoId || !rawDbModulo?.id || ripristinoInCorso) return;
    const procedi = await confirm({
      titolo: 'Ripristinare le voci di questo modulo?',
      messaggio:
        `Il modulo «${mod.n}» non ha micro-voci a database. Le voci verranno ricreate dalla ` +
        'distinta del modulo di libreria, con le ore e i passaggi con cui è stato istanziato. ' +
        'Non viene toccato nient\'altro: se il modulo non è vuoto l\'operazione viene rifiutata.',
      confermaLabel: 'Ripristina',
    });
    if (!procedi) return;

    setRipristinoInCorso(true);
    try {
      const esito = await ripristinaMicrovociModuloApi(progettoId, rawDbModulo.id);
      toast.successo(`${esito.microvociCreate} micro-voci ripristinate · ${esito.orePreventivate}h preventivate.`);
      onRefresh();
    } catch (err) {
      // Il 409 porta il motivo vero (template sparito, distinta vuota, modulo non vuoto): si mostra
      // quello, non un «errore» generico che manderebbe a cercare un guasto che non c'è.
      toast.errore(err instanceof Error ? err.message : 'Ripristino delle voci non riuscito.');
    } finally {
      setRipristinoInCorso(false);
    }
  };

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
            {altriModuli.length > 0 && (rawDbModulo?.microvoci?.length ?? 0) > 0 && (
              <button
                onClick={e => { e.stopPropagation(); apriCondivisione(); }}
                title="Condividi una voce di questo modulo con altri moduli (si esegue una volta, conta per entrambi)"
                style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
              >
                🔗 Voci condivise
              </button>
            )}
            {isDeletable && onDeleteMod && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDeleteMod();
                }}
                title="Elimina modulo dal progetto (0 ore espletate)"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
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
                    {moduloInDatabase ? (
                      <>
                        Questo modulo non ha micro-voci a database.<br />
                        Nessuna ora preventivata né consuntivata: non c'è avanzamento da calcolare.
                        {progettoId && (
                          <>
                            <br />
                            <button
                              type="button"
                              onClick={ripristinaVoci}
                              disabled={ripristinoInCorso}
                              title="Ricrea le voci dalla distinta del modulo di libreria con cui questo modulo è stato istanziato"
                              style={{
                                marginTop: 10,
                                background: 'var(--indigo)',
                                color: 'var(--on-accent)',
                                border: 'none',
                                padding: '6px 14px',
                                borderRadius: 8,
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: ripristinoInCorso ? 'default' : 'pointer',
                                opacity: ripristinoInCorso ? 0.6 : 1,
                              }}
                            >
                              {ripristinoInCorso ? 'Ripristino…' : '↻ Ripristina le voci dal modulo di libreria'}
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Questo modulo non esiste a database.<br />
                        È una copia rimasta in questo browser: non ha voci perché nessuna riga è
                        mai stata scritta sul server. I moduli veri si aggiungono dalla Libreria.
                      </>
                    )}
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
                        {(rawMv?.condivisioni?.length ?? 0) > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--indigo-l)', marginTop: 2 }} title="Questa voce è condivisa con altri moduli: si esegue una volta e conta per entrambi.">
                            🔗 condivisa in {rawMv.condivisioni.length} {rawMv.condivisioni.length === 1 ? 'altro modulo' : 'altri moduli'}
                          </div>
                        )}
                        {v.vn && (
                          <div style={{ fontSize: 10, color: isBlock ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}>{v.vn}</div>
                        )}
                      </td>
                      <td onClick={e => { e.stopPropagation(); onOpenAssignMv(i); }} style={{ cursor: 'pointer' }} title="Clicca per riassegnare l'operatore di studio">
                        {assegnatario !== null ? (
                          <Avatar id={assegnatario} size={22} />
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--hint, var(--muted))', fontStyle: 'italic' }}>
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
                              background: v.s === 'done' ? 'var(--pill-green-bg)' : 'var(--card2)',
                              border: `1px solid ${v.s === 'done' ? 'var(--pill-green-bd)' : 'var(--border)'}`,
                              color: v.s === 'done' ? 'var(--pill-green-fg)' : 'var(--text)',
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
                              style={{ background: 'var(--surface-1)', border: '1px solid var(--card2)', color: 'var(--indigo-l)', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
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
        <Modal onClose={() => setConsuntivaMv(null)} labelledBy="titolo-consuntiva-ore" zIndex={100}>
          {(richiediChiusura) => (
          <form onSubmit={handleConsuntivaSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div id="titolo-consuntiva-ore" style={{ fontSize: 14, fontWeight: 600 }}>Registra Ore Consuntivate</div>
            <div style={{ fontSize: 12, color: 'var(--indigo-l)' }}>{consuntivaMv.nome}</div>

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
              <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{submitting ? 'Salvataggio...' : '✓ Salva Modifiche'}</button>
            </div>
          </form>
          )}
        </Modal>
      )}

      {/* Modal «Voci condivise» (Fase 2) */}
      {condivisioneOpen && (
        <Modal onClose={() => setCondivisioneOpen(false)} labelledBy="titolo-condivisione" zIndex={100}>
          {(richiediChiusura) => (
            <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '80vh', overflowY: 'auto' }}>
              <div id="titolo-condivisione" style={{ fontSize: 14, fontWeight: 600 }}>Voci condivise — {mod.n}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Spunta i moduli in cui una voce di questo modulo deve valere <strong>anche</strong>: si esegue una volta e conta per entrambi. Una voce non può comparire due volte con lo stesso nome nello stesso modulo.
              </div>
              {erroreCond && <div style={{ padding: 10, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 12 }}>{erroreCond}</div>}
              {(rawDbModulo?.microvoci ?? []).map((mv: any) => (
                <div key={mv.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{mv.nome}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {altriModuli.map((am) => {
                      const sel = selCondivise[mv.id] ?? new Set<string>();
                      return (
                        <label key={am.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={sel.has(am.id)}
                            onChange={(e) => setSelCondivise((prev) => {
                              const next = { ...prev };
                              const s = new Set(next[mv.id] ?? []);
                              if (e.target.checked) s.add(am.id); else s.delete(am.id);
                              next[mv.id] = s;
                              return next;
                            })}
                          />
                          {am.nome}
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" disabled={salvandoCond} onClick={() => salvaCondivisione(mv.id)} style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>
                      {salvandoCond ? 'Salvataggio…' : 'Salva'}
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={richiediChiusura} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
