import { useMemo, useRef } from 'react';
import { useToast } from '../components/ui/ToastProvider';

/**
 * Errori di chiamate ripetute dal polling (ogni 5 s): il primo si mostra, gli altri con la stessa
 * chiave no, finché la chiamata non torna a riuscire. Senza, un rifiuto persistente (es. 403)
 * produrrebbe un toast a ogni giro; con il vecchio `.catch(() => {})` non ne produceva nessuno.
 */
export function useErroreRipetuto() {
  // L'oggetto restituito è stabile (può stare nelle dipendenze di un effetto di polling senza
  // riavviarlo): il toast corrente si legge da un ref, perché fuori dal provider cambia a ogni render.
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const segnalati = useRef(new Set<string>());
  return useMemo(
    () => ({
      fallito: (chiave: string, messaggio: string, err: unknown) => {
        console.error(messaggio, err);
        if (segnalati.current.has(chiave)) return;
        segnalati.current.add(chiave);
        toastRef.current.errore(`${messaggio}: ${err instanceof Error ? err.message : 'errore di rete'}.`);
      },
      riuscito: (chiave: string) => {
        segnalati.current.delete(chiave);
      },
    }),
    [],
  );
}
