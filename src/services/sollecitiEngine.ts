/**
 * Motore di Calcolo Interessi di Mora ex D.Lgs. 231/2002 & Generatore Solleciti di Pagamento.
 */

export interface CalcoloMoraResult {
  giorniRitardo: number;
  saggioAnnuoPercentuale: number;
  importoCapitaleCent: number;
  interessiMoraCent: number;
  speseForfettarieRecuperoCent: number; // €40 ex art. 6 comma 2 D.Lgs. 231/2002
  totaleDovutoCent: number;
}

export type LivelloSollecito = '1_avviso_bonario' | '2_sollecito_mora' | '3_diffida_legale';

export interface DatiSollecitoInput {
  livello: LivelloSollecito;
  clienteNome: string;
  clienteEmail?: string | null;
  numeroFattura: string;
  dataEmissione: string | Date;
  dataScadenza: string | Date;
  numeroRata: number;
  importoCapitaleCent: number;
  ibanStudio?: string | null;
  studioNome?: string | null;
  saggioInteresse?: number;
}

export interface SollecitoGenerato {
  livello: LivelloSollecito;
  oggettoEmail: string;
  corpoTesto: string;
  calcoloMora: CalcoloMoraResult;
}

// Saggio di default BCE + 8% ex D.Lgs. 231/2002 (ad oggi ~12.0%)
export const SAGGIO_MORA_DEFAULT_PERCENTUALE = 12.0;
export const SPESE_FORFETTARIE_RECUPERO_CENT = 4000; // 40,00 €

/**
 * Calcola i giorni di ritardo e gli interessi legali di mora ex D.Lgs. 231/2002.
 */
export function calcolaInteressiMora(
  importoCapitaleCent: number,
  dataScadenza: Date | string,
  dataCalcolo: Date | string = new Date(),
  saggioAnnuo: number = SAGGIO_MORA_DEFAULT_PERCENTUALE,
  includiSpeseForfettarie: boolean = true,
): CalcoloMoraResult {
  const dScadenza = new Date(dataScadenza);
  const dCalcolo = new Date(dataCalcolo);

  const diffMs = dCalcolo.getTime() - dScadenza.getTime();
  const giorniRitardo = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (giorniRitardo <= 0 || importoCapitaleCent <= 0) {
    return {
      giorniRitardo: 0,
      saggioAnnuoPercentuale: saggioAnnuo,
      importoCapitaleCent,
      interessiMoraCent: 0,
      speseForfettarieRecuperoCent: 0,
      totaleDovutoCent: importoCapitaleCent,
    };
  }

  // Formula interesse commerciale: C * r * t / 365
  const interessiMoraCent = Math.round(
    (importoCapitaleCent * (saggioAnnuo / 100) * giorniRitardo) / 365,
  );

  const speseForfettarieRecuperoCent = includiSpeseForfettarie ? SPESE_FORFETTARIE_RECUPERO_CENT : 0;
  const totaleDovutoCent = importoCapitaleCent + interessiMoraCent + speseForfettarieRecuperoCent;

  return {
    giorniRitardo,
    saggioAnnuoPercentuale: saggioAnnuo,
    importoCapitaleCent,
    interessiMoraCent,
    speseForfettarieRecuperoCent,
    totaleDovutoCent,
  };
}

/**
 * Compila il testo formale del sollecito in base al livello di gravità (1°, 2°, 3°).
 */
export function generaTestoSollecito(dati: DatiSollecitoInput): SollecitoGenerato {
  const mora = calcolaInteressiMora(
    dati.importoCapitaleCent,
    dati.dataScadenza,
    new Date(),
    dati.saggioInteresse || SAGGIO_MORA_DEFAULT_PERCENTUALE,
    dati.livello !== '1_avviso_bonario',
  );

  const dataScadFmt = new Date(dati.dataScadenza).toLocaleDateString('it-IT');
  const importoCapFmt = `€${(dati.importoCapitaleCent / 100).toFixed(2)}`;
  const studio = dati.studioNome || 'Studio Professionale BluMan';
  const iban = dati.ibanStudio ? `\nCoordinate Bancarie per il versamento (IBAN):\n${dati.ibanStudio}\n` : '';

  let oggettoEmail = '';
  let corpoTesto = '';

  if (dati.livello === '1_avviso_bonario') {
    oggettoEmail = `Promemoria Scadenza Fattura n. ${dati.numeroFattura} — ${studio}`;
    corpoTesto = `Gentile ${dati.clienteNome},

dai nostri registri contabili risulta che la rata n. ${dati.numeroRata} relativa alla Fattura n. ${dati.numeroFattura}, per un importo di ${importoCapFmt}, è giunta a scadenza in data ${dataScadFmt} e non risulta ad oggi ancora accreditata.

Nel caso il pagamento sia già stato disposto nei giorni scorsi, La preghiamo di considerare nulla la presente comunicazione. In caso contrario, Le chiediamo cortesemente di provvedere al saldo.
${iban}
Restiamo a disposizione per qualsiasi chiarimento.

Cordiali saluti,
Amministrazione ${studio}`;
  } else if (dati.livello === '2_sollecito_mora') {
    const totaleFmt = `€${(mora.totaleDovutoCent / 100).toFixed(2)}`;
    const moraFmt = `€${(mora.interessiMoraCent / 100).toFixed(2)}`;
    const speseFmt = `€${(mora.speseForfettarieRecuperoCent / 100).toFixed(2)}`;

    oggettoEmail = `SOLLECITO DI PAGAMENTO: Fattura n. ${dati.numeroFattura} scaduta — ${studio}`;
    corpoTesto = `Spett.le ${dati.clienteNome},

facciamo seguito ai precedenti contatti per segnalarLe che la Fattura n. ${dati.numeroFattura} (Rata ${dati.numeroRata}) di ${importoCapFmt}, scaduta il ${dataScadFmt} (${mora.giorniRitardo} giorni di ritardo), risulta tuttora insoluta.

Ai sensi del D.Lgs. 9 ottobre 2002 n. 231 (in attuazione della Direttiva 2000/35/CE sui ritardi di pagamento nelle transazioni commerciali), sono maturati i seguenti oneri:
- Quota Capitale: ${importoCapFmt}
- Interessi di Mora ex D.Lgs. 231/2002 (tasso ${mora.saggioAnnuoPercentuale}%): ${moraFmt}
- Risarcimento forfettario spese di recupero (art. 6 c. 2): ${speseFmt}
--------------------------------------------------
TOTALE DOVUTO: ${totaleFmt}

Le richiediamo di effettuare il versamento dell'importo dovuto entro e non oltre 5 giorni dal ricevimento della presente.
${iban}
Distinti saluti,
Ufficio Legale & Amministrazione ${studio}`;
  } else {
    // 3_diffida_legale
    const totaleFmt = `€${(mora.totaleDovutoCent / 100).toFixed(2)}`;
    oggettoEmail = `DIFFIDA FORMALE E MESSA IN MORA — Fattura n. ${dati.numeroFattura} — ${studio}`;
    corpoTesto = `RACCOMANDATA A/R / PEC AD EFFICACIA DI DIFFIDA E MESSA IN MORA

Spett.le ${dati.clienteNome},

con la presente Vi intimiamo e diffidiamo formalmente ad adempiere, entro e non oltre 5 (cinque) giorni dal ricevimento della presente, al pagamento della somma complessiva di:

${totaleFmt}

a saldo della Fattura n. ${dati.numeroFattura} scaduta in data ${dataScadFmt} (${mora.giorniRitardo} giorni di ritardo), comprensiva degli interessi moratori e delle spese di recupero maturate ai sensi del D.Lgs. 231/2002.
${iban}
Decorso infruttuosamente tale termine, senza ulteriore preavviso, daremo mandato ai nostri legali per il recupero forzoso del credito mediante ricorso per Decreto Ingiuntivo provvisoriamente esecutivo con aggravio di tutte le spese legali, procedendo contestualmente alla sospensione immediata di ogni attività e incarico in corso.

Valga la presente quale atto formale di costituzione in mora ad ogni effetto di legge.

${studio}`;
  }

  return {
    livello: dati.livello,
    oggettoEmail,
    corpoTesto,
    calcoloMora: mora,
  };
}
