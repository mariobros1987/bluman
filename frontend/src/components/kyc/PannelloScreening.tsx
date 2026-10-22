import { useEffect, useState } from 'react';
import {
  fetchScreening, registraScreening, risolviScreening,
  type ScreeningRiga, type TipoScreening, type EsitoScreening,
} from '../../api/kyc';

/**
 * K5 — screening PEP / sanzioni / media negativi (processo MANUALE, spec §5.1.5/§8.4/§10), nella
 * scheda «Compliance KYC» del cliente. L'operatore registra l'esito (con eventuale allegato); un
 * match non risolto blocca l'approvazione della pratica, con motivo esplicito (regole 12/13).
 */
const TIPI: { key: TipoScreening; label: string }[] = [
  { key: 'sanzioni', label: 'Liste sanzionatorie (OFAC/UE/ONU)' },
  { key: 'pep', label: 'PEP' },
  { key: 'media_negativi', label: 'Media negativi' },
];
const ESITI: { key: EsitoScreening; label: string }[] = [
  { key: 'nessun_match', label: 'Nessun match' },
  { key: 'match_da_valutare', label: 'Match da valutare' },
  { key: 'match_confermato', label: 'Match confermato' },
  { key: 'falso_positivo', label: 'Falso positivo' },
];
const ETICHETTA: Record<string, string> = {
  sanzioni: 'Sanzioni', pep: 'PEP', media_negativi: 'Media negativi',
  nessun_match: 'Nessun match', match_da_valutare: 'Match da valutare',
  match_confermato: 'Match confermato', falso_positivo: 'Falso positivo',
};
const COLORE_ESITO: Record<string, string> = {
  nessun_match: 'var(--pill-green-fg)', falso_positivo: 'var(--pill-green-fg)',
  match_da_valutare: 'var(--pill-amber-fg)', match_confermato: 'var(--pill-red-fg)',
};

function leggiBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('lettura file'));
    r.readAsDataURL(file);
  });
}

export function PannelloScreening({ fascicoloId, puoModificare }: { fascicoloId: string; puoModificare: boolean }) {
  const [righe, setRighe] = useState<ScreeningRiga[]>([]);
  const [blocca, setBlocca] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoScreening>('sanzioni');
  const [esito, setEsito] = useState<EsitoScreening>('nessun_match');
  const [fonte, setFonte] = useState('');
  const [dettagli, setDettagli] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const carica = () => {
    setStato('loading');
    fetchScreening(fascicoloId)
      .then((r) => { setRighe(r.screenings); setBlocca(r.bloccaApprovazione); setMotivo(r.motivoBlocco); setStato('pronto'); })
      .catch(() => setStato('errore'));
  };
  useEffect(() => { if (fascicoloId) carica(); /* eslint-disable-next-line */ }, [fascicoloId]);

  const salva = async () => {
    setBusy(true); setMsg(null);
    try {
      const allegato = file ? { allegatoFilename: file.name, allegatoContentBase64: await leggiBase64(file) } : {};
      await registraScreening(fascicoloId, { tipo, esito, fonte: fonte || undefined, matchDettagli: dettagli || undefined, ...allegato });
      setMsg('Screening registrato.'); setDettagli(''); setFile(null); setFonte(''); setEsito('nessun_match'); carica();
    } catch (e: any) { setMsg(e?.message || 'Errore registrazione'); } finally { setBusy(false); }
  };

  const risolvi = async (r: ScreeningRiga, nuovoEsito: 'falso_positivo' | 'match_confermato') => {
    const nota = window.prompt(nuovoEsito === 'falso_positivo'
      ? 'Motiva perché è un falso positivo (min. 10 caratteri):'
      : 'Motiva la conferma del match (min. 10 caratteri):');
    if (nota === null) return;
    setBusy(true); setMsg(null);
    try { await risolviScreening(fascicoloId, r.id, nuovoEsito, nota); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore risoluzione'); } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>🔎 Screening PEP / sanzioni / media negativi</div>
      {blocca && motivo && (
        <div style={{ fontSize: 11, color: 'var(--pill-red-fg)', background: 'var(--bg)', border: '1px solid var(--pill-red-fg)', borderRadius: 8, padding: 8 }}>⛔ {motivo}</div>
      )}
      {stato === 'loading' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && (
        <div style={{ fontSize: 11, color: 'var(--pill-amber-fg)' }}>Impossibile leggere gli screening. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>
      )}
      {stato === 'pronto' && righe.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nessuno screening registrato. Un match non risolto bloccherà l'approvazione (§8.4).</div>
      )}
      {stato === 'pronto' && righe.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {righe.map((r) => {
            const nonRisolto = r.esito === 'match_da_valutare' || r.esito === 'match_confermato';
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--bg)', padding: 8, borderRadius: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{ETICHETTA[r.tipo]}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: COLORE_ESITO[r.esito] }}>{ETICHETTA[r.esito]}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(r.dataScreening).toLocaleDateString('it-IT')}{r.fonte ? ` · ${r.fonte}` : ''}</span>
                {r.matchDettagli && <span style={{ fontSize: 10, color: 'var(--muted)' }}>— {r.matchDettagli}</span>}
                {r.allegatoUrl && <a href={r.allegatoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10 }}>📎 allegato</a>}
                {puoModificare && nonRisolto && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button type="button" disabled={busy} className="btn btn-sm" onClick={() => risolvi(r, 'falso_positivo')}>Falso positivo</button>
                    <button type="button" disabled={busy} className="btn btn-sm" onClick={() => risolvi(r, 'match_confermato')}>Conferma match</button>
                  </span>
                )}
                {r.notaRisoluzione && <span style={{ fontSize: 10, color: 'var(--muted)', width: '100%' }}>Risoluzione: {r.notaRisoluzione}</span>}
              </div>
            );
          })}
        </div>
      )}
      {puoModificare && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
          <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoScreening)} style={{ fontSize: 11 }}>
              {TIPI.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Esito
            <select value={esito} onChange={(e) => setEsito(e.target.value as EsitoScreening)} style={{ fontSize: 11 }}>
              {ESITI.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Fonte
            <input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="es. World-Check, ricerca manuale" style={{ fontSize: 11 }} />
          </label>
          <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Allegato esito
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 10 }} />
          </label>
          <textarea aria-label="Dettagli del match o note" value={dettagli} onChange={(e) => setDettagli(e.target.value)} rows={2} placeholder="Dettagli del match / note" style={{ fontSize: 11, gridColumn: '1 / -1' }} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" disabled={busy} onClick={salva} className="btn btn-sm btn-primary">{busy ? '…' : '💾 Registra screening'}</button>
            {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
