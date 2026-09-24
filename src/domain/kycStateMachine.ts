/**
 * KYC/AML Fase K1 (Malta, spec v0.2 §8) — macchina a stati della pratica (FascicoloKyc = KycCase).
 *
 * PURO: nessun accesso a DB/HTTP. Definisce quali transizioni sono ammesse tra gli stati del ciclo
 * di vita e quali richiedono un ruolo con potere di approvazione. Il service (K1/3) valida qui la
 * transizione, poi persiste ed emette un ComplianceEvent immutabile (spec §8 regola 10).
 *
 * Gli stati legacy v0.1 (`in_attesa_revisione`, `scaduto`) non fanno parte di questa macchina:
 * esistono ancora nell'enum Prisma per i vecchi record, ma il codice v0.2 non li produce.
 */

/** Gli 8 stati del ciclo di vita v0.2 (spec §8). */
export type StatoKycV02 =
  | 'bozza'
  | 'in_raccolta'
  | 'in_verifica'
  | 'in_attesa_approvazione'
  | 'approvato'
  | 'respinto'
  | 'sospeso'
  | 'in_revisione'
  | 'chiuso';

export type LivelloRischioKyc = 'basso' | 'medio' | 'alto';

/**
 * Transizioni ammesse (spec §8). Regole non ovvie codificate qui:
 * - `sospeso` è raggiungibile da ogni stato attivo (§8.6: documento scaduto/mancante) e si riprende
 *   tornando in raccolta o verifica;
 * - `in_revisione` riapre una pratica approvata per il monitoraggio periodico (§5.2);
 * - `chiuso` è terminale (nessuna uscita) e si raggiunge dagli stati di fine rapporto;
 * - `respinto` può ripartire (`in_raccolta`) o chiudersi.
 */
export const TRANSIZIONI_KYC: Record<StatoKycV02, StatoKycV02[]> = {
  bozza: ['in_raccolta', 'chiuso'],
  in_raccolta: ['in_verifica', 'sospeso', 'chiuso'],
  in_verifica: ['in_attesa_approvazione', 'in_raccolta', 'sospeso', 'chiuso'],
  in_attesa_approvazione: ['approvato', 'respinto', 'in_verifica', 'sospeso'],
  approvato: ['in_revisione', 'sospeso', 'chiuso'],
  respinto: ['in_raccolta', 'chiuso'],
  sospeso: ['in_raccolta', 'in_verifica', 'chiuso'],
  in_revisione: ['in_attesa_approvazione', 'approvato', 'sospeso', 'chiuso'],
  chiuso: [],
};

/** Stati da cui non si esce. */
export function statoTerminale(stato: StatoKycV02): boolean {
  return TRANSIZIONI_KYC[stato].length === 0;
}

/** Vero se `a` è raggiungibile da `da` in un passo. Una transizione allo stesso stato non è ammessa. */
export function transizioneAmmessa(da: StatoKycV02, a: StatoKycV02): boolean {
  if (da === a) return false;
  return TRANSIZIONI_KYC[da]?.includes(a) ?? false;
}

/**
 * §8.3 — l'approvazione di una pratica a rischio ALTO esige l'MLRO o un ruolo superiore.
 * Vero quando la transizione porta a `approvato` su una pratica a rischio alto: in quel caso il
 * service pretende `ruoloPuoApprovareRafforzata` (MLRO / amministratore), non il solo operatore.
 */
export function richiedeApprovazioneMlro(a: StatoKycV02, rischio: LivelloRischioKyc): boolean {
  return a === 'approvato' && rischio === 'alto';
}

/**
 * Normalizza uno stato Prisma (che include ancora i legacy v0.1) verso il vocabolario v0.2, così la
 * macchina a stati può validare le transizioni anche partendo da un vecchio record di prova:
 * `in_attesa_revisione` → `in_attesa_approvazione`, `scaduto` → `sospeso`. Gli stati già v0.2
 * restano invariati. Ritorna `null` per un valore ignoto (che il service tratterà come errore).
 */
export function normalizzaStatoLegacy(stato: string): StatoKycV02 | null {
  if (stato === 'in_attesa_revisione') return 'in_attesa_approvazione';
  if (stato === 'scaduto') return 'sospeso';
  const v02: StatoKycV02[] = [
    'bozza', 'in_raccolta', 'in_verifica', 'in_attesa_approvazione',
    'approvato', 'respinto', 'sospeso', 'in_revisione', 'chiuso',
  ];
  return (v02 as string[]).includes(stato) ? (stato as StatoKycV02) : null;
}

/**
 * §8.1 (gate K4) — uno stato che consente l'operatività a valle (esecuzione dell'incarico,
 * emissione fatture): la pratica è approvata, oppure approvata e in revisione periodica (resta
 * valida durante la revisione). Ogni altro stato non consente.
 */
export function statoConsenteOperativita(stato: string): boolean {
  const s = normalizzaStatoLegacy(stato);
  return s === 'approvato' || s === 'in_revisione';
}

/**
 * §8.1 — vero se il KYC BLOCCA l'operatività: un fascicolo ESISTE ma il suo stato non la consente.
 * Nessun fascicolo (`null`) → nessuna dipendenza KYC ancora instaurata → non blocca (la policy più
 * severa «ogni incarico esige KYC» resta una configurazione per una fase successiva).
 */
export function kycBloccaOperativita(statoFascicolo: string | null): boolean {
  if (!statoFascicolo) return false;
  return !statoConsenteOperativita(statoFascicolo);
}
