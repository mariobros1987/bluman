import { describe, expect, it } from 'vitest';
import { scanFileBuffer } from './securityScanner.js';

const pdf = (extra = '') => Buffer.from(`%PDF-1.7\n${extra}\n%%EOF`, 'latin1');
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);

describe('scanFileBuffer — policy upload documentale', () => {
  it('accetta firme coerenti e OOXML contenuto in ZIP', () => {
    expect(scanFileBuffer(pdf(), 'atto.pdf').safe).toBe(true);
    expect(scanFileBuffer(zip, 'atto.docx').safe).toBe(true);
    expect(scanFileBuffer(zip, 'tabella.xlsx').safe).toBe(true);
  });

  it('rifiuta mismatch tra firma binaria ed estensione', () => {
    const esito = scanFileBuffer(pdf(), 'atto.jpg');
    expect(esito.safe).toBe(false);
    expect(esito.reason).toContain('non corrisponde');
  });

  it('rifiuta HTML, SVG e formati sconosciuti anche se camuffati', () => {
    expect(scanFileBuffer(Buffer.from('<html><script>alert(1)</script></html>'), 'pagina.html').safe).toBe(false);
    expect(scanFileBuffer(Buffer.from('<svg onload="alert(1)"></svg>'), 'immagine.svg').safe).toBe(false);
    expect(scanFileBuffer(Buffer.from('<svg></svg>'), 'immagine.txt').safe).toBe(false);
    expect(scanFileBuffer(Buffer.from('MZ malicious'), 'payload.bin').safe).toBe(false);
  });

  it('rifiuta azioni PDF attive', () => {
    expect(scanFileBuffer(pdf('/JavaScript (alert)'), 'atto.pdf').safe).toBe(false);
    expect(scanFileBuffer(pdf('/Launch /EmbeddedFiles'), 'atto.pdf').safe).toBe(false);
  });
});
