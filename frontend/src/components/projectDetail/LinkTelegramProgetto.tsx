/**
 * Il link con cui il cliente collega la sua chat Telegram a questa pratica.
 *
 * Perché esiste. L'instradamento dei messaggi in ingresso indovina la pratica dall'anagrafica: il
 * `chat_id` dev'essere in una sola scheda cliente **e** quel cliente deve avere una sola pratica
 * aperta. Il caso normale di uno studio — un cliente con due incarichi aperti — non soddisfa la
 * seconda condizione, e i messaggi di quel cliente non entrano in nessun fascicolo. Questo pulsante
 * chiude quel buco: il cliente tocca il link, preme Avvio, e da lì la chat è agganciata a **questa**
 * pratica invece che dedotta.
 *
 * Il pulsante è autonomo (`PannelloWebhookTelegram` è il precedente): carica da sé il link e
 * l'elenco delle chat collegate, e la testata che lo monta non deve passargli niente oltre l'id.
 *
 * Il link si compone sul server — la firma è un HMAC che il browser non ha (regola 6) — e va via
 * email o WhatsApp dallo stesso menu: le credenziali sono quelle dello studio, e l'invito spedito
 * viene registrato dal server nel fascicolo come comunicazione in uscita.
 */
import { useEffect, useState } from 'react';
import {
  fetchLinkTelegramApi,
  inviaLinkTelegramApi,
  fetchCollegamentiChatApi,
  revocaCollegamentoChatApi,
  type CollegamentoChat,
} from '../../api/progetti';

export function LinkTelegramProgetto({ progettoId }: { progettoId: string }) {
  const [aperto, setAperto] = useState(false);
  const [link, setLink] = useState<{ url: string; botUsername: string } | null>(null);
  const [caricandoLink, setCaricandoLink] = useState(false);
  const [inviando, setInviando] = useState<'email' | 'whatsapp' | null>(null);
  const [copiato, setCopiato] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [collegamenti, setCollegamenti] = useState<CollegamentoChat[]>([]);
  const [erroreElenco, setErroreElenco] = useState<string | null>(null);

  const caricaCollegamenti = async () => {
    try {
      setCollegamenti(await fetchCollegamentiChatApi(progettoId));
      setErroreElenco(null);
    } catch (err) {
      // L'elenco è informazione secondaria: il guasto si mostra dentro il menu, in piccolo, invece
      // di occupare la testata del progetto con un errore che non impedisce di lavorare.
      setErroreElenco(err instanceof Error ? err.message : 'Elenco dei collegamenti non disponibile.');
    }
  };

  useEffect(() => {
    void caricaCollegamenti();
    // `progettoId` cambia quando si passa a un'altra pratica senza smontare la pagina.
  }, [progettoId]);

  const apri = async () => {
    const prossimo = !aperto;
    setAperto(prossimo);
    setEsito(null);
    setCopiato(false);
    if (prossimo && !link) await caricaLink();
    if (prossimo) await caricaCollegamenti();
  };

  const caricaLink = async () => {
    setCaricandoLink(true);
    try {
      setLink(await fetchLinkTelegramApi(progettoId));
    } catch (err) {
      setEsito({ ok: false, testo: err instanceof Error ? err.message : 'Link Telegram non disponibile.' });
    } finally {
      setCaricandoLink(false);
    }
  };

  const copia = async () => {
    // Il link può non essere ancora arrivato (rete lenta, o il primo caricamento è fallito): si
    // prova a chiederlo ora invece di copiare una stringa vuota.
    let url = link?.url;
    if (!url) {
      try {
        const fresco = await fetchLinkTelegramApi(progettoId);
        setLink(fresco);
        url = fresco.url;
      } catch (err) {
        setEsito({ ok: false, testo: err instanceof Error ? err.message : 'Link Telegram non disponibile.' });
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiato(true);
      setEsito({ ok: true, testo: 'Link copiato: incollalo al cliente su qualunque canale.' });
      setTimeout(() => setCopiato(false), 2000);
    } catch {
      // Appunti non disponibili (contesto non sicuro, permesso negato): il link resta leggibile e
      // selezionabile qui sotto. Non si finge che la copia sia riuscita.
      setEsito({ ok: false, testo: 'Copia non riuscita: seleziona il link qui sotto e copialo a mano.' });
    }
  };

  const invia = async (canale: 'email' | 'whatsapp') => {
    setInviando(canale);
    setEsito(null);
    try {
      const r = await inviaLinkTelegramApi(progettoId, canale);
      setEsito({
        ok: true,
        testo: `Invito spedito a ${r.destinatario} (${canale === 'email' ? 'email' : 'WhatsApp'}). `
          + 'La comunicazione è registrata nel fascicolo.',
      });
    } catch (err) {
      setEsito({ ok: false, testo: err instanceof Error ? err.message : 'Invio non riuscito.' });
    } finally {
      setInviando(null);
    }
  };

  const revoca = async (id: string) => {
    setEsito(null);
    try {
      await revocaCollegamentoChatApi(progettoId, id);
      setEsito({ ok: true, testo: 'Collegamento revocato: quella chat non scrive più in questa pratica.' });
      await caricaCollegamenti();
    } catch (err) {
      setEsito({ ok: false, testo: err instanceof Error ? err.message : 'Revoca non riuscita.' });
    }
  };

  const bottone = (extra: React.CSSProperties): React.CSSProperties => ({
    background: 'var(--surface-1)',
    border: '1px solid var(--card2)',
    color: 'var(--indigo-l)',
    padding: '4px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    ...extra,
  });

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={apri}
        title="Fai arrivare i messaggi Telegram del cliente dentro questa pratica"
        style={bottone({ marginLeft: 8 })}
      >
        🔗 Link Telegram {aperto ? '▴' : '▾'}
      </button>

      {aperto && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            width: 420,
            maxWidth: '90vw',
            padding: 12,
            borderRadius: 10,
            background: 'var(--surface-1)',
            border: '1px solid var(--pill-blue-bg)',
            boxShadow: '0 10px 30px rgba(0,0,0,.45)',
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--cat-societario)', marginBottom: 6 }}>
            Collega la chat Telegram del cliente a questa pratica
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>
            Il cliente apre il link e preme Avvio: da quel momento i messaggi che scrive al bot
            entrano in questa pratica, anche se ha altre pratiche aperte.
          </div>

          {caricandoLink && <div style={{ fontSize: 11, color: 'var(--muted)' }}>⏳ Preparo il link…</div>}

          {link && (
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--pill-blue-fg)',
                background: 'var(--surface-2)',
                border: '1px solid var(--pill-blue-bg)',
                borderRadius: 6,
                padding: '6px 8px',
                marginBottom: 8,
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {link.url}
              <div style={{ color: 'var(--muted)', marginTop: 2 }}>bot: @{link.botUsername}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={copia} style={bottone({ background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)', border: '1px solid var(--pill-blue-bg)' })}>
              {copiato ? '✅ Copiato' : '📋 Copia link'}
            </button>
            <button
              type="button"
              disabled={inviando !== null}
              onClick={() => invia('email')}
              style={bottone({ background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)', border: '1px solid var(--pill-blue-bg)', opacity: inviando ? 0.6 : 1 })}
            >
              {inviando === 'email' ? '⏳ Invio…' : '✉️ Invia via email'}
            </button>
            <button
              type="button"
              disabled={inviando !== null}
              onClick={() => invia('whatsapp')}
              style={bottone({ background: 'var(--pill-blue-bg)', color: 'var(--pill-blue-fg)', border: '1px solid var(--pill-blue-bg)', opacity: inviando ? 0.6 : 1 })}
            >
              {inviando === 'whatsapp' ? '⏳ Invio…' : '💬 Invia via WhatsApp'}
            </button>
          </div>

          {esito && (
            <div
              style={{
                marginTop: 8,
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                background: esito.ok ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
                color: esito.ok ? 'var(--green)' : 'var(--pill-red-fg)',
                border: `1px solid ${esito.ok ? 'var(--pill-green-bd)' : 'var(--pill-red-bd)'}`,
              }}
            >
              {esito.testo}
            </div>
          )}

          <div style={{ marginTop: 10, borderTop: '1px solid var(--pill-blue-bg)', paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Chat collegate {collegamenti.length > 0 && `(${collegamenti.length})`}
            </div>
            {erroreElenco && <div style={{ fontSize: 10.5, color: 'var(--amber)' }}>{erroreElenco}</div>}
            {!erroreElenco && collegamenti.length === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                Nessuna chat ancora collegata: l'elenco si popola quando il cliente apre il link.
              </div>
            )}
            {collegamenti.map((c) => (
              <div
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, padding: '3px 0' }}
              >
                <span style={{ color: 'var(--pill-blue-fg)' }}>
                  {c.canale === 'telegram' ? '✈️' : '💬'} {c.chatId}
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  dal {new Date(c.creatoAt).toLocaleDateString('it-IT')}
                  {c.creatoDa === 'link' ? ' (dal link)' : ' (a mano)'}
                </span>
                <button
                  type="button"
                  onClick={() => revoca(c.id)}
                  title="Scollega: quella chat non scriverà più in questa pratica"
                  style={bottone({ marginLeft: 'auto', background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)' })}
                >
                  Scollega
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
