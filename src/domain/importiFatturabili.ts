// Gli importi che il compositore della fattura propone per le attività di un progetto (deciso dal
// titolare il 28/11/2026). PURO: lo usa la lettura del progetto, così la pagina non fa conti.
//
// 1. Ogni attività vale il prezzo di listino del suo articolo. Se il modulo ha un prezzo a
//    pacchetto diverso dalla somma dei listini, il prezzo del modulo si ripartisce in proporzione
//    al listino. Senza listini (tutti a 0) non c'è una proporzione: si divide in parti uguali.
// 2. Lo sconto del progetto si toglie da ogni modulo in proporzione al suo prezzo.
// Tutto in centesimi, e ogni ripartizione torna al centesimo col totale da cui parte.

export type CriterioRipartizione = 'listino' | 'proporzionale_listino' | 'parti_uguali';

/**
 * Divide `totale` (centesimi, ≥ 0) secondo i `pesi`: ogni quota è arrotondata per difetto e i
 * centesimi che avanzano vanno alle quote col resto più alto (a parità, alla prima). La somma
 * delle quote è sempre `totale`. Pesi tutti a 0 (o assenti) = parti uguali.
 */
export function ripartisciPerPesi(totale: number, pesi: ReadonlyArray<number>): number[] {
  if (pesi.length === 0) return [];
  const validi = pesi.map((p) => (Number.isFinite(p) && p > 0 ? Math.round(p) : 0));
  const usati = validi.some((p) => p > 0) ? validi : validi.map(() => 1);
  const somma = usati.reduce((a, b) => a + BigInt(b), 0n);
  const tot = BigInt(Math.max(0, Math.round(totale)));
  const quote = usati.map((p) => (tot * BigInt(p)) / somma);
  const resti = usati.map((p, i) => ({ i, resto: (tot * BigInt(p)) % somma }));
  let avanzo = Number(tot - quote.reduce((a, b) => a + b, 0n));
  resti.sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
  const esito = quote.map((q) => Number(q));
  for (const r of resti) {
    if (avanzo <= 0) break;
    esito[r.i]! += 1;
    avanzo -= 1;
  }
  return esito;
}

/**
 * Gli importi delle attività di un modulo dato il suo prezzo e i listini dei loro articoli.
 * `null` se il modulo non ha un prezzo: non c'è niente da proporre, e non si inventa.
 */
export function importiVociModulo(
  prezzoModuloCentesimi: number,
  listiniCentesimi: ReadonlyArray<number>,
): { importi: number[]; criterio: CriterioRipartizione } | null {
  if (!(prezzoModuloCentesimi > 0) || listiniCentesimi.length === 0) return null;
  const listini = listiniCentesimi.map((l) => (Number.isFinite(l) && l > 0 ? Math.round(l) : 0));
  const sommaListini = listini.reduce((a, b) => a + b, 0);
  if (sommaListini === 0) {
    return { importi: ripartisciPerPesi(prezzoModuloCentesimi, listini), criterio: 'parti_uguali' };
  }
  if (sommaListini === prezzoModuloCentesimi) return { importi: listini, criterio: 'listino' };
  return { importi: ripartisciPerPesi(prezzoModuloCentesimi, listini), criterio: 'proporzionale_listino' };
}

/** Lo sconto che si applica davvero: mai negativo, mai più della somma dei moduli. */
export function scontoApplicabile(sommaModuliCentesimi: number, scontoCentesimi: number): number {
  if (!Number.isFinite(scontoCentesimi) || scontoCentesimi <= 0) return 0;
  return Math.min(Math.round(scontoCentesimi), Math.max(0, sommaModuliCentesimi));
}

/** I prezzi dei moduli al netto dello sconto del progetto, tolto in proporzione al prezzo. */
export function prezziModuliScontati(prezziCentesimi: ReadonlyArray<number>, scontoCentesimi: number): number[] {
  const prezzi = prezziCentesimi.map((p) => (Number.isFinite(p) && p > 0 ? Math.round(p) : 0));
  const somma = prezzi.reduce((a, b) => a + b, 0);
  const sconto = scontoApplicabile(somma, scontoCentesimi);
  if (sconto === 0) return prezzi;
  return ripartisciPerPesi(somma - sconto, prezzi);
}

// `always`: l'italiano di Intl non separa le migliaia sotto 10.000 («1000,00 €»), in fattura sì.
const EURO = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  // Il tipo della libreria in uso conosce solo il booleano.
  useGrouping: 'always' as unknown as boolean,
});

/**
 * La riga che dichiara in fattura lo sconto del progetto («mostrato in fattura»); `null` se il
 * progetto non ha uno sconto. Dice lo sconto e il totale su cui è stato concordato: gli importi
 * delle righe restano quelli che l'operatore ha confermato.
 */
export function notaScontoProgetto(sommaModuliCentesimi: number, scontoCentesimi: number): string | null {
  const sconto = scontoApplicabile(sommaModuliCentesimi, scontoCentesimi);
  if (sconto === 0) return null;
  return `Sconto concordato sul progetto: ${EURO.format(sconto / 100)} su ${EURO.format(sommaModuliCentesimi / 100)}.`;
}

interface MicrovocePerImporto { articolo?: { prezzoDefault?: number | null } | null }
interface ModuloPerImporto { prezzo?: number | null; microvoci?: MicrovocePerImporto[] | null }

/**
 * Toglie dalle attività il listino dell'articolo: serve al calcolo, non a chi legge il progetto
 * (il cliente del portale non deve vedere il listino dello studio).
 */
export function senzaListino<P extends { moduli?: ModuloPerImporto[] | null }>(progetto: P): P {
  return {
    ...progetto,
    moduli: (progetto.moduli ?? []).map((m) => ({
      ...m,
      microvoci: (m.microvoci ?? []).map(({ articolo: _articolo, ...mv }) => mv),
    })),
  };
}

/**
 * Aggiunge al progetto letto gli importi proposti: su ogni modulo `prezzoNettoCentesimi` (dopo
 * lo sconto) e `criterioRipartizione`, su ogni attività `importoPropostoCentesimi` (`null` se il
 * modulo non ha prezzo). Il listino dell'articolo non esce. Non modifica l'oggetto ricevuto.
 */
export function conImportiProposti<P extends { scontoCentesimi?: number | null; moduli?: ModuloPerImporto[] | null }>(
  progetto: P,
): P & { sommaModuliCentesimi: number; scontoApplicatoCentesimi: number } {
  const moduli = progetto.moduli ?? [];
  const prezzi = moduli.map((m) => m.prezzo ?? 0);
  const sommaModuliCentesimi = prezzi.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const scontoApplicatoCentesimi = scontoApplicabile(sommaModuliCentesimi, progetto.scontoCentesimi ?? 0);
  const netti = prezziModuliScontati(prezzi, scontoApplicatoCentesimi);
  return {
    ...progetto,
    sommaModuliCentesimi,
    scontoApplicatoCentesimi,
    moduli: moduli.map((m, i) => {
      const microvoci = m.microvoci ?? [];
      const riparto = importiVociModulo(netti[i] ?? 0, microvoci.map((mv) => mv.articolo?.prezzoDefault ?? 0));
      return {
        ...m,
        prezzoNettoCentesimi: netti[i] ?? 0,
        criterioRipartizione: riparto?.criterio ?? null,
        microvoci: microvoci.map(({ articolo: _articolo, ...mv }, j) => ({
          ...mv,
          importoPropostoCentesimi: riparto ? riparto.importi[j]! : null,
        })),
      };
    }),
  };
}
