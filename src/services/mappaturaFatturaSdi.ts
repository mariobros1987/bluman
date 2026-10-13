/**
 * Da una fattura a `DatiFatturaSdiXml`: una sola mappatura, usata sia dalla rotta di
 * download (`GET /invoices/:id/sdi-xml`) sia dal fascicolo ZIP per il commercialista.
 *
 * Esiste per due difetti concreti che nascevano dall'avere due strade diverse:
 *
 * 1. `src/services/fascicoloFiscaleZipEngine.ts` non usava affatto il generatore: si
 *    scriveva l'XML a mano, in un template, con `TipoDocumento` fisso a TD01,
 *    `AliquotaIVA` fissa a 22.00, nessun `DettaglioLinee` e nessun escape delle entità
 *    (un cliente «Rossi & Figli» produceva un XML non valido). Il file dentro lo ZIP
 *    somigliava alla fattura trasmessa a SdI ma non lo era: una nota di credito veniva
 *    esportata come fattura, e un'operazione esente come imponibile al 22%.
 *
 * 2. La rotta usava il generatore giusto ma gli passava un `riepilogoIva` cablato su
 *    una sola riga al 22%, mentre le `linee` portavano l'aliquota vera di ogni riga.
 *    Il blocco `DatiRiepilogo` è quello che SdI valida: una parcella esente ex art. 6
 *    DPR 633/72 dichiarava «22%» con imposta 0,00, che è un rifiuto o, peggio, un
 *    documento fiscalmente falso.
 *
 * Il riepilogo si calcola raggruppando le righe per (aliquota, natura), come prescrive
 * la specifica FatturaPA 1.2: una `DatiRiepilogo` per ogni combinazione presente.
 */

import type { DatiFatturaSdiXml } from './sdiXmlGenerator.js';

/** Solo i campi delle righe che servono al riepilogo e al dettaglio linee. */
export interface RigaFatturaPerSdi {
  descrizione: string;
  quantita?: number | null;
  unitaMisura?: string | null;
  prezzoUnitarioCent?: number | null;
  importo?: number | null;
  imponibileCentesimi?: number | null;
  ivaCentesimi?: number | null;
  aliquotaIva?: number | null;
  naturaEsenzione?: string | null;
  applicaRitenuta?: boolean | null;
  ordine?: number | null;
}

export interface FatturaPerSdi {
  numero?: string | null;
  numeroProgressivoSerie?: number | null;
  data?: Date | null;
  tipoDocumento?: string | null;
  esigibilitaIva?: string | null;
  tipoCassa?: string | null;
  aliquotaCassa?: number | null;
  aliquotaRitenuta?: number | null;
  totaleImponibileCentesimi?: number | null;
  totaleIvaCentesimi?: number | null;
  totaleCassaCentesimi?: number | null;
  totaleRitenutaCentesimi?: number | null;
  totaleBolloCentesimi?: number | null;
  totaleDocumentoCentesimi?: number | null;
  codiceDestinatario?: string | null;
  pecDestinatario?: string | null;
}

export interface ClientePerSdi {
  nome: string;
  piva?: string | null;
  codiceFiscale?: string | null;
  sedeLegale?: string | null;
  sdiCode?: string | null;
}

export interface StudioPerSdi {
  ragioneSociale?: string | null;
  piva?: string | null;
  codiceFiscale?: string | null;
  sedeLegale?: string | null;
  regimeFiscale?: string | null;
  iban?: string | null;
}

/** `I` immediata, `D` differita, `S` scissione dei pagamenti (split payment). */
export function codiceEsigibilitaIva(esigibilita?: string | null): 'I' | 'D' | 'S' {
  if (esigibilita === 'split') return 'S';
  if (esigibilita === 'differita') return 'D';
  return 'I';
}

/**
 * Riepilogo IVA per (aliquota, natura), sommando gli importi già calcolati sulle righe.
 *
 * Se le righe non ci sono — fatture storiche caricate prima della riforma, dove i
 * totali stanno solo in testa al documento — si ripiega su un'unica riga costruita con
 * i totali della fattura, e l'aliquota si *deduce* da imposta/imponibile invece di
 * essere assunta: 0 imposta su imponibile positivo significa 0%, non 22%.
 */
export function calcolaRiepilogoIvaDaRighe(
  righe: RigaFatturaPerSdi[],
  fattura: Pick<FatturaPerSdi, 'totaleImponibileCentesimi' | 'totaleIvaCentesimi' | 'esigibilitaIva'>,
): DatiFatturaSdiXml['riepilogoIva'] {
  const esigibilita = codiceEsigibilitaIva(fattura.esigibilitaIva);

  if (righe.length > 0) {
    const gruppi = new Map<string, { aliquotaIva: number; natura: string | null; imponibileCent: number; impostaCent: number }>();

    for (const r of righe) {
      const aliquota = r.aliquotaIva ?? 0;
      // Natura (N1…N7) solo dove ha senso: con aliquota diversa da zero SdI la rifiuta.
      const natura = aliquota === 0 ? r.naturaEsenzione || null : null;
      const chiave = `${aliquota}|${natura ?? ''}`;
      const corrente = gruppi.get(chiave) || { aliquotaIva: aliquota, natura, imponibileCent: 0, impostaCent: 0 };
      corrente.imponibileCent += r.imponibileCentesimi ?? r.importo ?? 0;
      gruppi.set(chiave, corrente);
    }

    return [...gruppi.values()]
      .sort((a, b) => a.aliquotaIva - b.aliquotaIva)
      .map(g => ({
        aliquotaIva: g.aliquotaIva,
        natura: g.natura,
        imponibileImporto: g.imponibileCent / 100,
        // Imposta del riepilogo calcolata sull'imponibile TOTALE del gruppo (come fatturaEngine.ts),
        // non sommando i per-riga arrotondati: sommarli produce uno scarto fino a ±1 cent fra
        // Imponibile e Imposta che SDI rifiuta (difetto B1). DatiRiepilogo dev'essere coerente col totale.
        imposta: (g.aliquotaIva > 0 ? Math.round(g.imponibileCent * (g.aliquotaIva / 100)) : 0) / 100,
        esigibilitaIva: esigibilita,
      }));
  }

  const imponibileCent = fattura.totaleImponibileCentesimi || 0;
  const impostaCent = fattura.totaleIvaCentesimi || 0;
  const aliquotaDedotta = imponibileCent > 0 ? Math.round((impostaCent / imponibileCent) * 100) : 0;

  return [
    {
      aliquotaIva: aliquotaDedotta,
      natura: null,
      imponibileImporto: imponibileCent / 100,
      imposta: impostaCent / 100,
      esigibilitaIva: esigibilita,
    },
  ];
}

/** Tutto quello che serve al generatore, in un unico punto di verità. */
export function costruisciDatiFatturaSdi(input: {
  fattura: FatturaPerSdi;
  righe: RigaFatturaPerSdi[];
  cliente: ClientePerSdi;
  studio: StudioPerSdi | null;
  ibanAccredito?: string | null;
  fatturaOrigineNumero?: string | null;
  fatturaOrigineData?: Date | null;
}): DatiFatturaSdiXml {
  const { fattura, righe, cliente, studio } = input;
  const righeOrdinate = [...righe].sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));

  return {
    progressivoInvio: String(fattura.numeroProgressivoSerie || 1).padStart(5, '0'),
    codiceDestinatario: fattura.codiceDestinatario || cliente.sdiCode || '0000000',
    pecDestinatario: fattura.pecDestinatario ?? null,

    // §7 — qui c'era `studio?.ragioneSociale || 'Studio Advisory'`: uno studio **inventato**, con
    // tanto di nome plausibile, come denominazione del cedente su una fattura elettronica. Se la
    // ragione sociale manca, il documento non si compone: la stringa vuota fa fallire l'XML invece
    // di fargli dire il falso, e il controllo in `src/domain/anagraficaStudio.ts` rifiuta prima.
    cedenteDenominazione: studio?.ragioneSociale || '',
    cedentePiva: studio?.piva ?? null,
    cedenteCodiceFiscale: studio?.codiceFiscale || studio?.piva || null,
    cedenteSedeIndirizzo: studio?.sedeLegale ?? null,
    // Stessa storia del nome: `|| 'RF01'` dichiarava «regime ordinario» per chiunque non l'avesse
    // indicato, e RF01 su uno studio forfettario o estero è un regime fiscale falso in un atto
    // fiscale. Vuoto: l'XML non è valido e si vede, che è meglio di un XML valido e sbagliato.
    cedenteRegimeFiscale: studio?.regimeFiscale || '',

    cessionarioDenominazione: cliente.nome,
    cessionarioPiva: cliente.piva ?? null,
    cessionarioCodiceFiscale: cliente.codiceFiscale ?? null,
    cessionarioIndirizzo: cliente.sedeLegale ?? null,

    // Il tipo documento viene dalla fattura, non è assunto: una nota di credito è TD04.
    tipoDocumento: fattura.tipoDocumento === 'nota_credito' ? 'TD04' : 'TD01',
    data: (fattura.data || new Date()).toISOString().split('T')[0] || '',
    numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie ?? ''}`,
    importoTotaleDocumento: (fattura.totaleDocumentoCentesimi || 0) / 100,

    tipoCassa: fattura.tipoCassa && fattura.tipoCassa !== 'nessuna' ? 'TC22' : undefined,
    aliquotaCassa: fattura.aliquotaCassa || undefined,
    importoContributoCassa: fattura.totaleCassaCentesimi ? fattura.totaleCassaCentesimi / 100 : undefined,
    tipoRitenuta: 'RT01',
    importoRitenuta: fattura.totaleRitenutaCentesimi ? fattura.totaleRitenutaCentesimi / 100 : undefined,
    aliquotaRitenuta: fattura.aliquotaRitenuta || undefined,
    bolloVirtuale: (fattura.totaleBolloCentesimi || 0) > 0,
    importoBollo: (fattura.totaleBolloCentesimi || 0) / 100,

    linee: righeOrdinate.map((r, idx) => ({
      numeroLinea: idx + 1,
      descrizione: r.descrizione,
      quantita: r.quantita ?? undefined,
      unitaMisura: r.unitaMisura ?? undefined,
      prezzoUnitario: (r.prezzoUnitarioCent || r.importo || 0) / 100,
      prezzoTotale: (r.imponibileCentesimi || r.importo || 0) / 100,
      aliquotaIva: r.aliquotaIva ?? 0,
      natura: (r.aliquotaIva ?? 0) === 0 ? r.naturaEsenzione ?? null : null,
      ritenuta: r.applicaRitenuta ?? false,
    })),

    riepilogoIva: calcolaRiepilogoIvaDaRighe(righeOrdinate, fattura),

    fatturaCollegataNumero: input.fatturaOrigineNumero ?? null,
    fatturaCollegataData: input.fatturaOrigineData ? input.fatturaOrigineData.toISOString().split('T')[0] : null,
    iban: input.ibanAccredito || studio?.iban || null,
  };
}
