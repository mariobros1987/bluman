// «Note della beta»: la raccolta di tutte le note scritte dalle pagine, divise per pagina.
// Serve a chi deve correggere: si filtrano le aperte, si segna «risolta» ciò che è stato sistemato,
// e «Copia tutto» mette l'elenco negli appunti, pronto da incollare a chi fa le correzioni.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aggiornaNotaBetaApi, eliminaNotaBetaApi, fetchNoteBetaApi, type NotaBeta, type StatoNotaBeta } from '../api/noteBeta';
import { ETICHETTA_TIPO_NOTA, noteBetaInTesto } from '../../../src/domain/notaBeta';
import { titoloDellaPagina } from '../utils/titoliPagine';
import { useToast } from '../components/ui/ToastProvider';

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function NoteBetaPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [note, setNote] = useState<NotaBeta[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'aperta' | 'risolta' | 'tutte'>('aperta');
  const [inCorso, setInCorso] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    try {
      setNote(await fetchNoteBetaApi());
    } catch (err) {
      setNote(null);
      setErrore(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, []);

  useEffect(() => { void carica(); }, [carica]);

  const visibili = useMemo(() => (note ?? []).filter((n) => filtro === 'tutte' || n.stato === filtro), [note, filtro]);
  const perPagina = useMemo(() => {
    const gruppi = new Map<string, NotaBeta[]>();
    for (const n of visibili) {
      const elenco = gruppi.get(n.pagina);
      if (elenco) elenco.push(n);
      else gruppi.set(n.pagina, [n]);
    }
    return [...gruppi.entries()].sort(([a], [b]) => titoloDellaPagina(a).localeCompare(titoloDellaPagina(b), 'it'));
  }, [visibili]);
  const aperte = (note ?? []).filter((n) => n.stato === 'aperta').length;

  const cambiaStato = async (n: NotaBeta, stato: StatoNotaBeta) => {
    setInCorso(n.id);
    try {
      const aggiornata = await aggiornaNotaBetaApi(n.id, stato);
      setNote((prima) => (prima ?? []).map((x) => (x.id === n.id ? aggiornata : x)));
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : 'La nota non è stata aggiornata');
    } finally {
      setInCorso(null);
    }
  };

  const elimina = async (n: NotaBeta) => {
    setInCorso(n.id);
    try {
      await eliminaNotaBetaApi(n.id);
      setNote((prima) => (prima ?? []).filter((x) => x.id !== n.id));
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : 'La nota non è stata eliminata');
    } finally {
      setInCorso(null);
    }
  };

  const copia = async () => {
    const testo = noteBetaInTesto(visibili, titoloDellaPagina);
    try {
      await navigator.clipboard.writeText(testo);
      toast.successo(`${visibili.length} ${visibili.length === 1 ? 'nota copiata' : 'note copiate'} negli appunti.`);
    } catch {
      // Appunti non disponibili (browser o permessi): si dichiara, il testo resta leggibile a schermo.
      toast.errore('Non sono riuscito a copiare negli appunti: seleziona il testo dalla pagina.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>📝 Note della beta</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            Ciò che chi prova il gestionale ha segnalato, pagina per pagina. Le note si scrivono dal pulsante 📝 in alto, accanto al titolo di ogni pagina.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>
            {aperte} {aperte === 1 ? 'aperta' : 'aperte'}
          </span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Quali note mostrare" style={{ padding: 8, fontSize: 12, width: 'auto' }}>
            <option value="aperta">Solo le aperte</option>
            <option value="risolta">Solo le risolte</option>
            <option value="tutte">Tutte</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={() => void copia()} disabled={visibili.length === 0}>
            📋 Copia tutto
          </button>
        </div>
      </div>

      {errore ? (
        <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', borderRadius: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Le note non sono state lette</div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>{errore}. Non vuol dire che non ce ne siano.</div>
          <button type="button" className="btn" onClick={() => void carica()}>Riprova</button>
        </div>
      ) : note === null ? (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, textAlign: 'center', color: 'var(--muted)' }}>Caricamento delle note…</div>
      ) : visibili.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 14, padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {note.length === 0
            ? 'Nessuna nota ancora. Chi prova il gestionale le scrive dal pulsante 📝 in alto, accanto al titolo di ogni pagina.'
            : filtro === 'aperta' ? 'Nessuna nota aperta: sono state tutte risolte.' : 'Nessuna nota risolta.'}
        </div>
      ) : (
        perPagina.map(([pagina, elenco]) => (
          <section key={pagina} aria-label={`Note su ${titoloDellaPagina(pagina)}`} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {titoloDellaPagina(pagina)} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{pagina} · {elenco.length}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {elenco.map((n) => (
                <div key={n.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'var(--card2)', opacity: n.stato === 'risolta' ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      <strong style={{ color: 'var(--text)' }}>{ETICHETTA_TIPO_NOTA[n.tipo] ?? n.tipo}</strong> · {n.autoreNome} · {quando(n.createdAt)}
                      {n.stato === 'risolta' && <span style={{ color: 'var(--green)', fontWeight: 700 }}> · ✓ risolta</span>}
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {n.percorso !== '/note-beta' && (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => navigate(n.percorso)} title={`Apri ${n.percorso}`}>Vai alla pagina</button>
                      )}
                      <button type="button" className="btn btn-sm btn-secondary" disabled={inCorso === n.id} onClick={() => void cambiaStato(n, n.stato === 'aperta' ? 'risolta' : 'aperta')}>
                        {n.stato === 'aperta' ? '✓ Segna risolta' : 'Riapri'}
                      </button>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={inCorso === n.id} onClick={() => void elimina(n)} aria-label="Elimina la nota">🗑</button>
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.testo}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
