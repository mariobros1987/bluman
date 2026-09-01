import { describe, it, expect } from 'vitest';
import { generateInvoicePdfBuffer } from './pdfService.js';

function testoPdf(pdf: Buffer): string {
  const grezzo = pdf.toString('latin1');
  const parti: string[] = [];
  for (const m of grezzo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    parti.push(Buffer.from(m[1] ?? '', 'hex').toString('latin1'));
  }
  return parti.join('') + ' ' + grezzo;
}

describe('pdfService — Test Generazione PDF Server-Side', () => {
  it('genera correttamente un buffer PDF valido con intestazione e dettagli', async () => {
    const pdfBuffer = await generateInvoicePdfBuffer({
      numero: 'FT-2026/001',
      data: '16/08/2026',
      tipoDocumento: 'fattura',
      clienteNome: 'Holding Beta Ltd',
      clientePiva: 'MT12345678',
      clienteSede: 'Valletta, Malta',
      tenantNome: 'Bluecode Advisory Studio',
      tenantIban: 'IT99C0306902100100000012345',
      righe: [
        { descrizione: 'Consulenza Strategica Malta Structure', importo: 500000 },
        { descrizione: 'Apertura Conto Corrente Corporate', importo: 150000 },
      ],
      totaleEuro: 6500.0,
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(100);

    const latinContent = pdfBuffer.toString('latin1');
    expect(latinContent).toContain('%PDF');

    const decoded = testoPdf(pdfBuffer);
    expect(decoded).toContain('BLUECODE ADVISORY STUDIO');
    expect(decoded).toContain('FATTURA ELETTRONICA');
    expect(decoded).toContain('FT-2026/001');
    expect(decoded).toContain('Holding Beta Ltd');
  });

  it('gestisce correttamente la generazione di una Nota di Credito', async () => {
    const pdfBuffer = await generateInvoicePdfBuffer({
      numero: 'NC-2026/001',
      data: '16/08/2026',
      tipoDocumento: 'nota_credito',
      clienteNome: 'Holding Beta Ltd',
      tenantNome: 'Bluecode Advisory Studio',
      righe: [{ descrizione: 'Storno parziale invoice FT-2026/001', importo: 50000 }],
      totaleEuro: 500.0,
    });

    const latinContent = pdfBuffer.toString('latin1');
    expect(latinContent).toContain('%PDF');

    const decoded = testoPdf(pdfBuffer);
    expect(decoded).toContain('NOTA DI CREDITO');
    expect(decoded).toContain('NC-2026/001');
  });
});
