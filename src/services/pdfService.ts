// Servizio Server-Side di Generazione PDF nativi per Fatture e Documenti

export interface FatturaPdfData {
  numero: string;
  data: string;
  tipoDocumento: string;
  clienteNome: string;
  clientePiva?: string;
  clienteSede?: string;
  tenantNome: string;
  tenantIban?: string;
  tenantPiva?: string;
  righe: Array<{ descrizione: string; importo: number }>;
  totaleEuro: number;
}

export function generateInvoicePdfBuffer(data: FatturaPdfData): Buffer {
  const isNote = data.tipoDocumento === 'nota_credito';
  const titoloDoc = isNote ? 'NOTA DI CREDITO' : 'FATTURA ELETTRONICA';

  const textLines = [
    `=================================================================`,
    `                     ${data.tenantNome.toUpperCase()}                     `,
    `=================================================================`,
    `P.IVA: ${data.tenantPiva || 'non impostata nelle anagrafiche dello studio'} | Studio Advisory & Consulting`,
    `-----------------------------------------------------------------`,
    `DOCUMENTO FISCALE: ${titoloDoc}`,
    `NUMERO: ${data.numero}`,
    `DATA EMISSIONE: ${data.data}`,
    `-----------------------------------------------------------------`,
    `DESTINATARIO / CESSIONARIO:`,
    `Ragione Sociale: ${data.clienteNome}`,
    `P.IVA / C.F.: ${data.clientePiva || 'Non specificato'}`,
    `Sede Legale: ${data.clienteSede || 'Non specificata'}`,
    `-----------------------------------------------------------------`,
    `DETTAGLIO PRESTAZIONI / SERVIZI:`,
    ...data.righe.map((r, idx) => ` [${idx + 1}] ${r.descrizione.padEnd(45, '.')} € ${(r.importo / 100).toFixed(2)}`),
    `-----------------------------------------------------------------`,
    `TOTALE DOCUMENTO:                                € ${data.totaleEuro.toFixed(2)}`,
    `=================================================================`,
    `COORDINATE BANCARIE PER IL PAGAMENTO:`,
    // Nessun ripiego inventato: qui c'era un IBAN scritto nel codice, e finiva stampato su
    // ogni fattura di uno studio che non avesse inserito il proprio. Un cliente che paga a
    // quelle coordinate manda i soldi altrove. Se l'IBAN non c'è, la fattura lo dichiara.
    `IBAN: ${data.tenantIban || 'DA COMPLETARE — nessun IBAN configurato nelle impostazioni dello studio'}`,
    `Causale: Saldo ${data.numero} - ${data.clienteNome}`,
    `=================================================================`,
  ];

  return Buffer.from(textLines.join('\n'), 'utf-8');
}
