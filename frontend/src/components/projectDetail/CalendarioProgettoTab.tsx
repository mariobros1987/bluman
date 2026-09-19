/**
 * Lo scadenzario di un incarico, dentro il fascicolo.
 *
 * ## Quello che mostrava
 *
 * Quattro scadenze scritte nel sorgente, con date di agosto 2026 e i nomi di quattro persone:
 *
 *     { titolo: 'Consegna bozza Deed of Trust al Cliente', data: '18/08/2026', assegnatario: 'Joe Disabato' }
 *     { titolo: 'Deposito Istanza autorizzativa MFSA',      data: '22/08/2026', assegnatario: 'Francesca Disabato' }
 *     …
 *
 * Le stesse quattro per **ogni progetto di ogni studio**, comprese le persone che in quello studio
 * non lavorano. Erano dati di esempio rimasti in produzione, ed è la categoria peggiore: un elenco
 * vuoto si nota e si va a cercare perché, mentre un elenco plausible mette a tacere la domanda.
 *
 * Il pulsante «+ Programma Nuova Scadenza» poi aggiungeva a un `useState`, e confermava con un
 * `alert` che diceva *«integrata nel Calendario Studio!»*. Non era integrata in niente: spariva al
 * primo ricaricamento, e il calendario dello studio non l'ha mai vista.
 *
 * ## Quello che fa
 *
 * Chiede al server le scadenze **di questo progetto** (`progettoId` sulla rotta) e le mostra. La
 * finestra è quella dell'incarico — dalla data di inizio alla scadenza, allargata di un anno per
 * parte — e l'estremo è scritto in fondo alla scheda, perché una finestra che non si vede è una
 * finestra che taglia in silenzio.
 *
 * L'assegnatario viene dall'anagrafica dello studio, e la scrittura è una `POST` che il server può
 * rifiutare: se rifiuta, il motivo si legge nel modale e la scadenza non compare nell'elenco. Il
 * messaggio di successo non anticipa niente.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import type { Progetto } from '../../types';
import { creaEventoCalendario, fetchEventiCalendario, type EventoCalendario } from '../../api/calendario';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  aggiungiGiorni,
  etichettaGiorno,
  giornoDi,
  istanteDaGiornoEOra,
  oggi,
  oraMostrata,
} from '../../utils/calendarioDate';
import { CATEGORIE, ETICHETTE_STATO, coloreCategoria } from '../calendar/comune';

interface Props {
  project: Progetto;
}

const CAMPO: CSSProperties = { fontSize: 12 };
const ETICHETTA: CSSProperties = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 };

export function CalendarioProgettoTab({ project }: Props) {
  const { team } = useTeamMembers();

  const [eventi, setEventi] = useState<EventoCalendario[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);

  const [modaleAperto, setModaleAperto] = useState(false);
  const [titolo, setTitolo] = useState('');
  const [giorno, setGiorno] = useState(oggi());
  const [ora, setOra] = useState('');
  const [assegnatoAId, setAssegnatoAId] = useState('');
  const [priorita, setPriorita] = useState<'alta' | 'media' | 'normale'>('media');
  const [inCorso, setInCorso] = useState(false);
  const [erroreModale, setErroreModale] = useState<string | null>(null);

  /**
   * La finestra: **oggi ± un anno**.
   *
   * Non si ricava dalle date dell'incarico, e la ragione è che quelle date non sono date. Su
   * `Progetto` — il tipo che questa scheda riceve — `start` è `new Date(...).toLocaleDateString()`,
   * cioè una stringa formattata secondo la lingua del browser (`18/09/2026` in italiano), e `due`
   * è la costante letterale `'30 giorni'`, che sono i termini di pagamento, non una scadenza. Un
   * `slice(0, 10)` su `'18/09/2026'` restituisce `'18/09/2026'`: non è un giorno ISO, e passarlo a
   * `aggiungiGiorni` produce `Invalid Date`, quindi una richiesta con estremi non validi e un 400
   * dal server.
   *
   * Un anno per parte è la scelta, ed è dichiarata in fondo alla scheda: l'incarico è in corso
   * adesso, quindi le sue scadenze che contano stanno intorno ad adesso. La fine del progetto non
   * va persa per questo — è una scadenza derivata che il server colloca da `progetto.dataScadenza`,
   * e compare qui se cade nella finestra.
   */
  const intervallo = useMemo(() => {
    const adesso = oggi();
    return { da: aggiungiGiorni(adesso, -366), a: aggiungiGiorni(adesso, 366) };
  }, []);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const griglia = await fetchEventiCalendario({
        ...intervallo,
        progettoId: String(project.id),
      });
      setEventi(griglia.eventi);
      setErrore(null);
    } catch (err: any) {
      setEventi([]);
      setErrore(err?.message || 'Lettura delle scadenze dell\'incarico non riuscita.');
    } finally {
      setCaricamento(false);
    }
  }, [intervallo, project.id]);

  useEffect(() => { void carica(); }, [carica]);

  const ordinate = useMemo(
    () => [...eventi].sort((a, b) => a.dataInizio.localeCompare(b.dataInizio)),
    [eventi],
  );

  const invia = async (e: FormEvent) => {
    e.preventDefault();
    if (inCorso) return;
    if (!titolo.trim()) {
      setErroreModale('Il titolo è obbligatorio.');
      return;
    }

    setInCorso(true);
    setErroreModale(null);
    try {
      await creaEventoCalendario({
        titolo: titolo.trim(),
        dataInizio: istanteDaGiornoEOra(giorno, ora || null),
        categoria: 'promemoria',
        // Il progetto si manda sempre: è ciò che fa comparire la scadenza **in questa scheda**, e
        // senza di esso un promemoria scritto qui sarebbe indistinguibile da uno scritto altrove.
        progettoId: String(project.id),
        assegnatoAId: assegnatoAId || null,
        priorita,
      });
      setModaleAperto(false);
      setTitolo('');
      setOra('');
      setAssegnatoAId('');
      await carica();
    } catch (err: any) {
      setErroreModale(err?.message || 'Salvataggio non riuscito.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)' }}>
            📅 Scadenzario incarico
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Le scadenze a database di <strong>{project.cl}</strong>. Le stesse che si vedono nel
            calendario dello studio.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void carica()} style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ↻ Aggiorna
          </button>
          <button
            type="button"
            onClick={() => { setErroreModale(null); setModaleAperto(true); }}
            style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            + Programma nuova scadenza
          </button>
        </div>
      </div>

      {errore && (
        <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
          ⚠️ {errore}
        </div>
      )}

      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          ⏱ Scadenze dell'incarico
        </div>

        {caricamento ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            Lettura in corso…
          </div>
        ) : ordinate.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            Nessuna scadenza pianificata per questo incarico. Un elenco vuoto non viene riempito con
            esempi: quello che non c'è non si mostra.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ordinate.map((ev) => {
              const colore = coloreCategoria(ev.categoria);
              const fatto = ev.stato === 'fatto' || ev.stato === 'fatta';
              const oraEv = oraMostrata(ev);
              return (
                <div key={ev.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ fontSize: 18 }}>{fatto ? '✅' : '⏳'}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textDecoration: fatto ? 'line-through' : 'none' }}>
                        {ev.generato ? '↻ ' : ''}{ev.titolo}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {ev.assegnatoANome && <span>👤 {ev.assegnatoANome}</span>}
                        {ev.importoCentesimi !== null && <span>💶 {(ev.importoCentesimi / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>}
                        <span>{ETICHETTE_STATO[ev.stato]}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: colore.bg, border: `1px solid ${colore.border}`, color: colore.text, whiteSpace: 'nowrap' }}>
                      {CATEGORIE[ev.categoria].icona} {CATEGORIE[ev.categoria].nome}
                    </span>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', background: 'var(--card2)', padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      📅 {etichettaGiorno(giornoDi(ev.dataInizio))}{oraEv ? ` ${oraEv}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          Scadenze mostrate dal {etichettaGiorno(intervallo.da)} al {etichettaGiorno(intervallo.a)}.
        </div>
      </div>

      {modaleAperto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <form onSubmit={invia} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Programma nuova scadenza incarico</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              La scadenza compare nel calendario dello studio, non solo qui.
            </div>

            {erroreModale && (
              <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                ⚠️ {erroreModale}
              </div>
            )}

            <div>
              <label style={ETICHETTA}>Titolo scadenza / attività *</label>
              <input value={titolo} onChange={(e) => setTitolo(e.target.value)} required maxLength={200} placeholder="Es. Deposito statuto" style={CAMPO} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={ETICHETTA}>Data scadenza *</label>
                <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} required style={CAMPO} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={ETICHETTA}>Ora (facoltativa)</label>
                <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} style={CAMPO} />
              </div>
            </div>

            <div>
              <label style={ETICHETTA}>Assegnatario</label>
              <select value={assegnatoAId} onChange={(e) => setAssegnatoAId(e.target.value)} style={{ padding: 8, fontSize: 12, width: '100%' }}>
                <option value="">— non assegnata —</option>
                {team.map((m) => (
                  // `dbId`: `id` è l'hash con cui la UI disegna gli avatar, e `assegnato_a_id` è
                  // una chiave esterna verso `user`.
                  <option key={m.dbId} value={m.dbId}>{m.n} ({m.r})</option>
                ))}
              </select>
              {team.length === 0 && (
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Nessun collaboratore assegnabile in questo studio.
                </span>
              )}
            </div>

            <div>
              <label style={ETICHETTA}>Priorità</label>
              <select value={priorita} onChange={(e) => setPriorita(e.target.value as 'alta' | 'media' | 'normale')} style={{ padding: 8, fontSize: 12, width: '100%' }}>
                <option value="alta">🔴 Alta</option>
                <option value="media">🟡 Media</option>
                <option value="normale">🟢 Normale</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModaleAperto(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
                Annulla
              </button>
              <button type="submit" disabled={inCorso} style={{ background: 'var(--indigo)', color: 'var(--on-accent)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: inCorso ? 'wait' : 'pointer', opacity: inCorso ? 0.7 : 1 }}>
                {inCorso ? 'Salvataggio…' : '✓ Salva scadenza'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
