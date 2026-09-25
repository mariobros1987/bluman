import { useEffect, useState } from 'react';
import { fetchPortalKycDocumenti, caricaPortalKycDocumento, type DocumentoIdentitaRiga } from '../api/kyc';

const TIPI = [
  { v: 'carta_identita', l: "Carta d'identità" },
  { v: 'passaporto', l: 'Passaporto' },
  { v: 'permesso_soggiorno', l: 'Permesso di soggiorno' },
  { v: 'altro', l: 'Altro' },
];

/**
 * K6/3 — sezione «Documenti KYC» nel Portale Cliente: il cliente autenticato carica i propri
 * documenti d'identità sul proprio fascicolo. Gestisce gli stati (regola 13): modulo non attivo,
 * pratica non ancora aperta, caricamento, errore — sempre con un messaggio chiaro, mai pagina morta.
 * L'upload è materiale: lo studio poi verifica/approva (regola 14).
 */
export function DocumentiKycPortale({ clienteId }: { clienteId?: string }) {
  const [stato, setStato] = useState<'loading' | 'ok' | 'no_modulo' | 'no_pratica' | 'errore'>('loading');
  const [docs, setDocs] = useState<DocumentoIdentitaRiga[]>([]);
  const [tipo, setTipo] = useState('carta_identita');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carica = () => {
    setStato('loading');
    fetchPortalKycDocumenti(clienteId)
      .then((r) => {
        if (!r.moduloAttivo) { setStato('no_modulo'); return; }
        setDocs(r.documenti || []);
        setStato(r.praticaAttiva ? 'ok' : 'no_pratica');
      })
      .catch(() => setStato('errore'));
  };
  useEffect(() => { carica(); /* eslint-disable-next-line */ }, [clienteId]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setMsg(null);
    const reader = new FileReader();
    reader.onerror = () => { setMsg('Lettura del file non riuscita.'); setBusy(false); };
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(',')[1] || '';
        await caricaPortalKycDocumento({ tipo, filename: file.name, contentBase64: base64, clienteId });
        setMsg('Documento caricato. Lo studio lo verificherà.'); carica();
      } catch (err: any) { setMsg(err?.message || 'Caricamento non riuscito.'); } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (stato === 'no_modulo') return null; // lo studio non usa il modulo KYC: niente sezione

  const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 };
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>🛡 Documenti KYC</div>
      {stato === 'loading' && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && (
        <div style={{ fontSize: 13, color: 'var(--pill-red-fg)' }}>Errore nel caricamento. <button type="button" onClick={carica} style={{ background: 'none', border: 'none', color: 'var(--indigo-l)', cursor: 'pointer', textDecoration: 'underline' }}>Riprova</button></div>
      )}
      {stato === 'no_pratica' && (
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>La pratica di verifica non è ancora stata aperta dallo studio. Appena disponibile potrai caricare qui i tuoi documenti; nel frattempo contatta il tuo referente per qualsiasi dubbio.</div>
      )}
      {stato === 'ok' && (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>Carica i documenti richiesti per l'adeguata verifica. Sono trasmessi in modo sicuro; lo studio li verificherà.</p>
          {docs.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {docs.map((d) => (
                <li key={d.id}>{TIPI.find((t) => t.v === d.tipo)?.l || d.tipo} · caricato il {new Date(d.createdAt).toLocaleDateString('it-IT')}</li>
              ))}
            </ul>
          ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nessun documento caricato.</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ fontSize: 13 }}>
              {TIPI.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <label style={{ fontSize: 13, cursor: busy ? 'default' : 'pointer', color: 'var(--indigo-l)', fontWeight: 600 }}>
              {busy ? 'Caricamento…' : '📎 Carica documento'}
              <input type="file" onChange={onFile} disabled={busy} style={{ display: 'none' }} accept="image/*,application/pdf" />
            </label>
          </div>
          {msg && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
