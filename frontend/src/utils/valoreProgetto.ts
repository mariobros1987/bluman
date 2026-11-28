// Il valore del progetto mostrato nel dettaglio, in euro.
//
// Lo tiene il server (`progetto.valoreTotale`, centesimi): per un progetto con moduli è la somma
// dei loro prezzi, scritta quando i moduli cambiano. Qui si legge e basta. La somma fatta nel
// browser resta solo come ripiego per i progetti avviati prima che il server la scrivesse: hanno
// `valoreTotale` a 0 e moduli con il loro prezzo, e il primo salvataggio li rimette in pari.
export function valoreProgettoEuroDaServer(
  valoreTotaleCentesimi: unknown,
  moduli: ReadonlyArray<{ p?: number | null }>,
): number {
  if (typeof valoreTotaleCentesimi === 'number' && valoreTotaleCentesimi > 0) return valoreTotaleCentesimi / 100;
  return moduli.reduce((tot, m) => tot + (typeof m.p === 'number' ? m.p : 0), 0);
}

/** Il valore si scrive a mano solo se non ci sono moduli da sommare. */
export function valoreProgettoModificabile(moduli: ReadonlyArray<unknown> | null | undefined): boolean {
  return !moduli || moduli.length === 0;
}

export const SPIEGAZIONE_VALORE_DA_MODULI =
  'Il valore dell’incarico è la somma dei prezzi dei suoi moduli, meno lo sconto concordato: clicca per scrivere lo sconto.';
