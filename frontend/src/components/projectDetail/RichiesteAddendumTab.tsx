import { useState, useEffect } from 'react';
import { richiesteAddendumStudioApi, aggiornaStatoAddendumApi } from '../../api/client';
import type { RichiestaAddendum } from '../../api/client';

/**
 * §2.5 — richieste di addendum inviate dal cliente dal portale.
 *
 * Lo studio le prende in carico, prepara l'addendum e ne aggiorna lo stato; il cliente
 * vede ogni passaggio sul portale. Prima la "cronologia addendum" viveva nel
 * localStorage del browser del cliente: invisibile qui e persa al cambio dispositivo.
 */
export function RichiesteAddendumTab({ progettoId }: { progettoId: string }) {
  const [richieste, setRichieste] = useState<RichiestaAddendum[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [inAzione, setInAzione] = useState<string | null>(null);
  const [rispostaBozza, setRispostaBozza] = useState<Record<string, string>>({});

  const carica = async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      setRichieste(await richiesteAddendumStudioApi({ progettoId }));
    } catch (err: any) {
      setErrore(err?.message || 'Errore nel caricamento delle richieste di addendum.');
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { void carica(); }, [progettoId]);

  const aggiornaStato = async (r: RichiestaAddendum, stato: RichiestaAddendum['stato']) => {
    setInAzione(r.id);
    setErrore(null);
    try {
      await aggiornaStatoAddendumApi(r.id, {
        stato,
        rispostaStudio: (rispostaBozza[r.id] || '').trim() || undefined,
      });
      await carica();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante l\'aggiornamento della richiesta.');
    } finally {
      setInAzione(null);
    }
  };

  const badge: Record<RichiestaAddendum['stato'], { testo: string; sfondo: string; colore: string }> = {
    richiesta: { testo: '📨 RICEVUTA', sfondo: 'var(--amber)', colore: '#000' },
    in_preparazione: { testo: '⚙️ IN PREPARAZIONE', sfondo: 'var(--indigo)', colore: '#fff' },
    pronta: { testo: '✅ PRONTA PER LA FIRMA', sfondo: '#34d399', colore: '#000' },
    rifiutata: { testo: '⛔ RIFIUTATA', sfondo: '#b91c1c', colore: '#fff' },
  };

  if (caricamento) {
    return <div style={{ fontSize: 11, color: 'var(--muted)', padding: 12 }}>Caricamento richieste…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {errore && (
        <div style={{ background: '#2d1516', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 8, padding: 10, fontSize: 11 }}>
          ⚠️ {errore}
        </div>
      )}
      {richieste.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', padding: 12, borderRadius: 8 }}>
          Nessuna richiesta di addendum ricevuta dal portale per questo progetto.
        </div>
      ) : (
        richieste.map((r) => {
          const b = badge[r.stato] ?? badge.richiesta;
          return (
            <div key={r.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: b.sfondo, color: b.colore, fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>{b.testo}</span>
                  {r.cliente && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{r.cliente.nome}</span>}
                </div>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {new Date(r.createdAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: 10 }}>{r.testoRichiesta}</div>

              {(r.stato === 'richiesta' || r.stato === 'in_preparazione') ? (
                <>
                  <textarea
                    value={rispostaBozza[r.id] ?? r.rispostaStudio ?? ''}
                    onChange={(e) => setRispostaBozza({ ...rispostaBozza, [r.id]: e.target.value })}
                    placeholder="Risposta / nota per il cliente (facoltativa, visibile sul portale)…"
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontSize: 11, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {r.stato === 'richiesta' && (
                      <>
                        <button
                          onClick={() => void aggiornaStato(r, 'in_preparazione')}
                          disabled={inAzione === r.id}
                          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                        >
                          ⚙️ Prendi in carico
                        </button>
                        <button
                          onClick={() => void aggiornaStato(r, 'rifiutata')}
                          disabled={inAzione === r.id}
                          style={{ background: '#450a0a', border: '1px solid #b91c1c', color: '#fecaca', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                        >
                          ⛔ Rifiuta
                        </button>
                      </>
                    )}
                    {r.stato === 'in_preparazione' && (
                      <button
                        onClick={() => void aggiornaStato(r, 'pronta')}
                        disabled={inAzione === r.id}
                        style={{ background: '#14532d', border: '1px solid #16a34a', color: '#bbf7d0', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                      >
                        ✅ Addendum pronto (avvisa il cliente)
                      </button>
                    )}
                  </div>
                </>
              ) : (
                r.rispostaStudio && (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
                    <b style={{ color: 'var(--text)' }}>Risposta inviata al cliente:</b>{' '}
                    <span style={{ whiteSpace: 'pre-wrap' }}>{r.rispostaStudio}</span>
                  </div>
                )
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
