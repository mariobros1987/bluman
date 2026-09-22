/**
 * Motore di rischio KYC/AML §5.5 — Fase «motore» (spec bluman-kyc-aml-spec-tecnica.md §4).
 *
 * PURO: nessun accesso a DB/HTTP. Riceve i dati già raccolti (dal service, che li legge da
 * `Cliente`, dalla configurazione paesi/soglie del tenant e dall'operazione) e restituisce il
 * livello di adeguata verifica, un punteggio numerico per audit/tuning e le motivazioni.
 *
 * Il livello segue l'albero deterministico della spec (§4.1): un solo trigger "rafforzato" basta.
 * L'approccio è risk-based (§1.2): la maggioranza dei clienti a basso rischio va instradata al
 * percorso leggero, il lavoro dell'operatore si concentra sui casi che lo richiedono davvero.
 */

export type LivelloVerificaKyc = 'semplificata' | 'ordinaria' | 'rafforzata';
export type LivelloRischioKyc = 'basso' | 'medio' | 'alto';

/** Tipi cliente che la normativa ammette all'adeguata verifica SEMPLIFICATA (§4.1). */
export const TIPI_CLIENTE_SEMPLIFICATA = ['pa', 'societa_quotata', 'ente_vigilato_ue'] as const;

export interface InputRischioKyc {
  /** Tipo/natura del cliente, normalizzato lowercase (es. 'pa', 'societa_quotata', 'company'). */
  tipoCliente?: string | null;
  pep?: boolean;
  /** Paese di residenza/sede, come compare in `paesiAltoRischio`. */
  paeseResidenza?: string | null;
  /** Lista paesi ad alto rischio (GAFI/UE), configurabile per tenant — passata dal service. */
  paesiAltoRischio?: string[];
  /** Valore economico dell'operazione che genera l'obbligo, in centesimi. */
  valoreOperazioneCent?: number | null;
  /** Soglia oltre la quale scatta la verifica rafforzata, in centesimi (per tenant). */
  sogliaOperazioneCent?: number | null;
  /** Rapporto instaurato senza presenza fisica del cliente. */
  senzaPresenzaFisica?: boolean;
  /** Identità accertata con SPID/CIE (mitiga il "senza presenza fisica"). */
  identificatoConSpidOCie?: boolean;
}

export interface EsitoRischioKyc {
  livelloVerifica: LivelloVerificaKyc;
  rischioCalcolato: LivelloRischioKyc;
  punteggioRischio: number;
  motivazioni: string[];
}

// Pesi dei fattori di rischio: sommati danno il punteggio per audit/tuning. Solo indicativi —
// il livello lo decide l'albero, non la soglia numerica.
const PESO = { pep: 50, paese: 40, soglia: 30, senzaPresenza: 30 } as const;

export function calcolaRischioKyc(input: InputRischioKyc): EsitoRischioKyc {
  const tipo = (input.tipoCliente ?? '').trim().toLowerCase();
  if ((TIPI_CLIENTE_SEMPLIFICATA as readonly string[]).includes(tipo)) {
    return {
      livelloVerifica: 'semplificata',
      rischioCalcolato: 'basso',
      punteggioRischio: 0,
      motivazioni: ['Cliente ammesso alla verifica semplificata (PA / quotata / ente vigilato UE)'],
    };
  }

  const motivazioni: string[] = [];
  let punteggio = 0;

  if (input.pep) {
    punteggio += PESO.pep;
    motivazioni.push('Persona politicamente esposta (PEP)');
  }
  const paese = (input.paeseResidenza ?? '').trim().toLowerCase();
  if (paese && (input.paesiAltoRischio ?? []).some((p) => p.trim().toLowerCase() === paese)) {
    punteggio += PESO.paese;
    motivazioni.push(`Paese ad alto rischio: ${input.paeseResidenza}`);
  }
  if (
    input.valoreOperazioneCent != null &&
    input.sogliaOperazioneCent != null &&
    input.valoreOperazioneCent > input.sogliaOperazioneCent
  ) {
    punteggio += PESO.soglia;
    motivazioni.push('Operazione oltre la soglia configurata');
  }
  if (input.senzaPresenzaFisica && !input.identificatoConSpidOCie) {
    punteggio += PESO.senzaPresenza;
    motivazioni.push('Rapporto senza presenza fisica e senza identificazione SPID/CIE');
  }

  const livelloVerifica: LivelloVerificaKyc = punteggio > 0 ? 'rafforzata' : 'ordinaria';
  const rischioCalcolato: LivelloRischioKyc = punteggio >= 50 ? 'alto' : punteggio >= 30 ? 'medio' : 'basso';
  if (motivazioni.length === 0) motivazioni.push('Nessun fattore di rischio rilevato: verifica ordinaria');

  return { livelloVerifica, rischioCalcolato, punteggioRischio: punteggio, motivazioni };
}

/** Mesi di validità del fascicolo per livello (§4.2): semplificata 24, ordinaria 12, rafforzata 6. */
export function mesiValiditaKyc(livello: LivelloVerificaKyc): number {
  return livello === 'semplificata' ? 24 : livello === 'rafforzata' ? 6 : 12;
}

/** Data di scadenza del fascicolo a partire dalla data di verifica e dal livello. */
export function calcolaScadenzaKyc(livello: LivelloVerificaKyc, dataVerifica: Date): Date {
  const d = new Date(dataVerifica);
  d.setMonth(d.getMonth() + mesiValiditaKyc(livello));
  return d;
}
