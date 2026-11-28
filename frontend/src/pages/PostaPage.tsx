// «Posta dei clienti»: l'accentratore delle mail. Tutta la posta raccolta dalle caselle dei
// clienti (per inoltro, o collegate con le loro credenziali) in un elenco solo: si filtra, si apre,
// si smista a cliente e progetto, si archivia. La configurazione sta nella seconda scheda.
import { useCallback, useEffect, useState } from 'react';
import {
  fetchMessaggiPostaApi, fetchSmistamentoPostaApi, fetchStatoPostaApi, raccogliPostaApi,
  type ElencoPosta, type MessaggioPosta, type StatoPosta, type VistaPosta,
} from '../api/posta';
import { DettaglioMessaggioPosta, type OpzioniSmistamento } from '../components/posta/DettaglioMessaggioPosta';
import { ConfigurazionePosta } from '../components/posta/ConfigurazionePosta';
import { permessoPosta, puoConfigurarePosta } from '../utils/postaAccesso';
import { useToast } from '../components/ui/ToastProvider';

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const riquadro = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 } as const;

export function PostaPage() {
  const toast = useToast();
  const puoScrivere = permessoPosta() === 'write';
  const puoConfigurare = puoConfigurarePosta();

  const [scheda, setScheda] = useState<'messaggi' | 'configurazione'>('messaggi');
  const [vista, setVista] = useState<VistaPosta>('tutti');
  const [soloNonLetti, setSoloNonLetti] = useState(false);
  const [archiviati, setArchiviati] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [cerca, setCerca] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);

  const [elenco, setElenco] = useState<ElencoPosta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [stato, setStato] = useState<StatoPosta | null>(null);
  const [erroreStato, setErroreStato] = useState<string | null>(null);
  const [opzioni, setOpzioni] = useState<OpzioniSmistamento | null>(null);
  const [erroreOpzioni, setErroreOpzioni] = useState<string | null>(null);
  const [aperto, setAperto] = useState<string | null>(null);
  const [raccolta, setRaccolta] = useState(false);

  const caricaElenco = useCallback(async () => {
    setErrore(null);
    try {
      setElenco(await fetchMessaggiPostaApi({ vista, letti: soloNonLetti ? 'no' : undefined, archiviati, clienteId: clienteId || undefined, q, pagina }));
    } catch (err) {
      setElenco(null);
      setErrore(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, [vista, soloNonLetti, archiviati, clienteId, q, pagina]);

  const caricaStato = useCallback(async () => {
    setErroreStato(null);
    try {
      setStato(await fetchStatoPostaApi());
    } catch (err) {
      setErroreStato(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, []);

  useEffect(() => { void caricaElenco(); }, [caricaElenco]);
  useEffect(() => { void caricaStato(); }, [caricaStato]);
  useEffect(() => {
    fetchSmistamentoPostaApi()
      .then(setOpzioni)
      .catch((err) => setErroreOpzioni(err instanceof Error ? err.message : 'Errore di rete'));
  }, []);

  // Ogni filtro riporta alla prima pagina e chiude il messaggio aperto, che può non essere più nell'elenco.
  const filtra = (applica: () => void) => { applica(); setPagina(1); setAperto(null); };

  const raccogli = async () => {
    setRaccolta(true);
    try {
      const esito = await raccogliPostaApi();
      const ferme = esito.caselle.filter((c) => !c.ok);
      if (esito.caselle.length === 0) toast.attenzione('Nessuna casella attiva da cui raccogliere: collegane una dalla scheda Configurazione.');
      else if (ferme.length) toast.errore(`${esito.nuovi} messaggi nuovi, ma ${ferme.length === 1 ? `la casella «${ferme[0]!.nome}» non ha risposto` : `${ferme.length} caselle non hanno risposto`}: il motivo è qui sotto.`);
      else toast.successo(esito.nuovi === 0 ? 'Nessun messaggio nuovo.' : `${esito.nuovi} ${esito.nuovi === 1 ? 'messaggio nuovo' : 'messaggi nuovi'}.`);
    } catch (err) {
      toast.errore(err instanceof Error ? err.message : 'La raccolta non è partita');
    } finally {
      setRaccolta(false);
      void caricaStato();
      void caricaElenco();
    }
  };

  const aggiornato = (m: MessaggioPosta) => {
    setElenco((prima) => (prima ? { ...prima, messaggi: prima.messaggi.map((x) => (x.id === m.id ? m : x)) } : prima));
    void caricaStato();
  };

  const caselleFerme = (stato?.caselle ?? []).filter((c) => c.attiva && c.ultimoErrore);
  const nessunaCasella = stato !== null && stato.caselle.length === 0;
  const pagine = elenco ? Math.max(1, Math.ceil(elenco.totale / elenco.perPagina)) : 1;
  const filtriAttivi = vista !== 'tutti' || soloNonLetti || Boolean(clienteId) || Boolean(q);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...riquadro, borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>📬 Posta dei clienti</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
            La posta raccolta dalle caselle dei clienti, in un posto solo. BluMan la legge e basta: nelle caselle non segna niente come letto.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {stato && (
            <>
              <span style={{ fontSize: 11, background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>{stato.daSmistare} da smistare</span>
              <span style={{ fontSize: 11, background: 'var(--card2)', color: 'var(--text)', padding: '6px 14px', borderRadius: 20, fontWeight: 600 }}>{stato.nonLetti} da leggere</span>
            </>
          )}
          {puoScrivere && (
            <button type="button" className="btn btn-primary" onClick={() => void raccogli()} disabled={raccolta}>
              {raccolta ? 'Raccolta in corso…' : '↻ Raccogli ora'}
            </button>
          )}
        </div>
      </div>

      {puoConfigurare && (
        <div role="tablist" aria-label="Sezioni della posta" style={{ display: 'flex', gap: 8 }}>
          <button type="button" role="tab" aria-selected={scheda === 'messaggi'} className={`btn btn-sm ${scheda === 'messaggi' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScheda('messaggi')}>Messaggi</button>
          <button type="button" role="tab" aria-selected={scheda === 'configurazione'} className={`btn btn-sm ${scheda === 'configurazione' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScheda('configurazione')}>Configurazione</button>
        </div>
      )}

      {scheda === 'configurazione' && puoConfigurare ? (
        <ConfigurazionePosta onCambiato={() => { void caricaStato(); }} />
      ) : (
        <>
          {erroreStato && (
            <div role="alert" style={{ ...riquadro, background: 'var(--pill-red-bg)', borderColor: 'var(--pill-red-bd)', color: 'var(--pill-red-fg)', fontSize: 13 }}>
              Lo stato della raccolta non è stato letto ({erroreStato}): non so dirti se le caselle stanno rispondendo.
            </div>
          )}
          {caselleFerme.map((c) => (
            <div key={c.id} role="alert" style={{ ...riquadro, background: 'var(--pill-amber-bg)', borderColor: 'var(--pill-amber-bd)', color: 'var(--pill-amber-fg)', fontSize: 13 }}>
              <strong>La casella «{c.nome}» ({c.indirizzo}) non viene raccolta.</strong> {c.ultimoErrore}
              {c.ultimoSuccessoAt ? ` Ultima raccolta riuscita: ${quando(c.ultimoSuccessoAt)}.` : ' Non è mai stata raccolta.'}
            </div>
          ))}

          <div style={{ ...riquadro, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select aria-label="Quali messaggi mostrare" value={vista} onChange={(e) => filtra(() => setVista(e.target.value as VistaPosta))} style={{ padding: 8, fontSize: 12, width: 'auto' }}>
              <option value="tutti">Tutti i messaggi</option>
              <option value="da_smistare">Da smistare</option>
              <option value="attribuiti">Attribuiti a un cliente</option>
            </select>
            <select aria-label="Cliente" value={clienteId} onChange={(e) => filtra(() => setClienteId(e.target.value))} disabled={!opzioni} style={{ padding: 8, fontSize: 12, width: 'auto', maxWidth: 240 }}>
              <option value="">{erroreOpzioni ? 'Clienti non letti' : opzioni ? 'Tutti i clienti' : 'Caricamento clienti…'}</option>
              {(opzioni?.clienti ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <form onSubmit={(e) => { e.preventDefault(); filtra(() => setQ(cerca.trim())); }} style={{ display: 'flex', gap: 6 }}>
              <input aria-label="Cerca nei messaggi" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca oggetto, testo, mittente" style={{ padding: 8, fontSize: 12, width: 220 }} />
              <button type="submit" className="btn btn-sm btn-secondary">Cerca</button>
            </form>
            <label style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={soloNonLetti} onChange={(e) => filtra(() => setSoloNonLetti(e.target.checked))} /> Solo da leggere
            </label>
            <label style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={archiviati} onChange={(e) => filtra(() => setArchiviati(e.target.checked))} /> Archiviati
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: aperto ? 'minmax(280px, 2fr) 3fr' : '1fr', gap: 16, alignItems: 'start' }}>
            <div>
              {errore ? (
                <div role="alert" style={{ ...riquadro, background: 'var(--pill-red-bg)', borderColor: 'var(--pill-red-bd)', color: 'var(--pill-red-fg)', textAlign: 'center', padding: 24 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>I messaggi non sono stati letti</div>
                  <div style={{ fontSize: 13, marginBottom: 12 }}>{errore}. Non vuol dire che non ce ne siano.</div>
                  <button type="button" className="btn" onClick={() => void caricaElenco()}>Riprova</button>
                </div>
              ) : elenco === null ? (
                <div style={{ ...riquadro, padding: 28, textAlign: 'center', color: 'var(--muted)' }}>Caricamento dei messaggi…</div>
              ) : elenco.messaggi.length === 0 ? (
                <div style={{ ...riquadro, borderStyle: 'dashed', padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  {nessunaCasella
                    ? `Nessuna casella collegata: finché non ce n’è una non arriva niente. ${puoConfigurare ? 'Collegala dalla scheda Configurazione.' : 'La collega il responsabile dello studio.'}`
                    : archiviati ? 'Nessun messaggio archiviato con questi filtri.'
                    : filtriAttivi ? 'Nessun messaggio con questi filtri.'
                    : 'Nessun messaggio in coda: quelli raccolti sono stati tutti archiviati, o le caselle non ne hanno ancora ricevuti.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {elenco.messaggi.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAperto(m.id)}
                      aria-current={aperto === m.id}
                      style={{ textAlign: 'left', cursor: 'pointer', background: aperto === m.id ? 'var(--card2)' : 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text)' }}
                    >
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                        <span style={{ fontWeight: m.lettoAt ? 500 : 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {!m.lettoAt && <span aria-label="da leggere" style={{ color: 'var(--indigo)' }}>● </span>}
                          {m.mittenteNome || m.mittenteEmail || 'Mittente non indicato'}
                        </span>
                        <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.haAllegati ? '📎 ' : ''}{quando(m.ricevutoAt)}</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: m.lettoAt ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.oggetto || '(senza oggetto)'}</span>
                      {m.anteprima && <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.anteprima}</span>}
                      <span style={{ fontSize: 11 }}>
                        {m.cliente ? (
                          <span style={{ background: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>{m.cliente.nome}{m.progetto ? ` · ${m.progetto.nome}` : ''}</span>
                        ) : (
                          <span style={{ background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-fg)', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>Da smistare</span>
                        )}
                      </span>
                    </button>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    <span>{elenco.totale} {elenco.totale === 1 ? 'messaggio' : 'messaggi'} · pagina {elenco.pagina} di {pagine}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={pagina <= 1} onClick={() => { setPagina(pagina - 1); setAperto(null); }}>← Precedenti</button>
                      <button type="button" className="btn btn-sm btn-secondary" disabled={pagina >= pagine} onClick={() => { setPagina(pagina + 1); setAperto(null); }}>Successivi →</button>
                    </span>
                  </div>
                </div>
              )}
            </div>
            {aperto && (
              <DettaglioMessaggioPosta id={aperto} puoScrivere={puoScrivere} opzioni={opzioni} erroreOpzioni={erroreOpzioni} onAggiornato={aggiornato} onChiudi={() => setAperto(null)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
