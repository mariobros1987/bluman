import { useEffect, useState } from 'react';
import { fetchDocumentiSoggetto, caricaDocumentoSoggetto, type DocumentoIdentitaRiga } from '../../api/kyc';

const TIPI = [
  { v: 'carta_identita', l: "Carta d'identità" },
  { v: 'passaporto', l: 'Passaporto' },
  { v: 'permesso_soggiorno', l: 'Permesso di soggiorno' },
  { v: 'altro', l: 'Altro' },
];

/**
 * K6 — documenti d'identità di un soggetto KYC: elenco + caricamento (file → base64 → storage sicuro
 * con hash). Riservato allo studio; il caricamento del cliente via link a scadenza è una fase a parte.
 */
export function DocumentiSoggetto({ soggettoId, puoModificare }: { soggettoId: string; puoModificare: boolean }) {
  const [docs, setDocs] = useState<DocumentoIdentitaRiga[]>([]);
  const [tipo, setTipo] = useState('carta_identita');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const carica = () => { fetchDocumentiSoggetto(soggettoId).then((r) => setDocs(r.documenti)).catch(() => { /* non bloccante */ }); };
  useEffect(() => { if (soggettoId) carica(); /* eslint-disable-next-line */ }, [soggettoId]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setErr(null);
    const reader = new FileReader();
    reader.onerror = () => { setErr('Lettura file fallita'); setBusy(false); };
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(',')[1] || '';
        await caricaDocumentoSoggetto(soggettoId, { tipo, filename: file.name, contentBase64: base64 });
        carica();
      } catch (e: any) { setErr(e?.message || 'Caricamento fallito'); } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {docs.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--muted)' }}>
          {docs.map((d) => (
            <li key={d.id}>
              {TIPI.find((t) => t.v === d.tipo)?.l || d.tipo}
              {d.scadenza ? ` · scad. ${new Date(d.scadenza).toLocaleDateString('it-IT')}` : ''}
              {d.urlStorage ? <> · <a href={d.urlStorage} target="_blank" rel="noreferrer" style={{ color: 'var(--indigo-l)' }}>apri</a></> : ''}
              {d.hashSha256 ? <span style={{ fontFamily: 'monospace' }}> · {d.hashSha256.slice(0, 8)}…</span> : ''}
            </li>
          ))}
        </ul>
      )}
      {puoModificare && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Tipo di documento" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ fontSize: 11 }}>
            {TIPI.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <label style={{ fontSize: 11, cursor: busy ? 'default' : 'pointer', color: 'var(--indigo-l)' }}>
            {busy ? 'Caricamento…' : '📎 Carica documento'}
            <input type="file" onChange={onFile} disabled={busy} style={{ display: 'none' }} accept="image/*,application/pdf" />
          </label>
          {err && <span style={{ fontSize: 10, color: 'var(--pill-red-fg)' }}>⚠ {err}</span>}
        </div>
      )}
    </div>
  );
}
