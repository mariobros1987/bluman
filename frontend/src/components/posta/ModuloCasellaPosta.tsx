// Il modulo «Collega una casella»: la casella di raccolta dello studio (i clienti inoltrano lì) o la
// casella di un cliente, con le credenziali che il cliente ha dato allo studio.
import { useState, type FormEvent } from 'react';
import { creaCasellaPostaApi, provaCasellaPostaApi, type CasellaPosta, type NuovaCasella } from '../../api/posta';
import { useToast } from '../ui/ToastProvider';

interface Props {
  /** `null` se l'elenco dei clienti non è stato letto: la casella di un cliente non si può collegare. */
  clienti: Array<{ id: string; nome: string }> | null;
  onCollegata: (casella: CasellaPosta) => void;
  onAnnulla: () => void;
}

const VUOTO = { nome: '', indirizzo: '', host: '', porta: '993', utente: '', password: '', cartella: 'INBOX', raccogliDal: '' };
const campo = { padding: 8, fontSize: 13, width: '100%' } as const;
const etichetta = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text)' } as const;
const nota = { fontSize: 11, fontWeight: 400, color: 'var(--muted)' } as const;

export function ModuloCasellaPosta({ clienti, onCollegata, onAnnulla }: Props) {
  const toast = useToast();
  const [tipo, setTipo] = useState<'raccolta' | 'cliente'>('raccolta');
  const [clienteId, setClienteId] = useState('');
  const [consenso, setConsenso] = useState(false);
  const [dati, setDati] = useState(VUOTO);
  const [errore, setErrore] = useState<string | null>(null);
  const [esitoProva, setEsitoProva] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, setInCorso] = useState<'prova' | 'salva' | null>(null);

  const imposta = (chiave: keyof typeof VUOTO) => (e: { target: { value: string } }) => {
    setDati((d) => ({ ...d, [chiave]: e.target.value }));
    setEsitoProva(null);
  };

  // La porta è un numero vero o niente: un campo vuoto non diventa 993 di nascosto.
  const porta = /^\d{1,5}$/.test(dati.porta.trim()) ? Number(dati.porta.trim()) : null;

  const prova = async () => {
    setErrore(null);
    setEsitoProva(null);
    if (porta === null) { setErrore('La porta è un numero (di solito 993).'); return; }
    setInCorso('prova');
    try {
      const testo = await provaCasellaPostaApi({ host: dati.host.trim(), porta, utente: dati.utente.trim(), password: dati.password, cartella: dati.cartella.trim() || undefined });
      setEsitoProva({ ok: true, testo });
    } catch (err) {
      setEsitoProva({ ok: false, testo: err instanceof Error ? err.message : 'La casella non risponde' });
    } finally {
      setInCorso(null);
    }
  };

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setErrore(null);
    if (porta === null) { setErrore('La porta è un numero (di solito 993).'); return; }
    if (tipo === 'cliente' && !clienteId) { setErrore('Indica di quale cliente è la casella.'); return; }
    if (tipo === 'cliente' && !consenso) { setErrore('Per collegare la casella di un cliente devi dichiarare che ha autorizzato per iscritto lo studio a leggerla.'); return; }
    const nuova: NuovaCasella = {
      nome: dati.nome.trim(),
      indirizzo: dati.indirizzo.trim(),
      host: dati.host.trim(),
      porta,
      utente: dati.utente.trim(),
      password: dati.password,
      cartella: dati.cartella.trim() || 'INBOX',
      tipo,
      ...(tipo === 'cliente' ? { clienteId, consensoCliente: true } : {}),
      ...(dati.raccogliDal ? { raccogliDal: dati.raccogliDal } : {}),
    };
    setInCorso('salva');
    try {
      const casella = await creaCasellaPostaApi(nuova);
      toast.successo(`Casella «${casella.nome}» collegata: la prossima raccolta la legge.`);
      onCollegata(casella);
    } catch (err) {
      // Il modulo resta aperto con i dati inseriti: un salvataggio fallito si dichiara (regola 3).
      setErrore(err instanceof Error ? err.message : 'La casella non è stata salvata');
    } finally {
      setInCorso(null);
    }
  };

  return (
    <form onSubmit={(e) => void salva(e)} aria-label="Collega una casella" style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Che casella è</legend>
        <label style={{ fontSize: 13, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="radio" name="tipo-casella" checked={tipo === 'raccolta'} onChange={() => setTipo('raccolta')} />
          <span><strong>Casella di raccolta dello studio</strong> <span style={nota}>— i clienti impostano l’inoltro verso questa casella, ognuno al suo indirizzo.</span></span>
        </label>
        <label style={{ fontSize: 13, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="radio" name="tipo-casella" checked={tipo === 'cliente'} onChange={() => setTipo('cliente')} />
          <span><strong>Casella di un cliente</strong> <span style={nota}>— BluMan la legge con le credenziali del cliente: tutta la sua posta va sotto di lui.</span></span>
        </label>
      </fieldset>

      {tipo === 'cliente' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clienti === null ? (
            <div role="alert" style={{ fontSize: 12, color: 'var(--pill-red-fg)' }}>L’elenco dei clienti non è stato letto: la casella di un cliente non si può collegare finché non ricarichi.</div>
          ) : (
            <label style={etichetta}>
              Cliente a cui appartiene
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={campo}>
                <option value="">{clienti.length ? 'Scegli il cliente' : 'Nessun cliente in anagrafica'}</option>
                {clienti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          )}
          <label style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={consenso} onChange={(e) => setConsenso(e.target.checked)} />
            <span>Dichiaro che il cliente ha autorizzato per iscritto lo studio a leggere questa casella. <span style={nota}>La dichiarazione resta nel registro delle attività, con il tuo nome e la data.</span></span>
          </label>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <label style={etichetta}>Nome <span style={nota}>come la riconosci nell’elenco</span>
          <input value={dati.nome} onChange={imposta('nome')} required maxLength={80} style={campo} />
        </label>
        <label style={etichetta}>Indirizzo della casella <span style={nota}>quello a cui arriva la posta</span>
          <input type="email" value={dati.indirizzo} onChange={imposta('indirizzo')} required maxLength={254} style={campo} />
        </label>
        <label style={etichetta}>Server IMAP <span style={nota}>per esempio imap.gmail.com</span>
          <input value={dati.host} onChange={imposta('host')} required maxLength={253} style={campo} />
        </label>
        <label style={etichetta}>Porta <span style={nota}>993, connessione cifrata</span>
          <input inputMode="numeric" value={dati.porta} onChange={imposta('porta')} required style={campo} />
        </label>
        <label style={etichetta}>Utenza <span style={nota}>di solito è l’indirizzo</span>
          <input value={dati.utente} onChange={imposta('utente')} required maxLength={254} autoComplete="off" style={campo} />
        </label>
        <label style={etichetta}>Password <span style={nota}>meglio una «password per le app»</span>
          <input type="password" value={dati.password} onChange={imposta('password')} required maxLength={1024} autoComplete="new-password" style={campo} />
        </label>
        <label style={etichetta}>Cartella <span style={nota}>quella da leggere</span>
          <input value={dati.cartella} onChange={imposta('cartella')} maxLength={200} style={campo} />
        </label>
        <label style={etichetta}>Raccogli dal <span style={nota}>vuoto: gli ultimi 30 giorni</span>
          <input type="date" value={dati.raccogliDal} onChange={imposta('raccogliDal')} style={campo} />
        </label>
      </div>

      <div style={nota}>
        La password si salva cifrata e non torna più a schermo. La casella si apre in sola lettura: BluMan non segna i messaggi come letti, non li sposta e non li cancella.
      </div>

      {esitoProva && (
        <div role={esitoProva.ok ? 'status' : 'alert'} style={{ fontSize: 12, fontWeight: 600, color: esitoProva.ok ? 'var(--pill-green-fg)' : 'var(--pill-red-fg)' }}>
          {esitoProva.ok ? '✓ ' : '✕ '}{esitoProva.testo}
        </div>
      )}
      {errore && <div role="alert" style={{ fontSize: 12, fontWeight: 600, color: 'var(--pill-red-fg)' }}>{errore}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={inCorso !== null}>{inCorso === 'salva' ? 'Salvataggio…' : 'Collega la casella'}</button>
        <button type="button" className="btn btn-secondary" disabled={inCorso !== null || !dati.host.trim() || !dati.utente.trim() || !dati.password} onClick={() => void prova()}>
          {inCorso === 'prova' ? 'Prova in corso…' : 'Prova senza salvare'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={inCorso !== null} onClick={onAnnulla}>Annulla</button>
      </div>
    </form>
  );
}
