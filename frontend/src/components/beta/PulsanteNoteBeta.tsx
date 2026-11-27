// Il pulsante «note della beta», uguale in ogni pagina (sta nella barra in alto): chi prova il
// gestionale scrive qui ciò che non va o che si può migliorare NELLA PAGINA CHE STA GUARDANDO.
//
// Le note stanno sul server. Il pulsante mostra quante ne ha aperte la pagina; il pannello le
// elenca e ne fa aggiungere una. Tre stati distinti (regola 13): caricamento, errore, nessuna nota.
// Un salvataggio fallito si dichiara e il testo scritto resta nel campo (regola 3).
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { creaNotaBetaApi, eliminaNotaBetaApi, fetchNoteBetaApi, type NotaBeta, type TipoNotaBeta } from '../../api/noteBeta';
import { ETICHETTA_TIPO_NOTA, LUNGHEZZA_MASSIMA_NOTA, LUNGHEZZA_MINIMA_NOTA, paginaGenerale } from '../../../../src/domain/notaBeta';

interface Props {
  /** L'indirizzo corrente (`location.pathname`). */
  percorso: string;
  /** Il nome della pagina mostrato nella barra in alto. */
  titoloPagina: string;
  /** L'id dell'utente della sessione: può eliminare le proprie note ancora aperte. */
  userId?: string | null;
}

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PulsanteNoteBeta({ percorso, titoloPagina, userId }: Props) {
  const pagina = paginaGenerale(percorso);
  const [aperto, setAperto] = useState(false);
  const [note, setNote] = useState<NotaBeta[] | null>(null);
  const [erroreLettura, setErroreLettura] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNotaBeta>('errore');
  const [testo, setTesto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroreSalvataggio, setErroreSalvataggio] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErroreLettura(null);
    try {
      setNote(await fetchNoteBetaApi({ pagina }));
    } catch (err) {
      setNote(null);
      setErroreLettura(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, [pagina]);

  // Si rilegge a ogni cambio di pagina: il numero sul pulsante è quello della pagina corrente.
  useEffect(() => {
    setNote(null);
    void carica();
  }, [carica]);

  const aperte = (note ?? []).filter((n) => n.stato === 'aperta').length;
  const testoPulito = testo.trim();
  const puoSalvare = testoPulito.length >= LUNGHEZZA_MINIMA_NOTA && !salvando;

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puoSalvare) return;
    setSalvando(true);
    setErroreSalvataggio(null);
    try {
      const nuova = await creaNotaBetaApi({ percorso, tipo, testo: testoPulito });
      setNote((prima) => [nuova, ...(prima ?? [])]);
      setTesto('');
    } catch (err) {
      // Il testo resta nel campo: la nota non è stata salvata e va potuta rimandare.
      setErroreSalvataggio(err instanceof Error ? err.message : 'La nota non è stata salvata');
    } finally {
      setSalvando(false);
    }
  };

  const elimina = async (id: string) => {
    setErroreSalvataggio(null);
    try {
      await eliminaNotaBetaApi(id);
      setNote((prima) => (prima ?? []).filter((n) => n.id !== id));
    } catch (err) {
      setErroreSalvataggio(err instanceof Error ? err.message : 'La nota non è stata eliminata');
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        onClick={() => setAperto(true)}
        title={`Note della beta su «${titoloPagina}»: scrivi cosa non va o cosa miglioreresti in questa pagina`}
        aria-label={`Note della beta su ${titoloPagina}${aperte > 0 ? `: ${aperte} ${aperte === 1 ? 'aperta' : 'aperte'}` : ''}`}
        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
      >
        <span aria-hidden="true">📝</span>
        {aperte > 0 && (
          <span style={{ background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', border: '1px solid var(--pill-amber-bd)', borderRadius: 10, padding: '0 6px', fontSize: 10.5, fontWeight: 700 }}>
            {aperte}
          </span>
        )}
      </button>

      {aperto && (
        <Modal onClose={() => setAperto(false)} labelledBy="note-beta-titolo" dirty={testoPulito.length > 0} messaggioUscita="Hai scritto una nota senza salvarla. Vuoi uscire lo stesso?">
          {(richiediChiusura) => (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div id="note-beta-titolo" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>📝 Note della beta — {titoloPagina}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    Scrivi cosa non funziona o cosa miglioreresti <strong>in questa pagina</strong>. La pagina, il tuo nome e la data li aggiunge l'app.
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={richiediChiusura} aria-label="Chiudi le note della beta">✕</button>
              </div>

              <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-label="Tipo di nota">
                  {(Object.keys(ETICHETTA_TIPO_NOTA) as TipoNotaBeta[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={tipo === t}
                      className={`btn btn-sm ${tipo === t ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTipo(t)}
                    >
                      {t === 'errore' ? '🐞' : t === 'miglioramento' ? '💡' : '❓'} {ETICHETTA_TIPO_NOTA[t]}
                    </button>
                  ))}
                </div>
                <label htmlFor="note-beta-testo" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  La tua nota
                </label>
                <textarea
                  id="note-beta-testo"
                  value={testo}
                  onChange={(e) => setTesto(e.target.value)}
                  maxLength={LUNGHEZZA_MASSIMA_NOTA}
                  rows={4}
                  placeholder="Es. Il pulsante «Salva» non fa niente se il campo data è vuoto."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, resize: 'vertical' }}
                />
                {erroreSalvataggio && (
                  <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 12.5 }}>
                    {erroreSalvataggio}. La nota non è stata salvata: il testo è ancora qui sopra, riprova.
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--hint)' }}>{testo.length} / {LUNGHEZZA_MASSIMA_NOTA}</span>
                  <button type="submit" className="btn btn-primary" disabled={!puoSalvare}>
                    {salvando ? 'Salvataggio…' : 'Aggiungi la nota'}
                  </button>
                </div>
              </form>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Note già scritte su questa pagina</div>
                {erroreLettura ? (
                  <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span>{erroreLettura}. Non vuol dire che non ce ne siano.</span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void carica()}>Riprova</button>
                  </div>
                ) : note === null ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Caricamento delle note…</div>
                ) : note.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Nessuna nota su questa pagina: la tua sarà la prima.</div>
                ) : (
                  note.map((n) => (
                    <div key={n.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', background: 'var(--card2)', opacity: n.stato === 'risolta' ? 0.65 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                        <span>
                          <strong style={{ color: 'var(--text)' }}>{ETICHETTA_TIPO_NOTA[n.tipo] ?? n.tipo}</strong> · {n.autoreNome} · {quando(n.createdAt)}
                          {n.stato === 'risolta' && <span style={{ color: 'var(--green)', fontWeight: 700 }}> · ✓ risolta</span>}
                        </span>
                        {n.stato === 'aperta' && userId && n.userId === userId && (
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void elimina(n.id)} aria-label="Elimina questa mia nota">Elimina</button>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.testo}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
