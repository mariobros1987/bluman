/**
 * KYC/AML Fase K8a (spec §5.3) — orchestrazione anomalie e decisioni MLRO.
 *
 * Apre un'anomalia (candidato SAR interno) e registra la decisione dell'MLRO: ogni passo persiste e
 * appende un `ComplianceEvent` alla catena (§8.10). La macchina «decisione → stato» è pura
 * (`anomalieKyc`). Store iniettabile per il presidio senza DB. Non decide l'autorizzazione: la rotta
 * verifica che chi decide sia l'MLRO o un ruolo superiore (come il gate §8.3).
 */
import { statoDaDecisione, type TipoAnomaliaKyc, type DecisioneMlro } from '../domain/anomalieKyc.js';
import { registraComplianceEvent, type ComplianceEventStore } from './complianceEventLog.js';

interface AnomaliaRiga {
  id: string;
  tenantId: string;
  fascicoloId: string;
  stato: string;
}

export interface AnomalieStore extends ComplianceEventStore {
  anomaliaKyc: {
    create(args: unknown): Promise<AnomaliaRiga>;
    findFirst(args: unknown): Promise<AnomaliaRiga | null>;
    update(args: unknown): Promise<unknown>;
  };
  mlroDecisionLog: {
    create(args: unknown): Promise<unknown>;
  };
}

export async function apriAnomalia(
  store: AnomalieStore,
  input: { tenantId: string; fascicoloId: string; tipo: TipoAnomaliaKyc; descrizione: string; rilevataDa?: string | null },
): Promise<AnomaliaRiga> {
  const anomalia = await store.anomaliaKyc.create({
    data: {
      tenantId: input.tenantId,
      fascicoloId: input.fascicoloId,
      tipo: input.tipo,
      descrizione: input.descrizione,
      rilevataDa: input.rilevataDa ?? null,
    },
  });
  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_ANOMALIA_APERTA',
    attoreUserId: input.rilevataDa ?? null,
    payload: { anomaliaId: anomalia.id, fascicoloId: input.fascicoloId, tipoAnomalia: input.tipo },
  });
  return anomalia;
}

export type EsitoDecisione = { esito: 'ok'; anomalia: unknown } | { esito: 'non_trovata' };

export async function decidiAnomalia(
  store: AnomalieStore,
  input: { tenantId: string; anomaliaId: string; decisione: DecisioneMlro; motivazione: string; decisaDa?: string | null },
): Promise<EsitoDecisione> {
  const esistente = await store.anomaliaKyc.findFirst({
    where: { id: input.anomaliaId, tenantId: input.tenantId },
  });
  if (!esistente) return { esito: 'non_trovata' };

  await store.mlroDecisionLog.create({
    data: {
      tenantId: input.tenantId,
      anomaliaId: input.anomaliaId,
      decisione: input.decisione,
      motivazione: input.motivazione,
      decisaDa: input.decisaDa ?? null,
    },
  });
  const nuovoStato = statoDaDecisione(input.decisione);
  const aggiornata = await store.anomaliaKyc.update({
    where: { id: input.anomaliaId },
    data: { stato: nuovoStato },
  });
  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_MLRO_DECISIONE',
    attoreUserId: input.decisaDa ?? null,
    payload: { anomaliaId: input.anomaliaId, decisione: input.decisione, nuovoStato },
  });
  return { esito: 'ok', anomalia: aggiornata };
}
