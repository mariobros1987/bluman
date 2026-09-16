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

export function PannelloWebhookTelegram({ segreti }: { segreti: { tgBotToken?: boolean } }) {
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
        style={{ background: '#0e4d78', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        {loading ? '⏳' : '📡 Stato Webhook'}
      </button>
      <button
        type="button"
        onClick={registra}
        disabled={registrando || senzaToken}
        title={senzaToken ? 'Salva prima il Bot Token' : 'Registra (o aggiorna) il webhook presso Telegram'}
        style={{ background: webhookAttivo ? '#065f46' : '#7c2d12', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
      >
        {registrando ? 'Registrando...' : webhookAttivo ? '🔄 Aggiorna Webhook' : '🔗 Registra Webhook'}
      </button>

      {esito && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 11.5, background: esito.ok ? '#052e16' : '#450a0a', color: esito.ok ? '#34d399' : '#fca5a5', border: `1px solid ${esito.ok ? '#166534' : '#991b1b'}` }}>
          {esito.testo}
        </div>
      )}

      {info && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, fontSize: 11, background: '#0c1a2e', border: '1px solid #1e3a5f' }}>
          <div style={{ marginBottom: 4, fontWeight: 700, color: '#38bdf8' }}>Stato webhook Telegram</div>
          <div>
            <span style={{ color: 'var(--muted)' }}>URL registrato: </span>
            {info.webhookUrl
              ? <span style={{ color: '#34d399' }}>✅ {info.webhookUrl}</span>
              : <span style={{ color: '#f87171' }}>❌ Non registrato — i messaggi non arriveranno</span>}
          </div>
          <div>
            <span style={{ color: 'var(--muted)' }}>Messaggi in coda: </span>
            <span style={{ color: info.pendingUpdateCount > 0 ? '#fbbf24' : '#34d399' }}>{info.pendingUpdateCount}</span>
            {info.pendingUpdateCount > 0 && <span style={{ color: '#fbbf24' }}> — Telegram li consegnerà al prossimo aggiornamento</span>}
          </div>
          {info.lastErrorMessage && (
            <div style={{ marginTop: 4, color: '#f87171' }}>
              ⚠️ Ultimo errore: {info.lastErrorMessage}
              {info.lastErrorDate && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>({new Date(info.lastErrorDate * 1000).toLocaleString('it-IT')})</span>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
