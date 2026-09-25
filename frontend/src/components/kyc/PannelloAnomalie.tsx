import { useEffect, useState } from 'react';
import {
  fetchAnomalie, apriAnomaliaApi, decidiAnomaliaApi,
  type AnomaliaRiga, type TipoAnomaliaKyc, type DecisioneMlro,
} from '../../api/kyc';

/**
 * K8a — anomalie / segnalazioni interne e decisioni MLRO (spec §5.3), nella scheda «Compliance KYC»
 * del cliente. L'operatore apre un'anomalia (candidato SAR); l'MLRO decide (il server verifica il
 * potere: chi non è MLRO/admin riceve 403). Ogni passo lascia un anello nella catena ComplianceEvent.
 */
const TIPI: { key: TipoAnomaliaKyc; label: string }[] = [
  { key: 'match_sanzioni', label: 'Match sanzioni' },
  { key: 'match_pep', label: 'Match PEP' },
  { key: 'operazione_sospetta', label: 'Operazione sospetta' },
  { key: 'documento_incongruente', label: 'Documento incongruente' },
  { key: 'rischio_elevato', label: 'Rischio elevato' },
  { key: 'altro', label: 'Altro' },
];
const DECISIONI: { key: DecisioneMlro; label: string }[] = [
  { key: 'nessuna_azione', label: 'Nessuna azione' },
  { key: 'monitoraggio_rafforzato', label: 'Monitoraggio rafforzato' },
  { key: 'segnalazione_fiau', label: 'Segnalazione FIAU' },
  { key: 'chiusura_rapporto', label: 'Chiusura del rapporto' },
];
const ETICHETTA: Record<string, string> = {
  match_sanzioni: 'Match sanzioni', match_pep: 'Match PEP', operazione_sospetta: 'Operazione sospetta',
  documento_incongruente: 'Documento incongruente', rischio_elevato: 'Rischio elevato', altro: 'Altro',
  aperta: 'Aperta', in_valutazione: 'In valutazione', chiusa_nessuna_azione: 'Chiusa · nessuna azione',
  monitoraggio_rafforzato: 'Monitoraggio rafforzato', segnalata_fiau: 'Segnalata FIAU', rapporto_chiuso: 'Rapporto chiuso',
};
const aperta = (s: string) => s === 'aperta' || s === 'in_valutazione';
const coloreStato = (s: string) => (aperta(s) ? 'var(--pill-amber-fg)' : s === 'segnalata_fiau' || s === 'rapporto_chiuso' ? 'var(--pill-red-fg)' : 'var(--pill-green-fg)');

export function PannelloAnomalie({ fascicoloId, puoModificare }: { fascicoloId: string; puoModificare: boolean }) {
  const [righe, setRighe] = useState<AnomaliaRiga[]>([]);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAnomaliaKyc>('operazione_sospetta');
  const [descrizione, setDescrizione] = useState('');

  const carica = () => {
    setStato('loading');
    fetchAnomalie(fascicoloId).then((r) => { setRighe(r.anomalie); setStato('pronto'); }).catch(() => setStato('errore'));
  };
  useEffect(() => { if (fascicoloId) carica(); /* eslint-disable-next-line */ }, [fascicoloId]);
  const apri = async () => {
    if (descrizione.trim().length < 3) { setMsg('Inserisci una descrizione.'); return; }
    setBusy(true); setMsg(null);
    try { await apriAnomaliaApi(fascicoloId, { tipo, descrizione: descrizione.trim() }); setDescrizione(''); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore apertura anomalia'); } finally { setBusy(false); }
  };

  const decidi = async (a: AnomaliaRiga, decisione: DecisioneMlro) => {
    const label = DECISIONI.find((d) => d.key === decisione)?.label ?? decisione;
    const motivazione = window.prompt(`Motiva la decisione «${label}» (min. 10 caratteri):`);
    if (motivazione === null) return;
    setBusy(true); setMsg(null);
    try { await decidiAnomaliaApi(a.id, decisione, motivazione); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore decisione MLRO'); } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>🚩 Anomalie &amp; decisioni MLRO</div>
      {stato === 'loading' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && (
        <div style={{ fontSize: 11, color: 'var(--pill-amber-fg)' }}>Impossibile leggere le anomalie. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>
      )}
      {stato === 'pronto' && righe.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nessuna anomalia registrata.</div>
      )}
      {stato === 'pronto' && righe.map((a) => {
        const ultima = a.decisioni[0];
        return (
          <div key={a.id} style={{ background: 'var(--bg)', padding: 8, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{ETICHETTA[a.tipo]}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: coloreStato(a.stato) }}>{ETICHETTA[a.stato]}</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(a.createdAt).toLocaleDateString('it-IT')}</span>
            </div>
            <div style={{ fontSize: 11 }}>{a.descrizione}</div>
            {ultima && <div style={{ fontSize: 10, color: 'var(--muted)' }}>Decisione MLRO: {DECISIONI.find((d) => d.key === ultima.decisione)?.label} — {ultima.motivazione}</div>}
            {puoModificare && aperta(a.stato) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DECISIONI.map((d) => (
                  <button key={d.key} type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => decidi(a, d.key)}>{d.label}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {puoModificare && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAnomaliaKyc)} style={{ fontSize: 11 }}>
              {TIPI.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Descrizione dell'anomalia" style={{ fontSize: 11, flex: 1, minWidth: 180 }} />
          <button type="button" disabled={busy} onClick={apri} className="btn btn-sm btn-primary">{busy ? '…' : '🚩 Apri anomalia'}</button>
        </div>
      )}
      {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
    </div>
  );
}
