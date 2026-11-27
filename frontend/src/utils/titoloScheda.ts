/**
 * Il titolo della scheda senza il numero davanti. Le schede si intitolano «08 · LIPE …» e
 * l'indice mette già il numero in un riquadro: stampando tutti e due si leggeva «08 08 · LIPE».
 */
export function titoloSenzaNumero(numero: string, titolo: string): string {
  const resto = titolo.trimStart();
  if (!numero || !resto.startsWith(numero)) return titolo;
  const dopo = resto.slice(numero.length).replace(/^\s*[·.\-–—:]\s*/, '');
  return dopo.trim() ? dopo : titolo;
}
