// I filtri per categoria della Libreria: le categorie che gli articoli hanno davvero.
// «TUTTI» è sempre il primo; le altre seguono l'ordine consueto dello studio, e le categorie
// che l'elenco consueto non conosce vanno in coda in ordine alfabetico.
const ORDINE_CONSUETO = ['Analisi', 'Societario', 'Compliance', 'Banking', 'Trust', 'IP & Tax'];

export function categorieDegliArticoli(articoli: ReadonlyArray<{ cat?: string | null }>): string[] {
  const presenti = new Set<string>();
  for (const a of articoli) {
    const cat = (a.cat ?? '').trim();
    if (cat) presenti.add(cat);
  }
  const note = ORDINE_CONSUETO.filter((c) => presenti.has(c));
  const altre = [...presenti].filter((c) => !ORDINE_CONSUETO.includes(c)).sort((a, b) => a.localeCompare(b, 'it'));
  return ['TUTTI', ...note, ...altre];
}
