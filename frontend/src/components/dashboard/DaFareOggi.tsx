// «Da fare oggi»: in cima alla Dashboard, che cosa aspetta l'operatore e dove andare a farlo.
//
// Legge due elenchi che l'app ha già (rate dello Scadenzario, fatture d'acquisto) solo se l'utente
// può vederli, e conta. Le regole stanno in `utils/daFareOggi.ts`. Una lettura fallita si dichiara:
// non diventa «niente da fare».
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchScadenzarioIncassiApi, fetchFattureRicevuteApi, fetchContrattiRicorrentiApi } from '../../api/client';
import { getUserPermission } from '../../utils/rbac';
import { fmt } from '../../utils';
import { vociDaFare, type ContrattoPerDaFare, type FatturaAcquistoPerDaFare, type RataPerDaFare } from '../../utils/daFareOggi';

const COLORI: Record<'urgente' | 'presto' | 'info', { bg: string; fg: string; bordo: string; icona: string }> = {
  urgente: { bg: 'var(--pill-red-bg)', fg: 'var(--pill-red-fg)', bordo: 'var(--pill-red-bd)', icona: '⚠' },
  presto: { bg: 'var(--pill-amber-bg)', fg: 'var(--pill-amber-fg)', bordo: 'var(--pill-amber-bd)', icona: '⏳' },
  info: { bg: 'var(--pill-indigo-bg)', fg: 'var(--pill-indigo-fg)', bordo: 'var(--border)', icona: '•' },
};

export function DaFareOggi({ user, moduliInRitardo }: { user: unknown; moduliInRitardo: number }) {
  const navigate = useNavigate();
  const [rate, setRate] = useState<RataPerDaFare[] | null>(null);
  const [fatture, setFatture] = useState<FatturaAcquistoPerDaFare[] | null>(null);
  const [contratti, setContratti] = useState<ContrattoPerDaFare[] | null>(null);
  const [nonLetti, setNonLetti] = useState<string[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const vedeScadenzario = getUserPermission(user, 'scadenzario') !== 'denied';
  const vedeAcquisti = getUserPermission(user, 'invoices') !== 'denied';
  const vedeRetainer = getUserPermission(user, 'retainers') !== 'denied';

  useEffect(() => {
    let annullato = false;
    const errori: string[] = [];
    const letture: Promise<void>[] = [];
    if (vedeScadenzario) {
      letture.push(
        fetchScadenzarioIncassiApi({}, { rigettaSuErrore: true })
          .then((r) => { if (!annullato) setRate(Array.isArray(r) ? r : []); })
          .catch(() => { errori.push('le rate da incassare'); }),
      );
    }
    if (vedeAcquisti) {
      letture.push(
        fetchFattureRicevuteApi()
          .then((r) => { if (!annullato) setFatture(Array.isArray(r) ? r : []); })
          .catch(() => { errori.push('le fatture d’acquisto'); }),
      );
    }
    if (vedeRetainer) {
      letture.push(
        fetchContrattiRicorrentiApi({ rigettaSuErrore: true })
          .then((r) => { if (!annullato) setContratti(Array.isArray(r) ? r : []); })
          .catch(() => { errori.push('i contratti Retainer'); }),
      );
    }
    void Promise.all(letture).then(() => {
      if (annullato) return;
      setNonLetti(errori);
      setCaricamento(false);
    });
    return () => { annullato = true; };
  }, [vedeScadenzario, vedeAcquisti, vedeRetainer]);

  const voci = vociDaFare({ oggi: new Date(), rate, fattureAcquisto: fatture, contratti, moduliInRitardo });

  return (
    <section
      aria-labelledby="da-fare-oggi-titolo"
      style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}
    >
      <div id="da-fare-oggi-titolo" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
        ✅ Da fare oggi
      </div>

      {caricamento ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Controllo scadenze e ritardi…</div>
      ) : (
        <>
          {voci.length === 0 && nonLetti.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Niente di urgente: nessuna rata scaduta o in scadenza, nessuna fattura d’acquisto da pagare, nessun canone Retainer da fatturare, nessun modulo in ritardo.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {voci.map((v) => {
              const c = COLORI[v.tono];
              return (
                <div key={v.chiave} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: c.bg, border: `1px solid ${c.bordo}`, color: c.fg, borderRadius: 10, padding: '8px 12px', fontSize: 12.5 }}>
                  <span aria-hidden="true">{c.icona}</span>
                  <span style={{ fontWeight: 600 }}>{v.testo}</span>
                  {v.importoCentesimi != null && <span>· {fmt(v.importoCentesimi / 100)}</span>}
                  <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => navigate(v.vaiA)}>
                    {v.etichettaVaiA} →
                  </button>
                </div>
              );
            })}
          </div>
          {nonLetti.length > 0 && (
            <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--pill-red-fg)' }}>
              Non sono riuscito a leggere {nonLetti.join(' e ')}: questo riquadro può essere incompleto.
            </div>
          )}
        </>
      )}
    </section>
  );
}
