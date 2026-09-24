import { useEffect, useState } from 'react';
import { fetchKycFascicoloApi, fetchModuliTenant, type FascicoloKyc } from '../../api/kyc';

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

  if (fasc && !consente) {
    return (
      <div style={{ ...box, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', border: '1px solid var(--pill-red-bg)' }}>
        🛡 <strong>Fatturazione bloccata dal KYC</strong> — la pratica del cliente è in stato «{stato}», non approvata. Aprila dalla scheda cliente → «🛡 Compliance KYC» e approvala prima di emettere fatture.
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
