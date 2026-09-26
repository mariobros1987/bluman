import { useEffect, useState } from 'react';
import { fetchFormazione, salvaFormazione, type TrainingRecord } from '../../api/compliance';

/**
 * K9/§5.5 — registro della formazione AML dello studio (§7 TrainingRecord), nella scheda «Compliance
 * & AML». Log delle attività formative di MLRO, amministratori e personale; il cron avvisa quando la
 * cadenza è superata (§12). Scrittura riservata al responsabile/MLRO (il backend risponde 403 agli altri).
 */
const TIPI: { key: string; label: string }[] = [
  { key: 'mlro', label: 'MLRO' },
  { key: 'personale', label: 'Personale' },
  { key: 'amministratori', label: 'Amministratori' },
  { key: 'aggiornamento', label: 'Aggiornamento' },
  { key: 'altro', label: 'Altro' },
];
const etichettaTipo = (t: string) => TIPI.find((x) => x.key === t)?.label ?? t;

export function PannelloFormazione({ puoScrivere }: { puoScrivere: boolean }) {
  const [record, setRecord] = useState<TrainingRecord[]>([]);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [titolo, setTitolo] = useState('');
  const [tipo, setTipo] = useState('personale');
  const [data, setData] = useState('');
  const [partecipanti, setPartecipanti] = useState('');

  const carica = () => {
    setStato('loading');
    fetchFormazione().then((r) => { setRecord(r.record); setStato('pronto'); }).catch(() => setStato('errore'));
  };
  useEffect(() => { carica(); /* eslint-disable-next-line */ }, []);

  const salva = async () => {
    if (titolo.trim().length < 2) { setMsg('Titolo obbligatorio.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { setMsg('Data obbligatoria (AAAA-MM-GG).'); return; }
    setBusy(true); setMsg(null);
    try {
      await salvaFormazione({ titolo: titolo.trim(), tipo, data, partecipanti: partecipanti.trim() || undefined });
      setTitolo(''); setPartecipanti(''); setData(''); carica();
    } catch (e: any) { setMsg(e?.message || 'Errore salvataggio'); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>🎓</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Registro formazione AML (§5.5)</span>
        {record[0] && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Ultima: {new Date(record[0].data).toLocaleDateString('it-IT')}</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
        Attività formative di MLRO, amministratori e personale. Il sistema avvisa l’MLRO quando è passata la cadenza (12 mesi, da verificare).
      </p>
      {stato === 'loading' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && <div style={{ fontSize: 12, color: 'var(--pill-amber-fg)' }}>Impossibile leggere il registro. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>}
      {stato === 'pronto' && (
        <>
          {record.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nessuna formazione registrata.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {record.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, background: 'var(--bg)', padding: 6, borderRadius: 6 }}>
                  <span style={{ color: 'var(--muted)', minWidth: 78 }}>{new Date(r.data).toLocaleDateString('it-IT')}</span>
                  <span style={{ fontWeight: 600 }}>{r.titolo}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{etichettaTipo(r.tipo)}{r.partecipanti ? ` · ${r.partecipanti}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          {puoScrivere ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <input value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Titolo / argomento" style={{ fontSize: 12, flex: 1, minWidth: 160 }} />
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ fontSize: 12 }}>
                {TIPI.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ fontSize: 12 }} />
              <input value={partecipanti} onChange={(e) => setPartecipanti(e.target.value)} placeholder="Partecipanti" style={{ fontSize: 12, minWidth: 140 }} />
              <button type="button" disabled={busy} onClick={salva} className="btn btn-sm btn-primary">{busy ? '…' : '➕ Registra'}</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sola lettura: il registro è riservato al responsabile o all’MLRO.</div>
          )}
          {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
        </>
      )}
    </div>
  );
}
