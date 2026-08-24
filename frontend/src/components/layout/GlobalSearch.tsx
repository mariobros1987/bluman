import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ricercaGlobaleApi, type GruppoRicerca, type RisultatoRicerca } from '../../api/client';
import styles from './GlobalSearch.module.css';

const DEBOUNCE_MS = 300;
const MIN_CARATTERI = 2;

interface VoceAppiattita {
  gruppo: GruppoRicerca;
  risultato: RisultatoRicerca;
}

// Ricerca globale (Blocco 4) — interroga GET /search con debounce e mostra
// i risultati raggruppati per tipo di entità. Il click (o Invio) naviga
// direttamente alla pagina dell'entità tramite il link fornito dal backend.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [testo, setTesto] = useState('');
  const [gruppi, setGruppi] = useState<GruppoRicerca[] | null>(null);
  const [aperto, setAperto] = useState(false);
  const [ricercaInCorso, setRicercaInCorso] = useState(false);
  const [errore, setErrore] = useState('');
  const [selezione, setSelezione] = useState(0);
  const contenitoreRef = useRef<HTMLDivElement>(null);
  const richiestaPiuRecente = useRef(0);

  const query = testo.trim();

  // Debounce: ogni battitura riarma il timer, solo l'ultima query parte davvero.
  useEffect(() => {
    if (query.length < MIN_CARATTERI) {
      setGruppi(null);
      setErrore('');
      setRicercaInCorso(false);
      setAperto(false);
      return;
    }
    setRicercaInCorso(true);
    const timer = setTimeout(async () => {
      const idRichiesta = ++richiestaPiuRecente.current;
      try {
        const risposta = await ricercaGlobaleApi(query);
        // Scarta risposte di query già superate (race tra richieste in volo)
        if (idRichiesta !== richiestaPiuRecente.current) return;
        setGruppi(risposta.gruppi);
        setErrore('');
        setAperto(true);
        setSelezione(0);
      } catch (err: any) {
        if (idRichiesta !== richiestaPiuRecente.current) return;
        setGruppi(null);
        setErrore(err?.message || 'Errore durante la ricerca');
        setAperto(true);
      } finally {
        if (idRichiesta === richiestaPiuRecente.current) setRicercaInCorso(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Lista piatta per la navigazione con frecce + Invio.
  const voci: VoceAppiattita[] = useMemo(() => {
    if (!gruppi) return [];
    return gruppi.flatMap((g) => g.risultati.map((r) => ({ gruppo: g, risultato: r })));
  }, [gruppi]);

  const vaiA = useCallback((voce: VoceAppiattita) => {
    setAperto(false);
    setTesto('');
    setGruppi(null);
    navigate(voce.risultato.link);
  }, [navigate]);

  // Click fuori dal pannello → chiude i risultati.
  useEffect(() => {
    const gestore = (e: MouseEvent) => {
      if (contenitoreRef.current && !contenitoreRef.current.contains(e.target as Node)) {
        setAperto(false);
      }
    };
    document.addEventListener('mousedown', gestore);
    return () => document.removeEventListener('mousedown', gestore);
  }, []);

  const gestisciTastiera = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setAperto(false);
      return;
    }
    if (!aperto || voci.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelezione((s) => (s + 1) % voci.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelezione((s) => (s - 1 + voci.length) % voci.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const voce = voci[selezione];
      if (voce) vaiA(voce);
    }
  };

  let indicePiatto = -1;

  return (
    <div className={styles.contenitore} ref={contenitoreRef}>
      <div className={styles.campo}>
        <span className={styles.lente}>{ricercaInCorso ? '⏳' : '🔍'}</span>
        <input
          type="text"
          value={testo}
          placeholder="Cerca clienti, progetti, fatture…"
          onChange={(e) => setTesto(e.target.value)}
          onFocus={() => { if (gruppi || errore) setAperto(true); }}
          onKeyDown={gestisciTastiera}
          aria-label="Ricerca globale"
        />
        {testo && (
          <button
            className={styles.pulisci}
            onClick={() => { setTesto(''); setGruppi(null); setErrore(''); setAperto(false); }}
            title="Pulisci ricerca"
          >
            ✕
          </button>
        )}
      </div>

      {aperto && (
        <div className={styles.pannello}>
          {errore && (
            <div className={styles.statoErrore}>⚠️ {errore}</div>
          )}

          {!errore && gruppi && voci.length === 0 && (
            <div className={styles.statoVuoto}>Nessun risultato per «{query}»</div>
          )}

          {!errore && gruppi && gruppi.map((gruppo) => (
            <div key={gruppo.tipo} className={styles.gruppo}>
              <div className={styles.intestazioneGruppo}>
                <span>{gruppo.icona}</span>
                <span>{gruppo.etichetta}</span>
                <span className={styles.contatore}>{gruppo.risultati.length}</span>
              </div>
              {gruppo.risultati.map((risultato) => {
                indicePiatto += 1;
                const corrente = indicePiatto === selezione;
                const voce: VoceAppiattita = { gruppo, risultato };
                return (
                  <button
                    key={`${gruppo.tipo}-${risultato.id}`}
                    className={`${styles.risultato} ${corrente ? styles.risultatoAttivo : ''}`}
                    onMouseEnter={() => setSelezione(indicePiatto)}
                    onClick={() => vaiA(voce)}
                  >
                    <div className={styles.titolo}>{risultato.titolo}</div>
                    {risultato.sottotitolo && (
                      <div className={styles.sottotitolo}>{risultato.sottotitolo}</div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
