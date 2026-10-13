import { useCallback, useEffect, useState } from 'react';
import { fetchAnagraficaStudioApi, type CampoAnagrafica, type StatoAnagraficaStudio } from '../api/client';

/**
 * Legge dal server i dati obbligatori dell'anagrafica dello studio.
 *
 * Esiste perché i punti che devono saperlo sono due — il promemoria al primo accesso
 * (`AppLayout`) e il richiamo da Impostazioni (`SettingsPage`) — e la lettura è la stessa: una
 * seconda copia darebbe due risposte diverse alla stessa domanda, ed è la classe di guasto che
 * questa estrazione toglie di mezzo.
 *
 * `letto: false` vuol dire «non ho potuto guardare», non «va tutto bene»: chi consuma questo
 * hook deve trattarlo come «non lo so» e **non** mostrare la guida. Vedi `fetchAnagraficaStudioApi`.
 *
 * `abilitato: false` non chiama affatto il server: la guida è per l'admin dello studio, e un
 * collaboratore non deve pagare una richiesta per un pannello che non vedrà (né gli si deve
 * dire che i campi che non può scrivere gli «mancano»).
 */
export function useAnagraficaStudio(opzioni?: { abilitato?: boolean }): StatoAnagraficaStudio & { ricarica: () => void } {
  const abilitato = opzioni?.abilitato !== false;
  const [stato, setStato] = useState<StatoAnagraficaStudio>({ letto: false, completa: false, mancanti: [] as CampoAnagrafica[] });
  const [giro, setGiro] = useState(0);

  const ricarica = useCallback(() => setGiro(g => g + 1), []);

  useEffect(() => {
    if (!abilitato) return;
    let vivo = true;
    // La promessa non si attende e non si ripropaga: `fetchAnagraficaStudioApi` non lancia mai,
    // restituisce `letto: false`. Il flag `vivo` evita che la risposta di uno studio precedente
    // (o di un componente già smontato) scriva sullo stato di quello nuovo.
    void fetchAnagraficaStudioApi().then(risposta => {
      if (vivo) setStato(risposta);
    });
    return () => { vivo = false; };
  }, [abilitato, giro]);

  return { ...stato, ricarica };
}
