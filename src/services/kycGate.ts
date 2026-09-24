/**
 * KYC/AML — gate operativo condiviso (K4, §8.1). Un unico punto che decide se il KYC del cliente
 * blocca l'operatività (fatturazione, avvio incarico) e che onora un eventuale sblocco motivato
 * dell'admin (`OverrideKyc`, §8): un override recente (entro la finestra) lascia passare l'azione.
 *
 * I due gate (POST /invoices, POST /preventivi/:id/accetta) chiamano questo, così la regola e la
 * validità dell'override stanno in un posto solo.
 */
import { kycBloccaOperativita } from '../domain/kycStateMachine.js';

/** Giorni di validità di uno sblocco motivato: oltre, il gate torna a bloccare (l'override non è eterno). */
export const GIORNI_VALIDITA_OVERRIDE = 30;

/** Il minimo di client Prisma che serve, iniettabile per il presidio senza DB. */
export interface KycGateStore {
  fascicoloKyc: { findFirst(args: unknown): Promise<{ id: string; stato: string } | null> };
  overrideKyc: { findFirst(args: unknown): Promise<{ createdAt: Date } | null> };
}

/**
 * Blocca l'operatività se il cliente ha una pratica KYC che non consente esecuzione/fatturazione,
 * a meno che non esista uno sblocco motivato entro `GIORNI_VALIDITA_OVERRIDE`. Nessun fascicolo →
 * non blocca. `sbloccatoDaOverride` dice perché non blocca, per messaggi e audit.
 */
export async function operativitaBloccataDaKyc(
  store: KycGateStore,
  tenantId: string,
  clienteId: string,
): Promise<{ bloccato: boolean; stato: string | null; sbloccatoDaOverride: boolean }> {
  const f = await store.fascicoloKyc.findFirst({
    where: { tenantId, clienteId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, stato: true },
  });
  if (!f || !kycBloccaOperativita(f.stato)) {
    return { bloccato: false, stato: f?.stato ?? null, sbloccatoDaOverride: false };
  }
  const ov = await store.overrideKyc.findFirst({
    where: { tenantId, fascicoloId: f.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (ov && Date.now() - new Date(ov.createdAt).getTime() <= GIORNI_VALIDITA_OVERRIDE * 86_400_000) {
    return { bloccato: false, stato: f.stato, sbloccatoDaOverride: true };
  }
  return { bloccato: true, stato: f.stato, sbloccatoDaOverride: false };
}
