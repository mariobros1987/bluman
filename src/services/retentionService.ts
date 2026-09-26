/**
 * KYC/AML Fase K9 (spec §5.4/§8.9) — orchestrazione della conservazione/retention.
 *
 * Due atti dell'MLRO a scadenza raggiunta: prorogare la conservazione, oppure concluderla con
 * cancellazione o **anonimizzazione reale** dei dati personali (scelta del titolare 26/09/2026: niente
 * delete fisico, `cancellato` resta un'etichetta registrata; `anonimizzato` azzera davvero il PII e
 * tiene la riga + la traccia di audit). Il gate «solo a scadenza» è nel dominio puro (`retentionKyc`),
 * qui restano scrittura e tracciabilità. Lo store è iniettabile per il presidio senza DB.
 */
import { puoRegistrareEsitoRetention, retentionConclusa, dataScadenzaRetention } from '../domain/retentionKyc.js';
import { registraComplianceEvent, type ComplianceEventStore } from './complianceEventLog.js';

interface FascicoloRetentionRiga {
  id: string;
  tenantId: string;
  soggettoId: string | null;
  chiusoAt: Date | null;
  retentionScadenza: Date | null;
  retentionProrogaAl: Date | null;
  retentionEsito: string | null;
}

export interface RetentionStore extends ComplianceEventStore {
  fascicoloKyc: {
    findFirst(args: unknown): Promise<FascicoloRetentionRiga | null>;
    update(args: unknown): Promise<unknown>;
  };
  soggettoKyc: { update(args: unknown): Promise<unknown> };
  documentoIdentita: { updateMany(args: unknown): Promise<unknown> };
}

export type EsitoRetentionValore = 'cancellato' | 'anonimizzato';

export type EsitoRegistrazione =
  | { esito: 'ok'; fascicolo: unknown }
  | { esito: 'non_trovato' }
  | { esito: 'gia_conclusa' }
  | { esito: 'non_scaduta' };

/**
 * Conclude la conservazione (§5.4). `anonimizzato` azzera il PII PRIMA di marcare l'esito, così un
 * guasto a metà lascia l'etichetta non scritta e l'operazione ripetibile — mai un «anonimizzato» che
 * non ha anonimizzato (regola 7). `cancellato` registra solo la decisione (nessun delete fisico).
 */
export async function registraEsitoRetention(
  store: RetentionStore,
  input: { tenantId: string; fascicoloId: string; esito: EsitoRetentionValore; motivazione?: string | null; decisoDa?: string | null },
): Promise<EsitoRegistrazione> {
  const f = await store.fascicoloKyc.findFirst({ where: { id: input.fascicoloId, tenantId: input.tenantId } });
  if (!f) return { esito: 'non_trovato' };
  if (retentionConclusa(f.retentionEsito)) return { esito: 'gia_conclusa' };
  // §8.9 — nessuna azione sui dati prima della scadenza.
  if (!puoRegistrareEsitoRetention(f.retentionScadenza, f.retentionEsito)) return { esito: 'non_scaduta' };

  if (input.esito === 'anonimizzato') {
    // PII PRIMA dell'etichetta. Fascicolo: si svuotano i campi liberi che possono contenere dati
    // identificativi; il soggetto perde denominazione e codice fiscale; i documenti d'identità il numero.
    await store.fascicoloKyc.update({
      where: { id: f.id },
      data: { noteCompliance: null, paeseResidenza: null, paeseRischio: null },
    });
    if (f.soggettoId) {
      await store.soggettoKyc.update({ where: { id: f.soggettoId }, data: { denominazione: '[anonimizzato]', codiceFiscale: null } });
      await store.documentoIdentita.updateMany({ where: { soggettoId: f.soggettoId, tenantId: input.tenantId }, data: { numero: null } });
    }
  }

  const fascicolo = await store.fascicoloKyc.update({
    where: { id: f.id },
    data: { retentionEsito: input.esito, retentionEsitoAt: new Date(), retentionEsitoDa: input.decisoDa ?? null },
  });
  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_RETENTION_ESITO',
    attoreUserId: input.decisoDa ?? null,
    payload: { fascicoloId: f.id, esito: input.esito, motivazione: input.motivazione ?? null },
  });
  return { esito: 'ok', fascicolo };
}

export type EsitoProroga =
  | { esito: 'ok'; fascicolo: unknown }
  | { esito: 'non_trovato' }
  | { esito: 'gia_conclusa' }
  | { esito: 'non_in_conservazione' };

/** Proroga la conservazione: la nuova scadenza vale solo se sposta il termine PIÙ AVANTI (§5.4). */
export async function prorogaRetention(
  store: RetentionStore,
  input: { tenantId: string; fascicoloId: string; prorogaAl: Date; motivo: string; decisoDa?: string | null },
): Promise<EsitoProroga> {
  const f = await store.fascicoloKyc.findFirst({ where: { id: input.fascicoloId, tenantId: input.tenantId } });
  if (!f) return { esito: 'non_trovato' };
  if (retentionConclusa(f.retentionEsito)) return { esito: 'gia_conclusa' };
  if (!f.chiusoAt || !f.retentionScadenza) return { esito: 'non_in_conservazione' };

  // La scadenza risultante non può accorciare la conservazione: `dataScadenzaRetention` con base la
  // scadenza attuale (retentionYears 0) tiene il massimo tra questa e la proroga.
  const nuovaScadenza = dataScadenzaRetention(f.retentionScadenza, 0, input.prorogaAl);
  const fascicolo = await store.fascicoloKyc.update({
    where: { id: f.id },
    data: { retentionProrogaAl: input.prorogaAl, retentionProrogaMotivo: input.motivo, retentionScadenza: nuovaScadenza },
  });
  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_RETENTION_PROROGA',
    attoreUserId: input.decisoDa ?? null,
    payload: { fascicoloId: f.id, prorogaAl: input.prorogaAl.toISOString(), motivo: input.motivo },
  });
  return { esito: 'ok', fascicolo };
}
