// Due colonne del CSV di Prima Nota nel fascicolo per il commercialista, tenute qui perché si
// possano provare da sole: il conto del movimento e il documento a cui si riferisce.

/** Quello che si scrive quando un movimento non è collegato a nessun conto. */
export const CONTO_NON_INDICATO = 'Conto non indicato';

/**
 * Il nome del conto del movimento. Senza conto si dichiara: prima qui si scriveva «Cassa Studio»,
 * cioè un conto che lo studio poteva non avere, e il commercialista leggeva un incasso in cassa.
 */
export function nomeContoMovimento(m: { contoBancario?: { nomeConto?: string | null } | null }): string {
  const nome = m.contoBancario?.nomeConto?.trim();
  return nome ? nome : CONTO_NON_INDICATO;
}

/**
 * Il riferimento al documento del movimento. Per una fattura emessa è il suo numero ufficiale
 * («FT-2026/001»): prima si componeva «FT » + serie + «/» + progressivo, che con la serie «FT»
 * dava «FT FT/1» — un numero che non compare su nessuna fattura.
 */
export function riferimentoDocumentoMovimento(m: {
  fattura?: { numero?: string | null; serie?: string | null; numeroProgressivoSerie?: number | null } | null;
  fatturaRicevuta?: { numero?: string | null } | null;
}): string {
  if (m.fattura) {
    const numero = m.fattura.numero?.trim();
    if (numero) return numero;
    // Fattura senza numero ufficiale (bozza): serie e progressivo, senza prefissi aggiunti.
    const { serie, numeroProgressivoSerie } = m.fattura;
    return serie && numeroProgressivoSerie != null ? `${serie}/${numeroProgressivoSerie}` : '';
  }
  if (m.fatturaRicevuta) {
    const numero = m.fatturaRicevuta.numero?.trim();
    return numero ? `Fatt. Acquisto ${numero}` : '';
  }
  return '';
}
