// «Da fare oggi» sulla Dashboard: che cosa aspetta l'operatore, ricavato da dati che l'app ha già.
//
// Qui non si decide e non si calcola niente di contabile: si contano righe già scritte (rate non
// incassate, fatture d'acquisto non pagate) e si dice dove andare a guardarle. «Oggi» arriva da
// fuori, così la funzione si prova senza dipendere dall'orologio.

export interface RataPerDaFare {
  stato: string;
  dataScadenza: string;
  importoCentesimi: number | null;
  registrazioniRegistrate?: Array<{ importoIncassatoCentesimi?: number | null }> | null;
}

export interface FatturaAcquistoPerDaFare {
  pagata: boolean;
  totaleCentesimi: number | null;
}

export interface VoceDaFare {
  chiave: 'rate_scadute' | 'rate_in_scadenza' | 'acquisti_da_pagare' | 'moduli_in_ritardo';
  /** `urgente` = è già tardi; `presto` = scade a breve; `info` = da tenere d'occhio. */
  tono: 'urgente' | 'presto' | 'info';
  testo: string;
  /** L'importo in centesimi a cui la voce si riferisce, se ne ha uno. */
  importoCentesimi?: number;
  /** La pagina dove si fa la cosa. */
  vaiA: string;
  etichettaVaiA: string;
}

const GIORNI_PRESTO = 7;
const giorno = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
/** Il giorno scritto in una data ISO («2026-11-27T…»), senza passare dal fuso del browser. */
function giornoDaIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
}

/** Quanto resta da incassare di una rata: l'importo meno ciò che è già stato registrato. */
function residuo(rata: RataPerDaFare): number {
  const incassato = (rata.registrazioniRegistrate ?? []).reduce((tot, r) => tot + (r.importoIncassatoCentesimi ?? 0), 0);
  return Math.max(0, (rata.importoCentesimi ?? 0) - incassato);
}

const plurale = (n: number, uno: string, molti: string) => `${n} ${n === 1 ? uno : molti}`;

export function vociDaFare(dati: {
  oggi: Date;
  /** `null` = non lette (permesso mancante o errore): la voce non si mostra, e non vale «zero». */
  rate: ReadonlyArray<RataPerDaFare> | null;
  fattureAcquisto: ReadonlyArray<FatturaAcquistoPerDaFare> | null;
  moduliInRitardo: number;
}): VoceDaFare[] {
  const voci: VoceDaFare[] = [];
  const oggi = giorno(dati.oggi);

  if (dati.rate) {
    const aperte = dati.rate.filter((r) => r.stato !== 'incassato' && r.stato !== 'stornata' && residuo(r) > 0);
    const conGiorno = aperte.map((r) => ({ r, quando: giornoDaIso(r.dataScadenza) })).filter((x) => !Number.isNaN(x.quando));
    const scadute = conGiorno.filter((x) => x.quando < oggi);
    const presto = conGiorno.filter((x) => x.quando >= oggi && x.quando <= oggi + GIORNI_PRESTO * 86_400_000);
    if (scadute.length) {
      voci.push({
        chiave: 'rate_scadute', tono: 'urgente',
        testo: `${plurale(scadute.length, 'rata scaduta', 'rate scadute')} da incassare`,
        importoCentesimi: scadute.reduce((t, x) => t + residuo(x.r), 0),
        vaiA: '/scadenzario', etichettaVaiA: 'Apri lo Scadenzario',
      });
    }
    if (presto.length) {
      voci.push({
        chiave: 'rate_in_scadenza', tono: 'presto',
        testo: `${plurale(presto.length, 'rata scade', 'rate scadono')} entro ${GIORNI_PRESTO} giorni`,
        importoCentesimi: presto.reduce((t, x) => t + residuo(x.r), 0),
        vaiA: '/scadenzario', etichettaVaiA: 'Apri lo Scadenzario',
      });
    }
  }

  if (dati.fattureAcquisto) {
    const daPagare = dati.fattureAcquisto.filter((f) => !f.pagata);
    if (daPagare.length) {
      voci.push({
        chiave: 'acquisti_da_pagare', tono: 'info',
        testo: `${plurale(daPagare.length, 'fattura d’acquisto', 'fatture d’acquisto')} da pagare`,
        importoCentesimi: daPagare.reduce((t, f) => t + (f.totaleCentesimi ?? 0), 0),
        vaiA: '/fornitori', etichettaVaiA: 'Apri Fornitori e acquisti',
      });
    }
  }

  if (dati.moduliInRitardo > 0) {
    voci.push({
      chiave: 'moduli_in_ritardo', tono: 'urgente',
      testo: `${plurale(dati.moduliInRitardo, 'modulo in ritardo o con ore sforate', 'moduli in ritardo o con ore sforate')}`,
      vaiA: '/projects', etichettaVaiA: 'Apri i Progetti',
    });
  }

  const ordine = { urgente: 0, presto: 1, info: 2 } as const;
  return voci.sort((a, b) => ordine[a.tono] - ordine[b.tono]);
}
