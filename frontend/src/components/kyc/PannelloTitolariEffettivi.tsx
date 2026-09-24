import { useEffect, useState } from 'react';
import { fetchTitolareEffettivo, aggiungiTitolareEffettivo, type TitolareEffettivoRiga, type CatenaCalcolata } from '../../api/kyc';

/**
 * K2 — pannello titolari effettivi + catena di controllo, dentro la scheda «Compliance KYC» del
 * cliente. Elenca i TE dichiarati, mostra la catena calcolata (chi supera la soglia dello studio)
 * e permette di aggiungere un TE. Il fascicolo (KycCase) è la radice.
 */
export function PannelloTitolariEffettivi({ fascicoloId, puoModificare }: { fascicoloId: string; puoModificare: boolean }) {
  const [titolari, setTitolari] = useState<TitolareEffettivoRiga[]>([]);
  const [catena, setCatena] = useState<CatenaCalcolata[]>([]);
  const [deposito, setDeposito] = useState<{ stato: string; scadenza: string | null } | null>(null);
  const [soglia, setSoglia] = useState(25);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // form aggiunta
  const [apri, setApri] = useState(false);
  const [den, setDen] = useState('');
  const [criterio, setCriterio] = useState('proprieta');
  const [perc, setPerc] = useState('');
  const [fonte, setFonte] = useState('autodichiarazione');

  const carica = () => {
    fetchTitolareEffettivo(fascicoloId)
      .then((r) => { setTitolari(r.titolari); setCatena(r.catena); setDeposito(r.deposito); setSoglia(r.soglia); })
      .catch((e) => setErrore(e?.message || 'Errore lettura titolari effettivi'));
  };
  useEffect(() => { if (fascicoloId) carica(); /* eslint-disable-next-line */ }, [fascicoloId]);

  const aggiungi = async () => {
    if (den.trim().length < 2) { setErrore('Denominazione obbligatoria.'); return; }
    setBusy(true); setErrore(null);
    try {
      await aggiungiTitolareEffettivo(fascicoloId, {
        denominazione: den.trim(), criterio,
        percentuale: perc ? Number(perc) : undefined, fonte,
      });
      setDen(''); setPerc(''); setApri(false); carica();
    } catch (e: any) { setErrore(e?.message || 'Errore aggiunta'); } finally { setBusy(false); }
  };

  // RENDER_PLACEHOLDER
  const cella: React.CSSProperties = { fontSize: 12 };
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>👤 Titolari effettivi & catena di controllo</div>
      {errore && <div style={{ fontSize: 11, color: 'var(--pill-red-fg)' }}>⚠️ {errore}</div>}

      {titolari.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nessun titolare effettivo dichiarato.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', ...cella }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '4px 6px', fontWeight: 600 }}>Soggetto</th><th style={{ padding: '4px 6px', fontWeight: 600 }}>Criterio</th><th style={{ padding: '4px 6px', fontWeight: 600 }}>%</th><th style={{ padding: '4px 6px', fontWeight: 600 }}>Fonte</th>
          </tr></thead>
          <tbody>{titolari.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '4px 6px' }}>{t.soggetto.denominazione}</td>
              <td style={{ padding: '4px 6px' }}>{t.criterio}</td>
              <td style={{ padding: '4px 6px' }}>{t.percentuale != null ? `${Number(t.percentuale)}%` : '—'}</td>
              <td style={{ padding: '4px 6px' }}>{t.fonte}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        <strong>Catena di controllo</strong> — titolari effettivi ultimi ≥ {soglia}%:{' '}
        {catena.length === 0 ? <em>nessuno raggiunge la soglia (o catena non inserita)</em> : catena.map((c) => `${c.soggettoId.slice(0, 8)}… ${c.percentualeEffettiva}%`).join(' · ')}
      </div>

      {deposito && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          Deposito registro TE: <strong style={{ color: 'var(--text)' }}>{deposito.stato}</strong>{deposito.scadenza ? ` — scad. ${new Date(deposito.scadenza).toLocaleDateString('it-IT')}` : ''}
        </div>
      )}

      {puoModificare && (apri ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', background: 'var(--bg)', padding: 8, borderRadius: 8 }}>
          <input value={den} onChange={(e) => setDen(e.target.value)} placeholder="Nome e cognome del TE" style={{ flex: 2, minWidth: 160, fontSize: 12 }} />
          <select value={criterio} onChange={(e) => setCriterio(e.target.value)} style={{ fontSize: 12 }}>
            <option value="proprieta">Proprietà</option><option value="controllo">Controllo</option><option value="altro">Altro</option>
          </select>
          <input value={perc} onChange={(e) => setPerc(e.target.value)} type="number" placeholder="%" style={{ width: 70, fontSize: 12 }} />
          <select value={fonte} onChange={(e) => setFonte(e.target.value)} style={{ fontSize: 12 }}>
            <option value="autodichiarazione">Autodich.</option><option value="registro_camerale">Registro</option>
          </select>
          <button type="button" disabled={busy} onClick={aggiungi} className="btn btn-sm btn-primary">{busy ? '…' : 'Aggiungi'}</button>
          <button type="button" onClick={() => setApri(false)} className="btn btn-sm btn-secondary">Annulla</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setApri(true); setErrore(null); }} className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }}>+ Aggiungi titolare effettivo</button>
      ))}
    </div>
  );
}
