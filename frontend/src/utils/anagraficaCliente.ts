// Due conversioni della scheda cliente, tenute qui perché si possano provare da sole.

/**
 * La sede legale in una riga, solo con i pezzi che ci sono. Prima era una stringa fissa
 * («indirizzo, città (CAP) - nazione»): con i campi vuoti si salvava «, () - Italia».
 */
export function componiSedeLegale(parti: { indirizzo?: string; citta?: string; cap?: string; nazione?: string }): string {
  const pulito = (v?: string) => (v ?? '').trim();
  const indirizzo = pulito(parti.indirizzo);
  const citta = pulito(parti.citta);
  const cap = pulito(parti.cap);
  const nazione = pulito(parti.nazione);
  const localita = [citta, cap ? `(${cap})` : ''].filter(Boolean).join(' ');
  const inizio = [indirizzo, localita].filter(Boolean).join(', ');
  return [inizio, nazione].filter(Boolean).join(' - ');
}

/** Il capitale sociale scritto nel campo: un numero, oppure `null` se il campo è vuoto o non è un numero. */
export function capitaleDaTesto(testo: string): number | null {
  const pulito = testo.trim();
  if (pulito === '') return null;
  const n = Number(pulito);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
