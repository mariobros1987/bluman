// Una richiesta dello studio al cliente (un passaggio «a carico del cliente» di un'attività) e la
// sua risposta: campi da compilare, documento da rimandare, oppure una conferma.
//
// La risposta si salva sul server; se il salvataggio fallisce lo si dice e ciò che il cliente ha
// scritto resta nei campi (regola 3). Il passaggio lo chiude lo studio: qui non cambia stato.
import { useRef, useState } from 'react';
import {
  fileComeAllegato,
  MASSIMO_ALLEGATI_MESSAGGIO,
  motivoAllegatiNonAmmessi,
  rispondiRichiestaApi,
  type RichiestaCliente,
} from '../../api/canaleProtetto';
import { urlDocumentoAssoluto } from '../../api/http';

export interface SchedaRichiestaProps {
  richiesta: RichiestaCliente;
  /** Anteprima dello studio: si vede la richiesta, non si risponde al posto del cliente. */
  anteprima: boolean;
  onInviata: () => void;
}

const COSA_SERVE: Record<RichiestaCliente['tipo'], string> = {
  form: 'Dati da compilare',
  documento: 'Documento da mandare',
  info: 'Da leggere',
  verifica: 'Da confermare',
};

function valoriIniziali(richiesta: RichiestaCliente): Record<string, string> {
  return Object.fromEntries(richiesta.campi.map((c) => [c.nome, c.valore ?? '']));
}

export function SchedaRichiesta({ richiesta, anteprima, onInviata }: SchedaRichiestaProps) {
  const giaInviata = richiesta.stato === 'inviata';
  const [aperta, setAperta] = useState(richiesta.stato === 'da_fare' && richiesta.quando === 'ora');
  const [valori, setValori] = useState<Record<string, string>>(() => valoriIniziali(richiesta));
  const [nota, setNota] = useState('');
  const [file, setFile] = useState<File[]>([]);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const sceltaFile = useRef<HTMLInputElement>(null);
  const id = `richiesta-${richiesta.id}`;
  const vuoleFile = richiesta.tipo === 'documento';
  const soloConferma = (richiesta.tipo === 'info' || richiesta.tipo === 'verifica') && richiesta.campi.length === 0;

  const invia = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const mancante = richiesta.campi.find((c) => !(valori[c.nome] ?? '').trim());
    if (mancante) { setErrore(`Manca la risposta a «${mancante.nome}».`); return; }
    if (vuoleFile && file.length === 0) { setErrore('Questa richiesta aspetta un documento: allega il file.'); return; }
    const motivo = motivoAllegatiNonAmmessi(file);
    if (motivo) { setErrore(motivo); return; }
    setInvio(true);
    setErrore(null);
    try {
      await rispondiRichiestaApi(richiesta.id, {
        risposte: Object.fromEntries(richiesta.campi.map((c) => [c.nome, (valori[c.nome] ?? '').trim()])),
        nota: nota.trim() || undefined,
        allegatiProtetti: await Promise.all(file.map(fileComeAllegato)),
      });
      setNota('');
      setFile([]);
      if (sceltaFile.current) sceltaFile.current.value = '';
      onInviata();
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'La risposta non è stata salvata.');
    } finally {
      setInvio(false);
    }
  };

  return (
    <article style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }} aria-labelledby={`${id}-titolo`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--indigo-l)' }}>{COSA_SERVE[richiesta.tipo]}</div>
          <h3 id={`${id}-titolo`} style={{ fontSize: 14, fontWeight: 700, margin: '2px 0' }}>{richiesta.titolo}</h3>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Fase «{richiesta.faseNome}» · {richiesta.attivitaNome}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {giaInviata && (
            <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', borderRadius: 10, padding: '3px 10px' }}>
              Inviata{richiesta.inviataIl ? ` il ${new Date(richiesta.inviataIl).toLocaleDateString('it-IT')}` : ''}: la sta controllando lo studio
            </span>
          )}
          {richiesta.stato === 'chiusa' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>✓ Chiusa dallo studio</span>}
          {richiesta.stato !== 'chiusa' && (
            <button type="button" className="btn btn-sm" aria-expanded={aperta} aria-controls={`${id}-corpo`} onClick={() => setAperta((v) => !v)}>
              {aperta ? 'Chiudi' : giaInviata ? 'Rivedi o correggi' : 'Apri'}
            </button>
          )}
        </div>
      </div>

      {aperta && richiesta.stato !== 'chiusa' && (
        <form id={`${id}-corpo`} onSubmit={invia} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {richiesta.descrizione && <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{richiesta.descrizione}</div>}

          {(richiesta.modelloUrl || richiesta.linkIstruzioni) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {richiesta.modelloUrl && (
                <a className="btn btn-sm" href={urlDocumentoAssoluto(richiesta.modelloUrl)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  ⬇️ Scarica il documento dello studio
                </a>
              )}
              {richiesta.linkIstruzioni && (
                <a className="btn btn-sm" href={richiesta.linkIstruzioni} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>📖 Istruzioni</a>
              )}
            </div>
          )}

          {richiesta.campi.map((campo, indice) => (
            <div key={campo.nome} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor={`${id}-campo-${indice}`} style={{ fontSize: 11.5, fontWeight: 700 }}>{campo.nome}</label>
              <input
                id={`${id}-campo-${indice}`}
                type="text"
                value={valori[campo.nome] ?? ''}
                maxLength={2000}
                disabled={anteprima}
                onChange={(e) => setValori((prima) => ({ ...prima, [campo.nome]: e.target.value }))}
                style={{ fontSize: 13, padding: '9px 10px', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
              />
              {campo.ripreso && (
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  L'avevi già indicato in un'altra richiesta: lo riproponiamo, controlla che sia ancora giusto.
                </span>
              )}
            </div>
          ))}

          {!anteprima && !soloConferma && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700 }}>{vuoleFile ? 'Il documento da mandare' : 'Allegati (facoltativi)'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input ref={sceltaFile} type="file" multiple aria-label={`Allega file a ${richiesta.titolo}`} style={{ display: 'none' }} onChange={(e) => { setFile(Array.from(e.target.files ?? []).slice(0, MASSIMO_ALLEGATI_MESSAGGIO)); setErrore(null); }} />
                <button type="button" className="btn btn-sm" onClick={() => sceltaFile.current?.click()}>📎 Scegli file</button>
                <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  {file.length > 0 ? file.map((f) => f.name).join(', ') : `Fino a ${MASSIMO_ALLEGATI_MESSAGGIO} file, 15 MB l'uno. Arrivano allo studio cifrati, nel canale protetto.`}
                </span>
              </div>
            </div>
          )}

          {!anteprima && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor={`${id}-nota`} style={{ fontSize: 11.5, fontWeight: 700 }}>Nota per lo studio (facoltativa)</label>
              <textarea id={`${id}-nota`} value={nota} maxLength={5000} rows={2} onChange={(e) => setNota(e.target.value)} style={{ fontSize: 12.5, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }} />
            </div>
          )}

          {errore && (
            <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              <strong>Risposta non inviata.</strong> {errore}
            </div>
          )}

          {anteprima ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Anteprima dello studio: la risposta la invia il cliente dal suo accesso.</div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Dopo l'invio lo studio controlla la risposta e chiude la richiesta. Finché non la chiude puoi correggerla.</span>
              <button type="submit" className="btn btn-primary" disabled={invio}>
                {invio ? 'Invio in corso…' : soloConferma ? 'Conferma: fatto' : giaInviata ? 'Invia di nuovo' : 'Invia allo studio'}
              </button>
            </div>
          )}
        </form>
      )}
    </article>
  );
}
