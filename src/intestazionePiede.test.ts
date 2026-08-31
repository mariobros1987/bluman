/**
 * §39 — presidio del giro di andata e ritorno di intestazione e piè di pagina.
 *
 * Il rischio che questo file presidia è preciso: l'operatore sblocca l'intestazione con un doppio
 * clic, la corregge (un'altra sede, un altro recapito), salva, riapre — e la ritrova identica. Se
 * `componiDocumento`/`scomponiDocumento` non sono l'inverso l'una dell'altra, quella correzione si
 * perde in silenzio, ed è esattamente il tipo di perdita che la regola 3 vieta.
 *
 * Presidia anche il caso dei documenti salvati **prima** di §39, che non portano i marcatori: devono
 * tornare interi come corpo, senza intestazione e senza piede, così chi disegna usa quelli dello
 * studio come faceva prima.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloCodice } from './util/soloCodice.js';
import { componiDocumento, scomponiDocumento, ATTRIBUTO_BLOCCO } from './util/intestazionePiede.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('§39 — intestazione e piede sopravvivono al salvataggio', () => {
  it('rimette in piedi le tre parti nell\'ordine di stampa', () => {
    const html = componiDocumento({ intestazione: '<b>Studio</b>', corpo: '<p>Corpo</p>', piede: '<i>Piede</i>' });
    expect(html.indexOf('Studio')).toBeLessThan(html.indexOf('Corpo'));
    expect(html.indexOf('Corpo')).toBeLessThan(html.indexOf('Piede'));
  });

  it('riconsegna identico quello che ha ricevuto', () => {
    const parti = {
      intestazione: '<div style="display:flex"><img src="logo.png"/><span>Studio Rossi</span></div>',
      corpo: '<h1>ATTO</h1>\n<p>Testo dell\'atto.</p>',
      piede: '<span>Pagina 1</span>',
    };
    expect(scomponiDocumento(componiDocumento(parti))).toEqual(parti);
  });

  it('non perde il corpo quando i blocchi contengono altri div annidati', () => {
    // È il caso reale: l'intestazione dello studio è una riga flex con due div dentro. Un contatore
    // di annidamento sbagliato taglierebbe il documento a metà.
    const intestazione = '<div><div>Riga A</div><div><div>Riga B</div></div></div>';
    const parti = { intestazione, corpo: '<p>Solo questo è il corpo</p>', piede: '<div><div>P. 1</div></div>' };
    const tornate = scomponiDocumento(componiDocumento(parti));
    expect(tornate.intestazione).toBe(intestazione);
    expect(tornate.corpo).toBe('<p>Solo questo è il corpo</p>');
    expect(tornate.piede).toBe('<div><div>P. 1</div></div>');
  });

  it('un documento senza marcatori torna tutto come corpo', () => {
    // Tutto quello che è stato salvato prima di §39. Intestazione e piede a `null` significano
    // «usa quelli dello studio», che è il comportamento di sempre.
    const vecchio = '<h1>Contratto</h1><p>Firmato nel 2025.</p>';
    expect(scomponiDocumento(vecchio)).toEqual({ intestazione: null, corpo: vecchio, piede: null });
  });

  it('un blocco vuoto non viene scritto: l\'assenza è un\'informazione', () => {
    // Un documento su carta prestampata non ha intestazione propria, e un involucro vuoto salvato
    // diventerebbe una fascia bianca da cui non si torna indietro.
    const html = componiDocumento({ intestazione: '   ', corpo: '<p>Corpo</p>', piede: '' });
    expect(html).not.toContain(ATTRIBUTO_BLOCCO);
    expect(scomponiDocumento(html)).toEqual({ intestazione: null, corpo: '<p>Corpo</p>', piede: null });
  });

  it('regge il solo piede, o la sola intestazione', () => {
    expect(scomponiDocumento(componiDocumento({ corpo: '<p>C</p>', piede: '<span>P</span>' })))
      .toEqual({ intestazione: null, corpo: '<p>C</p>', piede: '<span>P</span>' });
    expect(scomponiDocumento(componiDocumento({ intestazione: '<span>I</span>', corpo: '<p>C</p>' })))
      .toEqual({ intestazione: '<span>I</span>', corpo: '<p>C</p>', piede: null });
  });

  it('scomporre due volte non cambia il risultato', () => {
    const html = componiDocumento({ intestazione: '<span>I</span>', corpo: '<p>C</p>', piede: '<span>P</span>' });
    const una = scomponiDocumento(html);
    const due = scomponiDocumento(componiDocumento(una));
    expect(due).toEqual(una);
  });

  it('un blocco senza chiusura lascia tutto nel corpo invece di tagliare il documento', () => {
    const rotto = `<div ${ATTRIBUTO_BLOCCO}="intestazione"><p>manca la chiusura`;
    const parti = scomponiDocumento(rotto);
    expect(parti.intestazione).toBeNull();
    expect(parti.corpo).toContain('manca la chiusura');
  });
});

describe('§39 — il foglio dell\'editor ha la geometria del PDF', () => {
  const FOGLIO = 'frontend/src/components/documenti/FoglioA4.tsx';
  const CANVAS = 'frontend/src/components/editor/EditorCanvas.tsx';
  const codiceFoglio = soloCodice(readFileSync(join(RADICE, FOGLIO), 'utf8'));
  const codiceCanvas = soloCodice(readFileSync(join(RADICE, CANVAS), 'utf8'));

  it('il foglio prende le misure da `paginaA4`, non da numeri propri', () => {
    expect(codiceFoglio).toMatch(/from\s+'(\.\.\/)+src\/util\/paginaA4'/);
    expect(codiceFoglio).toContain('A4_PX');
  });

  it('l\'editor non torna al foglio inventato di prima', () => {
    // Erano le misure del vecchio canvas: 780 px di largo, 1050 px di alto, margini 50/60 px.
    // Nessuna delle tre discendeva dall'A4 che poi si stampava.
    expect(codiceCanvas).not.toContain("maxWidth: '780px'");
    expect(codiceCanvas).not.toContain("minHeight: '1050px'");
    expect(codiceCanvas).not.toContain("padding: '50px 60px'");
    expect(codiceCanvas).toContain('FoglioA4');
  });

  it('i margini si vedono e il limite della pagina è marcato', () => {
    // «in maniera tale da non superarli»: il margine va disegnato, non solo rispettato.
    expect(codiceFoglio).toContain('A4_PX.margine');
    expect(codiceFoglio).toContain('altezzaUtile');
  });
});
