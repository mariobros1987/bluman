/**
 * Generatore XML FatturaPA 1.2 conforme Agenzia delle Entrate
 * Supporta: TD01 (Fattura), TD04 (Nota di Credito), Ritenuta, Cassa Previdenziale, Bollo e Pagamento.
 */

export interface DatiFatturaSdiXml {
  idTrasmittentePaese?: string;
  idTrasmittenteCodice?: string;
  progressivoInvio: string;
  formatoTrasmissione?: string; // 'FPR12' (B2B/B2C) o 'FPA12' (PA)
  codiceDestinatario: string;
  pecDestinatario?: string | null;

  cedenteDenominazione: string;
  cedentePiva?: string | null;
  cedenteCodiceFiscale?: string | null;
  cedenteSedeIndirizzo?: string | null;
  cedenteSedeCap?: string | null;
  cedenteSedeComune?: string | null;
  cedenteSedeProvincia?: string | null;
  cedenteSedeNazione?: string;
  cedenteRegimeFiscale?: string; // 'RF01', 'RF02', 'RF19', etc.

  cessionarioDenominazione: string;
  cessionarioPiva?: string | null;
  cessionarioCodiceFiscale?: string | null;
  cessionarioIndirizzo?: string | null;
  cessionarioCap?: string | null;
  cessionarioComune?: string | null;
  cessionarioProvincia?: string | null;
  cessionarioNazione?: string;

  tipoDocumento: 'TD01' | 'TD04';
  divisa?: string;
  data: string; // YYYY-MM-DD
  numero: string;
  importoTotaleDocumento: number; // in euro
  arrotondamento?: number;
  causale?: string;

  // Dati Cassa Previdenziale
  tipoCassa?: string; // 'TC22', 'TC03', 'TC01', etc.
  aliquotaCassa?: number;
  importoContributoCassa?: number;
  imponibileCassa?: number;
  aliquotaIvaCassa?: number;

  // Dati Ritenuta
  tipoRitenuta?: 'RT01' | 'RT02'; // RT01 persone fisiche, RT02 persone giuridiche
  importoRitenuta?: number;
  aliquotaRitenuta?: number;
  causalePagamentoRitenuta?: string; // 'A' prestazioni lavoro autonomo rientranti nell'esercizio arte o professione

  // Dati Bollo
  bolloVirtuale?: boolean;
  importoBollo?: number;

  // Linee di dettaglio
  linee: Array<{
    numeroLinea: number;
    descrizione: string;
    quantita?: number;
    unitaMisura?: string;
    prezzoUnitario: number;
    prezzoTotale: number;
    aliquotaIva: number;
    natura?: string | null;
    ritenuta?: boolean;
  }>;

  // Riepilogo IVA
  riepilogoIva: Array<{
    aliquotaIva: number;
    natura?: string | null;
    imponibileImporto: number;
    imposta: number;
    esigibilitaIva?: 'I' | 'D' | 'S';
  }>;

  // Dati Fatture Collegate (per TD04 Nota di Credito)
  fatturaCollegataNumero?: string | null;
  fatturaCollegataData?: string | null;

  // Dati Pagamento
  condizioniPagamento?: 'TP01' | 'TP02' | 'TP03'; // TP02 completo, TP01 a rate, TP03 anticipo
  modalitaPagamento?: string; // 'MP05' Bonifico, 'MP08' Carta, etc.
  dataScadenzaPagamento?: string;
  importoPagamento?: number;
  iban?: string | null;
}

export function generaFatturaElettronicaXml(dati: DatiFatturaSdiXml): string {
  // Il cedente è lo studio, e i suoi identificativi **non si inventano**: qui c'erano
  // `'00000000000'` come ripiego della partita IVA e del codice fiscale. Un XML con la P.IVA a zero
  // non è un documento incompleto, è un documento che dice il falso — e SdI o lo scarta o lo
  // accetta, mai producendo la fattura dello studio. Ora il campo resta **vuoto**: un `IdCodice`
  // vuoto è un rifiuto rumoroso e immediato, che è il verso giusto dell'errore. Chi chiama ha già
  // verificato l'anagrafica con `campiAnagraficaMancanti` (`src/domain/anagraficaStudio.ts`) e
  // rifiuta prima di arrivare qui: questa è la seconda linea di difesa, non l'unica.
  const pivaCedente = dati.cedentePiva || dati.cedenteCodiceFiscale || '';
  // Il codice fiscale di una società italiana coincide spesso con la partita IVA: ripiegare l'uno
  // sull'altra è legittimo. Ripiegare su zeri non lo era.
  const cfCedente = dati.cedenteCodiceFiscale || dati.cedentePiva || '';

  const cfCessionario = dati.cessionarioCodiceFiscale || dati.cessionarioPiva || '00000000000';
  const pivaCessionario = dati.cessionarioPiva || '';

  const formato = dati.formatoTrasmissione || (dati.codiceDestinatario?.length === 6 ? 'FPA12' : 'FPR12');

  const xmlParts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<p:FatturaElettronica versione="${formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2000/01/XMLSchema-instance">`,
    `  <FatturaElettronicaHeader>`,
    `    <DatiTrasmissione>`,
    `      <IdTrasmittente>`,
    `        <IdPaese>${dati.idTrasmittentePaese || 'IT'}</IdPaese>`,
    `        <IdCodice>${dati.idTrasmittenteCodice || pivaCedente}</IdCodice>`,
    `      </IdTrasmittente>`,
    `      <ProgressivoInvio>${escapeXml(dati.progressivoInvio)}</ProgressivoInvio>`,
    `      <FormatoTrasmissione>${formato}</FormatoTrasmissione>`,
    `      <CodiceDestinatario>${escapeXml(dati.codiceDestinatario || '0000000')}</CodiceDestinatario>`,
  ];

  if (dati.pecDestinatario) {
    xmlParts.push(`      <PECDestinatario>${escapeXml(dati.pecDestinatario)}</PECDestinatario>`);
  }

  xmlParts.push(
    `    </DatiTrasmissione>`,
    `    <CedentePrestatore>`,
    `      <DatiAnagrafici>`,
    `        <IdFiscaleIVA>`,
    `          <IdPaese>${dati.cedenteSedeNazione || 'IT'}</IdPaese>`,
    `          <IdCodice>${escapeXml(pivaCedente)}</IdCodice>`,
    `        </IdFiscaleIVA>`,
    `        <CodiceFiscale>${escapeXml(cfCedente)}</CodiceFiscale>`,
    `        <Anagrafica>`,
    `          <Denominazione>${escapeXml(dati.cedenteDenominazione)}</Denominazione>`,
    `        </Anagrafica>`,
    `        <RegimeFiscale>${dati.cedenteRegimeFiscale || ''}</RegimeFiscale>`,
    `      </DatiAnagrafici>`,
    `      <Sede>`,
    `        <Indirizzo>${escapeXml(dati.cedenteSedeIndirizzo || '')}</Indirizzo>`,
    // CAP, Comune e Provincia qui sotto sono **ancora** inventati, e non è una svista: sono campi
    // obbligatori del blocco `Sede` di FatturaPA, `Tenant.sedeLegale` è una riga di testo libera
    // (una sola colonna, senza le parti separate) e `mappaturaFatturaSdi` non li valorizza mai —
    // quindi `'00100'`, `'Roma'` e `'RM'` finiscono in **ogni** XML che questa app produce, anche
    // in quelli che portano l'indirizzo vero. Toglierli senza sostituirli renderebbe invalido ogni
    // file; sostituirli bene richiede quattro colonne strutturate (via, CAP, comune, provincia) più
    // i campi nel form dell'anagrafica. È una decisione a sé, segnalata al titolare: questo commento
    // resta perché chi legge non creda che l'indirizzo del cedente sia a posto.
    `        <CAP>${escapeXml(dati.cedenteSedeCap || '00100')}</CAP>`,
    `        <Comune>${escapeXml(dati.cedenteSedeComune || 'Roma')}</Comune>`,
    `        <Provincia>${escapeXml(dati.cedenteSedeProvincia || 'RM')}</Provincia>`,
    `        <Nazione>${dati.cedenteSedeNazione || 'IT'}</Nazione>`,
    `      </Sede>`,
    `    </CedentePrestatore>`,
    `    <CessionarioCommittente>`,
    `      <DatiAnagrafici>`
  );

  if (pivaCessionario) {
    xmlParts.push(
      `        <IdFiscaleIVA>`,
      `          <IdPaese>${dati.cessionarioNazione || 'IT'}</IdPaese>`,
      `          <IdCodice>${escapeXml(pivaCessionario)}</IdCodice>`,
      `        </IdFiscaleIVA>`
    );
  }

  if (cfCessionario) {
    xmlParts.push(`        <CodiceFiscale>${escapeXml(cfCessionario)}</CodiceFiscale>`);
  }

  xmlParts.push(
    `        <Anagrafica>`,
    `          <Denominazione>${escapeXml(dati.cessionarioDenominazione)}</Denominazione>`,
    `        </Anagrafica>`,
    `      </DatiAnagrafici>`,
    `      <Sede>`,
    `        <Indirizzo>${escapeXml(dati.cessionarioIndirizzo || 'Sede non specificata')}</Indirizzo>`,
    `        <CAP>${escapeXml(dati.cessionarioCap || '00100')}</CAP>`,
    `        <Comune>${escapeXml(dati.cessionarioComune || 'Roma')}</Comune>`,
    `        <Nazione>${dati.cessionarioNazione || 'IT'}</Nazione>`,
    `      </Sede>`,
    `    </CessionarioCommittente>`,
    `  </FatturaElettronicaHeader>`,
    `  <FatturaElettronicaBody>`,
    `    <DatiGenerali>`,
    `      <DatiGeneraliDocumento>`,
    `        <TipoDocumento>${dati.tipoDocumento}</TipoDocumento>`,
    `        <Divisa>${dati.divisa || 'EUR'}</Divisa>`,
    `        <Data>${dati.data}</Data>`,
    `        <Numero>${escapeXml(dati.numero)}</Numero>`
  );

  // Ritenuta
  if (dati.importoRitenuta && dati.importoRitenuta > 0) {
    xmlParts.push(
      `        <DatiRitenuta>`,
      `          <TipoRitenuta>${dati.tipoRitenuta || 'RT01'}</TipoRitenuta>`,
      `          <ImportoRitenuta>${dati.importoRitenuta.toFixed(2)}</ImportoRitenuta>`,
      `          <AliquotaRitenuta>${(dati.aliquotaRitenuta || 20).toFixed(2)}</AliquotaRitenuta>`,
      `          <CausalePagamento>${dati.causalePagamentoRitenuta || 'A'}</CausalePagamento>`,
      `        </DatiRitenuta>`
    );
  }

  // Bollo
  if (dati.bolloVirtuale && dati.importoBollo) {
    xmlParts.push(
      `        <DatiBollo>`,
      `          <BolloVirtuale>SI</BolloVirtuale>`,
      `          <ImportoBollo>${dati.importoBollo.toFixed(2)}</ImportoBollo>`,
      `        </DatiBollo>`
    );
  }

  // Cassa Previdenziale
  if (dati.importoContributoCassa && dati.importoContributoCassa > 0) {
    xmlParts.push(
      `        <DatiCassaPrevidenziale>`,
      `          <TipoCassa>${dati.tipoCassa || 'TC22'}</TipoCassa>`,
      `          <AlCassa>${(dati.aliquotaCassa || 4).toFixed(2)}</AlCassa>`,
      `          <ImportoContributoCassa>${dati.importoContributoCassa.toFixed(2)}</ImportoContributoCassa>`,
      `          <ImponibileCassa>${(dati.imponibileCassa || 0).toFixed(2)}</ImponibileCassa>`,
      `          <AliquotaIVA>${(dati.aliquotaIvaCassa || 22).toFixed(2)}</AliquotaIVA>`,
      `        </DatiCassaPrevidenziale>`
    );
  }

  xmlParts.push(`        <ImportoTotaleDocumento>${dati.importoTotaleDocumento.toFixed(2)}</ImportoTotaleDocumento>`);
  xmlParts.push(`      </DatiGeneraliDocumento>`);

  // Fatture Collegate (per Note di Credito TD04)
  if (dati.fatturaCollegataNumero) {
    xmlParts.push(
      `      <DatiFattureCollegate>`,
      `        <IdDocumento>${escapeXml(dati.fatturaCollegataNumero)}</IdDocumento>`,
      ...(dati.fatturaCollegataData ? [`        <Data>${dati.fatturaCollegataData}</Data>`] : []),
      `      </DatiFattureCollegate>`
    );
  }

  xmlParts.push(`    </DatiGenerali>`, `    <DatiBeniServizi>`);

  // Righe
  for (const l of dati.linee) {
    xmlParts.push(
      `      <DettaglioLinee>`,
      `        <NumeroLinea>${l.numeroLinea}</NumeroLinea>`,
      `        <Descrizione>${escapeXml(l.descrizione)}</Descrizione>`,
      ...(l.quantita ? [`        <Quantita>${l.quantita.toFixed(2)}</Quantita>`] : []),
      ...(l.unitaMisura ? [`        <UnitaMisura>${escapeXml(l.unitaMisura)}</UnitaMisura>`] : []),
      `        <PrezzoUnitario>${l.prezzoUnitario.toFixed(2)}</PrezzoUnitario>`,
      `        <PrezzoTotale>${l.prezzoTotale.toFixed(2)}</PrezzoTotale>`,
      `        <AliquotaIVA>${l.aliquotaIva.toFixed(2)}</AliquotaIVA>`,
      ...(l.natura ? [`        <Natura>${escapeXml(l.natura)}</Natura>`] : []),
      ...(l.ritenuta ? [`        <Ritenuta>SI</Ritenuta>`] : []),
      `      </DettaglioLinee>`
    );
  }

  // Riepilogo IVA
  for (const r of dati.riepilogoIva) {
    xmlParts.push(
      `      <DatiRiepilogo>`,
      `        <AliquotaIVA>${r.aliquotaIva.toFixed(2)}</AliquotaIVA>`,
      ...(r.natura ? [`        <Natura>${escapeXml(r.natura)}</Natura>`] : []),
      `        <ImponibileImporto>${r.imponibileImporto.toFixed(2)}</ImponibileImporto>`,
      `        <Imposta>${r.imposta.toFixed(2)}</Imposta>`,
      ...(r.esigibilitaIva ? [`        <EsigibilitaIVA>${r.esigibilitaIva}</EsigibilitaIVA>`] : []),
      `      </DatiRiepilogo>`
    );
  }

  xmlParts.push(`    </DatiBeniServizi>`);

  // Dati Pagamento
  if (dati.iban || dati.importoPagamento) {
    xmlParts.push(
      `    <DatiPagamento>`,
      `      <CondizioniPagamento>${dati.condizioniPagamento || 'TP02'}</CondizioniPagamento>`,
      `      <DettaglioPagamento>`,
      `        <ModalitaPagamento>${dati.modalitaPagamento || 'MP05'}</ModalitaPagamento>`,
      ...(dati.dataScadenzaPagamento ? [`        <DataScadenzaPagamento>${dati.dataScadenzaPagamento}</DataScadenzaPagamento>`] : []),
      `        <ImportoPagamento>${(dati.importoPagamento || dati.importoTotaleDocumento).toFixed(2)}</ImportoPagamento>`,
      ...(dati.iban ? [`        <IBAN>${escapeXml(dati.iban.replace(/\s+/g, ''))}</IBAN>`] : []),
      `      </DettaglioPagamento>`,
      `    </DatiPagamento>`
    );
  }

  xmlParts.push(`  </FatturaElettronicaBody>`, `</p:FatturaElettronica>`);

  return xmlParts.join('\n');
}

function escapeXml(unsafe?: string | null): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
