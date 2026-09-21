import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSettimanaTimesheet,
  salvaVoceTimesheet,
  approvaVoceTimesheet,
  rifiutaVoceTimesheet,
  approvaSettimanaTimesheet,
  type SettimanaTimesheetApi,
  type VoceTimesheetApi,
} from '../api/client';
import { useToast } from '../components/ui/ToastProvider';

// ─────────────────────────────────────────────────────────────────
// BLOCCO 6.1 — TIMESHEET SETTIMANALE
// Griglia membro × giorno con registrazione ore (bozza), approvazione
// o rifiuto del responsabile. Le ore approvate alimentano il report
// "Ore per Operatore" (Blocco 5). Nessuna squadra finta: i membri
// arrivano da GET /timesheet (utenti reali del tenant).
//
// Regole di permesso:
// • l'operatore modifica SOLO le proprie celle (il backend scrive sempre
//   la riga del chiamante);
// • il responsabile (advisor/super_admin) vede la griglia completa e può
//   approvare/rifiutare qualunque cella, ma non ne modifica le ore;
// • una cella approvata è bloccata per tutti.
// ─────────────────────────────────────────────────────────────────

const NOMI_GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function parseIso(iso: string): Date {
  const parti = iso.split('-').map(Number);
  return new Date(parti[0] ?? 0, (parti[1] ?? 1) - 1, parti[2] ?? 1);
}

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const g = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${g}`;
}

/** Lunedì della settimana che contiene la data. */
function lunediDi(d: Date): Date {
  const copia = new Date(d);
  const offset = (copia.getDay() + 6) % 7; // 0 = lunedì
  copia.setDate(copia.getDate() - offset);
  copia.setHours(0, 0, 0, 0);
  return copia;
}

function aggiungiGiorni(d: Date, n: number): Date {
  const copia = new Date(d);
  copia.setDate(copia.getDate() + n);
  return copia;
}

function fmtOre(minuti: number): string {
  return (minuti / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

const STILE_TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const STILE_TD: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--text)',
  borderBottom: '1px solid var(--border)',
};

const COLORI_STATO: Record<string, { colore: string; sfondo: string; bordo: string; icona: string }> = {
  bozza: { colore: 'var(--amber)', sfondo: 'rgba(251,191,36,0.08)', bordo: 'rgba(251,191,36,0.35)', icona: '⏳' },
  approvato: { colore: 'var(--green)', sfondo: 'rgba(52,211,153,0.08)', bordo: 'rgba(52,211,153,0.35)', icona: '✓' },
  rifiutato: { colore: 'var(--red)', sfondo: 'rgba(248,113,113,0.08)', bordo: 'rgba(248,113,113,0.35)', icona: '✕' },
};

export function TimesheetPage() {
  const toast = useToast();
  const [inizio, setInizio] = useState<string>(() => toIso(lunediDi(new Date())));
  const [settimana, setSettimana] = useState<SettimanaTimesheetApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [azione, setAzione] = useState(false);
  const [cellaEditor, setCellaEditor] = useState<{ userId: string; giorno: string } | null>(null);

  // L'id dell'utente in sessione (UUID del DB) decide quali celle sono modificabili.
  const idCorrente = useMemo<string | undefined>(() => {
    try {
      const raw = localStorage.getItem('bluman_user');
      const u = raw ? JSON.parse(raw) : null;
      return typeof u?.id === 'string' ? u.id : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const carica = useCallback(async (inizioIso: string) => {
    setLoading(true);
    setErrore(null);
    try {
      const dati = await fetchSettimanaTimesheet(inizioIso);
      setSettimana(dati);
      setInizio(dati.inizio);
    } catch (err: any) {
      setErrore(err?.message || 'Errore nel caricamento del timesheet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carica(inizio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vaiSettimana = (delta: number) => {
    const nuovo = toIso(aggiungiGiorni(parseIso(inizio), delta * 7));
    carica(nuovo);
  };

  const giorniSettimana = useMemo(() => {
    if (!settimana) return [] as string[];
    const base = parseIso(settimana.inizio);
    return Array.from({ length: 7 }, (_, i) => toIso(aggiungiGiorni(base, i)));
  }, [settimana]);

  const vocePer = useCallback(
    (userId: string, giorno: string): VoceTimesheetApi | undefined =>
      settimana?.voci.find((v) => v.userId === userId && v.giorno === giorno),
    [settimana],
  );

  const bozzeDelMembro = useCallback(
    (userId: string): number => settimana?.voci.filter((v) => v.userId === userId && v.stato === 'bozza').length ?? 0,
    [settimana],
  );

  const oreTotaliMembro = useCallback(
    (userId: string): number =>
      settimana?.voci.filter((v) => v.userId === userId).reduce((s, v) => s + v.minuti, 0) ?? 0,
    [settimana],
  );

  const totaleSettimana = settimana?.voci.reduce((s, v) => s + v.minuti, 0) ?? 0;
  const bozzeSettimana = settimana?.voci.filter((v) => v.stato === 'bozza').length ?? 0;

  const etichettaPeriodo = useMemo(() => {
    if (!settimana) return '';
    const dal = parseIso(settimana.inizio);
    const al = parseIso(settimana.fine);
    const fmt = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    return `${fmt(dal)} – ${fmt(al)} ${al.getFullYear()}`;
  }, [settimana]);

  const approvaSettimanaMembro = async (userId?: string) => {
    if (!settimana) return;
    setAzione(true);
    try {
      await approvaSettimanaTimesheet(settimana.inizio, userId);
      await carica(settimana.inizio);
    } catch (err: any) {
      toast.errore(err?.message || 'Approvazione non riuscita');
    } finally {
      setAzione(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Intestazione + navigazione settimana */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>⏱️ Timesheet Settimanale</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Registrazione ore del team · le ore <strong style={{ color: 'var(--green)' }}>approvate</strong> alimentano il report «Ore per Operatore»
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => vaiSettimana(-1)} disabled={loading} style={stileNavButton}>←</button>
          <button onClick={() => carica(toIso(lunediDi(new Date())))} disabled={loading} style={{ ...stileNavButton, width: 'auto', padding: '8px 14px', fontSize: 11, fontWeight: 700 }}>
            Oggi
          </button>
          <button onClick={() => vaiSettimana(1)} disabled={loading} style={stileNavButton}>→</button>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 150, textAlign: 'center' }}>{etichettaPeriodo}</span>
        </div>
      </div>

      {/* Legenda + riepilogo */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
        <span><span style={{ color: 'var(--amber)' }}>⏳</span> Bozza</span>
        <span><span style={{ color: 'var(--green)' }}>✓</span> Approvato</span>
        <span><span style={{ color: 'var(--red)' }}>✕</span> Rifiutato</span>
        <span style={{ marginLeft: 'auto' }}>
          Totale settimana: <strong style={{ color: 'var(--text)' }}>{fmtOre(totaleSettimana)} h</strong>
          {bozzeSettimana > 0 && <> · in attesa di approvazione: <strong style={{ color: 'var(--amber)' }}>{bozzeSettimana}</strong></>}
        </span>
      </div>

      {errore && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', color: 'var(--red)', padding: '12px 16px', borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
          ⚠️ {errore}
        </div>
      )}

      {loading && !settimana ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>Caricamento timesheet…</div>
      ) : settimana && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ ...STILE_TH, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 2 }}>Membro</th>
                {giorniSettimana.map((g, i) => {
                  const d = parseIso(g);
                  const oggi = toIso(new Date()) === g;
                  return (
                    <th key={g} style={{ ...STILE_TH, textAlign: 'center', color: oggi ? 'var(--indigo-l, var(--indigo-l))' : STILE_TH.color, background: oggi ? 'rgba(99,102,241,0.07)' : undefined }}>
                      {NOMI_GIORNI[i]}<br />
                      <span style={{ fontWeight: 600, fontSize: 10 }}>{d.getDate()}/{d.getMonth() + 1}</span>
                    </th>
                  );
                })}
                <th style={{ ...STILE_TH, textAlign: 'center' }}>Totale</th>
                {settimana.puoApprovare && <th style={{ ...STILE_TH, textAlign: 'center' }}>Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {settimana.membri.length === 0 && (
                <tr>
                  <td colSpan={9 + (settimana.puoApprovare ? 1 : 0)} style={{ ...STILE_TD, textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
                    Nessun membro del team trovato per questo tenant.
                  </td>
                </tr>
              )}
              {settimana.membri.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...STILE_TD, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, fontWeight: 600 }}>
                    <div>{m.nome}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
                      {(m.specializzazione || m.ruolo || '').replace(/_/g, ' ')}
                    </div>
                  </td>
                  {giorniSettimana.map((g) => {
                    const voce = vocePer(m.id, g);
                    const stato = voce?.stato;
                    const stile = stato ? COLORI_STATO[stato] : undefined;
                    const modificabile = m.id === idCorrente && stato !== 'approvato';
                    const titolo = voce
                      ? `${fmtOre(voce.minuti)} h · ${stato}${voce.nota ? ` · ${voce.nota}` : ''}${voce.nomeProgetto ? ` · ${voce.nomeProgetto}` : ''}${voce.motivoRifiuto ? ` · Rifiutato: ${voce.motivoRifiuto}` : ''}`
                      : modificabile
                        ? 'Clicca per registrare le ore'
                        : stato === 'approvato'
                          ? 'Ore approvate (non modificabili)'
                          : '';
                    return (
                      <td key={g} style={{ ...STILE_TD, textAlign: 'center', padding: '6px 6px' }}>
                        <button
                          onClick={() => setCellaEditor({ userId: m.id, giorno: g })}
                          title={titolo}
                          style={{
                            minWidth: 62,
                            padding: '7px 8px',
                            borderRadius: 8,
                            border: `1px solid ${stile?.bordo || 'var(--border)'}`,
                            background: stile?.sfondo || 'transparent',
                            color: stile?.colore || 'var(--muted)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {voce ? <>{stile?.icona} {fmtOre(voce.minuti)}</> : modificabile ? '+' : '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ ...STILE_TD, textAlign: 'center', fontWeight: 800 }}>{fmtOre(oreTotaliMembro(m.id))} h</td>
                  {settimana.puoApprovare && (
                    <td style={{ ...STILE_TD, textAlign: 'center' }}>
                      {bozzeDelMembro(m.id) > 0 && (
                        <button
                          onClick={() => approvaSettimanaMembro(m.id)}
                          disabled={azione}
                          style={{
                            background: 'rgba(52,211,153,0.12)',
                            border: '1px solid rgba(52,211,153,0.4)',
                            color: 'var(--green)',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '6px 10px',
                            borderRadius: 8,
                            cursor: azione ? 'wait' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ✓ Approva ({bozzeDelMembro(m.id)})
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...STILE_TD, position: 'sticky', left: 0, background: 'var(--card)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)' }}>
                  Totale team
                </td>
                {giorniSettimana.map((g) => {
                  const minutiGiorno = settimana.voci.filter((v) => v.giorno === g).reduce((s, v) => s + v.minuti, 0);
                  return (
                    <td key={g} style={{ ...STILE_TD, textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 12 }}>
                      {minutiGiorno > 0 ? `${fmtOre(minutiGiorno)} h` : ''}
                    </td>
                  );
                })}
                <td style={{ ...STILE_TD, textAlign: 'center', fontWeight: 800 }}>{fmtOre(totaleSettimana)} h</td>
                {settimana.puoApprovare && (
                  <td style={{ ...STILE_TD, textAlign: 'center' }}>
                    {bozzeSettimana > 0 && (
                      <button
                        onClick={() => approvaSettimanaMembro()}
                        disabled={azione}
                        title="Approva tutte le bozze della settimana"
                        style={{
                          background: 'var(--indigo)',
                          border: 'none',
                          color: 'var(--on-accent)',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '6px 10px',
                          borderRadius: 8,
                          cursor: azione ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✓ Approva tutto
                      </button>
                    )}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {cellaEditor && settimana && (
        <EditorCella
          settimana={settimana}
          userId={cellaEditor.userId}
          giorno={cellaEditor.giorno}
          idCorrente={idCorrente}
          onClose={() => setCellaEditor(null)}
          onSalvato={() => {
            setCellaEditor(null);
            carica(settimana.inizio);
          }}
        />
      )}
    </div>
  );
}

const stileNavButton: React.CSSProperties = {
  width: 36,
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 14,
  cursor: 'pointer',
};

// ─────────────────────────────────────────────────────────────────
// Modale di dettaglio/modifica di una cella della griglia.
// ─────────────────────────────────────────────────────────────────
function EditorCella({
  settimana,
  userId,
  giorno,
  idCorrente,
  onClose,
  onSalvato,
}: {
  settimana: SettimanaTimesheetApi;
  userId: string;
  giorno: string;
  idCorrente?: string;
  onClose: () => void;
  onSalvato: () => void;
}) {
  const toast = useToast();
  const voce = settimana.voci.find((v) => v.userId === userId && v.giorno === giorno);
  const membro = settimana.membri.find((m) => m.id === userId);
  const propriaCella = Boolean(idCorrente && userId === idCorrente);
  const bloccata = voce?.stato === 'approvato';
  const modificabile = propriaCella && !bloccata;

  const [ore, setOre] = useState<string>(voce ? String(Math.round((voce.minuti / 60) * 100) / 100) : '');
  const [nota, setNota] = useState<string>(voce?.nota || '');
  const [progettoId, setProgettoId] = useState<string>(voce?.progettoId || '');
  const [salvataggio, setSalvataggio] = useState(false);

  const data = parseIso(giorno);
  const etichettaGiorno = data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const salva = async (minuti: number) => {
    setSalvataggio(true);
    try {
      await salvaVoceTimesheet({ giorno, minuti, nota, progettoId: progettoId || null });
      onSalvato();
    } catch (err: any) {
      toast.errore(err?.message || 'Salvataggio non riuscito');
      setSalvataggio(false);
    }
  };

  const approva = async () => {
    if (!voce) return;
    setSalvataggio(true);
    try {
      await approvaVoceTimesheet(voce.id);
      onSalvato();
    } catch (err: any) {
      toast.errore(err?.message || 'Approvazione non riuscita');
      setSalvataggio(false);
    }
  };

  const rifiuta = async () => {
    if (!voce) return;
    const motivo = window.prompt('Motivo del rifiuto (opzionale):') ?? undefined;
    setSalvataggio(true);
    try {
      await rifiutaVoceTimesheet(voce.id, motivo?.trim() || undefined);
      onSalvato();
    } catch (err: any) {
      toast.errore(err?.message || 'Rifiuto non riuscito');
      setSalvataggio(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, maxWidth: 460, width: '100%', padding: 22, color: 'var(--text)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l, var(--indigo-l))', fontWeight: 800, letterSpacing: '.5px' }}>
              ⏱️ Registrazione ore
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0 0' }}>{membro?.nome || 'Membro'}</h3>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, textTransform: 'capitalize' }}>{etichettaGiorno}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {voce && (
          <div style={{ fontSize: 11, marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${COLORI_STATO[voce.stato]?.bordo}`, background: COLORI_STATO[voce.stato]?.sfondo, color: COLORI_STATO[voce.stato]?.colore, fontWeight: 600 }}>
            Stato: {voce.stato}{voce.approvatoDa ? ` · approvato da ${voce.approvatoDa}` : ''}{voce.motivoRifiuto ? ` · motivo: ${voce.motivoRifiuto}` : ''}
          </div>
        )}

        {bloccata && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
            🔒 Ore già approvate: non sono più modificabili. Serve l'intervento del responsabile.
          </div>
        )}

        {modificabile ? (
          <>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>ORE LAVORATE</label>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={ore}
              onChange={(e) => setOre(e.target.value)}
              placeholder="es. 7.5"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg, var(--surface-2))', color: 'var(--text)', fontSize: 14, fontWeight: 700, marginBottom: 12 }}
            />

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>PROGETTO (OPZIONALE)</label>
            <select
              value={progettoId}
              onChange={(e) => setProgettoId(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg, var(--surface-2))', color: 'var(--text)', fontSize: 12, marginBottom: 12 }}
            >
              <option value="">— Nessun progetto specifico —</option>
              {settimana.progetti.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>NOTA (OPZIONALE)</label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Attività svolta…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg, var(--surface-2))', color: 'var(--text)', fontSize: 12, resize: 'vertical', marginBottom: 16 }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {voce && (
                <button
                  onClick={() => salva(0)}
                  disabled={salvataggio}
                  style={{ background: 'transparent', border: '1px solid rgba(248,113,113,0.4)', color: 'var(--red)', fontSize: 11, fontWeight: 700, padding: '9px 14px', borderRadius: 8, cursor: 'pointer' }}
                >
                  Svuota cella
                </button>
              )}
              <button
                onClick={() => {
                  const valore = Number(ore.replace(',', '.'));
                  if (!Number.isFinite(valore) || valore < 0 || valore > 24) {
                    toast.attenzione('Inserisci un numero di ore tra 0 e 24');
                    return;
                  }
                  salva(Math.round(valore * 60));
                }}
                disabled={salvataggio || ore.trim() === ''}
                style={{ background: 'var(--indigo)', border: 'none', color: 'var(--on-accent)', fontSize: 11, fontWeight: 700, padding: '9px 18px', borderRadius: 8, cursor: salvataggio ? 'wait' : 'pointer', opacity: salvataggio || ore.trim() === '' ? 0.6 : 1 }}
              >
                {salvataggio ? 'Salvataggio…' : 'Salva bozza'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
            {voce ? (
              <>
                Ore registrate: <strong style={{ color: 'var(--text)' }}>{fmtOre(voce.minuti)} h</strong>
                {voce.nomeProgetto && <> · Progetto: <strong style={{ color: 'var(--text)' }}>{voce.nomeProgetto}</strong></>}
                {voce.nota && <div>Nota: {voce.nota}</div>}
              </>
            ) : propriaCella ? (
              'Nessuna registrazione per questo giorno.'
            ) : (
              'Solo l\'operatore può registrare le proprie ore; il responsabile può approvarle o rifiutarle.'
            )}
          </div>
        )}

        {/* Azioni del responsabile sulla cella */}
        {settimana.puoApprovare && voce && !bloccata && (
          <div style={{ display: 'flex', gap: 8, marginTop: modificabile ? 12 : 0, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={approva}
              disabled={salvataggio}
              style={{ flex: 1, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', color: 'var(--green)', fontSize: 11, fontWeight: 700, padding: '9px 0', borderRadius: 8, cursor: 'pointer' }}
            >
              ✓ Approva ore
            </button>
            <button
              onClick={rifiuta}
              disabled={salvataggio}
              style={{ flex: 1, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.4)', color: 'var(--red)', fontSize: 11, fontWeight: 700, padding: '9px 0', borderRadius: 8, cursor: 'pointer' }}
            >
              ✕ Rifiuta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
