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
