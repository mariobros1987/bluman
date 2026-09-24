/**
 * KYC/AML Fase K1 (spec v0.2 §8) — orchestrazione della transizione di stato di una pratica.
 *
 * Valida la transizione con la macchina a stati pura (`kycStateMachine`), applica il gate MLRO sul
 * rischio alto (§8.3), poi persiste il nuovo stato, ne scrive lo storico immutabile ed emette un
 * `ComplianceEvent` in catena (§8.10). Non decide l'autorizzazione: riceve dalla rotta se chi agisce
 * può approvare in rafforzata (MLRO o ruolo superiore), così la logica di ruolo resta un posto solo.
 */
import {
  transizioneAmmessa,
  normalizzaStatoLegacy,
  richiedeApprovazioneMlro,
  type StatoKycV02,
  type LivelloRischioKyc,
} from '../domain/kycStateMachine.js';
import { registraComplianceEvent, type ComplianceEventStore } from './complianceEventLog.js';

interface FascicoloRiga {
  id: string;
  stato: string;
  rischioCalcolato: LivelloRischioKyc;
  noteCompliance: string | null;
}

/** Il minimo di client Prisma che serve, iniettabile per il presidio senza DB. */
export interface KycStore extends ComplianceEventStore {
  fascicoloKyc: {
    findFirst(args: unknown): Promise<FascicoloRiga | null>;
    update(args: unknown): Promise<unknown>;
  };
}

export type EsitoTransizione =
  | { esito: 'ok'; fascicolo: unknown }
  | { esito: 'non_trovato' }
  | { esito: 'stato_ignoto'; valore: string }
  | { esito: 'transizione_non_valida'; da: StatoKycV02; a: StatoKycV02 }
  | { esito: 'serve_mlro' };

export async function transizioneKyc(
  store: KycStore,
  input: {
    tenantId: string;
    fascicoloId: string;
    nuovoStato: string;
    attoreUserId?: string | null;
    motivazione?: string | null;
    /** La rotta lo calcola: ruolo advisor/super_admin OPPURE utente === MLRO del tenant. */
    puoApprovareRafforzata: boolean;
    /** Campi di approvazione (data verifica/scadenza) calcolati dalla rotta quando si approva. */
    campiApprovazione?: Record<string, unknown>;
  },
): Promise<EsitoTransizione> {
  const fascicolo = await store.fascicoloKyc.findFirst({
    where: { id: input.fascicoloId, tenantId: input.tenantId },
  });
  if (!fascicolo) return { esito: 'non_trovato' };

  const da = normalizzaStatoLegacy(fascicolo.stato);
  const a = normalizzaStatoLegacy(input.nuovoStato);
  if (!da) return { esito: 'stato_ignoto', valore: fascicolo.stato };
  if (!a) return { esito: 'stato_ignoto', valore: input.nuovoStato };

  if (!transizioneAmmessa(da, a)) return { esito: 'transizione_non_valida', da, a };
  if (richiedeApprovazioneMlro(a, fascicolo.rischioCalcolato) && !input.puoApprovareRafforzata) {
    return { esito: 'serve_mlro' };
  }

  const aggiornato = await store.fascicoloKyc.update({
    where: { id: input.fascicoloId },
    data: {
      stato: a,
      ...(a === 'approvato' ? (input.campiApprovazione ?? {}) : {}),
      noteCompliance: input.motivazione ?? fascicolo.noteCompliance,
      storico: {
        create: {
          tenantId: input.tenantId,
          statoPrecedente: fascicolo.stato,
          statoNuovo: a,
          attoreUserId: input.attoreUserId ?? 'sistema',
          motivazione: input.motivazione ?? null,
        },
      },
    },
    include: { storico: { orderBy: { createdAt: 'desc' } } },
  });

  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_TRANSIZIONE_STATO',
    attoreUserId: input.attoreUserId ?? null,
    payload: { fascicoloId: input.fascicoloId, da, a },
  });

  return { esito: 'ok', fascicolo: aggiornato };
}
