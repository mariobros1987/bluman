import PizZip from 'pizzip';
import { prisma } from '../util/prismaClient.js';
import { calcolaLiquidazioneIvaPeriodo, getCodiceTributoIva } from './lipeEngine.js';
import { generaFatturaElettronicaXml } from './sdiXmlGenerator.js';
import { costruisciDatiFatturaSdi } from './mappaturaFatturaSdi.js';

/**
 * Escape per i campi CSV.
 *
 * Le virgolette raddoppiate non bastano: un valore che comincia con `=`, `+`, `-` o `@`
 * viene interpretato come formula da Excel e da LibreOffice quando il commercialista
 * apre il file. Una descrizione di riga può cominciare con `-` in perfetta buona fede, e
 * `=cmd|…` in cattiva fede. Si premette un apice, che i fogli di calcolo trattano come
 * «questo è testo».
 */
function campoCsv(valore: string | null | undefined): string {
  const testo = (valore ?? '').replace(/\r?\n/g, ' ');
  const disinnescato = /^[=+\-@\t\r]/.test(testo) ? `'${testo}` : testo;
  return `"${disinnescato.replace(/"/g, '""')}"`;
}

/** Nome file sicuro dentro lo ZIP: nessun separatore, nessun `..`, niente accenti. */
function nomeFileSicuro(valore: string, lunghezzaMax = 40): string {
  return (valore || 'documento').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, lunghezzaMax) || 'documento';
}

export interface ParametriFascicoloFiscale {
  tenantId: string;
  anno: number;
  tipo: 'mensile' | 'trimestrale' | 'annuale';
  mese?: number;
  trimestre?: number;
}

export interface RisultatoFascicoloFiscale {
  buffer: Buffer;
  nomeFile: string;
  conteggioFattureAttive: number;
  conteggioFatturePassive: number;
  conteggioMovimentiPrimaNota: number;
  /** XML del ciclo attivo effettivamente scritti nello ZIP (le bozze non ne hanno). */
  conteggioXmlAttiviGenerati: number;
  conteggioBozzeEscluseDaXml: number;
  /** XML d'acquisto allegati: solo quelli che il fornitore ci ha trasmesso davvero. */
  conteggioXmlPassiviAllegati: number;
  totaleImponibileVenditeEuro: number;
  totaleIvaVenditeEuro: number;
  totaleImponibileAcquistiEuro: number;
  totaleIvaAcquistiEuro: number;
  saldoIvaEuro: number;
}

/** L'anteprima è lo stesso conto senza lo ZIP: nessun XML generato, nessun DEFLATE. */
export type AnteprimaFascicoloFiscale = Omit<RisultatoFascicoloFiscale, 'buffer'>;

/**
 * Raccolta dei dati: intervallo, query, LIPE, totali, conteggi.
 *
 * Sta in una funzione a parte perché l'anteprima ha bisogno esattamente di questi numeri
 * e di nient'altro: prima chiamava `generaFascicoloFiscaleZip` e ne scartava il `buffer`,
 * cioè rigenerava ogni XML FatturaPA e comprimeva in DEFLATE un archivio intero per poi
 * buttarlo via. Su un export annuale è lavoro sprecato proporzionale al numero di fatture,
 * ripetibile da chiunque abbia il token semplicemente ricaricando la pagina.
 */
async function raccogliDatiFascicolo(params: ParametriFascicoloFiscale) {
  const { tenantId, anno, tipo, mese, trimestre } = params;

  // 1. Calcola intervallo temporale
  let dataInizio: Date;
  let dataFine: Date;
  let etichettaPeriodo: string;
  let periodoStr: string;

  if (tipo === 'mensile') {
    const m = mese && mese >= 1 && mese <= 12 ? mese : 1;
    dataInizio = new Date(Date.UTC(anno, m - 1, 1, 0, 0, 0, 0));
    dataFine = new Date(Date.UTC(anno, m, 0, 23, 59, 59, 999));
    etichettaPeriodo = `Mese_${String(m).padStart(2, '0')}_${anno}`;
    periodoStr = `${anno}-${String(m).padStart(2, '0')}`;
  } else if (tipo === 'trimestrale') {
    const t = trimestre && trimestre >= 1 && trimestre <= 4 ? trimestre : 1;
    const startMonth = (t - 1) * 3;
    const endMonth = startMonth + 3;
    dataInizio = new Date(Date.UTC(anno, startMonth, 1, 0, 0, 0, 0));
    dataFine = new Date(Date.UTC(anno, endMonth, 0, 23, 59, 59, 999));
    etichettaPeriodo = `Trimestre_T${t}_${anno}`;
    periodoStr = `${anno}-Q${t}`;
  } else {
    dataInizio = new Date(Date.UTC(anno, 0, 1, 0, 0, 0, 0));
    dataFine = new Date(Date.UTC(anno, 12, 0, 23, 59, 59, 999));
    etichettaPeriodo = `Anno_${anno}`;
    periodoStr = `${anno}-12`;
  }

  // 2. Lettura dati Studio / Tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });
  const studioNome = tenant?.ragioneSociale || 'Studio_Advisory';
  const studioPiva = tenant?.piva || 'N/D';
  const studioCf = tenant?.codiceFiscale || 'N/D';

  // 3. Estrazione Fatture Attive (Vendite)
  const fattureAttive = await prisma.fattura.findMany({
    where: {
      tenantId,
      data: { gte: dataInizio, lte: dataFine },
    },
    include: {
      cliente: true,
      progetto: { include: { cliente: true } },
      righe: true,
    },
    orderBy: [{ data: 'asc' }, { numeroProgressivoSerie: 'asc' }],
  });

  // 4. Estrazione Fatture Passive (Acquisti)
  const fatturePassive = await prisma.fatturaRicevuta.findMany({
    where: {
      tenantId,
      data: { gte: dataInizio, lte: dataFine },
    },
    include: {
      fornitore: true,
    },
    orderBy: [{ data: 'asc' }, { numero: 'asc' }],
  });

  // 5. Calcolo LIPE Periodico
  const lipeResult = calcolaLiquidazioneIvaPeriodo(
    periodoStr,
    fattureAttive.map((f) => ({
      totaleImponibileCentesimi: f.totaleImponibileCentesimi || 0,
      totaleIvaCentesimi: f.totaleIvaCentesimi || 0,
      stato: f.stato,
      esigibilitaIva: f.esigibilitaIva || 'immediata',
    })),
    fatturePassive.map((fp) => ({
      imponibileCentesimi: fp.imponibileCentesimi || 0,
      ivaCentesimi: fp.ivaCentesimi || 0,
      esigibilitaIva: fp.esigibilitaIva || 'immediata',
    }))
  );

  const codiceTributoF24 = lipeResult.prospettoF24.righe[0]?.codiceTributo || getCodiceTributoIva(lipeResult.periodo).codice;
  const scadenzaVersamento = tipo === 'trimestrale'
    ? (trimestre === 1 ? `16/05/${anno}` : trimestre === 2 ? `16/08/${anno}` : trimestre === 3 ? `16/11/${anno}` : `16/03/${anno + 1}`)
    : (mese === 12 ? `16/01/${anno + 1}` : `16/${String((mese || 1) + 1).padStart(2, '0')}/${anno}`);

  // 6. Estrazione Movimenti Prima Nota
  const movimenti = await prisma.movimentoPrimaNota.findMany({
    where: {
      tenantId,
      data: { gte: dataInizio, lte: dataFine },
    },
    include: {
      contoBancario: true,
      fattura: true,
      fatturaRicevuta: true,
    },
    orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
  });

  // 7. Calcoli di sintesi
  const totaleImponibileVenditeEuro = fattureAttive.reduce((acc, f) => acc + (f.totaleImponibileCentesimi || 0) / 100, 0);
  const totaleIvaVenditeEuro = fattureAttive.reduce((acc, f) => acc + (f.totaleIvaCentesimi || 0) / 100, 0);
  const totaleImponibileAcquistiEuro = fatturePassive.reduce((acc, f) => acc + (f.imponibileCentesimi || 0) / 100, 0);
  const totaleIvaAcquistiEuro = fatturePassive.reduce((acc, f) => acc + (f.ivaCentesimi || 0) / 100, 0);
  const saldoIvaEuro = lipeResult.importoDaVersareCent > 0
    ? lipeResult.importoDaVersareCent / 100
    : -(lipeResult.creditoRiportabileCent / 100);

  // Il nome del file si calcola qui perché anche l'anteprima lo mostra: una sola copia
  // della regola di sanificazione, così il nome annunciato è quello scaricato.
  const nomeFile = `Fascicolo_Fiscale_${studioNome.replace(/[^a-zA-Z0-9_-]/g, '_')}_${etichettaPeriodo}.zip`;

  return {
    dataInizio,
    dataFine,
    etichettaPeriodo,
    tenant,
    studioNome,
    studioPiva,
    studioCf,
    nomeFile,
    fattureAttive,
    fatturePassive,
    movimenti,
    lipeResult,
    codiceTributoF24,
    scadenzaVersamento,
    totaleImponibileVenditeEuro,
    totaleIvaVenditeEuro,
    totaleImponibileAcquistiEuro,
    totaleIvaAcquistiEuro,
    saldoIvaEuro,
  };
}

/**
 * Conteggi e totali del periodo senza costruire l'archivio: è quello che serve alla rotta
 * `GET /contabilita/anteprima-fascicolo-commercialista`.
 */
export async function calcolaAnteprimaFascicoloFiscale(
  params: ParametriFascicoloFiscale,
): Promise<AnteprimaFascicoloFiscale> {
  const d = await raccogliDatiFascicolo(params);

  // Gli stessi criteri applicati dal builder, espressi come filtri: una bozza non ha XML
  // (non è un documento fiscale) e una fattura senza cliente risolvibile non è mappabile
  // su FatturaPA. Se questi criteri cambiano lì, vanno cambiati anche qui.
  const bozze = d.fattureAttive.filter((f) => f.stato === 'bozza').length;
  const attiveConXml = d.fattureAttive.filter(
    (f) => f.stato !== 'bozza' && Boolean(f.cliente || f.progetto?.cliente),
  ).length;

  return {
    nomeFile: d.nomeFile,
    conteggioFattureAttive: d.fattureAttive.length,
    conteggioFatturePassive: d.fatturePassive.length,
    conteggioMovimentiPrimaNota: d.movimenti.length,
    conteggioXmlAttiviGenerati: attiveConXml,
    conteggioBozzeEscluseDaXml: bozze,
    conteggioXmlPassiviAllegati: d.fatturePassive.filter((fp) => Boolean(fp.xmlSdiRaw)).length,
    totaleImponibileVenditeEuro: d.totaleImponibileVenditeEuro,
    totaleIvaVenditeEuro: d.totaleIvaVenditeEuro,
    totaleImponibileAcquistiEuro: d.totaleImponibileAcquistiEuro,
    totaleIvaAcquistiEuro: d.totaleIvaAcquistiEuro,
    saldoIvaEuro: d.saldoIvaEuro,
  };
}

export async function generaFascicoloFiscaleZip(
  params: ParametriFascicoloFiscale,
): Promise<RisultatoFascicoloFiscale> {
  const { anno } = params;
  const {
    dataInizio, dataFine, etichettaPeriodo, tenant, studioNome, studioPiva, studioCf, nomeFile,
    fattureAttive, fatturePassive, movimenti, lipeResult, codiceTributoF24, scadenzaVersamento,
    totaleImponibileVenditeEuro, totaleIvaVenditeEuro, totaleImponibileAcquistiEuro,
    totaleIvaAcquistiEuro, saldoIvaEuro,
  } = await raccogliDatiFascicolo(params);

  // 8. Creazione ZIP
  const zip = new PizZip();

  // L'indice si compila in fondo (§ «00_INDICE» più sotto), quando i conteggi degli XML
  // effettivamente scritti sono noti: un indice che promette N file XML e ne consegna N-3
  // è peggio di nessun indice, perché il commercialista non sa quali mancano.

  // ─── 01_Fatture_Attive_Vendite ───────────────────────────────────────
  const csvAttiveRighe = [
    ['Data', 'Tipo', 'Serie', 'Numero', 'Cliente', 'P.IVA/CF', 'Imponibile_EUR', 'IVA_EUR', 'Totale_EUR', 'Stato'].join(';'),
  ];
  let xmlAttiveGenerati = 0;
  let bozzeEscluseDaXml = 0;

  for (const f of fattureAttive) {
    const clienteFattura = f.cliente || f.progetto?.cliente || null;
    const nomeCli = clienteFattura?.nome || 'Cliente';
    const pivaCli = clienteFattura?.piva || clienteFattura?.codiceFiscale || '';
    const imp = ((f.totaleImponibileCentesimi || 0) / 100).toFixed(2);
    const iva = ((f.totaleIvaCentesimi || 0) / 100).toFixed(2);
    const tot = ((f.totaleDocumentoCentesimi || 0) / 100).toFixed(2);
    const dataStr = f.data ? f.data.toISOString().split('T')[0] : '';
    csvAttiveRighe.push([
      dataStr,
      f.tipoDocumento,
      f.serie,
      String(f.numeroProgressivoSerie),
      campoCsv(nomeCli),
      campoCsv(pivaCli),
      imp,
      iva,
      tot,
      f.stato,
    ].join(';'));

    // Una bozza non è un documento fiscale: non ha numerazione definitiva e non è stata
    // trasmessa. Metterne l'XML nella cartella delle fatture emesse la farebbe sembrare
    // tale al commercialista. Resta nel CSV, con la sua colonna `Stato`, dove è leggibile
    // per quello che è.
    if (f.stato === 'bozza') {
      bozzeEscluseDaXml += 1;
      continue;
    }

    // L'XML NON si scrive a mano qui. Prima lo era, con TipoDocumento fisso a TD01,
    // AliquotaIVA fissa a 22.00, nessun DettaglioLinee e nessun escape delle entità:
    // una nota di credito veniva esportata come fattura e un'esenzione come 22%. Ora
    // passa dallo stesso generatore della rotta `GET /invoices/:id/sdi-xml`.
    if (!clienteFattura) continue;

    const xmlContenuto = generaFatturaElettronicaXml(
      costruisciDatiFatturaSdi({
        fattura: f,
        righe: f.righe,
        cliente: clienteFattura,
        studio: tenant,
      }),
    );
    const nomeFileXml = `${f.serie === 'NC' ? 'NotaCredito' : 'Fattura'}_${nomeFileSicuro(f.serie, 8)}_${String(f.numeroProgressivoSerie).padStart(4, '0')}.xml`;
    zip.file(`01_Fatture_Attive_Vendite/${nomeFileXml}`, xmlContenuto);
    xmlAttiveGenerati += 1;
  }
  zip.file('01_Fatture_Attive_Vendite/Registro_Fatture_Vendite.csv', csvAttiveRighe.join('\r\n'));

  // ─── 02_Fatture_Passive_Acquisti ─────────────────────────────────────
  const csvPassiveRighe = [
    ['Data', 'Numero', 'Fornitore', 'P.IVA/CF', 'Imponibile_EUR', 'IVA_EUR', 'Totale_EUR', 'Esigibilita_IVA', 'Pagata'].join(';'),
  ];
  let xmlPassiveAllegati = 0;

  for (const fp of fatturePassive) {
    const nomeForn = fp.fornitore?.ragioneSociale || 'Fornitore';
    const pivaForn = fp.fornitore?.partitaIva || fp.fornitore?.codiceFiscale || '';
    const imp = ((fp.imponibileCentesimi || 0) / 100).toFixed(2);
    const iva = ((fp.ivaCentesimi || 0) / 100).toFixed(2);
    const tot = ((fp.totaleCentesimi || 0) / 100).toFixed(2);
    const dataStr = fp.data ? fp.data.toISOString().split('T')[0] : '';
    csvPassiveRighe.push([
      dataStr,
      campoCsv(fp.numero),
      campoCsv(nomeForn),
      campoCsv(pivaForn),
      imp,
      iva,
      tot,
      fp.esigibilitaIva,
      fp.pagata ? 'SI' : 'NO',
    ].join(';'));

    // Il ciclo passivo allega l'XML SOLO se il fornitore ce l'ha mandato davvero: qui non
    // si ricostruisce niente, perché un XML d'acquisto sintetizzato da noi non sarebbe il
    // documento che il fornitore ha trasmesso a SdI.
    if (fp.xmlSdiRaw) {
      zip.file(
        `02_Fatture_Passive_Acquisti/Acquisto_${nomeFileSicuro(fp.numero, 30)}_${nomeFileSicuro(nomeForn, 20)}.xml`,
        fp.xmlSdiRaw,
      );
      xmlPassiveAllegati += 1;
    }
  }
  zip.file('02_Fatture_Passive_Acquisti/Registro_Fatture_Acquisti.csv', csvPassiveRighe.join('\r\n'));

  // ─── 03_Liquidazione_IVA_LIPE ────────────────────────────────────────
  const csvLipeRighe = [
    ['Quadro_Rigo', 'Descrizione', 'Importo_EUR'].join(';'),
    ['VP4', 'IVA esigibile su vendite del periodo', (lipeResult.ivaDebitoCent / 100).toFixed(2)].join(';'),
    ['VP5', 'IVA detratta su acquisti del periodo', (lipeResult.ivaCreditoCent / 100).toFixed(2)].join(';'),
    ['VP6', 'IVA dovuta / (credito del periodo)', (lipeResult.saldoIvaCent / 100).toFixed(2)].join(';'),
    ['F24_VERSAMENTO', 'TOTALE DA VERSARE A DEBITO', (lipeResult.importoDaVersareCent / 100).toFixed(2)].join(';'),
    ['F24_CREDITO', 'TOTALE CREDITO IVA DA RIPORTARE', (lipeResult.creditoRiportabileCent / 100).toFixed(2)].join(';'),
    // Qui mancava `.join(';')`: la riga finiva nel CSV separata da virgole invece che da
    // punto e virgola, cioè in una sola cella per chi apriva il file.
    ['F24_CODICE_TRIBUTO', 'Codice tributo Modello F24', codiceTributoF24].join(';'),
    ['F24_ANNO', 'Anno di riferimento F24', String(anno)].join(';'),
    ['F24_SCADENZA', 'Data scadenza versamento', scadenzaVersamento].join(';'),
  ];
  zip.file(`03_Liquidazione_IVA_LIPE/Prospetto_LIPE_F24_${etichettaPeriodo}.csv`, csvLipeRighe.join('\r\n'));

  const testoLipe = [
    `PROSPETTO LIQUIDAZIONE IVA PERIODICA (LIPE) & MODELLO F24`,
    `Studio: ${studioNome} (P.IVA: ${studioPiva})`,
    `Periodo: ${etichettaPeriodo}`,
    `--------------------------------------------------------------------------------`,
    `• Totale IVA a debito (VP4):              € ${(lipeResult.ivaDebitoCent / 100).toFixed(2)}`,
    `• Totale IVA a credito (VP5):             € ${(lipeResult.ivaCreditoCent / 100).toFixed(2)}`,
    `• Saldo IVA del periodo:                  € ${(lipeResult.saldoIvaCent / 100).toFixed(2)} (${lipeResult.stato.toUpperCase()})`,
    `--------------------------------------------------------------------------------`,
    `• IMPORTO DA VERSARE IN F24:              € ${(lipeResult.importoDaVersareCent / 100).toFixed(2)}`,
    `• Codice Tributo F24 Erario:              ${codiceTributoF24}`,
    `• Scadenza Ordinaria Modello F24:         ${scadenzaVersamento}`,
    `• Credito IVA residuo da riportare:       € ${(lipeResult.creditoRiportabileCent / 100).toFixed(2)}`,
  ].filter(Boolean).join('\r\n');
  zip.file(`03_Liquidazione_IVA_LIPE/Prospetto_LIPE_F24_${etichettaPeriodo}.txt`, testoLipe);

  // ─── 04_Prima_Nota_Cassa_Banca ───────────────────────────────────────
  const csvPrimaNota = [
    ['Data', 'Tipo', 'Conto_Banca', 'Descrizione', 'Entrata_EUR', 'Uscita_EUR', 'Metodo', 'CRO_TRN', 'Riferimento_Fattura'].join(';'),
  ];
  let totaleEntrateCent = 0;
  let totaleUsciteCent = 0;

  for (const m of movimenti) {
    const dataStr = m.data ? m.data.toISOString().split('T')[0] : '';
    const conto = m.contoBancario?.nomeConto || 'Cassa Studio';
    const entrata = m.tipo === 'entrata' ? ((m.importoCentesimi || 0) / 100).toFixed(2) : '0.00';
    const uscita = m.tipo === 'uscita' ? ((m.importoCentesimi || 0) / 100).toFixed(2) : '0.00';
    if (m.tipo === 'entrata') totaleEntrateCent += m.importoCentesimi || 0;
    if (m.tipo === 'uscita') totaleUsciteCent += m.importoCentesimi || 0;
    const rif = m.fattura ? `FT ${m.fattura.serie}/${m.fattura.numeroProgressivoSerie}` : m.fatturaRicevuta ? `Fatt. Acquisto ${m.fatturaRicevuta.numero}` : '';
    csvPrimaNota.push([
      dataStr,
      m.tipo,
      campoCsv(conto),
      campoCsv(m.descrizione),
      entrata,
      uscita,
      // `metodoPagamento` è un enum NOT NULL con default `bonifico` in schema.prisma: il
      // vecchio `|| 'bonifico'` non poteva scattare e lasciava credere il contrario.
      m.metodoPagamento,
      campoCsv(m.riferimentoTransazione),
      campoCsv(rif),
    ].join(';'));
  }
  zip.file(`04_Prima_Nota_Cassa_Banca/Prima_Nota_${etichettaPeriodo}.csv`, csvPrimaNota.join('\r\n'));

  // ─── 00_INDICE ───────────────────────────────────────────────────────
  // Si compila qui in fondo perché solo adesso i conteggi sono un fatto e non una promessa.
  const passiveSenzaXml = fatturePassive.length - xmlPassiveAllegati;
  const indiceTesto = [
    'FASCICOLO FISCALE PER IL COMMERCIALISTA',
    '='.repeat(80),
    `Studio:         ${studioNome}`,
    `Partita IVA:    ${studioPiva}`,
    `Codice Fiscale: ${studioCf}`,
    `Periodo:        ${etichettaPeriodo}  (dal ${dataInizio.toISOString().slice(0, 10)} al ${dataFine.toISOString().slice(0, 10)})`,
    `Generato il:    ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    '',
    '01_Fatture_Attive_Vendite/',
    `  Registro_Fatture_Vendite.csv — ${fattureAttive.length} documenti registrati nel periodo`,
    `  ${xmlAttiveGenerati} file XML in formato FatturaPA 1.2`,
    bozzeEscluseDaXml > 0
      ? `  ${bozzeEscluseDaXml} documento/i in stato «bozza» stanno nel CSV ma NON hanno XML: senza numerazione definitiva e senza trasmissione non sono documenti fiscali.`
      : '  Nessun documento in bozza nel periodo.',
    '  Gli XML sono rigenerati dai dati a database con lo stesso generatore usato per la',
    '  trasmissione a SdI: rappresentano il documento registrato, non sostituiscono la',
    '  copia conservata a norma.',
    '',
    '02_Fatture_Passive_Acquisti/',
    `  Registro_Fatture_Acquisti.csv — ${fatturePassive.length} fatture ricevute nel periodo`,
    `  ${xmlPassiveAllegati} XML originali del fornitore allegati`,
    passiveSenzaXml > 0
      ? `  ${passiveSenzaXml} fattura/e senza XML allegato, perché il file del fornitore non è a sistema. Non viene ricostruito: un XML d'acquisto sintetizzato da noi non sarebbe il documento trasmesso a SdI.`
      : "  Tutte le fatture ricevute hanno l'XML originale allegato.",
    '',
    '03_Liquidazione_IVA_LIPE/',
    `  Prospetto_LIPE_F24_${etichettaPeriodo}.csv  /  .txt`,
    `  IVA a debito (VP4):  € ${(lipeResult.ivaDebitoCent / 100).toFixed(2)}`,
    `  IVA a credito (VP5): € ${(lipeResult.ivaCreditoCent / 100).toFixed(2)}`,
    `  Saldo del periodo:   € ${(lipeResult.saldoIvaCent / 100).toFixed(2)} (${lipeResult.stato})`,
    `  Da versare in F24:   € ${(lipeResult.importoDaVersareCent / 100).toFixed(2)}`,
    `  Credito riportabile: € ${(lipeResult.creditoRiportabileCent / 100).toFixed(2)}`,
    `  Codice tributo F24:  ${codiceTributoF24} — scadenza ${scadenzaVersamento}`,
    '',
    '04_Prima_Nota_Cassa_Banca/',
    `  Prima_Nota_${etichettaPeriodo}.csv — ${movimenti.length} movimenti`,
    `  Totale entrate: € ${(totaleEntrateCent / 100).toFixed(2)}  —  Totale uscite: € ${(totaleUsciteCent / 100).toFixed(2)}`,
    '',
    '='.repeat(80),
    'Documento generato automaticamente dalla piattaforma Bluman Advisory.',
  ].join('\r\n');
  zip.file('00_INDICE_FASCICOLO_FISCALE.txt', indiceTesto);

  // Genera buffer ZIP
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  return {
    buffer,
    nomeFile,
    conteggioFattureAttive: fattureAttive.length,
    conteggioFatturePassive: fatturePassive.length,
    conteggioMovimentiPrimaNota: movimenti.length,
    conteggioXmlAttiviGenerati: xmlAttiveGenerati,
    conteggioBozzeEscluseDaXml: bozzeEscluseDaXml,
    conteggioXmlPassiviAllegati: xmlPassiveAllegati,
    totaleImponibileVenditeEuro,
    totaleIvaVenditeEuro,
    totaleImponibileAcquistiEuro,
    totaleIvaAcquistiEuro,
    saldoIvaEuro,
  };
}
