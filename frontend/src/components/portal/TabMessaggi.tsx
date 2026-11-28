// La scheda «Messaggi» del portale: la conversazione riservata tra il cliente e lo studio.
//
// Dal portale si scrive solo qui dentro. Prima c'era un selettore «canale preferito» (email,
// WhatsApp, Telegram): sceglierlo non spediva niente su quel canale, etichettava soltanto la riga.
// Il lucchetto compare solo quando il server dichiara che il messaggio è cifrato a riposo.
import { useEffect, useRef, useState } from 'react';
import type { ContattiStudio } from '../../api/client';
import { MASSIMO_ALLEGATI_MESSAGGIO, type MessaggioCanale } from '../../api/canaleProtetto';
import { AllegatiMessaggio } from '../AllegatiMessaggio';
import { SpunteStato, type StatoRecapito } from '../SpunteStato';
import { docBoxStyle } from './styles';
import { useCanaleProtetto } from './useCanaleProtetto';

export interface TabMessaggiProps {
  contattiStudio: ContattiStudio | null;
  progettoId: string;
  nomeProgetto: string | null;
  /** `null` finché il server non ha detto se i messaggi nuovi vengono cifrati. */
  cifraturaAttiva: boolean | null;
  /** Anteprima dello studio: si legge, non si scrive al posto del cliente. */
  anteprima: boolean;
}

const NOMI_CANALE: Record<string, string> = { email: 'email', whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal' };

function IntestazioneCanale({ cifraturaAttiva }: { cifraturaAttiva: boolean | null }) {
  if (cifraturaAttiva === null) return null;
  return cifraturaAttiva ? (
    <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--green)', borderRadius: 10, padding: '10px 14px', fontSize: 11.5, lineHeight: 1.5, marginBottom: 16 }}>
      <strong style={{ color: 'var(--green)' }}>🔒 Canale protetto.</strong>{' '}
      Messaggi e allegati sono cifrati sui server dello studio e si leggono solo da qui, con il tuo accesso, e dagli operatori dello studio che seguono il tuo incarico.
      Le email di avviso dicono soltanto che c'è un messaggio, mai cosa dice.
    </div>
  ) : (
    <div style={{ background: 'var(--pill-amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 14px', fontSize: 11.5, lineHeight: 1.5, marginBottom: 16 }}>
      <strong>Canale riservato, non ancora cifrato.</strong>{' '}
      I messaggi si leggono solo con il tuo accesso e da chi nello studio segue il tuo incarico, ma su questo server la cifratura dell'archivio non è ancora stata attivata.
    </div>
  );
}

function Bolla({ messaggio, nomeStudio }: { messaggio: MessaggioCanale; nomeStudio: string }) {
  const mio = messaggio.direzione === 'entrata';
  const altroCanale = messaggio.canale !== 'portal' ? NOMI_CANALE[messaggio.canale] ?? messaggio.canale : null;
  return (
    <div
      style={{
        alignSelf: mio ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        background: mio ? 'var(--pill-indigo-bg)' : 'var(--card2)',
        border: `1px solid ${mio ? 'var(--indigo-d)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: '10px 14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo-l)' }}>
          {mio ? 'Tu' : (messaggio.mittente || nomeStudio)}
          {altroCanale && <span style={{ color: 'var(--muted)', fontWeight: 600 }}> · via {altroCanale}</span>}
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {messaggio.cifrato && <span title="Questo messaggio è conservato cifrato.">🔒</span>}
          <span>{new Date(messaggio.createdAt).toLocaleString('it-IT')}</span>
          {mio && (
            <SpunteStato
              stato={(messaggio.stato ?? null) as StatoRecapito}
              inviatoAt={messaggio.inviatoAt}
              consegnatoAt={messaggio.consegnatoAt}
              lettoAt={messaggio.lettoAt}
              errore={messaggio.errore}
              contesto="portale"
            />
          )}
        </span>
      </div>
      <div style={{ fontSize: 12, color: messaggio.illeggibile ? 'var(--muted)' : 'var(--text)', fontStyle: messaggio.illeggibile ? 'italic' : 'normal', lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {messaggio.testo}
      </div>
      <AllegatiMessaggio messaggio={messaggio} />
    </div>
  );
}

export function TabMessaggi({ contattiStudio, progettoId, nomeProgetto, cifraturaAttiva, anteprima }: TabMessaggiProps) {
  const { messaggi, lettura, erroreLettura, riprova, invia, invio, erroreInvio, azzeraErroreInvio } = useCanaleProtetto(progettoId, anteprima);
  const [testo, setTesto] = useState('');
  const [file, setFile] = useState<File[]>([]);
  const sceltaFile = useRef<HTMLInputElement>(null);
  const elenco = useRef<HTMLDivElement>(null);
  const nomeStudio = contattiStudio?.advisorNome || contattiStudio?.studio || 'Studio';

  // A ogni messaggio nuovo l'elenco scende in fondo. Scorre l'elenco, non la pagina: chi sta
  // leggendo più su nella scheda non viene trascinato giù.
  useEffect(() => {
    if (elenco.current) elenco.current.scrollTop = elenco.current.scrollHeight;
  }, [messaggi.length]);

  const spedisci = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!testo.trim() && file.length === 0) return;
    // Il campo si svuota solo a messaggio salvato: se l'invio fallisce il testo resta lì.
    if (await invia(testo, file)) {
      setTesto('');
      setFile([]);
      if (sceltaFile.current) sceltaFile.current.value = '';
    }
  };

  return (
    <div style={docBoxStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💬 Messaggi con lo studio</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
        {nomeProgetto ? <>Conversazione sull'incarico <strong style={{ color: 'var(--text)' }}>{nomeProgetto}</strong>. </> : null}
        Ti risponde {nomeStudio}
        {contattiStudio?.advisorEmail || contattiStudio?.telefono
          ? <> ({[contattiStudio?.advisorEmail, contattiStudio?.telefono].filter(Boolean).join(' · ')})</>
          : null}.
      </div>

      <IntestazioneCanale cifraturaAttiva={cifraturaAttiva} />

      {!progettoId && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
          Non hai ancora un incarico aperto: la conversazione si apre con il primo incarico.
        </div>
      )}

      {progettoId && erroreLettura && (
        <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>I messaggi non si sono aggiornati: {erroreLettura}</span>
          <button type="button" className="btn btn-sm" onClick={() => void riprova()}>Riprova</button>
        </div>
      )}

      {progettoId && (
        <div ref={elenco} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 420, overflowY: 'auto', marginBottom: 16 }}>
          {lettura === 'caricamento' && <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>⏳ Leggo i messaggi…</div>}
          {lettura === 'errore' && <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>La conversazione non si è potuta leggere. Non vuol dire che sia vuota: riprova.</div>}
          {lettura === 'pronto' && messaggi.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>Nessun messaggio finora. Scrivi qui sotto per aprire la conversazione con lo studio.</div>
          )}
          {messaggi.map((m) => <Bolla key={m.id} messaggio={m} nomeStudio={nomeStudio} />)}
        </div>
      )}

      {progettoId && anteprima && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 10, padding: '10px 14px' }}>
          Anteprima dello studio: da qui non si scrive al posto del cliente. Per rispondergli usa la scheda Comunicazioni dell'incarico, canale «Portale».
        </div>
      )}

      {progettoId && !anteprima && (
        <form onSubmit={spedisci} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}>
          {erroreInvio && (
            <div role="alert" style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              <strong>Messaggio non inviato.</strong> {erroreInvio} Quello che hai scritto è ancora qui sotto.
            </div>
          )}
          <label htmlFor="portale-nuovo-messaggio" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Scrivi allo studio</label>
          <textarea
            id="portale-nuovo-messaggio"
            value={testo}
            onChange={(e) => { setTesto(e.target.value); if (erroreInvio) azzeraErroreInvio(); }}
            placeholder="Scrivi qui la tua domanda o la tua risposta…"
            rows={3}
            maxLength={20000}
            style={{ fontSize: 12.5, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }}
          />
          {file.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {file.map((f, indice) => (
                <span key={`${f.name}-${indice}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', borderRadius: 8, padding: '4px 10px', fontSize: 11 }}>
                  📎 {f.name}
                  <button type="button" aria-label={`Togli ${f.name}`} onClick={() => setFile((prima) => prima.filter((_, i) => i !== indice))} style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                ref={sceltaFile}
                type="file"
                multiple
                aria-label="Allega file"
                style={{ display: 'none' }}
                onChange={(e) => { setFile(Array.from(e.target.files ?? []).slice(0, MASSIMO_ALLEGATI_MESSAGGIO)); if (erroreInvio) azzeraErroreInvio(); }}
              />
              <button type="button" className="btn btn-sm" onClick={() => sceltaFile.current?.click()}>📎 Allega file</button>
              <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>PDF, immagini, Word, Excel. Fino a {MASSIMO_ALLEGATI_MESSAGGIO} file, 15 MB l'uno.</span>
            </div>
            <button type="submit" className="btn btn-primary" disabled={invio || (!testo.trim() && file.length === 0)}>
              {invio ? 'Invio in corso…' : 'Invia'}
            </button>
          </div>
        </form>
      )}

      {/* §2.6 — i recapiti dello studio sono quelli letti dal database, non un testo fisso. */}
      {(contattiStudio?.sedeLegale || contattiStudio?.emailStudio) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 16, lineHeight: 1.5 }}>
          {contattiStudio?.studio ? <strong style={{ color: 'var(--text)' }}>{contattiStudio.studio}</strong> : null}
          {contattiStudio?.sedeLegale ? <> · {contattiStudio.sedeLegale}</> : null}
          {contattiStudio?.emailStudio ? <> · ✉️ {contattiStudio.emailStudio}</> : null}
        </div>
      )}
    </div>
  );
}
