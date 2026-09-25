/**
 * KYC/AML Fase K5 (Malta, spec §8.4) — regole PURE dello screening PEP / sanzioni / media negativi.
 *
 * PURO: nessun accesso a DB/HTTP. Il service legge le righe `ScreeningKyc` e chiama queste funzioni;
 * la rotta di transizione (`/kyc/:id/stato`) traduce l'esito nel gate dell'approvazione — un match
 * non risolto blocca l'approvazione della pratica (spec §8.4), con motivo esplicito (regola 12).
 */

export type TipoScreening = 'sanzioni' | 'pep' | 'media_negativi';
export type EsitoScreening =
  | 'nessun_match'
  | 'match_da_valutare'
  | 'match_confermato'
  | 'falso_positivo';

const ETICHETTA_TIPO: Record<TipoScreening, string> = {
  sanzioni: 'sanzioni',
  pep: 'PEP',
  media_negativi: 'media negativi',
};

/**
 * Un esito che, ai fini dell'approvazione, NON è risolto: `match_da_valutare` (ancora da esaminare)
 * e `match_confermato` (match vero → non si approva, spec §8.4). `nessun_match` e `falso_positivo`
 * (match scartato dopo esame) lasciano passare.
 */
export function matchNonRisolto(esito: EsitoScreening): boolean {
  return esito === 'match_da_valutare' || esito === 'match_confermato';
}

export interface ScreeningRiga {
  tipo: TipoScreening;
  esito: EsitoScreening;
  dataScreening?: Date | string | null;
  createdAt?: Date | string | null;
}

/** Il più recente screening per ciascun tipo (per `dataScreening`, poi `createdAt`). */
export function screeningPiuRecentiPerTipo(
  screenings: ScreeningRiga[],
): Map<TipoScreening, ScreeningRiga> {
  const m = new Map<TipoScreening, ScreeningRiga>();
  const ts = (r: ScreeningRiga): number => {
    const d = r.dataScreening ?? r.createdAt;
    const n = d ? new Date(d).getTime() : 0;
    return Number.isFinite(n) ? n : 0;
  };
  for (const r of screenings) {
    const corrente = m.get(r.tipo);
    if (!corrente || ts(r) >= ts(corrente)) m.set(r.tipo, r);
  }
  return m;
}

/**
 * §8.4 — l'approvazione è bloccata se, per almeno un tipo, lo screening PIÙ RECENTE ha un match non
 * risolto. Nessuno screening registrato NON blocca: il blocco è sul match, non sull'assenza di
 * screening (la politica «screening obbligatorio prima di approvare» è più severa e resta una
 * configurazione futura, come «ogni incarico esige KYC» in kycGate).
 */
export function screeningBloccaApprovazione(screenings: ScreeningRiga[]): boolean {
  for (const r of screeningPiuRecentiPerTipo(screenings).values()) {
    if (matchNonRisolto(r.esito)) return true;
  }
  return false;
}

/** Frase esplicativa (regola 12): quali tipi bloccano e con quale esito. Stringa vuota se non blocca. */
export function motivoBloccoScreening(screenings: ScreeningRiga[]): string {
  const bloccanti: string[] = [];
  for (const [tipo, r] of screeningPiuRecentiPerTipo(screenings)) {
    if (matchNonRisolto(r.esito)) {
      const stato = r.esito === 'match_confermato' ? 'match confermato' : 'match da valutare';
      bloccanti.push(`${ETICHETTA_TIPO[tipo]} (${stato})`);
    }
  }
  if (bloccanti.length === 0) return '';
  return `Approvazione bloccata: screening con match non risolto — ${bloccanti.join(', ')}. Risolvi il match (falso positivo) o gestisci la pratica prima di approvare (spec §8.4).`;
}
