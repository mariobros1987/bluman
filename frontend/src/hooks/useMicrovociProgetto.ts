// §40 — Le micro-voci di un progetto, per la tendina che collega un documento.
//
// Nessun endpoint nuovo: `GET /progetti/:id` restituisce già `moduli[].microvoci[]` con gli id
// veri a database (`fetchProgettoDettaglio`). Qui l'albero viene appiattito in un elenco unico,
// perché nella tendina serve la micro-voce col nome del modulo accanto — «Deposito bilancio» da
// solo non basta quando due moduli hanno voci omonime.
//
// Il difetto che il backend di §40 chiude (una micro-voce di un ALTRO progetto agganciata al
// documento) nasceva proprio in una tendina: si popolava una volta e restava sul progetto
// precedente. Per questo l'elenco si ricarica su `progettoId` e si svuota mentre carica: una
// tendina che mostra ancora le voci di prima è l'errore, non l'attesa.

import { useEffect, useState } from 'react';
import { fetchProgettoDettaglio } from '../api/client';

export interface MicrovoceScelta {
  id: string;
  nome: string;
  /** Il modulo che la contiene: serve a distinguere due voci con lo stesso nome. */
  modulo: string;
}

/** Appiattisce `moduli[].microvoci[]` scartando le righe senza id: senza id non si collega niente. */
function appiattisci(progetto: any): MicrovoceScelta[] {
  const moduli: any[] = Array.isArray(progetto?.moduli) ? progetto.moduli : [];
  const voci: MicrovoceScelta[] = [];
  for (const modulo of moduli) {
    const nomeModulo = String(modulo?.nome ?? modulo?.titolo ?? 'Modulo');
    const microvoci: any[] = Array.isArray(modulo?.microvoci) ? modulo.microvoci : [];
    for (const mv of microvoci) {
      const id = typeof mv?.id === 'string' ? mv.id : '';
      if (!id) continue;
      voci.push({ id, nome: String(mv?.nome ?? mv?.titolo ?? 'Micro-voce'), modulo: nomeModulo });
    }
  }
  return voci;
}

/**
 * Le micro-voci del progetto indicato. `progettoId` nullo/vuoto = nessuna lettura, elenco vuoto.
 *
 * `errore` non è mai «nessuna micro-voce»: un progetto senza moduli e un progetto illeggibile
 * vanno detti in modo diverso, altrimenti l'operatore collega al solo fascicolo credendo che le
 * micro-voci non esistano (regola 7).
 */
export function useMicrovociProgetto(progettoId: string | null | undefined): {
  microvoci: MicrovoceScelta[];
  caricamento: boolean;
  errore: string | null;
} {
  const [microvoci, setMicrovoci] = useState<MicrovoceScelta[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const id = (progettoId ?? '').trim();
    setMicrovoci([]);
    setErrore(null);
    if (!id) {
      setCaricamento(false);
      return;
    }

    let annullato = false;
    setCaricamento(true);
    fetchProgettoDettaglio(id)
      .then((progetto) => {
        if (annullato) return;
        // `fetchProgettoDettaglio` restituisce `null` quando la lettura non riesce: è un errore,
        // non un progetto senza lavorazione.
        if (!progetto) {
          setErrore('Impossibile leggere le micro-voci del progetto.');
          return;
        }
        setMicrovoci(appiattisci(progetto));
      })
      .catch((err) => {
        if (!annullato) setErrore(err instanceof Error ? err.message : 'Impossibile leggere le micro-voci del progetto.');
      })
      .finally(() => {
        if (!annullato) setCaricamento(false);
      });

    return () => {
      annullato = true;
    };
  }, [progettoId]);

  return { microvoci, caricamento, errore };
}
