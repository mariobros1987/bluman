// Accentratore delle mail — le parti pure della lettura IMAP: intestazioni, struttura, testo.
import { describe, it, expect } from 'vitest';
import { leggiIntestazioni, partiDellaStruttura, testoDaHtml } from './services/postaImap.js';

describe('leggiIntestazioni', () => {
  it('ricompone le righe di continuazione e tiene le intestazioni ripetute', () => {
    const grezze = Buffer.from(
      'Delivered-To: raccolta+k7m2p9xq@studio.example\r\nTo: Mario Rossi <mario.rossi@example.com>,\r\n\taltro@example.org\r\nDelivered-To: mario.rossi@example.com\r\n\r\n',
    );
    const mappa = leggiIntestazioni(grezze);
    expect(mappa.get('delivered-to')).toBe('raccolta+k7m2p9xq@studio.example, mario.rossi@example.com');
    expect(mappa.get('to')).toBe('Mario Rossi <mario.rossi@example.com>, altro@example.org');
    expect(leggiIntestazioni(null).size).toBe(0);
  });
});

describe('partiDellaStruttura', () => {
  it('messaggio semplice: il testo è la parte 1', () => {
    expect(partiDellaStruttura({ type: 'text/plain' })).toEqual({ testo: '1', html: null, allegati: [] });
  });

  it('distingue testo, HTML, allegati e immagini incorporate nel corpo', () => {
    const struttura = {
      type: 'multipart/mixed',
      childNodes: [
        {
          type: 'multipart/related',
          childNodes: [
            { type: 'multipart/alternative', childNodes: [{ part: '1.1.1', type: 'text/plain' }, { part: '1.1.2', type: 'text/html' }] },
            { part: '1.2', type: 'image/png', id: '<logo@x>', disposition: 'inline', dispositionParameters: { filename: 'logo.png' } },
          ],
        },
        { part: '2', type: 'application/pdf', size: 1234, disposition: 'attachment', dispositionParameters: { filename: 'contratto.pdf' } },
        { part: '3', type: 'image/jpeg', parameters: { name: 'documento.jpg' } },
        { part: '4', type: 'text/plain', disposition: 'attachment' },
      ],
    };
    expect(partiDellaStruttura(struttura)).toEqual({
      testo: '1.1.1',
      html: '1.1.2',
      allegati: [
        { parte: '2', nome: 'contratto.pdf', mime: 'application/pdf', dimensioneByte: 1234 },
        { parte: '3', nome: 'documento.jpg', mime: 'image/jpeg', dimensioneByte: null },
        { parte: '4', nome: 'allegato-4', mime: 'text/plain', dimensioneByte: null },
      ],
    });
  });
});

describe('testoDaHtml', () => {
  it('toglie markup, stile e script e tiene gli a capo dei paragrafi', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Gentile cliente,</p><p>saldo &amp; estratto&nbsp;conto</p><script>alert(1)</script></body></html>';
    expect(testoDaHtml(html)).toBe('Gentile cliente,\nsaldo & estratto conto');
  });
});
