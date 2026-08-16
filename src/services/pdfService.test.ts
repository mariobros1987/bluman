import { describe, it, expect } from 'vitest';
import { generateInvoicePdfBuffer } from './pdfService.js';

describe('pdfService — Test Generazione PDF Server-Side', () => {
  it('genera correttamente un buffer PDF valido con intestazione e dettagli', () => {
    const pdfBuffer = generateInvoicePdfBuffer({
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
      totaleEuro: 6500.00,
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(100);

    const textContent = pdfBuffer.toString('utf-8');
    expect(textContent).toContain('BLUECODE ADVISORY STUDIO');
    expect(textContent).toContain('FATTURA ELETTRONICA');
    expect(textContent).toContain('FT-2026/001');
    expect(textContent).toContain('Holding Beta Ltd');
    expect(textContent).toContain('6500.00');
  });

  it('gestisce correttamente la generazione di una Nota di Credito', () => {
    const pdfBuffer = generateInvoicePdfBuffer({
      numero: 'NC-2026/001',
      data: '16/08/2026',
      tipoDocumento: 'nota_credito',
      clienteNome: 'Holding Beta Ltd',
      tenantNome: 'Bluecode Advisory Studio',
      righe: [{ descrizione: 'Storno parziale invoice FT-2026/001', importo: 50000 }],
      totaleEuro: 500.00,
    });

    const textContent = pdfBuffer.toString('utf-8');
    expect(textContent).toContain('NOTA DI CREDITO');
    expect(textContent).toContain('NC-2026/001');
  });
});
