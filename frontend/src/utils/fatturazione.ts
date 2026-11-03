/**
 * La regola dell'IVA in fattura, in un posto solo e testabile.
 *
 * Prima stava dentro `FatturazioneTab.tsx`, inline nel JSX: giusta, ma non collaudabile senza
 * montare il componente. Qui è una funzione pura, così un test la mette alla prova sui casi che
 * contano (estero, esente, aliquota 0 vera contro «non dichiarata») senza rendering.
 *
 * **Deve combaciare con il backend** (`src/adapters/prisma/prismaApp.ts`, `emettiFattura`): è la
 * stessa regola scritta due volte, e se le due si allontanano l'anteprima mostra un totale che il
 * database poi non conferma — il difetto corretto il 18/09/2026. Il backend resta l'autorità; questo
 * è la copia del browser, tenuta onesta da `fatturazione.test.ts`.
 */

export type TipoClienteFiscale = 'privato_italia' | 'business_italia' | 'estero';

/**
 * L'aliquota da applicare, in percentuale (0..100).
 *
 * Vince quella registrata sul cliente. Se non è dichiarata — `null`/`undefined`, non lo `0` — si
 * ripiega sul tipo del documento: estero 0, altrimenti 22. La distinzione fra «0» e «non dichiarata»
 * è il motivo per cui il parametro è nullable e non un numero con default: un cliente esente ha
 * aliquota 0 *davvero*, e non deve ripiegare sul 22.
 */
export function risolviAliquotaIva(
  aliquotaClienteDefault: number | null | undefined,
  tipoFiscale: TipoClienteFiscale,
): number {
  if (aliquotaClienteDefault === null || aliquotaClienteDefault === undefined) {
    return tipoFiscale === 'estero' ? 0 : 22;
  }
  return Number(aliquotaClienteDefault);
}

export interface TotaliFattura {
  imponibile: number;
  iva: number;
  totale: number;
}

/**
 * Da imponibile e aliquota ai tre numeri della fattura. L'IVA si **somma sopra** l'imponibile: è
 * l'imponibile che l'utente ha scelto, non un lordo da scorporare.
 *
 * Valida per una **riga sola**. Per una fattura di più righe usa `calcolaTotaliFatturaRighe`: il
 * backend arrotonda l'IVA per riga, quindi sommare gli imponibili e arrotondare una volta sola qui
 * produrrebbe un totale che diverge dal documento salvato di un centesimo (era proprio il difetto).
 */
export function calcolaTotaliFattura(imponibile: number, aliquotaPct: number): TotaliFattura {
  return calcolaTotaliFatturaRighe([imponibile], aliquotaPct);
}

/**
 * I totali di una fattura a più righe, **con lo stesso arrotondamento del backend**
 * (`emettiFattura`): ogni riga in centesimi interi, IVA arrotondata **per riga**, poi somma. È
 * l'unico modo perché l'anteprima e il documento salvato mostrino lo stesso totale al centesimo.
 */
export function calcolaTotaliFatturaRighe(imponibiliEuro: number[], aliquotaPct: number): TotaliFattura {
  const imponibileCent = imponibiliEuro.reduce((acc, e) => acc + Math.round(e * 100), 0);
  const ivaCent = imponibiliEuro.reduce((acc, e) => acc + Math.round((Math.round(e * 100) * aliquotaPct) / 100), 0);
  return {
    imponibile: imponibileCent / 100,
    iva: ivaCent / 100,
    totale: (imponibileCent + ivaCent) / 100,
  };
}

/** Una riga del modulo «Nuova fattura», nei campi che contano per i totali. */
export interface RigaAnteprimaFattura {
  quantita?: number;
  prezzoUnitarioCent: number;
  scontoPercentuale?: number;
  aliquotaIva?: number;
  naturaEsenzione?: string | null;
  applicaCassa?: boolean;
  applicaRitenuta?: boolean;
  applicaBollo?: boolean;
}

export interface OpzioniAnteprimaFattura {
  tipoCassa?: string;
  aliquotaCassa?: number;
  aliquotaRitenuta?: number;
  esigibilitaIva?: string;
  applicaBolloVirtuale?: boolean;
}

export interface TotaliAnteprimaFattura {
  totaleImponibileCentesimi: number;
  totaleCassaCentesimi: number;
  totaleIvaCentesimi: number;
  totaleRitenutaCentesimi: number;
  totaleBolloCentesimi: number;
  totaleDocumentoCentesimi: number;
  nettoAPagareCentesimi: number;
}

export const SOGLIA_BOLLO_CENTESIMI = 7747;
export const IMPORTO_BOLLO_CENTESIMI = 200;

/**
 * F8 — I totali del modulo fattura con cassa, ritenuta e bollo: copia passo per passo di
 * `calcolaTotaliFattura` in `src/services/fatturaEngine.ts`, che è quello che salva. La cassa si
 * ripartisce sulle righe e prende la **loro** aliquota (una riga esente non paga IVA sulla cassa),
 * l'IVA si arrotonda per gruppo di aliquota e il bollo scatta sulle righe esenti con natura.
 * `fatturazione.test.ts` confronta i due calcoli sugli stessi input.
 */
export function calcolaTotaliAnteprimaFattura(
  righe: RigaAnteprimaFattura[],
  opzioni: OpzioniAnteprimaFattura = {},
): TotaliAnteprimaFattura {
  const aliquotaCassa = opzioni.aliquotaCassa ?? (opzioni.tipoCassa && opzioni.tipoCassa !== 'nessuna' ? 4 : 0);
  const aliquotaRitenuta = opzioni.aliquotaRitenuta ?? 0;
  const calcolaBolloAuto = opzioni.applicaBolloVirtuale !== false;

  let totaleImponibileCentesimi = 0;
  let soggettoACassa = 0;
  let soggettoARitenuta = 0;
  let esenteBollo = 0;
  const calcolate = righe.map((r) => {
    const qta = r.quantita !== undefined && r.quantita > 0 ? r.quantita : 1;
    const sconto = r.scontoPercentuale && r.scontoPercentuale > 0 ? Math.min(100, r.scontoPercentuale) : 0;
    const imponibile = Math.round(qta * r.prezzoUnitarioCent * (1 - sconto / 100));
    const aliquotaIva = r.aliquotaIva !== undefined ? r.aliquotaIva : 22;
    const applicaCassa = r.applicaCassa !== false;
    const natura = r.naturaEsenzione || null;
    const applicaBollo = r.applicaBollo ?? (aliquotaIva === 0 && Boolean(natura));

    totaleImponibileCentesimi += imponibile;
    if (applicaCassa) soggettoACassa += imponibile;
    if (r.applicaRitenuta !== false) soggettoARitenuta += imponibile;
    if (applicaBollo) esenteBollo += imponibile;
    return { imponibile, aliquotaIva, natura, applicaCassa };
  });

  const totaleCassaCentesimi = aliquotaCassa > 0 ? Math.round(soggettoACassa * (aliquotaCassa / 100)) : 0;

  const gruppi = new Map<string, { aliquotaIva: number; imponibile: number }>();
  for (const r of calcolate) {
    const quotaCassa = soggettoACassa > 0 && r.applicaCassa
      ? Math.round(totaleCassaCentesimi * (r.imponibile / soggettoACassa))
      : 0;
    const chiave = `${r.aliquotaIva}_${r.natura || 'ORD'}`;
    const gruppo = gruppi.get(chiave) ?? { aliquotaIva: r.aliquotaIva, imponibile: 0 };
    gruppo.imponibile += r.imponibile + quotaCassa;
    gruppi.set(chiave, gruppo);
  }
  let totaleIvaCentesimi = 0;
  for (const g of gruppi.values()) {
    totaleIvaCentesimi += g.aliquotaIva > 0 ? Math.round(g.imponibile * (g.aliquotaIva / 100)) : 0;
  }

  const totaleRitenutaCentesimi = aliquotaRitenuta > 0 ? Math.round(soggettoARitenuta * (aliquotaRitenuta / 100)) : 0;
  const totaleBolloCentesimi = calcolaBolloAuto && esenteBollo > SOGLIA_BOLLO_CENTESIMI ? IMPORTO_BOLLO_CENTESIMI : 0;
  const totaleDocumentoCentesimi = totaleImponibileCentesimi + totaleCassaCentesimi + totaleIvaCentesimi + totaleBolloCentesimi;
  const nettoAPagareCentesimi = opzioni.esigibilitaIva === 'split'
    ? totaleDocumentoCentesimi - totaleIvaCentesimi - totaleRitenutaCentesimi
    : totaleDocumentoCentesimi - totaleRitenutaCentesimi;

  return {
    totaleImponibileCentesimi,
    totaleCassaCentesimi,
    totaleIvaCentesimi,
    totaleRitenutaCentesimi,
    totaleBolloCentesimi,
    totaleDocumentoCentesimi,
    nettoAPagareCentesimi,
  };
}
