import { useEffect, useState } from 'react';
import { fetchKycFascicoloApi, fetchModuliTenant, sbloccaKycApi, type FascicoloKyc } from '../../api/kyc';

/**
 * Gate KYC lato progetto (K4, §8.1): il KYC si gestisce sul CLIENTE, il progetto lo CONSUMA come
 * banner. Legge il fascicolo del cliente e avvisa se la fatturazione è bloccata (pratica esistente
 * ma non approvata). Non mostra nulla se il modulo Compliance non è attivo per lo studio.
 * Il blocco vero lo applica il backend (409 su POST /invoices); questo è l'avviso a monte.
 */
export function GateKycProgetto({ clienteId }: { clienteId?: string | null }) {
  const [attivo, setAttivo] = useState(false);
  const [fasc, setFasc] = useState<FascicoloKyc | null>(null);
  const [noto, setNoto] = useState(false);
  // Sblocco motivato (override) locale: dopo un override riuscito il gate passa, anche se lo stato
  // della pratica resta non approvato — il banner lo riflette.
  const [sbloccato, setSbloccato] = useState(false);
  const [apriSblocco, setApriSblocco] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ovBusy, setOvBusy] = useState(false);
  const [ovErr, setOvErr] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    fetchModuliTenant().then((m) => { if (!annullato) setAttivo((m.attivi || []).includes('kyc')); }).catch(() => { /* fail-open: nessun banner */ });
    return () => { annullato = true; };
  }, []);

  useEffect(() => {
    let annullato = false;
    if (!clienteId) return;
    fetchKycFascicoloApi(clienteId)
      .then((r) => { if (!annullato) { setFasc(r.fascicolo); setNoto(true); } })
      .catch(() => { if (!annullato) setNoto(true); });
    return () => { annullato = true; };
  }, [clienteId]);

  if (!attivo) return null;

  const stato = fasc?.stato;
  const consente = stato === 'approvato' || stato === 'in_revisione';
  const box: React.CSSProperties = { fontSize: 12, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5, marginTop: 8 };

  const sblocca = async () => {
    if (!fasc) return;
    setOvBusy(true); setOvErr(null);
    try {
      await sbloccaKycApi(fasc.id, motivo.trim());
      setSbloccato(true); setApriSblocco(false); setMotivo('');
    } catch (e: any) {
      setOvErr(e?.message || 'Errore durante lo sblocco');
    } finally {
      setOvBusy(false);
    }
  };

  if (fasc && !consente && sbloccato) {
    return (
      <div style={{ ...box, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', border: '1px solid var(--pill-green-bg)' }}>
        🔓 Operatività sbloccata con override — la motivazione è registrata a audit. Lo sblocco vale 30 giorni; regolarizza il KYC del cliente.
      </div>
    );
  }
  if (fasc && !consente) {
    return (
      <div style={{ ...box, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', border: '1px solid var(--pill-red-bg)' }}>
        🛡 <strong>Fatturazione bloccata dal KYC</strong> — la pratica del cliente è in stato «{stato}», non approvata. Aprila dalla scheda cliente → «🛡 Compliance KYC» e approvala.
        {!apriSblocco ? (
          <div style={{ marginTop: 6 }}>
            <button type="button" onClick={() => { setApriSblocco(true); setOvErr(null); }} style={{ background: 'transparent', border: '1px solid var(--pill-red-fg)', color: 'var(--pill-red-fg)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>
              🔓 Sblocca con motivazione (admin)
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivazione dello sblocco (min. 10 caratteri) — resta a audit" style={{ width: '100%', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--pill-red-fg)', background: 'var(--card)', color: 'var(--text)' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={ovBusy || motivo.trim().length < 10} onClick={sblocca} style={{ background: 'var(--pill-red-fg)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: (ovBusy || motivo.trim().length < 10) ? 0.6 : 1 }}>
                {ovBusy ? 'Sblocco…' : 'Conferma sblocco'}
              </button>
              <button type="button" onClick={() => { setApriSblocco(false); setOvErr(null); }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Annulla</button>
            </div>
            {ovErr && <span style={{ fontSize: 11 }}>⚠️ {ovErr}</span>}
          </div>
        )}
      </div>
    );
  }
  if (fasc && consente) {
    return (
      <div style={{ ...box, background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', border: '1px solid var(--pill-green-bg)' }}>
        🛡 KYC approvato — la fatturazione è consentita.
      </div>
    );
  }
  if (noto && !fasc) {
    return (
      <div style={{ ...box, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', border: '1px solid var(--pill-amber-bg)' }}>
        🛡 KYC non avviato per questo cliente — consigliato aprirlo (scheda cliente → «Compliance KYC»); la fatturazione non è bloccata finché non esiste una pratica.
      </div>
    );
  }
  return null;
}
