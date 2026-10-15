/**
 * Motore di Calcolo Fiscale per la Liquidazione IVA Periodica (LIPE), Prospetto F24 e Certificazione Unica (CU).
 */

export interface PeriodoFiscale {
  tipo: 'mensile' | 'trimestrale';
  anno: number;
  mese?: number; // 1-12 se mensile
  trimestre?: number; // 1-4 se trimestrale
  codicePeriodo: string; // es. "2026-09" o "2026-Q3"
  dataInizio: Date;
  dataFine: Date;
}

/**
 * I documenti a **esigibilità differita** che questo prospetto ha contato come se fossero a
 * esigibilità immediata.
 *
 * `esigibilitaIva = 'differita'` non è una nota di colore: per l'art. 6, comma 4, del DPR 633/72
 * l'IVA di quelle operazioni diventa esigibile **al pagamento**, non alla data del documento. Il
 * motore invece la conta nel periodo della fattura, cioè un periodo troppo presto.
 *
 * Perché non la tratta come dice la legge: perché farlo richiede che **ogni incasso sia registrato
 * nell'app** (`RegistrazioneIncasso`), e su quello il motore non ha alcuna garanzia. Una differita
 * mai incassata a sistema uscirebbe da **tutte** le liquidazioni, in silenzio: una dichiarazione in
 * meno, con sanzioni, al posto di una dichiarazione in anticipo, che l'anno chiude in pari. Fra i
 * due errori questo progetto sceglie il meno pericoloso — ma non ha il diritto di sceglierlo **in
 * silenzio**, ed è per questo che esiste questo campo: il numero resta quello prudente e chi legge
 * il prospetto **sa** che una parte ha una data diversa da quella scritta accanto.
 *
 * Il caso opposto, lo **split payment**, è escluso del tutto e senza avvisi, perché lì l'IVA non è
 * mai dello studio: la versa il committente. Differita e split si assomigliano solo nel nome.
 *
 * Resta una decisione fiscale aperta, da confermare col titolare: implementare l'esigibilità al
 * pagamento (con l'obbligo, a quel punto, di segnalare le differite non incassate) oppure togliere
 * l'opzione dall'app se lo studio non emette mai fatture di quel tipo.
 */
export interface DifferitaTrattataComeImmediata {
  /** Quanti documenti sono stati contati così (fatture differite e loro note di credito). */
  count: number;
  imponibileCent: number;
  ivaDebitoCent: number;
  /** I loro numeri, per poterli andare a guardare. */
  documenti: string[];
}

export interface RiepilogoIvaPeriodo {
  periodo: PeriodoFiscale;
  totaleImponibileVenditeCent: number;
  ivaDebitoCent: number;
  totaleImponibileAcquistiCent: number;
  ivaCreditoCent: number;
  saldoIvaCent: number; // ivaDebito - ivaCredito (positivo = debito da versare, negativo = credito)
  stato: 'debito' | 'credito' | 'a_pareggio';
  importoDaVersareCent: number;
  creditoRiportabileCent: number;
  differitaTrattataComeImmediata: DifferitaTrattataComeImmediata;
  prospettoF24: ProspettoF24;
}

export interface RigoTributoF24 {
  sezione: 'ERARIO';
  codiceTributo: string;
  rateazione?: string;
  annoRiferimento: number;
  importoDebitoCent: number;
  importoCreditoCent: number;
  descrizione: string;
}

export interface ProspettoF24 {
  annoRiferimento: number;
  periodoRiferimento: string;
  righe: RigoTributoF24[];
  totaleDebitoCent: number;
  totaleCreditoCent: number;
  saldoFinaleCent: number;
}

export function determinaPeriodoFiscale(periodoStr: string): PeriodoFiscale {
  const str = periodoStr.trim().toUpperCase();

  // Caso Trimestrale: es. "2026-Q3" o "2026-T3"
  const matchTrimestre = str.match(/^(\d{4})[-_]?(Q|T)([1-4])$/);
  if (matchTrimestre && matchTrimestre[1] && matchTrimestre[3]) {
    const anno = parseInt(matchTrimestre[1], 10);
    const trimestre = parseInt(matchTrimestre[3], 10);
    const meseInizio = (trimestre - 1) * 3;
    const meseFine = meseInizio + 2;

    const dataInizio = new Date(Date.UTC(anno, meseInizio, 1, 0, 0, 0, 0));
    const dataFine = new Date(Date.UTC(anno, meseFine + 1, 0, 23, 59, 59, 999));

    return {
      tipo: 'trimestrale',
      anno,
      trimestre,
      codicePeriodo: `${anno}-Q${trimestre}`,
      dataInizio,
      dataFine,
    };
  }

  // Caso Mensile: es. "2026-09" o "2026-9"
  const matchMese = str.match(/^(\d{4})[-_]?(\d{1,2})$/);
  if (matchMese && matchMese[1] && matchMese[2]) {
    const anno = parseInt(matchMese[1], 10);
    const mese = parseInt(matchMese[2], 10);
    if (mese < 1 || mese > 12) {
      throw new Error(`Mese non valido: ${mese}`);
    }

    const dataInizio = new Date(Date.UTC(anno, mese - 1, 1, 0, 0, 0, 0));
    const dataFine = new Date(Date.UTC(anno, mese, 0, 23, 59, 59, 999));

    return {
      tipo: 'mensile',
      anno,
      mese,
      codicePeriodo: `${anno}-${String(mese).padStart(2, '0')}`,
      dataInizio,
      dataFine,
    };
  }

  throw new Error(`Formato periodo non valido: "${periodoStr}". Usa "AAAA-MM" per mensile (es. 2026-09) o "AAAA-QX" per trimestrale (es. 2026-Q3).`);
}

/**
 * Mappa il codice tributo erario F24 per il versamento IVA periodica.
 */
export function getCodiceTributoIva(periodo: PeriodoFiscale): { codice: string; descrizione: string } {
  if (periodo.tipo === 'trimestrale') {
    switch (periodo.trimestre) {
      case 1:
        return { codice: '6031', descrizione: 'Versamento IVA 1° trimestre' };
      case 2:
        return { codice: '6032', descrizione: 'Versamento IVA 2° trimestre' };
      case 3:
        return { codice: '6033', descrizione: 'Versamento IVA 3° trimestre' };
      case 4:
        return { codice: '6034', descrizione: 'Versamento IVA 4° trimestre / Conguaglio annuale' };
      default:
        return { codice: '6099', descrizione: 'Versamento IVA periodica' };
    }
  } else {
    const codiciMensili: Record<number, string> = {
      1: '6001',
      2: '6002',
      3: '6003',
      4: '6004',
      5: '6005',
      6: '6006',
      7: '6007',
      8: '6008',
      9: '6009',
      10: '6010',
      11: '6011',
      12: '6012',
    };
    const codice = codiciMensili[periodo.mese || 1] || '6001';
    return { codice, descrizione: `Versamento IVA mese ${periodo.mese}` };
  }
}

/**
 * Calcola la Liquidazione IVA Periodica su un insieme di fatture attive e passive.
 */
export function calcolaLiquidazioneIvaPeriodo(
  periodoStr: string,
  fattureAttive: Array<{
    totaleImponibileCentesimi: number;
    totaleIvaCentesimi: number;
    esigibilitaIva?: string | null;
    stato?: string;
    /** 'fattura' | 'nota_credito': la NC storna, quindi entra con segno negativo. */
    tipoDocumento?: string | null;
    /** Servono solo a **nominare** i documenti differiti nel prospetto. */
    id?: string | null;
    numero?: string | null;
  }>,
  fatturePassive: Array<{
    imponibileCentesimi: number;
    ivaCentesimi: number;
  }>,
  creditoIvaPrecedenteCent: number = 0,
): RiepilogoIvaPeriodo {
  const periodo = determinaPeriodoFiscale(periodoStr);

  // 1. Somma IVA a Debito (escludendo split payment verso PA dove l'IVA non è incassata dallo studio)
  let totaleImponibileVenditeCent = 0;
  let ivaDebitoCent = 0;

  // La parte di questo debito che ha una data di esigibilità **diversa** da quella che il prospetto
  // le attribuisce: si conta qui per poterla dichiarare, non per cambiare il totale (il perché è
  // nell'intestazione di `DifferitaTrattataComeImmediata`).
  let differitaImponibileCent = 0;
  let differitaIvaCent = 0;
  const differitaDocumenti: string[] = [];

  for (const f of fattureAttive) {
    if (f.stato === 'bozza') continue; // le bozze non concorrono
    if (f.esigibilitaIva === 'split') continue; // split payment escluso dal debito IVA periodico

    // Le note di credito stornano l'operazione: entrano con segno NEGATIVO nel debito del
    // LORO periodo di emissione (i loro totali sono memorizzati positivi, come la fattura
    // origine). La fattura annullata NON va esclusa qui: concorre nel suo periodo, e lo
    // storno è realizzato dalla NC nel periodo in cui è emessa — escluderla sballerebbe la
    // liquidazione del periodo della fattura quando la NC cade in un periodo successivo.
    const segno = f.tipoDocumento === 'nota_credito' ? -1 : 1;
    totaleImponibileVenditeCent += segno * (f.totaleImponibileCentesimi || 0);
    ivaDebitoCent += segno * (f.totaleIvaCentesimi || 0);

    if (f.esigibilitaIva === 'differita') {
      differitaImponibileCent += segno * (f.totaleImponibileCentesimi || 0);
      differitaIvaCent += segno * (f.totaleIvaCentesimi || 0);
      // Il numero, e in mancanza l'id: un documento che non si può nominare non si può andare a
      // controllare, e questa segnalazione serve esattamente a quello.
      differitaDocumenti.push(f.numero || f.id || 'documento senza numero');
    }
  }

  // 2. Somma IVA a Credito da acquisti
  let totaleImponibileAcquistiCent = 0;
  let ivaCreditoCent = 0;

  for (const f of fatturePassive) {
    totaleImponibileAcquistiCent += f.imponibileCentesimi || 0;
    ivaCreditoCent += f.ivaCentesimi || 0;
  }

  const ivaCreditoTotaleCent = ivaCreditoCent + creditoIvaPrecedenteCent;
  const saldoIvaCent = ivaDebitoCent - ivaCreditoTotaleCent;

  let stato: 'debito' | 'credito' | 'a_pareggio' = 'a_pareggio';
  let importoDaVersareCent = 0;
  let creditoRiportabileCent = 0;

  if (saldoIvaCent > 0) {
    stato = 'debito';
    importoDaVersareCent = saldoIvaCent;
  } else if (saldoIvaCent < 0) {
    stato = 'credito';
    creditoRiportabileCent = Math.abs(saldoIvaCent);
  }

  // 3. Compilazione Prospetto F24
  const tributoIva = getCodiceTributoIva(periodo);
  const righeF24: RigoTributoF24[] = [];

  if (importoDaVersareCent > 0) {
    righeF24.push({
      sezione: 'ERARIO',
      codiceTributo: tributoIva.codice,
      annoRiferimento: periodo.anno,
      importoDebitoCent: importoDaVersareCent,
      importoCreditoCent: 0,
      descrizione: tributoIva.descrizione,
    });
  }

  const prospettoF24: ProspettoF24 = {
    annoRiferimento: periodo.anno,
    periodoRiferimento: periodo.codicePeriodo,
    righe: righeF24,
    totaleDebitoCent: importoDaVersareCent,
    totaleCreditoCent: 0,
    saldoFinaleCent: importoDaVersareCent,
  };

  return {
    periodo,
    totaleImponibileVenditeCent,
    ivaDebitoCent,
    totaleImponibileAcquistiCent,
    ivaCreditoCent,
    saldoIvaCent,
    stato,
    importoDaVersareCent,
    creditoRiportabileCent,
    differitaTrattataComeImmediata: {
      count: differitaDocumenti.length,
      imponibileCent: differitaImponibileCent,
      ivaDebitoCent: differitaIvaCent,
      documenti: differitaDocumenti,
    },
    prospettoF24,
  };
}
