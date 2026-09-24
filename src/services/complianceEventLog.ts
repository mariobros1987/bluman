/**
 * KYC/AML — scrittura di un evento nella catena append-only `ComplianceEvent` (spec §7/§8).
 *
 * Punto unico che aggiunge un anello alla catena hash del tenant: trova l'ultimo evento, calcola
 * l'hash concatenato (via `calcolaHashEvento`, puro) e persiste con `createdAt` ESPLICITO uguale
 * all'istante firmato (se si lasciasse al DEFAULT del DB divergerebbe di qualche ms e la verifica
 * della catena risulterebbe rotta). Lo usano sia la rotta delle impostazioni compliance (K0) sia il
 * service delle transizioni di pratica (K1), così la catena resta una sola e coerente.
 */
import { calcolaHashEvento } from './complianceService.js';

/** Il minimo di client Prisma che serve: iniettabile, così il presidio usa un fake senza DB. */
export interface ComplianceEventStore {
  complianceEvent: {
    findFirst(args: unknown): Promise<{ hash: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
}

export async function registraComplianceEvent(
  store: ComplianceEventStore,
  input: { tenantId: string; tipo: string; attoreUserId?: string | null; payload?: unknown },
): Promise<{ hash: string; hashPrecedente: string | null; createdAt: string }> {
  const ultimo = await store.complianceEvent.findFirst({
    where: { tenantId: input.tenantId },
    orderBy: { createdAt: 'desc' },
  });
  const hashPrecedente = ultimo?.hash ?? null;
  const createdAt = new Date().toISOString();
  const hash = calcolaHashEvento({ tipo: input.tipo, payload: input.payload ?? null, createdAt, hashPrecedente });
  await store.complianceEvent.create({
    data: {
      tenantId: input.tenantId,
      tipo: input.tipo,
      attoreUserId: input.attoreUserId ?? null,
      payload: (input.payload ?? null) as object | null,
      hashPrecedente,
      hash,
      createdAt: new Date(createdAt),
    },
  });
  return { hash, hashPrecedente, createdAt };
}
