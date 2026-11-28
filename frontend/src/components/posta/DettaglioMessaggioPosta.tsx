// Il messaggio aperto: chi scrive, a chi, il testo, gli allegati, e lo smistamento a cliente e progetto.
import { useEffect, useMemo, useState } from 'react';
import { aggiornaMessaggioPostaApi, fetchMessaggioPostaApi, type DettaglioMessaggioPosta as Dettaglio, type MessaggioPosta } from '../../api/posta';
import { urlDocumentoAssoluto } from '../../api/http';
import { spiegaAttribuzione } from '../../utils/postaTesti';
import { useToast } from '../ui/ToastProvider';

export interface OpzioniSmistamento {
  clienti: Array<{ id: string; nome: string }>;
  progetti: Array<{ id: string; nome: string; clienteId: string }>;
}

interface Props {
  id: string;
  puoScrivere: boolean;
  /** `null` finché clienti e progetti non sono stati letti; l'errore di lettura sta in `erroreOpzioni`. */
  opzioni: OpzioniSmistamento | null;
  erroreOpzioni: string | null;
  onAggiornato: (m: MessaggioPosta) => void;
  onChiudi: () => void;
}

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function dimensione(byte: number | null): string {
  if (byte === null) return '';
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`;
}

// L'HTML arriva da un mittente qualunque. Il server lo ha già ripulito; qui sta in un riquadro
// isolato: `sandbox` vuoto spegne script e moduli, e la regola qui sotto non lascia caricare
// niente dalla rete, così aprire un messaggio non avvisa il mittente (immagini di tracciamento).
const REGOLA_RIQUADRO = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';

export function DettaglioMessaggioPosta({ id, puoScrivere, opzioni, erroreOpzioni, onAggiornato, onChiudi }: Props) {
  const toast = useToast();
  const [m, setM] = useState<Dettaglio | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [originale, setOriginale] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [progettoId, setProgettoId] = useState('');
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    let vivo = true;
    setM(null);
    setErrore(null);
    setOriginale(false);
    fetchMessaggioPostaApi(id)
      .then((dettaglio) => {
        if (!vivo) return;
        setM(dettaglio);
        setClienteId(dettaglio.clienteId ?? '');
        setProgettoId(dettaglio.progettoId ?? '');
      })
      .catch((err) => { if (vivo) setErrore(err instanceof Error ? err.message : 'Errore di rete'); });
    return () => { vivo = false; };
  }, [id]);

  const progettiDelCliente = useMemo(() => (opzioni?.progetti ?? []).filter((p) => p.clienteId === clienteId), [opzioni, clienteId]);

  const applica = async (modifica: Parameters<typeof aggiornaMessaggioPostaApi>[1], fatto: string) => {
    if (!m) return;
    setInCorso(true);
    try {
      const aggiornato = await aggiornaMessaggioPostaApi(m.id, modifica);
      setM({ ...m, ...aggiornato });
      setClienteId(aggiornato.clienteId ?? '');
      setProgettoId(aggiornato.progettoId ?? '');
      onAggiornato(aggiornato);
      toast.successo(fatto);
    } catch (err) {
      // Il salvataggio fallito si dichiara e le scelte restano a schermo: niente va perso in silenzio.
      toast.errore(err instanceof Error ? err.message : 'Il messaggio non è stato aggiornato');
    } finally {
      setInCorso(false);
    }
  };

  const riquadro = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 } as const;

  if (errore) {
    return (
      <div role="alert" style={{ ...riquadro, background: 'var(--pill-red-bg)', borderColor: 'var(--pill-red-bd)', color: 'var(--pill-red-fg)' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Il messaggio non è stato letto</div>
        <div style={{ fontSize: 13, marginBottom: 10 }}>{errore}</div>
        <button type="button" className="btn btn-sm" onClick={onChiudi}>Chiudi</button>
      </div>
    );
  }
  if (!m) return <div style={{ ...riquadro, color: 'var(--muted)', textAlign: 'center' }}>Caricamento del messaggio…</div>;

  const cambiato = clienteId !== (m.clienteId ?? '') || progettoId !== (m.progettoId ?? '');

  return (
    <section aria-label="Messaggio aperto" style={{ ...riquadro, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', overflowWrap: 'anywhere' }}>{m.oggetto || '(senza oggetto)'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, overflowWrap: 'anywhere' }}>
            Da <strong style={{ color: 'var(--text)' }}>{m.mittenteNome ? `${m.mittenteNome} ` : ''}&lt;{m.mittenteEmail || 'mittente non indicato'}&gt;</strong>
            {m.destinatari ? <> · a {m.destinatari}</> : null} · {quando(m.ricevutoAt)}
            {m.casella ? <> · casella «{m.casella.nome}»</> : null}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onChiudi} aria-label="Chiudi il messaggio">✕</button>
      </div>

      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>
          <strong>{m.cliente ? m.cliente.nome : 'Da smistare'}</strong>
          {m.progetto ? <> · progetto «{m.progetto.nome}»</> : null}
          <span style={{ color: 'var(--muted)' }}> — {spiegaAttribuzione(m)}</span>
        </div>
        {puoScrivere && (
          erroreOpzioni ? (
            <div role="alert" style={{ fontSize: 12, color: 'var(--pill-red-fg)' }}>Clienti e progetti non sono stati letti ({erroreOpzioni}): lo smistamento non è disponibile finché non ricarichi la pagina.</div>
          ) : !opzioni ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Caricamento di clienti e progetti…</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Cliente a cui attribuire il messaggio" value={clienteId} onChange={(e) => { setClienteId(e.target.value); setProgettoId(''); }} style={{ padding: 8, fontSize: 12, width: 'auto', maxWidth: 240 }}>
                <option value="">Nessun cliente (da smistare)</option>
                {opzioni.clienti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <select aria-label="Progetto a cui attribuire il messaggio" value={progettoId} onChange={(e) => setProgettoId(e.target.value)} disabled={!clienteId} style={{ padding: 8, fontSize: 12, width: 'auto', maxWidth: 240 }}>
                <option value="">{!clienteId ? 'Prima scegli il cliente' : progettiDelCliente.length ? 'Nessun progetto' : 'Il cliente non ha progetti'}</option>
                {progettiDelCliente.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-primary" disabled={!cambiato || inCorso} onClick={() => void applica({ clienteId: clienteId || null, progettoId: progettoId || null }, 'Messaggio smistato.')}>
                Salva lo smistamento
              </button>
            </div>
          )
        )}
      </div>

      {puoScrivere && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-secondary" disabled={inCorso} onClick={() => void applica({ letto: !m.lettoAt }, m.lettoAt ? 'Segnato come da leggere.' : 'Segnato come letto.')}>
            {m.lettoAt ? 'Segna da leggere' : '✓ Segna letto'}
          </button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={inCorso} onClick={() => void applica({ archiviato: !m.archiviatoAt }, m.archiviatoAt ? 'Messaggio riportato in coda.' : 'Messaggio archiviato.')}>
            {m.archiviatoAt ? 'Riporta in coda' : '🗄 Archivia'}
          </button>
        </div>
      )}

      {m.allegati.length > 0 && (
        <div aria-label="Allegati" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {m.allegati.map((a) => (
            <div key={a.id} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>📎</span>
              {a.url ? (
                <a href={urlDocumentoAssoluto(a.url)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--indigo)', fontWeight: 600, overflowWrap: 'anywhere' }}>{a.nome}</a>
              ) : (
                <span style={{ color: 'var(--text)', overflowWrap: 'anywhere' }}>{a.nome}</span>
              )}
              <span style={{ color: 'var(--muted)' }}>{dimensione(a.dimensioneByte)}</span>
              {!a.url && <span style={{ color: 'var(--pill-amber-fg)' }}>non salvato: {a.motivoNonSalvato || 'motivo non riportato'}</span>}
            </div>
          ))}
        </div>
      )}

      {m.html && (
        <div>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOriginale((v) => !v)} aria-pressed={originale}>
            {originale ? 'Mostra solo il testo' : 'Mostra l’originale impaginato'}
          </button>
        </div>
      )}
      {originale && m.html ? (
        <iframe
          title="Messaggio originale"
          sandbox=""
          srcDoc={`${REGOLA_RIQUADRO}${m.html}`}
          style={{ width: '100%', minHeight: 420, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--on-accent)' }}
        />
      ) : m.testo ? (
        <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{m.testo}</div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Il testo di questo messaggio non è stato letto dalla casella{m.html ? ': prova con l’originale impaginato.' : '.'}</div>
      )}
    </section>
  );
}
