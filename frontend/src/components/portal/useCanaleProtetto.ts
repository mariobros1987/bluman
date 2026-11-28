// La conversazione del portale con lo studio: lettura (e rilettura periodica), «letti» e invio.
//
// Tutto passa dal server: un messaggio compare in elenco quando il server lo ha salvato, non
// prima. La versione precedente lo aggiungeva subito alla pagina e ingoiava l'errore dell'invio:
// un messaggio mai arrivato allo studio restava a schermo come inviato.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fileComeAllegato,
  inviaMessaggioProtettoApi,
  leggiMessaggiApi,
  motivoAllegatiNonAmmessi,
  type MessaggioCanale,
} from '../../api/canaleProtetto';
import { segnaComunicazioniLetteApi } from '../../api/progetti';

const OGNI_QUANTO_MS = 5000;

export type StatoLettura = 'caricamento' | 'pronto' | 'errore';

export function useCanaleProtetto(progettoId: string, soloLettura: boolean) {
  const [messaggi, setMessaggi] = useState<MessaggioCanale[]>([]);
  const [lettura, setLettura] = useState<StatoLettura>('caricamento');
  const [erroreLettura, setErroreLettura] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const [erroreInvio, setErroreInvio] = useState<string | null>(null);
  const progettoCorrente = useRef(progettoId);
  progettoCorrente.current = progettoId;

  const leggi = useCallback(async () => {
    if (!progettoId) return;
    try {
      const letti = await leggiMessaggiApi(progettoId);
      // La risposta di un incarico lasciato nel frattempo non deve finire a schermo.
      if (progettoCorrente.current !== progettoId) return;
      setMessaggi(letti);
      setLettura('pronto');
      setErroreLettura(null);
      // In anteprima lo studio guarda soltanto: non segna come letti i messaggi al posto del cliente.
      if (!soloLettura && letti.some((m) => m.direzione === 'uscita' && m.stato !== 'letto')) {
        void segnaComunicazioniLetteApi(progettoId, 'uscita');
      }
    } catch (err) {
      if (progettoCorrente.current !== progettoId) return;
      setErroreLettura(err instanceof Error ? err.message : 'I messaggi non sono stati letti.');
      // Un errore del giro periodico non cancella ciò che è già a schermo: lo si dichiara sopra.
      setLettura((prima) => (prima === 'pronto' ? 'pronto' : 'errore'));
    }
  }, [progettoId, soloLettura]);

  useEffect(() => {
    setMessaggi([]);
    setLettura('caricamento');
    setErroreLettura(null);
    setErroreInvio(null);
    if (!progettoId) return;
    void leggi();
    const giro = setInterval(() => void leggi(), OGNI_QUANTO_MS);
    return () => clearInterval(giro);
  }, [progettoId, leggi]);

  /** Vero se il messaggio è stato salvato: solo allora chi scrive può svuotare il campo. */
  const invia = useCallback(async (testo: string, file: File[]): Promise<boolean> => {
    if (!progettoId || invio) return false;
    const motivo = motivoAllegatiNonAmmessi(file);
    if (motivo) { setErroreInvio(motivo); return false; }
    setInvio(true);
    setErroreInvio(null);
    try {
      const allegatiProtetti = await Promise.all(file.map(fileComeAllegato));
      const salvato = await inviaMessaggioProtettoApi(progettoId, { testo: testo.trim(), allegatiProtetti });
      setMessaggi((prima) => (prima.some((m) => m.id === salvato.id) ? prima : [...prima, salvato]));
      return true;
    } catch (err) {
      setErroreInvio(err instanceof Error ? err.message : 'Il messaggio non è stato inviato.');
      return false;
    } finally {
      setInvio(false);
    }
  }, [progettoId, invio]);

  return { messaggi, lettura, erroreLettura, riprova: leggi, invia, invio, erroreInvio, azzeraErroreInvio: () => setErroreInvio(null) };
}
