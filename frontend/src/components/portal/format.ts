/**
 * Data e ora nel formato italiano, a partire da quello che manda il backend (ISO).
 * Se il valore non è una data valida si restituisce così com'è: meglio un testo grezzo che un
 * «Invalid Date» al posto della data di una firma.
 */
export function dataOraLeggibile(valore: string | null): string {
  if (!valore) return '';
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return valore;
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
