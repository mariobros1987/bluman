/**
 * KYC/AML Fase K8a (Malta, spec §5.3) — regole PURE di anomalie e decisioni MLRO.
 *
 * PURO: nessun DB/HTTP. Il service crea l'anomalia e registra la decisione MLRO; qui vivono la
 * mappa decisione→stato e i predicati, così la logica è una sola e testabile senza database.
 */

export type TipoAnomaliaKyc =
  | 'match_sanzioni'
  | 'match_pep'
  | 'operazione_sospetta'
  | 'documento_incongruente'
  | 'rischio_elevato'
  | 'altro';

export type StatoAnomaliaKyc =
  | 'aperta'
  | 'in_valutazione'
  | 'chiusa_nessuna_azione'
  | 'monitoraggio_rafforzato'
  | 'segnalata_fiau'
  | 'rapporto_chiuso';

export type DecisioneMlro =
  | 'nessuna_azione'
  | 'monitoraggio_rafforzato'
  | 'segnalazione_fiau'
  | 'chiusura_rapporto';

/** La decisione dell'MLRO determina lo stato terminale dell'anomalia (mappa 1:1). */
const STATO_DA_DECISIONE: Record<DecisioneMlro, StatoAnomaliaKyc> = {
  nessuna_azione: 'chiusa_nessuna_azione',
  monitoraggio_rafforzato: 'monitoraggio_rafforzato',
  segnalazione_fiau: 'segnalata_fiau',
  chiusura_rapporto: 'rapporto_chiuso',
};

export function statoDaDecisione(d: DecisioneMlro): StatoAnomaliaKyc {
  return STATO_DA_DECISIONE[d];
}

/** Un'anomalia è "aperta" (da lavorare) finché l'MLRO non ha deciso. */
export function anomaliaAperta(stato: StatoAnomaliaKyc): boolean {
  return stato === 'aperta' || stato === 'in_valutazione';
}

/** §K8b — solo la decisione di segnalazione porta l'anomalia verso l'export goAML. */
export function richiedeSegnalazioneFiau(d: DecisioneMlro): boolean {
  return d === 'segnalazione_fiau';
}

const ETICHETTA_DECISIONE: Record<DecisioneMlro, string> = {
  nessuna_azione: 'nessuna azione',
  monitoraggio_rafforzato: 'monitoraggio rafforzato',
  segnalazione_fiau: 'segnalazione alla FIAU',
  chiusura_rapporto: 'chiusura del rapporto',
};

/** Frase esplicativa della decisione (regola 12). */
export function etichettaDecisione(d: DecisioneMlro): string {
  return ETICHETTA_DECISIONE[d];
}
