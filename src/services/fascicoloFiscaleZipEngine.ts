import PizZip from 'pizzip';
import { prisma } from '../util/prismaClient.js';
import { calcolaLiquidazioneIvaPeriodo, getCodiceTributoIva } from './lipeEngine.js';

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
  totaleImponibileVenditeEuro: number;
  totaleIvaVenditeEuro: number;
  totaleImponibileAcquistiEuro: number;
  totaleIvaAcquistiEuro: number;
  saldoIvaEuro: number;
}

export async function generaFascicoloFiscaleZip(params: ParametriFascicoloFiscale): Promise<RisultatoFascicoloFiscale> {
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

  // 8. Creazione ZIP
  const zip = new PizZip();

  // ─── 00_INDICE_FASCICOLO_FISCALE.txt ─────────────────────────────────
  const indiceTesto = [
    `================================================================================`,
    `FASCICOLO FISCALE & CONTABILE UNIFICATO PER IL COMMERCIALISTA`,
    `BLUMAN ADVISORY PLATFORM — ERP GRADE COMPLIANCE`,
    `================================================================================`,
    `Studio Professionale:  ${studioNome}`,
    `Partita IVA:           ${studioPiva}`,
    `Codice Fiscale:        ${studioCf}`,
    `Periodo Fiscale:       ${etichettaPeriodo}`,
    `Intervallo Date:       ${dataInizio.toISOString().split('T')[0]} ➔ ${dataFine.toISOString().split('T')[0]}`,
    `Data Generazione ZIP:  ${new Date().toISOString()}`,
    `================================================================================`,
    ``,
    `RIASSUNTO FISCALE DI PERIODO:`,
    `--------------------------------------------------------------------------------`,
    `• FATTURE ATTIVE (VENDITE):        N. ${fattureAttive.length}`,
    `  - Totale Imponibile:             € ${totaleImponibileVenditeEuro.toFixed(2)}`,
    `  - Totale IVA a Debito:           € ${totaleIvaVenditeEuro.toFixed(2)}`,
    ``,
    `• FATTURE PASSIVE (ACQUISTI):      N. ${fatturePassive.length}`,
    `  - Totale Imponibile:             € ${totaleImponibileAcquistiEuro.toFixed(2)}`,
    `  - Totale IVA Detraibile:         € ${totaleIvaAcquistiEuro.toFixed(2)}`,
    ``,
    `• LIQUIDAZIONE IVA & PROSPETTO F24:`,
    `  - IVA a Debito:                  € ${(lipeResult.ivaDebitoCent / 100).toFixed(2)}`,
    `  - IVA Detraibile:                € ${(lipeResult.ivaCreditoCent / 100).toFixed(2)}`,
    `  - Esito Liquidazione:            ${lipeResult.stato.toUpperCase()}`,
    `  - Importo Saldo:                 € ${(lipeResult.saldoIvaCent / 100).toFixed(2)}`,
    `  - TOTALE F24 DA VERSARE:         € ${(lipeResult.importoDaVersareCent / 100).toFixed(2)}`,
    `  - Codice Tributo F24 Suggerito:  ${codiceTributoF24}`,
    `  - Scadenza Versamento Ordinaria: ${scadenzaVersamento}`,
    ``,
    `• REGISTRO PRIMA NOTA:`,
    `  - Numero Movimenti Riconciliati: ${movimenti.length}`,
    ``,
    `STRUTTURA CARTELLE ARCHIVIO ZIP:`,
    `--------------------------------------------------------------------------------`,
    `01_Fatture_Attive_Vendite/     -> File XML SDI e Registro Vendite CSV`,
    `02_Fatture_Passive_Acquisti/   -> File XML SDI fornitore e Registro Acquisti CSV`,
    `03_Liquidazione_IVA_LIPE/      -> Prospetto LIPE e Modello F24 (CSV e TXT)`,
    `04_Prima_Nota_Cassa_Banca/     -> Registro Cassa/Banca compatibile Zucchetti/TeamSystem`,
    `================================================================================`,
  ].filter(Boolean).join('\r\n');

  zip.file('00_INDICE_FASCICOLO_FISCALE.txt', indiceTesto);

  // ─── 01_Fatture_Attive_Vendite ───────────────────────────────────────
  const csvAttiveRighe = [
    ['Data', 'Tipo', 'Serie', 'Numero', 'Cliente', 'P.IVA/CF', 'Imponibile_EUR', 'IVA_EUR', 'Totale_EUR', 'Stato'].join(';'),
  ];
  for (const f of fattureAttive) {
    const nomeCli = f.cliente?.nome || f.progetto?.cliente?.nome || 'Cliente';
    const pivaCli = f.cliente?.piva || f.progetto?.cliente?.piva || f.cliente?.codiceFiscale || '';
    const imp = ((f.totaleImponibileCentesimi || 0) / 100).toFixed(2);
    const iva = ((f.totaleIvaCentesimi || 0) / 100).toFixed(2);
    const tot = ((f.totaleDocumentoCentesimi || 0) / 100).toFixed(2);
    const dataStr = f.data ? f.data.toISOString().split('T')[0] : '';
    csvAttiveRighe.push([
      dataStr,
      f.tipoDocumento,
      f.serie,
      f.numeroProgressivoSerie,
      `"${nomeCli.replace(/"/g, '""')}"`,
      `"${pivaCli}"`,
      imp,
      iva,
      tot,
      f.stato,
    ].join(';'));

    const nomeFileXml = `Fattura_${f.serie}_${String(f.numeroProgressivoSerie).padStart(4, '0')}.xml`;
    const xmlContenuto = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
  <FatturaElettronicaHeader>
    <CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${studioPiva}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${studioNome}</Denominazione></Anagrafica></DatiAnagrafici></CedentePrestatore>
    <CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${pivaCli}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${nomeCli}</Denominazione></Anagrafica></DatiAnagrafici></CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>${dataStr}</Data><Numero>${f.numeroProgressivoSerie}</Numero><ImportoTotaleDocumento>${tot}</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
    <DatiBeniServizi><DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>${imp}</ImponibileImporto><Imposta>${iva}</Imposta></DatiRiepilogo></DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
    zip.file(`01_Fatture_Attive_Vendite/${nomeFileXml}`, xmlContenuto);
  }
  zip.file('01_Fatture_Attive_Vendite/Registro_Fatture_Vendite.csv', csvAttiveRighe.join('\r\n'));

  // ─── 02_Fatture_Passive_Acquisti ─────────────────────────────────────
  const csvPassiveRighe = [
    ['Data', 'Numero', 'Fornitore', 'P.IVA/CF', 'Imponibile_EUR', 'IVA_EUR', 'Totale_EUR', 'Esigibilita_IVA', 'Pagata'].join(';'),
  ];
  for (const fp of fatturePassive) {
    const nomeForn = fp.fornitore?.ragioneSociale || 'Fornitore';
    const pivaForn = fp.fornitore?.partitaIva || fp.fornitore?.codiceFiscale || '';
    const imp = ((fp.imponibileCentesimi || 0) / 100).toFixed(2);
    const iva = ((fp.ivaCentesimi || 0) / 100).toFixed(2);
    const tot = ((fp.totaleCentesimi || 0) / 100).toFixed(2);
    const dataStr = fp.data ? fp.data.toISOString().split('T')[0] : '';
    csvPassiveRighe.push([
      dataStr,
      `"${fp.numero.replace(/"/g, '""')}"`,
      `"${nomeForn.replace(/"/g, '""')}"`,
      `"${pivaForn}"`,
      imp,
      iva,
      tot,
      fp.esigibilitaIva,
      fp.pagata ? 'SI' : 'NO',
    ].join(';'));

    if (fp.xmlSdiRaw) {
      const sanitizedNum = fp.numero.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedForn = nomeForn.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
      zip.file(`02_Fatture_Passive_Acquisti/Acquisto_${sanitizedNum}_${sanitizedForn}.xml`, fp.xmlSdiRaw);
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
    ['F24_CODICE_TRIBUTO', 'Codice tributo Modello F24', codiceTributoF24],
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
  for (const m of movimenti) {
    const dataStr = m.data ? m.data.toISOString().split('T')[0] : '';
    const conto = m.contoBancario?.nomeConto || 'Cassa Studio';
    const entrata = m.tipo === 'entrata' ? ((m.importoCentesimi || 0) / 100).toFixed(2) : '0.00';
    const uscita = m.tipo === 'uscita' ? ((m.importoCentesimi || 0) / 100).toFixed(2) : '0.00';
    const rif = m.fattura ? `FT ${m.fattura.serie}/${m.fattura.numeroProgressivoSerie}` : m.fatturaRicevuta ? `Fatt. Acquisto ${m.fatturaRicevuta.numero}` : '';
    csvPrimaNota.push([
      dataStr,
      m.tipo,
      `"${conto}"`,
      `"${(m.descrizione || '').replace(/"/g, '""')}"`,
      entrata,
      uscita,
      m.metodoPagamento || 'bonifico',
      `"${m.riferimentoTransazione || ''}"`,
      `"${rif}"`,
    ].join(';'));
  }
  zip.file(`04_Prima_Nota_Cassa_Banca/Prima_Nota_${etichettaPeriodo}.csv`, csvPrimaNota.join('\r\n'));

  // Genera buffer ZIP
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const sanitizedStudio = studioNome.replace(/[^a-zA-Z0-9_-]/g, '_');
  const nomeFile = `Fascicolo_Fiscale_${sanitizedStudio}_${etichettaPeriodo}.zip`;

  return {
    buffer,
    nomeFile,
    conteggioFattureAttive: fattureAttive.length,
    conteggioFatturePassive: fatturePassive.length,
    conteggioMovimentiPrimaNota: movimenti.length,
    totaleImponibileVenditeEuro,
    totaleIvaVenditeEuro,
    totaleImponibileAcquistiEuro,
    totaleIvaAcquistiEuro,
    saldoIvaEuro,
  };
}
