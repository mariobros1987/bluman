// Verifica anti-ciclo del grafo delle dipendenze tra moduli template — §7ter.
//
// Le dipendenze formano un grafo diretto: l'arco A→B significa «A dipende da B».
// Il grafo dev'essere aciclico (DAG): se A dipende da B che dipende da A, nessuno
// dei due può mai partire (attesa_dipendenza reciproca, §7bis) e il progetto si
// incatena da solo. Il vincolo non è esprimibile come constraint SQL semplice
// (vedi il commento sul modello ModuloDipendenzaTemplate in schema.prisma): la
// verifica è applicativa e vive qui come funzione pura, testabile senza DB.
//
// Chirurgicità: la funzione segnala SOLO i cicli che la modifica in corso crea,
// cioè quelli che attraversano il modulo editato. Un ciclo già presente altrove
// nel grafo (dati corrotti, un bug storico) non viene attribuito a chi sta
// editando un modulo che non c'entra: altrimenti svuotare le dipendenze di A per
// RIPARARE un ciclo esistente verrebbe rifiutato, e il danno resterebbe
// irreparabile dall'interfaccia.

export interface ArcoDipendenza {
  /** Il modulo dipendente (A nell'arco A→B). */
  moduloTemplateId: string;
  /** Il prerequisito (B): A non può partire finché B non è concluso. */
  dipendeDaModuloTemplateId: string;
}

/**
 * Cerca un ciclo chiuso dalla modifica delle dipendenze di `moduloTemplateId`.
 *
 * `archiEsistenti` è tutto il grafo del tenant COM'È adesso; `nuoveDipendenzeDa`
 * sono le dipendenze che la modifica vuole assegnare al modulo. Il salvataggio
 * reale è una sostituzione completa (deleteMany + ricreazione): gli archi
 * uscenti vecchi del modulo vengono quindi ignorati e rimpiazzati dai nuovi
 * prima di attraversare il grafo.
 *
 * Ritorna il cammino del ciclo — gli id dei moduli, dall'editato fino a lui
 * stesso incluso ([A, B, A] per un ciclo diretto) — oppure null se la modifica
 * non chiude nessun ciclo.
 */
export function trovaCicloDipendenze(
  archiEsistenti: readonly ArcoDipendenza[],
  moduloTemplateId: string,
  nuoveDipendenzeDa: readonly string[],
): string[] | null {
  // Adiacenza uscente: A → [B, C] dove A dipende da B e da C. Gli archi
  // uscenti del modulo editato sono scartati: nel grafo da verificare valgono
  // solo quelli NUOVI, come nel salvataggio reale.
  const adiacenza = new Map<string, string[]>();
  for (const arco of archiEsistenti) {
    if (arco.moduloTemplateId === moduloTemplateId) continue;
    push(adiacenza, arco.moduloTemplateId, arco.dipendeDaModuloTemplateId);
  }
  for (const depId of nuoveDipendenzeDa) {
    push(adiacenza, moduloTemplateId, depId);
  }

  // DFS dal modulo editato: un ciclo, per essere creato da QUESTA modifica,
  // deve ripassare per lui. `visitati` evita di girare all'infinito dentro un
  // ciclo pre-esistente (che però, non attraversando l'editato, resta muto).
  const visitati = new Set<string>([moduloTemplateId]);
  const dfs = (nodo: string, cammino: string[]): string[] | null => {
    for (const next of adiacenza.get(nodo) ?? []) {
      if (next === moduloTemplateId) return [...cammino, next];
      if (visitati.has(next)) continue;
      visitati.add(next);
      const ciclo = dfs(next, [...cammino, next]);
      if (ciclo) return ciclo;
    }
    return null;
  };
  return dfs(moduloTemplateId, [moduloTemplateId]);
}

function push(mappa: Map<string, string[]>, chiave: string, valore: string): void {
  const lista = mappa.get(chiave);
  if (lista) lista.push(valore);
  else mappa.set(chiave, [valore]);
}
