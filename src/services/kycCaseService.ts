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
import { calcolaScadenzaKyc, type LivelloVerificaKyc } from '../domain/kycEngine.js';
import { screeningBloccaApprovazione, motivoBloccoScreening, type ScreeningRiga } from '../domain/screeningKyc.js';
import { dataScadenzaRetention } from '../domain/retentionKyc.js';
import { registraComplianceEvent, type ComplianceEventStore } from './complianceEventLog.js';

interface FascicoloRiga {
  id: string;
  stato: string;
  livelloVerifica: string;
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

/** Con gli screening: la porta condivisa li legge per il gate §8.4. */
export interface KycStoreConScreening extends KycStore {
  screeningKyc: { findMany(args: unknown): Promise<ScreeningRiga[]> };
}

export type EsitoTransizione =
  | { esito: 'ok'; fascicolo: unknown }
  | { esito: 'non_trovato' }
  | { esito: 'stato_ignoto'; valore: string }
  | { esito: 'transizione_non_valida'; da: StatoKycV02; a: StatoKycV02 }
  | { esito: 'serve_mlro' }
  | { esito: 'screening_bloccante'; motivo?: string };

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
    /** §8.4 — la rotta lo calcola dagli screening: un match non risolto blocca l'approvazione. */
    screeningBloccante?: boolean;
    /** Campi di approvazione (data verifica/scadenza) calcolati dalla rotta quando si approva. */
    campiApprovazione?: Record<string, unknown>;
    /** K9 — campi di chiusura (chiusoAt + retentionScadenza) calcolati dalla rotta quando si chiude. */
    campiChiusura?: Record<string, unknown>;
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
  // §8.4 — non si approva una pratica con uno screening (sanzioni/PEP/media) a match non risolto.
  if (a === 'approvato' && input.screeningBloccante) {
    return { esito: 'screening_bloccante' };
  }

  const aggiornato = await store.fascicoloKyc.update({
    where: { id: input.fascicoloId },
    data: {
      stato: a,
      ...(a === 'approvato' ? (input.campiApprovazione ?? {}) : {}),
      ...(a === 'chiuso' ? (input.campiChiusura ?? {}) : {}),
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

// ---------------------------------------------------------------------------------------------
// Porta unica della transizione con i suoi gate (§8.2 profilo regolatorio, §8.3 MLRO, §8.4
// screening, K9 conservazione). Prima viveva nella rotta `PATCH /kyc/:id/stato`; l'approvazione
// massiva ha bisogno degli stessi controlli, e due copie avrebbero finito per dire cose diverse:
// è la stessa ragione per cui la distinta dei moduli ha una sola funzione condivisa.
// ---------------------------------------------------------------------------------------------

export interface ImpostazioniKycGate {
  regulatoryProfile: string | null;
  mlroUserId: string | null;
  retentionYears: number;
}

export type EsitoTransizioneConGate = EsitoTransizione | { esito: 'profilo_mancante' };

/** §8.3 — advisor/super_admin oppure l'utente nominato MLRO nello studio. */
export function puoApprovareRafforzata(
  ruolo: string | null | undefined,
  userId: string | null | undefined,
  mlroUserId: string | null | undefined,
): boolean {
  return ruolo === 'advisor' || ruolo === 'super_admin' || (!!userId && userId === mlroUserId);
}

/**
 * Perché una pratica NON è approvabile ORA — la stessa valutazione mostrata nella coda e
 * applicata dai gate. `motivi` è vuoto esattamente quando la transizione ad «approvato»
 * passerebbe; i test lo legano a `transizioneKycConGate` perché le due non divergano.
 */
export function valutaApprovazione(input: {
  stato: string;
  rischio: LivelloRischioKyc;
  profiloConfigurato: boolean;
  puoApprovareRafforzata: boolean;
  screeningNonRisolto: boolean;
}): { approvabile: boolean; motivi: string[] } {
  const motivi: string[] = [];
  if (!input.profiloConfigurato) {
    motivi.push('Profilo regolatorio non configurato (Impostazioni → Compliance & AML).');
  }
  const stato = normalizzaStatoLegacy(input.stato);
  if (!stato) {
    motivi.push(`Stato «${input.stato}» non riconosciuto.`);
  } else if (!transizioneAmmessa(stato, 'approvato')) {
    motivi.push(`Il fascicolo è in «${stato}»: prima va portato in attesa di approvazione.`);
  }
  if (richiedeApprovazioneMlro('approvato', input.rischio) && !input.puoApprovareRafforzata) {
    motivi.push('Approvazione ad alto rischio riservata all’MLRO o a un ruolo superiore.');
  }
  if (input.screeningNonRisolto) {
    motivi.push('Screening PEP/sanzioni con un match non risolto.');
  }
  return { approvabile: motivi.length === 0, motivi };
}

export async function transizioneKycConGate(
  store: KycStoreConScreening,
  input: {
    tenantId: string;
    fascicoloId: string;
    nuovoStato: string;
    attoreUserId?: string | null;
    ruolo?: string | null;
    motivazione?: string | null;
    settings: ImpostazioniKycGate;
  },
): Promise<EsitoTransizioneConGate> {
  const fascicolo = await store.fascicoloKyc.findFirst({
    where: { id: input.fascicoloId, tenantId: input.tenantId },
  });
  if (!fascicolo) return { esito: 'non_trovato' };

  const a = normalizzaStatoLegacy(input.nuovoStato);
  if (!a) return { esito: 'stato_ignoto', valore: input.nuovoStato };

  // §8.2/§14 — approvare esige che lo studio abbia dichiarato quali regole applica. L'MLRO non è
  // bloccante (scelta del titolare 27/09): l'advisor è già l'autorità che approva.
  if (a === 'approvato' && !input.settings.regulatoryProfile) {
    return { esito: 'profilo_mancante' };
  }

  // §8.4 — gli screening si leggono solo quando si approva, come prima nella rotta.
  const screenings = a === 'approvato'
    ? await store.screeningKyc.findMany({
        where: { fascicoloId: input.fascicoloId, tenantId: input.tenantId },
        select: { tipo: true, esito: true, dataScreening: true, createdAt: true },
      })
    : [];

  const ora = new Date();
  const esito = await transizioneKyc(store, {
    tenantId: input.tenantId,
    fascicoloId: input.fascicoloId,
    nuovoStato: input.nuovoStato,
    attoreUserId: input.attoreUserId,
    motivazione: input.motivazione,
    puoApprovareRafforzata: puoApprovareRafforzata(input.ruolo, input.attoreUserId, input.settings.mlroUserId),
    screeningBloccante: screeningBloccaApprovazione(screenings),
    campiApprovazione: a === 'approvato' ? {
      dataVerifica: ora,
      dataScadenza: calcolaScadenzaKyc(fascicolo.livelloVerifica as LivelloVerificaKyc, ora),
      approvatoDa: input.attoreUserId ?? null,
      approvatoIl: ora,
    } : undefined,
    // K9 (§5.4) — alla chiusura parte la conservazione. Additivo: se non si chiude, non si tocca.
    campiChiusura: a === 'chiuso' ? {
      chiusoAt: ora,
      retentionScadenza: dataScadenzaRetention(ora, input.settings.retentionYears),
    } : undefined,
  });

  // Il motivo è la frase già usata dalla rotta singola (regola 12): la coda massiva mostra la stessa.
  if (esito.esito === 'screening_bloccante') return { ...esito, motivo: motivoBloccoScreening(screenings) };
  return esito;
}

/** L'esito della porta tradotto in una frase, per la risposta dell'approvazione massiva. */
export function motivoRifiutoApprovazione(esito: EsitoTransizioneConGate): string {
  switch (esito.esito) {
    case 'non_trovato': return 'Fascicolo non trovato.';
    case 'stato_ignoto': return `Stato non riconosciuto: ${esito.valore}.`;
    case 'transizione_non_valida': return `Transizione non ammessa: ${esito.da} → ${esito.a}.`;
    case 'serve_mlro': return 'Approvazione ad alto rischio riservata all’MLRO o a un ruolo superiore.';
    case 'screening_bloccante': return esito.motivo || 'Screening con un match non risolto.';
    case 'profilo_mancante': return 'Profilo regolatorio non configurato (Impostazioni → Compliance & AML).';
    default: return 'Approvazione non riuscita.';
  }
}
