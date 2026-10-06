import type { ReactNode } from 'react';
import type { MessaggioDiMicrovoce } from '../../api/progetti';
import { urlDocumentoAssoluto } from '../../api/client';
import { etichettaOrigine } from '../../utils/origineAbbinamento';
import { SpunteStato } from '../SpunteStato';
import { LinkTelegramProgetto } from '../projectDetail/LinkTelegramProgetto';

/**
 * Tab 4: i messaggi che riguardano **questa** micro-voce.
 *
 * Perché esiste, ed è la ragione per cui tutta la funzione esiste: prima, per sapere se il cliente
 * avesse scritto qualcosa su una voce, bisognava rileggere la chat della pratica a mano — e la chat
 * di una pratica con dodici moduli è un posto dove le cose non si trovano. Qui la domanda ha una
 * risposta: si apre la voce e ci sono i messaggi che la riguardano.
 *
 * Ogni messaggio dichiara **perché** è lì — «dal link del cliente», «a mano dall'operatore» — perché
 * un abbinamento automatico sbagliato si riconosce solo sapendo che era automatico. E il colore del
 * badge lo dice a colpo d'occhio: azzurro il cliente, grigio una persona, indaco questa voce, ambra
 * l'inferenza da controllare (`utils/origineAbbinamento.ts`).
 *
 * Abbinare e slegare si fa **dalla chat**, dove si vede il messaggio intero con il suo contesto: un
 * tasto «togli» qui, accanto a un messaggio senza la conversazione intorno, sarebbe il posto sbagliato
 * per una decisione che cambia il fascicolo. Il ritorno c'è comunque, ed è a un clic: ogni card porta
 * alla chat della pratica (`onApriInChat`), che è dove si legge la conversazione intera.
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
  onApriInChat,
  composer,
}: {
  messaggi: MessaggioDiMicrovoce[];
  errore: string | null;
  /** Per il link della voce: senza progetto non si compone, e il tasto non si mostra. */
  progettoId?: string;
  microvoceId?: string;
  microvoceNome?: string;
  /** Porta alla chat della pratica, chiudendo il modale. Assente: il tasto non si mostra. */
  onApriInChat?: () => void;
  /** Il compositore, costruito dal modale: qui la scheda è sola presentazione. */
  composer?: ReactNode;
}) {
  const iconaCanale = (canale: string) =>
    canale === 'telegram' ? '✈️' : canale === 'whatsapp' ? '💬' : canale === 'signal' ? '🔒' : canale === 'email' ? '✉️' : '🌐';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {errore && <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{errore}</div>}

      {/* Lo stato vuoto mette **l'azione** per prima e la spiegazione sotto: prima era il contrario —
          due righe che dicevano cosa fare, e sotto, in piccolo, la cosa da fare. */}
      {!errore && messaggi.length === 0 && (
        <>
          {progettoId && microvoceId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>Fai arrivare qui i messaggi del cliente:</span>
              <span style={{ marginLeft: -8 }}>
                <LinkTelegramProgetto progettoId={progettoId} microvoceId={microvoceId} microvoceNome={microvoceNome} />
              </span>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            Nessun messaggio abbinato a questa voce, per ora.
            <br />
            Chi tocca il link di questa voce da qui in poi arriva qui da solo. Oppure si abbinano dalla
            scheda <strong>Comunicazioni</strong> della pratica: seleziona i messaggi e premi
            «🔗 Abbina a micro-voce».
          </div>
        </>
      )}

      {/* Il link della voce sta qui e non nella testata della pratica, perché **qui** c'è la voce.
          Nella testata il tasto collega la chat alla pratica — che è la cosa giusta da quella
          posizione: da lì non si sta guardando nessuna voce in particolare. */}
      {messaggi.length > 0 && progettoId && microvoceId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
          <span>Fai arrivare qui i messaggi del cliente:</span>
          <span style={{ marginLeft: -8 }}>
            <LinkTelegramProgetto progettoId={progettoId} microvoceId={microvoceId} microvoceNome={microvoceNome} />
          </span>
        </div>
      )}

      {messaggi.map((m) => {
        const origine = etichettaOrigine(m.origine);
        const allegati = leggiAllegati(m.allegatiJson);
        return (
          <div key={m.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--card2)', color: 'var(--muted)' }}>
                  {iconaCanale(m.canale)} {m.canale}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                  {m.direzione === 'uscita' ? '↗︎' : '↘︎'} {m.mittente}
                </span>
                {/* Il segno di recapito solo sulle uscite: su una riga in entrata non c'è nessuna
                    consegna da dichiarare — il messaggio è nel fascicolo perché è arrivato. */}
                {m.direzione === 'uscita' && (
                  <SpunteStato
                    stato={m.stato}
                    inviatoAt={m.inviatoAt}
                    consegnatoAt={m.consegnatoAt}
                    lettoAt={m.lettoAt}
                    errore={m.errore}
                    contesto="operatore"
                  />
                )}
                <span
                  title={origine.motivo}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 10,
                    background: origine.sfondo,
                    color: origine.colore,
                    border: `1px solid ${origine.bordo}`,
                  }}
                >
                  {origine.etichetta}
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                {new Date(m.createdAt).toLocaleString('it-IT')}
              </span>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {m.testo}
            </div>

            {/* Gli allegati arrivavano fino al browser e non si vedevano mai: `allegatiJson` era
                scaricato e buttato. Per una voce che esiste per raccogliere documenti era il pezzo
                più utile a restare invisibile. */}
            {allegati.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allegati.map((att, idx) => (
                  <a
                    key={idx}
                    href={urlDocumentoAssoluto(att.url)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}
                  >
                    <span style={{ fontSize: 14 }}>📎</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)' }}>{att.nome}</span>
                    {att.dimensione && <span style={{ fontSize: 10, color: 'var(--muted)' }}>· {att.dimensione}</span>}
                  </a>
                ))}
              </div>
            )}

            {onApriInChat && (
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onApriInChat}
                  title="Apre la chat della pratica, dove si legge la conversazione intera e si toglie l'abbinamento"
                  style={{ background: 'transparent', border: 'none', color: 'var(--indigo)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}
                >
                  Apri nella chat della pratica →
                </button>
              </div>
            )}
          </div>
        );
      })}

      {composer}
    </div>
  );
}

/**
 * Gli allegati di un messaggio, letti dalla colonna JSON.
 *
 * Non lancia mai: un `allegatiJson` illeggibile è un messaggio senza allegati, non un errore da far
 * esplodere in faccia a chi sta leggendo un fascicolo — la stessa regola di `baseDaEsterno` lato
 * server, e per la stessa ragione.
 */
function leggiAllegati(grezzo: string | null): { nome: string; url: string; dimensione?: string }[] {
  if (!grezzo) return [];
  try {
    const letto = JSON.parse(grezzo);
    if (!Array.isArray(letto)) return [];
    return letto.filter((a) => a && typeof a.nome === 'string' && typeof a.url === 'string');
  } catch {
    return [];
  }
}
