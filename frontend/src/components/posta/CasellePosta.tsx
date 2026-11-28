// Le caselle collegate: come stanno, e i comandi per provarle, fermarle, cambiare la password, scollegarle.
import { useState } from 'react';
import { aggiornaCasellaPostaApi, provaCasellaPostaApi, scollegaCasellaPostaApi, type CasellaPosta } from '../../api/posta';
import { ModuloCasellaPosta } from './ModuloCasellaPosta';
import { statoCasella } from '../../utils/postaTesti';
import { useConfirm } from '../ui/ConfirmProvider';
import { useToast } from '../ui/ToastProvider';

interface Props {
  caselle: CasellaPosta[];
  clienti: Array<{ id: string; nome: string }> | null;
  /** Qualcosa è cambiato sul server: chi contiene rilegge caselle, inoltri e stato. */
  onCambiato: () => void;
}

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pillola = (colore: 'green' | 'amber' | 'red') => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: `var(--pill-${colore}-bg)`, color: `var(--pill-${colore}-fg)` }) as const;

export function CasellePosta({ caselle, clienti, onCambiato }: Props) {
  const toast = useToast();
  const conferma = useConfirm();
  const [modulo, setModulo] = useState(false);
  const [occupata, setOccupata] = useState<string | null>(null);
  const [cambiaPassword, setCambiaPassword] = useState<string | null>(null);
  const [nuovaPassword, setNuovaPassword] = useState('');
  const [prove, setProve] = useState<Record<string, { ok: boolean; testo: string }>>({});

  const esegui = async (id: string, azione: () => Promise<unknown>, fatto: string, seFallisce: string): Promise<boolean> => {
    setOccupata(id);
    try {
      await azione();
      toast.successo(fatto);
      onCambiato();
      return true;
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : seFallisce);
      return false;
    } finally {
      setOccupata(null);
    }
  };

  const prova = async (c: CasellaPosta) => {
    setOccupata(c.id);
    try {
      const testo = await provaCasellaPostaApi({ casellaId: c.id });
      setProve((p) => ({ ...p, [c.id]: { ok: true, testo } }));
    } catch (err) {
      setProve((p) => ({ ...p, [c.id]: { ok: false, testo: err instanceof Error ? err.message : 'La casella non risponde' } }));
    } finally {
      setOccupata(null);
    }
  };

  const scollega = async (c: CasellaPosta) => {
    const ok = await conferma({
      titolo: `Scollegare «${c.nome}»?`,
      messaggio: 'La raccolta da questa casella si ferma e la password salvata viene cancellata. I messaggi già raccolti restano in BluMan. Per ricollegarla servirà di nuovo la password.',
      confermaLabel: 'Scollega',
      pericolo: true,
    });
    if (!ok) return;
    await esegui(c.id, () => scollegaCasellaPostaApi(c.id), `Casella «${c.nome}» scollegata.`, 'La casella non è stata scollegata');
  };

  const salvaPassword = async (c: CasellaPosta) => {
    // Con la password nuova la casella riparte: è il gesto con cui si ricollega una casella scollegata.
    const riuscito = await esegui(c.id, () => aggiornaCasellaPostaApi(c.id, { password: nuovaPassword, attiva: true }), `Password di «${c.nome}» salvata: la prossima raccolta la usa.`, 'La password non è stata salvata');
    if (riuscito) { setCambiaPassword(null); setNuovaPassword(''); }
  };

  return (
    <section aria-label="Caselle collegate" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Caselle collegate</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Le caselle che BluMan legge a ogni raccolta: quella dello studio, dove i clienti inoltrano, e quelle dei clienti.</div>
        </div>
        {!modulo && <button type="button" className="btn btn-primary btn-sm" onClick={() => setModulo(true)}>+ Collega una casella</button>}
      </div>

      {modulo && <ModuloCasellaPosta clienti={clienti} onAnnulla={() => setModulo(false)} onCollegata={() => { setModulo(false); onCambiato(); }} />}

      {caselle.length === 0 ? (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Nessuna casella collegata: finché non ce n’è una, BluMan non raccoglie posta.
        </div>
      ) : (
        caselle.map((c) => {
          const stato = statoCasella(c);
          const esito = prove[c.id];
          const ferma = occupata !== null;
          return (
            <div key={c.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14, color: 'var(--text)' }}>{c.nome}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{c.indirizzo}</span>
                <span style={pillola(stato.colore)}>{stato.testo}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                {c.tipo === 'raccolta'
                  ? 'Casella di raccolta dello studio: riceve gli inoltri dei clienti.'
                  : c.cliente ? <>Casella del cliente <strong>{c.cliente.nome}</strong>: tutta la posta va sotto di lui.</>
                  : 'Casella di un cliente che non è più in anagrafica: i messaggi nuovi non si possono attribuire, quindi non viene raccolta.'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {c.host}:{c.porta} · cartella «{c.cartella}» · {c.ultimoSuccessoAt ? `ultima raccolta riuscita ${quando(c.ultimoSuccessoAt)}` : 'mai raccolta finora'}
                {c.consensoDichiaratoAt ? ` · autorizzazione del cliente dichiarata il ${quando(c.consensoDichiaratoAt)}` : ''}
              </div>
              {c.ultimoErrore && c.passwordSalvata && (
                <div role="alert" style={{ fontSize: 12, color: 'var(--pill-red-fg)' }}>Ultimo tentativo fallito: {c.ultimoErrore}</div>
              )}
              {esito && (
                <div role={esito.ok ? 'status' : 'alert'} style={{ fontSize: 12, fontWeight: 600, color: esito.ok ? 'var(--pill-green-fg)' : 'var(--pill-red-fg)' }}>{esito.ok ? '✓ ' : '✕ '}{esito.testo}</div>
              )}

              {cambiaPassword === c.id ? (
                <form onSubmit={(e) => { e.preventDefault(); void salvaPassword(c); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input type="password" aria-label={`Nuova password di ${c.nome}`} value={nuovaPassword} onChange={(e) => setNuovaPassword(e.target.value)} autoComplete="new-password" maxLength={1024} placeholder="Nuova password" style={{ padding: 8, fontSize: 13, width: 240 }} />
                  <button type="submit" className="btn btn-sm btn-primary" disabled={ferma || !nuovaPassword}>Salva la password</button>
                  <button type="button" className="btn btn-sm btn-secondary" disabled={ferma} onClick={() => { setCambiaPassword(null); setNuovaPassword(''); }}>Annulla</button>
                </form>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {c.passwordSalvata && (
                    <>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={ferma} onClick={() => void prova(c)}>{occupata === c.id ? 'Attendi…' : 'Prova'}</button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        disabled={ferma}
                        onClick={() => void esegui(c.id, () => aggiornaCasellaPostaApi(c.id, { attiva: !c.attiva }), c.attiva ? `Raccolta da «${c.nome}» in pausa.` : `Raccolta da «${c.nome}» ripresa.`, 'La casella non è stata aggiornata')}
                      >
                        {c.attiva ? 'Metti in pausa' : 'Riprendi la raccolta'}
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-sm btn-secondary" disabled={ferma} onClick={() => { setCambiaPassword(c.id); setNuovaPassword(''); }}>
                    {c.passwordSalvata ? 'Cambia password' : 'Ricollega con la password'}
                  </button>
                  {c.passwordSalvata && <button type="button" className="btn btn-sm btn-secondary" disabled={ferma} onClick={() => void scollega(c)}>Scollega</button>}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
