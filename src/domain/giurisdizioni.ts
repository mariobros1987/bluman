// Motore di dominio delle giurisdizioni — §8 Estensione.
//
// La condizione di filtro dei moduli per giurisdizione vive qui ed è usata sia
// dalla rotta `GET /moduli` (catalogo.ts) sia dai test: così la logica verificata
// e quella in produzione non possono divergere. Il vecchio test se ne copiava
// una versione privata che con il tempo avrebbe raccontato un comportamento
// diverso da quello reale.

import type { Prisma } from '@prisma/client';

/**
 * Condizione `where` dei moduli template visibili di un tenant.
 *
 * Con un `giurisdizioneId` restituisce i moduli specifici di quella giurisdizione
 * PIÙ quelli generici (`giurisdizioneId` nullo): chi consulta la libreria per
 * piazza vede comunque i moduli validi ovunque. Il valore `'ALL'` — che il
 * frontend usa come sentinella "tutte le giurisdizioni" — si comporta come
 * l'assenza di filtro, così se un domani arrivasse al backend non nasconderebbe
 * silenziosamente i moduli specifici. `isAttivo: true` esclude i moduli
 * disattivati (§30: si disattiva, non si elimina).
 */
export function condizioneModuliPerGiurisdizione(
  tenantId: string,
  giurisdizioneId?: string | null,
): Prisma.ModuloTemplateWhereInput {
  const base: Prisma.ModuloTemplateWhereInput = { tenantId, isAttivo: true };
  if (!giurisdizioneId || giurisdizioneId === 'ALL') return base;
  return { ...base, OR: [{ giurisdizioneId }, { giurisdizioneId: null }] };
}
