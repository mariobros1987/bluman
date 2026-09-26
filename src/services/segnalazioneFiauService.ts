/**
 * KYC/AML Fase K8b (spec §5.3/§10) — orchestrazione della segnalazione FIAU (STR).
 *
 * Prepara la segnalazione a partire da un'anomalia che l'MLRO ha deciso di segnalare (`segnalata_fiau`,
 * K8a) — congela un dossier immutabile del fascicolo — e registra riferimento e timestamp goAML dopo
 * l'invio manuale dell'MLRO sul portale FIAU. Il sistema NON trasmette (spec §10). Ogni passo appende
 * un `ComplianceEvent` alla catena hash. La macchina pura (`segnalazioneFiau`) decide dossier e
 * transizioni; lo store è iniettabile per il presidio senza DB. Il caricamento del fascicolo lo fa la
 * rotta (ha le query) e passa i dati già assemblati: qui resta solo l'atto e la sua tracciabilità.
 */
import {
  costruisciDossierStr,
  puoTrasmettere,
  riferimentoGoamlValido,
  type DatiFascicoloPerDossier,
  type DossierStr,
  type StatoSegnalazioneFiau,
} from '../domain/segnalazioneFiau.js';
import { registraComplianceEvent, type ComplianceEventStore } from './complianceEventLog.js';

interface SegnalazioneRiga {
  id: string;
  tenantId: string;
  anomaliaId: string;
  fascicoloId: string;
  stato: StatoSegnalazioneFiau;
}

export interface SegnalazioneStore extends ComplianceEventStore {
  segnalazioneFiau: {
    findUnique(args: unknown): Promise<SegnalazioneRiga | null>;
    findFirst(args: unknown): Promise<SegnalazioneRiga | null>;
    create(args: unknown): Promise<SegnalazioneRiga>;
    update(args: unknown): Promise<SegnalazioneRiga>;
  };
}

export type EsitoPrepara =
  | { esito: 'ok'; segnalazione: SegnalazioneRiga; dossier: DossierStr }
  | { esito: 'non_segnalabile' }
  | { esito: 'gia_trasmessa' };

/**
 * Congela il dossier e crea/aggiorna la segnalazione. Prima dell'invio una nuova preparazione
 * aggiorna lo snapshot (il fascicolo può essere cambiato); dopo l'invio la segnalazione è chiusa.
 */
export async function preparaSegnalazione(
  store: SegnalazioneStore,
  input: {
    tenantId: string;
    anomalia: { id: string; stato: string; fascicoloId: string };
    dati: DatiFascicoloPerDossier;
    preparataDa?: string | null;
  },
): Promise<EsitoPrepara> {
  // Solo un'anomalia che l'MLRO ha deciso di segnalare genera una STR: è la coda di quella decisione.
  if (input.anomalia.stato !== 'segnalata_fiau') return { esito: 'non_segnalabile' };

  const esistente = await store.segnalazioneFiau.findUnique({ where: { anomaliaId: input.anomalia.id } });
  if (esistente && esistente.stato === 'trasmessa') return { esito: 'gia_trasmessa' };

  const preparatoIl = new Date().toISOString();
  const dossier = costruisciDossierStr(input.dati, preparatoIl);

  const segnalazione = esistente
    ? await store.segnalazioneFiau.update({
        where: { id: esistente.id },
        data: { datiPreparatiJson: dossier as unknown as object, preparataDa: input.preparataDa ?? null },
      })
    : await store.segnalazioneFiau.create({
        data: {
          tenantId: input.tenantId,
          anomaliaId: input.anomalia.id,
          fascicoloId: input.anomalia.fascicoloId,
          datiPreparatiJson: dossier as unknown as object,
          preparataDa: input.preparataDa ?? null,
        },
      });

  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_STR_PREPARATA',
    attoreUserId: input.preparataDa ?? null,
    payload: { segnalazioneId: segnalazione.id, anomaliaId: input.anomalia.id, fascicoloId: input.anomalia.fascicoloId },
  });
  return { esito: 'ok', segnalazione, dossier };
}

export type EsitoTrasmissione =
  | { esito: 'ok'; segnalazione: SegnalazioneRiga }
  | { esito: 'non_trovata' }
  | { esito: 'gia_trasmessa' }
  | { esito: 'riferimento_non_valido' };

/** Registra l'invio manuale: riferimento e timestamp goAML rilasciati dal portale FIAU. */
export async function registraTrasmissione(
  store: SegnalazioneStore,
  input: { tenantId: string; segnalazioneId: string; riferimentoGoaml: string; trasmessaDa?: string | null },
): Promise<EsitoTrasmissione> {
  const s = await store.segnalazioneFiau.findFirst({ where: { id: input.segnalazioneId, tenantId: input.tenantId } });
  if (!s) return { esito: 'non_trovata' };
  if (!puoTrasmettere(s.stato)) return { esito: 'gia_trasmessa' };
  if (!riferimentoGoamlValido(input.riferimentoGoaml)) return { esito: 'riferimento_non_valido' };

  const segnalazione = await store.segnalazioneFiau.update({
    where: { id: s.id },
    data: {
      stato: 'trasmessa',
      riferimentoGoaml: input.riferimentoGoaml.trim(),
      trasmessaAt: new Date(),
      trasmessaDa: input.trasmessaDa ?? null,
    },
  });
  await registraComplianceEvent(store, {
    tenantId: input.tenantId,
    tipo: 'KYC_STR_TRASMESSA',
    attoreUserId: input.trasmessaDa ?? null,
    payload: { segnalazioneId: s.id, anomaliaId: s.anomaliaId, riferimentoGoaml: input.riferimentoGoaml.trim() },
  });
  return { esito: 'ok', segnalazione };
}
