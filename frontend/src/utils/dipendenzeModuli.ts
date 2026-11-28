// Le dipendenze tra i moduli di un progetto, lette dal server (`modulo.dipendenze`).
//
// Qui non si decide niente: se un modulo è bloccato lo dice il motore di stato sul server. Queste
// funzioni servono solo a far VEDERE le dipendenze — in che ordine vengono i moduli e da quali
// altri ognuno attende — che prima non comparivano da nessuna parte.

export interface ModuloConDipendenze {
  id: string;
  dipendenze?: ReadonlyArray<{ dipendeDaModuloProgettoId: string }> | null;
}

/**
 * Il «livello» di ogni modulo: 0 per chi non dipende da nessuno, altrimenti uno in più del livello
 * più alto fra i moduli da cui dipende. Le dipendenze verso moduli che non sono nell'elenco si
 * ignorano; un ciclo (che il server rifiuta, ma un dato sporco può esistere) si ferma senza
 * girare all'infinito e lascia quei moduli al livello raggiunto.
 */
export function livelliPerDipendenza(moduli: ReadonlyArray<ModuloConDipendenze>): Map<string, number> {
  const presenti = new Set(moduli.map((m) => m.id));
  const daCui = new Map<string, string[]>(
    moduli.map((m) => [m.id, (m.dipendenze ?? []).map((d) => d.dipendeDaModuloProgettoId).filter((id) => presenti.has(id) && id !== m.id)]),
  );
  const livelli = new Map<string, number>();
  const inVisita = new Set<string>();
  const livelloDi = (id: string): number => {
    const noto = livelli.get(id);
    if (noto !== undefined) return noto;
    if (inVisita.has(id)) return 0; // ciclo: non si scende oltre
    inVisita.add(id);
    const precedenti = daCui.get(id) ?? [];
    const livello = precedenti.length === 0 ? 0 : Math.max(...precedenti.map(livelloDi)) + 1;
    inVisita.delete(id);
    livelli.set(id, livello);
    return livello;
  };
  for (const m of moduli) livelloDi(m.id);
  return livelli;
}

/** Gli stessi elementi, prima quelli da cui gli altri dipendono; a parità resta l'ordine di partenza. */
export function ordinaPerLivello<T>(elementi: ReadonlyArray<T>, livello: (e: T) => number): T[] {
  return elementi
    .map((e, i) => ({ e, i, l: livello(e) }))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map((x) => x.e);
}

/** La frase «In attesa di: «A», «B»», oppure stringa vuota se non c'è niente da attendere. */
export function fraseAttesa(dipendeDa: ReadonlyArray<{ nome: string; fatto: boolean }> | undefined): string {
  const mancanti = (dipendeDa ?? []).filter((d) => !d.fatto).map((d) => `«${d.nome}»`);
  return mancanti.length ? `In attesa di: ${mancanti.join(', ')}` : '';
}

/**
 * Nel nuovo progetto: i moduli scelti che di solito vengono dopo un modulo NON scelto (titolare,
 * 28/11/2026: avvisare, non bloccare). Una dipendenza che non è più in libreria non si propone:
 * non la si potrebbe aggiungere.
 */
export function dipendenzeMancanti<M extends { id: string; n: string; deps?: ReadonlyArray<string> | null }>(
  scelti: ReadonlyArray<M>,
  libreria: ReadonlyArray<M>,
): Array<{ modulo: M; mancanti: M[] }> {
  const idScelti = new Set(scelti.map((m) => m.id));
  const perId = new Map(libreria.map((m) => [m.id, m]));
  return scelti
    .map((modulo) => ({
      modulo,
      mancanti: (modulo.deps ?? [])
        .filter((id) => !idScelti.has(id))
        .map((id) => perId.get(id))
        .filter((m): m is M => Boolean(m)),
    }))
    .filter((x) => x.mancanti.length > 0);
}
