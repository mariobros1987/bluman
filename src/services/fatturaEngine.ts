/**
 * Motore di Calcolo Fiscale e Contabile (OpenSTAManager Engine)
 * 
 * Gestisce:
 * - Calcolo esatto al centesimo di imponibile, cassa previdenziale, IVA per aliquota,
 *   ritenuta d'acconto e bollo virtuale automatico (€2 per esenti/esclusi > €77,47).
 * - Generazione automatica del piano rate dello scadenzario in base alla condizione di pagamento.
 * - Guard di immutabilità fiscale (blocco modifiche per fatture emesse/trasmesse).
 * - Gestione note di credito (TD04) con storno contabile a cascata.
 */

export interface RigaFatturaInput {
  id?: string;
  descrizione: string;
  quantita?: number;
  unitaMisura?: string;
  prezzoUnitarioCent: number;
  scontoPercentuale?: number;
  aliquotaIva?: number; // 22, 10, 4, 0
  naturaEsenzione?: string | null; // N1, N2.2, N3.1, N4, etc.
  applicaCassa?: boolean;
  applicaRitenuta?: boolean;
  applicaBollo?: boolean;
  moduloProgettoId?: string | null;
  articoloId?: string | null;
  tipo?: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
  percentuale?: number | null;
}

export interface OpzioniCalcoloFattura {
  tipoCassa?: 'nessuna' | 'inps_gestione_separata' | 'cassa_commercialisti' | 'cassa_forense' | 'inarcassa';
  aliquotaCassa?: number; // es. 4.0
  aliquotaRitenuta?: number; // es. 20.0
  esigibilitaIva?: 'immediata' | 'differita' | 'split';
  applicaBolloVirtuale?: boolean; // default true (se esenti > 77,47€)
}

export interface RigaFatturaCalcolata extends RigaFatturaInput {
  quantita: number;
  unitaMisura: string;
  scontoPercentuale: number;
  aliquotaIva: number;
  applicaCassa: boolean;
  applicaRitenuta: boolean;
  applicaBollo: boolean;
  imponibileCentesimi: number;
  ivaCentesimi: number;
  totaleRigaCentesimi: number;
}

export interface RiepilogoIva {
  aliquotaIva: number;
  naturaEsenzione?: string | null;
  imponibileCentesimi: number;
  ivaCentesimi: number;
}

export interface TotaliFatturaCalcolati {
  righe: RigaFatturaCalcolata[];
  riepilogoIva: RiepilogoIva[];
  totaleImponibileCentesimi: number;
  totaleCassaCentesimi: number;
  totaleIvaCentesimi: number;
  totaleRitenutaCentesimi: number;
  totaleBolloCentesimi: number;
  totaleDocumentoCentesimi: number;
  nettoAPagareCentesimi: number;
}

// Soglia per l'applicazione del bollo virtuale da 2,00 euro (77,47 euro = 7747 centesimi)
export const SOGLIA_BOLLO_CENTESIMI = 7747;
export const IMPORTO_BOLLO_CENTESIMI = 200;

/**
 * Calcola tutti i totali fiscali e contabili delle righe fattura con precisione al centesimo.
 */
export function calcolaTotaliFattura(
  righeInput: RigaFatturaInput[],
  opzioni: OpzioniCalcoloFattura = {}
): TotaliFatturaCalcolati {
  const aliquotaCassa = opzioni.aliquotaCassa ?? (opzioni.tipoCassa && opzioni.tipoCassa !== 'nessuna' ? 4.0 : 0);
  const aliquotaRitenuta = opzioni.aliquotaRitenuta ?? 0;
  const calcolaBolloAuto = opzioni.applicaBolloVirtuale !== false;

  let totaleImponibileCentesimi = 0;
  let imponibileSoggettoACassa = 0;
  let imponibileSoggettoARitenuta = 0;
  let imponibileEsenteBollo = 0;

  const righeCalcolate: RigaFatturaCalcolata[] = [];
  const mappaIva = new Map<string, { aliquotaIva: number; natura?: string | null; imponibile: number; iva: number }>();

  // 1. Calcolo imponibile per singola riga
  for (const r of righeInput) {
    const qta = r.quantita !== undefined && r.quantita > 0 ? r.quantita : 1.0;
    const sconto = r.scontoPercentuale && r.scontoPercentuale > 0 ? Math.min(100, r.scontoPercentuale) : 0;
    const prezzoTotaleGrezzo = qta * r.prezzoUnitarioCent;
    const imponibileRiga = Math.round(prezzoTotaleGrezzo * (1 - sconto / 100));

    const aliquotaIva = r.aliquotaIva !== undefined ? r.aliquotaIva : 22;
    const applicaCassa = r.applicaCassa !== false;
    const applicaRitenuta = r.applicaRitenuta !== false;
    const natura = r.naturaEsenzione || null;

    // Determinazione se la riga è esente/esclusa ai fini del bollo
    const isEsente = aliquotaIva === 0 && Boolean(natura);
    const applicaBollo = r.applicaBollo ?? isEsente;

    totaleImponibileCentesimi += imponibileRiga;
    if (applicaCassa) imponibileSoggettoACassa += imponibileRiga;
    if (applicaRitenuta) imponibileSoggettoARitenuta += imponibileRiga;
    if (applicaBollo) imponibileEsenteBollo += imponibileRiga;

    righeCalcolate.push({
      ...r,
      quantita: qta,
      unitaMisura: r.unitaMisura || 'ore',
      scontoPercentuale: sconto,
      aliquotaIva,
      applicaCassa,
      applicaRitenuta,
      applicaBollo,
      imponibileCentesimi: imponibileRiga,
      ivaCentesimi: 0, // valorizzato dopo ripartizione cassa
      totaleRigaCentesimi: imponibileRiga,
    });
  }

  // 2. Calcolo Cassa Previdenziale / Rivalsa INPS
  const totaleCassaCentesimi = aliquotaCassa > 0
    ? Math.round(imponibileSoggettoACassa * (aliquotaCassa / 100))
    : 0;

  // 3. Calcolo IVA con ripartizione della cassa
  for (const r of righeCalcolate) {
    // Quota cassa attribuibile alla riga proporzionale all'imponibile
    const quotaCassaRiga = (imponibileSoggettoACassa > 0 && r.applicaCassa)
      ? Math.round(totaleCassaCentesimi * (r.imponibileCentesimi / imponibileSoggettoACassa))
      : 0;

    const baseImponibileIva = r.imponibileCentesimi + quotaCassaRiga;
    const ivaRiga = r.aliquotaIva > 0
      ? Math.round(baseImponibileIva * (r.aliquotaIva / 100))
      : 0;

    r.ivaCentesimi = ivaRiga;
    r.totaleRigaCentesimi = r.imponibileCentesimi + quotaCassaRiga + ivaRiga;

    // Aggregazione riepilogo IVA per aliquota e natura
    const chiaveIva = `${r.aliquotaIva}_${r.naturaEsenzione || 'ORD'}`;
    const entry = mappaIva.get(chiaveIva) || {
      aliquotaIva: r.aliquotaIva,
      natura: r.naturaEsenzione,
      imponibile: 0,
      iva: 0,
    };
    entry.imponibile += baseImponibileIva;
    entry.iva += ivaRiga;
    mappaIva.set(chiaveIva, entry);
  }

  let totaleIvaCentesimi = 0;
  const riepilogoIva: RiepilogoIva[] = [];
  for (const entry of mappaIva.values()) {
    // IVA del riepilogo calcolata sull'imponibile di GRUPPO, non come somma dei per-riga
    // arrotondati (B1 audit): è il valore che SDI valida in DatiRiepilogo. Sommare i per-riga
    // arrotondati produceva uno scarto fino a 1 cent (es. 2×10,15€ @22% → 2×223 = 446, mentre
    // 2030×0,22 = 447), che SDI segnala come incoerenza fra Imponibile e Imposta.
    const ivaGruppo = entry.aliquotaIva > 0 ? Math.round(entry.imponibile * (entry.aliquotaIva / 100)) : 0;
    totaleIvaCentesimi += ivaGruppo;
    riepilogoIva.push({
      aliquotaIva: entry.aliquotaIva,
      naturaEsenzione: entry.natura,
      imponibileCentesimi: entry.imponibile,
      ivaCentesimi: ivaGruppo,
    });
  }

  // 4. Calcolo Ritenuta d'Acconto (sull'imponibile professionale + eventuale cassa soggetta a ritenuta)
  const totaleRitenutaCentesimi = aliquotaRitenuta > 0
    ? Math.round(imponibileSoggettoARitenuta * (aliquotaRitenuta / 100))
    : 0;

  // 5. Calcolo Bollo Virtuale (€2 se totale operazioni esenti > 77,47€)
  const totaleBolloCentesimi = (calcolaBolloAuto && imponibileEsenteBollo > SOGLIA_BOLLO_CENTESIMI)
    ? IMPORTO_BOLLO_CENTESIMI
    : 0;

  // 6. Totale Documento e Netto a Pagare
  const totaleDocumentoCentesimi = totaleImponibileCentesimi + totaleCassaCentesimi + totaleIvaCentesimi + totaleBolloCentesimi;
  const nettoAPagareCentesimi = opzioni.esigibilitaIva === 'split'
    ? (totaleDocumentoCentesimi - totaleIvaCentesimi - totaleRitenutaCentesimi) // split payment PA: IVA non incassata
    : (totaleDocumentoCentesimi - totaleRitenutaCentesimi);

  return {
    righe: righeCalcolate,
    riepilogoIva,
    totaleImponibileCentesimi,
    totaleCassaCentesimi,
    totaleIvaCentesimi,
    totaleRitenutaCentesimi,
    totaleBolloCentesimi,
    totaleDocumentoCentesimi,
    nettoAPagareCentesimi,
  };
}

/**
 * Genera il piano delle scadenze rateali per lo scadenzario.
 */
export function generaPianoScadenze(
  totaleNettoCentesimi: number,
  condizione: string,
  dataEmissione: Date = new Date()
): Array<{ numeroRata: number; importoCentesimi: number; dataScadenza: Date; note?: string }> {
  const baseDate = new Date(dataEmissione);

  switch (condizione) {
    case 'immediato': {
      return [{
        numeroRata: 1,
        importoCentesimi: totaleNettoCentesimi,
        dataScadenza: baseDate,
        note: 'Pagamento a vista / immediato',
      }];
    }

    case 'bonifico_60gg': {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + 60);
      return [{
        numeroRata: 1,
        importoCentesimi: totaleNettoCentesimi,
        dataScadenza: d,
        note: 'Rata unica a 60 giorni',
      }];
    }

    case 'bonifico_30_60gg': {
      const rata1 = Math.floor(totaleNettoCentesimi / 2);
      const rata2 = totaleNettoCentesimi - rata1; // assorbe eventuale resto di centesimi

      const d1 = new Date(baseDate);
      d1.setDate(d1.getDate() + 30);

      const d2 = new Date(baseDate);
      d2.setDate(d2.getDate() + 60);

      return [
        { numeroRata: 1, importoCentesimi: rata1, dataScadenza: d1, note: 'Rata 1/2 (50% a 30gg)' },
        { numeroRata: 2, importoCentesimi: rata2, dataScadenza: d2, note: 'Rata 2/2 (50% a 60gg)' },
      ];
    }

    case 'bonifico_fine_mese': {
      // Fine mese successivo
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + 2, 0);
      return [{
        numeroRata: 1,
        importoCentesimi: totaleNettoCentesimi,
        dataScadenza: d,
        note: 'Pagamento a fine mese successivo',
      }];
    }

    case 'bonifico_30gg':
    default: {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + 30);
      return [{
        numeroRata: 1,
        importoCentesimi: totaleNettoCentesimi,
        dataScadenza: d,
        note: 'Rata unica a 30 giorni',
      }];
    }
  }
}

/**
 * Ripartizione proporzionale di uno storno parziale (Nota di Credito parziale) sulle rate ancora
 * dovute della fattura d'origine. Lavora sui **residui** (importo rata − già incassato): una rata
 * saldata non assorbe storno, una pagata a metà lo assorbe solo per la parte aperta. La riduzione
 * è spalmata in proporzione al peso di ogni residuo — così nessuna rata sparisce arbitrariamente —
 * e l'eventuale resto d'arrotondamento va alla rata col residuo maggiore, perché la somma delle
 * riduzioni sia ESATTAMENTE lo storno (mai un centesimo perso o inventato). Se lo storno copre
 * l'intero residuo aperto ogni rata è azzerata (chi scrive la marcherà `stornata`). Pura: non tocca
 * database né stato, restituisce solo la matematica — testabile in isolamento.
 */
export interface RataDaStornare {
  id: string;
  residuoCentesimi: number; // importo rata − già incassato
}
export interface RiduzioneRata {
  id: string;
  riduzioneCentesimi: number;
  nuovoResiduoCentesimi: number;
  azzerata: boolean; // true se lo storno estingue del tutto il residuo
}

export function ripartisciStornoScadenze(
  rate: RataDaStornare[],
  importoStornoCentesimi: number
): RiduzioneRata[] {
  const aperte = rate.filter((r) => r.residuoCentesimi > 0);
  const totaleResiduo = aperte.reduce((acc, r) => acc + r.residuoCentesimi, 0);
  const storno = Math.max(0, Math.min(importoStornoCentesimi, totaleResiduo));

  if (totaleResiduo === 0 || storno >= totaleResiduo) {
    return aperte.map((r) => ({
      id: r.id,
      riduzioneCentesimi: storno >= totaleResiduo ? r.residuoCentesimi : 0,
      nuovoResiduoCentesimi: storno >= totaleResiduo ? 0 : r.residuoCentesimi,
      azzerata: storno >= totaleResiduo,
    }));
  }

  const calc = aperte.map((r) => ({
    id: r.id,
    residuo: r.residuoCentesimi,
    riduzione: Math.round((storno * r.residuoCentesimi) / totaleResiduo),
  }));
  const resto = storno - calc.reduce((acc, x) => acc + x.riduzione, 0);
  if (resto !== 0 && calc.length > 0) {
    // Il resto d'arrotondamento va alla rata col residuo maggiore (la piu capiente ad assorbirlo).
    const target = calc.reduce((max, x) => (x.residuo > max.residuo ? x : max));
    target.riduzione += resto;
  }
  return calc.map((x) => {
    const riduzione = Math.max(0, Math.min(x.riduzione, x.residuo));
    const nuovoResiduo = x.residuo - riduzione;
    return { id: x.id, riduzioneCentesimi: riduzione, nuovoResiduoCentesimi: nuovoResiduo, azzerata: nuovoResiduo === 0 };
  });
}

/**
 * Guard di Immutabilità Fiscale:
 * Blocca tentativi di modifica su fatture già emesse o trasmesse.
 */
export function assertFatturaModificabile(stato: string): void {
  if (stato !== 'bozza') {
    throw new Error(
      `Impossibile modificare il documento: lo stato fiscale attuale è '${stato}'. Per legge, le fatture emesse possono essere rettificate solo tramite Nota di Credito (TD04).`
    );
  }
}

/**
 * Formatta il numero progressivo ufficiale (es. "FT-2026/001", "NC-2026/001").
 */
export function formattaNumeroDocumento(serie: string, progressivo: number, data: Date = new Date()): string {
  const anno = data.getFullYear();
  const padProgressivo = String(progressivo).padStart(3, '0');
  return `${serie}-${anno}/${padProgressivo}`;
}

/**
 * L'anno solare in cui cade una data, come intervallo da dare a un `where` di Prisma.
 *
 * `formattaNumeroDocumento` **scrive l'anno dentro il numero** (`FT-2026/001`), quindi chi conta i
 * documenti di una serie deve contare lo stesso anno che il numero dichiara. Senza questo filtro il
 * contatore attraversava il capodanno: il 1° gennaio 2027 la prima fattura dell'anno sarebbe stata
 * `FT-2027/043`, cioè una numerazione che riprende da dove finiva il 2026 invece di ripartire da
 * `001`. L'art. 21 del DPR 633/72 chiede la numerazione «in ordine progressivo per anno solare», e
 * una serie che non riparte non è una serie annuale.
 *
 * L'anno è quello **locale**, non UTC, ed è la stessa scelta che fa `getFullYear()` nel
 * formattatore: se i due usassero criteri diversi, un documento emesso a cavallo della mezzanotte
 * di capodanno verrebbe *numerato* 2027 e *contato* nel 2026. Un difetto così non si vedrebbe fino
 * al primo gennaio successivo, e a quel punto sarebbe già stampato su una fattura.
 */
export function intervalloAnnoSolare(data: Date = new Date()): { gte: Date; lt: Date } {
  const anno = data.getFullYear();
  return { gte: new Date(anno, 0, 1), lt: new Date(anno + 1, 0, 1) };
}
