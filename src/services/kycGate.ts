/**
 * KYC/AML — gate operativo condiviso (K4, §8.1). Un unico punto che decide se l'operatività è
 * bloccata (fatturazione, avvio incarico) e che onora un eventuale sblocco motivato dell'admin
 * (`OverrideKyc`, §8): un override recente (entro la finestra) lascia passare l'azione.
 *
 * Le tre chiamanti (POST /invoices, avvio incarico, fatturazione dal registro) chiamano questo,
 * così la regola, l'ordine dei controlli e la validità dell'override stanno in un posto solo.
 *
 * Due condizioni, ma con pesi diversi — e la differenza è una decisione del titolare:
 *  1. **lo studio** non ha dichiarato il profilo regolatorio → **avviso, non blocco**
 *     (decisione del 17/10/2026). Era la condizione che l'audit del 27/09 chiamava «modalità
 *     bozza»: il codice la dichiarava e non la applicava. Applicarla come blocco fermava l'intera
 *     operatività di uno studio che non aveva ancora scelto il profilo; il titolare ha chiesto
 *     un avviso visibile. Il gate lo restituisce in `avviso`, e il banner lo mostra.
 *  2. **il cliente** ha una pratica KYC che non consente esecuzione → bloccato, salvo sblocco.
 *
 * L'override vale solo sul fascicolo: il profilo dello studio non è una porta da aprire, quindi
 * non c'è niente che un override possa scavalcare.
 *
 * Nota su cosa non blocca: **l'MLRO mancante**. Decisione presa col titolare il 27/09/2026 —
 * l'approvazione degli incarichi ha già un'autorità (advisor e super_admin), mentre lo studio non
 * deve restare fermo in attesa di una nomina. `modalitaBozza` continua a segnalarlo in
 * Impostazioni come configurazione incompleta; qui non si blocca.
 */
import { profiloRegolatorioMancante } from './complianceService.js';
import { kycBloccaOperativita } from '../domain/kycStateMachine.js';

/** Giorni di validità di uno sblocco motivato: oltre, il gate torna a bloccare (l'override non è eterno). */
export const GIORNI_VALIDITA_OVERRIDE = 30;

/** Il minimo di client Prisma che serve, iniettabile per il presidio senza DB. */
export interface KycGateStore {
  tenantComplianceSettings: {
    findUnique(args: unknown): Promise<{ regulatoryProfile: string | null } | null>;
  };
  fascicoloKyc: { findFirst(args: unknown): Promise<{ id: string; stato: string } | null> };
  overrideKyc: { findFirst(args: unknown): Promise<{ createdAt: Date } | null> };
}

/**
 * Perché è bloccato. Due cause, due messaggi, perché chiedono due azioni diverse: approvare una
 * pratica, oppure riprovare perché non si è potuto guardare. Un messaggio unico costringerebbe
 * l'operatore a indovinare quale delle due sia.
 */
export type MotivoBloccoKyc = 'kyc_non_approvato' | 'verifica_impossibile';

/**
 * Perché si avvisa **senza** bloccare (decisione del titolare, 17/10/2026). Non è un motivo di
 * blocco e il chiamante non deve rifiutare l'azione per questo: è una configurazione incompleta
 * che va mostrata, non una porta chiusa.
 */
export type MotivoAvvisoKyc = 'profilo_regolatorio_mancante' | 'profilo_non_verificabile';

export interface EsitoGateKyc {
  bloccato: boolean;
  /** Stato del fascicolo del cliente, se ne esiste uno. `null` quando non si è potuto leggere. */
  stato: string | null;
  sbloccatoDaOverride: boolean;
  motivo: MotivoBloccoKyc | null;
  /** Segnalazione che non impedisce l'azione: chi chiama può mostrarla, non deve rifiutare. */
  avviso: MotivoAvvisoKyc | null;
}

/**
 * Decide se l'operatività è bloccata. `sbloccatoDaOverride` dice perché non blocca, per messaggi e
 * audit; `motivo` dice perché blocca; `avviso` dice cosa manca senza fermare niente.
 *
 * Il profilo regolatorio dello studio si legge in un `try` separato: è un avviso, e un suo guasto
 * di lettura non deve diventare un blocco che il titolare non ha chiesto. Il blocco vero — la
 * pratica del cliente — resta **fail-closed**: se la lettura fallisce, l'esito è `bloccato` con
 * motivo `verifica_impossibile`. L'assenza di una risposta non è l'assenza di un impedimento, e
 * qui l'impedimento è di natura legale: un guasto del database che aprisse la fatturazione
 * emetterebbe fatture per clienti mai verificati, in silenzio.
 */
export async function operativitaBloccataDaKyc(
  store: KycGateStore,
  tenantId: string,
  clienteId: string,
): Promise<EsitoGateKyc> {
  let avviso: MotivoAvvisoKyc | null = null;
  try {
    const settings = await store.tenantComplianceSettings.findUnique({
      where: { tenantId },
      select: { regulatoryProfile: true },
    });
    if (profiloRegolatorioMancante(settings)) avviso = 'profilo_regolatorio_mancante';
  } catch {
    // Non si sa se il profilo c'è: lo si dice, ma non si ferma l'operatività.
    avviso = 'profilo_non_verificabile';
  }

  try {
    const f = await store.fascicoloKyc.findFirst({
      where: { tenantId, clienteId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, stato: true },
    });
    if (!f || !kycBloccaOperativita(f.stato)) {
      return { bloccato: false, stato: f?.stato ?? null, sbloccatoDaOverride: false, motivo: null, avviso };
    }

    const ov = await store.overrideKyc.findFirst({
      where: { tenantId, fascicoloId: f.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (ov && Date.now() - new Date(ov.createdAt).getTime() <= GIORNI_VALIDITA_OVERRIDE * 86_400_000) {
      return { bloccato: false, stato: f.stato, sbloccatoDaOverride: true, motivo: null, avviso };
    }
    return { bloccato: true, stato: f.stato, sbloccatoDaOverride: false, motivo: 'kyc_non_approvato', avviso };
  } catch {
    return { bloccato: true, stato: null, sbloccatoDaOverride: false, motivo: 'verifica_impossibile', avviso };
  }
}

/**
 * Il messaggio da mostrare all'operatore. Vive qui e non nelle tre rotte perché le tre devono
 * raccontare la stessa regola: tre copie divergono alla prima modifica, e la copia che resta
 * indietro è quella che l'utente legge nel caso peggiore.
 *
 * `azione` è ciò che è stato rifiutato, nella forma che l'utente ha davanti («La fatturazione»,
 * «L'avvio dell'incarico»).
 */
export function messaggioBloccoKyc(esito: EsitoGateKyc, azione: string): string {
  switch (esito.motivo) {
    case 'verifica_impossibile':
      return (
        `${azione} non è possibile: adesso non è stato possibile verificare la pratica KYC del cliente. ` +
        `Riprova fra poco; se continua, è un guasto da segnalare.`
      );
    default:
      return (
        `${azione} bloccata dal KYC: la pratica del cliente è in stato «${esito.stato}», che non consente ` +
        `di procedere. Completa e approva la pratica (scheda cliente → KYC) oppure registra uno sblocco motivato.`
      );
  }
}
