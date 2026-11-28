// Il rischio antiriciclaggio scritto sull'anagrafica del cliente. PURO: lo usano le rotte e la
// scheda cliente.
//
// Un cliente nuovo parte «non valutato» (deciso dal titolare il 28/11/2026): prima nasceva
// «medio» sul server e la scheda proponeva «basso», cioè una valutazione che nessuno aveva fatto.
// La classe la sceglie una persona (regola 14); il processo vero resta il fascicolo KYC.

export const RISCHIO_AML_NON_VALUTATO = 'non_valutato';

export type RischioAml = 'non_valutato' | 'basso' | 'medio' | 'alto';

export const ETICHETTE_RISCHIO_AML: Record<RischioAml, string> = {
  non_valutato: 'Non valutato',
  basso: 'Basso Rischio',
  medio: 'Medio Rischio',
  alto: 'Alto Rischio / Persona Politicamente Esposta (PEP)',
};

/**
 * La classe scritta in anagrafica, o «non valutato» se non c'è: il primo valore non vuoto fra
 * quelli passati (colonna, poi copia storica nel JSON dei referenti). Un valore già scritto non
 * si tocca, qualunque sia.
 */
export function rischioAmlDichiarato(...valori: unknown[]): string {
  for (const v of valori) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return RISCHIO_AML_NON_VALUTATO;
}
