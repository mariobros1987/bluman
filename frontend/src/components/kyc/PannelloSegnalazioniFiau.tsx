import { useEffect, useState } from 'react';
import {
  fetchAnomalie, fetchSegnalazioni, preparaSegnalazioneApi, registraTrasmissioneStrApi, scaricaDossierStrPdf,
  type AnomaliaRiga, type SegnalazioneFiauRiga,
} from '../../api/kyc';

/**
 * K8b — segnalazione operazione sospetta (STR) / dossier goAML (spec §5.3/§10), nella scheda
 * «Compliance KYC» del cliente. È la coda di un'anomalia che l'MLRO ha deciso di segnalare
 * (`segnalata_fiau`, K8a): il sistema PREPARA un dossier riservato e REGISTRA riferimento e timestamp
 * goAML dopo l'invio manuale sul portale FIAU; NON trasmette. Sezione riservata all'MLRO/admin — il
 * backend risponde 403 agli altri ruoli, e qui lo si dichiara invece di mostrare un errore generico.
 */
const ETICHETTA_TIPO: Record<string, string> = {
  match_sanzioni: 'Match sanzioni', match_pep: 'Match PEP', operazione_sospetta: 'Operazione sospetta',
  documento_incongruente: 'Documento incongruente', rischio_elevato: 'Rischio elevato', altro: 'Altro',
};

export function PannelloSegnalazioniFiau({ fascicoloId, puoModificare }: { fascicoloId: string; puoModificare: boolean }) {
  const [anomalie, setAnomalie] = useState<AnomaliaRiga[]>([]);
  const [segnalazioni, setSegnalazioni] = useState<SegnalazioneFiauRiga[]>([]);
  const [stato, setStato] = useState<'loading' | 'pronto' | 'riservato' | 'errore'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carica = () => {
    setStato('loading');
    Promise.all([fetchSegnalazioni(fascicoloId), fetchAnomalie(fascicoloId)])
      .then(([s, a]) => { setSegnalazioni(s.segnalazioni); setAnomalie(a.anomalie); setStato('pronto'); })
      .catch((e: any) => setStato(/riservat/i.test(e?.message || '') ? 'riservato' : 'errore'));
  };
  useEffect(() => { if (fascicoloId) carica(); /* eslint-disable-next-line */ }, [fascicoloId]);

  const prepara = async (anomaliaId: string) => {
    setBusy(true); setMsg(null);
    try { await preparaSegnalazioneApi(anomaliaId); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore preparazione segnalazione'); } finally { setBusy(false); }
  };
  const scarica = async (id: string) => {
    setBusy(true); setMsg(null);
    try { await scaricaDossierStrPdf(id); } catch (e: any) { setMsg(e?.message || 'Errore download dossier'); } finally { setBusy(false); }
  };
  const registraInvio = async (id: string) => {
    const rif = window.prompt('Riferimento goAML rilasciato dal portale FIAU dopo l’invio:');
    if (rif === null) return;
    if (rif.trim().length < 3) { setMsg('Riferimento goAML troppo corto.'); return; }
    setBusy(true); setMsg(null);
    try { await registraTrasmissioneStrApi(id, rif.trim()); carica(); }
    catch (e: any) { setMsg(e?.message || 'Errore registrazione invio'); } finally { setBusy(false); }
  };

  if (stato === 'riservato') {
    return (
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>📨 Segnalazioni FIAU (STR)</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Sezione riservata all’MLRO o a un ruolo superiore.</div>
      </div>
    );
  }

  const segnPerAnomalia = new Map(segnalazioni.map((s) => [s.anomaliaId, s]));
  const daPreparare = anomalie.filter((a) => a.stato === 'segnalata_fiau' && !segnPerAnomalia.has(a.id));

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>📨 Segnalazioni FIAU (STR)</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
        Il sistema prepara il dossier e registra il riferimento goAML; l’invio avviene manualmente sul portale FIAU a cura dell’MLRO (spec §5.3/§10). Riservato: non comunicabile al cliente.
      </div>
      {stato === 'loading' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Caricamento…</div>}
      {stato === 'errore' && (
        <div style={{ fontSize: 11, color: 'var(--pill-amber-fg)' }}>Impossibile leggere le segnalazioni. <button type="button" className="btn btn-sm" onClick={carica}>Riprova</button></div>
      )}

      {stato === 'pronto' && segnalazioni.length === 0 && daPreparare.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nessuna segnalazione. Compare qui quando l’MLRO decide «Segnalazione FIAU» su un’anomalia.</div>
      )}

      {stato === 'pronto' && daPreparare.map((a) => (
        <div key={a.id} style={{ background: 'var(--bg)', padding: 8, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{ETICHETTA_TIPO[a.tipo] ?? a.tipo} · <span style={{ color: 'var(--pill-red-fg)' }}>da preparare</span></div>
          <div style={{ fontSize: 11 }}>{a.descrizione}</div>
          {puoModificare && (
            <div><button type="button" disabled={busy} className="btn btn-sm btn-primary" onClick={() => prepara(a.id)}>📨 Prepara dossier STR</button></div>
          )}
        </div>
      ))}

      {stato === 'pronto' && segnalazioni.map((s) => (
        <div key={s.id} style={{ background: 'var(--bg)', padding: 8, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{s.anomalia ? (ETICHETTA_TIPO[s.anomalia.tipo] ?? s.anomalia.tipo) : 'Segnalazione'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.stato === 'trasmessa' ? 'var(--pill-green-fg)' : 'var(--pill-amber-fg)' }}>
              {s.stato === 'trasmessa' ? 'Trasmessa FIAU' : 'Preparata · in attesa di invio'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(s.createdAt).toLocaleDateString('it-IT')}</span>
          </div>
          {s.stato === 'trasmessa' && (
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              Riferimento goAML: {s.riferimentoGoaml} {s.trasmessaAt && `· inviata il ${new Date(s.trasmessaAt).toLocaleString('it-IT')}`}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => scarica(s.id)}>📄 Dossier PDF</button>
            {puoModificare && s.stato === 'preparata' && (
              <>
                <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => prepara(s.anomaliaId)}>🔄 Riprepara</button>
                <button type="button" disabled={busy} className="btn btn-sm btn-primary" onClick={() => registraInvio(s.id)}>✅ Registra invio goAML</button>
              </>
            )}
          </div>
        </div>
      ))}
      {msg && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msg}</span>}
    </div>
  );
}
