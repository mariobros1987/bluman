/**
 * Stato del webhook Telegram e pulsante che lo registra presso i server di Telegram.
 *
 * Perché esiste, e perché sta qui e non dentro la scheda: il test della scheda Telegram
 * chiama `getMe` e dice soltanto se il token è valido. Un token valido con il webhook
 * **non** registrato supera quel test, e i messaggi non arrivano lo stesso — è
 * esattamente il guasto rimasto invisibile fino al 16/09/2026. Questo pannello legge
 * `getWebhookInfo`, che è la prova vera della ricezione: URL registrato, messaggi in
 * coda, ultimo errore di consegna.
 *
 * Estratto da `TabChannels.tsx` (regola 8: sopra ~800 righe la pianificazione dello
 * split è obbligatoria). La scheda teneva insieme la configurazione di quattro canali
 * e questo pannello autonomo; il pannello è presentazionale e non conosce la scheda,
 * quindi sta in un file suo.
 *
 * Il bot token non arriva mai qui: il browser lo ha salvato e non lo rilegge (regola 6).
 * Il pannello sa solo *se* un token è stato salvato, e sono le rotte a usarlo.
 */
import { useState } from 'react';
import {
  registraWebhookTelegramApi,
  fetchWebhookInfoTelegramApi,
  type WebhookInfoTelegram,
} from '../../api/tenant';

export function PannelloWebhookTelegram({
  segreti,
  onUsername,
}: {
  segreti: { tgBotToken?: boolean };
  /**
   * Riceve lo username che la registrazione ha **corretto** in colonna.
   *
   * Serve perché la pagina tiene lo stesso valore in un campo di modulo: senza riallinearlo, il
   * primo «Salva» di un altro canale riscriverebbe il valore vecchio e disferebbe la correzione.
   * Si chiama solo quando la correzione c'è stata, così un campo compilato a mano non viene
   * riscritto quando è già giusto.
   */
  onUsername?: (username: string) => void;
}) {
  const [info, setInfo] = useState<WebhookInfoTelegram | null>(null);
  const [loading, setLoading] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);

  const aggiorna = async () => {
    setLoading(true);
    setEsito(null);
    const r = await fetchWebhookInfoTelegramApi();
    setLoading(false);
    if (r.ok && r.info) {
      setInfo(r.info);
    } else {
      setEsito({ ok: false, testo: r.errore || 'Errore lettura stato webhook.' });
    }
  };

  const registra = async () => {
    setRegistrando(true);
    setEsito(null);
    const r = await registraWebhookTelegramApi();
    setRegistrando(false);
    setEsito({ ok: r.ok, testo: r.ok ? (r.messaggio || 'Webhook registrato.') : (r.errore || 'Errore.') });
    // Il campo «Bot Username» nella pagina è ancora quello vecchio: la rotta lo ha corretto in
    // colonna leggendolo da Telegram, e lo stato del modulo va portato lì dov'è il database.
    if (r.ok && r.usernameCorretto && r.botUsername) onUsername?.(r.botUsername);
    if (r.ok) await aggiorna();
  };

  const webhookAttivo = info && info.webhookUrl !== '';
  const senzaToken = !segreti.tgBotToken;

  return (
    <>
      <button
        type="button"
        onClick={aggiorna}
        disabled={loading || senzaToken}
        title={senzaToken ? 'Salva prima il Bot Token' : 'Leggi stato ricezione da Telegram'}
        style={{ background: 'var(--cat-societario)', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        {loading ? '⏳' : '📡 Stato Webhook'}
      </button>
      <button
        type="button"
        onClick={registra}
        disabled={registrando || senzaToken}
        title={senzaToken ? 'Salva prima il Bot Token' : 'Registra (o aggiorna) il webhook presso Telegram'}
        style={{ background: webhookAttivo ? 'var(--green)' : 'var(--amber)', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        {registrando ? 'Registrando...' : webhookAttivo ? '🔄 Aggiorna Webhook' : '🔗 Registra Webhook'}
      </button>

      {esito && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 11.5, background: esito.ok ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)', color: esito.ok ? 'var(--green)' : 'var(--pill-red-fg)', border: `1px solid ${esito.ok ? 'var(--pill-green-bd)' : 'var(--pill-red-bd)'}` }}>
          {esito.testo}
        </div>
      )}

      {info && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, fontSize: 11, background: 'var(--surface-1)', border: '1px solid var(--pill-blue-bg)' }}>
          <div style={{ marginBottom: 4, fontWeight: 700, color: 'var(--cat-societario)' }}>Stato webhook Telegram</div>
          <div>
            <span style={{ color: 'var(--muted)' }}>URL registrato: </span>
            {info.webhookUrl
              ? <span style={{ color: 'var(--green)' }}>✅ {info.webhookUrl}</span>
              : <span style={{ color: 'var(--pill-red-fg)' }}>❌ Non registrato — i messaggi non arriveranno</span>}
          </div>
          <div>
            <span style={{ color: 'var(--muted)' }}>Messaggi in coda: </span>
            <span style={{ color: info.pendingUpdateCount > 0 ? 'var(--amber)' : 'var(--green)' }}>{info.pendingUpdateCount}</span>
            {info.pendingUpdateCount > 0 && <span style={{ color: 'var(--amber)' }}> — Telegram li consegnerà al prossimo aggiornamento</span>}
          </div>
          {info.lastErrorMessage && (
            <div style={{ marginTop: 4, color: 'var(--pill-red-fg)' }}>
              ⚠️ Ultimo errore: {info.lastErrorMessage}
              {info.lastErrorDate && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>({new Date(info.lastErrorDate * 1000).toLocaleString('it-IT')})</span>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
