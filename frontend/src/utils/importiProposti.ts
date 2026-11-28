// Gli importi che il compositore della fattura propone li calcola il server (`GET /progetti/:id`,
// `domain/importiFatturabili.ts`): listino dell'articolo, o prezzo del modulo in proporzione al
// listino, al netto dello sconto del progetto. Qui si leggono soltanto, e si dice da dove vengono.

export type CriterioImporto = 'listino' | 'proporzionale_listino' | 'parti_uguali';

export interface ImportiProposti {
  /** Importo proposto per un'attività, in euro; `null` = il server non ne propone uno. */
  voce(moduloDbId: string | undefined, voceDbId: string | undefined): number | null;
  /** Prezzo del modulo al netto dello sconto, in euro (per il modulo senza attività). */
  modulo(moduloDbId: string | undefined): number | null;
  criterio(moduloDbId: string | undefined): CriterioImporto | null;
  /** Sconto del progetto già tolto dagli importi, in euro (0 = nessuno). */
  scontoEuro: number;
}

const euro = (centesimi: unknown): number | null =>
  typeof centesimi === 'number' && centesimi > 0 ? centesimi / 100 : null;

/** Legge gli importi proposti dalla risposta del server; senza quei dati non propone niente. */
export function leggiImportiProposti(progettoDalServer: unknown): ImportiProposti {
  const moduli: any[] = (progettoDalServer as { moduli?: unknown[] } | null | undefined)?.moduli as any[] ?? [];
  const perModulo = new Map<string, any>(moduli.map((m) => [String(m.id), m]));
  return {
    voce(moduloDbId, voceDbId) {
      if (!moduloDbId || !voceDbId) return null;
      const voce = (perModulo.get(moduloDbId)?.microvoci ?? []).find((mv: any) => mv.id === voceDbId);
      return euro(voce?.importoPropostoCentesimi);
    },
    modulo(moduloDbId) {
      return moduloDbId ? euro(perModulo.get(moduloDbId)?.prezzoNettoCentesimi) : null;
    },
    criterio(moduloDbId) {
      return (moduloDbId && perModulo.get(moduloDbId)?.criterioRipartizione) || null;
    },
    scontoEuro: euro((progettoDalServer as { scontoApplicatoCentesimi?: unknown } | null | undefined)?.scontoApplicatoCentesimi) ?? 0,
  };
}

/**
 * L'etichetta accanto all'importo proposto e la frase che lo spiega (regola 12). Con uno sconto
 * sul progetto il prezzo netto del modulo non coincide con la somma dei listini anche quando il
 * prezzo pieno coincideva: la frase lo dice, invece di far cercare una differenza che non c'è.
 */
export function spiegaCriterio(criterio: CriterioImporto, moduloNome: string, scontoEuro = 0): { etichetta: string; spiegazione: string } {
  const prezzo = scontoEuro > 0 ? `Il prezzo del modulo «${moduloNome}», tolto lo sconto del progetto,` : `Il prezzo del modulo «${moduloNome}»`;
  if (criterio === 'listino') {
    return { etichetta: 'da listino', spiegazione: 'Prezzo di listino dell’articolo: modificalo se l’attività vale un importo diverso.' };
  }
  if (criterio === 'proporzionale_listino') {
    return {
      etichetta: 'in proporzione al listino',
      spiegazione: `${prezzo} è diverso dalla somma dei listini: è ripartito fra le attività in proporzione al listino. Modificalo se l’attività vale un importo diverso.`,
    };
  }
  return {
    etichetta: 'parti uguali',
    spiegazione: `Gli articoli del modulo «${moduloNome}» non hanno un prezzo di listino: il prezzo del modulo è diviso in parti uguali. Modificalo se l’attività vale un importo diverso.`,
  };
}
