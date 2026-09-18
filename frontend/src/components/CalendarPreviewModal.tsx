/**
 * §1ter.5 (B5) — pianificare un'attività del fascicolo sul calendario.
 *
 * ## Cosa non andava
 *
 * **Il mini-calendario era una costante di agosto 2026.** Trentuno caselle costruite con
 * `Array.from({length: 31})`, ognuna datata `2026-08-${giorno}`, sotto un'intestazione letterale
 * `🗓 Agosto 2026`. In qualunque mese dell'anno, in qualunque anno, il modale mostrava agosto 2026:
 * si sceglieva un giorno su una griglia che non era il mese in cui lo si stava scegliendo, e la
 * data salvata era quella sbagliata senza che niente lo dicesse. I tre pulsanti rapidi erano
 * peggio, perché sembravano calcolati: «+3 Giorni» scriveva `2026-08-18`, «+1 Settimana»
 * `2026-08-22`, «Fine Mese» `2026-08-31` — tre date fisse travestite da scorciatoie.
 *
 * **L'operatore era un numero della UI.** Il `<select>` mandava `u.id`, che è un hash calcolato in
 * `useTeamMembers` per le chiavi React e gli avatar; `assegnato_a_id` è una chiave esterna verso
 * `user`, quindi quell'id non è mai stato valido. Si manda `dbId`.
 *
 * **La casella email prometteva un invio che non esiste.** «Invia Notifica Email & Reminder SMTP
 * all'Operatore ed al Cliente (24h prima)», spuntata di default: nessun codice leggeva quel
 * valore, nessuna email partiva, e il messaggio di conferma aggiungeva «e notificato
 * all'operatore!». Era la parte più dannosa del modale, perché una promessa di notifica si smette
 * di verificare a mano: chi pianificava una scadenza contava su un promemoria che nessuno avrebbe
 * ricevuto. La casella è stata tolta invece che lasciata spenta — una casella disattivata accanto
 * a un testo che le sopravvive continua a suggerire che la funzione esista.
 *
 * ## Cosa fa adesso
 *
 * La griglia viene da `grigliaDelMese`, si naviga mese per mese, e i tre pulsanti rapidi si
 * calcolano da **oggi** con `aggiungiGiorni`/`fineMese`. La conferma non si dichiara: si aspetta
 * la risposta del server, e se il server rifiuta il modale resta aperto e mostra il motivo che il
 * server ha dato — perché l'evento che conta è quello che si rivede dopo il ricaricamento, non
 * quello che il modale dice di aver creato.
 */
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useTeamMembers } from '../hooks/useTeamMembers';
import {
  aggiungiGiorni,
  etichettaGiorno,
  etichettaMese,
  fineMese,
  grigliaDelMese,
  meseDi,
  mesePrecedente,
  meseSuccessivo,
  oggi,
  type GiornoIso,
} from '../utils/calendarioDate';

/** Quello che il modale raccoglie. Un oggetto e non otto parametri posizionali. */
export interface PianificazioneScadenza {
  giorno: GiornoIso;
  /** `null` = tutto il giorno. */
  ora: string | null;
  /** L'uuid di una persona dello studio, oppure `null` per «non assegnata». */
  assegnatoAId: string | null;
  priorita: 'alta' | 'media' | 'normale';
  tipoAttivita: string;
  note: string | null;
  luogoUrl: string | null;
}

interface Props {
  isOpen: boolean;
  onChiudi: () => void;
  microvoceName: string;
  projectName: string;
  /** Il giorno da cui parte il modale. Se assente, oggi. */
  initialDate?: GiornoIso;
  /**
   * Salva la pianificazione. **Restituisce una promessa** perché il modale deve poter aspettare:
   * prima era `void`, e il modale mostrava «pianificata con successo» senza che nessuno avesse
   * ancora scritto niente da nessuna parte.
   */
  onSchedule: (p: PianificazioneScadenza) => Promise<void>;
}

const TIPI_ATTIVITA = [
  { valore: 'doc', etichetta: '📄 Scadenza presentazione documento / atto' },
  { valore: 'video', etichetta: '📹 Video call / Meet / Zoom col cliente' },
  { valore: 'riunione', etichetta: '🤝 Riunione in presenza in studio' },
  { valore: 'call', etichetta: '📞 Chiamata telefonica di allineamento' },
  { valore: 'fiscale', etichetta: '⚖️ Adempimento fiscale / deposito' },
] as const;

const GIORNI_SETTIMANA = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];

/**
 * L'etichetta leggibile di un tipo di attività.
 *
 * Esportata perché il titolo dell'evento — che si compone nel fascicolo, dove l'evento si salva —
 * deve dire la stessa cosa che il modale ha mostrato nella tendina. Con la mappa in un posto solo,
 * cambiare una voce non lascia il titolo a raccontare la versione precedente.
 */
export function etichettaTipoAttivita(valore: string): string {
  return TIPI_ATTIVITA.find((t) => t.valore === valore)?.etichetta ?? 'Attività';
}

const ETICHETTA: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--muted)',
  textTransform: 'uppercase', display: 'block', marginBottom: 6,
};
const SELECT: CSSProperties = {
  width: '100%', background: 'var(--card2)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: 'var(--text)',
};

export function CalendarPreviewModal({
  isOpen,
  onChiudi,
  microvoceName,
  projectName,
  initialDate,
  onSchedule,
}: Props) {
  const { team: teamList } = useTeamMembers();

  const oggiIso = oggi();
  const [giorno, setGiorno] = useState<GiornoIso>(initialDate || oggiIso);
  // Il mese mostrato dalla griglia è quello del giorno scelto, così si apre dove ci si aspetta.
  const [periodo, setPeriodo] = useState(() => meseDi(initialDate || oggiIso));
  const [ora, setOra] = useState('');
  const [assegnatoAId, setAssegnatoAId] = useState('');
  const [priorita, setPriorita] = useState<'alta' | 'media' | 'normale'>('alta');
  const [tipoAttivita, setTipoAttivita] = useState<string>('doc');
  const [note, setNote] = useState('');
  const [luogoUrl, setLuogoUrl] = useState('');
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  if (!isOpen) return null;

  const caselle = grigliaDelMese(periodo.anno, periodo.mese);
  const mostraLuogo = tipoAttivita === 'video' || tipoAttivita === 'riunione';

  const scegli = (g: GiornoIso) => {
    setGiorno(g);
    setPeriodo(meseDi(g));
  };

  const conferma = async (e: FormEvent) => {
    e.preventDefault();
    if (inCorso) return;

    setInCorso(true);
    setErrore(null);
    try {
      await onSchedule({
        giorno,
        ora: ora || null,
        assegnatoAId: assegnatoAId || null,
        priorita,
        tipoAttivita,
        note: note.trim() || null,
        luogoUrl: luogoUrl.trim() || null,
      });
      // Si chiude **dopo** che il salvataggio è riuscito. Prima si chiudeva sempre, con un
      // messaggio di successo comparso prima ancora della scrittura.
      onChiudi();
    } catch (err: any) {
      setErrore(err?.message || 'Salvataggio non riuscito.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16,
    }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20,
        maxWidth: 680, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: 26,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)', color: 'var(--text)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 800, letterSpacing: '1px' }}>
              📅 Pianificazione scadenzario studio
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 0 0' }}>Programma scadenza / riunione</h3>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Attività: <strong style={{ color: 'var(--indigo-l)' }}>{microvoceName}</strong> ({projectName})
            </div>
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16 }}>
            ✕
          </button>
        </div>

        {errore && (
          <div role="alert" style={{ background: '#450a0a', border: '1px solid #b91c1c', color: '#fecaca', padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600, marginBottom: 16 }}>
            ⚠️ {errore}
          </div>
        )}

        <form onSubmit={conferma}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginBottom: 18 }}>
            {/* ── La griglia del mese, calcolata ─────────────────────────────────── */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button type="button" aria-label="Mese precedente" onClick={() => setPeriodo(mesePrecedente(periodo.anno, periodo.mese))} style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>‹</button>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>🗓 {etichettaMese(periodo.anno, periodo.mese)}</span>
                  <button type="button" aria-label="Mese successivo" onClick={() => setPeriodo(meseSuccessivo(periodo.anno, periodo.mese))} style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>›</button>
                </div>
                <span style={{ fontSize: 10, color: 'var(--indigo-l)', fontWeight: 700 }}>
                  {etichettaGiorno(giorno)}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 9, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>
                {GIORNI_SETTIMANA.map((g) => <span key={g}>{g}</span>)}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {caselle.map((cella) => {
                  const scelto = cella.giorno === giorno;
                  const eOggi = cella.giorno === oggiIso;
                  return (
                    <button
                      key={cella.giorno}
                      type="button"
                      onClick={() => scegli(cella.giorno)}
                      title={etichettaGiorno(cella.giorno)}
                      style={{
                        padding: '6px 0', borderRadius: 6,
                        border: scelto ? '1.5px solid var(--indigo)' : eOggi ? '1.5px solid var(--muted)' : '1px solid transparent',
                        background: scelto ? 'var(--indigo)' : 'rgba(255,255,255,0.02)',
                        color: scelto ? '#fff' : 'var(--text)',
                        fontSize: 11, fontWeight: scelto || eOggi ? 800 : 500, cursor: 'pointer',
                        // I giorni di coda dei mesi vicini restano scelti ma spenti: completano
                        // le settimane, non sono il mese che si sta guardando.
                        opacity: cella.nelMese ? 1 : 0.4,
                      }}
                    >
                      {cella.numero}
                    </button>
                  );
                })}
              </div>

              {/* I tre pulsanti rapidi si calcolano da oggi: erano tre date fisse di agosto 2026. */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {[
                  { testo: '+3 giorni', valore: aggiungiGiorni(oggiIso, 3) },
                  { testo: '+1 settimana', valore: aggiungiGiorni(oggiIso, 7) },
                  { testo: 'Fine mese', valore: fineMese(oggiIso) },
                ].map((p) => (
                  <button
                    key={p.testo}
                    type="button"
                    onClick={() => scegli(p.valore)}
                    title={etichettaGiorno(p.valore)}
                    style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px', borderRadius: 6, fontSize: 9.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {p.testo}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Tipo, ora, operatore, priorità ─────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={ETICHETTA}>📌 Tipo di attività</label>
                <select value={tipoAttivita} onChange={(e) => setTipoAttivita(e.target.value)} style={SELECT}>
                  {TIPI_ATTIVITA.map((t) => <option key={t.valore} value={t.valore}>{t.etichetta}</option>)}
                </select>
              </div>

              <div>
                <label style={ETICHETTA}>⏰ Ora</label>
                <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} style={SELECT} />
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>Vuota = tutto il giorno</span>
              </div>

              <div>
                <label style={ETICHETTA}>👤 Operatore responsabile</label>
                <select value={assegnatoAId} onChange={(e) => setAssegnatoAId(e.target.value)} style={SELECT}>
                  <option value="">— non assegnata —</option>
                  {teamList.map((u) => (
                    // `dbId` e non `id`: `id` è l'hash con cui la UI disegna gli avatar, e in
                    // `assegnato_a_id` — chiave esterna verso `user` — non è mai stato valido.
                    <option key={u.dbId} value={u.dbId}>{u.n} ({u.r})</option>
                  ))}
                </select>
                {teamList.length === 0 && (
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    Nessun collaboratore assegnabile in questo studio.
                  </span>
                )}
              </div>

              <div>
                <label style={ETICHETTA}>Livello di priorità</label>
                <select value={priorita} onChange={(e) => setPriorita(e.target.value as 'alta' | 'media' | 'normale')} style={SELECT}>
                  <option value="alta">🔴 Alta (scadenza legale / AML / SDI)</option>
                  <option value="media">🟡 Media (bozza / documento)</option>
                  <option value="normale">🟢 Normale (verifica ordinaria)</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={ETICHETTA}>📝 Note operative</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Dettagli, ordine del giorno o istruzioni sui documenti da preparare…"
              rows={3}
              style={{ ...SELECT, borderRadius: 10, padding: '10px 12px', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          {mostraLuogo && (
            <div style={{ marginBottom: 18 }}>
              <label style={ETICHETTA}>📍 Link Meet / Zoom o luogo</label>
              <input
                type="text"
                value={luogoUrl}
                onChange={(e) => setLuogoUrl(e.target.value)}
                placeholder={tipoAttivita === 'video' ? 'https://meet.google.com/…' : 'Sala riunioni, indirizzo…'}
                style={{ ...SELECT, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>
          )}

          <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 20, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            ℹ️ L'attività compare nel calendario dello studio e resta agganciata a questa micro-voce.
            <strong> Non parte nessuna email e nessuna notifica</strong>: qui si scrive una scadenza,
            non si avvisa nessuno. Chi deve saperlo va avvisato a mano.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button type="button" onClick={onChiudi} style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Annulla
            </button>
            <button
              type="submit"
              disabled={inCorso}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: inCorso ? 'wait' : 'pointer', opacity: inCorso ? 0.7 : 1 }}
            >
              {inCorso ? 'Salvataggio…' : '✓ Salva attività in scadenzario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
