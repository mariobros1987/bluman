// La scheda «Configurazione» della posta, per chi risponde dello studio: le caselle collegate e
// l'inoltro dei clienti. Le due letture sono indipendenti: se una fallisce l'altra resta usabile.
import { useCallback, useEffect, useState } from 'react';
import { fetchCasellePostaApi, fetchInoltriClientiApi, type CasellaPosta, type ClienteInoltro } from '../../api/posta';
import { CasellePosta } from './CasellePosta';
import { InoltriClientiPosta } from './InoltriClientiPosta';

interface Props {
  /** Una casella è stata collegata, fermata o scollegata: la pagina rilegge lo stato della raccolta. */
  onCambiato: () => void;
}

const riquadro = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 } as const;

function Errore({ titolo, errore, onRiprova }: { titolo: string; errore: string; onRiprova: () => void }) {
  return (
    <div role="alert" style={{ ...riquadro, background: 'var(--pill-red-bg)', borderColor: 'var(--pill-red-bd)', color: 'var(--pill-red-fg)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{titolo}</div>
      <div style={{ fontSize: 13, marginBottom: 10 }}>{errore}</div>
      <button type="button" className="btn btn-sm" onClick={onRiprova}>Riprova</button>
    </div>
  );
}

export function ConfigurazionePosta({ onCambiato }: Props) {
  const [caselle, setCaselle] = useState<CasellaPosta[] | null>(null);
  const [erroreCaselle, setErroreCaselle] = useState<string | null>(null);
  const [inoltri, setInoltri] = useState<{ casellaDiRaccolta: string | null; clienti: ClienteInoltro[] } | null>(null);
  const [erroreInoltri, setErroreInoltri] = useState<string | null>(null);

  const leggiCaselle = useCallback(async () => {
    setErroreCaselle(null);
    try {
      setCaselle(await fetchCasellePostaApi());
    } catch (err) {
      setCaselle(null);
      setErroreCaselle(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, []);

  const leggiInoltri = useCallback(async () => {
    setErroreInoltri(null);
    try {
      setInoltri(await fetchInoltriClientiApi());
    } catch (err) {
      setInoltri(null);
      setErroreInoltri(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, []);

  useEffect(() => { void leggiCaselle(); }, [leggiCaselle]);
  useEffect(() => { void leggiInoltri(); }, [leggiInoltri]);

  // L'indirizzo di inoltro dipende dalla casella di raccolta: ogni modifica alle caselle rilegge anche gli inoltri.
  const cambiato = () => {
    void leggiCaselle();
    void leggiInoltri();
    onCambiato();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erroreCaselle ? (
        <Errore titolo="Le caselle non sono state lette" errore={erroreCaselle} onRiprova={() => void leggiCaselle()} />
      ) : caselle === null ? (
        <div style={{ ...riquadro, color: 'var(--muted)', textAlign: 'center' }}>Caricamento delle caselle…</div>
      ) : (
        <div style={riquadro}>
          <CasellePosta caselle={caselle} clienti={inoltri ? inoltri.clienti.map((c) => ({ id: c.id, nome: c.nome })) : null} onCambiato={cambiato} />
        </div>
      )}

      {erroreInoltri ? (
        <Errore titolo="Gli inoltri dei clienti non sono stati letti" errore={erroreInoltri} onRiprova={() => void leggiInoltri()} />
      ) : inoltri === null ? (
        <div style={{ ...riquadro, color: 'var(--muted)', textAlign: 'center' }}>Caricamento degli inoltri…</div>
      ) : (
        <div style={riquadro}>
          <InoltriClientiPosta casellaDiRaccolta={inoltri.casellaDiRaccolta} clienti={inoltri.clienti} onCambiato={() => void leggiInoltri()} />
        </div>
      )}
    </div>
  );
}
