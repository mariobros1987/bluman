/**
 * §1ter.5 (B1-B2) — la griglia del mese.
 *
 * Le caselle arrivano da `grigliaDelMese`, che le calcola dal periodo guardato; gli eventi
 * arrivano dal server. Qui non si fabbrica niente: una casella senza scadenze è una casella vuota,
 * che è un'informazione, mentre la tappa di progetto che questa griglia disegnava prima era una
 * bugia — cadeva in un giorno che nessun progetto aveva chiesto.
 *
 * Due dettagli che si vedono solo se mancano:
 *
 *  - **i giorni dei mesi vicini** sono disegnati in grigio ma restano cliccabili, perché servono a
 *    completare le settimane e una scadenza del 1° del mese prossimo si vede già dove cadrà;
 *  - **l'evidenziazione di oggi** non è una costante. Prima era `day === 14`, cioè il 14 agosto
 *    2026 per sempre.
 */
import type { EventoCalendario } from '../../api/calendario';
import { etichettaGiorno, eventiDelGiorno, oraMostrata, type CellaGiorno, type GiornoIso } from '../../utils/calendarioDate';
import { CATEGORIE, coloreCategoria } from './comune';

interface Props {
  caselle: CellaGiorno[];
  eventi: EventoCalendario[];
  oggiIso: GiornoIso;
  onApri: (e: EventoCalendario) => void;
  onCrea: (giorno: GiornoIso) => void;
}

const GIORNI_SETTIMANA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function VistaMese({ caselle, eventi, oggiIso, onApri, onCrea }: Props) {
  return (
    <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
        {GIORNI_SETTIMANA.map((g) => <div key={g}>{g}</div>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {caselle.map((cella) => {
          const delGiorno = eventiDelGiorno(eventi, cella.giorno);
          const isOggi = cella.giorno === oggiIso;

          return (
            <div
              key={cella.giorno}
              onDoubleClick={() => onCrea(cella.giorno)}
              title={`${etichettaGiorno(cella.giorno)} — doppio clic per una nuova scadenza`}
              style={{
                minHeight: 94,
                background: isOggi ? 'var(--card)' : 'var(--bg)',
                border: isOggi ? '2px solid var(--indigo)' : '1px solid var(--border)',
                borderRadius: 12,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                // I giorni di coda dei mesi vicini restano visibili ma spenti: sono lì per
                // allineare le colonne, non per essere il mese che si sta guardando.
                opacity: cella.nelMese ? 1 : 0.45,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: isOggi ? 'var(--indigo-l)' : 'var(--muted)' }}>
                  {cella.numero}{' '}
                  {isOggi && <span style={{ fontSize: 9, background: 'var(--indigo)', color: '#fff', padding: '1px 5px', borderRadius: 10 }}>Oggi</span>}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {delGiorno.map((ev) => {
                  const colore = coloreCategoria(ev.categoria);
                  const ora = oraMostrata(ev);
                  const fatto = ev.stato === 'fatto' || ev.stato === 'fatta';
                  const annullato = ev.stato === 'annullato';
                  return (
                    <div
                      key={ev.id}
                      onClick={() => onApri(ev)}
                      title={`${ev.titolo}${ora ? ` — ${ora}` : ' — tutto il giorno'}${ev.generato ? ' (scadenza automatica)' : ''}`}
                      style={{
                        background: colore.bg,
                        border: `1px solid ${colore.border}`,
                        color: colore.text,
                        padding: '3px 6px',
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        textDecoration: fatto || annullato ? 'line-through' : 'none',
                        opacity: fatto || annullato ? 0.6 : 1,
                      }}
                    >
                      {/* Il segno della derivazione si vede: `↻` distingue una scadenza che il
                          sistema deduce da una scritta da qualcuno, e spiega da solo perché non
                          ha una spunta. */}
                      {ev.generato ? '↻ ' : ''}{ora ? `${ora} ` : ''}{ev.titolo}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {eventi.length === 0 && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
          Nessuna scadenza in questo periodo. Il calendario mostra ciò che esiste nel database: un
          mese senza scadenze non viene riempito con esempi.
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>↻ = scadenza calcolata dal sistema, non si spunta qui</span>
        <span>Doppio clic su un giorno per aggiungere una scadenza</span>
        {(Object.keys(CATEGORIE) as Array<keyof typeof CATEGORIE>).map((c) => (
          <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: coloreCategoria(c).border, display: 'inline-block' }} />
            {CATEGORIE[c].nome}
          </span>
        ))}
      </div>
    </div>
  );
}
