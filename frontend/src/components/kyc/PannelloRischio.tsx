import { useEffect, useState } from 'react';
import { fetchRischio, salvaRischio, type RiskAssessmentRiga, type LivelloRischio3 } from '../../api/kyc';

/**
 * K3 — valutazione del rischio a 4 pilastri (spec §6), nella scheda «Compliance KYC» del cliente.
 * Ogni pilastro Basso/Medio/Alto + motivazione; il livello complessivo è worst-case (il più alto).
 * Rischio alto → il backend imposta la verifica rafforzata. Ogni salvataggio crea una nuova versione.
 */
const PILASTRI = [
  { key: 'cliente', label: 'Cliente' },
  { key: 'geografia', label: 'Geografia' },
  { key: 'prodotto', label: 'Prodotto/servizio' },
  { key: 'canale', label: 'Canale' },
] as const;
const ORD: Record<LivelloRischio3, number> = { basso: 0, medio: 1, alto: 2 };
const PER_ORD: LivelloRischio3[] = ['basso', 'medio', 'alto'];
const COLORE: Record<LivelloRischio3, string> = { basso: 'var(--pill-green-fg)', medio: 'var(--pill-amber-fg)', alto: 'var(--pill-red-fg)' };

export function PannelloRischio({ fascicoloId, puoModificare }: { fascicoloId: string; puoModificare: boolean }) {
  const [corrente, setCorrente] = useState<RiskAssessmentRiga | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [liv, setLiv] = useState<Record<string, LivelloRischio3>>({ cliente: 'basso', geografia: 'basso', prodotto: 'basso', canale: 'basso' });
  const [mot, setMot] = useState<Record<string, string>>({ cliente: '', geografia: '', prodotto: '', canale: '' });

  const carica = () => {
    fetchRischio(fascicoloId).then((r) => {
      setCorrente(r.corrente);
      if (r.corrente) {
        setLiv({ cliente: r.corrente.clienteLivello, geografia: r.corrente.geografiaLivello, prodotto: r.corrente.prodottoLivello, canale: r.corrente.canaleLivello });
        setMot({ cliente: r.corrente.clienteMotivazione || '', geografia: r.corrente.geografiaMotivazione || '', prodotto: r.corrente.prodottoMotivazione || '', canale: r.corrente.canaleMotivazione || '' });
      }
    }).catch(() => { /* non bloccante */ });
  };
  useEffect(() => { if (fascicoloId) carica(); /* eslint-disable-next-line */ }, [fascicoloId]);

  const complessivo = PER_ORD[Math.max(ORD[liv.cliente!], ORD[liv.geografia!], ORD[liv.prodotto!], ORD[liv.canale!])]!;
  const completo = PILASTRI.every((p) => (mot[p.key] || '').trim().length > 0);

  const salva = async () => {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { motivazioneComplessiva: '' };
      for (const p of PILASTRI) { body[`${p.key}Livello`] = liv[p.key]; body[`${p.key}Motivazione`] = mot[p.key]; }
      const r = await salvaRischio(fascicoloId, body);
      setMsg(`Valutazione salvata: rischio ${r.complessivo}.`); carica();
    } catch (e: any) { setMsg(e?.message || 'Errore salvataggio'); } finally { setBusy(false); }
  };

  // RENDER_PLACEHOLDER
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>📊 Rischio a 4 pilastri</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLORE[complessivo] }}>Complessivo: {complessivo.toUpperCase()}</span>
        {complessivo === 'alto' && <span style={{ fontSize: 10, color: 'var(--muted)' }}>→ verifica rafforzata + approvazione MLRO</span>}
        {corrente && <span style={{ fontSize: 10, color: 'var(--muted)' }}>v{corrente.versione}{corrente.prossimaRevisione ? ` · revisione ${new Date(corrente.prossimaRevisione).toLocaleDateString('it-IT')}` : ''}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {PILASTRI.map((p) => (
          <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg)', padding: 8, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor={`rk-${p.key}`} style={{ fontSize: 11, fontWeight: 600 }}>{p.label}</label>
              <select id={`rk-${p.key}`} value={liv[p.key]} disabled={!puoModificare} onChange={(e) => setLiv((s) => ({ ...s, [p.key]: e.target.value as LivelloRischio3 }))} style={{ fontSize: 11 }}>
                <option value="basso">Basso</option><option value="medio">Medio</option><option value="alto">Alto</option>
              </select>
            </div>
            <textarea value={mot[p.key]} disabled={!puoModificare} onChange={(e) => setMot((s) => ({ ...s, [p.key]: e.target.value }))} rows={2} placeholder="Motivazione (obbligatoria per chiudere)" style={{ fontSize: 11, width: '100%' }} />
          </div>
        ))}
      </div>

      {!completo && <div style={{ fontSize: 10, color: 'var(--pill-amber-fg)' }}>⚠ Manca la motivazione su almeno un pilastro: la valutazione non è completa (§6).</div>}
      {puoModificare && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" disabled={busy} onClick={salva} className="btn btn-sm btn-primary">{busy ? '…' : '💾 Salva valutazione rischio'}</button>
          {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
