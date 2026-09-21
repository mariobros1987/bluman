import { describe, it, expect } from 'vitest';
import { fileContieneFirmaDigitale } from './firmaFileValidazione.js';

describe('fileContieneFirmaDigitale — FEQ onesta', () => {
  it('rifiuta un PDF qualunque senza firma (il buco "any PDF = FEQ")', () => {
    const pdfNonFirmato = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF', 'latin1');
    const esito = fileContieneFirmaDigitale(pdfNonFirmato, 'contratto.pdf');
    expect(esito.firmato).toBe(false);
    expect(esito.motivo).toMatch(/firma digitale/i);
  });

  it('accetta un PDF con firma PAdES (ByteRange + dizionario /Sig)', () => {
    const pdfFirmato = Buffer.from(
      '%PDF-1.7\n1 0 obj<</Type/Sig/SubFilter/ETSI.CAdES.detached/ByteRange[0 100 200 300]>>endobj\n%%EOF',
      'latin1',
    );
    const esito = fileContieneFirmaDigitale(pdfFirmato, 'contratto-firmato.pdf');
    expect(esito.firmato).toBe(true);
    expect(esito.formato).toBe('PAdES (PDF firmato)');
  });

  it('accetta un contenitore PKCS#7/CAdES (.p7m) riconoscendo l\'OID signedData', () => {
    // DER con l'OID PKCS#7 signedData 1.2.840.113549.1.7.2
    const oid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
    const p7m = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), oid, Buffer.alloc(16)]);
    const esito = fileContieneFirmaDigitale(p7m, 'documento.p7m');
    expect(esito.firmato).toBe(true);
    expect(esito.formato).toBe('PKCS#7/CAdES');
  });

  it('rifiuta un file vuoto e un file di testo arbitrario', () => {
    expect(fileContieneFirmaDigitale(Buffer.alloc(0), 'x.pdf').firmato).toBe(false);
    expect(fileContieneFirmaDigitale(Buffer.from('ciao mondo'), 'note.txt').firmato).toBe(false);
  });
});
