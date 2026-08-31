// Servizio Server-Side di Generazione PDF nativi per Fatture e Documenti

export interface FatturaPdfRigaData {
  descrizione: string;
  quantita?: number;
  unitaMisura?: string;
  prezzoUnitarioCent?: number;
  aliquotaIva?: number;
  importo: number; // centesimi
}

export interface FatturaPdfData {
  numero: string;
  data: string;
  tipoDocumento: string;
  clienteNome: string;
  clientePiva?: string;
  clienteCodiceFiscale?: string;
  clienteSede?: string;
  clienteSdiCode?: string;
  tenantNome: string;
  tenantIban?: string;
  tenantPiva?: string;
  tenantCodiceFiscale?: string;
  tenantSede?: string;
  righe: FatturaPdfRigaData[];
  totaleImponibileEuro?: number;
  totaleCassaEuro?: number;
  tipoCassa?: string;
  totaleIvaEuro?: number;
  totaleRitenutaEuro?: number;
  totaleBolloEuro?: number;
  totaleEuro: number;
  nettoAPagareEuro?: number;
  condizionePagamento?: string;
  scadenze?: Array<{ numeroRata: number; importoEuro: number; dataScadenza: string }>;
  note?: string;
}

export function generateInvoicePdfBuffer(data: FatturaPdfData): Buffer {
  const isNote = data.tipoDocumento === 'nota_credito';
  const titoloDoc = isNote ? 'NOTA DI CREDITO' : 'FATTURA ELETTRONICA';

  const textLines = [
    `=================================================================`,
    `                     ${data.tenantNome.toUpperCase()}                     `,
    `=================================================================`,
    `Sede: ${data.tenantSede || 'Studio Legale & Tributario'}`,
    `P.IVA: ${data.tenantPiva || 'non impostata'} | C.F.: ${data.tenantCodiceFiscale || data.tenantPiva || 'non impostato'}`,
    `-----------------------------------------------------------------`,
    `DOCUMENTO FISCALE: ${titoloDoc}`,
    `NUMERO: ${data.numero}`,
    `DATA EMISSIONE: ${data.data}`,
    `CONDIZIONI PAGAMENTO: ${data.condizionePagamento || 'Bonifico 30 gg'}`,
    `-----------------------------------------------------------------`,
    `DESTINATARIO / CESSIONARIO:`,
    `Ragione Sociale: ${data.clienteNome}`,
    `P.IVA: ${data.clientePiva || 'Non specificata'} | C.F.: ${data.clienteCodiceFiscale || 'Non specificato'}`,
    `Codice SDI: ${data.clienteSdiCode || '0000000'} | Sede: ${data.clienteSede || 'Non specificata'}`,
    `-----------------------------------------------------------------`,
    `DETTAGLIO PRESTAZIONI / SERVIZI:`,
    ...data.righe.map((r, idx) => {
      const qtaStr = r.quantita ? ` (Q.tà: ${r.quantita} ${r.unitaMisura || 'ore'})` : '';
      const ivaStr = r.aliquotaIva !== undefined ? ` [IVA ${r.aliquotaIva}%]` : '';
      return ` [${idx + 1}] ${(r.descrizione + qtaStr).padEnd(45, '.')} € ${(r.importo / 100).toFixed(2)}${ivaStr}`;
    }),
    `-----------------------------------------------------------------`,
    `RIEPILOGO FINANZIARIO & FISCALE:`,
    `Imponibile Prestazioni:                           € ${(data.totaleImponibileEuro !== undefined ? data.totaleImponibileEuro : data.totaleEuro).toFixed(2)}`,
  ];

  if (data.totaleCassaEuro && data.totaleCassaEuro > 0) {
    textLines.push(`Rivalsa Cassa Previdenziale (${data.tipoCassa || '4%'}):              € ${data.totaleCassaEuro.toFixed(2)}`);
  }
  if (data.totaleIvaEuro !== undefined && data.totaleIvaEuro > 0) {
    textLines.push(`Imposta sul Valore Aggiunto (IVA):                € ${data.totaleIvaEuro.toFixed(2)}`);
  }
  if (data.totaleBolloEuro && data.totaleBolloEuro > 0) {
    textLines.push(`Imposta di Bollo Virtuale (D.M. 17/06/2014):     € ${data.totaleBolloEuro.toFixed(2)}`);
  }

  textLines.push(`-----------------------------------------------------------------`);
  textLines.push(`TOTALE DOCUMENTO:                                € ${data.totaleEuro.toFixed(2)}`);

  if (data.totaleRitenutaEuro && data.totaleRitenutaEuro > 0) {
    textLines.push(`Ritenuta d'Acconto a carico committente:         -€ ${data.totaleRitenutaEuro.toFixed(2)}`);
  }
  if (data.nettoAPagareEuro !== undefined) {
    textLines.push(`NETTO A PAGARE:                                  € ${data.nettoAPagareEuro.toFixed(2)}`);
  }

  textLines.push(`=================================================================`);
  textLines.push(`COORDINATE BANCARIE PER IL SALDO:`);
  textLines.push(`IBAN: ${data.tenantIban || 'DA COMPLETARE — nessun IBAN configurato nelle impostazioni dello studio'}`);
  textLines.push(`Causale: Saldo ${data.numero} - ${data.clienteNome}`);

  if (data.scadenze && data.scadenze.length > 0) {
    textLines.push(`-----------------------------------------------------------------`);
    textLines.push(`PIANO SCADENZE:`);
    for (const sc of data.scadenze) {
      textLines.push(` - Rata #${sc.numeroRata}: € ${sc.importoEuro.toFixed(2)} con scadenza ${sc.dataScadenza}`);
    }
  }

  if (data.note) {
    textLines.push(`-----------------------------------------------------------------`);
    textLines.push(`NOTE: ${data.note}`);
  }

  textLines.push(`=================================================================`);

  return Buffer.from(textLines.join('\n'), 'utf-8');
}
