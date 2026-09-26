import { useEffect, useState } from 'react';
import { fetchQuestionariFiau, salvaQuestionarioFiau, type QuestionarioFiau } from '../../api/compliance';

/**
 * K9/§5.5 — questionario periodico FIAU (REQ), nella scheda «Compliance & AML». Una riga per anno: il
 * sistema raccoglie i dati per l'MLRO e registra il riferimento dopo l'invio manuale sul portale FIAU
 * (come la STR — prepara e registra, non invia). Scrittura riservata al responsabile/MLRO (403 gli altri).
 */
const STATI: { key: QuestionarioFiau['stato']; label: string; colore: string }[] = [
  { key: 'bozza', label: 'Bozza', colore: 'var(--muted)' },
  { key: 'completato', label: 'Completato', colore: 'var(--pill-amber-fg)' },
  { key: 'trasmesso', label: 'Trasmesso FIAU', colore: 'var(--pill-green-fg)' },
];
const etic = (s: string) => STATI.find((x) => x.key === s) ?? STATI[0];

export function PannelloQuestionarioFiau({ puoScrivere }: { puoScrivere: boolean }) {
  const [q, setQ] = useState<QuestionarioFiau[]>([]);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [anno, setAnno] = useState(new Date().getFullYear());
  const [note, setNote] = useState('');

  const carica = () => {
    setStato('loading');
    fetchQuestionariFiau().then((r) => { setQ(r.questionari); setStato('pronto'); }).catch(() => setStato('errore'));
  };
  useEffect(() => { carica(); /* eslint-disable-next-line */ }, []);

  const salva = async (nuovoStato: QuestionarioFiau['stato']) => {
    let riferimento: string | undefined;
    if (nuovoStato === 'trasmesso') {
      const rif = window.prompt('Riferimento FIAU rilasciato dopo l’invio del questionario:');
      if (rif === null) return;
      if (rif.trim().length < 3) { setMsg('Riferimento troppo corto.'); return; }
      riferimento = rif.trim();
    }
    setBusy(true); setMsg(null);
    try { await salvaQuestionarioFiau({ anno, stato: nuovoStato, note: note.trim() || undefined, riferimento }); setNote(''); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore salvataggio'); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Questionario periodico FIAU (REQ, §5.5)</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
        Una riga per anno. Il sistema raccoglie i dati per l’MLRO e registra il riferimento; l’invio avviene sul portale FIAU. Le domande esatte del REQ sono specifiche FIAU (da verificare).
      </p>
      {stato === 'loading' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && <div style={{ fontSize: 12, color: 'var(--pill-amber-fg)' }}>Impossibile leggere. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>}
      {stato === 'pronto' && (
        <>
          {q.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nessun questionario registrato.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.map((x) => (
                <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, background: 'var(--bg)', padding: 6, borderRadius: 6 }}>
                  <span style={{ fontWeight: 700, minWidth: 42 }}>{x.anno}</span>
                  <span style={{ fontWeight: 700, color: etic(x.stato).colore }}>{etic(x.stato).label}</span>
                  {x.riferimento && <span style={{ fontSize: 10, color: 'var(--muted)' }}>rif. {x.riferimento}{x.trasmessoAt ? ` · ${new Date(x.trasmessoAt).toLocaleDateString('it-IT')}` : ''}</span>}
                  {x.note && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{x.note}</span>}
                </div>
              ))}
            </div>
          )}
          {puoScrivere ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Anno
                <input type="number" value={anno} onChange={(e) => setAnno(Number(e.target.value))} min={2020} max={2100} style={{ fontSize: 12, width: 90 }} />
              </label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facoltative)" style={{ fontSize: 12, flex: 1, minWidth: 160 }} />
              <button type="button" disabled={busy} onClick={() => salva('completato')} className="btn btn-sm btn-secondary">✓ Completato</button>
              <button type="button" disabled={busy} onClick={() => salva('trasmesso')} className="btn btn-sm btn-primary">📤 Registra invio</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sola lettura: il questionario è riservato al responsabile o all’MLRO.</div>
          )}
          {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
        </>
      )}
    </div>
  );
}
