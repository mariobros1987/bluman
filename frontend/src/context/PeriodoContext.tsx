// Periodo/Esercizio globale: un intervallo di date (dataDa/dataA, YYYY-MM-DD) scelto una volta
// nella barra in alto e propagato alle pagine che filtrano per data (Progetti, Fatture,
// Scadenzario, Documenti). NON è uno «scatolone per anno»: i record restano continui, il periodo
// è solo una lente. Persistito per-tenant (come il resto dello stato condiviso, via
// getTenantStorageKey); il cambio tenant nella topbar ricarica la pagina, quindi il provider si
// re-inizializza sulla chiave del nuovo tenant.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { getTenantStorageKey } from '../utils/tenant';

interface PeriodoValore {
  /** Estremi YYYY-MM-DD; stringa vuota = lato aperto. */
  dataDa: string;
  dataA: string;
  /** true se almeno un estremo filtra. */
  attivo: boolean;
  setPeriodo: (dataDa: string, dataA: string) => void;
  /** Imposta l'intervallo 1 gennaio – 31 dicembre dell'anno indicato. */
  setAnno: (anno: number) => void;
  azzera: () => void;
}

const PeriodoContext = createContext<PeriodoValore | null>(null);

const CHIAVE = 'bluman_periodo_attivo';

function leggiIniziale(): { dataDa: string; dataA: string } {
  try {
    const grezzo = localStorage.getItem(getTenantStorageKey(CHIAVE));
    if (grezzo) {
      const p = JSON.parse(grezzo);
      if (p && typeof p.dataDa === 'string' && typeof p.dataA === 'string') {
        return { dataDa: p.dataDa, dataA: p.dataA };
      }
    }
  } catch {
    // localStorage assente o JSON corrotto: si parte senza filtro, non è un errore.
  }
  return { dataDa: '', dataA: '' };
}

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState(leggiIniziale);

  const persisti = useCallback((dataDa: string, dataA: string) => {
    setStato({ dataDa, dataA });
    try {
      localStorage.setItem(getTenantStorageKey(CHIAVE), JSON.stringify({ dataDa, dataA }));
    } catch {
      // Se non si può persistere, il periodo vale comunque per la sessione corrente.
    }
  }, []);

  const setPeriodo = useCallback((dataDa: string, dataA: string) => persisti(dataDa, dataA), [persisti]);
  const setAnno = useCallback((anno: number) => persisti(`${anno}-01-01`, `${anno}-12-31`), [persisti]);
  const azzera = useCallback(() => persisti('', ''), [persisti]);

  const valore: PeriodoValore = {
    dataDa: stato.dataDa,
    dataA: stato.dataA,
    attivo: Boolean(stato.dataDa || stato.dataA),
    setPeriodo,
    setAnno,
    azzera,
  };

  return <PeriodoContext.Provider value={valore}>{children}</PeriodoContext.Provider>;
}

/** Il periodo globale. Fuori dal provider ritorna un intervallo vuoto inerte (nessun filtro),
 *  così una pagina montata in un test senza provider non esplode. */
export function usePeriodo(): PeriodoValore {
  const ctx = useContext(PeriodoContext);
  if (ctx) return ctx;
  return { dataDa: '', dataA: '', attivo: false, setPeriodo: () => {}, setAnno: () => {}, azzera: () => {} };
}
