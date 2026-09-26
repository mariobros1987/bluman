import { useEffect, useState } from 'react';
import { fetchBusinessRisk, salvaBusinessRisk, type BusinessRiskAssessment, type LivelloRischioBra } from '../../api/compliance';

/**
 * K9/§5.5 — valutazione del rischio dell'ATTIVITÀ (business risk assessment) dello studio, nella
 * scheda «Compliance & AML». Quattro fattori (clientela, servizi, geografia, canali), ognuno con
 * livello e motivazione (§6/§14); il livello complessivo è worst-case, calcolato dal server.
 * Versionata e mai sovrascritta: ogni salvataggio è una nuova versione. Scrittura al responsabile/MLRO.
 */
const LIVELLI: LivelloRischioBra[] = ['basso', 'medio', 'alto'];
const coloreLivello = (l: string) => (l === 'alto' ? 'var(--pill-red-fg)' : l === 'medio' ? 'var(--pill-amber-fg)' : 'var(--pill-green-fg)');
const FATTORI: { key: 'clientela' | 'servizi' | 'geografia' | 'canali'; label: string }[] = [
  { key: 'clientela', label: 'Clientela' },
  { key: 'servizi', label: 'Servizi / prodotti' },
  { key: 'geografia', label: 'Geografia' },
  { key: 'canali', label: 'Canali di distribuzione' },
];

export function PannelloBusinessRisk({ puoScrivere }: { puoScrivere: boolean }) {
  const [corrente, setCorrente] = useState<BusinessRiskAssessment | null>(null);
  const [numVersioni, setNumVersioni] = useState(0);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [liv, setLiv] = useState<Record<string, LivelloRischioBra>>({ clientela: 'basso', servizi: 'basso', geografia: 'basso', canali: 'basso' });
  const [mot, setMot] = useState<Record<string, string>>({ clientela: '', servizi: '', geografia: '', canali: '' });

  const carica = () => {
    setStato('loading');
    fetchBusinessRisk().then((r) => {
      setCorrente(r.corrente); setNumVersioni(r.storico.length);
      if (r.corrente) {
        setLiv({ clientela: r.corrente.clientelaLivello, servizi: r.corrente.serviziLivello, geografia: r.corrente.geografiaLivello, canali: r.corrente.canaliLivello });
        setMot({ clientela: r.corrente.clientelaMotivazione ?? '', servizi: r.corrente.serviziMotivazione ?? '', geografia: r.corrente.geografiaMotivazione ?? '', canali: r.corrente.canaliMotivazione ?? '' });
      }
      setStato('pronto');
    }).catch(() => setStato('errore'));
  };
  useEffect(() => { carica(); /* eslint-disable-next-line */ }, []);

  const salva = async () => {
    if (FATTORI.some((f) => mot[f.key].trim().length < 1)) { setMsg('Ogni fattore richiede una motivazione (§6).'); return; }
    setBusy(true); setMsg(null);
    try {
      await salvaBusinessRisk({
        clientelaLivello: liv.clientela, clientelaMotivazione: mot.clientela.trim(),
        serviziLivello: liv.servizi, serviziMotivazione: mot.servizi.trim(),
        geografiaLivello: liv.geografia, geografiaMotivazione: mot.geografia.trim(),
        canaliLivello: liv.canali, canaliMotivazione: mot.canali.trim(),
      });
      carica();
    } catch (e: any) { setMsg(e?.message || 'Errore salvataggio'); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>🏢</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Valutazione del rischio dello studio (§5.5)</span>
        {corrente && <span style={{ fontSize: 12, fontWeight: 700, color: coloreLivello(corrente.livelloComplessivo) }}>Complessivo: {corrente.livelloComplessivo.toUpperCase()}</span>}
        {corrente && <span style={{ fontSize: 11, color: 'var(--muted)' }}>v{corrente.versione} · prossima revisione {corrente.prossimaRevisione ? new Date(corrente.prossimaRevisione).toLocaleDateString('it-IT') : '—'}</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
        Quattro fattori, ognuno con livello e motivazione; il livello complessivo è worst-case (il più alto vince). Ogni salvataggio crea una nuova versione — la storia non si sovrascrive.
      </p>
      {stato === 'loading' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && <div style={{ fontSize: 12, color: 'var(--pill-amber-fg)' }}>Impossibile leggere la valutazione. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>}
      {stato === 'pronto' && !corrente && !puoScrivere && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nessuna valutazione registrata.</div>}
      {stato === 'pronto' && (corrente || puoScrivere) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FATTORI.map((f) => (
            <div key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, minWidth: 150, fontWeight: 600 }}>{f.label}</label>
              <select value={liv[f.key]} disabled={!puoScrivere} onChange={(e) => setLiv({ ...liv, [f.key]: e.target.value as LivelloRischioBra })} style={{ fontSize: 12 }}>
                {LIVELLI.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <input value={mot[f.key]} disabled={!puoScrivere} onChange={(e) => setMot({ ...mot, [f.key]: e.target.value })} placeholder="Motivazione (dati + giudizio)" style={{ fontSize: 12, flex: 1, minWidth: 200 }} />
            </div>
          ))}
          {puoScrivere ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="button" disabled={busy} onClick={salva} className="btn btn-sm btn-primary">{busy ? '…' : '💾 Salva nuova versione'}</button>
              {numVersioni > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{numVersioni} version{numVersioni === 1 ? 'e' : 'i'} in storico</span>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sola lettura: la valutazione è riservata al responsabile dello studio o all’MLRO.</div>
          )}
          {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
