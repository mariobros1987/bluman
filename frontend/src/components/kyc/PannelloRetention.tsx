import { useState } from 'react';
import { concludiRetentionApi, prorogaRetentionApi, type FascicoloKyc } from '../../api/kyc';

/**
 * K9 — conservazione/retention (spec §5.4/§8.9) nella scheda «Compliance KYC» del cliente. Compare
 * solo a fascicolo CHIUSO (la conservazione parte dalla fine del rapporto). Mostra la scadenza e, a
 * scadenza raggiunta, permette all'MLRO di concludere con anonimizzazione (azzera davvero il PII) o
 * cancellazione, oppure di prorogare. Prima della scadenza le azioni sono spiegate ma disattive
 * (§8.9: nessuna cancellazione fisica prima). Riservato MLRO/admin: il backend risponde 403 agli altri.
 */
function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('it-IT');
}

export function PannelloRetention({ fascicolo, puoModificare, onAggiornato }: {
  fascicolo: FascicoloKyc; puoModificare: boolean; onAggiornato: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // La conservazione esiste solo dopo la chiusura.
  if (fascicolo.stato !== 'chiuso') return null;

  const esito = fascicolo.retentionEsito ?? null;
  const scadenza = fascicolo.retentionScadenza ?? null;
  const scaduta = !!scadenza && new Date(scadenza).getTime() <= Date.now();

  const concludi = async (tipo: 'anonimizzato' | 'cancellato') => {
    const testo = tipo === 'anonimizzato'
      ? 'Anonimizzare i dati personali del fascicolo? I dati identificativi (nome, codice fiscale, numeri documento) verranno azzerati in modo IRREVERSIBILE. La traccia di audit resta.'
      : 'Registrare la cancellazione della conservazione? (l’etichetta e l’evento restano a audit).';
    if (!window.confirm(testo)) return;
    setBusy(true); setMsg(null);
    try { await concludiRetentionApi(fascicolo.id, tipo); onAggiornato(); }
    catch (e: any) { setMsg(e?.message || 'Errore conclusione conservazione'); } finally { setBusy(false); }
  };
  const proroga = async () => {
    const al = window.prompt('Proroga la conservazione fino al (AAAA-MM-GG):');
    if (al === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(al.trim())) { setMsg('Data non valida (formato AAAA-MM-GG).'); return; }
    const motivo = window.prompt('Motivo della proroga (min. 10 caratteri):');
    if (motivo === null) return;
    if (motivo.trim().length < 10) { setMsg('Motivo troppo corto.'); return; }
    setBusy(true); setMsg(null);
    try { await prorogaRetentionApi(fascicolo.id, al.trim(), motivo.trim()); onAggiornato(); }
    catch (e: any) { setMsg(e?.message || 'Errore proroga'); } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>🗄️ Conservazione (retention)</div>
      {esito ? (
        <div style={{ fontSize: 11, color: 'var(--pill-green-fg)' }}>
          Conservazione conclusa con <strong>{esito === 'anonimizzato' ? 'anonimizzazione' : 'cancellazione'}</strong> il {fmtData(fascicolo.retentionEsitoAt)}.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: scaduta ? 'var(--pill-red-fg)' : 'var(--muted)' }}>
            Chiuso il {fmtData(fascicolo.chiusoAt)} · scadenza conservazione: <strong>{fmtData(scadenza)}</strong>
            {fascicolo.retentionProrogaAl && ` · prorogata al ${fmtData(fascicolo.retentionProrogaAl)}`}
            {scaduta ? ' · SCADUTA' : ''}
          </div>
          {puoModificare && (
            <>
              {scaduta ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => concludi('anonimizzato')}>🕵️ Anonimizza dati</button>
                  <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => concludi('cancellato')}>🗑️ Registra cancellazione</button>
                  <button type="button" disabled={busy} className="btn btn-sm" onClick={proroga}>⏳ Proroga</button>
                </div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Cancellazione e anonimizzazione saranno disponibili alla scadenza (§8.9: nessuna cancellazione prima). Puoi comunque <button type="button" disabled={busy} className="btn btn-sm" onClick={proroga}>prorogare</button>.
                </div>
              )}
            </>
          )}
        </>
      )}
      {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
    </div>
  );
}
