// Gli allegati sotto un messaggio del fascicolo, per lo studio e per il portale.
//
// Quelli del canale protetto non hanno un indirizzo da aprire: si scaricano con il token della
// sessione (`scaricaAllegatoProtettoApi`), e un errore si legge accanto al file. Gli allegati degli
// altri canali restano un collegamento, com'erano.
import { useState, type ReactNode } from 'react';
import { allegatiDelMessaggio, scaricaAllegatoProtettoApi, type AllegatoMessaggio } from '../api/canaleProtetto';
import { urlDocumentoAssoluto } from '../api/http';

export interface AllegatiMessaggioProps {
  messaggio: { allegatiJson?: unknown; allegati?: unknown };
  /** Un'azione in più accanto a «Scarica», per gli allegati che hanno un indirizzo (non i protetti). */
  azione?: (allegato: AllegatoMessaggio) => ReactNode;
}

function RigaAllegato({ allegato, azione }: { allegato: AllegatoMessaggio; azione?: AllegatiMessaggioProps['azione'] }) {
  const [scaricando, setScaricando] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const scarica = async () => {
    setScaricando(true);
    setErrore(null);
    try {
      await scaricaAllegatoProtettoApi(allegato);
    } catch (err) {
      setErrore(err instanceof Error ? err.message : 'Scarico non riuscito.');
    } finally {
      setScaricando(false);
    }
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {allegato.protetto ? '🔒' : '📄'} {allegato.nome}
          </div>
          {allegato.dimensione && <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{allegato.dimensione}</div>}
        </div>
        {allegato.protetto ? (
          // Senza indirizzo il messaggio è appena partito: il file si potrà riscaricare a scrittura finita.
          allegato.url ? (
            <button type="button" className="btn btn-sm" onClick={scarica} disabled={scaricando} title="Il file si scarica solo da qui, con il tuo accesso: non esiste un link da inoltrare.">
              {scaricando ? 'Scarico…' : '⬇️ Scarica'}
            </button>
          ) : <span style={{ fontSize: 10, color: 'var(--muted)' }}>in invio…</span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <a className="btn btn-sm" href={urlDocumentoAssoluto(allegato.url || '#')} target="_blank" rel="noreferrer" download={allegato.nome} style={{ textDecoration: 'none' }}>
              ⬇️ Scarica
            </a>
            {azione?.(allegato)}
          </div>
        )}
      </div>
      {errore && <div role="alert" style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 4 }}>{errore}</div>}
    </div>
  );
}

export function AllegatiMessaggio({ messaggio, azione }: AllegatiMessaggioProps) {
  const allegati = allegatiDelMessaggio(messaggio);
  if (allegati.length === 0) return null;
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>📎 Allegati ({allegati.length})</div>
      {allegati.map((allegato, indice) => <RigaAllegato key={`${allegato.url}-${indice}`} allegato={allegato} azione={azione} />)}
    </div>
  );
}
