// Lo stato degli incarichi e le cose da fare del cliente, lette dal server.
// Tre stati distinti (regola 13): si sta leggendo, non si è riusciti a leggere, ecco i dati.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentoPortale } from '../../api/client';
import { fetchRiepilogoPortaleApi, type RiepilogoPortale } from '../../api/canaleProtetto';
import { azioniDelProgetto } from './azioniCliente';
import type { PortalTab } from './types';

export type StatoRiepilogo =
  | { fase: 'caricamento' }
  | { fase: 'errore'; messaggio: string }
  | { fase: 'pronto'; dati: RiepilogoPortale };

interface Argomenti {
  /** Si legge solo con una sessione aperta. */
  attivo: boolean;
  /** Il cliente da leggere: serve solo all'anteprima dello studio, il cliente è già nel suo token. */
  clienteAnteprima: string | null;
  /** La scheda aperta: tornando sul riepilogo o sulle richieste si rilegge, così si vede ciò che è stato fatto altrove. */
  scheda: PortalTab;
  /** I documenti del fascicolo, col segnale «da firmare» del server: entrano nel conto delle cose da fare. */
  documenti: DocumentoPortale[];
}

export function usePortalRiepilogo({ attivo, clienteAnteprima, scheda, documenti }: Argomenti) {
  const rileggiQuando = scheda === 'riepilogo' || scheda === 'richieste' ? scheda : 'altre';
  const [stato, setStato] = useState<StatoRiepilogo>({ fase: 'caricamento' });
  const richiesta = useRef(0);

  const ricarica = useCallback(async () => {
    const questa = ++richiesta.current;
    try {
      const dati = await fetchRiepilogoPortaleApi(clienteAnteprima ?? undefined);
      // Una risposta arrivata dopo una richiesta più recente è già vecchia.
      if (questa === richiesta.current) setStato({ fase: 'pronto', dati });
    } catch (err) {
      if (questa !== richiesta.current) return;
      const messaggio = err instanceof Error ? err.message : 'Lo stato degli incarichi non è stato letto.';
      // Se c'erano già dei dati a schermo restano: un giro fallito non li cancella.
      setStato((prima) => (prima.fase === 'pronto' ? prima : { fase: 'errore', messaggio }));
    }
  }, [clienteAnteprima]);

  useEffect(() => {
    if (attivo) void ricarica();
  }, [attivo, ricarica, rileggiQuando]);

  /** I numeri accanto ai nomi delle schede: quante cose aspettano il cliente. */
  const conteggi = useMemo((): Partial<Record<PortalTab, number>> => {
    if (stato.fase !== 'pronto') return {};
    const azioni = stato.dati.progetti.flatMap((p) => azioniDelProgetto(p, documenti));
    return { riepilogo: azioni.length, richieste: azioni.filter((a) => a.tipo === 'richiesta').length };
  }, [stato, documenti]);

  return {
    stato,
    ricarica: () => { void ricarica(); },
    conteggi,
    cifraturaAttiva: stato.fase === 'pronto' ? stato.dati.canaleProtetto.cifraturaAttiva : null,
  };
}
