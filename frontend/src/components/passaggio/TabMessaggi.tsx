import type { MessaggioDiMicrovoce } from '../../api/progetti';
import { LinkTelegramProgetto } from '../projectDetail/LinkTelegramProgetto';

/**
 * Tab 4: i messaggi che riguardano **questa** micro-voce.
 *
 * Perché esiste, ed è la ragione per cui tutta la funzione esiste: prima, per sapere se il cliente
 * avesse scritto qualcosa su una voce, bisognava rileggere la chat della pratica a mano — e la chat
 * di una pratica con dodici moduli è un posto dove le cose non si trovano. Qui la domanda ha una
 * risposta: si apre la voce e ci sono i messaggi che la riguardano.
 *
 * Sola lettura, di proposito. Abbinare e slegare si fa dalla chat, dove si vede il messaggio intero
 * con il suo contesto: un tasto «togli» qui, accanto a un messaggio senza la conversazione intorno,
 * sarebbe il posto sbagliato per una decisione che cambia il fascicolo. Qui si legge, e ogni
 * messaggio dichiara **perché** è lì — «dal link del cliente» o «a mano dall'operatore» — perché un
 * abbinamento automatico sbagliato si riconosce solo sapendo che era automatico.
 *
 * Il componente non carica da sé: i messaggi arrivano da `PassaggioModal`, che li chiede una volta
 * sola e così può scrivere il conteggio nella linguetta anche prima che la scheda si apra.
 */
export function TabMessaggi({
  messaggi,
  errore,
  progettoId,
  microvoceId,
  microvoceNome,
}: {
  messaggi: MessaggioDiMicrovoce[];
  errore: string | null;
  /** Per il link della voce: senza progetto non si compone, e il tasto non si mostra. */
  progettoId?: string;
  microvoceId?: string;
  microvoceNome?: string;
}) {
  const iconaCanale = (canale: string) =>
    canale === 'telegram' ? '✈️' : canale === 'whatsapp' ? '💬' : canale === 'signal' ? '🔒' : canale === 'email' ? '✉️' : '🌐';

  const motivo = (origine: string) =>
    origine === 'contesto'
      ? 'abbinata dal link che il cliente ha toccato'
      : origine === 'eredita'
        ? 'ereditata dal messaggio a cui risponde'
        : 'abbinata a mano dall\'operatore';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {errore && <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{errore}</div>}

      {!errore && messaggi.length === 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          Nessun messaggio abbinato a questa voce, per ora.
          <br />
          Si abbinano dalla scheda <strong>Comunicazioni</strong> della pratica: seleziona i messaggi
          e premi «🔗 Abbina a micro-voce». Oppure manda al cliente il <strong>link di questa voce</strong>:
          quello che scrive da lì in poi arriva qui da solo.
        </div>
      )}

      {/* Il link della voce sta qui e non nella testata della pratica, perché **qui** c'è la voce.
          Nella testata il tasto collega la chat alla pratica — che è la cosa giusta da quella
          posizione: da lì non si sta guardando nessuna voce in particolare. */}
      {progettoId && microvoceId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
          <span>Fai arrivare qui i messaggi del cliente:</span>
          <span style={{ marginLeft: -8 }}>
            <LinkTelegramProgetto progettoId={progettoId} microvoceId={microvoceId} microvoceNome={microvoceNome} />
          </span>
        </div>
      )}

      {messaggi.map((m) => (
        <div key={m.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--card2)', color: 'var(--muted)' }}>
                {iconaCanale(m.canale)} {m.canale}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                {m.direzione === 'uscita' ? '↗︎' : '↘︎'} {m.mittente}
              </span>
              <span
                title={`Messaggio ${motivo(m.origine)}`}
                style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'var(--pill-green-bg)', color: 'var(--green)', border: '1px solid var(--pill-green-bd)' }}
              >
                {m.origine === 'contesto' ? '🔗 dal link' : m.origine === 'eredita' ? '↩️ ereditata' : '✋ a mano'}
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {new Date(m.createdAt).toLocaleString('it-IT')}
            </span>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {m.testo}
          </div>
        </div>
      ))}
    </div>
  );
}
