// Il livello di firma del modello è il minimo (titolare, 28/11/2026): la pagina spegne i livelli
// più bassi e dice perché. La regola è quella del server (`livelloFirmaService`), non una copia.
import { PESO_LIVELLO, normalizzaLivelloFirma, type LivelloFirma } from '../../../src/services/livelloFirmaService';

export type { LivelloFirma };

/** `true` se `livello` è più basso del minimo del modello. Un minimo assente vale SES. */
export function sottoIlMinimo(livello: LivelloFirma, minimo: unknown): boolean {
  return PESO_LIVELLO[livello] < PESO_LIVELLO[normalizzaLivelloFirma(minimo)];
}

/** La frase che spiega il blocco, o `null` se il modello non impone niente (SES). */
export function spiegaMinimoFirma(minimo: unknown): string | null {
  const m = normalizzaLivelloFirma(minimo);
  if (m === 'ses') return null;
  return `Il modello richiede almeno la firma ${m.toUpperCase()}: il livello si può alzare, non abbassare.`;
}
